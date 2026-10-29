import type { CollectionResponse, PackOpened, PacksResponse } from "@anime-tcg/shared/api";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { poolSnapshotCharacters, poolSnapshotMemberships, poolSnapshotSeries } from "../src/db/schema.js";
import type { ActivationSummary } from "../src/domain/pool/activate.js";
import { tierPool } from "../src/domain/pool/catalog.js";
import { tierCounts } from "../src/domain/pool/tiers.js";
import { type FixturePool, standardPool } from "./fixtures/pool.js";
import {
  body,
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  forceNextPack,
  getCollection,
  getPacks,
  loadSnapshot,
  newPlayer,
  openPack,
  scriptedRng,
} from "./pool-support.js";
import { createTestApp, testConfig } from "./support.js";

/*
 * Tester's hunt on PR #28 (T3): the franchise cap of collection-packs.md
 * §5.1.3 seen through the database, the pack route and the collection,
 * where the engineer's build.test.ts sees only the build plan.
 *
 * Plan
 *  - Lead 1: the cap never leaves a franchise without members (every
 *    franchise is listed with total >= 1), and an entry it empties stays an
 *    entry of its franchise without breaking completion or packs.
 *  - Lead 2: crossover characters. X is cut by its primary (most popular)
 *    franchise and kept by another: in the pool once, only the keeping
 *    franchise's membership, primary moved there, counted there and only
 *    there. V is kept by both: both memberships, primary unchanged. Y is cut
 *    twice within one franchise and Z by two franchises: out of the pool,
 *    counted once in `capped`, never dealt.
 *  - Lead 6 via the cap: a character owned under snapshot 1 that snapshot 2's
 *    cap removes is a dropped character: rank and tier null, in totals, in
 *    no completion.
 *
 * The capped fixture: the standard pool (100 entries of 6 characters) with
 *  - franchise A = entries 900 001 and 900 002 (SEQUEL), plus 60 extras in
 *    900 001 with 100 001..100 060 favourites;
 *  - franchise C = entry 900 060, plus 60 extras with 200 001.. favourites;
 *  - X (favourites 50): MAIN in 900 001, SUPPORTING in 900 050 (B);
 *  - Y (40): MAIN in 900 001 and 900 002, both A;
 *  - Z (30): MAIN in 900 001 (A) and 900 060 (C);
 *  - V (10 000 000): MAIN in 900 001 (A) and 900 050 (B).
 * A has 12 + 60 + X + Y + Z + V = 76 candidates, keeps V and the 59 most
 * favourited extras and cuts 16; C has 6 + 60 + Z = 67 and keeps its 60 extras; B has
 * 6 + X + V = 8. Accepted 724, pool 703, capped 21 (A's 12 originals, C's 6,
 * extra 710 001, Y and Z). Entry 900 002 keeps no member.
 */

const BASE = 800_000;
const A = 900_001;
const A2 = 900_002;
const B = 900_050;
const C = 900_060;
const X = 799_001;
const Y = 799_002;
const Z = 799_003;
const V = 799_004;
const A_EXTRA = 710_000;
const C_EXTRA = 720_000;

function cappedPool(): FixturePool {
  const pool = standardPool();
  const first = pool.entries[0];
  if (first === undefined) throw new Error("fixture too small");
  pool.entries[0] = { ...first, relations: [{ type: "SEQUEL", to: A2 }] };
  for (let i = 1; i <= 60; i += 1) {
    pool.characters.push({ id: A_EXTRA + i, favourites: 100_000 + i, in: [{ entry: A }] });
    pool.characters.push({ id: C_EXTRA + i, favourites: 200_000 + i, in: [{ entry: C }] });
  }
  pool.characters.push(
    { id: X, favourites: 50, in: [{ entry: A }, { entry: B, role: "SUPPORTING" }] },
    { id: Y, favourites: 40, in: [{ entry: A }, { entry: A2 }] },
    { id: Z, favourites: 30, in: [{ entry: A }, { entry: C }] },
    { id: V, favourites: 10_000_000, in: [{ entry: A }, { entry: B }] },
  );
  return pool;
}

describe("the franchise cap through the database, packs and the collection (PR #28 hunt)", () => {
  let app: App;
  const rng = scriptedRng();
  const made: string[] = [];
  const snapshots: number[] = [];
  let first: number;
  let capped: ActivationSummary;
  let veteran: string;

  const player = async () => {
    const client = await newPlayer(app, "cap");
    made.push(client.account.id);
    return client;
  };
  const poolRows = (snapshotId: number) =>
    app.db
      .select({
        id: poolSnapshotCharacters.characterId,
        rank: poolSnapshotCharacters.favouritesRank,
        tier: poolSnapshotCharacters.tier,
        primary: poolSnapshotCharacters.primarySeriesId,
      })
      .from(poolSnapshotCharacters)
      .where(eq(poolSnapshotCharacters.snapshotId, snapshotId))
      .orderBy(asc(poolSnapshotCharacters.characterId));
  const membershipsOf = (snapshotId: number, characterId: number) =>
    app.db
      .select({ series: poolSnapshotMemberships.seriesId, role: poolSnapshotMemberships.role })
      .from(poolSnapshotMemberships)
      .where(
        and(
          eq(poolSnapshotMemberships.snapshotId, snapshotId),
          eq(poolSnapshotMemberships.characterId, characterId),
        ),
      )
      .orderBy(asc(poolSnapshotMemberships.seriesId));

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng });
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    // Snapshot 1, uncapped: a veteran pulls Mythic BASE + 1 (entry A's) and BASE + 2 (entry A2's).
    first = (await loadSnapshot(app.db, standardPool())).version;
    snapshots.push(first);
    const client = await player();
    veteran = client.cookie;
    await forceNextPack(app.db, rng, first, [BASE + 1, BASE + 2, BASE + 3, BASE + 4, BASE + 5]);
    expect((await openPack(app, veteran)).statusCode).toBe(201);
    // Snapshot 2, capped: both are cut from franchise A.
    capped = await loadSnapshot(app.db, cappedPool());
    snapshots.push(capped.version);
  });
  afterAll(async () => {
    await deleteAccounts(app.db, made);
    await deleteSnapshots(app.db, snapshots);
    await app.close();
  });

  it("reports the cap as the fixture works it out: 703 characters, 21 capped, A cut 16 and C cut 7", () => {
    expect(capped).toMatchObject({
      characters: 703,
      capped: 21,
      cappedFranchises: 2,
      skipped: 0,
      entries: 100,
    });
    expect(capped.tierCounts).toEqual(tierCounts(703));
    const summary = new Map(capped.franchises.map((franchise) => [franchise.id, franchise]));
    expect(summary.get(A)).toMatchObject({ entries: 2, characters: 60, capped: 16 });
    expect(summary.get(B)).toMatchObject({ entries: 1, characters: 8, capped: 0 });
    expect(summary.get(C)).toMatchObject({ entries: 1, characters: 60, capped: 7 });
    expect(capped.franchises).toHaveLength(99);
  });

  it("publishes the capped pool's tier sizes and character count on GET /api/packs", async () => {
    const { cookie } = await player();
    const odds = body<PacksResponse>(await getPacks(app, cookie)).odds;
    expect(odds?.tierSizes).toEqual(tierCounts(703));
    expect(odds?.snapshot).toMatchObject({ version: capped.version, characterCount: 703 });
  });

  describe("lead 2: crossover characters", () => {
    it("X, cut by its most popular franchise, is in the pool once with only B's membership and B as primary", async () => {
      const rows = await poolRows(capped.version);
      expect(rows.filter((row) => row.id === X)).toEqual([expect.objectContaining({ primary: B })]);
      expect(await membershipsOf(capped.version, X)).toEqual([{ series: B, role: "supporting" }]);
    });

    it("V, kept by both, keeps both memberships and its most popular entry as primary", async () => {
      const rows = await poolRows(capped.version);
      expect(rows.filter((row) => row.id === V)).toEqual([expect.objectContaining({ primary: A, rank: 1 })]);
      expect(await membershipsOf(capped.version, V)).toEqual([
        { series: A, role: "main" },
        { series: B, role: "main" },
      ]);
    });

    it("Y (cut twice in one franchise) and Z (cut by two) are out of the pool and out of every tier", async () => {
      const ids = new Set((await poolRows(capped.version)).map((row) => row.id));
      for (const id of [Y, Z, A_EXTRA + 1, BASE + 1, BASE + 2])
        expect(ids.has(id), `character ${id}`).toBe(false);
      const pool = await tierPool(app.db, capped.version);
      const all = RARITIES.flatMap((tier) => pool[tier]);
      expect(all).toHaveLength(703);
      expect(new Set(all).size).toBe(703);
      expect(all.filter((id) => id === X)).toHaveLength(1);
      expect(all.filter((id) => id === V)).toHaveLength(1);
      expect(all.some((id) => id === Y || id === Z)).toBe(false);
    });

    it("ranks the capped pool 1 to 703 without gaps, so a card's rank is out of the capped pool", async () => {
      const ranks = (await poolRows(capped.version)).map((row) => row.rank).sort((a, b) => a - b);
      expect(ranks).toEqual(Array.from({ length: 703 }, (_, i) => i + 1));
    });

    it("deals X with franchiseIds [B] and V with [A, B]; the collection counts each once, in the right franchises", async () => {
      const { cookie } = await player();
      const pool = await tierPool(app.db, capped.version);
      // Fillers from entries of no franchise this test counts (not A, A2, B or C).
      const elsewhere = (id: number) =>
        id > BASE && id <= BASE + 600 && ![0, 1, 49, 59].includes((id - BASE - 1) % 100);
      const commons = pool.common.filter(elsewhere);
      const uncommon = pool.uncommon.find(elsewhere);
      if (commons.length < 2 || uncommon === undefined) throw new Error("fixture too small");
      expect(pool.common).toContain(X);
      expect(pool.mythic).toContain(V);
      const ids = [X, commons[0] ?? 0, commons[1] ?? 0, uncommon, V];
      await forceNextPack(app.db, rng, capped.version, ids);
      const opened = body<PackOpened>(await openPack(app, cookie));
      expect(opened.cards.map((card) => card.character.id)).toEqual(ids);
      expect(opened.cards[0]?.character.franchiseIds).toEqual([B]);
      expect(opened.cards[4]?.character.franchiseIds).toEqual([A, B]);
      expect(opened.franchises.map((franchise) => franchise.id)).toEqual(expect.arrayContaining([A, B]));

      const collection = body<CollectionResponse>(await getCollection(app, cookie));
      expect(collection.entries.filter((entry) => entry.character.id === X)).toHaveLength(1);
      const completion = new Map(collection.completion.franchises.map((row) => [row.franchiseId, row]));
      expect(completion.get(B)).toEqual({ franchiseId: B, owned: 2, total: 8 });
      expect(completion.get(A)?.owned).toBe(1);
      expect(completion.get(A)?.total).toBe(60);
      expect(collection.completion.pool).toEqual({ owned: PACK_SIZE, total: 703 });
    });
  });

  describe("lead 1: what the cap leaves behind", () => {
    it("leaves no franchise without members: all 99 are listed with total >= 1, at most 60", async () => {
      const { cookie } = await player();
      const collection = body<CollectionResponse>(await getCollection(app, cookie));
      expect(collection.completion.franchises).toHaveLength(99);
      for (const row of collection.completion.franchises) {
        expect(row.total, `franchise ${row.franchiseId}`).toBeGreaterThanOrEqual(1);
        expect(row.total, `franchise ${row.franchiseId}`).toBeLessThanOrEqual(60);
        expect(row.owned).toBe(0);
      }
      expect(collection.franchises.map((ref) => ref.id)).toEqual(
        collection.completion.franchises.map((row) => row.franchiseId),
      );
    });

    it("keeps entry 900 002, which the cap emptied, as an entry of franchise A with no member", async () => {
      const entry = await app.db
        .select({ franchise: poolSnapshotSeries.franchiseId, rank: poolSnapshotSeries.popularityRank })
        .from(poolSnapshotSeries)
        .where(and(eq(poolSnapshotSeries.snapshotId, capped.version), eq(poolSnapshotSeries.seriesId, A2)));
      expect(entry).toEqual([{ franchise: A, rank: 2 }]);
      const members = await app.db
        .select({ character: poolSnapshotMemberships.characterId })
        .from(poolSnapshotMemberships)
        .where(
          and(
            eq(poolSnapshotMemberships.snapshotId, capped.version),
            eq(poolSnapshotMemberships.seriesId, A2),
          ),
        );
      expect(members).toEqual([]);
    });
  });

  describe("lead 6 via the cap: a card whose character snapshot 2's cap removed", () => {
    it("shows BASE + 1 and BASE + 2 as dropped: tier and rank null, snapshot 1's franchises, in totals, in no completion", async () => {
      const collection = body<CollectionResponse>(await getCollection(app, veteran));
      const byId = new Map(collection.entries.map((entry) => [entry.character.id, entry]));
      expect(byId.get(BASE + 1)).toMatchObject({
        rarity: "mythic",
        character: { tier: null, rank: null, inCurrentSnapshot: false, franchiseIds: [A] },
      });
      expect(byId.get(BASE + 2)).toMatchObject({
        rarity: "mythic",
        character: { tier: null, rank: null, inCurrentSnapshot: false, franchiseIds: [A2] },
      });
      // BASE + 3, 4 and 5 survive the cap (entries 3, 4 and 5 are not capped), at their capped-pool ranks.
      for (const id of [BASE + 3, BASE + 4, BASE + 5]) {
        expect(byId.get(id)?.character).toMatchObject({ inCurrentSnapshot: true });
        expect(byId.get(id)?.character.rank).not.toBeNull();
      }
      expect(collection.totals.cards).toBe(PACK_SIZE);
      expect(collection.completion.pool).toEqual({ owned: 3, total: 703 });
      const completion = new Map(collection.completion.franchises.map((row) => [row.franchiseId, row]));
      expect(completion.get(A)?.owned).toBe(0);
      // A2 is no franchise of snapshot 2 (it merged into A), so it is named for the entry but has no completion row.
      expect(completion.has(A2)).toBe(false);
      expect(collection.franchises.map((ref) => ref.id)).toContain(A2);
    });
  });
});
