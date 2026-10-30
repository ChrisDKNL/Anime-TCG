import { useId } from "react";
import { resultsCopy } from "../../lib/collectionCopy";
import { formatCount } from "../../lib/packsCopy";
import { BUTTON, INPUT, INPUT_BORDER } from "../account/styles";

interface Props {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}

/** `Previous`, `Page [3] of 34`, `Next` (collection-overview.md §3.3, §5.3); only with more than one page. */
export function Pages({ page, pages, onPage }: Props) {
  const id = useId();
  const selectId = `${id}-page`;
  const ofId = `${id}-of`;
  return (
    <nav aria-label={resultsCopy.pages} className="mt-6 flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        aria-label={resultsCopy.previousName}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className={BUTTON.secondary}
      >
        {resultsCopy.previous}
      </button>
      <span className="flex items-center gap-2">
        <label htmlFor={selectId} className="text-sm text-zinc-400">
          {resultsCopy.page}
        </label>
        <span className="w-20">
          <select
            id={selectId}
            aria-describedby={ofId}
            value={page}
            onChange={(event) => onPage(Number(event.target.value))}
            className={`${INPUT} ${INPUT_BORDER.valid} tabular-nums`}
          >
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {formatCount(n)}
              </option>
            ))}
          </select>
        </span>
        <span id={ofId} className="text-sm text-zinc-400 tabular-nums">
          {resultsCopy.of(pages)}
        </span>
      </span>
      <button
        type="button"
        aria-label={resultsCopy.nextName}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className={BUTTON.secondary}
      >
        {resultsCopy.next}
      </button>
    </nav>
  );
}
