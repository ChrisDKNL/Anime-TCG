import { viewCopy } from "../../lib/collectionCopy";
import type { CollectionTab } from "../../lib/collectionView";
import { VIEW_BUTTON, VIEW_SWITCH } from "./styles";

const TABS: readonly CollectionTab[] = ["cards", "series"];

interface Props {
  tab: CollectionTab;
  disabled: boolean;
  onChange: (tab: CollectionTab) => void;
}

/**
 * `Cards` and `Series` (collection-overview.md §3.2 step 5, §7): a group of
 * toggle buttons, so focus stays on the one pressed; the group can take a
 * further view later without changing the row (§2).
 */
export function ViewSwitch({ tab, disabled, onChange }: Props) {
  return (
    <div role="group" aria-label={viewCopy.group} className={`mt-6 ${VIEW_SWITCH}`}>
      {TABS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === tab}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={VIEW_BUTTON[option === tab ? "pressed" : "other"]}
        >
          {viewCopy[option]}
        </button>
      ))}
    </div>
  );
}
