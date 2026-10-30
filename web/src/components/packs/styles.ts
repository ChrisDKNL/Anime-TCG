import type { Rarity } from "@anime-tcg/shared/api";
import { FOCUS_RING } from "../account/styles";

/**
 * The packs page's class strings (packs-page.md §6), complete at build time:
 * the accounts styles plus the card tokens. No gradient, glow, shadow, ring,
 * meter or badge anywhere on the control (§6.1).
 */

/** `BUTTON.text` at `text-sm` (§6.1 `Pack odds`): 40 px on phone, 28 px from `sm`. */
export const TEXT_BUTTON_SM = `h-10 sm:h-7 rounded px-1 text-sm font-medium text-zinc-400 hover:text-zinc-200 ${FOCUS_RING}`;

export const SECONDARY_LINE = "text-sm text-zinc-400";
export const ERROR_LINE = "text-sm text-red-300";

/** Every text in a tier colour (card-and-rarity.md §4.2): the `-text` tokens, never the Epic mark. */
export const TIER_TEXT: Record<Rarity, string> = {
  common: "text-rarity-common-text",
  uncommon: "text-rarity-uncommon-text",
  rare: "text-rarity-rare-text",
  epic: "text-rarity-epic-text",
  legendary: "text-rarity-legendary-text",
  mythic: "text-rarity-mythic-text",
};

/** §5.2: two fluid columns on a phone, three 180 px cards from `sm`, five from `lg`, left-aligned. */
export const REVEAL_GRID =
  "grid grid-cols-2 justify-start gap-4 sm:grid-cols-[repeat(3,11.25rem)] lg:grid-cols-[repeat(5,11.25rem)]";

/** The `New` marker (collection-overview.md §6.4): flat, no fill and no glow. */
export const NEW_MARKER =
  "rounded border border-zinc-600 px-1.5 text-[11px] font-semibold tracking-wider text-zinc-200 uppercase";
