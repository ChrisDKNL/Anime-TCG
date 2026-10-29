import type { PerRarity } from "@anime-tcg/shared/api";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { RARITIES, type Rarity } from "@anime-tcg/shared/rarity";
import { sql } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import type { TierPool } from "../packs/roll.js";
import { perRarity } from "../pool/tiers.js";

/**
 * The Karma shop's themes (economy.md §8.6, ADR 0013): one per eligible
 * genre of the current snapshot, drawing across every franchise; there are
 * no franchise packs. Snapshot rows never change, so a snapshot's themes are
 * computed once.
 */

/** The longest theme id a purchase may name (`ShopBuyBody.themeId`). */
export const THEME_ID_MAX_LENGTH = 64;
const GENRE_PREFIX = "genre-";

/**
 * The slug of a genre as AniList names it: lower-case ASCII letters and
 * digits, every other run of characters one hyphen, none at either end.
 * Null when nothing is left, so a genre of only symbols or another script
 * gets no theme rather than an empty id.
 */
export function genreSlug(genre: string): string | null {
  const slug = genre
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? null : slug;
}

export interface Theme {
  id: string;
  /** The genre as AniList names it; rendered as text. */
  title: string;
  /** The theme's characters per tier, each list ordered by character id, as the pick requires. */
  tiers: TierPool;
  tierSizes: PerRarity;
  /** Every franchise with a character in the set, in franchise popularity order. */
  franchiseIds: number[];
}

/** One character of the current snapshot with one genre of one of its entries. */
export interface GenreMember {
  characterId: number;
  tier: Rarity;
  genre: string;
}

/** A character's franchises in the current snapshot, with their popularity rank. */
export interface FranchiseMember {
  characterId: number;
  franchiseId: number;
  popularityRank: number;
}

/** Each of the six tiers holds at least a pack's worth, so the pack draws exactly like the free pack, Radiant included. */
export function eligible(sizes: PerRarity): boolean {
  return RARITIES.every((tier) => sizes[tier] >= PACK_SIZE);
}

/**
 * Every eligible genre theme, ordered by id. Two genres whose slugs collide
 * would name one id for two sets, so neither is offered; nor is a genre
 * whose id would not fit a purchase body.
 */
export function buildThemes(genres: readonly GenreMember[], franchises: readonly FranchiseMember[]): Theme[] {
  const byGenre = new Map<string, Map<number, Rarity>>();
  for (const { characterId, tier, genre } of genres) {
    const set = byGenre.get(genre) ?? new Map<number, Rarity>();
    set.set(characterId, tier);
    byGenre.set(genre, set);
  }
  const franchisesOf = new Map<number, FranchiseMember[]>();
  for (const member of franchises) {
    franchisesOf.set(member.characterId, [...(franchisesOf.get(member.characterId) ?? []), member]);
  }

  const genresById = new Map<string, string[]>();
  for (const genre of byGenre.keys()) {
    const slug = genreSlug(genre);
    if (slug === null) continue;
    const id = `${GENRE_PREFIX}${slug}`;
    genresById.set(id, [...(genresById.get(id) ?? []), genre]);
  }

  const themes: Theme[] = [];
  for (const [id, named] of genresById) {
    const [genre] = named;
    const set = genre === undefined ? undefined : byGenre.get(genre);
    if (named.length !== 1 || genre === undefined || set === undefined || id.length > THEME_ID_MAX_LENGTH)
      continue;
    const ids = [...set.keys()].sort((a, b) => a - b);
    const tiers = perRarity((tier) => ids.filter((characterId) => set.get(characterId) === tier));
    const tierSizes = perRarity((tier) => tiers[tier].length);
    if (!eligible(tierSizes)) continue;
    const rankOf = new Map<number, number>();
    for (const characterId of ids) {
      for (const member of franchisesOf.get(characterId) ?? [])
        rankOf.set(member.franchiseId, member.popularityRank);
    }
    const franchiseIds = [...rankOf.entries()]
      .sort(([idA, rankA], [idB, rankB]) => rankA - rankB || idA - idB)
      .map(([franchiseId]) => franchiseId);
    themes.push({ id, title: genre, tiers, tierSizes, franchiseIds });
  }
  return themes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The snapshot's themes: every character with a membership in an entry of
 * that snapshot whose genres contain the genre, at the tier the snapshot
 * deals it as.
 */
export async function snapshotThemes(db: Queryable, snapshotId: number): Promise<Theme[]> {
  const genres = await db.execute<{ characterId: number; tier: Rarity; genre: string }>(sql`
    select distinct m.character_id as "characterId", c.tier, g.genre
    from pool_snapshot_memberships m
    join pool_snapshot_series s on s.snapshot_id = m.snapshot_id and s.series_id = m.series_id
    join pool_snapshot_characters c on c.snapshot_id = m.snapshot_id and c.character_id = m.character_id
    cross join lateral unnest(s.genres) as g(genre)
    where m.snapshot_id = ${snapshotId}
  `);
  const franchises = await db.execute<{
    characterId: number;
    franchiseId: number;
    popularityRank: number;
  }>(sql`
    select distinct m.character_id as "characterId", s.franchise_id as "franchiseId",
           f.popularity_rank as "popularityRank"
    from pool_snapshot_memberships m
    join pool_snapshot_series s on s.snapshot_id = m.snapshot_id and s.series_id = m.series_id
    join pool_snapshot_franchises f on f.snapshot_id = s.snapshot_id and f.franchise_id = s.franchise_id
    where m.snapshot_id = ${snapshotId}
  `);
  return buildThemes(genres.rows, franchises.rows);
}
