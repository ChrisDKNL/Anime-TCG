import { useEffect, useState } from "react";

/**
 * Whether a reveal's entrance runs on the page now showing it
 * (navigation-and-landing.md §3.10 item 2, §3.13 step 5, §3.14 step 6): only
 * for cards that landed while their page was showing or about to show
 * (`landedShowing`), and only on their first showing. Back, Forward and the
 * `See your latest…` links show held cards without it. `shown` outlives the
 * page (the layout holds it), so a return is told from a first showing even
 * when the answer came before the page had mounted. The answer is fixed for
 * the mount, so a re-render never cuts an entrance short.
 */
export function useEntrance<T extends object>(
  item: T | null,
  landedShowing: boolean,
  shown: WeakSet<T>,
): boolean {
  const [shownBefore] = useState(() => (item !== null && shown.has(item) ? item : null));
  useEffect(() => {
    if (item !== null) shown.add(item);
  }, [item, shown]);
  return item !== null && landedShowing && item !== shownBefore;
}
