import { useEffect, useRef, type RefObject } from "react";
import { useShellContext } from "./useShell";

/** collection-overview.md §7 "Results line": the live region hears it this long after the last change. */
export const RESULTS_ANNOUNCE_DELAY_MS = 500;

/**
 * Sends the results line to the app's live region once it has stopped
 * changing for 500 ms after a change the player made, never per keystroke
 * (§7). `asked` counts the player's changes (search, filters, sort, paging,
 * Clear filters): a line that changes while it stands still, as a refetch
 * changes it, is taken as said without a word (§4.1 "refreshing": nothing
 * marks the refetch). When focus is on the line itself (a page change moves
 * it there), the screen reader reads it on focus, so the live region stays
 * quiet rather than read it twice.
 */
export function useResultsAnnouncement(
  text: string,
  asked: number,
  line: RefObject<HTMLElement | null>,
): void {
  const { announce } = useShellContext();
  const said = useRef({ text, asked });

  useEffect(() => {
    if (asked === said.current.asked) {
      said.current = { text, asked };
      return;
    }
    // The player changed something: the line is due once it settles, which can take a render more
    // than the change itself (the search is deferred, §5.5).
    const id = window.setTimeout(() => {
      const before = said.current.text;
      said.current = { text, asked };
      if (text !== before && document.activeElement !== line.current) announce(text);
    }, RESULTS_ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [text, asked, line, announce]);
}
