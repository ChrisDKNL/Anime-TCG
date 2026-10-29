import { BPS_SCALE, MARKET_FEE_BPS, MARKET_FEE_MIN } from "@anime-tcg/shared/economy";

/**
 * The market fee on a sale at `price` (economy.md §5): `MARKET_FEE_BPS` of
 * the price rounded up, at least `MARKET_FEE_MIN`. Integer arithmetic only.
 */
export function marketFee(price: number): number {
  if (!Number.isSafeInteger(price) || price < 1) throw new RangeError(`price ${price} is not a price`);
  const share = Math.floor((price * MARKET_FEE_BPS + BPS_SCALE - 1) / BPS_SCALE);
  return Math.max(MARKET_FEE_MIN, share);
}
