/** Rarity tiers, ordered from least to most valuable. */
export const RARITIES = ["common", "rare", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

/** A character as returned (and lightly normalised) from AniList. */
export interface Character {
  id: number;
  name: string;
  imageUrl: string;
  /** Primary anime the character appears in, English title preferred. */
  animeTitle: string;
  /** Native (usually Japanese) title, shown as a subtitle when it differs. */
  animeTitleNative: string | null;
  /** AniList "favourites" count — our popularity score. */
  favourites: number;
}

/**
 * A single owned card. The same character can be pulled many times, so each
 * pull gets its own `uid`; `characterId` links back to the Character pool.
 */
export interface Card {
  uid: string;
  characterId: number;
  name: string;
  imageUrl: string;
  animeTitle: string;
  animeTitleNative: string | null;
  rarity: Rarity;
  /** Unix ms timestamp of the pull — handy for "recently opened" sorting. */
  pulledAt: number;
}
