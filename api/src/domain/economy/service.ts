import type { RecycleBody, RecycleReceipt, Wallet } from "@anime-tcg/shared/api";
import { RECYCLE_VALUE } from "@anime-tcg/shared/economy";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db, Queryable } from "../../db/client.js";
import { accounts, cards, ledgerEntries, recycles } from "../../db/schema.js";
import { ApiError } from "../errors.js";
import { cardIsListed, liveListingCount } from "../market/listings.js";
import { type LockedBalance, postEntry } from "./ledger.js";
import { copiesToRecycle, recycleCredit, recycleRequestHash } from "./recycle.js";
import { karmaRules } from "./rules.js";

/** What the service logs through: the request's logger, so each line carries the request id. */
export type EconomyLog = Pick<Logger, "info">;

function signedOut(): ApiError {
  return new ApiError(401, "unauthenticated", "Sign in first");
}

/** The account row a balance change locks first (economy.md §8.9): the one lock every Karma path starts with. */
export async function lockBalance(tx: Queryable, accountId: string): Promise<LockedBalance> {
  const [locked] = await tx
    .select({ id: accounts.id, balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .for("update");
  if (locked === undefined) throw signedOut();
  return locked;
}

function requestIdReused(): ApiError {
  return new ApiError(409, "request_id_reused", "That request id was already used for another request");
}

/**
 * The wallet and recycling duplicates for Karma (economy.md §8.1, §8.2).
 * Every path that changes a balance locks the account row first and writes
 * its ledger row through `postEntry` in the same transaction.
 */
export class EconomyService {
  constructor(private readonly db: Db) {}

  /** `activeListings` counts the account's live listings at `now`, the number the listing cap counts (economy.md §11.2). */
  async wallet(accountId: string, now: Date): Promise<Wallet> {
    const [row] = await this.db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (row === undefined) throw signedOut();
    return {
      balance: row.balance,
      activeListings: await liveListingCount(this.db, accountId, now),
      rules: karmaRules(),
    };
  }

  /** `replayed` is true when `requestId` named a recycle this account already made with the same body (200, not 201). */
  async recycle(
    log: EconomyLog,
    accountId: string,
    body: RecycleBody,
    clock: () => Date,
  ): Promise<{ replayed: boolean; receipt: RecycleReceipt }> {
    const requestHash = recycleRequestHash(body);
    const { replayed, receipt } = await this.db.transaction(async (tx) => {
      const locked = await lockBalance(tx, accountId);
      // Read once the account row is locked, as the reset reads its own (economy.md §8.9, manager decision, 2026-10-30).
      const now = clock();
      const stored = await storedRecycle(tx, accountId, body.requestId);
      if (stored !== null) {
        if (stored.requestHash !== requestHash) throw requestIdReused();
        return { replayed: true, receipt: { ...stored.receipt, balance: locked.balance } };
      }

      const copies = await tx
        .select({
          id: cards.id,
          pulledAt: cards.pulledAt,
          escrowId: cards.escrowId,
          listed: cardIsListed(now),
        })
        .from(cards)
        .where(
          and(
            eq(cards.accountId, accountId),
            eq(cards.characterId, body.characterId),
            eq(cards.rarity, body.rarity),
            eq(cards.variant, "standard"),
            isNull(cards.removedAt),
          ),
        )
        .for("update");
      const taken = copiesToRecycle(
        copies.map((copy) => ({
          id: copy.id,
          pulledAt: copy.pulledAt,
          listed: copy.listed,
          escrowed: copy.escrowId !== null,
        })),
        body.count,
      );
      const credit = recycleCredit(body.rarity, body.count);
      const entry = await postEntry(tx, locked, "recycle_credit", credit, now);
      const [recycle] = await tx
        .insert(recycles)
        .values({
          accountId,
          requestId: body.requestId,
          requestHash,
          characterId: body.characterId,
          rarity: body.rarity,
          count: body.count,
          unitValue: RECYCLE_VALUE[body.rarity],
          ledgerEntryId: entry.id,
          createdAt: now,
        })
        .returning({ id: recycles.id });
      if (recycle === undefined) throw new Error("recycle insert returned no row");
      await tx
        .update(cards)
        .set({ removedAt: now, removedByRecycle: recycle.id })
        .where(inArray(cards.id, taken));
      return {
        replayed: false,
        receipt: {
          recycleId: recycle.id,
          recycledAt: now.toISOString(),
          recycled: { characterId: body.characterId, rarity: body.rarity, count: body.count },
          credited: credit,
          balance: entry.balanceAfter,
        },
      };
    });

    log.info(
      {
        accountId,
        recycleId: receipt.recycleId,
        characterId: receipt.recycled.characterId,
        rarity: receipt.recycled.rarity,
        count: receipt.recycled.count,
        credit: receipt.credited,
        balanceAfter: receipt.balance,
        replayed,
      },
      "recycled",
    );
    return { replayed, receipt };
  }
}

async function storedRecycle(
  tx: Queryable,
  accountId: string,
  requestId: string,
): Promise<{ requestHash: string; receipt: Omit<RecycleReceipt, "balance"> } | null> {
  const [row] = await tx
    .select({
      id: recycles.id,
      requestHash: recycles.requestHash,
      characterId: recycles.characterId,
      rarity: recycles.rarity,
      count: recycles.count,
      createdAt: recycles.createdAt,
      credited: ledgerEntries.amount,
    })
    .from(recycles)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, recycles.ledgerEntryId))
    .where(and(eq(recycles.accountId, accountId), eq(recycles.requestId, requestId)))
    .limit(1);
  if (row === undefined) return null;
  return {
    requestHash: row.requestHash,
    receipt: {
      recycleId: row.id,
      recycledAt: row.createdAt.toISOString(),
      recycled: { characterId: row.characterId, rarity: row.rarity, count: row.count },
      credited: row.credited,
    },
  };
}
