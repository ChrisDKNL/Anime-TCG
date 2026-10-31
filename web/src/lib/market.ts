import type {
  CollectionEntry,
  FranchiseRef,
  KarmaRules,
  Listing,
  ListingSort,
  ListingsPage,
  ListingsQuery,
  Rarity,
} from "@anime-tcg/shared/api";
import type { MarketLimit } from "@anime-tcg/shared/errors";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { SEARCH_MAX_LENGTH } from "./collectionSearch";
import { MAX_WAIT_SECONDS, RATE_LIMITED_FALLBACK_SECONDS } from "./failures";

/**
 * The market's view of the server's answers (market-and-shop.md §3.4 to
 * §3.6, collection-overview.md §3.5): the toolbar's state and the request it
 * makes, the pages it shows, and what the card dialog's List on the market
 * offers. Display, not decisions: every price, fee, limit and outcome is the
 * server's. The one sum is the fee preview, the wallet's published rule
 * (collection-overview.md §3.5 step 2), which the listing's own `fee` replaces.
 * The controls live in the signed-in layout (navigation-and-landing.md §3.10),
 * never in the address or in storage.
 */

export type MarketView = "browse" | "mine";

export const LISTING_SORTS = ["price_asc", "price_desc", "newest"] as const satisfies readonly ListingSort[];

/** The character filter: set only from the card dialog, with the name its line shows (§3.4 step 3). */
export interface MarketCharacter {
  id: number;
  name: string;
}

export interface MarketControls {
  view: MarketView;
  /** The search field's text, as typed. */
  query: string;
  /** What the request's `q` carries: the field's text cleaned (`searchText`), 300 ms after the last keystroke. */
  sent: string;
  /** One tier per request (§3.4 step 3), or null for `All rarities`. */
  rarity: Rarity | null;
  /** The selected series, title included, so it stays in the list while selected after its last listing goes. */
  series: FranchiseRef | null;
  sort: ListingSort;
  character: MarketCharacter | null;
}

export const DEFAULT_MARKET: MarketControls = {
  view: "browse",
  query: "",
  sent: "",
  rarity: null,
  series: null,
  sort: "price_asc",
  character: null,
};

export type MarketAction =
  | { type: "view"; view: MarketView }
  | { type: "query"; query: string }
  /** The search settled: what the field holds becomes the request's `q`. */
  | { type: "send" }
  | { type: "rarity"; rarity: Rarity | null }
  | { type: "series"; series: FranchiseRef | null }
  | { type: "sort"; sort: ListingSort }
  /** `See <name> on the market` (collection-overview.md §3.5 step 1): Browse, that character only. */
  | { type: "showCharacter"; character: MarketCharacter }
  /** `Show all` beside the character line. */
  | { type: "clearCharacter" }
  /** Search, rarity, series and character; never the sort (§3.4 step 3). */
  | { type: "clearFilters" };

const FILTER_DEFAULTS = {
  query: DEFAULT_MARKET.query,
  sent: DEFAULT_MARKET.sent,
  rarity: DEFAULT_MARKET.rarity,
  series: DEFAULT_MARKET.series,
  character: DEFAULT_MARKET.character,
} as const;

export function marketReducer(state: MarketControls, action: MarketAction): MarketControls {
  switch (action.type) {
    case "view":
      return { ...state, view: action.view };
    case "query":
      return { ...state, query: action.query };
    case "send": {
      const sent = searchText(state.query);
      return sent === state.sent ? state : { ...state, sent };
    }
    case "rarity":
      return { ...state, rarity: action.rarity };
    case "series":
      return { ...state, series: action.series };
    case "sort":
      return { ...state, sort: action.sort };
    case "showCharacter":
      // The other filters could hide the character the player asked to see, so they go with it.
      return { ...state, ...FILTER_DEFAULTS, view: "browse", character: action.character };
    case "clearCharacter":
      return { ...state, character: null };
    case "clearFilters":
      return { ...state, ...FILTER_DEFAULTS };
  }
}

/** `\p{Cc}`, U+0000 to U+001F and U+007F to U+009F: `ListingsQuery.q` takes none, and a name never holds one. */
const CONTROL_CHARACTER = /^\p{Cc}$/u;

/**
 * The search text a request carries (§3.4 step 3): control characters (a
 * pasted tab) become spaces, which the server's normalisation folds anyway,
 * then trimmed and at most `SEARCH_MAX_LENGTH` characters; empty is no `q`.
 */
export function searchText(query: string): string {
  const cleaned = [...query].map((ch) => (CONTROL_CHARACTER.test(ch) ? " " : ch)).join("");
  return [...cleaned.trim()].slice(0, SEARCH_MAX_LENGTH).join("").trim();
}

/** The request's parameters for the controls, without a cursor; ids go as digit strings, as the api reads them. */
export function listingsQuery(controls: MarketControls): ListingsQuery {
  const query: ListingsQuery = { sort: controls.sort };
  if (controls.rarity !== null) query.rarity = controls.rarity;
  if (controls.series !== null) query.franchiseId = String(controls.series.id);
  if (controls.character !== null) query.characterId = String(controls.character.id);
  if (controls.sent !== "") query.q = controls.sent;
  return query;
}

/** Whether the search or any filter differs from its default: `Clear filters` shows (§3.4 step 3). */
export function filtersActive(controls: MarketControls): boolean {
  return (
    searchText(controls.query) !== "" ||
    controls.sent !== "" ||
    controls.rarity !== null ||
    controls.series !== null ||
    controls.character !== null
  );
}

/** The pages' listings in order, each once even when a later page repeats it (§3.4 step 4). */
export function shownListings(pages: readonly ListingsPage[]): Listing[] {
  const seen = new Set<string>();
  const shown: Listing[] = [];
  for (const page of pages) {
    for (const listing of page.listings) {
      if (seen.has(listing.listingId)) continue;
      seen.add(listing.listingId);
      shown.push(listing);
    }
  }
  return shown;
}

/** The pages without one listing: it sold, was bought here, or is gone (§3.5 step 4). */
export function withoutListing(pages: readonly ListingsPage[], listingId: string): ListingsPage[] {
  return pages.map((page) =>
    page.listings.some((listing) => listing.listingId === listingId)
      ? { ...page, listings: page.listings.filter((listing) => listing.listingId !== listingId) }
      : page,
  );
}

/** Every franchise the pages name, by id. */
export function franchisesOf(pages: readonly ListingsPage[]): Map<number, FranchiseRef> {
  return new Map(pages.flatMap((page) => page.franchises.map((franchise) => [franchise.id, franchise])));
}

/**
 * The series options (§3.4 step 3): the first page's `filterFranchiseIds`, in
 * the server's popularity order, named through its `franchises`; the selected
 * series stays while selected, even once its last listing has gone.
 */
export function seriesOptions(
  first: ListingsPage | undefined,
  selected: FranchiseRef | null,
): FranchiseRef[] {
  const named = first === undefined ? new Map<number, FranchiseRef>() : franchisesOf([first]);
  const options = (first?.filterFranchiseIds ?? []).flatMap((id) => named.get(id) ?? []);
  if (selected !== null && !options.some((franchise) => franchise.id === selected.id)) options.push(selected);
  return options;
}

/** Basis points in a whole, the unit of `feeBps`. */
const BPS_PER_WHOLE = 10_000;

/**
 * The fee preview (collection-overview.md §3.5 step 2): `max(feeMin, ceil(price ×
 * feeBps / 10 000))` with the wallet's published `feeBps` and `feeMin`. The one
 * sum the UI works out before the server answers; the listing's `fee` counts.
 */
export function feePreview(price: number, rules: Pick<KarmaRules, "feeBps" | "feeMin">): number {
  return Math.max(rules.feeMin, Math.ceil((price * rules.feeBps) / BPS_PER_WHOLE));
}

/** The `Price` field's number, checked on submit (§3.5 step 4): digits only after trimming, within the bounds; else null. */
export function parsePrice(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= min && n <= max ? n : null;
}

/** What List on the market offers for an entry (§3.5 steps 1 and 3); neither check is authoritative. */
export type ListRange =
  | { kind: "open"; min: number; max: number }
  /** Every copy is listed already, or the account is at the listing cap. */
  | { kind: "closed"; reason: "noneAvailable" | "cap" };

export function listRange(
  entry: Pick<CollectionEntry, "rarity" | "available">,
  activeListings: number,
  rules: Pick<KarmaRules, "priceMin" | "priceMax" | "maxListings">,
): ListRange {
  if (entry.available < 1) return { kind: "closed", reason: "noneAvailable" };
  if (activeListings >= rules.maxListings) return { kind: "closed", reason: "cap" };
  return { kind: "open", min: rules.priceMin[entry.rarity], max: rules.priceMax[entry.rarity] };
}

/** The listing confirmation's last-copy sentence, at most one (§3.5 step 6). */
export type LastCopy = "onlyCopy" | "onlyCopyOutOfPool" | "allOfRarity" | null;

export function lastCopy(
  entry: Pick<CollectionEntry, "character" | "available">,
  entries: readonly Pick<CollectionEntry, "character" | "count">[],
): LastCopy {
  const held = entries
    .filter((other) => other.character.id === entry.character.id)
    .reduce((sum, other) => sum + other.count, 0);
  if (held === 1) return entry.character.inCurrentSnapshot ? "onlyCopy" : "onlyCopyOutOfPool";
  return entry.available === 1 ? "allOfRarity" : null;
}

/** The player's entries of a character, rarest first: the listing dialog's `In your collection` lines (§3.4 step 7). */
export function heldEntries(characterId: number, entries: readonly CollectionEntry[]): CollectionEntry[] {
  return entries
    .filter((entry) => entry.character.id === characterId)
    .toSorted((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
}

/**
 * A `market_limit` refusal (§3.5 step 4): which limit, when it frees up on the
 * wall clock (for the date the line names, which can be days away), and until
 * when the confirm button stays disabled, on `performance.now()`, capped at
 * `MAX_WAIT_SECONDS`: a wait of days reads as broken, and the next press asks
 * the server again anyway.
 */
export interface LimitBlock {
  limit: MarketLimit;
  freesAt: Date;
  until: number;
}

const SECOND_MS = 1000;

export function limitBlock(
  limit: MarketLimit | undefined,
  retryAfterSeconds: number | undefined,
  now: { wall: number; monotonic: number },
): LimitBlock | null {
  if (limit === undefined) return null;
  // 0, missing or not a whole number counts as missing: the fallback (manager decision, 2026-10-30).
  const seconds =
    retryAfterSeconds !== undefined && Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 1
      ? retryAfterSeconds
      : RATE_LIMITED_FALLBACK_SECONDS;
  return {
    limit,
    freesAt: new Date(now.wall + seconds * SECOND_MS),
    until: now.monotonic + Math.min(seconds, MAX_WAIT_SECONDS) * SECOND_MS,
  };
}

/** The buyer's own limits hold for every listing; the seller's and the pair's only for that seller's. */
export function blocksEveryListing(limit: MarketLimit): boolean {
  return limit === "buyer_purchases" || limit === "buyer_spend";
}
