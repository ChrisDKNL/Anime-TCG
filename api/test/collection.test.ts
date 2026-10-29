import type { CollectionResponse } from "@anime-tcg/shared/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { type FixturePool, standardPool } from "./fixtures/pool.js";
import {
  body,
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  forceNextPack,
  getCollection,
  loadSnapshot,
  newPlayer,
  openPack,
  scriptedRng,
} from "./pool-support.js";
import { createTestApp, testConfig } from "./support.js";

const BASE = 800_000;
const C1 = BASE + 1;
const C2 = BASE + 10;
const C3 = BASE + 30;

/**
 * The standard pool, with entries 1-3 one franchise (SEQUEL edges), C1 in
 * all three, C2 MAIN in two franchises, and C3 BACKGROUND in entry 30 (no
 * membership) and MAIN in entry 40.
 */
function membershipPool(): FixturePool {
  const pool = standardPool();
  pool.entries[0] = { id: 900_001, title: "Series 1", relations: [{ type: "SEQUEL", to: 900_002 }] };
  pool.entries[1] = { id: 900_002, title: "Series 2", relations: [{ type: "SEQUEL", to: 900_003 }] };
  pool.characters[0] = {
    id: C1,
    favourites: 6_000,
    in: [{ entry: 900_001 }, { entry: 900_002 }, { entry: 900_003, role: "SUPPORTING" }],
  };
  pool.characters[9] = { id: C2, favourites: 5_910, in: [{ entry: 900_010 }, { entry: 900_020 }] };
  pool.characters[29] = {
    id: C3,
    favourites: 5_710,
    in: [
      { entry: 900_030, role: "BACKGROUND" },
      { entry: 900_040, role: "MAIN" },
    ],
  };
  return pool;
}

describe("GET /api/collection (collection-packs.md §5.5)", () => {
  let app: App;
  let now = new Date("2026-10-29T12:00:00.000Z");
  const rng = scriptedRng();
  const made: string[] = [];
  const snapshots: number[] = [];
  const player = async () => {
    const client = await newPlayer(app, "co");
    made.push(client.account.id);
    return client;
  };

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng, clock: () => now });
  });
  afterAll(async () => {
    await deleteAccounts(app.db, made);
    await deleteSnapshots(app.db, snapshots);
    await app.close();
  });

  it("answers an empty collection with no snapshot and no completion before the owner takes one", async () => {
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    const { cookie } = await player();
    const res = await getCollection(app, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      snapshot: null,
      totals: { cards: 0, duplicates: 0, byRarity: { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 } },
      completion: { pool: { owned: 0, total: 0 }, franchises: [] },
      franchises: [],
      entries: [],
    });
  });

  describe("with a snapshot", () => {
    let version: number;
    beforeAll(async () => {
      version = (await loadSnapshot(app.db, membershipPool())).version;
      snapshots.push(version);
    });

    it("lists every franchise of the snapshot for a new player, owned or not", async () => {
      const { cookie } = await player();
      const collection = body<CollectionResponse>(await getCollection(app, cookie));
      expect(collection.snapshot).toEqual({ version, takenAt: "2026-10-29T09:00:00.000Z" });
      expect(collection.entries).toEqual([]);
      expect(collection.completion.pool).toEqual({ owned: 0, total: 600 });
      expect(collection.completion.franchises).toHaveLength(98);
      expect(collection.completion.franchises.every((row) => row.owned === 0 && row.total >= 1)).toBe(true);
      expect(collection.franchises.map((ref) => ref.id)).toEqual(
        collection.completion.franchises.map((row) => row.franchiseId),
      );
      expect(collection.franchises[0]).toEqual({
        id: 900_001,
        title: "Series 1",
        titleNative: null,
        startYear: 2013,
      });
    });

    it("groups cards into entries with counts and dates, totals them, and counts completion once per character", async () => {
      const { cookie } = await player();
      const first = now;
      await forceNextPack(app.db, rng, version, [C1, C2, C3, BASE + 241, BASE + 242]);
      expect((await openPack(app, cookie)).statusCode).toBe(201);
      const second = new Date(first.getTime() + 60_000);
      now = second;
      try {
        await forceNextPack(app.db, rng, version, [C1, BASE + 243, BASE + 244, BASE + 245, BASE + 246]);
        expect((await openPack(app, cookie)).statusCode).toBe(201);
      } finally {
        now = first;
      }

      const collection = body<CollectionResponse>(await getCollection(app, cookie));
      expect(collection.totals).toEqual({
        cards: 10,
        duplicates: 1,
        byRarity: { common: 6, rare: 0, epic: 0, legendary: 2, mythic: 2 },
      });
      expect(collection.entries.map((entry) => [entry.character.id, entry.rarity, entry.count])).toEqual([
        [C1, "mythic", 2],
        [C2, "legendary", 1],
        [C3, "legendary", 1],
        [BASE + 241, "common", 1],
        [BASE + 242, "common", 1],
        [BASE + 243, "common", 1],
        [BASE + 244, "common", 1],
        [BASE + 245, "common", 1],
        [BASE + 246, "common", 1],
      ]);
      expect(collection.entries[0]).toEqual({
        kind: "card",
        character: {
          id: C1,
          name: `Character ${C1}`,
          nameNative: null,
          imageUrl: `https://s4.anilist.co/file/anilistcdn/character/large/b${C1}.png`,
          franchiseIds: [900_001],
          tier: "mythic",
          inCurrentSnapshot: true,
        },
        rarity: "mythic",
        variant: "standard",
        count: 2,
        firstObtainedAt: first.toISOString(),
        lastObtainedAt: second.toISOString(),
      });
      // C2 is MAIN in two franchises, the more popular one first; C3's BACKGROUND appearance is no membership.
      expect(collection.entries[1]?.character.franchiseIds).toEqual([900_010, 900_020]);
      expect(collection.entries[2]?.character.franchiseIds).toEqual([900_040]);

      expect(collection.completion.pool).toEqual({ owned: 9, total: 600 });
      const completion = new Map(collection.completion.franchises.map((row) => [row.franchiseId, row]));
      // Three entries, six characters each, C1 in all three: 18 distinct, C1 owned once.
      expect(completion.get(900_001)).toEqual({ franchiseId: 900_001, owned: 1, total: 18 });
      expect(completion.has(900_002)).toBe(false);
      expect(completion.get(900_010)).toEqual({ franchiseId: 900_010, owned: 1, total: 6 });
      expect(completion.get(900_020)).toEqual({ franchiseId: 900_020, owned: 1, total: 7 });
      expect(completion.get(900_030)).toEqual({ franchiseId: 900_030, owned: 0, total: 5 });
      expect(completion.get(900_040)).toEqual({ franchiseId: 900_040, owned: 1, total: 7 });
      expect(completion.get(900_041)).toEqual({ franchiseId: 900_041, owned: 1, total: 6 });
    });

    it("shows an account only its own cards", async () => {
      const a = await player();
      const b = await player();
      await openPack(app, a.cookie);
      const forB = body<CollectionResponse>(await getCollection(app, b.cookie));
      expect(forB.entries).toEqual([]);
      expect(forB.totals.cards).toBe(0);
    });
  });
});
