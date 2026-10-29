import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  CardVariant,
  CharacterPublic,
  CollectionEntry,
  OpenedCard,
  PackAllowance,
  PackKind,
  PackOpened,
  PacksResponse,
  PerRarity,
  Rarity,
  SnapshotInfo,
} from "../src/api.js";
import { PACK_CAP, PACK_INTERVAL_MINUTES, PACK_SIZE } from "../src/economy.js";
import { ERROR_CODES } from "../src/errors.js";
import {
  ENCHANTED_INTERVAL,
  ENCHANTED_SLOT_ODDS,
  ODDS_SCALE,
  type OddsTable,
  PITY_PACKS,
  RADIANT_ODDS,
  RADIANT_SLOT_ODDS,
  RARITIES,
  RARITY_LABEL,
  SHARE_SCALE,
  SLOT_FLOOR,
  SLOT_ODDS,
  TIER_BAND,
} from "../src/rarity.js";

const sum = (values: OddsTable) => RARITIES.reduce((total, tier) => total + values[tier], 0);
const below = (floor: (typeof RARITIES)[number]) => RARITIES.slice(0, RARITIES.indexOf(floor));

describe("rarity constants (collection-packs.md §4.2, §5.4)", () => {
  it("lists the six tiers in rank order with their labels", () => {
    expect(RARITIES).toEqual(["common", "uncommon", "rare", "epic", "legendary", "mythic"]);
    expect(RARITIES.map((tier) => RARITY_LABEL[tier])).toEqual([
      "Common",
      "Uncommon",
      "Rare",
      "Epic",
      "Legendary",
      "Mythic",
    ]);
  });

  it("has one integer table per slot that sums to the scale and holds nothing below the slot's floor", () => {
    expect(ODDS_SCALE).toBe(1_000_000);
    expect(SLOT_ODDS).toHaveLength(PACK_SIZE);
    expect(SLOT_FLOOR).toEqual(["common", "common", "common", "uncommon", "rare"]);
    SLOT_ODDS.forEach((table, slot) => {
      for (const tier of RARITIES) expect(Number.isInteger(table[tier])).toBe(true);
      expect(sum(table), `slot ${slot + 1}`).toBe(ODDS_SCALE);
      const floor = SLOT_FLOOR[slot];
      if (floor === undefined) throw new Error(`slot ${slot} has no floor`);
      for (const tier of below(floor)) expect(table[tier], `slot ${slot + 1} ${tier}`).toBe(0);
    });
  });

  it("holds the special-pack rules and their tables", () => {
    expect({ ENCHANTED_INTERVAL, RADIANT_ODDS, PITY_PACKS }).toEqual({
      ENCHANTED_INTERVAL: 10,
      RADIANT_ODDS: 400,
      PITY_PACKS: 300,
    });
    for (const table of [ENCHANTED_SLOT_ODDS, RADIANT_SLOT_ODDS]) {
      expect(sum(table)).toBe(ODDS_SCALE);
      for (const tier of below("epic")) expect(table[tier]).toBe(0);
    }
    expect(ENCHANTED_SLOT_ODDS).toEqual({
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 850_000,
      legendary: 137_500,
      mythic: 12_500,
    });
    expect(RADIANT_SLOT_ODDS).toEqual(ENCHANTED_SLOT_ODDS);
  });

  it("has integer tier bands that sum to their scale: 35 / 25 / 20 / 12 / 6 / 2 %", () => {
    expect(SHARE_SCALE).toBe(10_000);
    expect(sum(TIER_BAND)).toBe(SHARE_SCALE);
    expect(RARITIES.map((tier) => TIER_BAND[tier])).toEqual([3_500, 2_500, 2_000, 1_200, 600, 200]);
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
  const counts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };

  it("names the two new error codes", () => {
    expect(ERROR_CODES).toEqual(expect.arrayContaining(["no_pack_available", "pool_unavailable"]));
  });

  it("accepts exactly the six tiers as a rarity, in RARITIES' order", () => {
    expect(Rarity.anyOf.map((member) => member.const)).toEqual([...RARITIES]);
    for (const tier of RARITIES) expect(Value.Check(Rarity, tier)).toBe(true);
    expect(Value.Check(Rarity, "legendary ")).toBe(false);
    expect(Value.Check(Rarity, "masterwork")).toBe(false);
  });

  it("names the three pack kinds", () => {
    expect(PackKind.anyOf.map((member) => member.const)).toEqual(["standard", "enchanted", "radiant"]);
    expect(Value.Check(PackKind, "shop")).toBe(false);
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

  it("bounds packsUntilGuarantee to 1..PITY_PACKS or null, on both pack answers", () => {
    const allowance = { available: 1, cap: PACK_CAP, intervalSeconds: 600, nextPackInSeconds: 1 };
    const packs = (packsUntilGuarantee: unknown) =>
      Value.Check(PacksResponse, { allowance, odds: null, packsUntilGuarantee });
    expect([1, PITY_PACKS, null].map(packs)).toEqual([true, true, true]);
    expect([0, PITY_PACKS + 1, 1.5].map(packs)).toEqual([false, false, false]);
    expect(PackOpened.properties.packsUntilGuarantee).toEqual(PacksResponse.properties.packsUntilGuarantee);
  });

  it("has one integer per tier and nothing else in PerRarity", () => {
    expect(Value.Check(PerRarity, counts)).toBe(true);
    expect(Value.Check(PerRarity, { ...counts, masterwork: 0 })).toBe(false);
    const { uncommon: _uncommon, ...five } = counts;
    expect(Value.Check(PerRarity, five)).toBe(false);
  });

  it("gives a character a rank of at least 1 or null and a snapshot its character count", () => {
    const character = {
      id: 1,
      name: "A",
      nameNative: null,
      imageUrl: "https://s4.anilist.co/a.png",
      franchiseIds: [1],
      tier: "mythic",
      rank: 1,
      inCurrentSnapshot: true,
    };
    expect(Value.Check(CharacterPublic, character)).toBe(true);
    expect(Value.Check(CharacterPublic, { ...character, tier: null, rank: null })).toBe(true);
    expect(Value.Check(CharacterPublic, { ...character, rank: 0 })).toBe(false);
    const { rank: _rank, ...withoutRank } = character;
    expect(Value.Check(CharacterPublic, withoutRank)).toBe(false);
    expect(Object.keys(SnapshotInfo.properties)).toEqual(["version", "takenAt", "characterCount"]);
    expect(Value.Check(SnapshotInfo.properties.characterCount, 2_983)).toBe(true);
    expect(Value.Check(SnapshotInfo.properties.characterCount, 0)).toBe(false);
  });
});
