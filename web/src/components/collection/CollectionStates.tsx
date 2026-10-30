import { Link } from "@tanstack/react-router";
import type { RefObject } from "react";
import { pageCopy, viewCopy } from "../../lib/collectionCopy";
import { COLLECTION_TABS, DEFAULT_CONTROLS } from "../../lib/collectionView";
import { BUTTON } from "../account/styles";
import { LINK_BUTTON } from "../layout/styles";
import { StatsSkeleton } from "./CollectionStats";
import { GRID, SKELETON_CARD } from "./styles";
import { Toolbar } from "./Toolbar";
import { ViewSwitch } from "./ViewSwitch";

const SKELETON_TILES = Array.from({ length: 12 }, (_, i) => i);
const ignore = () => undefined;

/**
 * §4.1 empty: no stats, no view switch, no toolbar; `Open a pack` is a real
 * link to `/packs`. The heading is the focus target when the card dialog
 * closes over a collection a refetch emptied (§3.7 step 3).
 */
export function EmptyCollection({ headingRef }: { headingRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-zinc-100 focus:outline-none">
        {pageCopy.empty}
      </h2>
      <Link to="/packs" className={LINK_BUTTON.primary}>
        {pageCopy.openAPack}
      </Link>
    </div>
  );
}

/** §4.1 error with nothing held: in place of the stats and the grid. */
export function CollectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-zinc-300">{pageCopy.error}</p>
      <button type="button" onClick={onRetry} className={BUTTON.secondary}>
        {pageCopy.tryAgain}
      </button>
    </div>
  );
}

/**
 * §4.1 loading after 300 ms: the stats as bars, the view switch and toolbar
 * rendered and disabled, twelve static tiles and a hidden status line.
 */
export function CollectionSkeleton() {
  return (
    <>
      <StatsSkeleton />
      <ViewSwitch views={COLLECTION_TABS} labels={viewCopy} tab="cards" disabled onChange={ignore} />
      <Toolbar controls={DEFAULT_CONTROLS} options={[]} disabled onChange={ignore} onCleared={ignore} />
      <div className={`mt-10 ${GRID}`}>
        {SKELETON_TILES.map((tile) => (
          <div key={tile} className="flex flex-col gap-1.5">
            <div className={SKELETON_CARD} />
            <div className="min-h-4" />
          </div>
        ))}
      </div>
      <p role="status" className="sr-only">
        {pageCopy.loading}
      </p>
    </>
  );
}
