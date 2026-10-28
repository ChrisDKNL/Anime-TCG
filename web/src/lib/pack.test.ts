import { describe, expect, it } from "vitest";
import { makeCharacters } from "../test/fixtures";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { openPack, PACK_SIZE, sampleDistinct } from "./pack";

describe("sampleDistinct", () => {
  it("returns `count` distinct items without mutating the input", () => {
    const pool = [1, 2, 3, 4, 5, 6, 7, 8];
    const before = pool.slice();
    const picks = sampleDistinct(pool, 5);
    expect(picks).toHaveLength(5);
    expect(new Set(picks).size).toBe(5);
    for (const p of picks) expect(pool).toContain(p);
    expect(pool).toEqual(before);
  });

  it("caps at the pool size when asked for more than available", () => {
    expect(sampleDistinct([1, 2, 3], 10)).toHaveLength(3);
    expect(sampleDistinct([], 5)).toEqual([]);
  });
});

describe("openPack", () => {
  const pool = makeCharacters(30);

  it("opens a pack of 5 distinct characters with unique uids and valid rarities", () => {
    const cards = openPack(pool);
    expect(cards).toHaveLength(PACK_SIZE);
    expect(new Set(cards.map((c) => c.characterId)).size).toBe(PACK_SIZE);
    expect(new Set(cards.map((c) => c.uid)).size).toBe(PACK_SIZE);
    for (const c of cards) {
      expect(RARITIES).toContain(c.rarity);
      const source = pool.find((p) => p.id === c.characterId)!;
      expect(c.name).toBe(source.name);
      expect(c.animeTitle).toBe(source.animeTitle);
      expect(c.imageUrl).toBe(source.imageUrl);
    }
  });

  it("stamps every card in the pack with the same pulledAt", () => {
    const cards = openPack(pool);
    expect(new Set(cards.map((c) => c.pulledAt)).size).toBe(1);
  });

  it("respects a custom pack size", () => {
    expect(openPack(pool, 3)).toHaveLength(3);
  });
});
