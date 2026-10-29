import type { CollectionResponse, PackOpened } from "@anime-tcg/shared/api";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app.js";
import { accounts, cards } from "../src/db/schema.js";
import type { ActivationSummary } from "../src/domain/pool/activate.js";
import { tierPool } from "../src/domain/pool/catalog.js";
import { type FixturePool, imageUrl, standardPool } from "./fixtures/pool.js";
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
import { createTestApp, type SignedInClient, testConfig, testDatabaseUrl } from "./support.js";

const BASE = 800_000;
/** Epic in snapshot 1 (rank 49 of 600, the first Epic), Legendary in snapshot 2 (rank 48, the last). */
const A = BASE + 49;
/** In entry 100, which snapshot 2 drops with all its characters; Epic (rank 100). */
const B = BASE + 100;
/** Also dropped by snapshot 2; the character the racing opening is held on. */
const X = BASE + 200;
/** In entry 1; snapshot 2 also makes it MAIN in entry 2, which it merges into entry 1's franchise. */
const SHARED = BASE + 301;
const F = 900_100;

/**
 * Snapshot 2 (collection-packs.md §9, "Snapshot update"): A favourited into
 * Legendary and renamed with a new image, entry 100 and its characters gone,
 * entry 101 and six new characters added, entries 1 and 2 merged by a
 * sequel edge, SHARED in both.
 */
function secondPool(): FixturePool {
  const pool = standardPool();
  pool.entries = pool.entries.filter((entry) => entry.id !== F);
  pool.entries[0] = { id: 900_001, title: "Series 1", relations: [{ type: "SEQUEL", to: 900_002 }] };
  pool.entries.push({ id: 900_101, title: "Series 101" });
  pool.characters = pool.characters
    .filter((character) => !character.in.some((membership) => membership.entry === F))
    .map((character) => {
      if (character.id === A) {
        return {
          ...character,
          // Above BASE + 48's 5 530: rank 48, the last Legendary.
          favourites: 5_535,
          name: "A renamed",
          image: imageUrl(A).replace(".png", "-v2.png"),
        };
      }
      if (character.id === SHARED) return { ...character, in: [{ entry: 900_001 }, { entry: 900_002 }] };
      return character;
    });
  for (let i = 1; i <= 6; i += 1)
    pool.characters.push({ id: BASE + 600 + i, favourites: i, in: [{ entry: 900_101 }] });
  return pool;
}

describe("a snapshot update under existing collections", () => {
  let app: App;
  const rng = scriptedRng();
  const made: string[] = [];
  const snapshots: number[] = [];
  let first: number;
  let second: ActivationSummary;
  let holder: SignedInClient;
  const countersOf = async (accountId: string) =>
    (
      await app.db
        .select({ packsSinceMythic: accounts.packsSinceMythic, freePacksOpened: accounts.freePacksOpened })
        .from(accounts)
        .where(eq(accounts.id, accountId))
    )[0];

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng });
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    first = (await loadSnapshot(app.db, standardPool())).version;
    snapshots.push(first);
    holder = await newPlayer(app, "su");
    made.push(holder.account.id);
  });
  afterAll(async () => {
    await deleteAccounts(app.db, made);
    await deleteSnapshots(app.db, snapshots);
    await app.close();
  });

  it("deals A as Epic and B while snapshot 1 is current", async () => {
    await forceNextPack(app.db, rng, first, [BASE + 391, BASE + 392, SHARED, BASE + 241, A]);
    const opened = body<PackOpened>(await openPack(app, holder.cookie));
    expect(opened.cards.map((card) => [card.character.id, card.rarity])).toEqual([
      [BASE + 391, "common"],
      [BASE + 392, "common"],
      [SHARED, "uncommon"],
      [BASE + 241, "uncommon"],
      [A, "epic"],
    ]);
    await forceNextPack(app.db, rng, first, [BASE + 393, BASE + 394, BASE + 395, BASE + 242, B]);
    const again = body<PackOpened>(await openPack(app, holder.cookie));
    expect(again.cards[4]).toMatchObject({ rarity: "epic", character: { id: B, rank: 100 } });
  });

  it("finishes an opening that read snapshot 1 before snapshot 2 committed from snapshot 1 only", async () => {
    const racer = await newPlayer(app, "su");
    made.push(racer.account.id);
    // Hold X's row so the opening, which drew X from snapshot 1, waits at its card insert (the foreign key check).
    const blocker = new pg.Client({ connectionString: testDatabaseUrl() });
    await blocker.connect();
    try {
      await blocker.query("begin");
      await blocker.query("select id from characters where id = $1 for update", [X]);
      await forceNextPack(app.db, rng, first, [BASE + 396, BASE + 397, BASE + 398, BASE + 243, X]);
      const opening = openPack(app, racer.cookie);
      await vi.waitFor(
        async () => {
          const waiting = await app.db.execute<{ waiting: number }>(sql`
            select count(*)::int as waiting from pg_stat_activity
            where wait_event_type = 'Lock' and query ilike 'insert into "cards"%'
          `);
          expect(waiting.rows[0]?.waiting).toBe(1);
        },
        { timeout: 10_000, interval: 25 },
      );
      const countersBefore = await countersOf(holder.account.id);
      second = await loadSnapshot(app.db, secondPool());
      snapshots.push(second.version);
      // The pack counters count packs and Mythic cards, not characters: an activation leaves them alone.
      expect(await countersOf(holder.account.id)).toEqual(countersBefore);
      expect(await currentSnapshotId(app.db)).toBe(second.version);
      await blocker.query("rollback");
      const res = await opening;
      expect(res.statusCode).toBe(201);
      const dealt = await app.db
        .select({ characterId: cards.characterId, snapshotId: cards.snapshotId })
        .from(cards)
        .where(eq(cards.accountId, racer.account.id));
      expect(dealt.map((card) => card.snapshotId)).toEqual(Array(5).fill(first));
      expect(dealt.map((card) => card.characterId)).toContain(X);
    } finally {
      await blocker.end();
    }
  });

  it("reports what the update changed", () => {
    expect(second).toMatchObject({
      dropped: 6,
      added: 6,
      franchisesMerged: 1,
      franchisesSplit: 0,
      characters: 600,
      capped: 0,
      cappedFranchises: 0,
    });
    expect(second.changedTier).toBeGreaterThanOrEqual(1);
  });

  it("keeps every earlier card's rarity and snapshot, and shows the new name and image", async () => {
    const stored = await app.db.select().from(cards).where(eq(cards.accountId, holder.account.id));
    expect(stored.every((card) => card.snapshotId === first)).toBe(true);
    expect(stored.find((card) => card.characterId === A)?.rarity).toBe("epic");
    const collection = body<CollectionResponse>(await getCollection(app, holder.cookie));
    const a = collection.entries.find((entry) => entry.character.id === A);
    expect(a).toMatchObject({
      rarity: "epic",
      character: {
        name: "A renamed",
        imageUrl: imageUrl(A).replace(".png", "-v2.png"),
        tier: "legendary",
        rank: 48,
        inCurrentSnapshot: true,
      },
    });
  });

  it("deals A only as Legendary from the activation on; holding both is two entries and one completion", async () => {
    const pool = await tierPool(app.db, second.version);
    expect(RARITIES.filter((tier) => pool[tier].includes(A))).toEqual(["legendary"]);
    await forceNextPack(app.db, rng, second.version, [BASE + 403, BASE + 404, BASE + 405, BASE + 244, A]);
    const opened = body<PackOpened>(await openPack(app, holder.cookie));
    expect(opened.cards[4]).toMatchObject({
      rarity: "legendary",
      isNew: false,
      character: { id: A, rank: 48 },
    });

    const collection = body<CollectionResponse>(await getCollection(app, holder.cookie));
    expect(
      collection.entries
        .filter((entry) => entry.character.id === A)
        .map((entry) => [entry.rarity, entry.count]),
    ).toEqual([
      ["legendary", 1],
      ["epic", 1],
    ]);
    // Of the 14 characters held, all but B are in snapshot 2.
    expect(collection.completion.pool).toEqual({ owned: 13, total: 600 });
  });

  it("keeps B, which snapshot 2 dropped, in the collection and totals, out of completion and out of packs", async () => {
    const collection = body<CollectionResponse>(await getCollection(app, holder.cookie));
    const b = collection.entries.find((entry) => entry.character.id === B);
    expect(b).toMatchObject({
      rarity: "epic",
      count: 1,
      character: { tier: null, rank: null, inCurrentSnapshot: false, franchiseIds: [F] },
    });
    expect(collection.totals.cards).toBe(15);
    const pool = await tierPool(app.db, second.version);
    expect(RARITIES.some((tier) => pool[tier].includes(B))).toBe(false);
  });

  it("gives F, no longer in the snapshot, no completion row but keeps it in franchises for B", async () => {
    const collection = body<CollectionResponse>(await getCollection(app, holder.cookie));
    expect(collection.completion.franchises.map((row) => row.franchiseId)).not.toContain(F);
    expect(collection.franchises).toContainEqual({
      id: F,
      title: "Series 100",
      titleNative: null,
      startYear: 2013,
    });
    expect(collection.franchises.at(-1)?.id).toBe(F);
  });

  it("counts each character of the merged franchise once", async () => {
    const collection = body<CollectionResponse>(await getCollection(app, holder.cookie));
    const completion = new Map(collection.completion.franchises.map((row) => [row.franchiseId, row]));
    // Entries 1 and 2, six characters each plus SHARED from entry 1 in entry 2 as well: 12 distinct, not 13.
    expect(completion.get(900_001)).toEqual({ franchiseId: 900_001, owned: 1, total: 12 });
    expect(completion.has(900_002)).toBe(false);
    expect(collection.entries.find((entry) => entry.character.id === SHARED)?.character.franchiseIds).toEqual(
      [900_001],
    );
  });
});
