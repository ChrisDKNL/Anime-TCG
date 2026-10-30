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

/** card-and-rarity.md §3.2: `small` for the reveal and the grid tiles, `dialog` for the card dialog. */
export type CardSize = "small" | "dialog";

interface Props {
  character: CharacterPublic;
  /** The card's granted rarity, never the character's current tier (§3.1). */
  rarity: Rarity;
  /** The primary series' title (`franchiseIds[0]`), or null when the answer does not name it. */
  series: string | null;
  /** The pool size the rank is shown against; null when no snapshot count is held (§6.2). */
  poolSize: number | null;
  effects: CardEffects;
  size?: CardSize;
  /**
   * Where the card stands alone it is an article with its own name (§8);
   * inside a control (a grid tile) it is part of the control, which the
   * control's own name describes.
   */
  standalone?: boolean;
}

/** §3.2's frame, face and text sizes; the dialog's face padding is the small one × 4/3, rounded. */
const SIZE: Record<
  CardSize,
  {
    frame: string;
    face: string;
    head: string;
    name: string;
    stars: string;
    art: string;
    noImage: string;
    rank: string;
    series: string;
  }
> = {
  small: {
    frame: "rounded-[12px] p-[5px]",
    face: "rounded-[8px]",
    head: "gap-[3px] px-[10px] pt-[9px] pb-[7px]",
    name: "text-[13px]",
    stars: "text-[11px] tracking-[2px]",
    art: "mx-[8px] rounded-[6px]",
    noImage: "text-[11px]",
    rank: "bottom-[7px] left-[7px] rounded-[3px] px-1 text-[11px]",
    series: "px-[10px] py-[9px] text-[12px]",
  },
  dialog: {
    frame: "rounded-[14px] p-[6px]",
    face: "rounded-[9px]",
    head: "gap-[4px] px-[13px] pt-[12px] pb-[9px]",
    name: "text-[17px]",
    stars: "text-[14px] tracking-[3px]",
    art: "mx-[11px] rounded-[8px]",
    noImage: "text-[15px]",
    rank: "bottom-[9px] left-[9px] rounded-[4px] px-[5px] text-[13px]",
    series: "px-[13px] py-[12px] text-[15px]",
  },
};

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
 * character, its tier and its series (§8). It is built of phrasing elements
 * only, so a tile's `<button>` can hold it. Every AniList string is rendered
 * as text in its own `dir="auto"` element and isolated in the plain strings,
 * the label and the titles (T1). Nothing on it moves on hover except the
 * frame effects §5.4 allows, and those stop under reduced motion.
 */
export function Card({
  character,
  rarity,
  series,
  poolSize,
  effects,
  size = "small",
  standalone = true,
}: Props) {
  const glow = effects === "none" ? "" : GLOW[rarity];
  const sized = SIZE[size];
  const Root = standalone ? "article" : "span";

  return (
    <Root
      aria-label={standalone ? cardCopy.label(character.name, rarity, series) : undefined}
      className={`relative block aspect-[5/7] w-full ${sized.frame} ${FRAME[rarity]} ${glow} ${MOTION[effects][rarity]}`}
      style={{ "--card-phase": phase(character.id) }}
    >
      <span className={`flex h-full min-w-0 flex-col overflow-hidden ${sized.face} card-face`}>
        <span className={`flex min-w-0 flex-col ${sized.head}`}>
          <span
            dir="auto"
            className={`block truncate leading-tight font-bold text-card-ink ${sized.name}`}
            title={isolate(character.name)}
          >
            {character.name}
          </span>
          <span className={`block leading-none whitespace-nowrap ${sized.stars} ${STARS_TEXT[rarity]}`}>
            <span aria-hidden="true" className="[font-variant-emoji:text]">
              {cardCopy.starGlyphs(rarity)}
            </span>
            <span className="sr-only">{cardCopy.stars(rarity)}</span>
          </span>
        </span>
        <span className={`relative block min-h-0 flex-1 overflow-hidden card-art-placeholder ${sized.art}`}>
          {/* A new address is a new image: the art starts over, while the same address never retries (collection-overview.md §5.6 rule 7). */}
          <CardArt key={character.imageUrl} url={character.imageUrl} noImage={sized.noImage} />
          {character.rank !== null && (
            <span
              className={`absolute bg-card-chip py-px font-mono leading-tight text-card-ink-subtle tabular-nums ${sized.rank}`}
            >
              <span aria-hidden="true">{cardCopy.rank(character.rank, poolSize)}</span>
              <span className="sr-only">{cardCopy.rankSpoken(character.rank, poolSize)}</span>
            </span>
          )}
        </span>
        <span
          dir="auto"
          className={`block truncate leading-tight text-card-ink-muted ${sized.series}`}
          title={series === null ? undefined : isolate(series)}
        >
          {series}
        </span>
      </span>
    </Root>
  );
}

/**
 * The art (card-and-rarity.md §3.3): hidden on the placeholder until it
 * loads, and `No image` when the browser cannot load it. Its state belongs
 * to one address, so the card keys it by `url`.
 */
function CardArt({ url, noImage }: { url: string; noImage: string }) {
  const [art, setArt] = useState<ArtState>("loading");
  if (art === "failed") {
    return (
      <span className={`absolute inset-0 flex items-center justify-center text-card-ink-subtle ${noImage}`}>
        {cardCopy.noImage}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onLoad={() => setArt("loaded")}
      onError={() => setArt("failed")}
      className={`h-full w-full object-cover object-top ${art === "loaded" ? "" : "invisible"}`}
    />
  );
}
