import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { activateSnapshot } from "../src/domain/pool/activate.js";
import { buildSnapshot } from "../src/domain/pool/build.js";
import { exportSnapshot } from "../src/domain/pool/export.js";
import { readSnapshotFile } from "../src/domain/pool/file.js";
import { currentSnapshotId, deleteSnapshots } from "./pool-support.js";
import { createTestApp, realSnapshotFile } from "./support.js";

/**
 * The owner's first real snapshot (collection-packs.md §5.1.10), rebuilt from the file with and without
 * the franchise cap. Runs only when `REAL_SNAPSHOT_FILE` names the file, never in CI:
 *
 *   REAL_SNAPSHOT_FILE=~/.anime-tcg/snapshots/snapshot-2026-10-29.json npm run test:routes -w api
 */
const path = realSnapshotFile();

describe.skipIf(path === undefined)("the real snapshot of 2026-10-29", () => {
  const load = async () => {
    if (path === undefined) throw new Error("no file");
    return readSnapshotFile(await readFile(path, "utf8")).input;
  };

  it("builds 2 983 characters in §5.1.10's tiers, 2 190 capped in 18 franchises, from 5 173 accepted", async () => {
    const input = await load();
    const capped = buildSnapshot(input);
    const uncapped = buildSnapshot(input, Infinity);
    expect(uncapped.characters).toHaveLength(5_173);
    expect(capped.entries).toHaveLength(100);
    expect(capped.franchises).toHaveLength(77);
    expect(capped.skipped.items).toBe(0);
    expect(capped.characters).toHaveLength(2_983);
    expect(capped.tierCounts).toEqual({
      common: 1_044,
      uncommon: 746,
      rare: 596,
      epic: 358,
      legendary: 179,
      mythic: 60,
    });
    expect(capped.capped).toBe(2_190);
    expect(capped.cappedByFranchise.size).toBe(18);
  });

  it("removes no MAIN character, the best removed ranked 1 030th, and changes no kept character's memberships or primary", async () => {
    const input = await load();
    const capped = buildSnapshot(input);
    const uncapped = new Map(buildSnapshot(input, Infinity).characters.map((c) => [c.id, c]));
    const kept = new Set(capped.characters.map((c) => c.id));
    const removed = [...uncapped.values()].filter((c) => !kept.has(c.id));
    expect(removed).toHaveLength(2_190);
    expect(removed.some((c) => c.memberships.some((m) => m.role === "main"))).toBe(false);
    expect(Math.min(...removed.map((c) => c.favouritesRank))).toBe(1_030);
    for (const character of capped.characters) {
      const before = uncapped.get(character.id);
      expect(character.memberships).toEqual(before?.memberships);
      expect(character.primarySeriesId).toBe(before?.primarySeriesId);
    }
    // Every character of the uncapped top 8 % stays in the pool.
    expect(removed.every((c) => c.favouritesRank > Math.round(5_173 * 0.08))).toBe(true);
  });

  describe("through the database", () => {
    let app: App;
    const snapshots: number[] = [];

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

    it("round-trips through --export: the rebuilt plan is the original, with nothing skipped or capped (§5.1.3)", async () => {
      if (path === undefined) throw new Error("no file");
      const { takenAt, input } = readSnapshotFile(await readFile(path, "utf8"));
      const plan = buildSnapshot(input);
      const activated = await activateSnapshot(app.db, plan, {
        source: "file",
        takenAt,
        now: new Date(),
        dryRun: false,
      });
      snapshots.push(activated.version);
      const copy = buildSnapshot(readSnapshotFile(JSON.stringify(await exportSnapshot(app.db))).input);
      expect(copy.entries).toEqual(plan.entries);
      expect(copy.franchises).toEqual(plan.franchises);
      expect(copy.edges).toEqual(plan.edges);
      expect(copy.characters).toEqual(plan.characters);
      expect(copy.tierCounts).toEqual(plan.tierCounts);
      expect(copy.skipped.items).toBe(0);
      expect(copy.capped).toBe(0);
    });
  });

  it("leaves 20 franchises at exactly 60 members and none above, ONE PIECE among them", async () => {
    const capped = buildSnapshot(await load());
    const franchiseOf = new Map(capped.entries.map((entry) => [entry.id, entry.franchiseId]));
    const members = new Map<number, Set<number>>();
    for (const character of capped.characters) {
      for (const { seriesId } of character.memberships) {
        const id = franchiseOf.get(seriesId) ?? seriesId;
        members.set(id, (members.get(id) ?? new Set<number>()).add(character.id));
      }
    }
    const sizes = [...members.values()].map((set) => set.size);
    expect(Math.max(...sizes)).toBe(60);
    expect(sizes.filter((size) => size === 60)).toHaveLength(20);
    const onePiece = 21;
    expect(members.get(onePiece)?.size).toBe(60);
    expect(capped.cappedByFranchise.get(onePiece)).toBe(755);
  });
});
