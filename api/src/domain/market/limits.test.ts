import {
  MARKET_PRICE_MAX,
  MARKET_WINDOW_PAIR,
  MARKET_WINDOW_PROCEEDS,
  MARKET_WINDOW_PURCHASES,
  MARKET_WINDOW_SECONDS,
  MARKET_WINDOW_SPEND,
} from "@anime-tcg/shared/economy";
import { describe, expect, it } from "vitest";
import { firstLimitHit, type WindowHistory, type WindowPurchase, windowLeft, windowStart } from "./limits.js";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const HOUR = 3_600_000;
const WINDOW_MS = MARKET_WINDOW_SECONDS * 1_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const purchase = (msAgo: number, price: number): WindowPurchase => ({ at: ago(msAgo), price });
const empty: WindowHistory = { bought: [], sold: [], pair: [] };
const many = (count: number, price: number, msAgo = HOUR) =>
  Array.from({ length: count }, () => purchase(msAgo, price));

describe("the market's rolling window (economy.md §5, §10)", () => {
  it("starts exactly one window before now", () => {
    expect(windowStart(NOW)).toEqual(new Date(NOW.getTime() - 7 * 24 * HOUR));
  });

  it("lets a purchase through an empty window, a Mythic at the cap included", () => {
    expect(firstLimitHit(empty, 5, NOW)).toBeNull();
    expect(firstLimitHit(empty, MARKET_PRICE_MAX.mythic, NOW)).toBeNull();
  });

  it("allows the 100th purchase and refuses the 101st, waiting for the oldest to leave", () => {
    const bought = [purchase(5 * HOUR, 5), ...many(MARKET_WINDOW_PURCHASES - 2, 5)];
    expect(firstLimitHit({ ...empty, bought }, 5, NOW)).toBeNull();
    const full = [...bought, purchase(HOUR, 5)];
    expect(firstLimitHit({ ...empty, bought: full }, 5, NOW)).toEqual({
      limit: "buyer_purchases",
      retryAfterSeconds: (WINDOW_MS - 5 * HOUR) / 1_000,
    });
  });

  it("checks the buyer's spend including this purchase, exactly at the bound", () => {
    const bought = [
      purchase(2 * HOUR, MARKET_WINDOW_PAIR),
      purchase(HOUR, MARKET_WINDOW_SPEND - MARKET_WINDOW_PAIR - 5),
    ];
    expect(firstLimitHit({ ...empty, bought }, 5, NOW)).toBeNull();
    expect(firstLimitHit({ ...empty, bought }, 6, NOW)).toEqual({
      limit: "buyer_spend",
      // One Karma over: the oldest purchase leaving frees enough.
      retryAfterSeconds: (WINDOW_MS - 2 * HOUR) / 1_000,
    });
  });

  it("waits for as many of the oldest purchases as it takes to free the excess", () => {
    const bought = [purchase(3 * HOUR, 10_000), purchase(2 * HOUR, 10_000), purchase(HOUR, 35_000)];
    // 55 000 spent; 15 000 more needs both 10 000s to leave, the second of them two hours ago.
    expect(firstLimitHit({ ...empty, bought }, 15_000, NOW)).toEqual({
      limit: "buyer_spend",
      retryAfterSeconds: (WINDOW_MS - 2 * HOUR) / 1_000,
    });
  });

  it("checks the seller's gross proceeds and the pair, in that order after the buyer's two", () => {
    const sold = [purchase(HOUR, MARKET_WINDOW_PROCEEDS)];
    expect(firstLimitHit({ ...empty, sold }, 5, NOW)).toMatchObject({ limit: "seller_proceeds" });
    const pair = [purchase(HOUR, MARKET_WINDOW_PAIR)];
    expect(firstLimitHit({ ...empty, pair }, 5, NOW)).toMatchObject({ limit: "pair" });
    expect(firstLimitHit({ bought: many(MARKET_WINDOW_PURCHASES, 5), sold, pair }, 5, NOW)).toMatchObject({
      limit: "buyer_purchases",
    });
    expect(
      firstLimitHit({ bought: [purchase(HOUR, MARKET_WINDOW_SPEND)], sold, pair }, 5, NOW),
    ).toMatchObject({
      limit: "buyer_spend",
    });
    expect(firstLimitHit({ ...empty, sold, pair }, 5, NOW)).toMatchObject({ limit: "seller_proceeds" });
  });

  it("answers at least one second, rounded up, for a purchase leaving within the second", () => {
    const pair = [{ at: new Date(NOW.getTime() - WINDOW_MS + 1), price: MARKET_WINDOW_PAIR }];
    expect(firstLimitHit({ ...empty, pair }, 1, NOW)).toEqual({ limit: "pair", retryAfterSeconds: 1 });
    const later = [{ at: new Date(NOW.getTime() - WINDOW_MS + 1_500), price: MARKET_WINDOW_PAIR }];
    expect(firstLimitHit({ ...empty, pair: later }, 1, NOW)).toEqual({ limit: "pair", retryAfterSeconds: 2 });
  });

  it("treats a price above the limit itself as a bug, which §5's invariants rule out", () => {
    expect(() => firstLimitHit(empty, MARKET_WINDOW_PAIR + 1, NOW)).toThrow(RangeError);
  });

  it("reports what an account's own limits have left, never below 0", () => {
    expect(windowLeft([], [])).toEqual({
      purchases: MARKET_WINDOW_PURCHASES,
      spend: MARKET_WINDOW_SPEND,
      proceeds: MARKET_WINDOW_PROCEEDS,
    });
    expect(windowLeft([purchase(HOUR, 27_500), purchase(HOUR, 5)], [purchase(HOUR, 400)])).toEqual({
      purchases: MARKET_WINDOW_PURCHASES - 2,
      spend: MARKET_WINDOW_SPEND - 27_505,
      proceeds: MARKET_WINDOW_PROCEEDS - 400,
    });
    expect(windowLeft(many(101, 1_000), [purchase(HOUR, 60_000)])).toEqual({
      purchases: 0,
      spend: 0,
      proceeds: 0,
    });
  });
});
