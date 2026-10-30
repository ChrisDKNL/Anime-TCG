import type { PublishedOdds } from "@anime-tcg/shared/api";
import { RARITIES, RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { useId } from "react";
import { landingCopy } from "../../lib/navigationCopy";
import { TIER_TEXT } from "../packs/styles";

const HEADER_CELL = "py-2 text-xs font-normal text-zinc-400";
const FIGURE_CELL = "py-2 text-right text-zinc-200 tabular-nums";

/**
 * `Pack odds` on the landing page (navigation-and-landing.md §3.7 item 3): a
 * standard pack's chance of at least one card of each tier and each tier's
 * share of its cards, lowest tier first, exactly as the server publishes them.
 */
export function PackOdds({ odds }: { odds: PublishedOdds }) {
  const headingId = useId();
  const { odds: copy } = landingCopy;
  return (
    <div className="mt-8 max-w-xl">
      <h3 id={headingId} className="text-sm font-semibold text-zinc-200">
        {copy.heading}
      </h3>
      <table aria-labelledby={headingId} className="mt-2 w-full text-sm">
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
              <th scope="row" className={`py-2 text-left font-normal ${TIER_TEXT[tier]}`}>
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
    </div>
  );
}
