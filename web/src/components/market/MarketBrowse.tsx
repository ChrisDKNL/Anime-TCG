import type { Listing } from "@anime-tcg/shared/api";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { useGame } from "../../hooks/useGame";
import type { RateLimitWait } from "../../hooks/useKeyedAction";
import type { CancelListing, MarketBlocks } from "../../hooks/useMarketActions";
import { useResultsAnnouncement } from "../../hooks/useResultsAnnouncement";
import { seriesNames } from "../../lib/collectionSeries";
import {
  filtersActive,
  franchisesOf,
  heldEntries,
  listingsQuery,
  searchText,
  seriesOptions,
  shownListings,
  type MarketAction,
  type MarketControls,
} from "../../lib/market";
import { browseCopy } from "../../lib/marketCopy";
import { LoginText } from "../account/LoginText";
import { BUTTON } from "../account/styles";
import { GRID, RESULTS_LINE, SKELETON_CARD } from "../collection/styles";
import { ERROR_LINE, TEXT_BUTTON_SM } from "../packs/styles";
import { ListingDialog } from "./ListingDialog";
import { ListingTile } from "./ListingTile";
import { MarketToolbar } from "./MarketToolbar";

/** §3.4 step 3: the search is sent this long after the last keystroke. */
export const SEARCH_DELAY_MS = 300;
/** Nothing but the toolbar shows for this long before the skeleton does (collection-overview.md §3.1). */
const LOADING_DELAY_MS = 300;
const SKELETON_TILES = Array.from({ length: 12 }, (_, i) => i);

/** §7: the grid is named by the results line. */
export const MARKET_RESULTS_ID = "market-results";

interface Props {
  controls: MarketControls;
  wait: RateLimitWait;
  blocks: MarketBlocks;
  cancel: CancelListing;
}

/**
 * Browse (market-and-shop.md §3.4, §4, §5.3, §7): the toolbar, the results
 * line, the listings of `GET /api/market/listings` for the toolbar's
 * parameters as the collection's tiles, and `Show more` through the server's
 * `nextCursor`. A change of parameters asks for the first page again; the
 * previous list stays until it arrives, and an answer to older parameters is
 * never shown. The listing dialog opens over the grid.
 */
export function MarketBrowse({ controls, wait, blocks, cancel }: Props) {
  const game = useGame();
  const queryClient = useQueryClient();
  const { changeMarket, marketKey } = game;

  /**
   * §3.4 step 4 (manager decision, 2026-10-30): every change of parameters asks for the first page
   * again and replaces the list, so the pages held for any other set of parameters go first; a set
   * the player returns to starts again from its first page instead of showing the pages it had.
   * Only sets nothing observes go: the current one is the list on screen until the new page arrives.
   */
  const changeParameters = useCallback(
    (action: MarketAction) => {
      queryClient.removeQueries({ queryKey: [...marketKey, "listings"], type: "inactive" });
      changeMarket(action);
    },
    [queryClient, marketKey, changeMarket],
  );
  const listings = useInfiniteQuery({
    ...game.listingsQuery(listingsQuery(controls)),
    placeholderData: keepPreviousData,
  });
  const showLoading = useDelayedFlag(listings.data === undefined && !listings.isError, LOADING_DELAY_MS);
  const resultsRef = useRef<HTMLParagraphElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const focusResults = useRef(false);
  const [open, setOpen] = useState<Listing | null>(null);

  // §3.4 step 3: what the field holds is sent 300 ms after the last keystroke.
  const { query, sent } = controls;
  useEffect(() => {
    if (searchText(query) === sent) return;
    const id = window.setTimeout(() => changeParameters({ type: "send" }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [query, sent, changeParameters]);

  useLayoutEffect(() => {
    if (focusResults.current) resultsRef.current?.focus();
    focusResults.current = false;
  });

  // The player's changes, counted so the live region hears the results line after those only (§7).
  const [asked, setAsked] = useState(0);
  const change = (action: MarketAction) => {
    setAsked((n) => n + 1);
    changeParameters(action);
  };

  const pages = useMemo(() => listings.data?.pages ?? [], [listings.data]);
  const shown = useMemo(() => shownListings(pages), [pages]);
  const names = useMemo(() => seriesNames({ franchises: [...franchisesOf(pages).values()] }), [pages]);
  const options = useMemo(() => seriesOptions(pages[0], controls.series), [pages, controls.series]);
  const line = browseCopy.results(shown.length);
  useResultsAnnouncement(line, asked, resultsRef);

  const poolSize = game.collection.data?.snapshot?.characterCount ?? null;
  const rules = game.wallet.data?.wallet.rules ?? null;

  const clearAndFocus = (action: MarketAction) => {
    focusResults.current = true;
    change(action);
  };

  /** `Show more` keeps focus; once the last page is in, it goes and the results line takes focus. */
  const showMore = async () => {
    setAsked((n) => n + 1);
    const result = await listings.fetchNextPage();
    if (!result.hasNextPage) resultsRef.current?.focus();
  };

  /** The dialog has closed: focus back on its tile, or on the results line once the listing has left the list. */
  const onClose = (listing: Listing) => {
    const tiles = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-listing]") ?? [])];
    const tile = tiles.find((t) => t.dataset.listing === listing.listingId);
    (tile ?? resultsRef.current)?.focus();
    setOpen(null);
  };

  const loaded = listings.data !== undefined;
  let body = null;
  if (!loaded) {
    if (listings.isError) {
      body = (
        <div className="flex flex-col items-start gap-3 py-12">
          <p className="text-sm text-zinc-300">{browseCopy.error}</p>
          <button type="button" onClick={() => void listings.refetch()} className={BUTTON.secondary}>
            {browseCopy.tryAgain}
          </button>
        </div>
      );
    } else if (showLoading) {
      body = <BrowseSkeleton />;
    }
  } else {
    body = (
      <>
        <p id={MARKET_RESULTS_ID} ref={resultsRef} tabIndex={-1} className={RESULTS_LINE}>
          {line}
        </p>
        {shown.length === 0 ? (
          <Empty controls={controls} onClear={() => clearAndFocus({ type: "clearFilters" })} />
        ) : (
          // eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics under `list-style: none` (collection-overview.md §7).
          <ul ref={gridRef} role="list" aria-labelledby={MARKET_RESULTS_ID} className={`mt-3 ${GRID}`}>
            {shown.map((listing) => {
              const primary = names.get(listing.character.franchiseIds[0] ?? 0);
              return (
                <ListingTile
                  key={listing.listingId}
                  listing={listing}
                  series={primary?.franchise.title ?? null}
                  poolSize={poolSize}
                  onOpen={() => setOpen(listing)}
                />
              );
            })}
          </ul>
        )}
        <More
          hasMore={listings.hasNextPage}
          loading={listings.isFetchingNextPage}
          failed={listings.isFetchNextPageError}
          onMore={() => void showMore()}
        />
      </>
    );
  }

  return (
    <>
      <MarketToolbar
        controls={controls}
        series={options}
        disabled={!loaded}
        onChange={change}
        onCleared={() => {
          focusResults.current = true;
        }}
      />
      {controls.character !== null && (
        <p className="mt-3 text-sm break-words text-zinc-300">
          <LoginText text={{ template: browseCopy.character, login: controls.character.name }} />{" "}
          <button
            type="button"
            onClick={() => clearAndFocus({ type: "clearCharacter" })}
            className={TEXT_BUTTON_SM}
          >
            {browseCopy.showAll}
          </button>
        </p>
      )}
      {body}
      {open !== null && (
        <ListingDialog
          key={open.listingId}
          listing={open}
          names={names}
          poolSize={poolSize}
          held={heldEntries(open.character.id, game.collection.data?.entries ?? [])}
          balance={game.balance}
          stale={game.wallet.isError}
          windowSeconds={rules?.window.seconds ?? null}
          wait={wait}
          blocks={blocks}
          cancel={cancel}
          onClose={() => onClose(open)}
        />
      )}
    </>
  );
}

/** §4 empty market, or nothing matching the filters, with the way back. */
function Empty({ controls, onClear }: { controls: MarketControls; onClear: () => void }) {
  if (!filtersActive(controls)) return <p className="py-12 text-sm text-zinc-400">{browseCopy.empty}</p>;
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-sm break-words text-zinc-400">
        {controls.sent === "" ? (
          browseCopy.noMatchFilters
        ) : (
          <LoginText text={{ template: browseCopy.noMatchQuery, login: controls.sent }} />
        )}
      </p>
      <button type="button" onClick={onClear} className={BUTTON.secondary}>
        {browseCopy.clear}
      </button>
    </div>
  );
}

/** §3.4 steps 2 and 6, §4: `Show more` while there is a next page; its failure under the list. */
function More({
  hasMore,
  loading,
  failed,
  onMore,
}: {
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
  onMore: () => void;
}) {
  if (failed && !loading) {
    return (
      <div className="mt-6 flex flex-col items-center gap-2">
        <p role="alert" className={ERROR_LINE}>
          {browseCopy.moreFailed}
        </p>
        <button type="button" onClick={onMore} className={BUTTON.secondary}>
          {browseCopy.tryAgain}
        </button>
      </div>
    );
  }
  if (!hasMore) return null;
  return (
    <div className="mt-6 flex justify-center">
      <button
        type="button"
        aria-disabled={loading ? "true" : undefined}
        onClick={loading ? undefined : onMore}
        className={BUTTON.secondary}
      >
        {loading ? browseCopy.loadingMore : browseCopy.more}
      </button>
    </div>
  );
}

/** §4 loading after 300 ms: twelve static tiles and a hidden status line; nothing shimmers. */
function BrowseSkeleton() {
  return (
    <>
      <div className={`mt-10 ${GRID}`}>
        {SKELETON_TILES.map((tile) => (
          <div key={tile} className="flex flex-col gap-1.5">
            <div className={SKELETON_CARD} />
            <div className="min-h-4" />
          </div>
        ))}
      </div>
      <p role="status" className="sr-only">
        {browseCopy.loading}
      </p>
    </>
  );
}
