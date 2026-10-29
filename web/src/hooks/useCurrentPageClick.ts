import { useLocation } from "@tanstack/react-router";
import { useCallback, type MouseEvent } from "react";

/** A click the router would handle itself; the browser keeps middle, Ctrl, Shift, Alt and Cmd clicks (§3.5 step 3). */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}

/**
 * Activating the link of the page already showing does nothing: no history
 * entry, no scroll and no focus move (navigation-and-landing.md §3.5 step 3).
 * The router would otherwise reload the same location and run the page-change
 * focus. A modified click still opens the page in a new tab.
 */
export function useCurrentPageClick(path: string): {
  current: boolean;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
} {
  const current = useLocation({ select: (location) => location.pathname === path });
  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (current && isPlainClick(event)) event.preventDefault();
    },
    [current],
  );
  return { current, onClick };
}
