import { describe, expect, it } from "vitest";
import { capPerFranchise } from "./build.js";
import type { Candidate, Role } from "./validate.js";

/**
 * Tester's hunt (PR #28, leads 1 and 2): the franchise cap of
 * collection-packs.md §5.1.3 checked as invariants over many seeded random
 * pools, crowded with crossovers, ties and franchises of several entries, at
 * small caps so that most franchises are cut. The engineer's build tests
 * check hand-made cases; these check that no shape of pool breaks the rule.
 * The generator is seeded, so a failure reproduces with the seed it prints.
 */

/** mulberry32: a small seeded generator, enough to shape test pools. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface RandomPool {
  characters: Candidate[];
  franchiseOf: Map<number, number>;
}

function randomPool(seed: number): RandomPool {
  const random = mulberry32(seed);
  const int = (n: number) => Math.floor(random() * n);
  const entries = 4 + int(20);
  // Entries 1..entries grouped into franchises: each entry joins an earlier franchise one time in three.
  const franchiseOf = new Map<number, number>();
  for (let entry = 1; entry <= entries; entry += 1) {
    const earlier = entry > 1 && int(3) === 0 ? 1 + int(entry - 1) : entry;
    franchiseOf.set(entry, franchiseOf.get(earlier) ?? earlier);
  }
  const count = 20 + int(200);
  const characters: Candidate[] = [];
  for (let i = 0; i < count; i += 1) {
    const memberships = new Map<number, Role>();
    const appearances = 1 + (int(4) === 0 ? 1 + int(3) : 0);
    for (let k = 0; k < appearances; k += 1)
      memberships.set(1 + int(entries), int(2) === 0 ? "main" : "supporting");
    characters.push({
      id: 1 + i * 7 + int(7),
      name: `C${i}`,
      nameNative: null,
      imageUrl: "https://s4.anilist.co/x.png",
      // Few distinct values, so ties at the cut are common.
      favourites: int(12),
      memberships,
    });
  }
  return { characters, franchiseOf };
}

const byFavourites = (a: Candidate, b: Candidate) => b.favourites - a.favourites || a.id - b.id;

/** Every way the result breaks §5.1.3 for this pool, as readable lines; empty when it holds. */
function violations(seed: number, cap: number): string[] {
  const { characters, franchiseOf } = randomPool(seed);
  const franchise = (entry: number) => franchiseOf.get(entry) ?? entry;
  const found: string[] = [];
  const fail = (line: string) => found.push(`seed ${seed}, cap ${cap}: ${line}`);
  const result = capPerFranchise(characters, franchiseOf, cap);

  // The candidates of each franchise and the ones the rule keeps (§5.1.3 steps 1 and 2).
  const candidates = new Map<number, Candidate[]>();
  for (const character of characters) {
    for (const id of new Set([...character.memberships.keys()].map(franchise))) {
      candidates.set(id, [...(candidates.get(id) ?? []), character]);
    }
  }
  const keeps = new Map<number, Set<number>>();
  for (const [id, list] of candidates) {
    keeps.set(
      id,
      new Set(
        [...list]
          .sort(byFavourites)
          .slice(0, cap)
          .map((c) => c.id),
      ),
    );
  }
  const keptBy = (entry: number, id: number) => keeps.get(franchise(entry))?.has(id) === true;

  const originals = new Map(characters.map((c) => [c.id, c]));
  const ids = new Set(result.characters.map((c) => c.id));
  if (ids.size !== result.characters.length) fail("a character is in the pool twice");
  const members = new Map<number, Set<number>>();
  for (const kept of result.characters) {
    const original = originals.get(kept.id);
    if (original === undefined) {
      fail(`${kept.id} was never a candidate`);
      continue;
    }
    if (kept.memberships.size === 0) fail(`${kept.id} kept without a membership`);
    for (const [entry, role] of kept.memberships) {
      if (original.memberships.get(entry) !== role) fail(`${kept.id} gained or changed membership ${entry}`);
      if (!keptBy(entry, kept.id))
        fail(`${kept.id} kept a membership in franchise ${franchise(entry)}, which cut it`);
      members.set(franchise(entry), (members.get(franchise(entry)) ?? new Set<number>()).add(kept.id));
    }
    // Rule 3: every membership in a franchise that kept the character stays.
    for (const [entry] of original.memberships) {
      if (keptBy(entry, kept.id) && !kept.memberships.has(entry)) fail(`${kept.id} lost membership ${entry}`);
    }
  }
  for (const character of characters) {
    const keptSomewhere = [...character.memberships.keys()].some((entry) => keptBy(entry, character.id));
    if (ids.has(character.id) !== keptSomewhere)
      fail(`${character.id}: in pool ${ids.has(character.id)}, kept ${keptSomewhere}`);
  }
  for (const [id, list] of candidates) {
    const size = members.get(id)?.size ?? 0;
    // Never over the cap, never emptied: a franchise with candidates keeps min(cap, candidates).
    if (size !== Math.min(cap, list.length)) fail(`franchise ${id} has ${size} of ${list.length} candidates`);
    if ((result.cappedByFranchise.get(id) ?? 0) !== Math.max(0, list.length - cap))
      fail(`franchise ${id} reports ${result.cappedByFranchise.get(id) ?? 0} cut`);
  }
  if (result.capped !== characters.length - result.characters.length) fail(`capped ${result.capped}`);

  // Idempotent: capping the capped pool changes nothing (§5.1.3, the --export round trip).
  const again = capPerFranchise(result.characters, franchiseOf, cap);
  if (again.capped !== 0 || again.cappedByFranchise.size !== 0) fail("a second pass cut someone");
  else if (JSON.stringify(again.characters, mapsAsArrays) !== JSON.stringify(result.characters, mapsAsArrays))
    fail("a second pass changed the pool");
  return found;
}

function mapsAsArrays(_key: string, value: unknown): unknown {
  return value instanceof Map ? [...value] : value;
}

describe("capPerFranchise invariants over seeded random pools (§5.1.3)", () => {
  it.each([1, 2, 3, 5, 8, 60])("cap %i: 150 pools", (cap) => {
    const found: string[] = [];
    for (let seed = 1; seed <= 150; seed += 1) found.push(...violations(seed * 7_919 + cap, cap));
    expect(found.slice(0, 20)).toEqual([]);
    // Not vacuous: at the small caps most pools are cut, with crossovers among the cut.
    if (cap < 60) {
      let cut = 0;
      let crossoversCut = 0;
      for (let seed = 1; seed <= 150; seed += 1) {
        const { characters, franchiseOf } = randomPool(seed * 7_919 + cap);
        const result = capPerFranchise(characters, franchiseOf, cap);
        cut += result.cappedByFranchise.size;
        const kept = new Map(result.characters.map((c) => [c.id, c]));
        crossoversCut += characters.filter(
          (c) => c.memberships.size > 1 && (kept.get(c.id)?.memberships.size ?? 0) < c.memberships.size,
        ).length;
      }
      expect(cut).toBeGreaterThan(150);
      expect(crossoversCut).toBeGreaterThan(50);
    }
  });
});
