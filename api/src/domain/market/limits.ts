import type { WindowLeft } from "@anime-tcg/shared/api";
import {
  MARKET_WINDOW_PAIR,
  MARKET_WINDOW_PROCEEDS,
  MARKET_WINDOW_PURCHASES,
  MARKET_WINDOW_SECONDS,
  MARKET_WINDOW_SPEND,
} from "@anime-tcg/shared/economy";
import type { MarketLimit } from "@anime-tcg/shared/errors";

/**
 * The market's window limits (economy.md §5, §10), pure. Each limit sums
 * the purchases of the last `MARKET_WINDOW_SECONDS`: a purchase made at
 * `at` counts while `now < at + window`, and leaves the window at exactly
 * `at + window`. A purchase that would take a limit past its cap is
 * refused, and the answer says when enough of that limit's oldest
 * purchases will have left for it to fit.
 */

const WINDOW_MS = MARKET_WINDOW_SECONDS * 1_000;

/** One counted purchase: when it was made and its price. */
export interface WindowPurchase {
  at: Date;
  price: number;
}

/** The purchases that count towards the four limits of one prospective purchase, each list inside the window. */
export interface WindowHistory {
  /** The buyer's purchases: their count and their prices. */
  bought: readonly WindowPurchase[];
  /** The seller's sales, gross. */
  sold: readonly WindowPurchase[];
  /** The buyer's purchases from this seller. */
  pair: readonly WindowPurchase[];
}

export interface LimitHit {
  limit: MarketLimit;
  retryAfterSeconds: number;
}

/** Where the window that counts at `now` begins: purchases made after it count. */
export function windowStart(now: Date): Date {
  return new Date(now.getTime() - WINDOW_MS);
}

const total = (purchases: readonly WindowPurchase[]) =>
  purchases.reduce((sum, purchase) => sum + purchase.price, 0);

/**
 * Seconds until the oldest of `purchases` have freed at least `excess` of
 * `weight`, rounded up and at least 1: when the purchase refused now would
 * fit. An excess the whole window cannot free means a price above the cap
 * itself, which §5's invariants rule out, so it is a bug.
 */
function secondsUntilRoom(
  purchases: readonly WindowPurchase[],
  excess: number,
  weight: (purchase: WindowPurchase) => number,
  now: Date,
): number {
  const oldestFirst = [...purchases].sort((a, b) => a.at.getTime() - b.at.getTime());
  let freed = 0;
  for (const purchase of oldestFirst) {
    freed += weight(purchase);
    if (freed >= excess) {
      return Math.max(1, Math.ceil((purchase.at.getTime() + WINDOW_MS - now.getTime()) / 1_000));
    }
  }
  throw new RangeError(`no window frees ${excess}: the price is above the limit itself`);
}

/**
 * The first limit a purchase at `price` would break, in the order
 * buyer_purchases, buyer_spend, seller_proceeds, pair (economy.md §8.5
 * step 6), or null when it fits all four. Each limit counts this purchase.
 */
export function firstLimitHit(history: WindowHistory, price: number, now: Date): LimitHit | null {
  const count = () => 1;
  const byPrice = (purchase: WindowPurchase) => purchase.price;
  const checks: [MarketLimit, readonly WindowPurchase[], number, number, (p: WindowPurchase) => number][] = [
    ["buyer_purchases", history.bought, history.bought.length + 1, MARKET_WINDOW_PURCHASES, count],
    ["buyer_spend", history.bought, total(history.bought) + price, MARKET_WINDOW_SPEND, byPrice],
    ["seller_proceeds", history.sold, total(history.sold) + price, MARKET_WINDOW_PROCEEDS, byPrice],
    ["pair", history.pair, total(history.pair) + price, MARKET_WINDOW_PAIR, byPrice],
  ];
  for (const [limit, purchases, withThis, cap, weight] of checks) {
    if (withThis > cap) {
      return { limit, retryAfterSeconds: secondsUntilRoom(purchases, withThis - cap, weight, now) };
    }
  }
  return null;
}

/** What an account's own limits have left (`GET /api/market/mine`): as a buyer, purchases and spend; as a seller, proceeds. */
export function windowLeft(bought: readonly WindowPurchase[], sold: readonly WindowPurchase[]): WindowLeft {
  return {
    purchases: Math.max(0, MARKET_WINDOW_PURCHASES - bought.length),
    spend: Math.max(0, MARKET_WINDOW_SPEND - total(bought)),
    proceeds: Math.max(0, MARKET_WINDOW_PROCEEDS - total(sold)),
  };
}
