import { RARITIES } from "@anime-tcg/shared/rarity";
import { landingCopy } from "../../lib/navigationCopy";
import { cardCopy } from "../../lib/packsCopy";
import { TIER_TEXT } from "../packs/styles";

/**
 * The demo pack drawn beside the hero's text from 640 px (navigation-and-landing.md
 * §3.7 item 1.8, §6.2): a label at the reveal card's size and aspect with the
 * wordmark, `Demo pack`, the six tiers' stars as a ladder and `Five cards`.
 * It is `aria-hidden` and not a control, and it never moves, glows, tilts or
 * changes: no shadow, gradient, hover state or motion, in any state of the demo.
 * Below 640 px it is not rendered, so the button stays above the fold.
 */
export function PackDrawing() {
  const { packDrawing } = landingCopy;
  return (
    <div
      aria-hidden="true"
      data-testid="landing-pack"
      className="hidden aspect-[5/7] w-[11.25rem] flex-col rounded-[12px] border border-zinc-700 bg-zinc-900 p-4 sm:flex"
    >
      <p className="text-base font-black tracking-tight text-zinc-100">{packDrawing.brand}</p>
      <p className="text-xs text-zinc-400">{packDrawing.label}</p>
      <div className="mt-auto flex flex-col">
        {RARITIES.map((tier) => (
          <span
            key={tier}
            className={`text-[11px] leading-4 tracking-[2px] [font-variant-emoji:text] ${TIER_TEXT[tier]}`}
          >
            {cardCopy.starGlyphs(tier)}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-400">{packDrawing.cards}</p>
    </div>
  );
}
