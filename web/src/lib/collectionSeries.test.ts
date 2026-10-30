import type { CollectionResponse } from "@anime-tcg/shared/api";
import { describe, expect, it } from "vitest";
import { makeCharacter, makeCollection, makeEntry, makeFranchise } from "../test/fixtures";
import { completionPercent, completionsOf, seriesNames, seriesOptions, seriesRows } from "./collectionSeries";
import { indexCollection } from "./collectionView";

function answer(): CollectionResponse {
  const data = makeCollection([
    makeEntry(makeCharacter(1, { franchiseIds: [30, 10] })),
    makeEntry(makeCharacter(2, { franchiseIds: [20] })),
    // A franchise the current snapshot no longer has (no completion row).
    makeEntry(makeCharacter(3, { franchiseIds: [40], inCurrentSnapshot: false, tier: null, rank: null })),
  ]);
  data.franchises = [
    makeFranchise(10, { title: "Hunter x Hunter", startYear: 2011 }),
    makeFranchise(20, { title: "Cowboy Bebop", startYear: 1998 }),
    makeFranchise(30, { title: "Hunter x Hunter", startYear: 1999 }),
    makeFranchise(40, { title: "Akira", startYear: 1988 }),
    makeFranchise(50, { title: "Bleach", startYear: 2004 }),
    makeFranchise(60, { title: "Zatch Bell", startYear: null }),
    makeFranchise(70, { title: "Zatch Bell", startYear: 2003 }),
  ];
  data.completion.franchises = [
    { franchiseId: 50, owned: 0, total: 12 },
    { franchiseId: 30, owned: 1, total: 9 },
    { franchiseId: 20, owned: 1, total: 4 },
    { franchiseId: 10, owned: 1, total: 9 },
    { franchiseId: 999, owned: 0, total: 3 },
  ];
  return data;
}

describe("seriesNames", () => {
  it("adds the start year only where a title is shared and the server gives one", () => {
    const names = seriesNames(answer());
    expect(names.get(10)?.year).toBe(2011);
    expect(names.get(30)?.year).toBe(1999);
    expect(names.get(20)?.year).toBeNull();
    expect(names.get(60)?.year).toBeNull();
    expect(names.get(70)?.year).toBe(2003);
  });
});

describe("seriesOptions (collection-overview.md §3.3 Series)", () => {
  const data = answer();
  const index = indexCollection(data);
  const names = seriesNames(data);
  const completions = completionsOf(data);
  const options = (selected: number | null) =>
    seriesOptions(index, names, completions, selected).map(({ name, completion }) => [
      name.franchise.id,
      completion === null ? null : `${completion.owned}/${completion.total}`,
    ]);

  it("every franchise a held entry names, by title then year, with its completion when it has one", () => {
    expect(options(null)).toEqual([
      [40, null],
      [20, "1/4"],
      [30, "1/9"],
      [10, "1/9"],
    ]);
  });

  it("keeps the selected series while selected, even with nothing held of it", () => {
    expect(options(50).map(([id]) => id)).toEqual([40, 50, 20, 30, 10]);
  });

  it("leaves out ids the answer does not name", () => {
    expect(options(12_345).map(([id]) => id)).toEqual([40, 20, 30, 10]);
  });
});

describe("seriesRows (§3.2 step 5)", () => {
  const data = answer();
  const names = seriesNames(data);

  it("most popular first is the server's order, every row including 0-owned ones", () => {
    expect(seriesRows(data, names, "popular").map((row) => row.name.franchise.id)).toEqual([50, 30, 20, 10]);
  });

  it("by title, ties keeping the server's order", () => {
    expect(seriesRows(data, names, "title").map((row) => row.name.franchise.id)).toEqual([50, 20, 30, 10]);
  });
});

describe("completionPercent (§3.2 step 1)", () => {
  it("rounds down so 100% only shows when it is true", () => {
    expect(completionPercent(412, 2_983)).toBe(13);
    expect(completionPercent(2_982, 2_983)).toBe(99);
    expect(completionPercent(2_983, 2_983)).toBe(100);
    expect(completionPercent(0, 12)).toBe(0);
    expect(completionPercent(0, 0)).toBe(0);
  });
});
