/**
 * Every string of the packs page, the reveal, the odds dialog and the card,
 * verbatim from docs/design/packs-page.md §8 and
 * card-and-rarity.md §6–§8. Every number in them is the server's: the
 * functions take the answer's figures and only format them. The copy test
 * renders every string and scans it for the words navigation-and-landing.md §8
 * forbids; `free` is allowed only as `free pack` or `free packs` (§9, question 1).
 */

import type { PackKind, PublishedOdds, Rarity } from "@anime-tcg/shared/api";
import { RARITIES, RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { isolate } from "./bidi";
import { common, formatCount, shortDate } from "./copy";

export { formatCount };

const ORDINAL = new Intl.PluralRules("en-GB", { type: "ordinal" });
const ORDINAL_SUFFIX: Record<Intl.LDMLPluralRule, string> = {
  zero: "th",
  one: "st",
  two: "nd",
  few: "rd",
  many: "th",
  other: "th",
};
/** market-and-shop.md §3.3: three significant digits, never rounded up, so 99.9704 % reads `99.9%`. */
const PERCENT = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumSignificantDigits: 3,
  roundingMode: "trunc",
});

const SLOT_WORDS = ["first", "second", "third", "fourth", "fifth"] as const;
const SIZE_WORDS = ["one", "two", "three", "four", "five"] as const;

/** `1st`, `2nd`, `3rd`, `10th`, `300th`. */
export function ordinal(n: number): string {
  return `${formatCount(n)}${ORDINAL_SUFFIX[ORDINAL.select(n)]}`;
}

/** `first` … `fifth` for a card's position in a pack, counted from 1. */
export function slotWord(position: number): string {
  return SLOT_WORDS[position - 1] ?? ordinal(position);
}

/** `one` … `five` for a number of cards. */
export function sizeWord(n: number): string {
  return SIZE_WORDS[n - 1] ?? formatCount(n);
}

/** The separator before item `index` of `length` items: `a, b and c`. */
export function listSeparator(index: number, length: number): string {
  if (index === 0) return "";
  return index === length - 1 ? " and " : ", ";
}

function joinList(items: readonly string[]): string {
  return items.map((item, i) => `${listSeparator(i, items.length)}${item}`).join("");
}

/** `1 copy`, `2 copies`: a formatted count and the word that agrees with it. */
export const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** `free ` follows `odds.pity.freePacksOnly` (card-and-rarity.md §7.1, §7.4). */
const free = (odds: PublishedOdds) => (odds.pity.freePacksOnly ? "free " : "");

/** `<M:SS>`, or `<H:MM:SS>` from one hour. */
export function clock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The countdown as a screen reader should say it, never as a time of day. */
function spokenDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${plural(hours, "hour", "hours")} ${plural(minutes, "minute", "minutes")}`;
  if (minutes > 0) return `${plural(minutes, "minute", "minutes")} ${plural(seconds, "second", "seconds")}`;
  return plural(seconds, "second", "seconds");
}

export const packControlCopy = {
  count: (available: number, cap: number) =>
    `${formatCount(available)} of ${formatCount(cap)} ${cap === 1 ? "pack" : "packs"} ready`,
  loading: "Loading your packs…",
  loadFailed: "Couldn't load your packs.",
  tryAgain: "Try again",
  open: "Open pack",
  opening: "Opening…",
  waitButton: common.tryAgainIn,
  next: (seconds: number) => `Next pack in ${clock(seconds)}`,
  nextSpoken: (seconds: number) => `Next pack in ${spokenDuration(seconds)}`,
  checkFailed: "Couldn't check for the next pack.",
  checkAgain: "Check again",
  noneLeft: "There was no pack left to open.",
  unavailable: "Cards are unavailable right now. Your packs are kept until they're back.",
  noAnswer: "Couldn't reach the game server. Trying again opens this same pack, never a second one.",
  failed: "Couldn't open the pack. Try again.",
  wait: "Packs take a short pause after many requests in a row. The button comes back by itself.",
  waitOver: common.waitOver,
  ready: (available: number, cap: number) => `${packControlCopy.count(available, cap)}.`,
  pity: (packs: number, freePacksOnly: boolean) =>
    `Mythic guaranteed within ${formatCount(packs)} ${freePacksOnly ? "free " : ""}${packs === 1 ? "pack" : "packs"}.`,
  odds: "Pack odds",
  /** `/packs` while the current opening's cards are held (§3.1 step 3). */
  latest: "See your latest pack",
  /** `/packs/open`'s way back to the countdown (§3.7). */
  back: "Back to packs",
} as const;

export interface TierCount {
  rarity: Rarity;
  count: number;
}

/** The pull summary's parts: the cards per tier, rarest first, tiers with no card left out. */
export function summaryParts(rarities: readonly Rarity[]): TierCount[] {
  return [...RARITIES]
    .reverse()
    .map((rarity) => ({ rarity, count: rarities.filter((r) => r === rarity).length }))
    .filter((part) => part.count > 0);
}

/** `<summary>`: `1 Epic, 1 Rare and 3 Common`, shared with the landing page's demo. */
export function summary(rarities: readonly Rarity[]): string {
  return joinList(
    summaryParts(rarities).map(({ rarity, count }) => `${formatCount(count)} ${RARITY_LABEL[rarity]}`),
  );
}

const HEADING: Record<PackKind, string> = {
  standard: "Your pack",
  enchanted: "Enchanted pack",
  radiant: "Radiant pack",
};

/** The lowest tier a table can roll: the first with non-zero odds. */
function lowestTier(table: PublishedOdds["radiant"]["odds"]): Rarity {
  return RARITIES.find((rarity) => table[rarity] > 0) ?? "mythic";
}

export const revealCopy = {
  heading: (kind: PackKind) => HEADING[kind],
  newCount: (k: number) => ` · ${formatCount(k)} new`,
  newMarker: "New",
  enchanted: (odds: PublishedOdds) =>
    `Every ${ordinal(odds.enchanted.every)} ${free(odds)}pack is Enchanted: its ${slotWord(odds.enchanted.slot + 1)} card is ${RARITY_LABEL[odds.enchanted.floor]} or better.`,
  /** Also a shop pack's, from its theme's own tables (market-and-shop.md §3.3 step 2). */
  radiant: (odds: Pick<PublishedOdds, "scale" | "radiant" | "slots">) =>
    `About 1 pack in ${formatCount(Math.round(odds.scale / odds.radiant.chance))} is Radiant: ${sizeWord(odds.slots.length)} cards of ${RARITY_LABEL[lowestTier(odds.radiant.odds)]} or better, at least one of them ${RARITY_LABEL[odds.radiant.lastSlot]}.`,
  pityMythic: (odds: PublishedOdds) => `This Mythic came from the guarantee: ${pityRule(odds)}`,
  announce: (kind: PackKind, rarities: readonly Rarity[], k: number) =>
    `${HEADING[kind]}: ${summary(rarities)}.${k >= 1 ? ` ${formatCount(k)} new.` : ""}`,
} as const;

/** The guarantee rule itself: the clause after the colon of the reveal's guarantee line. */
function pityRule(odds: PublishedOdds): string {
  return `a ${ordinal(odds.pity.packs)} ${free(odds)}pack in a row without a Mythic always has one.`;
}

/** The odds page's percentages: `part` out of `scale`. */
export function percent(part: number, scale: number): string {
  return PERCENT.format(part / scale);
}

/** `Cards 1 to 3: Common or better. Card 4: Uncommon or better. Card 5: Rare or better.` from the slot floors. */
function slotRules(odds: Pick<PublishedOdds, "slots">): string {
  const runs: Array<{ from: number; to: number; floor: Rarity }> = [];
  odds.slots.forEach((slot, i) => {
    const last = runs.at(-1);
    if (last !== undefined && last.floor === slot.floor) last.to = i + 1;
    else runs.push({ from: i + 1, to: i + 1, floor: slot.floor });
  });
  return runs
    .map(({ from, to, floor }) =>
      from === to
        ? `Card ${from}: ${RARITY_LABEL[floor]} or better.`
        : `Cards ${from} to ${to}: ${RARITY_LABEL[floor]} or better.`,
    )
    .join(" ");
}

/** `Mythic is the top 2%, Legendary the next 6%, …, Common the rest.` from `tierBands` over `bandScale`. */
function bandRules(odds: PublishedOdds): string {
  const [lowest, ...upper] = RARITIES;
  const fromTop = [...upper].reverse();
  const parts = fromTop.map((rarity, i) => {
    const share = percent(odds.tierBands[rarity], odds.bandScale);
    return i === 0
      ? `${RARITY_LABEL[rarity]} is the top ${share}`
      : `${RARITY_LABEL[rarity]} the next ${share}`;
  });
  return `${[...parts, `${RARITY_LABEL[lowest]} the rest`].join(", ")}.`;
}

/** card-and-rarity.md §7.3. Every figure comes from `PublishedOdds`. */
export const oddsCopy = {
  heading: packControlCopy.odds,
  close: common.close,
  columns: {
    tier: "Tier",
    characters: "Characters",
    share: "Share of cards",
    perPack: "At least one per pack",
  },
  tableNote: "Shares and chances are for a standard pack; the special packs below add to the rarer tiers.",
  slots: slotRules,
  enchanted: revealCopy.enchanted,
  radiant: revealCopy.radiant,
  /** The guarantee as a rule: the reveal's line without the lead-in about a Mythic just dealt. */
  pity: (odds: PublishedOdds) => {
    const rule = pityRule(odds);
    return `${rule.charAt(0).toUpperCase()}${rule.slice(1)}`;
  },
  shop: "Shop packs can be Radiant. They don't count toward Enchanted packs or the guarantee.",
  tiers: (odds: PublishedOdds) =>
    `A character's tier comes from its popularity rank on AniList among the ${formatCount(odds.snapshot.characterCount)} characters of the current pool: ${bandRules(odds)}`,
  pool: (odds: PublishedOdds) => `Pool as of ${shortDate(odds.snapshot.takenAt)}.`,
} as const;

/** U+2726 BLACK FOUR POINTED STAR, a text glyph (not an emoji), once per tier step (card-and-rarity.md §6.1). */
const STAR = "\u2726";

/** The card's own text (card-and-rarity.md §3.3, §6, §8). */
export const cardCopy = {
  noImage: "No image",
  /** The visible stars; always beside `stars`, their spoken form. */
  starGlyphs: (rarity: Rarity) => STAR.repeat(RARITIES.indexOf(rarity) + 1),
  stars: (rarity: Rarity) => {
    const n = RARITIES.indexOf(rarity) + 1;
    return `${RARITY_LABEL[rarity]}, ${n} ${n === 1 ? "star" : "stars"}`;
  },
  /** `#0012 / 2983`: zero-padded to the pool size's digits, no separators (an identifier, not an amount). */
  rank: (rank: number, pool: number | null) => {
    const width = pool === null ? 4 : String(pool).length;
    const padded = `#${String(rank).padStart(width, "0")}`;
    return pool === null ? padded : `${padded} / ${pool}`;
  },
  rankSpoken: (rank: number, pool: number | null) =>
    pool === null
      ? `Popularity rank ${formatCount(rank)}`
      : `Popularity rank ${formatCount(rank)} of ${formatCount(pool)}`,
  /** The article's name; the AniList strings in it are isolated (collection-overview.md §5.6 rule 3). */
  label: (name: string, rarity: Rarity, series: string | null) =>
    series === null
      ? `${isolate(name)}, ${RARITY_LABEL[rarity]}`
      : `${isolate(name)}, ${RARITY_LABEL[rarity]}, ${isolate(series)}`,
} as const;
