import { RARITIES } from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import { assignTiers, shortTier, tierCounts } from "./tiers.js";

const total = (counts: ReturnType<typeof tierCounts>) =>
  RARITIES.reduce((sum, tier) => sum + counts[tier], 0);

const counts = (
  common: number,
  uncommon: number,
  rare: number,
  epic: number,
  legendary: number,
  mythic: number,
) => ({
  common,
  uncommon,
  rare,
  epic,
  legendary,
  mythic,
});

describe("tierCounts", () => {
  it.each([
    [225, counts(79, 56, 45, 27, 13, 5)],
    [500, counts(175, 125, 100, 60, 30, 10)],
    [501, counts(175, 126, 100, 60, 30, 10)],
    [1_000, counts(350, 250, 200, 120, 60, 20)],
    [2_983, counts(1_044, 746, 596, 358, 179, 60)],
    [6_000, counts(2_100, 1_500, 1_200, 720, 360, 120)],
  ])("splits %i characters 35 / 25 / 20 / 12 / 6 / 2 %% as §5.1.4's table says", (n, expected) => {
    expect(tierCounts(n)).toEqual(expected);
  });

  it.each([224, 225, 499, 500, 501, 1_000, 1_234, 2_983, 5_999, 6_000])(
    "sums to N exactly at N = %i through cumulative half-up boundaries",
    (n) => {
      expect(total(tierCounts(n))).toBe(n);
    },
  );

  it("rounds each cumulative boundary half up, not each tier on its own", () => {
    // 225 × 2 % = 4.5 → 5; 225 × 8 % = 18; 225 × 20 % = 45; 225 × 40 % = 90; 225 × 65 % = 146.25 → 146.
    expect(tierCounts(225)).toEqual(counts(79, 56, 45, 27, 13, 5));
    // 550 × 2 % = 11; 550 × 65 % = 357.5 rounds up to 358, so Uncommon takes 358 − 220 = 138.
    expect(tierCounts(550)).toEqual(counts(192, 138, 110, 66, 33, 11));
  });

  it("gives every tier a full pack from N = 225 and names Mythic as short at N = 224", () => {
    for (let n = 225; n <= 6_000; n += 1) expect(shortTier(tierCounts(n)), `N = ${n}`).toBeNull();
    expect(tierCounts(224).mythic).toBe(4);
    expect(shortTier(tierCounts(224))).toBe("mythic");
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
    expect(byId.get(491)).toMatchObject({ favouritesRank: 10, tier: "mythic" });
    expect(byId.get(490)).toMatchObject({ favouritesRank: 11, tier: "legendary" });
    expect(byId.get(176)).toMatchObject({ favouritesRank: 325, tier: "uncommon" });
    expect(byId.get(175)).toMatchObject({ favouritesRank: 326, tier: "common" });
    expect(byId.get(1)).toMatchObject({ favouritesRank: 500, tier: "common" });
    const counts = Object.fromEntries(
      RARITIES.map((tier) => [tier, ranked.filter((c) => c.tier === tier).length]),
    );
    expect(counts).toEqual(tierCounts(500));
  });

  it("breaks ties by AniList id ascending, so a tie straddling a boundary puts the lower id in the higher tier", () => {
    // 500 characters; ranks 9..12 share 1 000 favourites, so the Mythic boundary (rank 10) splits the tie.
    const favourites = Array.from({ length: 500 }, (_, i) => (i < 8 ? 5_000 - i : i < 12 ? 1_000 : 10));
    const input = characters(favourites).reverse();
    const ranked = assignTiers(input);
    const tied = ranked.filter((c) => c.favourites === 1_000);
    expect(tied.map((c) => [c.id, c.favouritesRank, c.tier])).toEqual([
      [9, 9, "mythic"],
      [10, 10, "mythic"],
      [11, 11, "legendary"],
      [12, 12, "legendary"],
    ]);
  });

  it("is deterministic when every character has the same favourites, whatever the input order", () => {
    const flat = characters(Array<number>(600).fill(42));
    const forward = assignTiers(flat).map((c) => [c.id, c.tier]);
    const shuffled = assignTiers([...flat].sort((a, b) => ((a.id * 7919) % 600) - ((b.id * 7919) % 600)));
    expect(shuffled.map((c) => [c.id, c.tier])).toEqual(forward);
    expect(forward.slice(0, 12)).toEqual(Array.from({ length: 12 }, (_, i) => [i + 1, "mythic"]));
    expect(forward[12]).toEqual([13, "legendary"]);
  });

  it("keeps the fields it was given", () => {
    // One character: every boundary below Uncommon's rounds to 0, and Uncommon's, round(0.65), to 1.
    const [only] = assignTiers([{ id: 9, favourites: 3, name: "Kept" }]);
    expect(only).toEqual({ id: 9, favourites: 3, name: "Kept", favouritesRank: 1, tier: "uncommon" });
  });
});
