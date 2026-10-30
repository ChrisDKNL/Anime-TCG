import type { CollectionResponse } from "@anime-tcg/shared/api";
import { useDeferredValue, useMemo } from "react";
import {
  completionsOf,
  seriesNames,
  seriesOptions,
  seriesRows,
  type Completions,
  type SeriesName,
  type SeriesOption,
  type SeriesRow,
} from "../lib/collectionSeries";
import {
  clampPage,
  filterEntries,
  indexCollection,
  pageCount,
  pageOf,
  sortEntries,
  type IndexedEntry,
  type OverviewControls,
} from "../lib/collectionView";

export interface OverviewModel {
  /** Every entry by key, for the card dialog and the grid frozen behind it. */
  byKey: ReadonlyMap<string, IndexedEntry>;
  names: ReadonlyMap<number, SeriesName>;
  completions: Completions;
  /** The entries that match, in the chosen order. */
  results: IndexedEntry[];
  /** The page shown: the chosen one, clamped to the pages there are. */
  page: number;
  pages: number;
  pageEntries: IndexedEntry[];
  seriesOptions: SeriesOption[];
  seriesRows: SeriesRow[];
}

/**
 * The overview's view of one collection answer (collection-overview.md §3.3,
 * §5.5): the search fields and series names are built once per answer, the
 * order once per sort, and a keystroke only filters what is already sorted.
 */
export function useCollectionOverview(data: CollectionResponse, controls: OverviewControls): OverviewModel {
  const index = useMemo(() => indexCollection(data), [data]);
  const byKey = useMemo(() => new Map(index.map((entry) => [entry.key, entry])), [index]);
  const names = useMemo(() => seriesNames(data), [data]);
  const completions = useMemo(() => completionsOf(data), [data]);
  const sorted = useMemo(() => sortEntries(index, controls.sort), [index, controls.sort]);

  const { rarities, series, duplicatesOnly, seriesSort } = controls;
  // A keystroke renders the field at once; the grid follows in a render typing can interrupt, since a
  // new page of 60 cards costs far more than the search over the entries does (§5.5).
  const query = useDeferredValue(controls.query);
  const results = useMemo(
    () => filterEntries(sorted, { query, rarities, series, duplicatesOnly }),
    [sorted, query, rarities, series, duplicatesOnly],
  );
  const options = useMemo(
    () => seriesOptions(index, names, completions, series),
    [index, names, completions, series],
  );
  const rows = useMemo(() => seriesRows(data, names, seriesSort), [data, names, seriesSort]);

  const pages = pageCount(results.length);
  const page = clampPage(controls.page, pages);
  const pageEntries = useMemo(() => pageOf(results, page), [results, page]);

  return {
    byKey,
    names,
    completions,
    results,
    page,
    pages,
    pageEntries,
    seriesOptions: options,
    seriesRows: rows,
  };
}
