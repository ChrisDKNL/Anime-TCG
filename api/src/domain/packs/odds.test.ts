import { ODDS_SCALE, RARITIES, type Rarity, SLOT_ODDS } from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import { tierCounts } from "../pool/tiers.js";
import { atLeastOnePerPack, publishedOdds } from "./odds.js";
import { tierForRoll } from "./roll.js";

/** The owner's per-pack figures (collection-packs.md §5.4, round 2 decision 3 with round 3 decision 1). */
const OWNER_PER_PACK: Record<Exclude<Rarity, "common">, number> = {
  rare: 0.8,
  epic: 0.176,
  legendary: 0.02,
  mythic: 0.0033,
};

describe("slot odds", () => {
  it("maps every roll of the scale to exactly SLOT_ODDS' counts per tier", () => {
    const counts = new Map<Rarity, number>(RARITIES.map((tier) => [tier, 0]));
    for (let r = 0; r < ODDS_SCALE; r += 1) {
      const tier = tierForRoll(r);
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual(SLOT_ODDS);
  });

  it("puts each boundary where the spec says, rarest first", () => {
    expect(tierForRoll(0)).toBe("mythic");
    expect(tierForRoll(660)).toBe("mythic");
    expect(tierForRoll(661)).toBe("legendary");
    expect(tierForRoll(4_692)).toBe("legendary");
    expect(tierForRoll(4_693)).toBe("epic");
    expect(tierForRoll(42_669)).toBe("epic");
    expect(tierForRoll(42_670)).toBe("rare");
    expect(tierForRoll(317_889)).toBe("rare");
    expect(tierForRoll(317_890)).toBe("common");
    expect(tierForRoll(ODDS_SCALE - 1)).toBe("common");
  });

  it.each([-1, ODDS_SCALE, 0.5, Number.NaN])("refuses a roll of %s instead of guessing a tier", (r) => {
    expect(() => tierForRoll(r)).toThrow(RangeError);
  });

  it("sums to the scale", () => {
    expect(RARITIES.reduce((sum, tier) => sum + SLOT_ODDS[tier], 0)).toBe(ODDS_SCALE);
  });

  it("is the rounded per-slot form of the owner's per-pack figures, Common taking the rest", () => {
    for (const [tier, perPack] of Object.entries(OWNER_PER_PACK) as [Exclude<Rarity, "common">, number][]) {
      expect(SLOT_ODDS[tier], tier).toBe(Math.round((1 - (1 - perPack) ** (1 / 5)) * ODDS_SCALE));
    }
    expect(SLOT_ODDS.common).toBe(
      ODDS_SCALE - SLOT_ODDS.rare - SLOT_ODDS.epic - SLOT_ODDS.legendary - SLOT_ODDS.mythic,
    );
  });
});

describe("published per-pack odds", () => {
  it("are 800 000, 176 000, 19 998 and 3 301 parts per million for the upper tiers", () => {
    expect(atLeastOnePerPack(SLOT_ODDS.rare)).toBe(800_000);
    expect(atLeastOnePerPack(SLOT_ODDS.epic)).toBe(176_000);
    expect(atLeastOnePerPack(SLOT_ODDS.legendary)).toBe(19_998);
    expect(atLeastOnePerPack(SLOT_ODDS.mythic)).toBe(3_301);
  });

  it("round to the owner's 80 %, 17.6 %, 2 % and 0.33 %", () => {
    const percent = (tier: Rarity, digits: number) =>
      Number(((atLeastOnePerPack(SLOT_ODDS[tier]) / 1_000_000) * 100).toFixed(digits));
    expect(percent("rare", 0)).toBe(80);
    expect(percent("epic", 1)).toBe(17.6);
    expect(percent("legendary", 0)).toBe(2);
    expect(percent("mythic", 2)).toBe(0.33);
  });

  it("are 0 for a tier that never rolls and the whole million for one that always does", () => {
    expect(atLeastOnePerPack(0)).toBe(0);
    expect(atLeastOnePerPack(ODDS_SCALE)).toBe(1_000_000);
  });

  it("are what GET /api/packs publishes, beside the slot odds, the tier sizes and the snapshot", () => {
    const tierSizes = tierCounts(2_000);
    const snapshot = { version: 3, takenAt: "2026-10-29T10:00:00.000Z" };
    expect(publishedOdds(tierSizes, snapshot)).toEqual({
      scale: ODDS_SCALE,
      perSlot: SLOT_ODDS,
      perPack: { common: 996_754, rare: 800_000, epic: 176_000, legendary: 19_998, mythic: 3_301 },
      tierSizes,
      snapshot,
    });
  });
});

describe("one given character's chance per card", () => {
  const rate = (tier: Rarity, size: number) => SLOT_ODDS[tier] / ODDS_SCALE / size;
  const fixtureSplit = { common: 600, rare: 250, epic: 100, legendary: 40, mythic: 10 };

  it.each([
    ["the statistical fixture's split", fixtureSplit],
    ["N = 500", tierCounts(500)],
    ["N = 2 000", tierCounts(2_000)],
    ["N = 6 000", tierCounts(6_000)],
  ])("falls strictly from Common to Mythic for %s", (_label, sizes) => {
    const rates = RARITIES.map((tier) => rate(tier, sizes[tier]));
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i], `${RARITIES[i]} vs ${RARITIES[i - 1]}`).toBeLessThan(rates[i - 1] ?? 0);
    }
  });
});
