import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { describe, expect, it } from "vitest";
import { drawPack, rollTier, type TierPool } from "./roll.js";
import { cryptoRng, type Rng } from "./rng.js";

/** Answers each call with the next scripted value, checking it is inside the range asked for. */
function scripted(values: number[]): Rng & { calls: [number, number][] } {
  const calls: [number, number][] = [];
  const rng = (min: number, max: number) => {
    calls.push([min, max]);
    const value = values.shift();
    if (value === undefined) throw new Error("script ran out");
    if (value < min || value >= max) throw new Error(`scripted ${value} outside [${min}, ${max})`);
    return value;
  };
  return Object.assign(rng, { calls });
}

const pool: TierPool = {
  common: [100, 101, 102, 103, 104, 105, 106, 107],
  rare: [200, 201, 202, 203, 204, 205],
  epic: [300, 301, 302, 303, 304],
  legendary: [400, 401, 402, 403, 404],
  mythic: [500, 501, 502, 503, 504],
};

const MYTHIC_ROLL = 0;
const COMMON_ROLL = 999_999;

describe("rollTier", () => {
  it("asks the generator for one integer in [0, ODDS_SCALE)", () => {
    const rng = scripted([661]);
    expect(rollTier(rng)).toBe("legendary");
    expect(rng.calls).toEqual([[0, 1_000_000]]);
  });
});

describe("drawPack", () => {
  it("rolls each slot's tier, then picks from that tier's list by partial Fisher–Yates", () => {
    // Tiers: common, common, mythic, common, rare. Picks: common index 7 (107), then from [1, 8) index 7,
    // whose slot now holds 100 after the first swap; mythic index 2 (502); common from [2, 8) index 2; rare index 0.
    const rng = scripted([COMMON_ROLL, 7, COMMON_ROLL, 7, MYTHIC_ROLL, 2, COMMON_ROLL, 2, 42_670, 0]);
    expect(drawPack(pool, rng)).toEqual([
      { slot: 0, characterId: 107, tier: "common" },
      { slot: 1, characterId: 100, tier: "common" },
      { slot: 2, characterId: 502, tier: "mythic" },
      { slot: 3, characterId: 102, tier: "common" },
      { slot: 4, characterId: 200, tier: "rare" },
    ]);
    expect(rng.calls.filter(([min]) => min > 0)).toEqual([
      [1, 8],
      [2, 8],
    ]);
  });

  it("always deals PACK_SIZE different characters, each of the tier its slot rolled", () => {
    const tierOf = new Map(Object.entries(pool).flatMap(([tier, ids]) => ids.map((id) => [id, tier])));
    for (let i = 0; i < 2_000; i += 1) {
      const pack = drawPack(pool, cryptoRng);
      expect(pack).toHaveLength(PACK_SIZE);
      expect(new Set(pack.map((card) => card.characterId)).size).toBe(PACK_SIZE);
      for (const card of pack) expect(tierOf.get(card.characterId)).toBe(card.tier);
      expect(pack.map((card) => card.slot)).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it("draws five different Mythics from a tier of exactly PACK_SIZE when all five slots roll Mythic", () => {
    for (let i = 0; i < 200; i += 1) {
      const forced = scripted(Array<number>(PACK_SIZE).fill(MYTHIC_ROLL));
      const pack = drawPack(pool, cryptoRng, forced);
      expect(pack.map((card) => card.tier)).toEqual(Array(PACK_SIZE).fill("mythic"));
      expect(pack.map((card) => card.characterId).sort()).toEqual([500, 501, 502, 503, 504]);
    }
  });

  it("keeps the tier roll and the pick on separate generators when told to", () => {
    const tiers = scripted([MYTHIC_ROLL, MYTHIC_ROLL, MYTHIC_ROLL, MYTHIC_ROLL, MYTHIC_ROLL]);
    const picks = scripted([4, 4, 4, 4, 4]);
    expect(drawPack(pool, picks, tiers).map((card) => card.characterId)).toEqual([504, 500, 501, 502, 503]);
    expect(tiers.calls).toHaveLength(PACK_SIZE);
    expect(picks.calls).toEqual([
      [0, 5],
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
    ]);
  });

  it("refuses to repeat a character when a tier is smaller than the pack", () => {
    const thin: TierPool = { ...pool, mythic: [500, 501] };
    const tiers = scripted([MYTHIC_ROLL, MYTHIC_ROLL, MYTHIC_ROLL, MYTHIC_ROLL, MYTHIC_ROLL]);
    expect(() => drawPack(thin, cryptoRng, tiers)).toThrow("ran out of characters");
  });
});
