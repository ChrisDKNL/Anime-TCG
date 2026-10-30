/**
 * Every string of the collection overview, verbatim from
 * docs/design/collection-overview.md §8. Every number in them is the
 * server's; the functions only format it. AniList strings go into plain
 * strings (an `aria-label`, a `title`, an `<option>`) isolated (§5.6 rule 3);
 * sentences shown as markup take them raw, through `LoginText`, which puts
 * them in a `<bdi>`. The economy's strings (List on the market, Recycle for
 * Karma) arrive with the PRs that add those sections to the card dialog
 * (§3.4 step 4). The copy test renders every string and scans it for the
 * words §8 forbids.
 */

import type { Rarity } from "@anime-tcg/shared/api";
import { RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { isolate } from "./bidi";
import { cardCount, common, shortDate } from "./copy";
import type { CardSort, SeriesSort } from "./collectionView";
import { formatCount, plural } from "./packsCopy";

/** `<HH:MM>` (§8). */
const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/** §5.6 rule 5: series option labels are cut at 60 grapheme clusters. */
export const OPTION_TITLE_GRAPHEMES = 60;

/** The first `max` grapheme clusters of `text` and `…`, or `text` when it is no longer. */
export function clip(text: string, max: number): string {
  const graphemes = [...GRAPHEMES.segment(text)];
  if (graphemes.length <= max) return text;
  return `${graphemes
    .slice(0, max)
    .map(({ segment }) => segment)
    .join("")}…`;
}

/** `<title>`, or `<title>, <startYear>` when another series shares the title (§8 Series view, Toolbar). */
export function seriesTitle(title: string, year: number | null): string {
  return year === null ? title : `${title}, ${year}`;
}

const figure = (owned: number, total: number) => `${formatCount(owned)} of ${formatCount(total)}`;

const SORT_LABEL: Record<CardSort, string> = {
  rarity: "Rarity, rarest first",
  name: "Name, A to Z",
  newest: "Newest first",
  copies: "Most copies",
};

const SERIES_SORT_LABEL: Record<SeriesSort, string> = {
  popular: "Most popular first",
  title: "Title, A to Z",
};

export const pageCopy = {
  loading: "Loading your collection…",
  filters: "Collection filters",
  empty: "No cards yet",
  openAPack: "Open a pack",
  error: "Couldn't load your collection.",
  tryAgain: "Try again",
} as const;

export const statsCopy = {
  completion: (owned: number, total: number) => `${figure(owned, total)} characters`,
  percent: (pct: number) => `${pct}%`,
  /** With a series filter in the Cards view; `title` goes in a `<bdi>`, or isolated in a `title`. */
  series: (title: string, owned: number, total: number) => `${title}: ${figure(owned, total)} characters`,
  totals: (cards: number, duplicates: number) => `${cardCount(cards)} · ${statsCopy.duplicates(duplicates)}`,
  duplicates: (n: number) => (n === 0 ? "No duplicates" : plural(n, "duplicate", "duplicates")),
  stale: (at: Date) => `Showing your collection as of ${CLOCK.format(at)}.`,
} as const;

export const viewCopy = {
  group: "View",
  cards: "Cards",
  series: "Series",
} as const;

export const seriesViewCopy = {
  heading: "Series completion",
  sortLabel: "Sort",
  sort: (sort: SeriesSort) => SERIES_SORT_LABEL[sort],
  figure,
  showCards: "Show cards",
  showCardsName: (title: string) => `Show cards from ${isolate(title)}`,
  source: (rows: number, takenAt: string) =>
    `${formatCount(rows)} series from the 100 most popular anime on AniList, as of ${shortDate(takenAt)}.`,
  /** In place of the sort, the rows and the source line while no snapshot is held (§4.1). */
  noSnapshot: "Series totals appear when the card pool is available.",
} as const;

export const toolbarCopy = {
  searchLabel: "Search",
  searchPlaceholder: "Name or series",
  rarityLabel: "Rarity",
  allRarities: "All",
  rarity: (rarity: Rarity) => RARITY_LABEL[rarity],
  seriesLabel: "Series",
  allSeries: "All series",
  /** `<title> · <owned>/<total>`, or `<title>` alone for a series no longer in the current snapshot. */
  seriesOption: (title: string, year: number | null, completion: { owned: number; total: number } | null) => {
    const name = isolate(clip(seriesTitle(title, year), OPTION_TITLE_GRAPHEMES));
    return completion === null
      ? name
      : `${name} · ${formatCount(completion.owned)}/${formatCount(completion.total)}`;
  },
  duplicatesOnly: "Duplicates only",
  sortLabel: "Sort",
  sort: (sort: CardSort) => SORT_LABEL[sort],
  clear: "Clear filters",
} as const;

export const resultsCopy = {
  line: (results: number, page: number, pages: number) => {
    const count = plural(results, "result", "results");
    return pages > 1 ? `${count} · page ${formatCount(page)} of ${formatCount(pages)}` : count;
  },
  /** What the live region says for a line of zero results. */
  none: "No results",
  pages: "Pages",
  previous: "Previous",
  previousName: "Previous page",
  next: "Next",
  nextName: "Next page",
  page: "Page",
  of: (pages: number) => `of ${formatCount(pages)}`,
  /** `query` goes in a `<bdi>`: it is the player's text as typed. */
  noMatchQuery: (query: string) => `No cards match "${query}".`,
  noMatchFilters: "No cards match these filters.",
  clear: toolbarCopy.clear,
} as const;

export const tileCopy = {
  copies: (n: number) => plural(n, "copy", "copies"),
  /** The tile button's name: `<name>, <Rarity>, <series>, <copies>`. */
  label: (name: string, rarity: Rarity, series: string | null, count: number) =>
    [
      isolate(name),
      RARITY_LABEL[rarity],
      ...(series === null ? [] : [isolate(series)]),
      tileCopy.copies(count),
    ].join(", "),
  count: (n: number) => `×${formatCount(n)}`,
} as const;

export const dialogCopy = {
  close: common.close,
  alsoIn: "Also in",
  more: (n: number) => `and ${formatCount(n)} more`,
  facts: {
    rarity: "Rarity",
    copies: "Copies",
    firstObtained: "First obtained",
    lastObtained: "Last obtained",
  },
  date: shortDate,
  /** `name` goes in a `<bdi>`. */
  tierMoved: (name: string, tier: Rarity) => `Packs now give ${name} as ${RARITY_LABEL[tier]}.`,
  outOfPool: "No longer in packs. Doesn't count toward completion.",
  gone: "You no longer have this card.",
  goneClose: common.close,
} as const;
