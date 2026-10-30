import type { KeyboardEvent, MouseEvent } from "react";

/**
 * The guards of a button that opens a pack, the packs page's and the landing
 * page's demo alike (packs-page.md §3.3 step 2; navigation-and-landing.md
 * §3.7 item 1.3). The single-flight guard covers only the time an opening is
 * in flight; a local server can answer before a double click's second click
 * or the next auto-repeat of a held Enter, so those never count as a new
 * activation. A click from the keyboard has `detail` 0.
 */
export function openOnce(event: MouseEvent, onOpen: () => void) {
  if (event.detail <= 1) onOpen();
}

/** A held Enter repeats keydown, and each repeat would click the button again; a held Space clicks once, on keyup. */
export function ignoreRepeat(event: KeyboardEvent) {
  if (event.repeat && event.key === "Enter") event.preventDefault();
}
