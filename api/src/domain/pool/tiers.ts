import type { PerRarity } from "@anime-tcg/shared/api";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { RARITIES, type Rarity, SHARE_SCALE, TIER_BAND } from "@anime-tcg/shared/rarity";

/** One value per tier, filled tier by tier in rank order (a `PerRarity` when the values are counts). */
export function perRarity<T>(value: (tier: Rarity) => T): Record<Rarity, T> {
  return {
    common: value("common"),
    uncommon: value("uncommon"),
    rare: value("rare"),
    epic: value("epic"),
    legendary: value("legendary"),
    mythic: value("mythic"),
  };
}

/** Most valuable first: the order in which tiers take the top favourites ranks. */
const TOP_DOWN: readonly Rarity[] = [...RARITIES].reverse();

/**
 * How many of `n` characters each tier holds (collection-packs.md §5.1.4).
 * The boundaries are cumulative, `round(n × cumulative band / SHARE_SCALE)`
 * half up, so the six counts always sum to `n` exactly.
 */
export function tierCounts(n: number): PerRarity {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`${n} is not a character count`);
  const counts = new Map<Rarity, number>();
  let cumulativeShare = 0;
  let previousBoundary = 0;
  for (const tier of TOP_DOWN) {
    cumulativeShare += TIER_BAND[tier];
    const boundary = Math.floor((n * cumulativeShare + SHARE_SCALE / 2) / SHARE_SCALE);
    counts.set(tier, boundary - previousBoundary);
    previousBoundary = boundary;
  }
  return perRarity((tier) => counts.get(tier) ?? 0);
}

/**
 * The first tier holding fewer than a full pack's worth, or null. Every tier
 * needs `PACK_SIZE` characters so five slots of one tier still draw five
 * different ones; a snapshot with a short tier is refused.
 */
export function shortTier(counts: PerRarity): Rarity | null {
  return RARITIES.find((tier) => counts[tier] < PACK_SIZE) ?? null;
}

export interface Ranked {
  /** 1 = most favourited in the snapshot. */
  favouritesRank: number;
  tier: Rarity;
}

/**
 * Ranks characters by favourites, most first, ties broken by AniList id
 * ascending so the split never depends on the order AniList answered in,
 * and gives each its tier: the top `tierCounts(n).mythic` ranks are Mythic,
 * and so on down to Common.
 */
export function assignTiers<T extends { id: number; favourites: number }>(
  characters: readonly T[],
): (T & Ranked)[] {
  const ordered = [...characters].sort((a, b) => b.favourites - a.favourites || a.id - b.id);
  const counts = tierCounts(ordered.length);
  const tierOfRank: Rarity[] = TOP_DOWN.flatMap((tier) => Array<Rarity>(counts[tier]).fill(tier));
  return ordered.map((character, index) => {
    const tier = tierOfRank[index];
    if (tier === undefined) throw new Error("tier counts do not cover every character");
    return { ...character, favouritesRank: index + 1, tier };
  });
}
