import type { OpenedCard, PackAllowance, PackOpened, PacksResponse } from "@anime-tcg/shared/api";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db, Queryable } from "../../db/client.js";
import { accounts, cards, packOpenings } from "../../db/schema.js";
import { ApiError } from "../errors.js";
import { currentSnapshot, describeCharacters, franchiseRefs, tierPool } from "../pool/catalog.js";
import { perRarity } from "../pool/tiers.js";
import { allowanceAt, anchorAfterOpening } from "./allowance.js";
import { publishedOdds } from "./odds.js";
import { drawPack, type TierPool } from "./roll.js";
import type { Rng } from "./rng.js";

/** What the service logs through: the request's logger, so each line carries the request id. */
export type PackLog = Pick<Logger, "info">;

/** The characters an opening may deal and the snapshot they belong to; a themed pack passes a subset. */
export interface PackSource {
  snapshotId: number;
  tiers: TierPool;
}

export interface OpeningRequest {
  accountId: string;
  requestId: string;
  openedAt: Date;
}

/** An opening as stored: what a replay of its `requestId` answers with. */
export interface StoredOpening {
  openingId: string;
  openedAt: Date;
  snapshotId: number;
  cards: { slot: number; characterId: number; rarity: Rarity; isNew: boolean }[];
}

/**
 * Steps 5 to 7 of collection-packs.md §5.3, inside the caller's transaction
 * and under its account lock: roll and pick the cards from `source`, mark
 * each new to the account or not, and write the opening and its cards.
 */
export async function dealPack(
  tx: Queryable,
  request: OpeningRequest,
  rng: Rng,
  source: PackSource,
): Promise<StoredOpening> {
  const dealt = drawPack(source.tiers, rng);
  const dealtIds = dealt.map((card) => card.characterId);
  const owned = await tx
    .selectDistinct({ characterId: cards.characterId })
    .from(cards)
    .where(and(eq(cards.accountId, request.accountId), inArray(cards.characterId, dealtIds)));
  const ownedIds = new Set(owned.map((row) => row.characterId));

  const [opening] = await tx
    .insert(packOpenings)
    .values({
      accountId: request.accountId,
      requestId: request.requestId,
      snapshotId: source.snapshotId,
      openedAt: request.openedAt,
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
      accountId: request.accountId,
      openingId: opening.id,
      variant: "standard" as const,
      snapshotId: source.snapshotId,
      pulledAt: request.openedAt,
    })),
  );
  return { openingId: opening.id, openedAt: request.openedAt, snapshotId: source.snapshotId, cards: written };
}

function signedOut(): ApiError {
  return new ApiError(401, "unauthenticated", "Sign in first");
}

/**
 * Packs for one account: the allowance, the published odds and the opening
 * itself. Every path with stakes locks the account row first, so one
 * account's openings, and its reset, run one after another.
 */
export class PackService {
  /** Snapshots never change once written, so a pool read for an id is good for as long as the process runs. */
  private cachedPool: PackSource | null = null;

  constructor(
    private readonly db: Db,
    private readonly rng: Rng,
  ) {}

  async status(accountId: string, now: Date): Promise<PacksResponse> {
    const [account] = await this.db
      .select({ anchor: accounts.packsAnchorAt })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (account === undefined) throw signedOut();
    const snapshot = await currentSnapshot(this.db);
    return {
      allowance: allowanceAt(account.anchor, now),
      odds: snapshot === null ? null : publishedOdds(snapshot.tierSizes, snapshot.info),
    };
  }

  /** `replayed` is true when `requestId` named an opening this account already has (answered 200, not 201). */
  async open(
    log: PackLog,
    accountId: string,
    requestId: string,
    now: Date,
  ): Promise<{ replayed: boolean; opened: PackOpened }> {
    const { replayed, opening, allowance } = await this.db.transaction(async (tx) => {
      const [account] = await tx
        .select({ anchor: accounts.packsAnchorAt })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for("update");
      if (account === undefined) throw signedOut();

      const stored = await storedOpening(tx, accountId, requestId);
      if (stored !== null) {
        return { replayed: true, opening: stored, allowance: allowanceAt(account.anchor, now) };
      }

      const before = allowanceAt(account.anchor, now);
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

      const source = await this.poolFor(tx, snapshot.id);
      const dealt = await dealPack(tx, { accountId, requestId, openedAt: now }, this.rng, source);
      const anchor = anchorAfterOpening(account.anchor, now);
      await tx.update(accounts).set({ packsAnchorAt: anchor }).where(eq(accounts.id, accountId));
      return { replayed: false, opening: dealt, allowance: allowanceAt(anchor, now) };
    });

    log.info(
      {
        accountId,
        openingId: opening.openingId,
        snapshotId: opening.snapshotId,
        rarities: countRarities(opening.cards.map((card) => card.rarity)),
        replayed,
      },
      "pack opened",
    );
    return { replayed, opened: await this.describe(opening, allowance) };
  }

  private async poolFor(tx: Queryable, snapshotId: number): Promise<PackSource> {
    if (this.cachedPool?.snapshotId !== snapshotId) {
      this.cachedPool = { snapshotId, tiers: await tierPool(tx, snapshotId) };
    }
    return this.cachedPool;
  }

  private async describe(opening: StoredOpening, allowance: PackAllowance): Promise<PackOpened> {
    const current = await currentSnapshot(this.db);
    const described = await describeCharacters(
      this.db,
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
    return {
      openingId: opening.openingId,
      openedAt: opening.openedAt.toISOString(),
      cards: openedCards,
      franchises: await franchiseRefs(this.db, described.franchiseIds),
      allowance,
    };
  }
}

async function storedOpening(
  tx: Queryable,
  accountId: string,
  requestId: string,
): Promise<StoredOpening | null> {
  const [opening] = await tx
    .select({ id: packOpenings.id, openedAt: packOpenings.openedAt, snapshotId: packOpenings.snapshotId })
    .from(packOpenings)
    .where(and(eq(packOpenings.accountId, accountId), eq(packOpenings.requestId, requestId)))
    .limit(1);
  if (opening === undefined) return null;
  const rows = await tx
    .select({ slot: cards.slot, characterId: cards.characterId, rarity: cards.rarity, isNew: cards.isNew })
    .from(cards)
    .where(eq(cards.openingId, opening.id))
    .orderBy(asc(cards.slot));
  return { openingId: opening.id, openedAt: opening.openedAt, snapshotId: opening.snapshotId, cards: rows };
}

function countRarities(rarities: readonly Rarity[]): Record<Rarity, number> {
  return perRarity((tier) => rarities.filter((rarity) => rarity === tier).length);
}
