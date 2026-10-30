import type { PublishedOdds, Rarity } from "@anime-tcg/shared/api";
import { RARITIES, RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { landingCopy } from "../../lib/navigationCopy";
import { cardCopy } from "../../lib/packsCopy";
import { TIER_TEXT } from "../packs/styles";

const HEADER_CELL = "py-2 text-xs font-normal text-zinc-400";
const FIGURE_CELL = "py-2 text-right text-zinc-200 tabular-nums";

/** Each tier's flat frame colour, the collection thumbnails' (card-and-rarity.md §5.2): no glow. */
const SWATCH: Record<Rarity, string> = {
  common: "bg-(--card-frame-common)",
  uncommon: "bg-(--card-frame-uncommon)",
  rare: "bg-(--card-frame-rare)",
  epic: "bg-(--card-frame-flat-epic)",
  legendary: "bg-(--card-frame-flat-legendary)",
  mythic: "bg-(--card-frame-flat-mythic)",
};

const HEADING_ID = "pack-odds";

/**
 * `Pack odds` on the landing page, a section of its own (navigation-and-landing.md
 * §3.7 item 3, §6.2, §7): a standard pack's chance of at least one card of each
 * tier and each tier's share of its cards, lowest tier first, exactly as the
 * server publishes them. Before each tier word a static swatch of its frame
 * colour and, from 640 px, its stars; both are `aria-hidden`, the word carries the tier.
 */
export function PackOdds({ odds }: { odds: PublishedOdds }) {
  const { odds: copy } = landingCopy;
  return (
    <section aria-labelledby={HEADING_ID} className="mt-16">
      <h2 id={HEADING_ID} className="text-lg font-bold text-zinc-100">
        {copy.heading}
      </h2>
      <table aria-labelledby={HEADING_ID} className="mt-4 w-full max-w-xl text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th scope="col" className={`${HEADER_CELL} text-left`}>
              {copy.tier}
            </th>
            <th scope="col" className={`${HEADER_CELL} text-right`}>
              {copy.perPack}
            </th>
            <th scope="col" className={`${HEADER_CELL} text-right`}>
              {copy.share}
            </th>
          </tr>
        </thead>
        <tbody>
          {RARITIES.map((tier) => (
            <tr key={tier} className="border-b border-zinc-800">
              <th scope="row" className={`py-2 text-left font-normal whitespace-nowrap ${TIER_TEXT[tier]}`}>
                <span
                  aria-hidden="true"
                  className={`mr-2 inline-block aspect-[5/7] w-2.5 rounded-[2px] align-middle ${SWATCH[tier]}`}
                />
                <span
                  aria-hidden="true"
                  className="mr-1.5 hidden tracking-[2px] [font-variant-emoji:text] sm:inline"
                >
                  {cardCopy.starGlyphs(tier)}
                </span>
                {RARITY_LABEL[tier]}
              </th>
              <td className={FIGURE_CELL}>{copy.figure(odds.perPack[tier], odds.scale)}</td>
              <td className={FIGURE_CELL}>{copy.figure(odds.share[tier], odds.scale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-zinc-400">
        {copy.source(odds.snapshot.characterCount, odds.snapshot.takenAt)}
      </p>
    </section>
  );
}
