import { describe, expect, it } from "vitest";
import { buildFranchises, mergingEdges, nextHops } from "./franchises.js";
import { ANILIST_RELATION_TYPES } from "./limits.js";
import type { Edge } from "./validate.js";

type RelationType = Edge["relationType"];
const edge = (fromId: number, relationType: RelationType, toId: number): Edge => ({
  fromId,
  toId,
  relationType,
});
const entries = (...ids: number[]) => ids.map((id, index) => ({ id, popularityRank: index + 1 }));
const groupsOf = (result: ReturnType<typeof buildFranchises>) =>
  result.franchises.map((franchise) => [franchise.id, [...franchise.entryIds].sort((a, b) => a - b)]);

describe("buildFranchises (collection-packs.md §5.1.2)", () => {
  it.each(["SEQUEL", "PREQUEL", "SIDE_STORY", "PARENT"] as const)(
    "merges two entries joined by %s, in either direction",
    (type) => {
      expect(groupsOf(buildFranchises(entries(10, 20), [edge(10, type, 20)]))).toEqual([[10, [10, 20]]]);
      expect(groupsOf(buildFranchises(entries(10, 20), [edge(20, type, 10)]))).toEqual([[10, [10, 20]]]);
    },
  );

  it.each(
    ANILIST_RELATION_TYPES.filter((type) => !["SEQUEL", "PREQUEL", "SIDE_STORY", "PARENT"].includes(type)),
  )("does not merge through %s", (type) => {
    expect(groupsOf(buildFranchises(entries(10, 20), [edge(10, type, 20)]))).toEqual([
      [10, [10]],
      [20, [20]],
    ]);
  });

  it("merges through one and through two entries outside the top 100, not through three", () => {
    const one = buildFranchises(entries(10, 20), [edge(10, "SEQUEL", 500), edge(500, "SEQUEL", 20)]);
    expect(groupsOf(one)).toEqual([[10, [10, 20]]]);

    const two = buildFranchises(entries(10, 20), [
      edge(10, "SEQUEL", 500),
      edge(501, "PREQUEL", 500),
      edge(501, "SEQUEL", 20),
    ]);
    expect(groupsOf(two)).toEqual([[10, [10, 20]]]);

    const three = buildFranchises(entries(10, 20), [
      edge(10, "SEQUEL", 500),
      edge(500, "SEQUEL", 501),
      edge(501, "SEQUEL", 502),
      edge(502, "SEQUEL", 20),
    ]);
    expect(groupsOf(three)).toEqual([
      [10, [10]],
      [20, [20]],
    ]);
  });

  it("chains merges transitively through top entries, each hop budget counted between two of them", () => {
    const result = buildFranchises(entries(10, 20, 30), [
      edge(10, "SEQUEL", 500),
      edge(500, "SEQUEL", 501),
      edge(501, "SEQUEL", 20),
      edge(20, "SEQUEL", 600),
      edge(600, "SEQUEL", 601),
      edge(601, "SEQUEL", 30),
    ]);
    expect(groupsOf(result)).toEqual([[10, [10, 20, 30]]]);
  });

  it("names a franchise by its smallest member id and ranks it by its best entry", () => {
    const result = buildFranchises(
      [
        { id: 300, popularityRank: 1 },
        { id: 100, popularityRank: 7 },
        { id: 200, popularityRank: 3 },
      ],
      [edge(300, "PREQUEL", 200), edge(200, "PREQUEL", 100)],
    );
    expect(result.franchises).toEqual([{ id: 100, popularityRank: 1, entryIds: [300, 100, 200] }]);
    expect(Object.fromEntries(result.franchiseOf)).toEqual({ 100: 100, 200: 100, 300: 100 });
  });

  it("makes an entry with no merging relation a franchise of one", () => {
    expect(groupsOf(buildFranchises(entries(10), []))).toEqual([[10, [10]]]);
  });

  it("builds a finite franchise from a relation cycle and ignores a relation from an entry to itself", () => {
    const result = buildFranchises(entries(10, 20, 30), [
      edge(10, "SEQUEL", 20),
      edge(20, "SEQUEL", 30),
      edge(30, "SEQUEL", 10),
      edge(10, "SEQUEL", 10),
      edge(20, "SEQUEL", 700),
      edge(700, "SEQUEL", 701),
      edge(701, "SEQUEL", 700),
    ]);
    expect(groupsOf(result)).toEqual([[10, [10, 20, 30]]]);
  });

  it("orders franchises by popularity rank", () => {
    const result = buildFranchises(
      [
        { id: 5, popularityRank: 3 },
        { id: 9, popularityRank: 1 },
        { id: 7, popularityRank: 2 },
      ],
      [],
    );
    expect(result.franchises.map((franchise) => franchise.id)).toEqual([9, 7, 5]);
  });
});

describe("mergingEdges", () => {
  it("keeps merging relations only, each once, in a stable order", () => {
    expect(
      mergingEdges([
        edge(20, "SEQUEL", 10),
        edge(10, "SPIN_OFF", 30),
        edge(10, "PREQUEL", 20),
        edge(20, "SEQUEL", 10),
      ]),
    ).toEqual([edge(10, "PREQUEL", 20), edge(20, "SEQUEL", 10)]);
  });
});

describe("nextHops", () => {
  it("lists the outside ids merging edges from the sources reach, ascending, skipping top entries and ids already read", () => {
    const edges = [
      edge(10, "SEQUEL", 503),
      edge(10, "SEQUEL", 501),
      edge(10, "SPIN_OFF", 900),
      edge(10, "SEQUEL", 20),
      edge(20, "PREQUEL", 502),
      edge(501, "SEQUEL", 777),
    ];
    const top = new Set([10, 20]);
    expect(nextHops(edges, top, top, new Set([502]))).toEqual([501, 503]);
    expect(nextHops(edges, new Set([501, 503]), top, new Set([501, 502, 503]))).toEqual([777]);
  });
});
