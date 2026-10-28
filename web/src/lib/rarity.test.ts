import { describe, expect, it } from "vitest";
import { BASE_WEIGHTS, POPULARITY_INFLUENCE, RARITIES } from "@anime-tcg/shared/rarity";
import { makeCharacters } from "../test/fixtures";
import { popularityScore, rarityWeights, rollRarity } from "./rarity";

describe("BASE_WEIGHTS", () => {
  it("sums to 1 and matches the advertised 70/25/5 odds", () => {
    expect(BASE_WEIGHTS.common).toBe(0.7);
    expect(BASE_WEIGHTS.rare).toBe(0.25);
    expect(BASE_WEIGHTS.legendary).toBe(0.05);
    expect(BASE_WEIGHTS.common + BASE_WEIGHTS.rare + BASE_WEIGHTS.legendary).toBeCloseTo(1, 10);
  });
});

describe("rarityWeights", () => {
  it("returns base odds for zero popularity", () => {
    expect(rarityWeights(0)).toEqual(BASE_WEIGHTS);
  });

  it("raises legendary and rare odds for max popularity, keeping the total at 1", () => {
    const w = rarityWeights(1);
    expect(w.legendary).toBeCloseTo(0.05 + 0.1 * POPULARITY_INFLUENCE, 10);
    expect(w.rare).toBeCloseTo(0.25 + 0.1 * POPULARITY_INFLUENCE, 10);
    expect(w.common + w.rare + w.legendary).toBeCloseTo(1, 10);
  });

  it("clamps popularity outside 0..1 and never yields a negative weight", () => {
    for (const p of [-5, 0, 0.5, 1, 99]) {
      const w = rarityWeights(p);
      for (const tier of RARITIES) expect(w[tier]).toBeGreaterThanOrEqual(0);
      expect(w.common + w.rare + w.legendary).toBeCloseTo(1, 10);
    }
    expect(rarityWeights(99)).toEqual(rarityWeights(1));
    expect(rarityWeights(-1)).toEqual(rarityWeights(0));
  });
});

describe("rollRarity", () => {
  const w = BASE_WEIGHTS;
  it("maps the roll onto legendary → rare → common bands", () => {
    expect(rollRarity(w, 0)).toBe("legendary");
    expect(rollRarity(w, 0.0499)).toBe("legendary");
    expect(rollRarity(w, 0.05)).toBe("rare");
    expect(rollRarity(w, 0.2999)).toBe("rare");
    expect(rollRarity(w, 0.3)).toBe("common");
    expect(rollRarity(w, 0.9999)).toBe("common");
  });

  it("uses Math.random by default and always returns a valid tier", () => {
    for (let i = 0; i < 200; i++) expect(RARITIES).toContain(rollRarity(w));
  });
});

describe("popularityScore", () => {
  const pool = makeCharacters(20);

  it("gives 1 to the most and 0 to the least popular character", () => {
    expect(popularityScore(pool[0]!, pool)).toBe(1);
    expect(popularityScore(pool[pool.length - 1]!, pool)).toBe(0);
  });

  it("is monotonic in favourites", () => {
    const scores = pool.map((c) => popularityScore(c, pool));
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
  });

  it("returns 0.5 when every character has the same favourites, and 0 for an empty pool", () => {
    const flat = makeCharacters(3).map((c) => ({ ...c, favourites: 10 }));
    expect(popularityScore(flat[0]!, flat)).toBe(0.5);
    expect(popularityScore(flat[0]!, [])).toBe(0);
  });
});
