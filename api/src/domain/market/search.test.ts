import { MARKET_SEARCH_TERMS } from "@anime-tcg/shared/economy";
import { searchTermsOf } from "@anime-tcg/shared/search";
import { describe, expect, it } from "vitest";
import { containsPattern, LIKE_ESCAPE, searchPatterns } from "./search.js";

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu;
const literal = (text: string) => text.replace(REGEX_SPECIAL, "\\$&");

/** What SQL's LIKE does with a pattern and its escape character, written out so the escaping is tested without a database. */
function like(text: string, pattern: string): boolean {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] ?? "";
    if (char === LIKE_ESCAPE) {
      i += 1;
      source += literal(pattern[i] ?? "");
    } else if (char === "%") source += ".*";
    else if (char === "_") source += ".";
    else source += literal(char);
  }
  return new RegExp(`^${source}$`, "su").test(text);
}

describe("the market search's patterns (economy.md §8.4, §14)", () => {
  it("escapes %, _ and the escape character, so each matches only itself", () => {
    expect(LIKE_ESCAPE).toBe("\\");
    expect(containsPattern("50%")).toBe("%50\\%%");
    expect(containsPattern("a_b")).toBe("%a\\_b%");
    expect(containsPattern("c:\\x")).toBe("%c:\\\\x%");
    expect(like("half 50% off", containsPattern("50%"))).toBe(true);
    expect(like("half 50 off", containsPattern("50%"))).toBe(false);
    expect(like("a_b", containsPattern("a_b"))).toBe(true);
    expect(like("axb", containsPattern("a_b"))).toBe(false);
    expect(like("c:\\x", containsPattern("c:\\x"))).toBe(true);
    expect(like("c:x", containsPattern("c:\\x"))).toBe(false);
    expect(like("anything", containsPattern("%"))).toBe(false);
    expect(like("x", containsPattern("_"))).toBe(false);
  });

  it("keeps SQL and markup as plain text in the pattern: it is a bound parameter, never spliced", () => {
    expect(containsPattern("'; drop table")).toBe("%'; drop table%");
    expect(containsPattern("<script>")).toBe("%<script>%");
  });

  it("normalises the query as the collection does and splits it into terms; an empty one is no search", () => {
    expect(searchPatterns(undefined)).toEqual([]);
    expect(searchPatterns("   ")).toEqual([]);
    expect(searchPatterns("  ＬＵＦＦＹ   Pokémon ")).toEqual(["%luffy%", "%pokemon%"]);
    expect(searchPatterns("進撃")).toEqual(["%進撃%"]);
    expect(searchPatterns("d.luffy")).toEqual(["%d.luffy%"]);
  });

  it(`matches at most MARKET_SEARCH_TERMS distinct terms and drops the rest (manager decision, 2026-10-30)`, () => {
    // U+FDFA is one character that NFKC spells as four words: 100 of them, the longest q, are 301 terms.
    const ligatures = String.fromCodePoint(0xfdfa).repeat(100);
    expect([...ligatures]).toHaveLength(100);
    const terms = searchTermsOf(ligatures);
    expect(terms).toHaveLength(301);
    const patterns = searchPatterns(ligatures);
    expect(patterns.length).toBeLessThanOrEqual(MARKET_SEARCH_TERMS);
    expect(patterns).toEqual([...new Set(terms)].slice(0, MARKET_SEARCH_TERMS).map(containsPattern));
    // Spaced apart, the ligatures repeat the same four words, matched once each.
    expect(searchPatterns(`${String.fromCodePoint(0xfdfa)} `.repeat(50))).toHaveLength(4);
    const words = Array.from({ length: 30 }, (_, index) => `w${index}`).join(" ");
    expect(searchPatterns(words)).toEqual(
      Array.from({ length: MARKET_SEARCH_TERMS }, (_, index) => `%w${index}%`),
    );
    expect(searchPatterns("a a a b")).toEqual(["%a%", "%b%"]);
  });

  it("keeps an RTL override as text of its own, and strips a pile of Latin combining marks as the collection does", () => {
    const rtl = "\u202Eevil";
    expect(searchPatterns(rtl)).toEqual([`%${rtl}%`]);
    expect(searchPatterns(`a${"\u0301".repeat(100)}`)).toEqual(["%a%"]);
  });
});
