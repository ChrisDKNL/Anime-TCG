import type { FranchiseRef } from "@anime-tcg/shared/api";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { useId, useMemo, type KeyboardEvent } from "react";
import { SEARCH_MAX_LENGTH } from "../../lib/collectionSearch";
import { seriesNames } from "../../lib/collectionSeries";
import { filtersActive, LISTING_SORTS, type MarketAction, type MarketControls } from "../../lib/market";
import { browseCopy } from "../../lib/marketCopy";
import { INPUT, INPUT_BORDER } from "../account/styles";
import { CONTROL_LABEL } from "../collection/styles";
import { TEXT_BUTTON_SM } from "../packs/styles";

const ALL = "";

interface Props {
  controls: MarketControls;
  /** The series the market holds (`filterFranchiseIds`), plus the selected one. */
  series: readonly FranchiseRef[];
  /** The loading state renders the toolbar disabled (§4). */
  disabled: boolean;
  onChange: (action: MarketAction) => void;
  /** `Clear filters` removes itself; the caller moves focus somewhere that stays. */
  onCleared: () => void;
}

function rarityOf(value: string) {
  return RARITIES.find((rarity) => rarity === value) ?? null;
}

function sortOf(value: string) {
  return LISTING_SORTS.find((sort) => sort === value) ?? null;
}

/**
 * The browse toolbar (market-and-shop.md §3.4 step 3, §5.3, §7): a `<search>`
 * named `Market filters` with Search, Rarity (one tier, as the server takes
 * one per request), Series, Sort and `Clear filters`. Every change applies at
 * once except the search, which the page sends 300 ms after the last
 * keystroke; nothing submits.
 */
export function MarketToolbar({ controls, series, disabled, onChange, onCleared }: Props) {
  const id = useId();
  const names = useMemo(() => seriesNames({ franchises: [...series] }), [series]);

  /** As the collection's: Escape in a non-empty search clears it, and the cleared search applies at once. */
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && controls.query !== "") {
      event.preventDefault();
      onChange({ type: "query", query: "" });
      onChange({ type: "send" });
    }
  };

  return (
    <search aria-label={browseCopy.filters} className="mt-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:items-end">
        <div className="col-span-2 flex flex-col gap-1 sm:col-span-3 lg:min-w-56 lg:flex-1">
          <label htmlFor={`${id}-search`} className={CONTROL_LABEL}>
            {browseCopy.searchLabel}
          </label>
          <input
            id={`${id}-search`}
            type="search"
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            spellCheck={false}
            placeholder={browseCopy.searchPlaceholder}
            value={controls.query}
            disabled={disabled}
            onChange={(event) => onChange({ type: "query", query: event.target.value })}
            onKeyDown={onSearchKey}
            className={`${INPUT} ${INPUT_BORDER.valid}`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1 lg:w-40">
          <label htmlFor={`${id}-rarity`} className={CONTROL_LABEL}>
            {browseCopy.rarityLabel}
          </label>
          <select
            id={`${id}-rarity`}
            value={controls.rarity ?? ALL}
            disabled={disabled}
            onChange={(event) => onChange({ type: "rarity", rarity: rarityOf(event.target.value) })}
            className={`${INPUT} ${INPUT_BORDER.valid}`}
          >
            <option value={ALL}>{browseCopy.allRarities}</option>
            {RARITIES.map((rarity) => (
              <option key={rarity} value={rarity}>
                {browseCopy.rarity(rarity)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1 lg:w-56">
          <label htmlFor={`${id}-series`} className={CONTROL_LABEL}>
            {browseCopy.seriesLabel}
          </label>
          <select
            id={`${id}-series`}
            value={controls.series === null ? ALL : String(controls.series.id)}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                type: "series",
                series: series.find((franchise) => String(franchise.id) === event.target.value) ?? null,
              })
            }
            className={`${INPUT} ${INPUT_BORDER.valid} truncate`}
          >
            <option value={ALL}>{browseCopy.allSeries}</option>
            {series.map((franchise) => (
              <option key={franchise.id} value={String(franchise.id)}>
                {browseCopy.seriesOption(franchise.title, names.get(franchise.id)?.year ?? null)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1 lg:w-48">
          <label htmlFor={`${id}-sort`} className={CONTROL_LABEL}>
            {browseCopy.sortLabel}
          </label>
          <select
            id={`${id}-sort`}
            value={controls.sort}
            disabled={disabled}
            onChange={(event) => {
              const sort = sortOf(event.target.value);
              if (sort !== null) onChange({ type: "sort", sort });
            }}
            className={`${INPUT} ${INPUT_BORDER.valid}`}
          >
            {LISTING_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {browseCopy.sort(sort)}
              </option>
            ))}
          </select>
        </div>
        {filtersActive(controls) && (
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange({ type: "clearFilters" });
                onCleared();
              }}
              className={TEXT_BUTTON_SM}
            >
              {browseCopy.clear}
            </button>
          </div>
        )}
      </div>
    </search>
  );
}
