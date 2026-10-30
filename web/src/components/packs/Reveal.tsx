import type { CharacterPublic, FranchiseRef, Rarity } from "@anime-tcg/shared/api";
import { RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { useId } from "react";
import { formatCount, listSeparator, revealCopy, summaryParts } from "../../lib/packsCopy";
import { Card, type CardEffects } from "../card/Card";
import { NEW_MARKER, REVEAL_GRID, TIER_TEXT } from "./styles";

export interface RevealCard {
  slot: number;
  character: CharacterPublic;
  rarity: Rarity;
  /** Known for an account's pack; the demo's cards have none. */
  isNew?: boolean;
}

/** A dealt pack, or null before the first one of the session: five empty slots in the same grid. */
export interface RevealPack {
  /** Changes with every opening, so a new pack's slots enter afresh. */
  id: string;
  /** The section's `h2`, which also names the list; null for the demo, which has none (navigation-and-landing.md §3.7). */
  heading: string | null;
  /** The list's name without a heading. */
  label: string;
  /** Words before the summary: the demo's `Demo pack: `. */
  summaryLead: string;
  cards: readonly RevealCard[];
  franchises: readonly FranchiseRef[];
  /** The special-pack lines under the summary, in order (card-and-rarity.md §7.1). */
  lines: readonly string[];
}

interface Props {
  pack: RevealPack | null;
  /** The rank chip's pool size: the held odds' `snapshot.characterCount`, or null. */
  poolSize: number | null;
  /** A new opening that landed while the page shows; never for a held reveal (packs-page.md §3.4 step 6). */
  entering: boolean;
  effects: CardEffects;
  showNew: boolean;
  /** An opening is in flight: the previous pack stays, marked busy, until the answer replaces it. */
  busy: boolean;
  /** The section's top margin: the packs page's `mt-10`, the landing page's `mt-6`. */
  spacing?: string;
}

/** The empty slots before the first pack: a pack's five cards, so the first reveal moves nothing. */
const EMPTY_SLOTS = [0, 1, 2, 3, 4] as const;

/**
 * The reveal (packs-page.md §3.4, §6.5): heading, pull summary, special
 * lines and the cards in slot order, never sorted by rarity. One component
 * for the packs page and the landing page's demo, which passes no `New`
 * markers, no lines and no effects. The entrance is the same for every pack:
 * no tier, kind or guarantee gets more motion, delay or colour than its frame.
 */
export function Reveal({ pack, poolSize, entering, effects, showNew, busy, spacing = "mt-10" }: Props) {
  const headingId = useId();
  if (pack === null) {
    return (
      <section className={spacing}>
        <div aria-hidden="true" className={`mt-4 ${REVEAL_GRID}`}>
          {EMPTY_SLOTS.map((slot) => (
            <div key={slot}>
              <div className="aspect-[5/7] w-full rounded-[12px] bg-zinc-900" />
              <div className="mt-1.5 min-h-5" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const cards = [...pack.cards].sort((a, b) => a.slot - b.slot);
  const newCount = showNew ? cards.filter((card) => card.isNew === true).length : 0;
  return (
    <section aria-labelledby={pack.heading === null ? undefined : headingId} className={spacing}>
      {pack.heading !== null && (
        <h2 id={headingId} className="text-lg font-bold text-zinc-100">
          {pack.heading}
        </h2>
      )}
      <Summary lead={pack.summaryLead} rarities={cards.map((card) => card.rarity)} newCount={newCount} />
      {pack.lines.length > 0 && (
        <div className="mt-1 flex max-w-prose flex-col gap-1">
          {pack.lines.map((line) => (
            <p key={line} className="text-sm text-zinc-400">
              {line}
            </p>
          ))}
        </div>
      )}
      <ul
        aria-labelledby={pack.heading === null ? undefined : headingId}
        aria-label={pack.heading === null ? pack.label : undefined}
        aria-busy={busy || undefined}
        className={`mt-4 ${REVEAL_GRID}`}
      >
        {cards.map((card) => {
          const series = pack.franchises.find((f) => f.id === card.character.franchiseIds[0])?.title ?? null;
          return (
            <li
              key={`${pack.id}:${card.slot}`}
              data-slot={card.slot}
              style={{ "--slot": String(card.slot) }}
              className={
                entering
                  ? "animate-card-enter [animation-delay:calc(var(--slot)*var(--card-enter-step))] motion-reduce:animate-none"
                  : undefined
              }
            >
              <Card
                character={card.character}
                rarity={card.rarity}
                series={series}
                poolSize={poolSize}
                effects={effects}
              />
              <div className="mt-1.5 flex min-h-5 items-center">
                {showNew && card.isNew === true && <span className={NEW_MARKER}>{revealCopy.newMarker}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** `1 Epic, 1 Rare and 3 Common · 2 new`, each tier word in its tier's text colour (§6.2), after the lead if any. */
function Summary({
  lead,
  rarities,
  newCount,
}: {
  lead: string;
  rarities: readonly Rarity[];
  newCount: number;
}) {
  const parts = summaryParts(rarities);
  return (
    <p className="mt-1 text-sm text-zinc-300">
      {lead}
      {parts.map(({ rarity, count }, i) => (
        <span key={rarity}>
          {listSeparator(i, parts.length)}
          <span className="text-zinc-200 tabular-nums">{formatCount(count)}</span>{" "}
          <span className={TIER_TEXT[rarity]}>{RARITY_LABEL[rarity]}</span>
        </span>
      ))}
      {newCount >= 1 && revealCopy.newCount(newCount)}
    </p>
  );
}
