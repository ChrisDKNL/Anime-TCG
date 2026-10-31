import { BUTTON, FOCUS_RING, TEXT_KIND } from "../account/styles";

/**
 * The navigation's class strings (navigation-and-landing.md §6, as visual-identity.md §10 restyles it),
 * complete at build time and built from the identity's tokens and the accounts styles.
 */

/**
 * visual-identity.md §10.2: the display face at 800, 85 % wide, 20 px, no gradient (the gradient title
 * was standards §2 debt). It is a header link, so it is a 44 px target on phone (§6.1) like the others.
 */
export const WORDMARK = `display-tight inline-flex min-h-11 items-center rounded text-xl font-extrabold text-ink-100 sm:min-h-0 ${FOCUS_RING}`;

/** The page links sit bare in the header: no tab group box (§10.2). On phone they share their row (`flex-auto`). */
export const NAV_GROUP = "flex w-full gap-1 sm:w-auto";

export type LinkState = "current" | "other";

/** §10.2: sans 600 at 14 px in a 44 px target, the current page marked by a 2 px Volt line at its foot. */
const NAV_LINK_BASE = `inline-flex min-h-11 flex-auto items-center justify-center gap-1 border-b-2 px-2 pt-0.5 text-sm font-semibold sm:flex-none sm:px-3 ${FOCUS_RING}`;

export const NAV_LINK: Record<LinkState, string> = {
  current: `${NAV_LINK_BASE} border-volt text-ink-100`,
  other: `${NAV_LINK_BASE} border-transparent text-ink-400 hover:text-ink-100`,
};

/** Signed-out `Log in`: `BUTTON.text` at `text-sm` (§6.1). */
export const HEADER_TEXT_LINK = `inline-flex h-11 items-center rounded px-1 text-sm font-medium sm:h-7 ${TEXT_KIND} ${FOCUS_RING}`;

/** Links styled as buttons: the button classes plus the centring a link needs inside `min-h-12`. */
export const LINK_BUTTON = {
  primary: `${BUTTON.primary} inline-flex items-center justify-center`,
  secondary: `${BUTTON.secondary} inline-flex items-center justify-center`,
} as const;

/** An underlined link inside a sentence (§6.2); the line is a non-text mark, `ink-500` is 4.4:1 (§5.4). */
export const TEXT_LINK = `rounded text-ink-200 underline decoration-ink-500 underline-offset-2 hover:text-ink-100 ${FOCUS_RING}`;

/** visual-identity.md §10.1 and §4.2: the page header, eyebrow 8 px above the title, 24 px (32 from `sm`) to the page. */
export const PAGE_HEADER = "mb-6 sm:mb-8";
export const EYEBROW = "mb-2 font-mono text-eyebrow text-ink-400 uppercase sm:text-[0.75rem]";

export type TitleSize = "title" | "hero";

/** The `h1`: focused by script only, so no ring. `hero` is the landing's (§4.2). */
export const TITLE: Record<TitleSize, string> = {
  title: "display-tight text-title text-ink-100 focus:outline-none sm:text-[3rem] lg:text-[3.5rem]",
  hero: "display-tight text-hero text-ink-100 focus:outline-none sm:text-[4.5rem] lg:text-[6rem]",
};

/** `page-enter` (§9.1): on a navigation the eyebrow, then 40 ms later the title, fade in from 6 px down. */
export const PAGE_ENTER: Record<"eyebrow" | "title", string> = {
  eyebrow: "animate-page-enter motion-reduce:animate-none",
  title: "animate-page-enter [animation-delay:40ms] motion-reduce:animate-none",
};

/** The footer's links: the footer's own `ink-400`, underlined, lighter on hover. */
export const FOOTER_LINK = `rounded underline decoration-ink-500 underline-offset-2 hover:text-ink-200 ${FOCUS_RING}`;

export const SKIP_LINK = `sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 ${LINK_BUTTON.secondary}`;
