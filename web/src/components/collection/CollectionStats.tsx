import type { CollectionResponse, FranchiseCompletion } from "@anime-tcg/shared/api";
import { RARITIES, RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { isolate } from "../../lib/bidi";
import { statsCopy } from "../../lib/collectionCopy";
import { completionPercent } from "../../lib/collectionSeries";
import { formatCount } from "../../lib/packsCopy";
import { LoginText } from "../account/LoginText";
import { TIER_TEXT } from "../packs/styles";
import { BAR_FILL, BAR_TRACK } from "./styles";

/** The selected series' line: its title as the player sees it and its completion row. */
export interface SeriesLine {
  title: string;
  completion: FranchiseCompletion;
}

interface Props {
  data: CollectionResponse;
  /** When the held answer arrived, if a refetch since then failed (§4.1 stale). */
  staleSince: Date | null;
  series: SeriesLine | null;
}

/** A completion bar: decoration, since the figure beside it carries the number (§7 "Series list"). */
export function CompletionBar({
  owned,
  total,
  className,
}: {
  owned: number;
  total: number;
  className: string;
}) {
  const width = total === 0 ? 0 : (owned / total) * 100;
  return (
    <span aria-hidden="true" className={`${BAR_TRACK} ${className}`}>
      <span className={BAR_FILL} style={{ width: `${width}%` }} />
    </span>
  );
}

/**
 * Completion and totals (collection-overview.md §3.2, §5.2): every figure is
 * the server's and describes the whole collection, whatever the search,
 * filters or view show.
 */
export function CollectionStats({ data, staleSince, series }: Props) {
  const { pool } = data.completion;
  const { totals } = data;
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-base font-semibold text-zinc-100 tabular-nums">
          {statsCopy.completion(pool.owned, pool.total)}
        </span>
        <span className="text-sm text-zinc-400 tabular-nums">
          {statsCopy.percent(completionPercent(pool.owned, pool.total))}
        </span>
      </p>
      {series !== null && (
        <p
          className="truncate text-sm text-zinc-400 tabular-nums"
          title={statsCopy.series(isolate(series.title), series.completion.owned, series.completion.total)}
        >
          <LoginText
            text={{
              template: (title) => statsCopy.series(title, series.completion.owned, series.completion.total),
              login: series.title,
            }}
          />
        </p>
      )}
      <CompletionBar owned={pool.owned} total={pool.total} className="mt-2 block w-full max-w-md" />
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        <span>{statsCopy.totals(totals.cards, totals.duplicates)}</span>
        {RARITIES.map((rarity) => (
          <span key={rarity}>
            <span className={TIER_TEXT[rarity]}>{RARITY_LABEL[rarity]}</span>{" "}
            <span className="text-zinc-200 tabular-nums">{formatCount(totals.byRarity[rarity])}</span>
          </span>
        ))}
      </p>
      {staleSince !== null && <p className="mt-1 text-xs text-zinc-400">{statsCopy.stale(staleSince)}</p>}
    </div>
  );
}

/** §4.1 loading: the stats as two static bars. */
export function StatsSkeleton() {
  return (
    <div>
      <div className="h-5 w-56 max-w-full rounded bg-zinc-800" />
      <div className="mt-3 h-3 w-80 max-w-full rounded bg-zinc-800" />
    </div>
  );
}
