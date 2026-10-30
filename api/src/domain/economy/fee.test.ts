import { MARKET_PRICE_MAX, MARKET_PRICE_MIN, MAX_ENTRY_AMOUNT } from "@anime-tcg/shared/economy";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import { marketFee } from "./fee.js";

describe("the market fee (economy.md §5): 5 % rounded up, at least 1", () => {
  it.each([
    [1, 1],
    [19, 1],
    [20, 1],
    [21, 2],
    [40, 2],
    [41, 3],
    [MAX_ENTRY_AMOUNT, 50_000],
  ])("charges %i a fee of %i", (price, fee) => {
    expect(marketFee(price)).toBe(fee);
  });

  it("is exact at both bounds of all six tiers", () => {
    expect(
      RARITIES.map((tier) => [marketFee(MARKET_PRICE_MIN[tier]), marketFee(MARKET_PRICE_MAX[tier])]),
    ).toEqual([
      [1, 2],
      [1, 3],
      [1, 5],
      [4, 20],
      [25, 125],
      [275, 1_375],
    ]);
  });

  it("matches ceil(price × 500 / 10 000) for every price up to a Mythic at the cap", () => {
    for (let price = 1; price <= MARKET_PRICE_MAX.mythic; price += 1) {
      const expected = Math.max(1, Math.ceil((price * 500) / 10_000));
      if (marketFee(price) !== expected)
        throw new Error(`price ${price}: ${marketFee(price)} not ${expected}`);
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Infinity])("refuses %s, which is not a price", (price) => {
    expect(() => marketFee(price)).toThrow(RangeError);
  });
});
