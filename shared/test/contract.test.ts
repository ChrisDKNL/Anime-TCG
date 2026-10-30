import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  CardVariant,
  CharacterPublic,
  CollectionEntry,
  DemoCard,
  DemoOpened,
  DemoResponse,
  OpenedCard,
  PackAllowance,
  PackKind,
  PackOpened,
  PacksResponse,
  PerRarity,
  Rarity,
  RecycleBody,
  ShopBuyBody,
  SnapshotInfo,
  ListBody,
  ListingsQuery,
  PurchaseReceipt,
} from "../src/api.js";
import {
  DEMO_PACKS_PER_VISIT,
  MAX_ENTRY_AMOUNT,
  PACK_CAP,
  PACK_INTERVAL_MINUTES,
  PACK_SIZE,
} from "../src/economy.js";
import { ERROR_CODES, ErrorEnvelope, MARKET_LIMITS } from "../src/errors.js";
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
    expect({ PACK_SIZE, PACK_INTERVAL_MINUTES, PACK_CAP, DEMO_PACKS_PER_VISIT }).toEqual({
      PACK_SIZE: 5,
      PACK_INTERVAL_MINUTES: 10,
      PACK_CAP: 3,
      DEMO_PACKS_PER_VISIT: 10,
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

describe("demo contract (navigation-and-landing.md §3.8)", () => {
  const character = {
    id: 1,
    name: "A",
    nameNative: null,
    imageUrl: "https://s4.anilist.co/a.png",
    franchiseIds: [1],
    tier: "rare",
    rank: 7,
    inCurrentSnapshot: true,
  };
  const card = (slot: number) => ({ slot, character, rarity: "rare" });

  it("answers the facts with odds and pool both null without a snapshot, and the rules always", () => {
    const facts = { odds: null, pool: null, allowance: { intervalSeconds: 600, cap: 3 }, perVisit: 10 };
    expect(Value.Check(DemoResponse, facts)).toBe(true);
    expect(Value.Check(DemoResponse, { ...facts, allowance: null })).toBe(false);
    expect(Value.Check(DemoResponse, { ...facts, perVisit: 0 })).toBe(false);
    expect(Value.Check(DemoResponse, { ...facts, pool: { characters: 2_983, entries: 100 } })).toBe(true);
    expect(Value.Check(DemoResponse, { ...facts, pool: { characters: 0, entries: 100 } })).toBe(false);
    expect(Value.Check(DemoResponse, { ...facts, allowance: { ...facts.allowance, available: 3 } })).toBe(
      false,
    );
  });

  it("deals five cards that carry no isNew, kind, variant or opening", () => {
    const cards = [0, 1, 2, 3, 4].map(card);
    expect(Object.keys(DemoCard.properties)).toEqual(["slot", "character", "rarity"]);
    expect(Object.keys(DemoOpened.properties)).toEqual(["cards", "franchises"]);
    expect(Value.Check(DemoOpened, { cards, franchises: [] })).toBe(true);
    expect(Value.Check(DemoOpened, { cards: cards.slice(1), franchises: [] })).toBe(false);
    expect(Value.Check(DemoOpened, { cards: [...cards, card(4)], franchises: [] })).toBe(false);
    expect(
      Value.Check(DemoOpened, { cards: [{ ...card(0), isNew: true }, ...cards.slice(1)], franchises: [] }),
    ).toBe(false);
    expect(Value.Check(DemoOpened, { cards, franchises: [], openingId: "x" })).toBe(false);
    expect(Value.Check(DemoCard, card(PACK_SIZE))).toBe(false);
  });
});

describe("economy contract (economy.md §11)", () => {
  const requestId = "6f1c0b8e-3c1a-4d2e-9f00-0123456789ab";
  // TypeBox's Value checks no format until one is registered; Ajv in the api checks it for real.
  if (!FormatRegistry.Has("uuid")) FormatRegistry.Set("uuid", (value) => /^[0-9a-f-]{36}$/i.test(value));

  it("names the economy's error codes of PR 1", () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        "not_enough_copies",
        "balance_limit",
        "insufficient_funds",
        "request_id_reused",
        "theme_unavailable",
      ]),
    );
  });

  it("carries a balance of 0 or more on an error, and nothing else new", () => {
    const envelope = (extra: object) =>
      Value.Check(ErrorEnvelope, { error: { code: "insufficient_funds", message: "m", ...extra } });
    expect([envelope({ balance: 0 }), envelope({ balance: 12 })]).toEqual([true, true]);
    expect([envelope({ balance: -1 }), envelope({ balance: 1.5 }), envelope({ amount: 1 })]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("bounds a recycle to an entry and a count of 1 to 100, and nothing else", () => {
    const recycle = (change: object) =>
      Value.Check(RecycleBody, { requestId, characterId: 1, rarity: "common", count: 1, ...change });
    expect([recycle({}), recycle({ count: 100 }), recycle({ characterId: 2_147_483_647 })]).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      [
        { count: 0 },
        { count: 101 },
        { count: 1.5 },
        { characterId: 0 },
        { characterId: 2_147_483_648 },
        { amount: 1 },
        { cardId: requestId },
      ].map(recycle),
    ).toEqual([false, false, false, false, false, false, false]);
  });

  it("takes a theme id of 1 to 64 characters and a uuid, and no price", () => {
    const buy = (change: object) =>
      Value.Check(ShopBuyBody, { requestId, themeId: "genre-action", ...change });
    expect([buy({}), buy({ themeId: "x".repeat(64) })]).toEqual([true, true]);
    expect([buy({ themeId: "" }), buy({ themeId: "x".repeat(65) }), buy({ price: 400 })]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("market contract (economy.md §11, PR 3)", () => {
  const requestId = "6f1c0b8e-3c1a-4d2e-9f00-0123456789ab";
  if (!FormatRegistry.Has("uuid")) FormatRegistry.Set("uuid", (value) => /^[0-9a-f-]{36}$/i.test(value));

  it("names the market's error codes and its four limits, in the order a purchase checks them", () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        "price_out_of_bounds",
        "listing_limit",
        "listing_not_found",
        "listing_unavailable",
        "own_listing",
        "market_limit",
      ]),
    );
    expect(MARKET_LIMITS).toEqual(["buyer_purchases", "buyer_spend", "seller_proceeds", "pair"]);
    const envelope = (extra: object) =>
      Value.Check(ErrorEnvelope, { error: { code: "market_limit", message: "m", ...extra } });
    expect([envelope({ limit: "pair", retryAfterSeconds: 60 }), envelope({ limit: "everything" })]).toEqual([
      true,
      false,
    ]);
  });

  it("bounds a listing to an entry and a price of 1 to MAX_ENTRY_AMOUNT, and takes no card, fee or kind", () => {
    const list = (change: object) =>
      Value.Check(ListBody, { requestId, characterId: 1, rarity: "mythic", price: 27_500, ...change });
    expect([list({}), list({ price: 1 }), list({ price: MAX_ENTRY_AMOUNT })]).toEqual([true, true, true]);
    expect(
      [
        { price: 0 },
        { price: MAX_ENTRY_AMOUNT + 1 },
        { price: 1.5 },
        { price: "5" },
        { cardId: requestId },
        { fee: 1 },
        { kind: "card" },
        { variant: "standard" },
      ].map(list),
    ).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("takes query ids as plain digits, a sort of three and a cursor of base64url, and nothing else", () => {
    const query = (value: object) => Value.Check(ListingsQuery, value);
    expect(
      [{}, { characterId: "1" }, { franchiseId: "2147483647" }, { sort: "newest" }, { cursor: "a-b_C" }].map(
        query,
      ),
    ).toEqual([true, true, true, true, true]);
    expect(
      [
        { characterId: "0" },
        { characterId: "01" },
        { characterId: "1e3" },
        { characterId: " 1" },
        { characterId: 1 },
        { sort: "cheapest" },
        { cursor: "a+b" },
        { q: "" },
        { q: "x".repeat(101) },
        { q: "a" + String.fromCodePoint(0) + "b" },
        { q: String.fromCodePoint(0x1f) },
        { q: "tab" + String.fromCodePoint(9) },
        { q: String.fromCodePoint(0x7f) },
        { q: String.fromCodePoint(0x85) },
        { seller: "x" },
      ].map(query),
    ).toEqual(Array.from({ length: 15 }, () => false));
    // Format characters, other scripts and combining marks are text, not control characters.
    expect(
      [String.fromCodePoint(0x202e), "進撃", `a${String.fromCodePoint(0x301)}`, "%_\\"].map((q) =>
        query({ q }),
      ),
    ).toEqual([true, true, true, true]);
  });

  it("lets a receipt name no listing once the seller's account is gone", () => {
    expect(PurchaseReceipt.properties.listingId.anyOf.map((member) => member.type)).toEqual([
      "string",
      "null",
    ]);
  });
});
