import { useEffect, useRef, type RefObject } from "react";
import { useShellContext } from "./useShell";

/** collection-overview.md §7 "Results line": the live region hears it this long after the last change. */
export const RESULTS_ANNOUNCE_DELAY_MS = 500;

/**
 * Sends the results line to the app's live region once it has stopped
 * changing for 500 ms, never per keystroke (§7). When focus is on the line
 * itself (a page change moves it there), the screen reader reads it on focus,
 * so the live region stays quiet rather than read it twice.
 */
export function useResultsAnnouncement(text: string, line: RefObject<HTMLElement | null>): void {
  const { announce } = useShellContext();
  const said = useRef(text);

  useEffect(() => {
    if (text === said.current) return;
    const id = window.setTimeout(() => {
      said.current = text;
      if (document.activeElement !== line.current) announce(text);
    }, RESULTS_ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [text, line, announce]);
}
