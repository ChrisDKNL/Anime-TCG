import { BASE_WEIGHTS, type LegacyRarity as Rarity, POPULARITY_INFLUENCE } from "@anime-tcg/shared/rarity";
import type { Character } from "../types";

/**
 * Maps a character's favourites count to a 0..1 popularity score relative to
 * the pool. Uses log scale because favourites follow a heavy-tailed
 * distribution (the top character has ~10x the favourites of the 100th),
 * and linear scaling would make everyone but the top 5 look like "0".
 */
export function popularityScore(character: Character, pool: Character[]): number {
  if (pool.length === 0) return 0;
  const logs = pool.map((c) => Math.log1p(Math.max(0, c.favourites)));
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  if (max === min) return 0.5;
  return (Math.log1p(Math.max(0, character.favourites)) - min) / (max - min);
}

/**
 * Returns the weighted rarity distribution for a given popularity score.
 *
 *   legendary = 5%  + 10% * p * influence
 *   rare      = 25% + 10% * p * influence
 *   common    = whatever is left
 *
 * With the defaults (influence 0.6) the top character gets ~11% legendary and
 * ~31% rare; the least popular stays at the base 5% / 25%.
 */
export function rarityWeights(popularity: number): Record<Rarity, number> {
  const p = Math.min(1, Math.max(0, popularity)) * POPULARITY_INFLUENCE;
  const legendary = BASE_WEIGHTS.legendary + 0.1 * p;
  const rare = BASE_WEIGHTS.rare + 0.1 * p;
  const common = 1 - legendary - rare;
  return { common, rare, legendary };
}

/**
 * Rolls a rarity from a weight table. `roll` is injectable so tests (or a
 * seeded RNG) can make the outcome deterministic.
 */
export function rollRarity(weights: Record<Rarity, number>, roll: number = Math.random()): Rarity {
  let cursor = 0;
  // Check rarest tier first so floating-point drift never "steals" a legendary.
  for (const tier of ["legendary", "rare", "common"] as const) {
    cursor += weights[tier];
    if (roll < cursor) return tier;
  }
  return "common";
}

/** Convenience: roll a rarity for a character relative to its pool. */
export function assignRarity(character: Character, pool: Character[]): Rarity {
  return rollRarity(rarityWeights(popularityScore(character, pool)));
}
