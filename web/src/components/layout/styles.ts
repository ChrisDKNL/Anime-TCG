import { BUTTON, FOCUS_RING } from "../account/styles";

/**
 * The navigation's class strings (navigation-and-landing.md §6), complete at
 * build time and built from existing utilities and the accounts styles: no new
 * tokens.
 */

/**
 * §6.1: a plain wordmark, no gradient (the gradient title was §2 debt). It is
 * a header link, so it is a 40 px target on phone like the others (§7).
 */
export const WORDMARK = `inline-flex min-h-10 items-center rounded text-xl font-black tracking-tight text-zinc-100 sm:min-h-0 ${FOCUS_RING}`;

/** Today's tab group, unchanged in look; on phone the links share the row (`flex-auto`). */
export const NAV_GROUP = "flex w-full gap-1 rounded-xl bg-zinc-900 p-1 sm:w-auto";

export type LinkState = "current" | "other";

const NAV_LINK_BASE = `inline-flex min-h-10 flex-auto items-center justify-center rounded-lg px-4 py-1.5 text-sm font-medium sm:min-h-0 sm:flex-none ${FOCUS_RING}`;

export const NAV_LINK: Record<LinkState, string> = {
  current: `${NAV_LINK_BASE} bg-zinc-700 text-white`,
  other: `${NAV_LINK_BASE} text-zinc-400 hover:text-zinc-200`,
};

/** Signed-out `Log in`: `BUTTON.text` at `text-sm` (§6.1). */
export const HEADER_TEXT_LINK = `inline-flex h-10 items-center rounded px-1 text-sm font-medium text-zinc-400 hover:text-zinc-200 sm:h-7 ${FOCUS_RING}`;

/** Links styled as buttons: the button classes plus the centring a link needs inside `min-h-10`. */
export const LINK_BUTTON = {
  primary: `${BUTTON.primary} inline-flex items-center justify-center`,
  secondary: `${BUTTON.secondary} inline-flex items-center justify-center`,
} as const;

/** An underlined link inside a sentence (§6.2). */
export const TEXT_LINK = `rounded text-zinc-200 underline decoration-zinc-600 underline-offset-2 hover:text-white ${FOCUS_RING}`;

/** §6.3: account pages, `/account`, `/profile` and not-found; focused by script only. */
export const PAGE_HEADING = "mb-6 text-xl font-bold text-zinc-100 focus:outline-none";

export const SKIP_LINK = `sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 ${BUTTON.secondary} bg-zinc-950`;
