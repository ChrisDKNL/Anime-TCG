import { randomUUID } from "node:crypto";
import { RARITIES, type Rarity } from "@anime-tcg/shared/rarity";
import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import type { App } from "../src/app.js";
import type { Db } from "../src/db/client.js";
import {
  accounts,
  cards,
  characters,
  poolSnapshotCharacters,
  poolSnapshotFranchises,
  poolSnapshotMemberships,
  poolSnapshotRelations,
  poolSnapshotSeries,
  poolSnapshots,
  series,
} from "../src/db/schema.js";
import { type ActivationSummary, activateSnapshot } from "../src/domain/pool/activate.js";
import { buildSnapshot } from "../src/domain/pool/build.js";
import { readSnapshotFile } from "../src/domain/pool/file.js";
import type { TierPool } from "../src/domain/packs/roll.js";
import { cryptoRng, type Rng } from "../src/domain/packs/rng.js";
import { tierPool } from "../src/domain/pool/catalog.js";
import { type FixturePool, snapshotText } from "./fixtures/pool.js";
import { registerAccount, type SignedInClient, send } from "./support.js";

/** Loads a fixture pool the way `snapshot-pool --stdin` does and makes it current. */
export async function loadSnapshot(db: Db, pool: FixturePool, now = new Date()): Promise<ActivationSummary> {
  const { takenAt, input } = readSnapshotFile(snapshotText(pool));
  return activateSnapshot(db, buildSnapshot(input), { source: "file", takenAt, now, dryRun: false });
}

export async function currentSnapshotId(db: Db): Promise<number | null> {
  const [row] = await db
    .select({ id: poolSnapshots.id })
    .from(poolSnapshots)
    .where(eq(poolSnapshots.isCurrent, true));
  return row?.id ?? null;
}

/**
 * Removes the snapshots a test file made, and the character and series rows
 * no remaining snapshot or card names. The accounts holding cards from them
 * must be gone first (their cards go with them).
 */
export async function deleteSnapshots(db: Db, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(poolSnapshotMemberships).where(inArray(poolSnapshotMemberships.snapshotId, [...ids]));
  await db.delete(poolSnapshotCharacters).where(inArray(poolSnapshotCharacters.snapshotId, [...ids]));
  await db.delete(poolSnapshotRelations).where(inArray(poolSnapshotRelations.snapshotId, [...ids]));
  await db.delete(poolSnapshotSeries).where(inArray(poolSnapshotSeries.snapshotId, [...ids]));
  await db.delete(poolSnapshotFranchises).where(inArray(poolSnapshotFranchises.snapshotId, [...ids]));
  await db.delete(poolSnapshots).where(inArray(poolSnapshots.id, [...ids]));
  await db.delete(characters).where(
    and(
      notExists(
        db
          .select({ one: sql`1` })
          .from(poolSnapshotCharacters)
          .where(eq(poolSnapshotCharacters.characterId, characters.id)),
      ),
      notExists(
        db
          .select({ one: sql`1` })
          .from(cards)
          .where(eq(cards.characterId, characters.id)),
      ),
    ),
  );
  await db.delete(series).where(
    and(
      notExists(
        db
          .select({ one: sql`1` })
          .from(poolSnapshotSeries)
          .where(eq(poolSnapshotSeries.seriesId, series.id)),
      ),
      notExists(
        db
          .select({ one: sql`1` })
          .from(poolSnapshotFranchises)
          .where(eq(poolSnapshotFranchises.franchiseId, series.id)),
      ),
    ),
  );
}

export async function deleteAccounts(db: Db, ids: readonly string[]): Promise<void> {
  if (ids.length > 0) await db.delete(accounts).where(inArray(accounts.id, [...ids]));
}

let accountCounter = 0;

/** A fresh account through the real register route, with a login no other test in the run uses. */
export async function newPlayer(app: App, prefix: string): Promise<SignedInClient> {
  accountCounter += 1;
  return registerAccount(app, {
    login: `${prefix}${accountCounter}-${randomUUID().slice(0, 6)}`.slice(0, 24),
    password: "correct horse battery",
  });
}

export const openPack = (app: App, cookie: string | undefined, requestId: string = randomUUID()) =>
  send(app, { method: "POST", url: "/api/packs/open", cookie, payload: { requestId } });

export const getPacks = (app: App, cookie: string | undefined) =>
  send(app, { method: "GET", url: "/api/packs", cookie });

export const getCollection = (app: App, cookie: string | undefined) =>
  send(app, { method: "GET", url: "/api/collection", cookie });

export function body<T>(res: LightMyRequestResponse): T {
  return res.json<T>();
}

/** Tier rolls that force a tier: the smallest roll each tier is dealt at (collection-packs.md §5.4). */
export const ROLL = { mythic: 0, legendary: 661, epic: 4_693, rare: 42_670, common: 999_999 } as const;

/**
 * A generator that answers from `script` while it lasts and from
 * `crypto.randomInt` afterwards, so a route test can force one opening and
 * leave the rest to chance. Values outside the range asked for are a test bug.
 */
export function scriptedRng(): Rng & { script: number[] } {
  const script: number[] = [];
  const rng = (min: number, max: number) => {
    const next = script.shift();
    if (next === undefined) return cryptoRng(min, max);
    if (next < min || next >= max) throw new Error(`scripted ${next} is outside [${min}, ${max})`);
    return next;
  };
  return Object.assign(rng, { script });
}

/**
 * The generator values that make `drawPack` deal exactly `ids`, in slot
 * order, from `pool`: each slot's smallest tier roll, then the position the
 * partial Fisher–Yates shuffle has the character at by then.
 */
export function scriptFor(pool: TierPool, ids: readonly number[]): number[] {
  const decks = new Map<Rarity, { order: number[]; drawn: number }>();
  return ids.flatMap((id) => {
    const tier = RARITIES.find((candidate) => pool[candidate].includes(id));
    if (tier === undefined) throw new Error(`character ${id} is not in the pool`);
    const deck = decks.get(tier) ?? { order: [...pool[tier]], drawn: 0 };
    decks.set(tier, deck);
    const position = deck.order.indexOf(id);
    if (position < deck.drawn) throw new Error(`character ${id} is already in this pack`);
    const displaced = deck.order[deck.drawn];
    if (displaced === undefined) throw new Error("the tier ran out");
    deck.order[position] = displaced;
    deck.order[deck.drawn] = id;
    deck.drawn += 1;
    return [ROLL[tier], position];
  });
}

/** Scripts the next opening to deal `ids` from the given snapshot's pool. */
export async function forceNextPack(
  db: Db,
  rng: { script: number[] },
  snapshotId: number,
  ids: readonly number[],
) {
  rng.script.push(...scriptFor(await tierPool(db, snapshotId), ids));
}
