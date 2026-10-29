/**
 * The game's numbers, in one file as ADR 0004 asks (docs/design/collection-packs.md
 * §4.2; the economy adds its own here). The server applies them; the web app
 * may not import this module (ESLint `no-restricted-imports`) and shows what
 * the api answers instead.
 */

import type { Rarity } from "./rarity.js";

/** Cards per pack, all different characters. */
export const PACK_SIZE = 5;
/** One pack accrues per interval. */
export const PACK_INTERVAL_MINUTES = 10;
/** Packs stored at most; a new account starts with this many. */
export const PACK_CAP = 3;

/**
 * Karma, the one in-game currency (docs/design/economy.md §5). Integers
 * only; every amount the server writes is bounded by these, so every sum
 * stays inside a Postgres `integer`. Changed only by a deploy that changes
 * the spec; market prices are the players'.
 */

/** Karma per tier, inverse to the tier's share of a standard pack's cards, Common 10, two significant figures (§5.1). */
export const REFERENCE_VALUE = {
  common: 10,
  uncommon: 23,
  rare: 35,
  epic: 160,
  legendary: 1_000,
  mythic: 11_000,
} as const satisfies Readonly<Record<Rarity, number>>;

/** Karma per recycled duplicate: a quarter of the reference value, rounded down, at least 1 (§6). */
export const RECYCLE_VALUE = {
  common: 2,
  uncommon: 5,
  rare: 8,
  epic: 40,
  legendary: 250,
  mythic: 2_750,
} as const satisfies Readonly<Record<Rarity, number>>;

/** Duplicates of one entry recycled in one request. */
export const MAX_RECYCLE_COUNT = 100;

/** The price of every themed pack in the Karma shop (§9.1). */
export const THEMED_PACK_PRICE = 400;

/** The lowest asking price on the market per tier: half the reference value, rounded up. */
export const MARKET_PRICE_MIN = {
  common: 5,
  uncommon: 12,
  rare: 18,
  epic: 80,
  legendary: 500,
  mythic: 5_500,
} as const satisfies Readonly<Record<Rarity, number>>;

/** The highest asking price on the market per tier: two and a half times the reference value, rounded down. */
export const MARKET_PRICE_MAX = {
  common: 25,
  uncommon: 57,
  rare: 87,
  epic: 400,
  legendary: 2_500,
  mythic: 27_500,
} as const satisfies Readonly<Record<Rarity, number>>;

/** The market fee in basis points of the price, paid by the seller and destroyed. */
export const MARKET_FEE_BPS = 500;
/** The fee is `max(MARKET_FEE_MIN, ceil(price × MARKET_FEE_BPS / 10 000))`. */
export const MARKET_FEE_MIN = 1;
/** Basis points per whole. */
export const BPS_SCALE = 10_000;

const DAY_SECONDS = 86_400;
/** An unsold listing expires after this. */
export const MARKET_LISTING_TTL_SECONDS = 7 * DAY_SECONDS;
/** Active listings per account. */
export const MARKET_MAX_LISTINGS = 50;
/** The rolling window of the four market limits below (§10). */
export const MARKET_WINDOW_SECONDS = 7 * DAY_SECONDS;
/** Purchases per buyer per window. */
export const MARKET_WINDOW_PURCHASES = 100;
/** Karma a buyer spends on the market per window. */
export const MARKET_WINDOW_SPEND = 55_000;
/** Karma (gross) a seller receives from the market per window. */
export const MARKET_WINDOW_PROCEEDS = 55_000;
/** Karma one buyer pays one seller per window: one Mythic at the upper bound. */
export const MARKET_WINDOW_PAIR = 27_500;
/** Listings per browse page. */
export const MARKET_PAGE_SIZE = 50;

/** The largest single ledger amount, credit or debit, games included; an owner reset is the one exception. */
export const MAX_ENTRY_AMOUNT = 1_000_000;
/** The largest balance; with `MAX_ENTRY_AMOUNT` it keeps every sum inside a Postgres `integer`. */
export const MAX_BALANCE = 1_000_000_000;

/** The range of house edge, in basis points, that the games of items 5 and 6 must land in. */
export const HOUSE_EDGE = { min: 300, max: 500 } as const;
/** A prize pack's value in the games' house-edge check: what the shop charges for one. */
export const PRIZE_PACK_VALUE = THEMED_PACK_PRICE;
