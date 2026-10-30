/**
 * The accounts feature's class strings, complete at build time, all existing
 * utilities (accounts.md §6: no new tokens). Red is the app's semantic
 * colour for errors and destructive actions: the alert banners, the field
 * errors and the Delete account buttons.
 */

export const FOCUS_RING = "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500";
/** `aria-disabled` looks the same as `disabled`: submit buttons use it so they keep focus (§7 "Forms"). */
const DISABLED =
  "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/**
 * §7: touch targets are at least 40 px tall on phone. That wins over §6's
 * `py-2 text-sm` (36 px) below `sm`; from `sm` up the §6 sizes apply unchanged.
 */
const PHONE_MIN_HEIGHT = "min-h-10 sm:min-h-0";

export type ButtonKind = "primary" | "secondary" | "dangerOutline" | "dangerSolid" | "text";

export const BUTTON: Record<ButtonKind, string> = {
  primary: `rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:hover:bg-violet-600 aria-disabled:hover:bg-violet-600 ${PHONE_MIN_HEIGHT} ${FOCUS_RING} ${DISABLED}`,
  secondary: `rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:hover:bg-transparent aria-disabled:hover:bg-transparent ${PHONE_MIN_HEIGHT} ${FOCUS_RING} ${DISABLED}`,
  dangerOutline: `rounded-lg border border-red-900/60 px-4 py-2 text-sm text-red-300 hover:bg-red-950/50 disabled:hover:bg-transparent aria-disabled:hover:bg-transparent ${PHONE_MIN_HEIGHT} ${FOCUS_RING} ${DISABLED}`,
  dangerSolid: `rounded-lg bg-red-800/60 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-700/60 disabled:hover:bg-red-800/60 aria-disabled:hover:bg-red-800/60 ${PHONE_MIN_HEIGHT} ${FOCUS_RING} ${DISABLED}`,
  /** The Show/Hide toggles: §6's 28 px from `sm` up, 40 px on phone. */
  text: `h-10 sm:h-7 rounded px-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 disabled:hover:text-zinc-400 aria-disabled:hover:text-zinc-400 ${FOCUS_RING} ${DISABLED}`,
};

/** 40 px on phone so the Show/Hide toggle inside a password field fits its 40 px target. */
export const INPUT = `${PHONE_MIN_HEIGHT} w-full rounded-lg border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 disabled:opacity-50 ${FOCUS_RING}`;

export const INPUT_BORDER: Record<"valid" | "invalid", string> = {
  valid: "border-zinc-800",
  invalid: "border-red-800",
};

export const ACCOUNT_CONTROL = `inline-flex max-w-full items-center gap-2 rounded-xl bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-900 ${PHONE_MIN_HEIGHT} ${FOCUS_RING}`;

export const MENU_ITEM = `block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 focus:bg-zinc-800 ${PHONE_MIN_HEIGHT} focus:outline-none`;

/** The modal `<dialog>` shell: the delete confirmation and the odds page (packs-page.md §3.5, §5.4). */
export const DIALOG =
  "pop-in m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100 backdrop:bg-zinc-950/70 backdrop:backdrop-blur-sm focus:outline-none";

export const PANEL = "rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100";
export const PANEL_HEADING = "text-lg font-bold";
export const SECTION_HEADING = "text-sm font-semibold text-zinc-200";
export const BODY_TEXT = "text-sm text-zinc-400";
export const HINT_TEXT = "text-xs text-zinc-500";
export const ERROR_TEXT = "text-xs text-red-300";

export const ALERT_BANNER =
  "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200";
export const STATUS_BANNER = "rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-200";

/**
 * The avatar placeholder: a solid neutral circle, because engineering standards
 * §2 bans purple-to-pink gradients (this overrides accounts.md §6's gradient).
 * Roadmap 4 replaces it with card art.
 */
export const AVATAR =
  "inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs font-bold text-white uppercase";
