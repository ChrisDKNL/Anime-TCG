import type { KarmaRules } from "@anime-tcg/shared/api";
import {
  MARKET_FEE_BPS,
  MARKET_FEE_MIN,
  MARKET_LISTING_TTL_SECONDS,
  MARKET_MAX_LISTINGS,
  MARKET_PRICE_MAX,
  MARKET_PRICE_MIN,
  MARKET_WINDOW_PAIR,
  MARKET_WINDOW_PROCEEDS,
  MARKET_WINDOW_PURCHASES,
  MARKET_WINDOW_SECONDS,
  MARKET_WINDOW_SPEND,
  MAX_RECYCLE_COUNT,
  RECYCLE_VALUE,
  REFERENCE_VALUE,
  THEMED_PACK_PRICE,
} from "@anime-tcg/shared/economy";
import { perRarity } from "../pool/tiers.js";

/** What `GET /api/wallet` publishes (economy.md §11.2): every number the UI shows next to the action it governs. */
export function karmaRules(): KarmaRules {
  return {
    referenceValues: perRarity((tier) => REFERENCE_VALUE[tier]),
    recycleValues: perRarity((tier) => RECYCLE_VALUE[tier]),
    priceMin: perRarity((tier) => MARKET_PRICE_MIN[tier]),
    priceMax: perRarity((tier) => MARKET_PRICE_MAX[tier]),
    feeBps: MARKET_FEE_BPS,
    feeMin: MARKET_FEE_MIN,
    listingTtlSeconds: MARKET_LISTING_TTL_SECONDS,
    maxListings: MARKET_MAX_LISTINGS,
    maxRecycleCount: MAX_RECYCLE_COUNT,
    themedPackPrice: THEMED_PACK_PRICE,
    window: {
      seconds: MARKET_WINDOW_SECONDS,
      purchases: MARKET_WINDOW_PURCHASES,
      spend: MARKET_WINDOW_SPEND,
      proceeds: MARKET_WINDOW_PROCEEDS,
      pair: MARKET_WINDOW_PAIR,
    },
  };
}
