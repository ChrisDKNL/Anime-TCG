import type { FranchiseRef } from "@anime-tcg/shared/api";
import { useState } from "react";
import { isolate } from "../../lib/bidi";
import { dialogCopy, seriesTitle } from "../../lib/collectionCopy";
import type { SeriesName } from "../../lib/collectionSeries";
import { TEXT_BUTTON_SM } from "../packs/styles";

/** §5.4: `Also in` shows five titles, then `and <N> more`. */
const ALSO_IN_SHOWN = 5;

/** The primary series under a card's name (collection-overview.md §3.4 step 2): its title, year when shared, native title. */
export function PrimarySeries({
  franchise,
  name,
}: {
  franchise: FranchiseRef;
  name: SeriesName | undefined;
}) {
  const year = name?.year ?? null;
  return (
    <>
      <p className="text-sm break-words text-zinc-400">
        <bdi>{franchise.title}</bdi>
        {year !== null && `, ${year}`}
      </p>
      {franchise.titleNative !== null && franchise.titleNative !== franchise.title && (
        <p dir="auto" lang="ja" className="text-xs break-words text-zinc-400">
          {franchise.titleNative}
        </p>
      )}
    </>
  );
}

/** §5.4: a comma-separated run of titles; more than five show five and `and <N> more`, which reveals the rest. */
export function AlsoIn({
  franchises,
  names,
}: {
  franchises: FranchiseRef[];
  names: ReadonlyMap<number, SeriesName>;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? franchises : franchises.slice(0, ALSO_IN_SHOWN);
  const hidden = franchises.length - shown.length;
  return (
    <p className="mt-1 text-xs break-words text-zinc-300">
      <span className="text-zinc-400">{dialogCopy.alsoIn}</span>{" "}
      {shown.map((franchise, i) => {
        const year = names.get(franchise.id)?.year ?? null;
        return (
          <span key={franchise.id}>
            {i > 0 && ", "}
            <bdi title={isolate(seriesTitle(franchise.title, year))}>{franchise.title}</bdi>
            {year !== null && `, ${year}`}
          </span>
        );
      })}
      {hidden > 0 && (
        <>
          {" "}
          <button type="button" onClick={() => setExpanded(true)} className={TEXT_BUTTON_SM}>
            {dialogCopy.more(hidden)}
          </button>
        </>
      )}
    </p>
  );
}
