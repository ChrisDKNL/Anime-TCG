import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import {
  poolSnapshotCharacters,
  poolSnapshotFranchises,
  poolSnapshotMemberships,
  poolSnapshotSeries,
} from "../src/db/schema.js";
import { activateSnapshot } from "../src/domain/pool/activate.js";
import { buildSnapshot } from "../src/domain/pool/build.js";
import { exportSnapshot } from "../src/domain/pool/export.js";
import { readSnapshotFile } from "../src/domain/pool/file.js";
import { type FixturePool, standardPool } from "./fixtures/pool.js";
import { currentSnapshotId, deleteSnapshots, loadSnapshot } from "./pool-support.js";
import { createTestApp } from "./support.js";

/*
 * BUG (tester's hunt, PR #28, lead 1): when the franchise cap removes every
 * character of an entry, `--export` of that snapshot does not build the same
 * pool again, which collection-packs.md §5.1.3 ("building from that export
 * gives the identical pool again (the cap is idempotent)"), §7.1 and §9
 * ("`--export` of a built snapshot fed to `--stdin` builds an identical pool
 * (same tiers, ranks, franchises, memberships and primaries)") require.
 *
 * Why: the build keeps an entry the cap emptied (the cap runs after the entry
 * check), so the snapshot holds it with no membership; the export writes it
 * with no characters; the rebuild's validation then skips it as
 * `entry:no_characters` (a rule of `validate.ts` the spec does not state). The
 * rebuilt snapshot has one entry fewer, a skipped item the original did not
 * have, and, when the emptied entry was its franchise's anchor (smallest id),
 * a different franchise id and popularity rank: every card of that franchise
 * moves to a new franchise id and the old one loses its completion row, from
 * re-importing the very pool that is running.
 *
 * Reproduce: `npm run test:routes -w api -- test/bug-cap-emptied-entry-export.test.ts`
 * (with DATABASE_URL and MIGRATIONS_DATABASE_URL on the test database). Not
 * hit by the owner's real file today: §5.1.10 says no character loses a
 * membership to the cap there.
 */

const BASE = 800_000;

/**
 * Standard pool; entry `emptied` is joined to entry `other` by a SEQUEL, and
 * `other` gains 60 characters more favourited than anyone in either entry,
 * so the franchise keeps exactly those 60 and `emptied` keeps nobody.
 */
function poolEmptying(emptied: number, other: number): FixturePool {
  const pool = standardPool();
  pool.entries = pool.entries.map((entry) =>
    entry.id === Math.min(emptied, other)
      ? { ...entry, relations: [{ type: "SEQUEL", to: Math.max(emptied, other) }] }
      : entry,
  );
  for (let i = 1; i <= 60; i += 1) {
    pool.characters.push({ id: 730_000 + i, favourites: 1_000_000 + i, in: [{ entry: other }] });
  }
  return pool;
}

describe("BUG: an entry the franchise cap empties breaks the --export round trip", () => {
  let app: App;
  const snapshots: number[] = [];

  const shape = async (snapshotId: number) => ({
    entries: await app.db
      .select({
        series: poolSnapshotSeries.seriesId,
        franchise: poolSnapshotSeries.franchiseId,
        rank: poolSnapshotSeries.popularityRank,
      })
      .from(poolSnapshotSeries)
      .where(eq(poolSnapshotSeries.snapshotId, snapshotId))
      .orderBy(asc(poolSnapshotSeries.seriesId)),
    franchises: await app.db
      .select({ id: poolSnapshotFranchises.franchiseId, rank: poolSnapshotFranchises.popularityRank })
      .from(poolSnapshotFranchises)
      .where(eq(poolSnapshotFranchises.snapshotId, snapshotId))
      .orderBy(asc(poolSnapshotFranchises.franchiseId)),
    characters: await app.db
      .select({
        id: poolSnapshotCharacters.characterId,
        tier: poolSnapshotCharacters.tier,
        rank: poolSnapshotCharacters.favouritesRank,
        primary: poolSnapshotCharacters.primarySeriesId,
      })
      .from(poolSnapshotCharacters)
      .where(eq(poolSnapshotCharacters.snapshotId, snapshotId))
      .orderBy(asc(poolSnapshotCharacters.characterId)),
    memberships: await app.db
      .select({ character: poolSnapshotMemberships.characterId, series: poolSnapshotMemberships.seriesId })
      .from(poolSnapshotMemberships)
      .where(eq(poolSnapshotMemberships.snapshotId, snapshotId))
      .orderBy(asc(poolSnapshotMemberships.characterId), asc(poolSnapshotMemberships.seriesId)),
  });

  /** Activates `pool`, exports it, rebuilds the export and activates that: the two snapshots and the rebuild's plan. */
  async function roundTrip(pool: FixturePool) {
    const original = await loadSnapshot(app.db, pool);
    snapshots.push(original.version);
    const { takenAt, input } = readSnapshotFile(JSON.stringify(await exportSnapshot(app.db)));
    const plan = buildSnapshot(input);
    const copy = await activateSnapshot(app.db, plan, {
      source: "file",
      takenAt,
      now: new Date(),
      dryRun: false,
    });
    snapshots.push(copy.version);
    return { original, copy, plan };
  }

  beforeAll(async () => {
    app = await createTestApp();
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
  });
  afterAll(async () => {
    await deleteSnapshots(app.db, snapshots);
    await app.close();
  });

  it("the emptied entry is the franchise's anchor: the rebuild keeps all 100 entries and franchise 900 001", async () => {
    // Entry 900 001 (popularity rank 1, the smallest id) is emptied; 900 002 keeps the 60.
    const { original, copy, plan } = await roundTrip(poolEmptying(900_001, 900_002));
    const before = await shape(original.version);
    // Preconditions: the original holds 900 001 as the anchor of its franchise, with no member.
    expect(before.entries.find((row) => row.series === 900_001)).toEqual({
      series: 900_001,
      franchise: 900_001,
      rank: 1,
    });
    expect(before.memberships.filter((row) => row.series === 900_001)).toEqual([]);
    expect(original).toMatchObject({ entries: 100, skipped: 0 });

    expect(await shape(copy.version)).toEqual(before);
    expect(plan.skipped.byReason()).toEqual({});
    expect(copy).toMatchObject({ entries: 100, skipped: 0, capped: 0 });
  });

  it("the emptied entry is not the anchor: the rebuild still keeps every entry and reports nothing skipped", async () => {
    // Entry 900 004 is emptied; 900 003, its franchise's anchor, keeps the 60.
    const { original, copy, plan } = await roundTrip(poolEmptying(900_004, 900_003));
    const before = await shape(original.version);
    expect(before.memberships.filter((row) => row.series === 900_004)).toEqual([]);
    expect(before.entries.find((row) => row.series === 900_004)?.franchise).toBe(900_003);

    expect(await shape(copy.version)).toEqual(before);
    expect(plan.skipped.byReason()).toEqual({});
    expect(copy).toMatchObject({ entries: 100, skipped: 0 });
  });

  it("characters and tiers survive either way (the part of the round trip that does hold)", async () => {
    const { original, copy } = await roundTrip(poolEmptying(900_005, 900_006));
    const before = await shape(original.version);
    const after = await shape(copy.version);
    expect(after.characters).toEqual(before.characters);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.characters.some((row) => row.id === BASE + 5)).toBe(false);
  });
});
