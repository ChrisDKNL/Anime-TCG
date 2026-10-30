import type { PublishedOdds } from "@anime-tcg/shared/api";
import { RARITIES, RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { useLayoutEffect, useRef } from "react";
import { cardCopy, formatCount, oddsCopy, percent } from "../../lib/packsCopy";
import { BODY_TEXT, BUTTON, DIALOG, PANEL_HEADING } from "../account/styles";
import { TIER_TEXT } from "./styles";

interface Props {
  odds: PublishedOdds;
  open: boolean;
  /** Close, Escape or the backdrop: the caller returns focus to `Pack odds`. */
  onClose: () => void;
}

const HEADING_ID = "odds-heading";

/**
 * The odds page (card-and-rarity.md §7.3) as a native modal dialog: every
 * figure is the held `PublishedOdds`, even a stale one, read whole; the page
 * computes no chance of its own. Focus starts on the dialog itself, so a
 * screen reader reads it from its heading (packs-page.md §3.5). Its only
 * button is `Close`.
 */
export function OddsDialog({ odds, open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={HEADING_ID}
      onClose={onClose}
      // Light dismiss: a click on the backdrop closes it, as Close and Escape do (packs-page.md §3.5).
      closedby="any"
      className={DIALOG}
    >
      {open && (
        <div className="flex flex-col gap-4">
          <h2 id={HEADING_ID} className={PANEL_HEADING}>
            {oddsCopy.heading}
          </h2>
          <TierTable odds={odds} />
          <p className={BODY_TEXT}>{oddsCopy.slots(odds)}</p>
          <div className="flex flex-col gap-2">
            <p className={BODY_TEXT}>{oddsCopy.enchanted(odds)}</p>
            {odds.radiant.chance > 0 && <p className={BODY_TEXT}>{oddsCopy.radiant(odds)}</p>}
            <p className={BODY_TEXT}>{oddsCopy.pity(odds)}</p>
            {odds.pity.freePacksOnly && <p className={BODY_TEXT}>{oddsCopy.shop}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <p className={BODY_TEXT}>{oddsCopy.tiers(odds)}</p>
            <p className={BODY_TEXT}>{oddsCopy.pool(odds)}</p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className={`${BUTTON.secondary} self-start`}
          >
            {oddsCopy.close}
          </button>
        </div>
      )}
    </dialog>
  );
}

function TierTable({ odds }: { odds: PublishedOdds }) {
  const { columns } = oddsCopy;
  return (
    <div>
      <table aria-labelledby={HEADING_ID} className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs text-zinc-400">
            <th scope="col" className="py-2 pr-2 text-left font-normal">
              {columns.tier}
            </th>
            <th scope="col" className="px-2 py-2 text-right font-normal">
              {columns.characters}
            </th>
            <th scope="col" className="px-2 py-2 text-right font-normal">
              {columns.share}
            </th>
            <th scope="col" className="py-2 pl-2 text-right font-normal">
              {columns.perPack}
            </th>
          </tr>
        </thead>
        <tbody>
          {RARITIES.map((rarity) => (
            <tr key={rarity} className="border-b border-zinc-800">
              <th scope="row" className={`py-2 pr-2 text-left font-medium ${TIER_TEXT[rarity]}`}>
                {/* The stars need room the phone does not have; the word carries the tier everywhere (§5.4). */}
                <span
                  aria-hidden="true"
                  className="mr-1.5 hidden tracking-[2px] [font-variant-emoji:text] sm:inline"
                >
                  {cardCopy.starGlyphs(rarity)}
                </span>
                {RARITY_LABEL[rarity]}
              </th>
              <td className="px-2 py-2 text-right text-zinc-200 tabular-nums">
                {formatCount(odds.tierSizes[rarity])}
              </td>
              <td className="px-2 py-2 text-right text-zinc-200 tabular-nums">
                {percent(odds.share[rarity], odds.scale)}
              </td>
              <td className="py-2 pl-2 text-right text-zinc-200 tabular-nums">
                {percent(odds.perPack[rarity], odds.scale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-zinc-400">{oddsCopy.tableNote}</p>
    </div>
  );
}
