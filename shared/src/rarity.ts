/** Rarity tiers, ordered from least to most valuable. */
export const RARITIES = ["common", "rare", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  legendary: "Legendary",
};

/**
 * Base drop rates, independent of the character. These are the headline
 * odds shown to the player: Common 70%, Rare 25%, Legendary 5%.
 */
export const BASE_WEIGHTS: Record<Rarity, number> = {
  common: 0.7,
  rare: 0.25,
  legendary: 0.05,
};

/**
 * How much popularity is allowed to bend the base odds. At `POPULARITY_INFLUENCE = 0`
 * every character has identical 70/25/5 odds (pure random roll). At 1, the
 * single most popular character in the pool has its legendary chance roughly
 * tripled. Tweak this one constant to tune the "feel" of the packs.
 */
export const POPULARITY_INFLUENCE = 0.6;
