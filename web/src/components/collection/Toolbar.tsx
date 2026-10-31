import { RARITIES } from "@anime-tcg/shared/rarity";
import { useId, type KeyboardEvent } from "react";
import { pageCopy, toolbarCopy } from "../../lib/collectionCopy";
import { SEARCH_MAX_LENGTH } from "../../lib/collectionSearch";
import type { SeriesOption } from "../../lib/collectionSeries";
import {
  CARD_SORTS,
  filtersActive,
  type CardSort,
  type ControlsAction,
  type OverviewControls,
} from "../../lib/collectionView";
import { INPUT, INPUT_BORDER } from "../account/styles";
import { TEXT_BUTTON_SM } from "../packs/styles";
import { ALL_CHIP, CONTROL_LABEL, TIER_CHIP } from "./styles";

const ALL_SERIES = "";

interface Props {
  controls: OverviewControls;
  options: readonly SeriesOption[];
  /** The loading skeleton renders the toolbar disabled (§4.1). */
  disabled: boolean;
  onChange: (action: ControlsAction) => void;
  /** `Clear filters` removes itself; the caller moves focus somewhere that stays. */
  onCleared: () => void;
}

function isCardSort(value: string): value is CardSort {
  return (CARD_SORTS as readonly string[]).includes(value);
}

/**
 * Search, series, sort, the rarity chips and Duplicates only
 * (collection-overview.md §3.3, §5.2, §7). Every change applies at once;
 * nothing submits, and Enter in the search does nothing more.
 */
export function Toolbar({ controls, options, disabled, onChange, onCleared }: Props) {
  const id = useId();
  const searchId = `${id}-search`;
  const seriesId = `${id}-series`;
  const sortId = `${id}-sort`;
  const rarityId = `${id}-rarity`;

  /** §7 "Toolbar": Escape in a non-empty search clears it and keeps focus there. */
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && controls.query !== "") {
      event.preventDefault();
      onChange({ type: "query", query: "" });
    }
  };

  return (
    <search aria-label={pageCopy.filters} className="mt-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:flex lg:items-end">
        <div className="col-span-2 flex flex-col gap-1 lg:min-w-56 lg:flex-1">
          <label htmlFor={searchId} className={CONTROL_LABEL}>
            {toolbarCopy.searchLabel}
          </label>
          <input
            id={searchId}
            type="search"
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            spellCheck={false}
            placeholder={toolbarCopy.searchPlaceholder}
            value={controls.query}
            disabled={disabled}
            onChange={(event) => onChange({ type: "query", query: event.target.value })}
            onKeyDown={onSearchKey}
            className={`${INPUT} ${INPUT_BORDER.valid}`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1 lg:w-56">
          <label htmlFor={seriesId} className={CONTROL_LABEL}>
            {toolbarCopy.seriesLabel}
          </label>
          <select
            id={seriesId}
            value={controls.series === null ? ALL_SERIES : String(controls.series)}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                type: "series",
                series: event.target.value === ALL_SERIES ? null : Number(event.target.value),
              })
            }
            className={`${INPUT} ${INPUT_BORDER.valid} truncate`}
          >
            <option value={ALL_SERIES}>{toolbarCopy.allSeries}</option>
            {options.map(({ name, completion }) => (
              <option key={name.franchise.id} value={String(name.franchise.id)}>
                {toolbarCopy.seriesOption(name.franchise.title, name.year, completion)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1 lg:w-48">
          <label htmlFor={sortId} className={CONTROL_LABEL}>
            {toolbarCopy.sortLabel}
          </label>
          <select
            id={sortId}
            value={controls.sort}
            disabled={disabled}
            onChange={(event) => {
              if (isCardSort(event.target.value)) onChange({ type: "sort", sort: event.target.value });
            }}
            className={`${INPUT} ${INPUT_BORDER.valid}`}
          >
            {CARD_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {toolbarCopy.sort(sort)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-4">
        <div className="flex flex-col gap-1">
          <span id={rarityId} className={CONTROL_LABEL}>
            {toolbarCopy.rarityLabel}
          </span>
          <div role="group" aria-labelledby={rarityId} className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={controls.rarities.length === 0}
              disabled={disabled}
              onClick={() => onChange({ type: "allRarities" })}
              className={ALL_CHIP[controls.rarities.length === 0 ? "pressed" : "other"]}
            >
              {toolbarCopy.allRarities}
            </button>
            {RARITIES.map((rarity) => {
              const pressed = controls.rarities.includes(rarity);
              return (
                <button
                  key={rarity}
                  type="button"
                  aria-pressed={pressed}
                  disabled={disabled}
                  onClick={() => onChange({ type: "toggleRarity", rarity })}
                  className={TIER_CHIP[rarity][pressed ? "pressed" : "other"]}
                >
                  {toolbarCopy.rarity(rarity)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="inline-flex min-h-10 items-center gap-2 text-sm text-zinc-200 sm:min-h-8">
            <input
              type="checkbox"
              checked={controls.duplicatesOnly}
              disabled={disabled}
              onChange={(event) => onChange({ type: "duplicatesOnly", on: event.target.checked })}
              className="size-4 accent-volt"
            />
            {toolbarCopy.duplicatesOnly}
          </label>
          {filtersActive(controls) && (
            <button
              type="button"
              onClick={() => {
                onChange({ type: "clearFilters" });
                onCleared();
              }}
              className={TEXT_BUTTON_SM}
            >
              {toolbarCopy.clear}
            </button>
          )}
        </div>
      </div>
    </search>
  );
}
