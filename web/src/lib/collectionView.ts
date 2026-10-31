import type { CollectionEntry, CollectionResponse, FranchiseRef, Rarity } from "@anime-tcg/shared/api";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { normaliseSearchText, searchTermsOf } from "@anime-tcg/shared/search";
import { matchesTerms } from "./collectionSearch";

/**
 * The collection overview's view of the server's answer (collection-overview.md
 * §3.3): search, filters, sort and pages, all run over the entries the server
 * returned. They are display, not decisions: nothing here counts a card, a
 * completion figure or an outcome. The controls live in the signed-in layout
 * (navigation-and-landing.md §3.10), never in the address or in storage.
 */

/** §5.5: 60 fills whole rows at 2, 3, 4, 5 and 6 columns. */
export const PAGE_SIZE = 60;

export const CARD_SORTS = ["rarity", "name", "newest", "copies"] as const;
export type CardSort = (typeof CARD_SORTS)[number];

export const SERIES_SORTS = ["popular", "title"] as const;
export type SeriesSort = (typeof SERIES_SORTS)[number];

export type CollectionTab = "cards" | "series";

/** The view switch's order (§3.2 step 5); `viewCopy` names them. */
export const COLLECTION_TABS: readonly CollectionTab[] = ["cards", "series"];

export interface OverviewControls {
  tab: CollectionTab;
  query: string;
  /** The pressed tier chips; none pressed is `All`. */
  rarities: readonly Rarity[];
  /** The selected franchise id, or null for `All series`. */
  series: number | null;
  duplicatesOnly: boolean;
  sort: CardSort;
  seriesSort: SeriesSort;
  /** From 1; clamped to the pages there are when a refetch leaves fewer (§3.3 "Pages"). */
  page: number;
}

export const DEFAULT_CONTROLS: OverviewControls = {
  tab: "cards",
  query: "",
  rarities: [],
  series: null,
  duplicatesOnly: false,
  sort: "rarity",
  seriesSort: "popular",
  page: 1,
};

export type ControlsAction =
  | { type: "tab"; tab: CollectionTab }
  | { type: "query"; query: string }
  | { type: "toggleRarity"; rarity: Rarity }
  | { type: "allRarities" }
  | { type: "series"; series: number | null }
  | { type: "duplicatesOnly"; on: boolean }
  | { type: "sort"; sort: CardSort }
  | { type: "seriesSort"; sort: SeriesSort }
  | { type: "page"; page: number }
  /** A refetch left fewer pages than the chosen one: the page shown, clamped, becomes the chosen one (§3.3 "Pages"). */
  | { type: "clampPage"; pages: number }
  | { type: "clearFilters" }
  /** The Series view's `Show cards` (§3.2 step 5). */
  | { type: "showSeries"; series: number };

const FILTER_DEFAULTS = {
  query: DEFAULT_CONTROLS.query,
  rarities: DEFAULT_CONTROLS.rarities,
  series: DEFAULT_CONTROLS.series,
  duplicatesOnly: DEFAULT_CONTROLS.duplicatesOnly,
} as const;

/** Every change except paging returns to page 1 (§3.3). */
export function controlsReducer(state: OverviewControls, action: ControlsAction): OverviewControls {
  switch (action.type) {
    case "tab":
      return { ...state, tab: action.tab };
    case "query":
      return { ...state, query: action.query, page: 1 };
    case "toggleRarity": {
      const pressed = state.rarities.includes(action.rarity);
      const rarities = pressed
        ? state.rarities.filter((rarity) => rarity !== action.rarity)
        : [...state.rarities, action.rarity];
      return { ...state, rarities, page: 1 };
    }
    case "allRarities":
      return { ...state, rarities: [], page: 1 };
    case "series":
      return { ...state, series: action.series, page: 1 };
    case "duplicatesOnly":
      return { ...state, duplicatesOnly: action.on, page: 1 };
    case "sort":
      return { ...state, sort: action.sort, page: 1 };
    case "seriesSort":
      return { ...state, seriesSort: action.sort };
    case "page":
      return { ...state, page: action.page };
    case "clampPage": {
      const page = clampPage(state.page, action.pages);
      return page === state.page ? state : { ...state, page };
    }
    case "clearFilters":
      return { ...state, ...FILTER_DEFAULTS, page: 1 };
    case "showSeries":
      return { ...state, ...FILTER_DEFAULTS, tab: "cards", series: action.series, page: 1 };
  }
}

/** Whether the search or any filter differs from its default; the sort is not a filter (§3.3 `Clear filters`). */
export function filtersActive(controls: OverviewControls): boolean {
  return (
    searchTermsOf(controls.query).length > 0 ||
    controls.rarities.length > 0 ||
    controls.series !== null ||
    controls.duplicatesOnly
  );
}

/** One entry with what the view derives from it once per answer (§3.3 step 5). */
export interface IndexedEntry {
  entry: CollectionEntry;
  key: string;
  /** The character's franchises the answer names, primary first. */
  franchises: FranchiseRef[];
  /** The primary franchise's title, the series on the card and in tie-breaks; null if the answer does not name it. */
  series: string | null;
  lastObtained: number;
  /** The normalised name, native name and every franchise's title and native title. */
  searchFields: string[];
}

/** An entry is one character at one granted rarity and variant (§3 terms). */
export function entryKey(entry: Pick<CollectionEntry, "character" | "rarity" | "variant">): string {
  return `${entry.character.id}:${entry.rarity}:${entry.variant}`;
}

export function indexCollection(data: CollectionResponse): IndexedEntry[] {
  const byId = new Map(data.franchises.map((franchise) => [franchise.id, franchise]));
  return data.entries.map((entry) => {
    const franchises = entry.character.franchiseIds.flatMap((id) => byId.get(id) ?? []);
    const primary = byId.get(entry.character.franchiseIds[0] ?? 0);
    const texts = [entry.character.name, entry.character.nameNative];
    for (const franchise of franchises) texts.push(franchise.title, franchise.titleNative);
    return {
      entry,
      key: entryKey(entry),
      franchises,
      series: primary?.title ?? null,
      lastObtained: Date.parse(entry.lastObtainedAt),
      searchFields: texts.flatMap((text) => (text === null ? [] : [normaliseSearchText(text)])),
    };
  });
}

/** §3.3 Sort: one collator for every name and title comparison. */
const COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function compareText(a: string, b: string): number {
  return COLLATOR.compare(a, b);
}

type Compare = (a: IndexedEntry, b: IndexedEntry) => number;

const tierStep = (rarity: Rarity) => RARITIES.indexOf(rarity);
const rarestFirst: Compare = (a, b) => tierStep(b.entry.rarity) - tierStep(a.entry.rarity);
const byName: Compare = (a, b) => compareText(a.entry.character.name, b.entry.character.name);
const bySeries: Compare = (a, b) => compareText(a.series ?? "", b.series ?? "");
const newestFirst: Compare = (a, b) => b.lastObtained - a.lastObtained;
const mostCopies: Compare = (a, b) => b.entry.count - a.entry.count;
/** The last tie-break everywhere, so every order is stable even for a character held at two rarities. */
const byIdThenRarity: Compare = (a, b) => a.entry.character.id - b.entry.character.id || rarestFirst(a, b);

const ORDER: Record<CardSort, Compare[]> = {
  rarity: [rarestFirst, byName, bySeries],
  name: [byName, rarestFirst, bySeries],
  newest: [newestFirst, rarestFirst, byName],
  copies: [mostCopies, rarestFirst, byName],
};

export function sortEntries(entries: readonly IndexedEntry[], sort: CardSort): IndexedEntry[] {
  const steps = [...ORDER[sort], byIdThenRarity];
  return entries.toSorted((a, b) => {
    for (const step of steps) {
      const order = step(a, b);
      if (order !== 0) return order;
    }
    return 0;
  });
}

/** What decides the results: the search and the three filters. */
export type OverviewFilters = Pick<OverviewControls, "query" | "rarities" | "series" | "duplicatesOnly">;

/** Search, rarity, series and duplicates combined with AND (§3.3); keeps the order it is given. */
export function filterEntries(entries: readonly IndexedEntry[], filters: OverviewFilters): IndexedEntry[] {
  const terms = searchTermsOf(filters.query);
  const { rarities, series, duplicatesOnly } = filters;
  return entries.filter(
    ({ entry, searchFields }) =>
      (rarities.length === 0 || rarities.includes(entry.rarity)) &&
      (series === null || entry.character.franchiseIds.includes(series)) &&
      (!duplicatesOnly || entry.count >= 2) &&
      matchesTerms(searchFields, terms),
  );
}

export function pageCount(results: number): number {
  return Math.max(1, Math.ceil(results / PAGE_SIZE));
}

/** A refetch keeps the page and clamps it when the page no longer exists (§3.3 "Pages"). */
export function clampPage(page: number, pages: number): number {
  return Math.min(Math.max(1, page), pages);
}

export function pageOf<T>(items: readonly T[], page: number): T[] {
  return items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}
