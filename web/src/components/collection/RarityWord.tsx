import type { Rarity } from "@anime-tcg/shared/api";
import { RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { cardCopy } from "../../lib/packsCopy";
import { TIER_TEXT } from "../packs/styles";

/** A tier as the dialogs name it (collection-overview.md §3.4): its stars, hidden from the name, then the word. */
export function RarityWord({ rarity }: { rarity: Rarity }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={`mr-1.5 tracking-[2px] [font-variant-emoji:text] ${TIER_TEXT[rarity]}`}
      >
        {cardCopy.starGlyphs(rarity)}
      </span>
      <span className={TIER_TEXT[rarity]}>{RARITY_LABEL[rarity]}</span>
    </>
  );
}
