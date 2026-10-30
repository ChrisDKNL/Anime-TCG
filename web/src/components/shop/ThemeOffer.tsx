import type { ThemeOffer as Theme } from "@anime-tcg/shared/api";
import { RARITIES, RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { useId, useState } from "react";
import type { SeriesName } from "../../lib/collectionSeries";
import { shopCopy } from "../../lib/economyCopy";
import { listSeparator, percent } from "../../lib/packsCopy";
import { BUTTON } from "../account/styles";
import { TEXT_BUTTON_SM, TIER_TEXT } from "../packs/styles";

/** market-and-shop.md §3.3 step 2: the first three series, then `and <N> more`. */
const SERIES_SHOWN = 3;

/** Why `Buy…` cannot be used now, or null when it can: the held balance and answers, never authoritative. */
export type BuyReason = { kind: "stale" } | { kind: "tooLittle"; balance: number } | null;

interface Props {
  theme: Theme;
  names: ReadonlyMap<number, SeriesName>;
  reason: BuyReason;
  onBuy: () => void;
}

/**
 * One theme of the shop (market-and-shop.md §3.3 step 2, §5.2, §6, §7): an
 * `<article>` named by its title, with its series, the published odds, the
 * special-pack lines, the price and `Buy…`. Every figure is the theme's own,
 * as `GET /api/shop` sent it. `Buy…` stays focusable when it cannot be used
 * (`aria-disabled`), so the reason under it is read with it.
 */
export function ThemeOffer({ theme, names, reason, onBuy }: Props) {
  const headingId = useId();
  const priceId = useId();
  const reasonId = useId();
  const { odds } = theme;
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-2 border-b border-zinc-800 py-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <h2 id={headingId} dir="auto" className="text-base font-semibold break-words text-zinc-100">
          {theme.title}
        </h2>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <div className="flex items-center gap-3">
            <p id={priceId} className="text-sm text-zinc-200 tabular-nums">
              {shopCopy.price(theme.price)}
            </p>
            <button
              type="button"
              aria-disabled={reason === null ? undefined : "true"}
              aria-describedby={reason === null ? priceId : `${priceId} ${reasonId}`}
              onClick={reason === null ? onBuy : undefined}
              className={BUTTON.primary}
            >
              {shopCopy.buy}
            </button>
          </div>
          {reason !== null && (
            <p id={reasonId} className="text-xs text-zinc-400 tabular-nums">
              {reason.kind === "stale" ? shopCopy.stale : shopCopy.tooLittle(theme.price, reason.balance)}
            </p>
          )}
        </div>
      </div>
      <SeriesLine franchiseIds={theme.franchiseIds} names={names} />
      <p className="text-sm text-zinc-400">
        {shopCopy.oddsLead}{" "}
        {RARITIES.map((rarity, i) => (
          <span key={rarity}>
            {i > 0 && shopCopy.oddsSeparator}
            <span className={TIER_TEXT[rarity]}>{RARITY_LABEL[rarity]}</span>{" "}
            <span className="tabular-nums">{percent(odds.perPack[rarity], odds.scale)}</span>
          </span>
        ))}
      </p>
      <details className="text-sm text-zinc-400">
        <summary className={`${TEXT_BUTTON_SM} inline-flex cursor-pointer items-center`}>
          {shopCopy.oddsDisclosure}
        </summary>
        {/* No per-card share until `ThemeOffer.odds` publishes one (§3.8 E8): the floors and the tier sizes. */}
        <p className="mt-1">{shopCopy.slots(odds)}</p>
        <p className="mt-1 tabular-nums">{shopCopy.tierSizes(odds.tierSizes)}</p>
      </details>
      <div className="flex max-w-prose flex-col gap-1 text-sm text-zinc-400">
        <p>{shopCopy.radiant(odds)}</p>
        <p>{shopCopy.shopRule}</p>
      </div>
    </article>
  );
}

/** `<title>, <title>, <title> and <N> more`; the button reveals the rest in place. */
function SeriesLine({
  franchiseIds,
  names,
}: {
  franchiseIds: readonly number[];
  names: ReadonlyMap<number, SeriesName>;
}) {
  const [expanded, setExpanded] = useState(false);
  const known = franchiseIds.flatMap((id) => names.get(id) ?? []);
  if (known.length === 0) return null;
  const shown = expanded ? known : known.slice(0, SERIES_SHOWN);
  const hidden = known.length - shown.length;
  return (
    <p className="text-sm break-words text-zinc-400">
      {shown.map(({ franchise, year }, i) => (
        <span key={franchise.id}>
          {hidden > 0 ? i > 0 && ", " : listSeparator(i, shown.length)}
          <bdi>{franchise.title}</bdi>
          {year !== null && `, ${year}`}
        </span>
      ))}
      {hidden > 0 && (
        <>
          {" "}
          <button type="button" onClick={() => setExpanded(true)} className={TEXT_BUTTON_SM}>
            {shopCopy.moreSeries(hidden)}
          </button>
        </>
      )}
    </p>
  );
}
