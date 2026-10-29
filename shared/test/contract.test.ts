import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { CardVariant, CollectionEntry, OpenedCard, PackAllowance, PerRarity, Rarity } from "../src/api.js";
import { PACK_CAP, PACK_INTERVAL_MINUTES, PACK_SIZE } from "../src/economy.js";
import { ERROR_CODES } from "../src/errors.js";
import { ODDS_SCALE, RARITIES, RARITY_LABEL, SHARE_SCALE, SLOT_ODDS, TIER_SHARE } from "../src/rarity.js";

const sum = (values: Record<string, number>) => Object.values(values).reduce((a, b) => a + b, 0);

describe("rarity constants (collection-packs.md §4.2, §5.4)", () => {
  it("lists the five tiers in rank order with their labels", () => {
    expect(RARITIES).toEqual(["common", "rare", "epic", "legendary", "mythic"]);
    expect(RARITIES.map((tier) => RARITY_LABEL[tier])).toEqual([
      "Common",
      "Rare",
      "Epic",
      "Legendary",
      "Mythic",
    ]);
  });

  it("has integer slot odds that sum to the scale and integer shares that sum to theirs", () => {
    expect(ODDS_SCALE).toBe(1_000_000);
    expect(SHARE_SCALE).toBe(10_000);
    for (const tier of RARITIES) {
      expect(Number.isInteger(SLOT_ODDS[tier])).toBe(true);
      expect(Number.isInteger(TIER_SHARE[tier])).toBe(true);
    }
    expect(sum(SLOT_ODDS)).toBe(ODDS_SCALE);
    expect(sum(TIER_SHARE)).toBe(SHARE_SCALE);
  });

  it("holds the owner's pack numbers", () => {
    expect({ PACK_SIZE, PACK_INTERVAL_MINUTES, PACK_CAP }).toEqual({
      PACK_SIZE: 5,
      PACK_INTERVAL_MINUTES: 10,
      PACK_CAP: 3,
    });
  });
});

describe("1c contract", () => {
  it("names the two new error codes", () => {
    expect(ERROR_CODES).toEqual(expect.arrayContaining(["no_pack_available", "pool_unavailable"]));
  });

  it("accepts exactly the five tiers as a rarity", () => {
    for (const tier of RARITIES) expect(Value.Check(Rarity, tier)).toBe(true);
    expect(Value.Check(Rarity, "legendary ")).toBe(false);
    expect(Value.Check(Rarity, "uncommon")).toBe(false);
  });

  it("reserves variant and kind with one value each", () => {
    expect(Value.Check(CardVariant, "standard")).toBe(true);
    expect(Value.Check(CardVariant, "masterwork")).toBe(false);
    expect(OpenedCard.properties.kind.const).toBe("card");
    expect(CollectionEntry.properties.kind.const).toBe("card");
  });

  it("bounds the allowance by the cap and the next pack below at one second", () => {
    const allowance = { available: PACK_CAP, cap: PACK_CAP, intervalSeconds: 600, nextPackInSeconds: null };
    expect(Value.Check(PackAllowance, allowance)).toBe(true);
    expect(Value.Check(PackAllowance, { ...allowance, available: PACK_CAP + 1 })).toBe(false);
    expect(Value.Check(PackAllowance, { ...allowance, available: -1 })).toBe(false);
    expect(Value.Check(PackAllowance, { ...allowance, nextPackInSeconds: 0 })).toBe(false);
  });

  it("has one integer per tier and nothing else in PerRarity", () => {
    const counts = { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };
    expect(Value.Check(PerRarity, counts)).toBe(true);
    expect(Value.Check(PerRarity, { ...counts, uncommon: 0 })).toBe(false);
    const { mythic: _mythic, ...four } = counts;
    expect(Value.Check(PerRarity, four)).toBe(false);
  });
});
