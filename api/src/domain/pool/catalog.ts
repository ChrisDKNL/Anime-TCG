import type { CharacterPublic, FranchiseRef, PerRarity, SnapshotInfo } from "@anime-tcg/shared/api";
import { RARITIES, type Rarity } from "@anime-tcg/shared/rarity";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import {
  characters,
  poolSnapshotCharacters,
  poolSnapshotFranchises,
  poolSnapshotMemberships,
  poolSnapshotSeries,
  poolSnapshots,
  series,
} from "../../db/schema.js";
import type { TierPool } from "../packs/roll.js";
import { perRarity } from "./tiers.js";

/**
 * Reads of the pool the game serves from (collection-packs.md §5.1.7,
 * §5.1.8). Snapshot rows are written once, at activation, and never changed,
 * so anything read for a snapshot id stays true for that id.
 */

export interface CurrentSnapshot {
  id: number;
  info: SnapshotInfo;
  tierSizes: PerRarity;
}

export async function currentSnapshot(db: Queryable): Promise<CurrentSnapshot | null> {
  const [row] = await db
    .select({ id: poolSnapshots.id, takenAt: poolSnapshots.takenAt, tierCounts: poolSnapshots.tierCounts })
    .from(poolSnapshots)
    .where(eq(poolSnapshots.isCurrent, true))
    .limit(1);
  if (row === undefined) return null;
  const sizes = new Map(RARITIES.map((tier, index) => [tier, row.tierCounts[index] ?? 0]));
  return {
    id: row.id,
    info: { version: row.id, takenAt: row.takenAt.toISOString() },
    tierSizes: perRarity((tier) => sizes.get(tier) ?? 0),
  };
}

/** The snapshot's characters per tier, each list ordered by character id, as the pick requires. */
export async function tierPool(db: Queryable, snapshotId: number): Promise<TierPool> {
  const rows = await db
    .select({ id: poolSnapshotCharacters.characterId, tier: poolSnapshotCharacters.tier })
    .from(poolSnapshotCharacters)
    .where(eq(poolSnapshotCharacters.snapshotId, snapshotId))
    .orderBy(asc(poolSnapshotCharacters.characterId));
  const byTier = new Map<Rarity, number[]>(RARITIES.map((tier) => [tier, []]));
  for (const row of rows) byTier.get(row.tier)?.push(row.id);
  return perRarity((tier) => byTier.get(tier) ?? []);
}

export interface DescribedCharacters {
  characters: Map<number, CharacterPublic>;
  /** Every franchise the described characters name. */
  franchiseIds: Set<number>;
}

interface Placement {
  snapshotId: number;
  tier: Rarity;
  primarySeriesId: number;
}

/**
 * Each character as the game shows it now: the newest display strings, and
 * its franchises (primary first) and tier from the current snapshot, or,
 * for a character the current snapshot dropped, the franchises of the newest
 * snapshot that held it, with no tier.
 */
export async function describeCharacters(
  db: Queryable,
  characterIds: readonly number[],
  current: number | null,
): Promise<DescribedCharacters> {
  const ids = [...new Set(characterIds)];
  if (ids.length === 0) return { characters: new Map(), franchiseIds: new Set() };

  const display = await db
    .select({
      id: characters.id,
      name: characters.name,
      nameNative: characters.nameNative,
      imageUrl: characters.imageUrl,
    })
    .from(characters)
    .where(inArray(characters.id, ids));

  const placements = await db
    .selectDistinctOn([poolSnapshotCharacters.characterId], {
      characterId: poolSnapshotCharacters.characterId,
      snapshotId: poolSnapshotCharacters.snapshotId,
      tier: poolSnapshotCharacters.tier,
      primarySeriesId: poolSnapshotCharacters.primarySeriesId,
    })
    .from(poolSnapshotCharacters)
    .where(inArray(poolSnapshotCharacters.characterId, ids))
    .orderBy(
      poolSnapshotCharacters.characterId,
      desc(sql`${poolSnapshotCharacters.snapshotId} = ${current ?? 0}`),
      desc(poolSnapshotCharacters.snapshotId),
    );
  const placementOf = new Map<number, Placement>(placements.map((row) => [row.characterId, row]));

  const franchisesOf = await franchisesByCharacter(db, placementOf);
  const described = new Map<number, CharacterPublic>();
  const franchiseIds = new Set<number>();
  for (const row of display) {
    const placement = placementOf.get(row.id);
    const franchises = franchisesOf.get(row.id) ?? [];
    if (placement === undefined || franchises.length === 0) {
      throw new Error(`character ${row.id} has no snapshot placement`);
    }
    const inCurrentSnapshot = placement.snapshotId === current;
    for (const id of franchises) franchiseIds.add(id);
    described.set(row.id, {
      id: row.id,
      name: row.name,
      nameNative: row.nameNative,
      imageUrl: row.imageUrl,
      franchiseIds: franchises,
      tier: inCurrentSnapshot ? placement.tier : null,
      inCurrentSnapshot,
    });
  }
  return { characters: described, franchiseIds };
}

/** Per character, the franchises of its placement snapshot: the primary entry's first, then by franchise popularity. */
async function franchisesByCharacter(
  db: Queryable,
  placementOf: ReadonlyMap<number, Placement>,
): Promise<Map<number, number[]>> {
  const snapshotIds = [...new Set([...placementOf.values()].map((p) => p.snapshotId))];
  const characterIds = [...placementOf.keys()];
  const rows = await db
    .select({
      characterId: poolSnapshotMemberships.characterId,
      snapshotId: poolSnapshotMemberships.snapshotId,
      seriesId: poolSnapshotMemberships.seriesId,
      franchiseId: poolSnapshotSeries.franchiseId,
      franchiseRank: poolSnapshotFranchises.popularityRank,
    })
    .from(poolSnapshotMemberships)
    .innerJoin(
      poolSnapshotSeries,
      and(
        eq(poolSnapshotSeries.snapshotId, poolSnapshotMemberships.snapshotId),
        eq(poolSnapshotSeries.seriesId, poolSnapshotMemberships.seriesId),
      ),
    )
    .innerJoin(
      poolSnapshotFranchises,
      and(
        eq(poolSnapshotFranchises.snapshotId, poolSnapshotSeries.snapshotId),
        eq(poolSnapshotFranchises.franchiseId, poolSnapshotSeries.franchiseId),
      ),
    )
    .where(
      and(
        inArray(poolSnapshotMemberships.snapshotId, snapshotIds),
        inArray(poolSnapshotMemberships.characterId, characterIds),
      ),
    )
    .orderBy(asc(poolSnapshotFranchises.popularityRank), asc(poolSnapshotSeries.franchiseId));

  const grouped = new Map<number, { primary: number | null; byRank: number[] }>();
  for (const row of rows) {
    const placement = placementOf.get(row.characterId);
    if (placement === undefined || placement.snapshotId !== row.snapshotId) continue;
    const entry = grouped.get(row.characterId) ?? { primary: null, byRank: [] };
    if (row.seriesId === placement.primarySeriesId) entry.primary = row.franchiseId;
    if (!entry.byRank.includes(row.franchiseId)) entry.byRank.push(row.franchiseId);
    grouped.set(row.characterId, entry);
  }
  const result = new Map<number, number[]>();
  for (const [characterId, { primary, byRank }] of grouped) {
    result.set(characterId, primary === null ? byRank : [primary, ...byRank.filter((id) => id !== primary)]);
  }
  return result;
}

/** Title, native title and start year of each franchise, from its anchor entry's newest display data. */
export async function franchiseRefs(db: Queryable, franchiseIds: Iterable<number>): Promise<FranchiseRef[]> {
  const ids = [...new Set(franchiseIds)];
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: series.id,
      title: series.title,
      titleNative: series.titleNative,
      startYear: series.startYear,
    })
    .from(series)
    .where(inArray(series.id, ids))
    .orderBy(asc(series.id));
  return rows;
}
