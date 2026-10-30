import type { CollectionResponse, FranchiseCompletion, FranchiseRef } from "@anime-tcg/shared/api";
import { compareText, type IndexedEntry, type SeriesSort } from "./collectionView";

/**
 * Series (AniList franchises) as the overview lists them (collection-overview.md
 * §3.2, §3.3): the series filter's options and the Series view's rows. Every
 * figure is the server's `completion.franchises`; this module only picks,
 * orders and names them.
 */

/** A franchise with what its name needs on screen: its start year when another franchise shares its title. */
export interface SeriesName {
  franchise: FranchiseRef;
  /** Set only when the title is shared and the server gives a year (§3.3 "Series"). */
  year: number | null;
}

/** The completion row of a franchise of the current snapshot; a franchise without one is no longer in it. */
export type Completions = ReadonlyMap<number, FranchiseCompletion>;

export function completionsOf(data: CollectionResponse): Completions {
  return new Map(data.completion.franchises.map((row) => [row.franchiseId, row]));
}

/** Titles that more than one franchise of the answer carries. */
function sharedTitles(franchises: readonly FranchiseRef[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const { title } of franchises) {
    if (seen.has(title)) shared.add(title);
    seen.add(title);
  }
  return shared;
}

/** Names every franchise of the answer, keyed by id, with the year where its title is shared. */
export function seriesNames(data: CollectionResponse): ReadonlyMap<number, SeriesName> {
  const shared = sharedTitles(data.franchises);
  return new Map(
    data.franchises.map((franchise) => [
      franchise.id,
      { franchise, year: shared.has(franchise.title) ? franchise.startYear : null },
    ]),
  );
}

export interface SeriesOption {
  name: SeriesName;
  /** Null for a franchise no longer in the current snapshot: its option has no figure. */
  completion: FranchiseCompletion | null;
}

/**
 * §3.3 "Series": every franchise a held entry names, by title; the selected
 * one stays while selected, even once no entry names it.
 */
export function seriesOptions(
  index: readonly IndexedEntry[],
  names: ReadonlyMap<number, SeriesName>,
  completions: Completions,
  selected: number | null,
): SeriesOption[] {
  const ids = new Set(index.flatMap(({ entry }) => entry.character.franchiseIds));
  if (selected !== null) ids.add(selected);
  return [...ids]
    .flatMap((id) => {
      const name = names.get(id);
      return name === undefined ? [] : [{ name, completion: completions.get(id) ?? null }];
    })
    .sort(
      (a, b) =>
        compareText(a.name.franchise.title, b.name.franchise.title) ||
        (a.name.year ?? 0) - (b.name.year ?? 0) ||
        a.name.franchise.id - b.name.franchise.id,
    );
}

export interface SeriesRow {
  name: SeriesName;
  completion: FranchiseCompletion;
}

/** §3.2 step 5: every completion row, most popular first (the server's order) or by title. */
export function seriesRows(
  data: CollectionResponse,
  names: ReadonlyMap<number, SeriesName>,
  sort: SeriesSort,
): SeriesRow[] {
  const rows = data.completion.franchises.flatMap((completion) => {
    const name = names.get(completion.franchiseId);
    return name === undefined ? [] : [{ name, completion }];
  });
  if (sort === "popular") return rows;
  // Stable: titles that compare equal keep the server's order between them.
  return rows.toSorted((a, b) => compareText(a.name.franchise.title, b.name.franchise.title));
}

/** §3.2 step 1: rounded down, so `100%` appears only when it is true. */
export function completionPercent(owned: number, total: number): number {
  return total === 0 ? 0 : Math.floor((owned * 100) / total);
}
