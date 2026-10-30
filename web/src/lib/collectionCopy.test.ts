import { describe, expect, it } from "vitest";
import { FORBIDDEN_WORDS, walkCopy } from "../test/copyWords";
import * as copy from "./collectionCopy";
import {
  clip,
  dialogCopy,
  pageCopy,
  resultsCopy,
  seriesTitle,
  seriesViewCopy,
  statsCopy,
  tileCopy,
  toolbarCopy,
  viewCopy,
} from "./collectionCopy";

const RTL = "\u202Eevil\u202C";

/** Every function of the module, called with the arguments the page gives it. */
const CALLS: Record<string, string[]> = {
  clip: [clip("Fullmetal Alchemist", 9)],
  seriesTitle: [seriesTitle("Hunter x Hunter", 2011), seriesTitle("Bleach", null)],
  "statsCopy.completion": [statsCopy.completion(412, 2_983)],
  "statsCopy.percent": [statsCopy.percent(13)],
  "statsCopy.series": [statsCopy.series("Cowboy Bebop", 3, 4)],
  "statsCopy.totals": [statsCopy.totals(214, 153), statsCopy.totals(1, 0)],
  "statsCopy.duplicates": [0, 1, 2].map(statsCopy.duplicates),
  "statsCopy.stale": [statsCopy.stale(new Date(2026, 9, 29, 9, 5))],
  "seriesViewCopy.sort": [seriesViewCopy.sort("popular"), seriesViewCopy.sort("title")],
  "seriesViewCopy.figure": [seriesViewCopy.figure(0, 12)],
  "seriesViewCopy.showCardsName": [seriesViewCopy.showCardsName("Cowboy Bebop")],
  "seriesViewCopy.source": [seriesViewCopy.source(87, "2026-10-29T08:00:00.000Z")],
  "toolbarCopy.rarity": [toolbarCopy.rarity("mythic")],
  "toolbarCopy.seriesOption": [
    toolbarCopy.seriesOption("Cowboy Bebop", null, { owned: 3, total: 4 }),
    toolbarCopy.seriesOption("Cowboy Bebop", null, null),
  ],
  "toolbarCopy.sort": (["rarity", "name", "newest", "copies"] as const).map(toolbarCopy.sort),
  "resultsCopy.line": [resultsCopy.line(1, 1, 1), resultsCopy.line(2_014, 2, 34)],
  "resultsCopy.of": [resultsCopy.of(34)],
  "resultsCopy.noMatchQuery": [resultsCopy.noMatchQuery("zoro")],
  "tileCopy.copies": [tileCopy.copies(1), tileCopy.copies(3)],
  "tileCopy.label": [tileCopy.label("Spike", "epic", "Cowboy Bebop", 3)],
  "tileCopy.count": [tileCopy.count(3)],
  "dialogCopy.more": [dialogCopy.more(4)],
  "dialogCopy.date": [dialogCopy.date("2026-10-29T09:00:00.000Z")],
  "dialogCopy.tierMoved": [dialogCopy.tierMoved("Spike", "legendary")],
};

const { strings, functions } = walkCopy(copy);
const rendered = [...strings, ...Object.values(CALLS).flat()];

describe("collection overview copy words (collection-overview.md §8)", () => {
  it("renders every string of the module and calls every function in it", () => {
    expect(functions.sort()).toEqual(Object.keys(CALLS).sort());
    expect(strings.length).toBeGreaterThan(30);
  });

  it("contains none of the words §8 forbids, and no money or casino words", () => {
    expect(rendered.filter((text) => FORBIDDEN_WORDS.some((word) => word.test(text)))).toEqual([]);
  });
});

describe("page, stats and view copy", () => {
  it("is §8's exact text", () => {
    expect(pageCopy).toEqual({
      loading: "Loading your collection…",
      filters: "Collection filters",
      empty: "No cards yet",
      openAPack: "Open a pack",
      error: "Couldn't load your collection.",
      tryAgain: "Try again",
    });
    expect(viewCopy).toEqual({ group: "View", cards: "Cards", series: "Series" });
  });

  it("formats completion, totals and the stale time", () => {
    expect(statsCopy.completion(412, 2_983)).toBe("412 of 2,983 characters");
    expect(statsCopy.percent(13)).toBe("13%");
    expect(statsCopy.series("Cowboy Bebop", 3, 4)).toBe("Cowboy Bebop: 3 of 4 characters");
    expect(statsCopy.totals(214, 153)).toBe("214 cards · 153 duplicates");
    expect(statsCopy.totals(1, 1)).toBe("1 card · 1 duplicate");
    expect(statsCopy.totals(5, 0)).toBe("5 cards · No duplicates");
    expect(statsCopy.duplicates(1_204)).toBe("1,204 duplicates");
    expect(statsCopy.stale(new Date(2026, 9, 29, 9, 5))).toBe("Showing your collection as of 09:05.");
  });
});

describe("Series view copy", () => {
  it("names the rows, the sort and the source", () => {
    expect(seriesViewCopy.figure(0, 12)).toBe("0 of 12");
    expect(seriesViewCopy.figure(1_000, 1_000)).toBe("1,000 of 1,000");
    expect(seriesViewCopy.sort("popular")).toBe("Most popular first");
    expect(seriesViewCopy.sort("title")).toBe("Title, A to Z");
    expect(seriesViewCopy.showCardsName(RTL)).toBe(`Show cards from \u2068${RTL}\u2069`);
    expect(seriesViewCopy.source(87, "2026-10-29T08:00:00.000Z")).toBe(
      "87 series from the 100 most popular anime on AniList, as of 29 Oct 2026.",
    );
    expect(seriesTitle("Hunter x Hunter", 2011)).toBe("Hunter x Hunter, 2011");
    expect(seriesTitle("Bleach", null)).toBe("Bleach");
  });
});

describe("toolbar copy", () => {
  it("labels series options with their figure, isolated, and cuts long titles at 60 grapheme clusters", () => {
    expect(toolbarCopy.seriesOption("Cowboy Bebop", null, { owned: 3, total: 4 })).toBe(
      "\u2068Cowboy Bebop\u2069 · 3/4",
    );
    expect(toolbarCopy.seriesOption("Hunter x Hunter", 2011, { owned: 5, total: 9 })).toBe(
      "\u2068Hunter x Hunter, 2011\u2069 · 5/9",
    );
    expect(toolbarCopy.seriesOption("Cowboy Bebop", null, null)).toBe("\u2068Cowboy Bebop\u2069");
    const long = "a".repeat(200);
    expect(toolbarCopy.seriesOption(long, null, null)).toBe(`\u2068${"a".repeat(60)}…\u2069`);
  });

  it("clip counts grapheme clusters, so a stack of combining marks is one", () => {
    const stacked = `e${"\u0301".repeat(50)}`;
    expect(clip(stacked.repeat(3), 2)).toBe(`${stacked.repeat(2)}…`);
    expect(clip("短い", 60)).toBe("短い");
    expect(clip("👩‍👩‍👧‍👦👩‍👩‍👧‍👦", 1)).toBe("👩‍👩‍👧‍👦…");
  });

  it("has the sort options in §8's words", () => {
    expect((["rarity", "name", "newest", "copies"] as const).map(toolbarCopy.sort)).toEqual([
      "Rarity, rarest first",
      "Name, A to Z",
      "Newest first",
      "Most copies",
    ]);
  });
});

describe("results and tile copy", () => {
  it("writes the results line with the page only when there are pages", () => {
    expect(resultsCopy.line(0, 1, 1)).toBe("0 results");
    expect(resultsCopy.line(1, 1, 1)).toBe("1 result");
    expect(resultsCopy.line(60, 1, 1)).toBe("60 results");
    expect(resultsCopy.line(2_014, 2, 34)).toBe("2,014 results · page 2 of 34");
    expect(resultsCopy.of(34)).toBe("of 34");
    expect(resultsCopy.noMatchQuery("zoro")).toBe('No cards match "zoro".');
  });

  it("names the tile with the isolated name and series, the tier and the copies", () => {
    expect(tileCopy.label(RTL, "epic", "Cowboy Bebop", 3)).toBe(
      `\u2068${RTL}\u2069, Epic, \u2068Cowboy Bebop\u2069, 3 copies`,
    );
    expect(tileCopy.label("Spike", "common", null, 1)).toBe("\u2068Spike\u2069, Common, 1 copy");
    expect(tileCopy.count(1_204)).toBe("×1,204");
  });
});

describe("dialog copy", () => {
  it("is §8's exact text", () => {
    expect(dialogCopy.tierMoved("Spike", "legendary")).toBe("Packs now give Spike as Legendary.");
    expect(dialogCopy.outOfPool).toBe("No longer in packs. Doesn't count toward completion.");
    expect(dialogCopy.gone).toBe("You no longer have this card.");
    expect(dialogCopy.more(4)).toBe("and 4 more");
    expect(dialogCopy.date("2026-10-29T09:00:00.000Z")).toMatch(/^\d{1,2} (Oct|Nov) 2026$/);
    expect(dialogCopy.facts).toEqual({
      rarity: "Rarity",
      copies: "Copies",
      firstObtained: "First obtained",
      lastObtained: "Last obtained",
    });
  });
});
