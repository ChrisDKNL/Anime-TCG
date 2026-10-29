/**
 * The five rarity tiers in rank order, least to most valuable
 * (docs/design/collection-packs.md §5.4, ADR 0011 §6).
 */
export const RARITIES = ["common", "rare", "epic", "legendary", "mythic"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  mythic: "Mythic",
};

/** Per-slot odds are integers out of this, so the server's roll is exact. */
export const ODDS_SCALE = 1_000_000;

/**
 * The tier each pack slot rolls, out of `ODDS_SCALE`. Each upper tier is the
 * owner's per-pack chance P of at least one (Rare 80 %, Epic 17.6 %,
 * Legendary 2 %, Mythic 0.33 %) turned into a per-slot chance
 * `1 - (1 - P)^(1/5)` and rounded; Common is the remainder.
 */
export const SLOT_ODDS: Readonly<Record<Rarity, number>> = {
  common: 682_110,
  rare: 275_220,
  epic: 37_977,
  legendary: 4_032,
  mythic: 661,
};

/** Tier shares are integers out of this. */
export const SHARE_SCALE = 10_000;

/** The share of a snapshot's characters in each tier, by favourites rank (1 %, 4 %, 10 %, 25 %, 60 %). */
export const TIER_SHARE: Readonly<Record<Rarity, number>> = {
  mythic: 100,
  legendary: 400,
  epic: 1_000,
  rare: 2_500,
  common: 6_000,
};

/**
 * The proof of concept's three tiers and float weights, which the browser
 * roll still uses until the 1c web PR replaces it with the server's packs
 * and deletes everything below (collection-packs.md §3, §8). The server
 * reads none of it.
 */
export const LEGACY_RARITIES = ["common", "rare", "legendary"] as const;
export type LegacyRarity = (typeof LEGACY_RARITIES)[number];

/** Base drop rates of the browser roll: Common 70 %, Rare 25 %, Legendary 5 %. */
export const BASE_WEIGHTS: Record<LegacyRarity, number> = {
  common: 0.7,
  rare: 0.25,
  legendary: 0.05,
};

/**
 * How much popularity bends the browser roll's base odds. At 0 every
 * character has identical 70/25/5 odds; at 1 the most popular character's
 * legendary chance roughly triples.
 */
export const POPULARITY_INFLUENCE = 0.6;
