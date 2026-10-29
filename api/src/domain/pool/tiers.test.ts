import { RARITIES } from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import { assignTiers, shortTier, tierCounts } from "./tiers.js";

const total = (counts: ReturnType<typeof tierCounts>) =>
  RARITIES.reduce((sum, tier) => sum + counts[tier], 0);

describe("tierCounts", () => {
  it.each([
    [500, { mythic: 5, legendary: 20, epic: 50, rare: 125, common: 300 }],
    [2_000, { mythic: 20, legendary: 80, epic: 200, rare: 500, common: 1_200 }],
    [6_000, { mythic: 60, legendary: 240, epic: 600, rare: 1_500, common: 3_600 }],
  ])("splits %i characters 1 / 4 / 10 / 25 / 60 %%", (n, expected) => {
    expect(tierCounts(n)).toEqual(expected);
  });

  it.each([499, 500, 501, 1_000, 1_234, 2_000, 5_999, 6_000])(
    "sums to N exactly at N = %i through cumulative half-up boundaries",
    (n) => {
      expect(total(tierCounts(n))).toBe(n);
    },
  );

  it("rounds each cumulative boundary half up, not each tier on its own", () => {
    // 501 × 1 % = 5.01 → 5; 501 × 5 % = 25.05 → 25; 501 × 15 % = 75.15 → 75; 501 × 40 % = 200.4 → 200.
    expect(tierCounts(501)).toEqual({ mythic: 5, legendary: 20, epic: 50, rare: 125, common: 301 });
    // 550 × 1 % = 5.5 rounds up to 6; 550 × 5 % = 27.5 → 28; 550 × 15 % = 82.5 → 83; 550 × 40 % = 220.
    expect(tierCounts(550)).toEqual({ mythic: 6, legendary: 22, epic: 55, rare: 137, common: 330 });
  });

  it("gives every tier a full pack at SNAPSHOT_CHARACTERS_MIN (500) and names Mythic as short once it rounds below five", () => {
    expect(shortTier(tierCounts(500))).toBeNull();
    expect(tierCounts(449).mythic).toBe(4);
    expect(shortTier(tierCounts(449))).toBe("mythic");
  });

  it("refuses a count that is not a whole non-negative number", () => {
    expect(() => tierCounts(-1)).toThrow(RangeError);
    expect(() => tierCounts(2.5)).toThrow(RangeError);
  });
});

describe("assignTiers", () => {
  const characters = (favourites: number[]) =>
    favourites.map((f, index) => ({ id: index + 1, favourites: f }));

  it("ranks by favourites, most first, and gives the top ranks the top tiers", () => {
    const ranked = assignTiers(characters(Array.from({ length: 500 }, (_, i) => i)));
    const byId = new Map(ranked.map((c) => [c.id, c]));
    expect(byId.get(500)).toMatchObject({ favouritesRank: 1, tier: "mythic" });
    expect(byId.get(496)).toMatchObject({ favouritesRank: 5, tier: "mythic" });
    expect(byId.get(495)).toMatchObject({ favouritesRank: 6, tier: "legendary" });
    expect(byId.get(1)).toMatchObject({ favouritesRank: 500, tier: "common" });
    const counts = Object.fromEntries(
      RARITIES.map((tier) => [tier, ranked.filter((c) => c.tier === tier).length]),
    );
    expect(counts).toEqual(tierCounts(500));
  });

  it("breaks ties by AniList id ascending, so a tie straddling a boundary puts the lower id in the higher tier", () => {
    // 500 characters; ranks 4..7 share 1 000 favourites, so the Mythic boundary (rank 5) splits the tie.
    const favourites = Array.from({ length: 500 }, (_, i) => (i < 3 ? 5_000 - i : i < 7 ? 1_000 : 10));
    const input = characters(favourites).reverse();
    const ranked = assignTiers(input);
    const tied = ranked.filter((c) => c.favourites === 1_000);
    expect(tied.map((c) => [c.id, c.favouritesRank, c.tier])).toEqual([
      [4, 4, "mythic"],
      [5, 5, "mythic"],
      [6, 6, "legendary"],
      [7, 7, "legendary"],
    ]);
  });

  it("is deterministic when every character has the same favourites, whatever the input order", () => {
    const flat = characters(Array<number>(600).fill(42));
    const forward = assignTiers(flat).map((c) => [c.id, c.tier]);
    const shuffled = assignTiers([...flat].sort((a, b) => ((a.id * 7919) % 600) - ((b.id * 7919) % 600)));
    expect(shuffled.map((c) => [c.id, c.tier])).toEqual(forward);
    expect(forward.slice(0, 6)).toEqual([
      [1, "mythic"],
      [2, "mythic"],
      [3, "mythic"],
      [4, "mythic"],
      [5, "mythic"],
      [6, "mythic"],
    ]);
  });

  it("keeps the fields it was given", () => {
    const [only] = assignTiers([{ id: 9, favourites: 3, name: "Kept" }]);
    expect(only).toEqual({ id: 9, favourites: 3, name: "Kept", favouritesRank: 1, tier: "common" });
  });
});
