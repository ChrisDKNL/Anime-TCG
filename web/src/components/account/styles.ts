/**
 * The accounts feature's class strings, complete at build time, all existing
 * utilities (accounts.md §6: no new tokens). Red is the existing semantic
 * colour of the AniList banner and the Inventory Reset button.
 */

const FOCUS_RING = "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500";
const DISABLED = "disabled:cursor-not-allowed disabled:opacity-50";

export type ButtonKind = "primary" | "secondary" | "dangerOutline" | "dangerSolid" | "text";

export const BUTTON: Record<ButtonKind, string> = {
  primary: `rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:hover:bg-violet-600 ${FOCUS_RING} ${DISABLED}`,
  secondary: `rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:hover:bg-transparent ${FOCUS_RING} ${DISABLED}`,
  dangerOutline: `rounded-lg border border-red-900/60 px-4 py-2 text-sm text-red-300 hover:bg-red-950/50 disabled:hover:bg-transparent ${FOCUS_RING} ${DISABLED}`,
  dangerSolid: `rounded-lg bg-red-800/60 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-700/60 disabled:hover:bg-red-800/60 ${FOCUS_RING} ${DISABLED}`,
  text: `rounded px-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 disabled:hover:text-zinc-400 ${FOCUS_RING} ${DISABLED}`,
};

export const INPUT = `w-full rounded-lg border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 disabled:opacity-50 ${FOCUS_RING}`;

export const INPUT_BORDER: Record<"valid" | "invalid", string> = {
  valid: "border-zinc-800",
  invalid: "border-red-800",
};

export const PANEL = "rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100";
export const PANEL_HEADING = "text-lg font-bold";
export const SECTION_HEADING = "text-sm font-semibold text-zinc-200";
export const BODY_TEXT = "text-sm text-zinc-400";
export const HINT_TEXT = "text-xs text-zinc-500";
export const ERROR_TEXT = "text-xs text-red-300";

export const ALERT_BANNER =
  "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200";
export const STATUS_BANNER = "rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-200";

/** The pack button's gradient on the avatar placeholder; roadmap 4 replaces it with card art. */
export const AVATAR =
  "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-600 via-violet-600 to-sky-600 text-xs font-bold text-white uppercase";
