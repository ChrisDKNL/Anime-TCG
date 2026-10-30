import { describe, expect, it } from "vitest";
import { normaliseSearchText, searchTermsOf } from "../src/search.js";

/** collection-overview.md §3.3's match rule, the one the market's search stores and queries in (economy.md §8.4). */
describe("the search normalisation", () => {
  it("folds full-width letters, case and Latin accents, and collapses whitespace", () => {
    expect(normaliseSearchText("  ＬＵＦＦＹ   Pokémon\t ")).toBe("luffy pokemon");
    expect(normaliseSearchText("Spike  Spiegel")).toBe("spike spiegel");
  });

  it("keeps kana voiced marks, CJK, punctuation and zero-width characters", () => {
    expect(normaliseSearchText("が")).not.toBe(normaliseSearchText("か"));
    expect(normaliseSearchText("進撃の巨人")).toBe("進撃の巨人");
    expect(normaliseSearchText("Monkey D. Luffy")).toBe("monkey d. luffy");
    const zeroWidth = `a${String.fromCodePoint(0x200b)}b`;
    expect(normaliseSearchText(zeroWidth)).toBe(zeroWidth);
  });

  it("treats U+FEFF as whitespace in the trim and the collapse", () => {
    const bom = String.fromCodePoint(0xfeff);
    expect(normaliseSearchText(`${bom}a${bom}${bom}b${bom}`)).toBe("a b");
  });

  it("splits a query into terms, and an empty one into none", () => {
    expect(searchTermsOf("bebop  spike")).toEqual(["bebop", "spike"]);
    expect(searchTermsOf("   ")).toEqual([]);
  });
});
