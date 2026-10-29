import type { CollectionEntry, CollectionResponse } from "@anime-tcg/shared/api";
import { RARITIES, RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { cardCount } from "../../lib/copy";
import type { RarityFilter } from "../../lib/game";
import { collectionCopy, formatCount } from "../../lib/packsCopy";
import { BUTTON, INPUT, INPUT_BORDER } from "../account/styles";
import { Card } from "../card/Card";
import { LINK_BUTTON } from "../layout/styles";
import { TIER_TEXT } from "../packs/styles";

/** collection-overview.md §5.1: tiles at least 10.5 rem wide, never fewer than two columns. */
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(10.5rem,calc(50%-0.375rem)),1fr))] gap-3";
const SKELETON_TILES = Array.from({ length: 12 }, (_, i) => i);

export type CollectionView =
  | { kind: "blank" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; data: CollectionResponse; staleSince: Date | null };

interface Props {
  view: CollectionView;
  filter: RarityFilter;
  onFilter: (filter: RarityFilter) => void;
  onRetry: () => void;
}

function isFilter(value: string): value is RarityFilter {
  return value === "all" || (RARITIES as readonly string[]).includes(value);
}

/**
 * The interim collection (packs-page.md §3.6, §4.3): the server's entries in
 * the server's order, one card each, with a rarity filter that only hides
 * entries. No `Reset`: the owner's command is the only reset. Item 3's
 * overview replaces it.
 */
export function InterimCollection({ view, filter, onFilter, onRetry }: Props) {
  switch (view.kind) {
    case "blank":
      return null;
    case "loading":
      return <CollectionSkeleton />;
    case "error":
      return (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-zinc-300">{collectionCopy.error}</p>
          <button type="button" onClick={onRetry} className={BUTTON.secondary}>
            {collectionCopy.tryAgain}
          </button>
        </div>
      );
    case "loaded":
      if (view.data.entries.length === 0) return <EmptyCollection />;
      return <Loaded data={view.data} staleSince={view.staleSince} filter={filter} onFilter={onFilter} />;
  }
}

function EmptyCollection() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h2 className="text-lg font-bold text-zinc-100">{collectionCopy.empty}</h2>
      <Link to="/packs" className={LINK_BUTTON.primary}>
        {collectionCopy.openAPack}
      </Link>
    </div>
  );
}

function RarityField({
  value,
  disabled,
  onChange,
}: {
  value: RarityFilter;
  disabled: boolean;
  onChange: (filter: RarityFilter) => void;
}) {
  const id = useId();
  return (
    <div className="mt-4 flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-zinc-400">
        {collectionCopy.filterLabel}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (isFilter(event.target.value)) onChange(event.target.value);
        }}
        className={`${INPUT} ${INPUT_BORDER.valid} sm:w-48`}
      >
        <option value="all">{collectionCopy.filterAll}</option>
        {RARITIES.map((rarity) => (
          <option key={rarity} value={rarity}>
            {RARITY_LABEL[rarity]}
          </option>
        ))}
      </select>
    </div>
  );
}

function Loaded({
  data,
  staleSince,
  filter,
  onFilter,
}: {
  data: CollectionResponse;
  staleSince: Date | null;
  filter: RarityFilter;
  onFilter: (filter: RarityFilter) => void;
}) {
  const { totals } = data;
  const shown = filter === "all" ? data.entries : data.entries.filter((entry) => entry.rarity === filter);
  const poolSize = data.snapshot?.characterCount ?? null;
  return (
    <>
      <p className="text-sm text-zinc-200 tabular-nums">
        {cardCount(totals.cards)} · {collectionCopy.duplicates(totals.duplicates)}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {RARITIES.map((rarity) => (
          <span key={rarity}>
            <span className={TIER_TEXT[rarity]}>{RARITY_LABEL[rarity]}</span>{" "}
            <span className="text-zinc-200 tabular-nums">{formatCount(totals.byRarity[rarity])}</span>
          </span>
        ))}
      </p>
      {staleSince !== null && (
        <p className="mt-1 text-xs text-zinc-400">{collectionCopy.stale(staleSince)}</p>
      )}
      <RarityField value={filter} disabled={false} onChange={onFilter} />
      {shown.length === 0 && filter !== "all" ? (
        <p className="py-12 text-center text-sm break-words text-zinc-400">
          {collectionCopy.noMatch(filter)}
        </p>
      ) : (
        <ul aria-label={collectionCopy.gridLabel} className={`mt-4 ${GRID}`}>
          {shown.map((entry) => (
            <Tile
              key={`${entry.character.id}:${entry.rarity}:${entry.variant}`}
              entry={entry}
              data={data}
              poolSize={poolSize}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** Not a button until item 3 adds the card dialog, so its glint and drift play on hover only (§9, question 5). */
function Tile({
  entry,
  data,
  poolSize,
}: {
  entry: CollectionEntry;
  data: CollectionResponse;
  poolSize: number | null;
}) {
  const series = data.franchises.find((f) => f.id === entry.character.franchiseIds[0])?.title ?? null;
  return (
    <li className="flex flex-col gap-1.5">
      <Card
        character={entry.character}
        rarity={entry.rarity}
        series={series}
        poolSize={poolSize}
        effects="hover"
      />
      <p className="flex min-h-4 items-baseline px-0.5 text-xs leading-tight text-zinc-300 tabular-nums">
        {entry.count >= 2 && (
          <>
            <span aria-hidden="true">{collectionCopy.copies(entry.count)}</span>
            <span className="sr-only">{collectionCopy.copiesSpoken(entry.count)}</span>
          </>
        )}
      </p>
    </li>
  );
}

function CollectionSkeleton() {
  return (
    <>
      <div className="h-4 w-40 rounded bg-zinc-800" />
      <div className="mt-2 h-3 w-64 max-w-full rounded bg-zinc-800" />
      <RarityField value="all" disabled onChange={() => undefined} />
      <div className={`mt-4 ${GRID}`}>
        {SKELETON_TILES.map((tile) => (
          <div key={tile} className="flex flex-col gap-1.5">
            <div className="aspect-[5/7] w-full rounded-xl bg-zinc-800" />
            <div className="min-h-4" />
          </div>
        ))}
      </div>
      <p role="status" className="sr-only">
        {collectionCopy.loading}
      </p>
    </>
  );
}
