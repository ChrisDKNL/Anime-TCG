import { describe, expect, it } from "vitest";
import { totalsOf } from "./service.js";

describe("totalsOf", () => {
  it("counts cards, duplicates beyond the first of each entry, and cards per granted rarity", () => {
    expect(
      totalsOf([
        { rarity: "common", count: 3 },
        { rarity: "common", count: 1 },
        { rarity: "epic", count: 2 },
        { rarity: "mythic", count: 1 },
      ]),
    ).toEqual({
      cards: 7,
      duplicates: 3,
      byRarity: { common: 4, rare: 0, epic: 2, legendary: 0, mythic: 1 },
    });
  });

  it("is all zeros, all five tiers present, for an empty collection", () => {
    expect(totalsOf([])).toEqual({
      cards: 0,
      duplicates: 0,
      byRarity: { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 },
    });
  });

  it("counts a character held at two rarities as two entries, each without duplicates", () => {
    expect(
      totalsOf([
        { rarity: "epic", count: 1 },
        { rarity: "legendary", count: 1 },
      ]),
    ).toMatchObject({ cards: 2, duplicates: 0 });
  });
});
