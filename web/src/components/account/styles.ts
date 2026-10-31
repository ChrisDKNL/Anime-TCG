/**
 * The shared controls' class strings, complete at build time. Buttons, inputs, the focus ring and the
 * error text take the identity's values (docs/design/visual-identity.md §10.4, §5.4); every page uses
 * these constants, so every page follows. Red stays the alert banners' colour; error text is `danger`.
 */

/** §5.4: 2 px Volt with a 2 px gap in the page's night, so it shows on a Volt button too. */
export const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-night-950";

/**
 * Disabled (§10.4): a `night-800` block with `ink-500` words, hover and press included. `aria-disabled`
 * looks the same as `disabled`: submit buttons use it so they keep focus (accounts.md §7 "Forms").
 */
const DISABLED = [
  "disabled:cursor-not-allowed disabled:border-night-800 disabled:bg-night-800 disabled:text-ink-500",
  "disabled:hover:bg-night-800 disabled:active:border-night-800 disabled:active:bg-night-800",
  "aria-disabled:cursor-not-allowed aria-disabled:border-night-800 aria-disabled:bg-night-800 aria-disabled:text-ink-500",
  "aria-disabled:hover:bg-night-800 aria-disabled:active:border-night-800 aria-disabled:active:bg-night-800",
].join(" ");

/**
 * §10.4 and §6.1: 48 px tall on a phone, 44 px from `sm`, sans 700 at 15 px. Every filled kind shares the
 * box, the primary's border transparent, so a primary and a secondary side by side are the same size.
 */
const CONTROL_BOX = `min-h-12 rounded-control border px-5 py-2 text-[15px] font-bold sm:min-h-11 ${FOCUS_RING} ${DISABLED}`;

/** The Danger kind, Delete account only: the section's button and the confirmation's. */
const DANGER = `${CONTROL_BOX} border-danger bg-night-850 text-danger hover:bg-night-800`;

/** The Text kind's colours (§10.4), for every text button and text link that copies its look. */
export const TEXT_KIND =
  "text-ink-300 hover:text-ink-100 hover:underline disabled:cursor-not-allowed disabled:text-ink-500 disabled:hover:no-underline aria-disabled:cursor-not-allowed aria-disabled:text-ink-500 aria-disabled:hover:no-underline";

export type ButtonKind = "primary" | "secondary" | "dangerOutline" | "dangerSolid" | "text";

export const BUTTON: Record<ButtonKind, string> = {
  primary: `${CONTROL_BOX} border-transparent bg-volt text-volt-ink hover:bg-volt-hover active:bg-volt-press`,
  secondary: `${CONTROL_BOX} border-night-600 bg-night-850 text-ink-100 hover:bg-night-800 active:border-ink-400 active:bg-night-800`,
  dangerOutline: DANGER,
  dangerSolid: DANGER,
  /** The Show/Hide toggles: 44 px on phone (§6.1), 28 px from `sm` up, inside the field. */
  text: `h-11 rounded px-1 text-xs font-medium sm:h-7 ${TEXT_KIND} ${FOCUS_RING}`,
};

/** §5.1 raised fill, the strong hairline as its border; as tall as the buttons, so a field and a button share a row. */
export const INPUT = `min-h-12 w-full rounded-control border bg-night-850 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 disabled:cursor-not-allowed disabled:bg-night-800 disabled:text-ink-500 sm:min-h-11 ${FOCUS_RING}`;

export const INPUT_BORDER: Record<"valid" | "invalid", string> = {
  valid: "border-night-600",
  invalid: "border-danger",
};

/** §10.2: `night-850`, a `night-700` hairline, `radius-control`, 44 px tall. */
export const ACCOUNT_CONTROL = `inline-flex min-h-11 max-w-full items-center gap-2 rounded-control border border-night-700 bg-night-850 px-2 py-1.5 text-sm text-ink-200 hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-night-850 ${FOCUS_RING}`;

/**
 * 44 px on phone (visual-identity.md §6.1), as every control. Keyboard focus shows the Volt ring (§5.4): the
 * night-800 fill alone is about 1.2:1 against the menu.
 */
export const MENU_ITEM = `block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 focus:bg-zinc-800 min-h-11 sm:min-h-0 ${FOCUS_RING}`;

const DIALOG_SHELL =
  "pop-in m-auto max-h-[85vh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100 backdrop:bg-zinc-950/70 backdrop:backdrop-blur-sm focus:outline-none";

/** The modal `<dialog>` shell: the delete confirmation and the odds page (packs-page.md §3.5, §5.4). */
export const DIALOG = `${DIALOG_SHELL} max-w-lg`;

/** The same shell, wider, for the collection's card dialog (collection-overview.md §5.4). */
export const WIDE_DIALOG = `${DIALOG_SHELL} max-w-2xl`;

export const PANEL = "rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100";
export const PANEL_HEADING = "text-lg font-bold";
export const SECTION_HEADING = "text-sm font-semibold text-zinc-200";
export const BODY_TEXT = "text-sm text-zinc-400";
/** `ink-400`, not `ink-500`: no text below AA (§5.4). */
export const HINT_TEXT = "text-xs text-ink-400";
export const ERROR_TEXT = "text-xs text-danger";

export const ALERT_BANNER =
  "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200";
/** The alert banner's `Try again`: 44 px on a phone (visual-identity.md §6.1), the Volt ring (§5.4). */
export const BANNER_BUTTON = `min-h-11 rounded-control bg-red-800/60 px-3 py-1 font-medium hover:bg-red-700/60 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 ${FOCUS_RING}`;
export const STATUS_BANNER = "rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-200";

/**
 * The avatar placeholder: a solid neutral circle, because engineering standards
 * §2 bans purple-to-pink gradients (this overrides accounts.md §6's gradient).
 * Roadmap 4 replaces it with card art.
 */
export const AVATAR =
  "inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs font-bold text-white uppercase";
