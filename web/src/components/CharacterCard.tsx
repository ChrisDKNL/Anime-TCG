import type { LegacyRarity as Rarity } from "@anime-tcg/shared/rarity";
import type { Card } from "../types";
import { RarityBadge } from "./RarityBadge";

/**
 * Border + glow per rarity. Tailwind needs the full class strings present at
 * build time, so we keep them in a lookup rather than templating them.
 */
const FRAME_CLASS: Record<Rarity, string> = {
  common: "border-rarity-common/60 shadow-[0_0_10px_1px_rgb(148_163_184_/_0.25)]",
  rare: "border-rarity-rare shadow-[0_0_14px_2px_rgb(56_189_248_/_0.45),0_0_36px_6px_rgb(56_189_248_/_0.18)]",
  legendary: "border-rarity-legendary glow-legendary",
};

const NAME_CLASS: Record<Rarity, string> = {
  common: "text-zinc-100",
  rare: "text-sky-100",
  legendary: "text-amber-100",
};

interface Props {
  card: Card;
  /** Stagger index for the reveal animation (0..n). */
  index?: number;
  /** Show a "NEW" tag — first time this character entered the collection. */
  isNew?: boolean;
  /** How many copies of this character the player owns (shown as ×N). */
  copies?: number;
}

export function CharacterCard({ card, index = 0, isNew = false, copies }: Props) {
  return (
    <article
      className={`card-reveal group relative flex flex-col overflow-hidden rounded-2xl border-2 bg-zinc-900 transition-transform duration-300 hover:-translate-y-1 ${FRAME_CLASS[card.rarity]}`}
      style={{ animationDelay: `${index * 120}ms` }}
      aria-label={`${card.name}, ${card.rarity} card from ${card.animeTitle}`}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-800">
        <img
          src={card.imageUrl}
          alt={card.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-zinc-900 to-transparent" />
        <div className="absolute top-2 left-2 flex gap-1">
          <RarityBadge rarity={card.rarity} />
          {isNew && (
            <span className="rounded-full bg-zinc-950/85 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-300 uppercase shadow-md ring-1 shadow-black/40 ring-emerald-400/70 backdrop-blur-sm">
              New
            </span>
          )}
        </div>
        {copies !== undefined && copies > 1 && (
          <span className="absolute top-2 right-2 rounded-md bg-zinc-950/85 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300 shadow-md shadow-black/40 backdrop-blur-sm">
            ×{copies}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <h3
          className={`truncate text-sm leading-tight font-bold ${NAME_CLASS[card.rarity]}`}
          title={card.name}
        >
          {card.name}
        </h3>
        <p className="truncate text-xs text-zinc-400" title={card.animeTitle}>
          {card.animeTitle}
        </p>
        {card.animeTitleNative && card.animeTitleNative !== card.animeTitle && (
          <p className="truncate text-[11px] text-zinc-500" lang="ja" title={card.animeTitleNative}>
            {card.animeTitleNative}
          </p>
        )}
      </div>
    </article>
  );
}
