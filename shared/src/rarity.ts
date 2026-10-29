/**
 * The six rarity tiers in rank order, least to most valuable, and the
 * integer tables the server rolls them with (docs/design/collection-packs.md
 * §4.2, §5.4). The web app shows the copy the server publishes and may not
 * import the number constants (ESLint `no-restricted-imports`).
 */
export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  mythic: "Mythic",
};

/** Every odds table and chance is an integer out of this, so the server's roll is exact. */
export const ODDS_SCALE = 1_000_000;

/** One table: a count out of `ODDS_SCALE` per tier, summing to the scale. */
export type OddsTable = Readonly<Record<Rarity, number>>;

/** The lowest tier each slot of a pack can hold: slots 1–3 Common, slot 4 Uncommon, slot 5 Rare (§5.4.1). */
export const SLOT_FLOOR = [
  "common",
  "common",
  "common",
  "uncommon",
  "rare",
] as const satisfies readonly Rarity[];

/**
 * The tier each slot of a standard pack rolls (§5.4.1). Rare and above are
 * 20 % of the cards, exactly the one card slot 5 always holds, so slot 5
 * carries all of them, slot 4 is always Uncommon, and slots 1–3 split the
 * Commons as evenly as integers allow (the leftover unit to slot 1). The
 * five tables together give the owner's shares exactly: Common 56 %,
 * Uncommon 24 %, Rare 16 %, Epic 3.4 %, Legendary 0.55 %, Mythic 0.05 %.
 */
export const SLOT_ODDS = [
  { common: 933_334, uncommon: 66_666, rare: 0, epic: 0, legendary: 0, mythic: 0 },
  { common: 933_333, uncommon: 66_667, rare: 0, epic: 0, legendary: 0, mythic: 0 },
  { common: 933_333, uncommon: 66_667, rare: 0, epic: 0, legendary: 0, mythic: 0 },
  { common: 0, uncommon: 1_000_000, rare: 0, epic: 0, legendary: 0, mythic: 0 },
  { common: 0, uncommon: 0, rare: 800_000, epic: 170_000, legendary: 27_500, mythic: 2_500 },
] as const satisfies readonly OddsTable[];

/** Every 10th free pack (the 10th, 20th, ... since registration or the last reset) is Enchanted (§5.4.3). */
export const ENCHANTED_INTERVAL = 10;

/** Slot 5 of an Enchanted pack: the standard slot 5 above Epic, scaled up to the whole scale (170 : 27.5 : 2.5). */
export const ENCHANTED_SLOT_ODDS = {
  common: 0,
  uncommon: 0,
  rare: 0,
  epic: 850_000,
  legendary: 137_500,
  mythic: 12_500,
} as const satisfies OddsTable;

/** The chance, out of `ODDS_SCALE`, that a pack of any source is Radiant: 1 in 2 500. */
export const RADIANT_ODDS = 400;

/** Slots 1 to 4 of a Radiant pack; its slot 5 is Mythic without a roll. */
export const RADIANT_SLOT_ODDS = {
  common: 0,
  uncommon: 0,
  rare: 0,
  epic: 850_000,
  legendary: 137_500,
  mythic: 12_500,
} as const satisfies OddsTable;

/** The 300th free pack in a row without a Mythic card has one in slot 5. */
export const PITY_PACKS = 300;

/** Tier bands are integers out of this. */
export const SHARE_SCALE = 10_000;

/**
 * The share of a snapshot's characters in each tier, by favourites rank:
 * Mythic the top 2 %, Legendary 2–8 %, Epic 8–20 %, Rare 20–40 %,
 * Uncommon 40–65 %, Common the rest (§5.1.4).
 */
export const TIER_BAND = {
  common: 3_500,
  uncommon: 2_500,
  rare: 2_000,
  epic: 1_200,
  legendary: 600,
  mythic: 200,
} as const satisfies OddsTable;
