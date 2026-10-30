import {
  HOUSE_EDGE,
  MARKET_FEE_BPS,
  MARKET_FEE_MIN,
  MARKET_LISTING_TTL_SECONDS,
  MARKET_MAX_LISTINGS,
  MARKET_PAGE_SIZE,
  MARKET_PRICE_MAX,
  MARKET_SEARCH_TERMS,
  MARKET_PRICE_MIN,
  MARKET_WINDOW_PAIR,
  MARKET_WINDOW_PROCEEDS,
  MARKET_WINDOW_PURCHASES,
  MARKET_WINDOW_SECONDS,
  MARKET_WINDOW_SPEND,
  MAX_BALANCE,
  MAX_ENTRY_AMOUNT,
  MAX_RECYCLE_COUNT,
  PACK_SIZE,
  PRIZE_PACK_VALUE,
  RECYCLE_VALUE,
  REFERENCE_VALUE,
  THEMED_PACK_PRICE,
} from "@anime-tcg/shared/economy";
import {
  ODDS_SCALE,
  RADIANT_ODDS,
  RARITIES,
  type Rarity,
  SHARE_SCALE,
  SLOT_ODDS,
  TIER_BAND,
} from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import { expectedCards, longRun, PACK_TABLES } from "../packs/model.js";
import { atLeastOnePerPack, shareOfCards } from "../packs/odds.js";
import { perRarity, tierCounts } from "../pool/tiers.js";
import { marketFee } from "./fee.js";

/**
 * economy.md §5's invariants over `shared/src/economy.ts` and 1c's tables,
 * and §5.1, §5.2 and §9 recomputed from them: a parameter change that moves
 * a published figure fails here until the spec follows.
 */

const PER_TIER = { REFERENCE_VALUE, RECYCLE_VALUE, MARKET_PRICE_MIN, MARKET_PRICE_MAX };
const SCALARS = {
  MAX_RECYCLE_COUNT,
  THEMED_PACK_PRICE,
  MARKET_FEE_BPS,
  MARKET_FEE_MIN,
  MARKET_LISTING_TTL_SECONDS,
  MARKET_MAX_LISTINGS,
  MARKET_WINDOW_SECONDS,
  MARKET_WINDOW_PURCHASES,
  MARKET_WINDOW_SPEND,
  MARKET_WINDOW_PROCEEDS,
  MARKET_WINDOW_PAIR,
  MARKET_PAGE_SIZE,
  MARKET_SEARCH_TERMS,
  MAX_ENTRY_AMOUNT,
  MAX_BALANCE,
  PRIZE_PACK_VALUE,
};
const INT32_MAX = 2 ** 31 - 1;
const rising = (values: Readonly<Record<Rarity, number>>) =>
  RARITIES.every((tier, i) => i === 0 || values[tier] > (values[RARITIES[i - 1] ?? tier] ?? 0));

/** Two significant figures, as §5.1 rounds the reference values. */
const twoFigures = (value: number) => {
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.round(value / magnitude) * magnitude;
};
const valueOf = (cards: Readonly<Record<Rarity, number>>, values: Readonly<Record<Rarity, number>>) =>
  RARITIES.reduce((sum, tier) => sum + cards[tier] * values[tier], 0);
const fixed = (value: number, digits: number) => value.toFixed(digits);

describe("§5 parameters and their invariants", () => {
  it("holds §5's values", () => {
    expect(REFERENCE_VALUE).toEqual({
      common: 10,
      uncommon: 23,
      rare: 35,
      epic: 160,
      legendary: 1_000,
      mythic: 11_000,
    });
    expect(RECYCLE_VALUE).toEqual({
      common: 2,
      uncommon: 5,
      rare: 8,
      epic: 40,
      legendary: 250,
      mythic: 2_750,
    });
    expect(MARKET_PRICE_MIN).toEqual({
      common: 5,
      uncommon: 12,
      rare: 18,
      epic: 80,
      legendary: 500,
      mythic: 5_500,
    });
    expect(MARKET_PRICE_MAX).toEqual({
      common: 25,
      uncommon: 57,
      rare: 87,
      epic: 400,
      legendary: 2_500,
      mythic: 27_500,
    });
    expect(SCALARS).toEqual({
      MAX_RECYCLE_COUNT: 100,
      THEMED_PACK_PRICE: 400,
      MARKET_FEE_BPS: 500,
      MARKET_FEE_MIN: 1,
      MARKET_LISTING_TTL_SECONDS: 7 * 86_400,
      MARKET_MAX_LISTINGS: 50,
      MARKET_WINDOW_SECONDS: 7 * 86_400,
      MARKET_WINDOW_PURCHASES: 100,
      MARKET_WINDOW_SPEND: 55_000,
      MARKET_WINDOW_PROCEEDS: 55_000,
      MARKET_WINDOW_PAIR: 27_500,
      MARKET_PAGE_SIZE: 50,
      MARKET_SEARCH_TERMS: 10,
      MAX_ENTRY_AMOUNT: 1_000_000,
      MAX_BALANCE: 1_000_000_000,
      PRIZE_PACK_VALUE: 400,
    });
    expect(HOUSE_EDGE).toEqual({ min: 300, max: 500 });
  });

  it("makes every value a positive safe integer", () => {
    for (const [name, table] of Object.entries(PER_TIER)) {
      for (const tier of RARITIES)
        expect(Number.isSafeInteger(table[tier]) && table[tier] > 0, name).toBe(true);
    }
    for (const [name, value] of Object.entries({ ...SCALARS, ...HOUSE_EDGE })) {
      expect(Number.isSafeInteger(value) && value > 0, name).toBe(true);
    }
  });

  it("raises the reference and recycle values with the tier", () => {
    expect(rising(REFERENCE_VALUE)).toBe(true);
    expect(rising(RECYCLE_VALUE)).toBe(true);
  });

  it.each([...RARITIES])("derives %s's recycle value and bounds from its reference value", (tier) => {
    const reference = REFERENCE_VALUE[tier];
    expect(RECYCLE_VALUE[tier]).toBe(Math.max(1, Math.floor(reference / 4)));
    expect(4 * RECYCLE_VALUE[tier]).toBeLessThanOrEqual(reference);
    expect(MARKET_PRICE_MIN[tier]).toBe(Math.ceil(reference / 2));
    expect(MARKET_PRICE_MAX[tier]).toBe(Math.floor((reference * 5) / 2));
    expect(MARKET_PRICE_MIN[tier]).toBeLessThanOrEqual(reference);
    expect(reference).toBeLessThanOrEqual(MARKET_PRICE_MAX[tier]);
    // Buying at the floor to recycle always loses; listing at the floor always pays more than recycling.
    expect(RECYCLE_VALUE[tier]).toBeLessThan(MARKET_PRICE_MIN[tier] - marketFee(MARKET_PRICE_MIN[tier]));
  });

  it("lets one Mythic at the upper bound through every market limit", () => {
    expect(MARKET_PRICE_MAX.mythic).toBeLessThanOrEqual(MARKET_WINDOW_PAIR);
    expect(MARKET_WINDOW_PAIR).toBeLessThanOrEqual(MARKET_WINDOW_PROCEEDS);
    expect(MARKET_PRICE_MAX.mythic).toBeLessThanOrEqual(MARKET_WINDOW_SPEND);
    expect(MARKET_WINDOW_PAIR / 12_500).toBe(2.2);
  });

  it("keeps every amount and sum inside a Postgres integer", () => {
    expect(MAX_RECYCLE_COUNT * RECYCLE_VALUE.mythic).toBeLessThanOrEqual(MAX_ENTRY_AMOUNT);
    expect(MAX_BALANCE + MAX_ENTRY_AMOUNT).toBeLessThanOrEqual(INT32_MAX);
    for (const tier of RARITIES) expect(MARKET_PRICE_MAX[tier]).toBeLessThanOrEqual(MAX_ENTRY_AMOUNT);
    expect(THEMED_PACK_PRICE).toBeLessThanOrEqual(MAX_ENTRY_AMOUNT);
  });

  it("makes the shop-and-recycle loop contract: a shop pack's expected recycle value is below a ninth of its price", () => {
    const radiant = RADIANT_ODDS / ODDS_SCALE;
    const standard = expectedCards(PACK_TABLES.standard);
    const shop = perRarity(
      (tier) => (1 - radiant) * standard[tier] + radiant * expectedCards(PACK_TABLES.radiant)[tier],
    );
    expect(valueOf(shop, RECYCLE_VALUE)).toBeLessThan(THEMED_PACK_PRICE / 9);
  });
});

describe("§5.1 and §5.2: the reference values for six tiers", () => {
  const share = perRarity((tier) => shareOfCards(SLOT_ODDS, tier) / 1_000_000);

  it("reads a standard pack's share of cards from SLOT_ODDS: 56 / 24 / 16 / 3.4 / 0.55 / 0.05 %", () => {
    expect(share).toEqual({
      common: 0.56,
      uncommon: 0.24,
      rare: 0.16,
      epic: 0.034,
      legendary: 0.0055,
      mythic: 0.0005,
    });
  });

  it("inverts each share against Common at 10 and rounds to two significant figures", () => {
    const raw = perRarity((tier) => (10 * share.common) / share[tier]);
    expect(RARITIES.map((tier) => fixed(raw[tier], 2))).toEqual([
      "10.00",
      "23.33",
      "35.00",
      "164.71",
      "1018.18",
      "11200.00",
    ]);
    expect(perRarity((tier) => twoFigures(raw[tier]))).toEqual(REFERENCE_VALUE);
  });

  it("gives every tier about the same share of a standard pack's value: 27.2 to 28.0 Karma of reference", () => {
    const perTier = RARITIES.map((tier) => PACK_SIZE * share[tier] * REFERENCE_VALUE[tier]);
    expect(perTier.map((value) => fixed(value, 1))).toEqual(["28.0", "27.6", "28.0", "27.2", "27.5", "27.5"]);
  });

  it("is §5.2's table at the real snapshot (N = 2 983)", () => {
    expect(tierCounts(2_983)).toEqual({
      common: 1_044,
      uncommon: 746,
      rare: 596,
      epic: 358,
      legendary: 179,
      mythic: 60,
    });
    const perPack = RARITIES.map((tier) => atLeastOnePerPack(SLOT_ODDS, tier));
    expect(perPack).toEqual([999_704, 1_000_000, 800_000, 170_000, 27_500, 2_500]);
    // A given character's chance per card, times N: its tier's share of cards over its share of the pool.
    const perCharacter = RARITIES.map((tier) => share[tier] / (TIER_BAND[tier] / SHARE_SCALE));
    expect(perCharacter.map((value) => fixed(value, 4))).toEqual([
      "1.6000",
      "0.9600",
      "0.8000",
      "0.2833",
      "0.0917",
      "0.0250",
    ]);
  });
});

describe("§9: faucet, sinks and the bound on growth, recomputed", () => {
  const radiant = RADIANT_ODDS / ODDS_SCALE;
  const standard = expectedCards(PACK_TABLES.standard);
  const enchanted = expectedCards(PACK_TABLES.enchanted);
  const radiantPack = expectedCards(PACK_TABLES.radiant);
  const pityPack = expectedCards(
    SLOT_ODDS.map((table, slot) =>
      slot === 4 ? perRarity((t) => (t === "mythic" ? ODDS_SCALE : 0)) : table,
    ),
  );
  const shop = perRarity((tier) => (1 - radiant) * standard[tier] + radiant * radiantPack[tier]);
  const free = longRun().cardsPerPack;
  const freeRecycle = valueOf(free, RECYCLE_VALUE);
  const shopRecycle = valueOf(shop, RECYCLE_VALUE);

  it("§9.1: the expected cards and values of every pack kind", () => {
    const row = (cards: Record<Rarity, number>) => [
      fixed(valueOf(cards, REFERENCE_VALUE), 2),
      fixed(valueOf(cards, RECYCLE_VALUE), 2),
    ];
    expect(RARITIES.map((tier) => standard[tier])).toEqual([2.8, 1.2, 0.8, 0.17, 0.0275, 0.0025]);
    expect(row(standard)).toEqual(["165.80", "38.55"]);
    expect(row(enchanted)).toEqual(["466.60", "114.35"]);
    expect(row(pityPack)).toEqual(["11055.60", "2761.60"]);
    expect(row(radiantPack)).toEqual(["12644.00", "3161.00"]);
    expect(RARITIES.map((tier) => fixed(shop[tier], 6))).toEqual([
      "2.798880",
      "1.199520",
      "0.799680",
      "0.171292",
      "0.027709",
      "0.002919",
    ]);
    expect(row(shop)).toEqual(["170.79", "39.80"]);
    expect(RARITIES.map((tier) => fixed(free[tier], 6))).toEqual([
      "2.798880",
      "1.199520",
      "0.718775",
      "0.238568",
      "0.038592",
      "0.005665",
    ]);
    expect(row(free)).toEqual(["219.81", "52.11"]);
  });

  it("§9.1: prices a themed pack at about 2.3 times its cards' reference value, rounded to the nearest 100", () => {
    const reference = valueOf(shop, REFERENCE_VALUE);
    expect(Math.round((reference * 2.3) / 100) * 100).toBe(THEMED_PACK_PRICE);
    expect(fixed(THEMED_PACK_PRICE / reference, 2)).toBe("2.34");
    expect(fixed(THEMED_PACK_PRICE / shopRecycle, 2)).toBe("10.05");
  });

  it("§9.2: bounds the faucet per account by the timer: 469, 5 159 and 7 505 Karma a day at most", () => {
    const perDay = [9, 99, 144].map((packs) => Math.round(packs * freeRecycle));
    expect(perDay).toEqual([469, 5_159, 7_505]);
    expect(perDay.map((karma) => fixed(karma / THEMED_PACK_PRICE, 1))).toEqual(["1.2", "12.9", "18.8"]);
    expect(10 * (perDay[2] ?? 0)).toBe(75_050);
  });

  it("§9.4: every shop pack destroys 360.20 Karma net, so the ceiling funds about 20.8 themed packs a day", () => {
    const net = THEMED_PACK_PRICE - shopRecycle;
    expect(fixed(net, 2)).toBe("360.20");
    expect(fixed(7_505 / net, 1)).toBe("20.8");
    expect(MARKET_PRICE_MAX.mythic / THEMED_PACK_PRICE).toBe(68.75);
  });

  it("§9.5 and §10: the market adds at most 52 250 net per 7 days, which at most doubles one account's income", () => {
    const net = (gross: number) => gross - Math.ceil((gross * MARKET_FEE_BPS) / 10_000);
    expect(net(MARKET_WINDOW_PROCEEDS)).toBe(52_250);
    expect(net(MARKET_WINDOW_PAIR)).toBe(26_125);
    const marketPerDay = net(MARKET_WINDOW_PROCEEDS) / 7;
    expect(Math.round(marketPerDay)).toBe(7_464);
    expect(fixed((7_505 + marketPerDay) / 7_505, 2)).toBe("1.99");
    expect(Math.round(MAX_BALANCE / (7_505 + marketPerDay) / 365)).toBe(183);
  });
});
