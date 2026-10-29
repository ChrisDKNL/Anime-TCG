/** The id of every page's one `h1`: the focus target of page changes and of the skip link (§3.6). */
export const PAGE_HEADING_ID = "page-heading";

/**
 * Moves focus to the page's `h1`. A page change passes `preventScroll` so the
 * position the router restored on Back or Forward holds (§7 "Scroll"); the
 * skip link lets the browser bring the heading into view.
 */
export function focusPageHeading({ preventScroll }: { preventScroll: boolean }): void {
  document.getElementById(PAGE_HEADING_ID)?.focus({ preventScroll });
}
