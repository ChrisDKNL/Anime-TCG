import { randomUUID } from "node:crypto";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import {
  ENCHANTED_SLOT_ODDS,
  ODDS_SCALE,
  type OddsTable,
  RADIANT_SLOT_ODDS,
  RARITIES,
  type Rarity,
  SLOT_ODDS,
} from "@anime-tcg/shared/rarity";
import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import type { App } from "../src/app.js";
import { createDb, type Db } from "../src/db/client.js";
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
import { migrationsDatabaseUrl, registerAccount, type SignedInClient, send } from "./support.js";

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
 * must be gone first (their cards go with them). Runs as the owner: the app
 * role may not delete a snapshot or its reference data (0003's revokes).
 */
export async function deleteSnapshots(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = createDb(migrationsDatabaseUrl());
  try {
    await db.transaction(async (tx) => {
      await tx.delete(poolSnapshotMemberships).where(inArray(poolSnapshotMemberships.snapshotId, [...ids]));
      await tx.delete(poolSnapshotCharacters).where(inArray(poolSnapshotCharacters.snapshotId, [...ids]));
      await tx.delete(poolSnapshotRelations).where(inArray(poolSnapshotRelations.snapshotId, [...ids]));
      await tx.delete(poolSnapshotSeries).where(inArray(poolSnapshotSeries.snapshotId, [...ids]));
      await tx.delete(poolSnapshotFranchises).where(inArray(poolSnapshotFranchises.snapshotId, [...ids]));
      await tx.delete(poolSnapshots).where(inArray(poolSnapshots.id, [...ids]));
      await tx.delete(characters).where(
        and(
          notExists(
            tx
              .select({ one: sql`1` })
              .from(poolSnapshotCharacters)
              .where(eq(poolSnapshotCharacters.characterId, characters.id)),
          ),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(cards)
              .where(eq(cards.characterId, characters.id)),
          ),
        ),
      );
      await tx.delete(series).where(
        and(
          notExists(
            tx
              .select({ one: sql`1` })
              .from(poolSnapshotSeries)
              .where(eq(poolSnapshotSeries.seriesId, series.id)),
          ),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(poolSnapshotFranchises)
              .where(eq(poolSnapshotFranchises.franchiseId, series.id)),
          ),
        ),
      );
    });
  } finally {
    await db.$client.end();
  }
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

/** Plan rolls (the first generator call of every opening, §5.4.4): Radiant below `RADIANT_ODDS`. */
export const PLAN = { standard: ODDS_SCALE - 1, radiant: 0 } as const;

/** The smallest roll that lands on `tier` in `table` (rarest first by running sums), or null when the table cannot. */
export function rollFor(table: OddsTable, tier: Rarity): number | null {
  if (table[tier] === 0) return null;
  let threshold = 0;
  for (const candidate of [...RARITIES].reverse()) {
    if (candidate === tier) return threshold;
    threshold += table[candidate];
  }
  return null;
}

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

/** What the counters make of the next free pack: its fifth slot Enchanted, forced by pity, or neither. */
export interface ForcedPackOptions {
  enchanted?: boolean;
  pity?: boolean;
}

/**
 * The generator values that make an opening deal exactly `ids`, in slot
 * order, from `pool`: the plan roll (Radiant only when a standard pack
 * cannot hold them), then per slot the smallest roll of that slot's table
 * that lands on the character's tier (none for a forced slot) and the
 * position the partial Fisher–Yates shuffle has the character at by then.
 * Throws when no pack of that kind can deal them: the slot floors hold.
 */
export function scriptFor(pool: TierPool, ids: readonly number[], options: ForcedPackOptions = {}): number[] {
  const tiers = ids.map((id) => {
    const tier = RARITIES.find((candidate) => pool[candidate].includes(id));
    if (tier === undefined) throw new Error(`character ${id} is not in the pool`);
    return tier;
  });
  const last = PACK_SIZE - 1;
  const standard: (OddsTable | "mythic")[] = SLOT_ODDS.map((table, slot) =>
    slot !== last
      ? table
      : options.pity === true
        ? "mythic"
        : options.enchanted === true
          ? ENCHANTED_SLOT_ODDS
          : table,
  );
  const radiant: (OddsTable | "mythic")[] = SLOT_ODDS.map((_, slot) =>
    slot === last ? "mythic" : RADIANT_SLOT_ODDS,
  );
  const fits = (rules: (OddsTable | "mythic")[]) =>
    tiers.every((tier, slot) => {
      const rule = rules[slot];
      return rule === "mythic" ? tier === "mythic" : rule !== undefined && rollFor(rule, tier) !== null;
    });
  const [plan, rules] = fits(standard)
    ? [PLAN.standard, standard]
    : fits(radiant)
      ? [PLAN.radiant, radiant]
      : [null, []];
  if (plan === null) throw new Error(`no pack can deal ${tiers.join(", ")} in that order`);

  const decks = new Map<Rarity, { order: number[]; drawn: number }>();
  const picks = ids.flatMap((id, slot) => {
    const tier = tiers[slot];
    const rule = rules[slot];
    if (tier === undefined || rule === undefined) throw new Error("one tier and one rule per card");
    const deck = decks.get(tier) ?? { order: [...pool[tier]], drawn: 0 };
    decks.set(tier, deck);
    const position = deck.order.indexOf(id);
    if (position < deck.drawn) throw new Error(`character ${id} is already in this pack`);
    const displaced = deck.order[deck.drawn];
    if (displaced === undefined) throw new Error("the tier ran out");
    deck.order[position] = displaced;
    deck.order[deck.drawn] = id;
    deck.drawn += 1;
    return rule === "mythic" ? [position] : [rollFor(rule, tier) ?? 0, position];
  });
  return [plan, ...picks];
}

/** Scripts the next opening to deal `ids` from the given snapshot's pool. */
export async function forceNextPack(
  db: Db,
  rng: { script: number[] },
  snapshotId: number,
  ids: readonly number[],
  options: ForcedPackOptions = {},
) {
  rng.script.push(...scriptFor(await tierPool(db, snapshotId), ids, options));
}
