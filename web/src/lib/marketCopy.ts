/**
 * Every string of the market UI (economy PR 4): the Market page's Browse and
 * My listings (docs/design/market-and-shop.md §8), the listing dialog and its
 * buy confirmation, and the card dialog's List on the market section
 * (collection-overview.md §8). Every amount in them is the server's: a price,
 * a fee, a balance, a limit's room or a rule from `GET /api/wallet`. The
 * functions only format them; the sums are the fee preview (the wallet's
 * published rule) and a listing's net, `price − fee` (§3.6 step 2), which the
 * caller passes in. AniList strings in a plain-string sink (an `aria-label`,
 * an `<option>`, the live region) are isolated; sentences shown as markup take
 * them raw through `LoginText`, which puts them in a `<bdi>`. No other
 * account's login appears anywhere: the server publishes none. The copy test
 * renders every string and scans it for the words §8 forbids.
 */

import type { ListingSort, Rarity, WindowLeft } from "@anime-tcg/shared/api";
import type { MarketLimit } from "@anime-tcg/shared/errors";
import { RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { isolate } from "./bidi";
import { clip, OPTION_TITLE_GRAPHEMES, seriesTitle } from "./collectionCopy";
import { amount, common, CURRENCY_NAME, formatCount, shortDate } from "./copy";
import { clockTime, dayMonth } from "./dates";
import { plural } from "./packsCopy";

const DAY_SECONDS = 86_400;
const HOUR_SECONDS = 3_600;

/** A rule's seconds in words (collection-overview.md §3.9): whole days when they divide, else hours. */
export function duration(seconds: number): string {
  if (seconds % DAY_SECONDS === 0) return plural(seconds / DAY_SECONDS, "day", "days");
  return plural(Math.max(1, Math.round(seconds / HOUR_SECONDS)), "hour", "hours");
}

/** `feeBps` as a percentage: 500 reads `5%`, 250 `2.5%`. */
const FEE_PERCENT = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 2 });
const BPS_PER_WHOLE = 10_000;

export function feePercent(feeBps: number): string {
  return FEE_PERCENT.format(feeBps / BPS_PER_WHOLE);
}

/** `<D Mon>, <HH:MM>`: a listing's end. */
const until = (iso: string) => `${dayMonth(iso)}, ${clockTime(iso)}`;

const SORT_LABEL: Record<ListingSort, string> = {
  price_asc: "Lowest price first",
  price_desc: "Highest price first",
  newest: "Newest first",
};

export const browseCopy = {
  views: { group: "View", browse: "Browse", mine: "My listings" },
  filters: "Market filters",
  searchLabel: "Search",
  searchPlaceholder: "Name or series",
  rarityLabel: "Rarity",
  allRarities: "All rarities",
  rarity: (rarity: Rarity) => RARITY_LABEL[rarity],
  seriesLabel: "Series",
  allSeries: "All series",
  /** An `<option>`: the title isolated and cut at 60 grapheme clusters, with its year when another shares it. */
  seriesOption: (title: string, year: number | null) =>
    isolate(clip(seriesTitle(title, year), OPTION_TITLE_GRAPHEMES)),
  sortLabel: "Sort",
  sort: (sort: ListingSort) => SORT_LABEL[sort],
  /** `name` goes in a `<bdi>`. */
  character: (name: string) => `Showing ${name} only.`,
  showAll: "Show all",
  clear: "Clear filters",
  results: (n: number) => (n === 1 ? "1 listing shown" : `${formatCount(n)} listings shown`),
  more: "Show more",
  loadingMore: "Loading…",
  moreFailed: "Couldn't load more.",
  tryAgain: "Try again",
  empty: "No cards on the market.",
  /** `query` goes in a `<bdi>`: the player's text as sent. */
  noMatchQuery: (query: string) => `No listings match "${query}".`,
  noMatchFilters: "No listings match these filters.",
  loading: "Loading the market…",
  error: "Couldn't load the market.",
} as const;

export const listingTileCopy = {
  price: amount,
  until: (iso: string) => `Until ${until(iso)}`,
  yours: "Yours",
  /** The tile button's name: `<name>, <Rarity>, <series>, <price> Karma`, then `, yours` for the player's own. */
  label: (name: string, rarity: Rarity, series: string | null, price: number, mine: boolean) =>
    [
      isolate(name),
      RARITY_LABEL[rarity],
      ...(series === null ? [] : [isolate(series)]),
      amount(price),
      ...(mine ? ["yours"] : []),
    ].join(", "),
} as const;

export const listingDialogCopy = {
  close: common.close,
  facts: { rarity: "Rarity", price: "Price", until: "Until" },
  price: amount,
  until,
  inCollection: (rarity: Rarity, count: number) =>
    `In your collection: ${RARITY_LABEL[rarity]} ×${formatCount(count)}`,
  notInCollection: "Not in your collection.",
  yours: "This is your listing.",
  cancelListing: "Cancel listing",
  cancelling: "Cancelling…",
  buy: "Buy…",
  tooLittle: (price: number, balance: number) => `Costs ${amount(price)}. You have ${formatCount(balance)}.`,
  stale: "Buying waits until the game server answers.",
} as const;

const LIMIT_TIME = (at: Date) => `${dayMonth(at)} at ${clockTime(at)}`;

export const buyCopy = {
  /** `name` goes in a `<bdi>`. */
  confirmHeading: (name: string, price: number) => `Buy ${name} for ${amount(price)}?`,
  confirmBody: (rarity: Rarity, balance: number) =>
    `One ${RARITY_LABEL[rarity]} card. You have ${amount(balance)}. There is no undo.`,
  confirm: (price: number) => `Buy for ${amount(price)}`,
  buying: "Buying…",
  cancel: common.cancel,
  /** `name` goes in a `<bdi>`. */
  resultHeading: (name: string) => `${name} is in your collection`,
  newMarker: "New",
  bought: (price: number, balance: number) => `Bought for ${amount(price)}. You have ${amount(balance)}.`,
  close: common.close,
  gone: "This card is no longer on the market.",
  tooLittleRefused: (price: number, balance: number) =>
    `This card costs ${amount(price)}. You have ${amount(balance)}.`,
  /** `market_limit` by the limit it names; `windowSeconds` is `rules.window.seconds`, null before the wallet's first answer. */
  limit: (limit: MarketLimit, windowSeconds: number | null, freesAt: Date) => {
    switch (limit) {
      case "buyer_purchases":
      case "buyer_spend":
        return windowSeconds === null
          ? `Your market limit is used up. It frees up on ${LIMIT_TIME(freesAt)}.`
          : `Your market limit for the last ${duration(windowSeconds)} is used up. It frees up on ${LIMIT_TIME(freesAt)}.`;
      case "seller_proceeds":
        return `This seller can't take more sales right now. Try again on ${LIMIT_TIME(freesAt)}.`;
      case "pair":
        return `You've bought as much from this seller as the market allows for now. Try again on ${LIMIT_TIME(freesAt)}.`;
    }
  },
} as const;

export const mineCopy = {
  /** `max` is `rules.maxListings`, null before the wallet's first answer. */
  activeHeading: (n: number, max: number | null) =>
    max === null
      ? `On the market, ${formatCount(n)}`
      : `On the market, ${formatCount(n)} of ${formatCount(max)}`,
  price: amount,
  fee: (fee: number, net: number) => `Fee ${amount(fee)} · you get ${amount(net)}`,
  until: (iso: string) => `Until ${until(iso)}`,
  cancel: "Cancel listing",
  /** The button's accessible name, a plain string: the name is isolated. */
  cancelName: (name: string) => `Cancel listing of ${isolate(name)}`,
  cancelling: "Cancelling…",
  activeEmpty: "Nothing on the market.",
  /** `windowSeconds` is `rules.window.seconds`, null before the wallet's first answer. */
  limitsHeading: (windowSeconds: number | null) =>
    windowSeconds === null ? "Market limits" : `Market limits, last ${duration(windowSeconds)}`,
  limits: (left: WindowLeft) =>
    `You can buy ${plural(left.purchases, "more card", "more cards")} and spend ${formatCount(left.spend)} more ${CURRENCY_NAME}, and receive ${formatCount(left.proceeds)} more ${CURRENCY_NAME} from sales.`,
  closedHeading: "Closed in the last 30 days",
  sold: (price: number, proceeds: number) => `Sold for ${amount(price)} · you got ${amount(proceeds)}`,
  /** A sale whose proceeds the answer does not carry (never expected: `proceeds` is set on every sale). */
  soldFor: (price: number) => `Sold for ${amount(price)}`,
  cancelled: "Cancelled",
  expired: "Expired",
  boughtHeading: "Bought in the last 30 days",
  empty: "Nothing in the last 30 days.",
  date: shortDate,
  loading: "Loading your listings…",
  error: "Couldn't load your listings.",
  tryAgain: "Try again",
} as const;

/** The cancel's answers (§3.6 step 3), on My listings and in the listing dialog. */
export const cancelCopy = {
  /** `name` goes in a `<bdi>`. */
  cancelled: (name: string) => `Listing cancelled. ${name} is available again.`,
  alreadyEnded: "That listing had already ended.",
  soldFirst: "It sold before the cancel arrived.",
  gone: "That listing is gone.",
} as const;

export const listCopy = {
  heading: "List on the market",
  priceLabel: "Price",
  /** The word after the field: a label, not an amount. */
  afterField: CURRENCY_NAME,
  hint: (min: number, max: number) => `${formatCount(min)} to ${amount(max)}`,
  fee: (fee: number, feeBps: number, net: number) =>
    `Fee ${amount(fee)} (${feePercent(feeBps)}). You get ${amount(net)} if it sells.`,
  priceError: (min: number, max: number) =>
    `Choose a whole number from ${formatCount(min)} to ${formatCount(max)}.`,
  button: "List…",
  noneAvailable: "Every copy is already on the market.",
  /** `name` goes in a `<bdi>`. */
  marketLink: (name: string) => `See ${name} on the market`,
  /** `name` goes in a `<bdi>`. */
  confirmHeading: (name: string, price: number) => `List ${name} for ${amount(price)}?`,
  /**
   * The body (§3.5 step 5); `name` goes in a `<bdi>` and appears only in the only-copy sentences.
   * `ttlSeconds` is `rules.listingTtlSeconds`; `fee` the preview of the price confirmed.
   */
  confirmBody: (
    name: string,
    body: {
      rarity: Rarity;
      ttlSeconds: number;
      net: number;
      fee: number;
      lastCopy: "onlyCopy" | "onlyCopyOutOfPool" | "allOfRarity" | null;
    },
  ) => {
    const { rarity, ttlSeconds, net, fee, lastCopy } = body;
    const last = {
      onlyCopy: ` This is your only ${name}; once it sells, it stops counting toward completion.`,
      onlyCopyOutOfPool: ` This is your only ${name}, and packs no longer include this character.`,
      allOfRarity: ` That puts every ${RARITY_LABEL[rarity]} copy you have on the market.`,
    };
    return (
      `One ${RARITY_LABEL[rarity]} copy goes on the market for ${duration(ttlSeconds)}.` +
      ` If someone buys it, you get ${amount(net)} after the ${amount(fee)} fee.` +
      " It stays in your collection until it sells, and you can cancel the listing until then." +
      (lastCopy === null ? "" : last[lastCopy]) +
      " A sale can't be undone."
    );
  },
  confirm: (price: number) => `List for ${amount(price)}`,
  listing: "Listing…",
  cancel: common.cancel,
  listed: (price: number, fee: number, expiresAt: string) =>
    `Listed for ${amount(price)} until ${shortDate(expiresAt)}, ${clockTime(expiresAt)}. The fee is ${amount(fee)} if it sells.`,
  /**
   * `listing_limit` and the cap reason; `max` is `rules.maxListings`. The spec's `Cancel a listing to
   * list another.` would carry a nudge word the copy rules ban, so it names this card (manager
   * decision, 2026-10-30).
   */
  cap: (max: number) =>
    `You have ${plural(max, "card", "cards")} on the market, the most at once. Cancel a listing to list this card.`,
  myListings: "My listings",
} as const;
