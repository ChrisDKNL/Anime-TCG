import type { PerRarity } from "@anime-tcg/shared/api";
import { RARITIES, type Rarity } from "@anime-tcg/shared/rarity";
import { eq, sql, TransactionRollbackError } from "drizzle-orm";
import type { Db, Queryable } from "../../db/client.js";
import {
  characters,
  poolFetches,
  poolSnapshotCharacters,
  poolSnapshotFranchises,
  poolSnapshotMemberships,
  poolSnapshotRelations,
  poolSnapshotSeries,
  poolSnapshots,
  series,
} from "../../db/schema.js";
import type { SnapshotPlan } from "./build.js";

export interface ActivationOptions {
  source: "anilist" | "file";
  /** When AniList was read: the start of the fetch, or the file's `takenAt`. */
  takenAt: Date;
  now: Date;
  /** Build inside a transaction that is rolled back: nothing is written, the staging rows stay. */
  dryRun: boolean;
  /** The fetch whose staging rows the activation deletes. */
  fetchId?: number;
}

export interface FranchiseSummary {
  id: number;
  title: string;
  popularityRank: number;
  entries: number;
  characters: number;
  /** Candidates the franchise cap did not keep in this franchise. */
  capped: number;
}

/** What the command prints and logs about an activation (collection-packs.md §5.8, §7.1). */
export interface ActivationSummary {
  version: number;
  dryRun: boolean;
  entries: number;
  franchises: FranchiseSummary[];
  characters: number;
  tierCounts: PerRarity;
  skipped: number;
  skippedByReason: Record<string, number>;
  /** Accepted characters the franchise cap left out of the pool, and the franchises that cut any. */
  capped: number;
  cappedFranchises: number;
  changedTier: number;
  dropped: number;
  added: number;
  franchisesMerged: number;
  franchisesSplit: number;
}

const CHUNK = 1_000;

async function insertInChunks<T>(rows: readonly T[], write: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK) await write(rows.slice(start, start + CHUNK));
}

interface Previous {
  tiers: Map<number, Rarity>;
  franchiseOfSeries: Map<number, number>;
}

async function previousSnapshot(tx: Queryable, id: number | null): Promise<Previous> {
  if (id === null) return { tiers: new Map(), franchiseOfSeries: new Map() };
  const tiers = await tx
    .select({ id: poolSnapshotCharacters.characterId, tier: poolSnapshotCharacters.tier })
    .from(poolSnapshotCharacters)
    .where(eq(poolSnapshotCharacters.snapshotId, id));
  const entries = await tx
    .select({ seriesId: poolSnapshotSeries.seriesId, franchiseId: poolSnapshotSeries.franchiseId })
    .from(poolSnapshotSeries)
    .where(eq(poolSnapshotSeries.snapshotId, id));
  return {
    tiers: new Map(tiers.map((row) => [row.id, row.tier])),
    franchiseOfSeries: new Map(entries.map((row) => [row.seriesId, row.franchiseId])),
  };
}

/** Groups whose shared entries came from several groups of the other grouping. */
function regrouped(from: ReadonlyMap<number, number>, to: ReadonlyMap<number, number>): number {
  const sources = new Map<number, Set<number>>();
  for (const [seriesId, group] of to) {
    const before = from.get(seriesId);
    if (before === undefined) continue;
    const set = sources.get(group) ?? new Set<number>();
    set.add(before);
    sources.set(group, set);
  }
  return [...sources.values()].filter((set) => set.size > 1).length;
}

function summarise(
  plan: SnapshotPlan,
  version: number,
  previous: Previous,
  dryRun: boolean,
): ActivationSummary {
  const current = new Map(plan.characters.map((character) => [character.id, character.tier]));
  const franchiseOfSeries = new Map(plan.entries.map((entry) => [entry.id, entry.franchiseId]));
  const titleOf = new Map(plan.entries.map((entry) => [entry.id, entry.title]));
  const membersOf = new Map<number, Set<number>>();
  for (const character of plan.characters) {
    for (const { seriesId } of character.memberships) {
      const franchiseId = franchiseOfSeries.get(seriesId) ?? seriesId;
      const members = membersOf.get(franchiseId) ?? new Set<number>();
      members.add(character.id);
      membersOf.set(franchiseId, members);
    }
  }
  let changedTier = 0;
  for (const [id, tier] of current)
    if (previous.tiers.has(id) && previous.tiers.get(id) !== tier) changedTier += 1;
  return {
    version,
    dryRun,
    entries: plan.entries.length,
    franchises: plan.franchises.map((franchise) => ({
      id: franchise.id,
      title: titleOf.get(franchise.id) ?? "",
      popularityRank: franchise.popularityRank,
      entries: franchise.entryIds.length,
      characters: membersOf.get(franchise.id)?.size ?? 0,
      capped: plan.cappedByFranchise.get(franchise.id) ?? 0,
    })),
    characters: plan.characters.length,
    tierCounts: plan.tierCounts,
    skipped: plan.skipped.items,
    skippedByReason: plan.skipped.byReason(),
    capped: plan.capped,
    cappedFranchises: plan.cappedByFranchise.size,
    changedTier,
    dropped: [...previous.tiers.keys()].filter((id) => !current.has(id)).length,
    added: [...current.keys()].filter((id) => !previous.tiers.has(id)).length,
    franchisesMerged: regrouped(previous.franchiseOfSeries, franchiseOfSeries),
    franchisesSplit: regrouped(franchiseOfSeries, previous.franchiseOfSeries),
  };
}

async function writeSnapshot(tx: Queryable, plan: SnapshotPlan, options: ActivationOptions): Promise<number> {
  const [row] = await tx
    .insert(poolSnapshots)
    .values({
      source: options.source,
      takenAt: options.takenAt,
      activatedAt: options.now,
      isCurrent: false,
      seriesCount: plan.entries.length,
      franchiseCount: plan.franchises.length,
      characterCount: plan.characters.length,
      tierCounts: RARITIES.map((tier) => plan.tierCounts[tier]),
    })
    .returning({ id: poolSnapshots.id });
  if (row === undefined) throw new Error("snapshot insert returned no row");
  const snapshotId = row.id;

  await insertInChunks(plan.entries, (chunk) =>
    tx
      .insert(series)
      .values(
        chunk.map((e) => ({ id: e.id, title: e.title, titleNative: e.titleNative, startYear: e.startYear })),
      )
      .onConflictDoUpdate({
        target: series.id,
        set: {
          title: sql`excluded.title`,
          titleNative: sql`excluded.title_native`,
          startYear: sql`excluded.start_year`,
        },
      }),
  );
  await insertInChunks(plan.characters, (chunk) =>
    tx
      .insert(characters)
      .values(chunk.map((c) => ({ id: c.id, name: c.name, nameNative: c.nameNative, imageUrl: c.imageUrl })))
      .onConflictDoUpdate({
        target: characters.id,
        set: {
          name: sql`excluded.name`,
          nameNative: sql`excluded.name_native`,
          imageUrl: sql`excluded.image_url`,
        },
      }),
  );
  await insertInChunks(plan.franchises, (chunk) =>
    tx
      .insert(poolSnapshotFranchises)
      .values(chunk.map((f) => ({ snapshotId, franchiseId: f.id, popularityRank: f.popularityRank }))),
  );
  await insertInChunks(plan.entries, (chunk) =>
    tx.insert(poolSnapshotSeries).values(
      chunk.map((e) => ({
        snapshotId,
        seriesId: e.id,
        franchiseId: e.franchiseId,
        popularityRank: e.popularityRank,
        popularity: e.popularity,
        genres: e.genres,
      })),
    ),
  );
  await insertInChunks(plan.edges, (chunk) =>
    tx
      .insert(poolSnapshotRelations)
      .values(
        chunk.map((e) => ({ snapshotId, fromId: e.fromId, toId: e.toId, relationType: e.relationType })),
      ),
  );
  await insertInChunks(plan.characters, (chunk) =>
    tx.insert(poolSnapshotCharacters).values(
      chunk.map((c) => ({
        snapshotId,
        characterId: c.id,
        favourites: c.favourites,
        favouritesRank: c.favouritesRank,
        tier: c.tier,
        primarySeriesId: c.primarySeriesId,
      })),
    ),
  );
  const memberships = plan.characters.flatMap((c) =>
    c.memberships.map((m) => ({ snapshotId, characterId: c.id, seriesId: m.seriesId, role: m.role })),
  );
  await insertInChunks(memberships, (chunk) => tx.insert(poolSnapshotMemberships).values(chunk));
  return snapshotId;
}

/**
 * Steps 3 to 5 of collection-packs.md §5.1.7 in one transaction on the app
 * role: write the snapshot, make it the current one, delete the fetch's
 * staging rows. Snapshot builds serialise on the table lock; openings only
 * read `pool_snapshots`, so they never wait for it, and one that read the
 * previous snapshot's id keeps dealing from that snapshot's rows.
 */
export async function activateSnapshot(
  db: Db,
  plan: SnapshotPlan,
  options: ActivationOptions,
): Promise<ActivationSummary> {
  let summary: ActivationSummary | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`lock table pool_snapshots in share row exclusive mode`);
      const [current] = await tx
        .select({ id: poolSnapshots.id })
        .from(poolSnapshots)
        .where(eq(poolSnapshots.isCurrent, true));
      const previous = await previousSnapshot(tx, current?.id ?? null);
      const snapshotId = await writeSnapshot(tx, plan, options);
      if (current !== undefined) {
        await tx.update(poolSnapshots).set({ isCurrent: false }).where(eq(poolSnapshots.id, current.id));
      }
      await tx.update(poolSnapshots).set({ isCurrent: true }).where(eq(poolSnapshots.id, snapshotId));
      summary = summarise(plan, snapshotId, previous, options.dryRun);
      if (options.dryRun) tx.rollback();
      if (options.fetchId !== undefined)
        await tx.delete(poolFetches).where(eq(poolFetches.id, options.fetchId));
    });
  } catch (err) {
    // The dry run's own rollback is the one error that means the transaction did what it was asked.
    if (!(options.dryRun && err instanceof TransactionRollbackError)) throw err;
  }
  if (summary === undefined) throw new Error("activation finished without a summary");
  return summary;
}
