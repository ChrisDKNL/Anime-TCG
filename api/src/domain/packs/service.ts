import type { OpenedCard, PackAllowance, PackKind, PackOpened, PacksResponse } from "@anime-tcg/shared/api";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db, Queryable } from "../../db/client.js";
import { accounts, cards, packOpenings } from "../../db/schema.js";
import { ApiError } from "../errors.js";
import { currentSnapshot, describeCharacters, franchiseRefs, tierPool } from "../pool/catalog.js";
import { perRarity } from "../pool/tiers.js";
import { allowanceAt, anchorAfterOpening } from "./allowance.js";
import { publishedOdds } from "./odds.js";
import {
  countersAfter,
  drawPack,
  type PackCounters,
  type PackSource,
  packsUntilGuarantee,
  planPack,
  type TierPool,
} from "./roll.js";
import type { Rng } from "./rng.js";

/** What the service logs through: the request's logger, so each line carries the request id. */
export type PackLog = Pick<Logger, "info">;

/** The characters an opening may deal and the snapshot they belong to; a themed pack passes a subset. */
export interface PackPool {
  snapshotId: number;
  tiers: TierPool;
}

/** The account row as the opening read it under its lock: the allowance clock and both pack counters. */
export interface LockedAccount extends PackCounters {
  id: string;
  packsAnchorAt: Date | null;
}

export interface OpeningRequest {
  account: LockedAccount;
  requestId: string;
  openedAt: Date;
}

/** How the shop paid for a pack (economy.md §8.6): the theme it was dealt from, the price charged and its ledger row. */
export interface ShopPayment {
  themeId: string;
  ledgerEntryId: string;
  price: number;
}

/** An opening as stored: what a replay of its `requestId` answers with. */
export interface StoredOpening {
  openingId: string;
  openedAt: Date;
  snapshotId: number;
  kind: PackKind;
  pity: boolean;
  /** Null for a timer pack. */
  shop: Omit<ShopPayment, "ledgerEntryId"> | null;
  cards: { slot: number; characterId: number; rarity: Rarity; isNew: boolean }[];
}

export interface DealtOpening {
  opening: StoredOpening;
  /** The account row as the deal left it. */
  account: LockedAccount;
}

/**
 * Steps 5 to 8 of collection-packs.md §5.3, inside the caller's transaction
 * and under its account lock: plan the pack from the counters, roll and pick
 * the cards from `pool`, mark each new to the account or not, write the
 * opening and its cards, and move the allowance clock and the counters. A
 * free pack spends the allowance; a shop pack (economy.md §8.6) does not,
 * moves only what §5.4.7 says it moves, and carries the `shop` payment the
 * caller already wrote to the ledger.
 */
export async function dealPack(
  tx: Queryable,
  request: OpeningRequest,
  rng: Rng,
  pool: PackPool,
  source: PackSource,
  shop?: ShopPayment,
): Promise<DealtOpening> {
  if ((source === "shop") !== (shop !== undefined))
    throw new Error("a shop pack, and only a shop pack, is paid for");
  const { account } = request;
  const plan = planPack(account, source, rng);
  const dealt = drawPack(pool.tiers, plan, rng);
  const dealtIds = dealt.map((card) => card.characterId);
  const owned = await tx
    .selectDistinct({ characterId: cards.characterId })
    .from(cards)
    .where(
      and(eq(cards.accountId, account.id), inArray(cards.characterId, dealtIds), isNull(cards.removedAt)),
    );
  const ownedIds = new Set(owned.map((row) => row.characterId));

  const [opening] = await tx
    .insert(packOpenings)
    .values({
      accountId: account.id,
      requestId: request.requestId,
      snapshotId: pool.snapshotId,
      kind: plan.kind,
      pity: plan.pity,
      openedAt: request.openedAt,
      ...(shop === undefined
        ? {}
        : {
            source: "shop" as const,
            themeId: shop.themeId,
            ledgerEntryId: shop.ledgerEntryId,
            price: shop.price,
          }),
    })
    .returning({ id: packOpenings.id });
  if (opening === undefined) throw new Error("opening insert returned no row");

  const written = dealt.map((card) => ({
    slot: card.slot,
    characterId: card.characterId,
    rarity: card.tier,
    isNew: !ownedIds.has(card.characterId),
  }));
  await tx.insert(cards).values(
    written.map((card) => ({
      ...card,
      accountId: account.id,
      openingId: opening.id,
      variant: "standard" as const,
      snapshotId: pool.snapshotId,
      pulledAt: request.openedAt,
    })),
  );

  const counters = countersAfter(
    account,
    source,
    written.map((card) => card.rarity),
  );
  const packsAnchorAt =
    source === "free" ? anchorAfterOpening(account.packsAnchorAt, request.openedAt) : account.packsAnchorAt;
  await tx
    .update(accounts)
    .set({ packsAnchorAt, ...counters })
    .where(eq(accounts.id, account.id));
  return {
    opening: {
      openingId: opening.id,
      openedAt: request.openedAt,
      snapshotId: pool.snapshotId,
      kind: plan.kind,
      pity: plan.pity,
      shop: shop === undefined ? null : { themeId: shop.themeId, price: shop.price },
      cards: written,
    },
    account: { ...account, ...counters, packsAnchorAt },
  };
}

function signedOut(): ApiError {
  return new ApiError(401, "unauthenticated", "Sign in first");
}

export function requestIdReused(): ApiError {
  return new ApiError(409, "request_id_reused", "That request id was already used for another request");
}

export const LOCKED_ACCOUNT = {
  id: accounts.id,
  packsAnchorAt: accounts.packsAnchorAt,
  packsSinceMythic: accounts.packsSinceMythic,
  freePacksOpened: accounts.freePacksOpened,
};

/**
 * Packs for one account: the allowance, the published odds, the pity count
 * and the opening itself. Every path with stakes locks the account row
 * first, so one account's openings, and its reset, run one after another.
 */
export class PackService {
  /** Snapshots never change once written, so a pool read for an id is good for as long as the process runs. */
  private cachedPool: PackPool | null = null;

  constructor(
    private readonly db: Db,
    private readonly rng: Rng,
  ) {}

  async status(accountId: string, now: Date): Promise<PacksResponse> {
    const [account] = await this.db
      .select(LOCKED_ACCOUNT)
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (account === undefined) throw signedOut();
    const snapshot = await currentSnapshot(this.db);
    return {
      allowance: allowanceAt(account.packsAnchorAt, now),
      odds: snapshot === null ? null : publishedOdds(snapshot.tierSizes, snapshot.info),
      packsUntilGuarantee: snapshot === null ? null : packsUntilGuarantee(account),
    };
  }

  /** `replayed` is true when `requestId` named an opening this account already has (answered 200, not 201). */
  async open(
    log: PackLog,
    accountId: string,
    requestId: string,
    now: Date,
  ): Promise<{ replayed: boolean; opened: PackOpened }> {
    const { replayed, opening, account } = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select(LOCKED_ACCOUNT)
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for("update");
      if (locked === undefined) throw signedOut();

      const stored = await storedOpening(tx, accountId, requestId);
      if (stored?.shop === null) return { replayed: true, opening: stored, account: locked };
      // A shop purchase shares the openings' keys, and a timer opening never matches one (economy.md §8.8).
      if (stored !== null) throw requestIdReused();

      const before = allowanceAt(locked.packsAnchorAt, now);
      if (before.available === 0) {
        throw new ApiError(
          409,
          "no_pack_available",
          "No pack is ready yet",
          before.nextPackInSeconds ?? undefined,
        );
      }
      const snapshot = await currentSnapshot(tx);
      if (snapshot === null) throw new ApiError(503, "pool_unavailable", "Cards are not available right now");

      const pool = await this.poolFor(tx, snapshot.id);
      const dealt = await dealPack(tx, { account: locked, requestId, openedAt: now }, this.rng, pool, "free");
      return { replayed: false, ...dealt };
    });

    log.info(
      {
        accountId,
        openingId: opening.openingId,
        snapshotId: opening.snapshotId,
        kind: opening.kind,
        pity: opening.pity,
        rarities: countRarities(opening.cards.map((card) => card.rarity)),
        packsSinceMythic: account.packsSinceMythic,
        replayed,
      },
      "pack opened",
    );
    return { replayed, opened: await describeOpening(this.db, opening, account, now) };
  }

  private async poolFor(tx: Queryable, snapshotId: number): Promise<PackPool> {
    if (this.cachedPool?.snapshotId !== snapshotId) {
      this.cachedPool = { snapshotId, tiers: await tierPool(tx, snapshotId) };
    }
    return this.cachedPool;
  }
}

/** An opening as the api answers it: the cards as the game shows them now, the allowance and the pity count at `now`. */
export async function describeOpening(
  db: Queryable,
  opening: StoredOpening,
  account: LockedAccount,
  now: Date,
): Promise<PackOpened> {
  const current = await currentSnapshot(db);
  const described = await describeCharacters(
    db,
    opening.cards.map((card) => card.characterId),
    current?.id ?? null,
  );
  const openedCards: OpenedCard[] = opening.cards.map((card) => {
    const character = described.characters.get(card.characterId);
    if (character === undefined) throw new Error(`card character ${card.characterId} is missing`);
    return {
      kind: "card",
      slot: card.slot,
      character,
      rarity: card.rarity,
      variant: "standard",
      isNew: card.isNew,
    };
  });
  const allowance: PackAllowance = allowanceAt(account.packsAnchorAt, now);
  return {
    openingId: opening.openingId,
    openedAt: opening.openedAt.toISOString(),
    packKind: opening.kind,
    pityMythic: opening.pity,
    cards: openedCards,
    franchises: await franchiseRefs(db, described.franchiseIds),
    allowance,
    packsUntilGuarantee: current === null ? null : packsUntilGuarantee(account),
  };
}

export async function storedOpening(
  tx: Queryable,
  accountId: string,
  requestId: string,
): Promise<StoredOpening | null> {
  const [opening] = await tx
    .select({
      id: packOpenings.id,
      openedAt: packOpenings.openedAt,
      snapshotId: packOpenings.snapshotId,
      kind: packOpenings.kind,
      pity: packOpenings.pity,
      themeId: packOpenings.themeId,
      price: packOpenings.price,
    })
    .from(packOpenings)
    .where(and(eq(packOpenings.accountId, accountId), eq(packOpenings.requestId, requestId)))
    .limit(1);
  if (opening === undefined) return null;
  const rows = await tx
    .select({ slot: cards.slot, characterId: cards.characterId, rarity: cards.rarity, isNew: cards.isNew })
    .from(cards)
    .where(eq(cards.openingId, opening.id))
    .orderBy(asc(cards.slot));
  return {
    openingId: opening.id,
    openedAt: opening.openedAt,
    snapshotId: opening.snapshotId,
    kind: opening.kind,
    pity: opening.pity,
    shop:
      opening.themeId === null || opening.price === null
        ? null
        : { themeId: opening.themeId, price: opening.price },
    cards: rows,
  };
}

function countRarities(rarities: readonly Rarity[]): Record<Rarity, number> {
  return perRarity((tier) => rarities.filter((rarity) => rarity === tier).length);
}
