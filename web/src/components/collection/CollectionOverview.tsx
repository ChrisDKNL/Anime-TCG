import type { CollectionResponse } from "@anime-tcg/shared/api";
import { useLayoutEffect, useRef, useState } from "react";
import { useCollectionOverview, type OverviewModel } from "../../hooks/useCollectionOverview";
import { useResultsAnnouncement } from "../../hooks/useResultsAnnouncement";
import { resultsCopy, seriesTitle } from "../../lib/collectionCopy";
import { searchTerms } from "../../lib/collectionSearch";
import type { ControlsAction, IndexedEntry, OverviewControls } from "../../lib/collectionView";
import { LoginText } from "../account/LoginText";
import { BUTTON } from "../account/styles";
import { CardDialog } from "./CardDialog";
import { EmptyCollection } from "./CollectionStates";
import { CollectionStats, type SeriesLine } from "./CollectionStats";
import { Pages } from "./Pages";
import { SeriesView } from "./SeriesView";
import { GRID, RESULTS_LINE } from "./styles";
import { Tile } from "./Tile";
import { Toolbar } from "./Toolbar";
import { ViewSwitch } from "./ViewSwitch";

/** §7 "Grid": the list is named by the results line. */
export const RESULTS_ID = "collection-results";

interface Props {
  data: CollectionResponse;
  staleSince: Date | null;
  controls: OverviewControls;
  onChange: (action: ControlsAction) => void;
}

/** Where focus goes after an action that changes the results under it (§5.3, §4.3, §3.7). */
type FocusRequest = { to: "results"; scroll: boolean } | { to: "tile"; key: string; position: number };

/** The dialog's entry, and the page as it was when it opened: the grid keeps that order until it closes (§3.4 step 5). */
interface OpenCard {
  key: string;
  position: number;
  frozen: IndexedEntry[];
}

/**
 * The loaded collection (collection-overview.md §3.1 to §3.7): the stats,
 * the view switch, then the Cards view or the Series view; with no entries,
 * the empty state (§4.1). The controls are the signed-in layout's, so they
 * survive page changes; the dialog is this page's, so it closes when the page
 * is left. The dialog sits outside both views and the empty state, so a
 * refetch that empties the collection while it is open leaves it open with
 * `You no longer have this card.` (§4.5).
 */
export function CollectionOverview({ data, staleSince, controls, onChange }: Props) {
  const model = useCollectionOverview(data, controls);
  const pendingFocus = useRef<FocusRequest | null>(null);
  const [open, setOpen] = useState<OpenCard | null>(null);
  const emptyHeading = useRef<HTMLHeadingElement>(null);
  const empty = data.entries.length === 0;

  const focusAfter = (request: FocusRequest) => {
    pendingFocus.current = request;
  };
  const takeFocusRequest = () => {
    const request = pendingFocus.current;
    pendingFocus.current = null;
    return request;
  };

  const poolSize = data.snapshot?.characterCount ?? null;
  const dialog = open !== null && (
    <CardDialog
      key={open.key}
      indexed={model.byKey.get(open.key) ?? null}
      names={model.names}
      poolSize={poolSize}
      onClose={() => {
        // §3.7 step 3; with no entries left, the empty state's heading, which says what is there now.
        if (empty) emptyHeading.current?.focus();
        else focusAfter({ to: "tile", key: open.key, position: open.position });
        setOpen(null);
      }}
    />
  );

  if (empty) {
    return (
      <>
        <EmptyCollection headingRef={emptyHeading} />
        {dialog}
      </>
    );
  }

  return (
    <>
      <CollectionStats data={data} staleSince={staleSince} series={seriesLine(model, controls)} />
      <ViewSwitch tab={controls.tab} disabled={false} onChange={(tab) => onChange({ type: "tab", tab })} />
      {controls.tab === "cards" ? (
        <CardsView
          model={model}
          poolSize={poolSize}
          open={open}
          onOpen={setOpen}
          controls={controls}
          onChange={onChange}
          takeFocusRequest={takeFocusRequest}
          focusAfter={focusAfter}
        />
      ) : (
        <SeriesView
          rows={model.seriesRows}
          snapshot={data.snapshot}
          sort={controls.seriesSort}
          onSort={(sort) => onChange({ type: "seriesSort", sort })}
          onShowCards={(series) => {
            focusAfter({ to: "results", scroll: false });
            onChange({ type: "showSeries", series });
          }}
        />
      )}
      {dialog}
    </>
  );
}

/** §3.2 step 2: with a series filter in the Cards view, that series' completion, if it is in the current snapshot. */
function seriesLine(model: OverviewModel, controls: OverviewControls): SeriesLine | null {
  if (controls.tab !== "cards" || controls.series === null) return null;
  const completion = model.completions.get(controls.series);
  const name = model.names.get(controls.series);
  if (completion === undefined || name === undefined) return null;
  return { title: seriesTitle(name.franchise.title, name.year), completion };
}

interface CardsViewProps {
  model: OverviewModel;
  poolSize: number | null;
  /** The open dialog's entry: while it is open the grid shows the page as it was when it opened. */
  open: OpenCard | null;
  onOpen: (card: OpenCard) => void;
  controls: OverviewControls;
  onChange: (action: ControlsAction) => void;
  /** The focus an action asked for, taken once the Cards view has rendered what the action changed. */
  takeFocusRequest: () => FocusRequest | null;
  focusAfter: (request: FocusRequest) => void;
}

function CardsView({
  model,
  poolSize,
  open,
  onOpen,
  controls,
  onChange,
  takeFocusRequest,
  focusAfter,
}: CardsViewProps) {
  const { results, page, pages, pageEntries, byKey } = model;
  const resultsRef = useRef<HTMLParagraphElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);

  // After every render of this view, mount included (Show cards arrives from the Series view).
  useLayoutEffect(() => {
    const request = takeFocusRequest();
    if (request === null) return;
    const resultsLine = resultsRef.current;
    if (request.to === "tile") {
      const tiles = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-entry]") ?? [])];
      const tile =
        tiles.find((t) => t.dataset.entry === request.key) ?? tiles[request.position] ?? tiles.at(-1);
      (tile ?? resultsLine)?.focus();
      return;
    }
    if (request.scroll) resultsLine?.scrollIntoView({ block: "start", behavior: "instant" });
    resultsLine?.focus({ preventScroll: true });
  });

  const line = resultsCopy.line(results.length, page, pages);
  useResultsAnnouncement(results.length === 0 ? resultsCopy.none : line, resultsRef);

  const shown = open === null ? pageEntries : open.frozen.flatMap(({ key }) => byKey.get(key) ?? []);
  const clear = () => {
    focusAfter({ to: "results", scroll: false });
    onChange({ type: "clearFilters" });
  };

  return (
    <>
      <Toolbar
        controls={controls}
        options={model.seriesOptions}
        disabled={false}
        onChange={onChange}
        onCleared={() => focusAfter({ to: "results", scroll: false })}
      />
      <p id={RESULTS_ID} ref={resultsRef} tabIndex={-1} className={RESULTS_LINE}>
        {line}
      </p>
      {shown.length === 0 ? (
        <NoMatches query={controls.query} onClear={clear} />
      ) : (
        // eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics under `list-style: none` (collection-overview.md §7).
        <ul ref={gridRef} role="list" aria-labelledby={RESULTS_ID} className={`mt-3 ${GRID}`}>
          {shown.map((indexed, position) => (
            <Tile
              key={indexed.key}
              indexed={indexed}
              poolSize={poolSize}
              onOpen={() => onOpen({ key: indexed.key, position, frozen: pageEntries })}
            />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <Pages
          page={page}
          pages={pages}
          onPage={(next) => {
            focusAfter({ to: "results", scroll: true });
            onChange({ type: "page", page: next });
          }}
        />
      )}
    </>
  );
}

/** §4.2: in place of the grid, what matched nothing and the way back. */
function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-sm break-words text-zinc-400">
        {searchTerms(query).length > 0 ? (
          <LoginText text={{ template: resultsCopy.noMatchQuery, login: query }} />
        ) : (
          resultsCopy.noMatchFilters
        )}
      </p>
      <button type="button" onClick={onClear} className={BUTTON.secondary}>
        {resultsCopy.clear}
      </button>
    </div>
  );
}
