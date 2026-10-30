import { randomUUID } from "node:crypto";
import type { CollectionEntry, CollectionResponse, Rarity } from "@anime-tcg/shared/api";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import type { App } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { accounts, cards, ledgerEntries } from "../src/db/schema.js";
import { auditLedger } from "../src/domain/economy/audit.js";
import { type FixturePool, standardPool } from "./fixtures/pool.js";
import { body, getCollection } from "./pool-support.js";
import { migrationsDatabaseUrl, send } from "./support.js";

/**
 * Helpers of the economy's route tests (economy.md §14). The fixture pool is
 * 1c's standard 600 characters with genres: every entry is Action, the odd
 * ones also Comedy (both eligible), entry 1 alone also Sports (ineligible).
 * By the band rule at 600 the tiers are 12 / 36 / 72 / 120 / 150 / 210
 * characters, Mythic first, ids from `ECONOMY_BASE + 1`.
 */
export const ECONOMY_BASE = 800_000;
export const ID = {
  mythic: (n: number) => ECONOMY_BASE + n,
  legendary: (n: number) => ECONOMY_BASE + 12 + n,
  epic: (n: number) => ECONOMY_BASE + 48 + n,
  rare: (n: number) => ECONOMY_BASE + 120 + n,
  uncommon: (n: number) => ECONOMY_BASE + 240 + n,
  common: (n: number) => ECONOMY_BASE + 390 + n,
} as const;

export function economyPool(options: { genre?: string } = {}): FixturePool {
  const pool = standardPool({ characterBase: ECONOMY_BASE });
  pool.entries = pool.entries.map((entry, index) => {
    const genres = [options.genre ?? "Action"];
    if (index % 2 === 0) genres.push("Comedy");
    if (index === 0) genres.push("Sports");
    return { ...entry, genres };
  });
  return pool;
}

/** Every character of the economy pool in a Comedy entry: odd entries, so characters whose index is even. */
export const inComedy = (characterId: number) => (characterId - ECONOMY_BASE - 1) % 2 === 0;

export const recycle = (app: App, cookie: string | undefined, payload: unknown) =>
  send(app, { method: "POST", url: "/api/collection/recycle", cookie, payload });

export const recycleBody = (
  characterId: number,
  rarity: Rarity,
  count: number,
  requestId = randomUUID(),
) => ({
  requestId,
  characterId,
  rarity,
  count,
});

export const buyPack = (app: App, cookie: string | undefined, themeId: string, requestId = randomUUID()) =>
  send(app, { method: "POST", url: "/api/shop/buy", cookie, payload: { requestId, themeId } });

export const getWallet = (app: App, cookie: string | undefined) =>
  send(app, { method: "GET", url: "/api/wallet", cookie });

export const getShop = (app: App, cookie: string | undefined) =>
  send(app, { method: "GET", url: "/api/shop", cookie });

export const errorOf = (res: LightMyRequestResponse) =>
  res.json<{ error: { code: string; message: string; balance?: number; retryAfterSeconds?: number } }>()
    .error;

export async function entryOf(
  app: App,
  cookie: string,
  characterId: number,
): Promise<CollectionEntry | undefined> {
  const collection = body<CollectionResponse>(await getCollection(app, cookie));
  return collection.entries.find((entry) => entry.character.id === characterId);
}

export async function balanceOf(app: App, accountId: string): Promise<number> {
  const [row] = await app.db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (row === undefined) throw new Error(`no account ${accountId}`);
  return row.balance;
}

export async function ledgerOf(app: App, accountId: string) {
  return app.db
    .select({
      seq: ledgerEntries.seq,
      kind: ledgerEntries.kind,
      amount: ledgerEntries.amount,
      balanceAfter: ledgerEntries.balanceAfter,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountId, accountId))
    .orderBy(ledgerEntries.seq);
}

/**
 * Gives an account `balance` Karma without earning it, for the bound tests
 * (a balance near `MAX_BALANCE`): one forged ledger row, consistent with
 * the balance so the ledger function accepts it, but explained by nothing,
 * so `audit-ledger` reports the account. Every caller deletes such accounts
 * before the suite's closing audit.
 */
export async function forgeBalance(app: App, accountId: string, balance: number): Promise<void> {
  const [last] = await app.db
    .select({ seq: ledgerEntries.seq })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountId, accountId))
    .orderBy(desc(ledgerEntries.seq))
    .limit(1);
  const current = await balanceOf(app, accountId);
  await app.db.insert(ledgerEntries).values({
    accountId,
    seq: (last?.seq ?? 0) + 1,
    kind: "owner_reset",
    amount: balance - current,
    balanceAfter: balance,
    createdAt: new Date(),
  });
  await app.db.update(accounts).set({ balance }).where(eq(accounts.id, accountId));
}

/** economy.md §14: `audit-ledger` passes on the database a suite leaves behind, once the forged accounts are gone. */
export async function expectLedgerConsistent(app: App, forged: readonly string[] = []): Promise<void> {
  if (forged.length > 0) await app.db.delete(accounts).where(inArray(accounts.id, [...forged]));
  const result = await auditLedger(app.db);
  expect(result.failures).toEqual([]);
}

const HOUR = 3_600_000;

/**
 * Where a suite's fake clock starts: on the hour, 30 days behind the real
 * one, so a suite's advances never carry it past the database's time. The
 * reset stamps `last_reset_at` from the same clock as every ledger row,
 * recycle and opening, and 0005's `accounts_last_reset_forward` refuses a
 * last reset more than 5 seconds after the database's statement_timestamp().
 */
export function pastClockStart(): Date {
  return new Date(Math.floor(Date.now() / HOUR) * HOUR - 30 * 24 * HOUR);
}

/** The guard of `pastClockStart`: a suite whose clock ran ahead of the real one would test resets the database refuses. */
export function expectClockBehindDatabase(now: Date): void {
  expect(now.getTime()).toBeLessThanOrEqual(Date.now());
}

/** Postgres `integrity_constraint_violation`, the code of 0005's `cards_removed_stays` and `accounts_last_reset_forward` triggers. */
export const INTEGRITY_VIOLATION = "23000";

/**
 * Gives a recycle's cards back, as no role may since 0005's trigger: the
 * owner lifts the trigger for one transaction (no other session ever sees it
 * lifted), as a restore of a doctored dump could, so a test can show that
 * `audit-ledger` still finds the recycle. Returns how many cards came back.
 */
export async function putBackPastTheTrigger(recycleId: string): Promise<number> {
  const owner = createDb(migrationsDatabaseUrl());
  try {
    return await owner.transaction(async (tx) => {
      await tx.execute(sql`alter table cards disable trigger cards_removed_stays`);
      const back = await tx
        .update(cards)
        .set({ removedAt: null, removedByRecycle: null })
        .where(eq(cards.removedByRecycle, recycleId))
        .returning({ id: cards.id });
      await tx.execute(sql`alter table cards enable trigger cards_removed_stays`);
      return back.length;
    });
  } finally {
    await owner.$client.end();
  }
}
