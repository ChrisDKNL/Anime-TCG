import type { CollectionEntry, Rarity } from "@anime-tcg/shared/api";
import { describe, expect, it } from "vitest";
import { makeCharacter, makeCollection, makeEntry, makeFranchise } from "../test/fixtures";
import {
  clampPage,
  controlsReducer,
  DEFAULT_CONTROLS,
  entryKey,
  filterEntries,
  filtersActive,
  indexCollection,
  pageCount,
  pageOf,
  PAGE_SIZE,
  sortEntries,
  type CardSort,
  type ControlsAction,
  type OverviewControls,
} from "./collectionView";

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T09:00:00.000Z`;

function indexOf(entries: CollectionEntry[], franchises = [makeFranchise(100), makeFranchise(101)]) {
  const data = makeCollection(entries);
  data.franchises = franchises;
  return indexCollection(data);
}

const names = (list: ReturnType<typeof indexCollection>) =>
  list.map(({ entry }) => `${entry.character.name}/${entry.rarity}`);

const reduce = (actions: ControlsAction[], from: OverviewControls = DEFAULT_CONTROLS) =>
  actions.reduce(controlsReducer, from);

describe("controlsReducer (collection-overview.md §3.3)", () => {
  const onPage3 = { ...DEFAULT_CONTROLS, page: 3 };

  it.each<ControlsAction>([
    { type: "query", query: "spike" },
    { type: "toggleRarity", rarity: "epic" },
    { type: "allRarities" },
    { type: "series", series: 100 },
    { type: "duplicatesOnly", on: true },
    { type: "sort", sort: "name" },
    { type: "clearFilters" },
  ])("$type returns to page 1", (action) => {
    expect(controlsReducer(onPage3, action).page).toBe(1);
  });

  it("clampPage clamps the chosen page to the pages there are, and keeps the state when it fits", () => {
    expect(controlsReducer(onPage3, { type: "clampPage", pages: 2 })).toEqual({ ...onPage3, page: 2 });
    expect(controlsReducer(onPage3, { type: "clampPage", pages: 3 })).toBe(onPage3);
    expect(controlsReducer(onPage3, { type: "clampPage", pages: 34 })).toBe(onPage3);
  });

  it("paging, the view switch and the Series view's sort keep the page", () => {
    expect(controlsReducer(onPage3, { type: "page", page: 4 }).page).toBe(4);
    expect(controlsReducer(onPage3, { type: "tab", tab: "series" })).toMatchObject({
      tab: "series",
      page: 3,
    });
    expect(controlsReducer(onPage3, { type: "seriesSort", sort: "title" })).toMatchObject({
      seriesSort: "title",
      page: 3,
    });
  });

  it("chips: several tiers at once; releasing the last presses All; All releases every tier", () => {
    const two = reduce([
      { type: "toggleRarity", rarity: "epic" },
      { type: "toggleRarity", rarity: "common" },
    ]);
    expect(two.rarities).toEqual(["epic", "common"]);
    expect(reduce([{ type: "toggleRarity", rarity: "epic" }], two).rarities).toEqual(["common"]);
    expect(
      reduce(
        [
          { type: "toggleRarity", rarity: "epic" },
          { type: "toggleRarity", rarity: "common" },
        ],
        two,
      ).rarities,
    ).toEqual([]);
    expect(reduce([{ type: "allRarities" }], two).rarities).toEqual([]);
  });

  it("Clear filters resets the search and every filter, not the sort", () => {
    const busy: OverviewControls = {
      ...DEFAULT_CONTROLS,
      query: "x",
      rarities: ["rare"],
      series: 100,
      duplicatesOnly: true,
      sort: "copies",
      page: 2,
    };
    expect(controlsReducer(busy, { type: "clearFilters" })).toEqual({ ...DEFAULT_CONTROLS, sort: "copies" });
  });

  it("Show cards: the Cards view with that series alone, the sort kept, page 1 (§3.2 step 5)", () => {
    const busy: OverviewControls = {
      ...DEFAULT_CONTROLS,
      tab: "series",
      query: "x",
      rarities: ["rare"],
      series: 7,
      duplicatesOnly: true,
      sort: "newest",
      seriesSort: "title",
      page: 2,
    };
    expect(controlsReducer(busy, { type: "showSeries", series: 101 })).toEqual({
      ...DEFAULT_CONTROLS,
      series: 101,
      sort: "newest",
      seriesSort: "title",
    });
  });
});

describe("filtersActive", () => {
  it("is false at the defaults and for a blank search, true for any filter", () => {
    expect(filtersActive(DEFAULT_CONTROLS)).toBe(false);
    expect(filtersActive({ ...DEFAULT_CONTROLS, query: "   " })).toBe(false);
    expect(filtersActive({ ...DEFAULT_CONTROLS, sort: "name" })).toBe(false);
    expect(filtersActive({ ...DEFAULT_CONTROLS, query: "a" })).toBe(true);
    expect(filtersActive({ ...DEFAULT_CONTROLS, rarities: ["mythic"] })).toBe(true);
    expect(filtersActive({ ...DEFAULT_CONTROLS, series: 1 })).toBe(true);
    expect(filtersActive({ ...DEFAULT_CONTROLS, duplicatesOnly: true })).toBe(true);
  });
});

describe("indexCollection (§3.3 step 5)", () => {
  it("resolves franchises primary first, names the primary series and normalises every searched field", () => {
    const character = makeCharacter(1, {
      name: "Éren Yeager",
      nameNative: "エレン",
      franchiseIds: [101, 999, 100],
    });
    const [indexed] = indexOf(
      [makeEntry(character)],
      [
        makeFranchise(100, { title: "Other" }),
        makeFranchise(101, { title: "Attack on Titan", titleNative: "進撃" }),
      ],
    );
    expect(indexed?.key).toBe("1:common:standard");
    expect(indexed?.series).toBe("Attack on Titan");
    expect(indexed?.franchises.map((f) => f.id)).toEqual([101, 100]);
    expect(indexed?.searchFields).toEqual(["eren yeager", "エレン", "attack on titan", "進撃", "other"]);
  });

  it("has no series when the answer does not name the primary franchise", () => {
    const [indexed] = indexOf([makeEntry(makeCharacter(1, { franchiseIds: [5] }))]);
    expect(indexed?.series).toBeNull();
    expect(indexed?.franchises).toEqual([]);
  });

  it("keys an entry by character, rarity and variant", () => {
    expect(entryKey(makeEntry(makeCharacter(7), { rarity: "mythic" }))).toBe("7:mythic:standard");
  });
});

describe("sortEntries (§3.3 Sort)", () => {
  const franchises = [makeFranchise(100, { title: "Beta" }), makeFranchise(101, { title: "Alpha" })];
  const entry = (
    id: number,
    name: string,
    rarity: Rarity,
    extra: Partial<CollectionEntry> & { franchise?: number } = {},
  ) =>
    makeEntry(makeCharacter(id, { name, franchiseIds: [extra.franchise ?? 100] }), {
      rarity,
      ...extra,
    });

  const sorted = (entries: CollectionEntry[], sort: CardSort) =>
    names(sortEntries(indexOf(entries, franchises), sort));

  it("rarity: rarest first, then name, then series, then id, then rarity", () => {
    expect(
      sorted(
        [
          entry(1, "b", "common"),
          entry(2, "a", "common"),
          entry(3, "z", "mythic"),
          entry(5, "a", "common", { franchise: 101 }),
          entry(4, "a", "common", { franchise: 101 }),
        ],
        "rarity",
      ),
    ).toEqual(["z/mythic", "a/common", "a/common", "a/common", "b/common"]);
    const ids = sortEntries(
      indexOf(
        [
          entry(2, "a", "common"),
          entry(5, "a", "common", { franchise: 101 }),
          entry(4, "a", "common", { franchise: 101 }),
        ],
        franchises,
      ),
      "rarity",
    ).map(({ entry: e }) => e.character.id);
    // Alpha before Beta, then the id.
    expect(ids).toEqual([4, 5, 2]);
  });

  it("name: A to Z with numbers in order and case and accents ignored, then rarest first", () => {
    expect(
      sorted(
        [
          entry(1, "Item 10", "common"),
          entry(2, "item 9", "common"),
          entry(3, "Émile", "rare"),
          entry(4, "emile", "epic"),
        ],
        "name",
      ),
    ).toEqual(["emile/epic", "Émile/rare", "item 9/common", "Item 10/common"]);
  });

  it("newest: last obtained first, then rarest, then name", () => {
    expect(
      sorted(
        [
          entry(1, "old", "mythic", { lastObtainedAt: at(1) }),
          entry(2, "b", "common", { lastObtainedAt: at(9) }),
          entry(3, "a", "common", { lastObtainedAt: at(9) }),
          entry(4, "c", "rare", { lastObtainedAt: at(9) }),
        ],
        "newest",
      ),
    ).toEqual(["c/rare", "a/common", "b/common", "old/mythic"]);
  });

  it("most copies: highest count first, then rarest, then name", () => {
    expect(
      sorted(
        [
          entry(1, "one", "mythic"),
          entry(2, "b", "common", { count: 4 }),
          entry(3, "a", "common", { count: 4 }),
          entry(4, "c", "epic", { count: 4 }),
        ],
        "copies",
      ),
    ).toEqual(["c/epic", "a/common", "b/common", "one/mythic"]);
  });

  it("a character held at two rarities: the rarer entry first wherever everything else ties", () => {
    const twice = [entry(1, "same", "rare"), entry(1, "same", "legendary")];
    for (const sort of ["name", "newest", "copies"] as const) {
      expect(sorted(twice, sort)).toEqual(["same/legendary", "same/rare"]);
    }
  });

  it("does not reorder its input", () => {
    const index = indexOf([entry(1, "b", "common"), entry(2, "a", "common")], franchises);
    sortEntries(index, "name");
    expect(names(index)).toEqual(["b/common", "a/common"]);
  });
});

describe("filterEntries (§3.3 Filters)", () => {
  const franchises = [
    makeFranchise(100, { title: "Cowboy Bebop" }),
    makeFranchise(101, { title: "Pokémon", titleNative: "ポケットモンスター" }),
  ];
  const index = indexOf(
    [
      makeEntry(makeCharacter(1, { name: "Spike Spiegel", franchiseIds: [100] }), {
        rarity: "epic",
        count: 2,
      }),
      makeEntry(makeCharacter(2, { name: "Pikachu", franchiseIds: [101, 100] }), { rarity: "common" }),
      makeEntry(makeCharacter(3, { name: "Ash", franchiseIds: [101] }), { rarity: "rare", count: 3 }),
    ],
    franchises,
  );
  const filtered = (controls: Partial<OverviewControls>) =>
    filterEntries(index, { ...DEFAULT_CONTROLS, ...controls }).map(({ entry }) => entry.character.name);

  it("nothing set shows everything in the order given", () => {
    expect(filtered({})).toEqual(["Spike Spiegel", "Pikachu", "Ash"]);
  });

  it("rarity: an entry of any pressed tier", () => {
    expect(filtered({ rarities: ["epic", "rare"] })).toEqual(["Spike Spiegel", "Ash"]);
  });

  it("series: any of the entry's franchises, not only the primary one", () => {
    expect(filtered({ series: 100 })).toEqual(["Spike Spiegel", "Pikachu"]);
  });

  it("duplicates only: two or more copies", () => {
    expect(filtered({ duplicatesOnly: true })).toEqual(["Spike Spiegel", "Ash"]);
  });

  it("search over names and every franchise's titles, native ones included", () => {
    expect(filtered({ query: "pokemon" })).toEqual(["Pikachu", "Ash"]);
    expect(filtered({ query: "ポケット" })).toEqual(["Pikachu", "Ash"]);
    expect(filtered({ query: "bebop pika" })).toEqual(["Pikachu"]);
  });

  it("combines everything with AND", () => {
    expect(filtered({ query: "pokemon", rarities: ["rare"], duplicatesOnly: true, series: 101 })).toEqual([
      "Ash",
    ]);
    expect(filtered({ query: "spike", series: 101 })).toEqual([]);
  });
});

describe("pages (§3.3, §5.5)", () => {
  it("60 per page, at least one page", () => {
    expect(PAGE_SIZE).toBe(60);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(60)).toBe(1);
    expect(pageCount(61)).toBe(2);
    expect(pageCount(2_014)).toBe(34);
  });

  it("clamps a page that no longer exists", () => {
    expect(clampPage(5, 3)).toBe(3);
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(2, 3)).toBe(2);
  });

  it("slices one page", () => {
    const items = Array.from({ length: 130 }, (_, i) => i);
    expect(pageOf(items, 1)).toHaveLength(60);
    expect(pageOf(items, 3)).toEqual([120, 121, 122, 123, 124, 125, 126, 127, 128, 129]);
  });
});
