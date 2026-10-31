import type { Rarity } from "@anime-tcg/shared/api";
import { FOCUS_RING } from "../account/styles";

/**
 * The collection overview's class strings (collection-overview.md §5, §6),
 * complete at build time and built from existing utilities and the card
 * tokens: this feature adds no token. No glow, gradient, shadow or lift
 * anywhere here; the card frames are the only exception (§6.6).
 */

/** §5.1: tiles at least 10.5 rem wide, never fewer than two columns. */
export const GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(10.5rem,calc(50%-0.375rem)),1fr))] gap-3";

/** §6.3: the controls' visible names, 4.5:1 on zinc-950 (not the accounts hint colour). */
export const CONTROL_LABEL = "text-xs text-zinc-400";

/** §6.3 bars: a neutral fill, never the accent or a tier colour. */
export const BAR_TRACK = "h-1 overflow-hidden rounded-full bg-zinc-800";
export const BAR_FILL =
  "block h-full rounded-full bg-zinc-300 transition-[width] duration-200 motion-reduce:transition-none";

export const VIEW_SWITCH = "inline-flex gap-1 rounded-lg bg-zinc-900 p-1";

const VIEW_BUTTON_BASE = `min-h-11 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 ${FOCUS_RING}`;

export const VIEW_BUTTON: Record<"pressed" | "other", string> = {
  pressed: `${VIEW_BUTTON_BASE} bg-zinc-700 text-white`,
  other: `${VIEW_BUTTON_BASE} text-zinc-400 hover:text-zinc-200`,
};

/**
 * §7 touch targets, 44 px on a phone (visual-identity.md §6.1): 12 px of padding each side, an 18 px
 * line box and the 1 px borders; the 11 px text's inherited 1.5 line height alone would not hold it.
 */
const CHIP_BASE = `rounded-md border px-2.5 py-3 text-[11px] leading-[18px] font-semibold tracking-wider uppercase disabled:cursor-not-allowed disabled:opacity-50 sm:py-1.5 ${FOCUS_RING}`;

/** §6.3 rarity chips: the fill is the pressed cue, so pressed does not rest on hue alone. */
export const TIER_CHIP: Record<Rarity, Record<"pressed" | "other", string>> = {
  common: {
    pressed: `${CHIP_BASE} border-rarity-common/80 bg-rarity-common/15 text-rarity-common-text`,
    other: `${CHIP_BASE} border-zinc-800 bg-transparent text-rarity-common-text hover:border-rarity-common/40`,
  },
  uncommon: {
    pressed: `${CHIP_BASE} border-rarity-uncommon/80 bg-rarity-uncommon/15 text-rarity-uncommon-text`,
    other: `${CHIP_BASE} border-zinc-800 bg-transparent text-rarity-uncommon-text hover:border-rarity-uncommon/40`,
  },
  rare: {
    pressed: `${CHIP_BASE} border-rarity-rare/80 bg-rarity-rare/15 text-rarity-rare-text`,
    other: `${CHIP_BASE} border-zinc-800 bg-transparent text-rarity-rare-text hover:border-rarity-rare/40`,
  },
  epic: {
    pressed: `${CHIP_BASE} border-rarity-epic/80 bg-rarity-epic/15 text-rarity-epic-text`,
    other: `${CHIP_BASE} border-zinc-800 bg-transparent text-rarity-epic-text hover:border-rarity-epic/40`,
  },
  legendary: {
    pressed: `${CHIP_BASE} border-rarity-legendary/80 bg-rarity-legendary/15 text-rarity-legendary-text`,
    other: `${CHIP_BASE} border-zinc-800 bg-transparent text-rarity-legendary-text hover:border-rarity-legendary/40`,
  },
  mythic: {
    pressed: `${CHIP_BASE} border-rarity-mythic/80 bg-rarity-mythic/15 text-rarity-mythic-text`,
    other: `${CHIP_BASE} border-zinc-800 bg-transparent text-rarity-mythic-text hover:border-rarity-mythic/40`,
  },
};

export const ALL_CHIP: Record<"pressed" | "other", string> = {
  pressed: `${CHIP_BASE} border-zinc-600 bg-zinc-800 text-zinc-100`,
  other: `${CHIP_BASE} border-zinc-800 text-zinc-300`,
};

/** §6.2: the tile is a bare button; its focus ring goes around the card, not the caption. */
export const TILE = "group flex h-full w-full flex-col gap-1.5 text-left focus-visible:outline-none";
export const TILE_RING =
  "block rounded-[12px] group-focus-visible:ring-2 group-focus-visible:ring-volt group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-night-950";
export const TILE_CAPTION =
  "flex min-h-4 items-baseline justify-between gap-2 px-0.5 text-xs leading-tight text-zinc-300 tabular-nums";

/** §6.2 skeleton tile: static, nothing shimmers or pulses. */
export const SKELETON_CARD = "aspect-[5/7] w-full rounded-xl bg-zinc-800";

export const RESULTS_LINE = "mt-4 text-sm text-zinc-400 tabular-nums focus:outline-none";
