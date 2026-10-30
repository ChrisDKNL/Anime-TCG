import { viewCopy } from "../../lib/collectionCopy";
import { VIEW_BUTTON, VIEW_SWITCH } from "./styles";

interface Props<T extends string> {
  views: readonly T[];
  labels: Readonly<Record<T, string>>;
  tab: T;
  disabled: boolean;
  onChange: (tab: T) => void;
}

/**
 * A view switch (collection-overview.md §3.2 step 5, §7): a group of toggle
 * buttons named `View`, so focus stays on the one pressed. The collection's
 * `Cards` and `Series`, and the market's `Browse` and `My listings`
 * (market-and-shop.md §3.4 step 1).
 */
export function ViewSwitch<T extends string>({ views, labels, tab, disabled, onChange }: Props<T>) {
  return (
    <div role="group" aria-label={viewCopy.group} className={`mt-6 ${VIEW_SWITCH}`}>
      {views.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === tab}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={VIEW_BUTTON[option === tab ? "pressed" : "other"]}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}
