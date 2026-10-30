import type { KeyboardEvent, MouseEvent } from "react";

/**
 * The guards every button that deals cards or moves the balance shares (packs-page.md §3.3
 * step 2): the single-flight guard covers only the time a request is in
 * flight, and a local server can answer before a double click's second click
 * or the next auto-repeat of a held Enter, so those never count as a new
 * activation. A click from the keyboard has `detail` 0.
 */
export function activateOnce(event: MouseEvent, activate: () => void): void {
  if (event.detail <= 1) activate();
}

/** A held Enter repeats keydown, and each repeat would click the button again; a held Space clicks once, on keyup. */
export function ignoreRepeat(event: KeyboardEvent): void {
  if (event.repeat && event.key === "Enter") event.preventDefault();
}
