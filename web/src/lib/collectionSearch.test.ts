import { describe, expect, it } from "vitest";
import { matchesTerms, normalise, searchTerms } from "./collectionSearch";

describe("normalise (collection-overview.md §3.3 step 1)", () => {
  it("folds full-width letters, case and Latin accents", () => {
    expect(normalise("ＬＵＦＦＹ")).toBe("luffy");
    expect(normalise("Pokémon")).toBe("pokemon");
    expect(normalise("ÅNGSTRÖM Çà")).toBe("angstrom ca");
  });

  it("keeps the kana voiced marks, so か does not become が or the reverse", () => {
    expect(normalise("が")).toBe("が");
    expect(normalise("か")).not.toBe(normalise("が"));
    expect(normalise("パ")).toBe("パ");
  });

  it("trims and collapses whitespace runs, tabs and ideographic spaces included", () => {
    expect(normalise("  Spike \t\n Spiegel  ")).toBe("spike spiegel");
    expect(normalise("進撃　の巨人")).toBe("進撃 の巨人");
  });

  it("keeps punctuation", () => {
    expect(normalise("Monkey D. Luffy")).toBe("monkey d. luffy");
  });

  it("keeps the zero-width characters, so a name with one matches only a query with it (manager decision, 2026-10-30)", () => {
    for (const mark of ["​", "‌", "‍", "⁠"]) {
      expect(normalise(`Zero${mark}Width`)).toBe(`zero${mark}width`);
      expect(matchesTerms([normalise(`Zero${mark}Width`)], searchTerms("zerowidth"))).toBe(false);
      expect(matchesTerms([normalise(`Zero${mark}Width`)], searchTerms(`zero${mark}width`))).toBe(true);
    }
    // U+FEFF is whitespace to the trim and the collapse.
    expect(normalise("Zero﻿Width﻿")).toBe("zero width");
  });
});

describe("searchTerms (§3.3 step 2)", () => {
  it("splits the normalised query on spaces", () => {
    expect(searchTerms("  Bebop   SPIKE ")).toEqual(["bebop", "spike"]);
  });

  it("an empty or blank query has no terms", () => {
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("   ")).toEqual([]);
  });
});

describe("matchesTerms (§3.3 step 3 and the examples table)", () => {
  const luffy = ["monkey d. luffy", normalise("モンキー・D・ルフィ"), "one piece", "ワンピース"];
  const spike = ["spike spiegel", "cowboy bebop"];
  const eren = ["eren yeager", "attack on titan", normalise("進撃の巨人")];
  const pikachu = ["pikachu", normalise("Pokémon")];

  it.each([
    ["spike", spike, true],
    ["bebop spike", spike, true],
    ["titan", eren, true],
    ["pokemon", pikachu, true],
    ["ＬＵＦＦＹ", luffy, true],
    ["進撃", eren, true],
    ["ルフィ", luffy, true],
    ["luffy zoro", luffy, false],
    ["d luffy", luffy, true],
    ["d.luffy", luffy, false],
    // Step 4's third example, beside the table's two.
    ["d. luffy", luffy, true],
  ])("%s", (query, fields, expected) => {
    expect(matchesTerms(fields, searchTerms(query))).toBe(expected);
  });

  it("no terms match everything", () => {
    expect(matchesTerms(spike, [])).toBe(true);
    expect(matchesTerms([], [])).toBe(true);
  });
});
