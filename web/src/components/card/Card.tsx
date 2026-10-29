import type { CharacterPublic, Rarity } from "@anime-tcg/shared/api";
import { useState } from "react";
import { isolate } from "../../lib/bidi";
import { cardCopy } from "../../lib/packsCopy";

/**
 * Where the frame's effects play (card-and-rarity.md §5.3): `full` in the
 * reveal and the card dialog, `hover` in the grids (the glow always, the
 * glint and the drift only while hovered), `none` on the landing page's demo
 * card (the tier frame, no glow, glint or drift).
 */
export type CardEffects = "full" | "hover" | "none";

interface Props {
  character: CharacterPublic;
  /** The card's granted rarity, never the character's current tier (§3.1). */
  rarity: Rarity;
  /** The primary series' title (`franchiseIds[0]`), or null when the answer does not name it. */
  series: string | null;
  /** The pool size the rank is shown against; null when no snapshot count is held (§6.2). */
  poolSize: number | null;
  effects: CardEffects;
}

const FRAME: Record<Rarity, string> = {
  common: "card-frame-common",
  uncommon: "card-frame-uncommon",
  rare: "card-frame-rare",
  epic: "card-frame-epic",
  legendary: "card-frame-legendary",
  mythic: "card-frame-mythic",
};

/** The owner's frame-only exception (§5.4): Epic and up glow, statically. */
const GLOW: Record<Rarity, string> = {
  common: "",
  uncommon: "",
  rare: "",
  epic: "shadow-glow-epic",
  legendary: "shadow-glow-legendary",
  mythic: "shadow-glow-mythic",
};

const MOTION: Record<CardEffects, Record<Rarity, string>> = {
  full: {
    common: "",
    uncommon: "",
    rare: "",
    epic: "card-glint",
    legendary: "card-glint",
    mythic: "card-pearl",
  },
  hover: {
    common: "",
    uncommon: "",
    rare: "",
    epic: "card-glint-hover",
    legendary: "card-glint-hover",
    mythic: "card-pearl-hover",
  },
  none: { common: "", uncommon: "", rare: "", epic: "", legendary: "", mythic: "" },
};

const STARS_TEXT: Record<Rarity, string> = {
  common: "text-rarity-common-text",
  uncommon: "text-rarity-uncommon-text",
  rare: "text-rarity-rare-text",
  epic: "text-rarity-epic-text",
  legendary: "text-rarity-legendary-text",
  mythic: "text-rarity-mythic-text",
};

/** Cards on one screen start their loop at different points, stable per character (§5.3 "Not in step"). */
function phase(characterId: number): string {
  return String((characterId % 11) * 0.5);
}

type ArtState = "loading" | "loaded" | "failed";

/**
 * The card (card-and-rarity.md §3): a frame holding the night-sky face with
 * the name, the tier stars, the art with its rank chip and the series. It is
 * not a control; where it stands alone it is an article named for the
 * character, its tier and its series (§8). Every AniList string is rendered
 * as text in its own `dir="auto"` element and isolated in the plain strings,
 * the label and the titles (T1). Nothing on it moves on hover except the frame effects §5.4
 * allows, and those stop under reduced motion.
 */
export function Card({ character, rarity, series, poolSize, effects }: Props) {
  const [art, setArt] = useState<ArtState>("loading");
  const glow = effects === "none" ? "" : GLOW[rarity];

  return (
    <article
      aria-label={cardCopy.label(character.name, rarity, series)}
      className={`relative aspect-[5/7] w-full rounded-[12px] p-[5px] ${FRAME[rarity]} ${glow} ${MOTION[effects][rarity]}`}
      style={{ "--card-phase": phase(character.id) }}
    >
      <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-[8px] card-face">
        <div className="flex min-w-0 flex-col gap-[3px] px-[10px] pt-[9px] pb-[7px]">
          <p
            dir="auto"
            className="truncate text-[13px] leading-tight font-bold text-card-ink"
            title={isolate(character.name)}
          >
            {character.name}
          </p>
          <p className={`text-[11px] leading-none tracking-[2px] whitespace-nowrap ${STARS_TEXT[rarity]}`}>
            <span aria-hidden="true" className="[font-variant-emoji:text]">
              {cardCopy.starGlyphs(rarity)}
            </span>
            <span className="sr-only">{cardCopy.stars(rarity)}</span>
          </p>
        </div>
        <div className="relative mx-[8px] min-h-0 flex-1 overflow-hidden rounded-[6px] card-art-placeholder">
          {art === "failed" ? (
            <span className="absolute inset-0 flex items-center justify-center text-[11px] text-card-ink-subtle">
              {cardCopy.noImage}
            </span>
          ) : (
            <img
              src={character.imageUrl}
              alt=""
              loading="lazy"
              onLoad={() => setArt("loaded")}
              onError={() => setArt("failed")}
              className={`h-full w-full object-cover object-top ${art === "loaded" ? "" : "invisible"}`}
            />
          )}
          {character.rank !== null && (
            <span className="absolute bottom-[7px] left-[7px] rounded-[3px] bg-card-chip px-1 py-px font-mono text-[11px] leading-tight text-card-ink-subtle tabular-nums">
              <span aria-hidden="true">{cardCopy.rank(character.rank, poolSize)}</span>
              <span className="sr-only">{cardCopy.rankSpoken(character.rank, poolSize)}</span>
            </span>
          )}
        </div>
        <p
          dir="auto"
          className="truncate px-[10px] py-[9px] text-[12px] leading-tight text-card-ink-muted"
          title={series === null ? undefined : isolate(series)}
        >
          {series}
        </p>
      </div>
    </article>
  );
}
