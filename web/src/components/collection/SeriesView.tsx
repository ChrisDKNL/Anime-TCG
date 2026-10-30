import type { SnapshotInfo } from "@anime-tcg/shared/api";
import { useId } from "react";
import { isolate } from "../../lib/bidi";
import { seriesTitle, seriesViewCopy } from "../../lib/collectionCopy";
import type { SeriesRow } from "../../lib/collectionSeries";
import { SERIES_SORTS, type SeriesSort } from "../../lib/collectionView";
import { INPUT, INPUT_BORDER } from "../account/styles";
import { TEXT_BUTTON_SM } from "../packs/styles";
import { CompletionBar } from "./CollectionStats";
import { CONTROL_LABEL } from "./styles";

interface Props {
  rows: readonly SeriesRow[];
  snapshot: SnapshotInfo | null;
  sort: SeriesSort;
  onSort: (sort: SeriesSort) => void;
  onShowCards: (franchiseId: number) => void;
}

function isSeriesSort(value: string): value is SeriesSort {
  return (SERIES_SORTS as readonly string[]).includes(value);
}

/**
 * The Series view (collection-overview.md §3.2 step 5, §5.3): every series
 * of the current snapshot with the server's figure and a bar, `0 of N` rows
 * included and shown like any other. No paging: there are fewer than 100.
 * With no snapshot there is no series to complete: one line says so (§4.1).
 */
export function SeriesView({ rows, snapshot, sort, onSort, onShowCards }: Props) {
  const id = useId();
  const headingId = `${id}-heading`;
  const sortId = `${id}-sort`;
  if (snapshot === null) {
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="sr-only">
          {seriesViewCopy.heading}
        </h2>
        <p className="mt-4 text-sm text-zinc-400">{seriesViewCopy.noSnapshot}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        {seriesViewCopy.heading}
      </h2>
      <div className="mt-4 flex w-48 flex-col gap-1">
        <label htmlFor={sortId} className={CONTROL_LABEL}>
          {seriesViewCopy.sortLabel}
        </label>
        <select
          id={sortId}
          value={sort}
          onChange={(event) => {
            if (isSeriesSort(event.target.value)) onSort(event.target.value);
          }}
          className={`${INPUT} ${INPUT_BORDER.valid}`}
        >
          {SERIES_SORTS.map((option) => (
            <option key={option} value={option}>
              {seriesViewCopy.sort(option)}
            </option>
          ))}
        </select>
      </div>
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics under `list-style: none` (collection-overview.md §7). */}
      <ul role="list" className="mt-3 max-w-3xl">
        {rows.map(({ name, completion }) => {
          const { franchise, year } = name;
          return (
            <li
              key={franchise.id}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 border-b border-zinc-800 py-2.5 sm:grid-cols-[1fr_6rem_10rem_7rem] sm:gap-4"
            >
              <span
                title={isolate(seriesTitle(franchise.title, year))}
                className="col-span-2 line-clamp-2 text-sm break-words text-zinc-200 sm:col-span-1 sm:line-clamp-none sm:truncate"
              >
                <bdi>{franchise.title}</bdi>
                {year !== null && `, ${year}`}
              </span>
              <span className="text-right text-sm text-zinc-300 tabular-nums max-sm:order-2">
                {seriesViewCopy.figure(completion.owned, completion.total)}
              </span>
              <CompletionBar
                owned={completion.owned}
                total={completion.total}
                className="block w-full max-sm:order-1"
              />
              <span className="max-sm:order-3 max-sm:col-span-2 sm:text-right">
                {completion.owned > 0 && (
                  <button
                    type="button"
                    aria-label={seriesViewCopy.showCardsName(seriesTitle(franchise.title, year))}
                    onClick={() => onShowCards(franchise.id)}
                    className={TEXT_BUTTON_SM}
                  >
                    {seriesViewCopy.showCards}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-zinc-400">{seriesViewCopy.source(rows.length, snapshot.takenAt)}</p>
    </section>
  );
}
