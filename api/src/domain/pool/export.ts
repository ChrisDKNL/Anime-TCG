import { and, asc, eq } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import {
  characters,
  poolSnapshotCharacters,
  poolSnapshotMemberships,
  poolSnapshotRelations,
  poolSnapshotSeries,
  poolSnapshots,
  series,
} from "../../db/schema.js";
import { SnapshotRefused } from "./build.js";
import { SNAPSHOT_FORMAT, type SnapshotFile } from "./file.js";
import { ANILIST_CHARACTERS_PER_PAGE, ANILIST_SERIES_PER_PAGE } from "./limits.js";
import type {
  CharacterEdge,
  CharactersPage,
  RelationEdge,
  RelationsPage,
  SeriesItem,
  SeriesPage,
} from "./pages.js";

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) result.push(items.slice(start, start + size));
  return result;
}

type StoredEdge = { fromId: number; toId: number; relationType: string };

function relationEdges(edges: readonly StoredEdge[] | undefined): { edges: RelationEdge[] } {
  return {
    edges: (edges ?? []).map((edge) => ({
      relationType: edge.relationType,
      node: { id: edge.toId, type: "ANIME" },
    })),
  };
}

function characterPages(main: CharacterEdge[], supporting: CharacterEdge[]): CharactersPage[] {
  const count = Math.max(
    1,
    Math.ceil(Math.max(main.length, supporting.length) / ANILIST_CHARACTERS_PER_PAGE),
  );
  return Array.from({ length: count }, (_, page) => {
    const from = page * ANILIST_CHARACTERS_PER_PAGE;
    const to = from + ANILIST_CHARACTERS_PER_PAGE;
    return {
      data: {
        Media: {
          main: { pageInfo: { hasNextPage: main.length > to }, edges: main.slice(from, to) },
          supporting: {
            pageInfo: { hasNextPage: supporting.length > to },
            edges: supporting.slice(from, to),
          },
        },
      },
    };
  });
}

/**
 * The current snapshot written back into AniList's page shapes: entries in
 * popularity order with their merge edges, the hop entries' edges as
 * relations pages, and each entry's characters by role. Fed to `--stdin`
 * it builds the same pool (tiers, franchises, memberships and primaries).
 */
export async function exportSnapshot(db: Queryable): Promise<SnapshotFile> {
  const [snapshot] = await db
    .select({ id: poolSnapshots.id, takenAt: poolSnapshots.takenAt })
    .from(poolSnapshots)
    .where(eq(poolSnapshots.isCurrent, true));
  if (snapshot === undefined) throw new SnapshotRefused("There is no current snapshot to export.");
  const snapshotId = snapshot.id;

  const entries = await db
    .select({
      id: series.id,
      title: series.title,
      titleNative: series.titleNative,
      startYear: series.startYear,
      popularity: poolSnapshotSeries.popularity,
      genres: poolSnapshotSeries.genres,
    })
    .from(poolSnapshotSeries)
    .innerJoin(series, eq(series.id, poolSnapshotSeries.seriesId))
    .where(eq(poolSnapshotSeries.snapshotId, snapshotId))
    .orderBy(asc(poolSnapshotSeries.popularityRank));
  const edges = await db
    .select({
      fromId: poolSnapshotRelations.fromId,
      toId: poolSnapshotRelations.toId,
      relationType: poolSnapshotRelations.relationType,
    })
    .from(poolSnapshotRelations)
    .where(eq(poolSnapshotRelations.snapshotId, snapshotId))
    .orderBy(asc(poolSnapshotRelations.fromId), asc(poolSnapshotRelations.toId));
  const members = await db
    .select({
      seriesId: poolSnapshotMemberships.seriesId,
      role: poolSnapshotMemberships.role,
      id: characters.id,
      name: characters.name,
      nameNative: characters.nameNative,
      imageUrl: characters.imageUrl,
      favourites: poolSnapshotCharacters.favourites,
    })
    .from(poolSnapshotMemberships)
    .innerJoin(characters, eq(characters.id, poolSnapshotMemberships.characterId))
    .innerJoin(
      poolSnapshotCharacters,
      and(
        eq(poolSnapshotCharacters.snapshotId, poolSnapshotMemberships.snapshotId),
        eq(poolSnapshotCharacters.characterId, poolSnapshotMemberships.characterId),
      ),
    )
    .where(eq(poolSnapshotMemberships.snapshotId, snapshotId))
    .orderBy(asc(poolSnapshotMemberships.seriesId), asc(poolSnapshotMemberships.characterId));

  const edgesFrom = new Map<number, StoredEdge[]>();
  for (const edge of edges) edgesFrom.set(edge.fromId, [...(edgesFrom.get(edge.fromId) ?? []), edge]);
  const entryIds = new Set(entries.map((entry) => entry.id));

  const seriesPages: SeriesPage[] = chunks(entries, ANILIST_SERIES_PER_PAGE).map((page) => ({
    data: {
      Page: {
        media: page.map((entry): SeriesItem => ({
          id: entry.id,
          title: { english: entry.title, romaji: entry.title, native: entry.titleNative },
          startDate: { year: entry.startYear },
          popularity: entry.popularity,
          genres: entry.genres,
          relations: relationEdges(edgesFrom.get(entry.id)),
        })),
      },
    },
  }));
  const hopIds = [...edgesFrom.keys()].filter((id) => !entryIds.has(id)).sort((a, b) => a - b);
  const relationPages: RelationsPage[] = chunks(hopIds, ANILIST_SERIES_PER_PAGE).map((ids) => ({
    data: { Page: { media: ids.map((id) => ({ id, relations: relationEdges(edgesFrom.get(id)) })) } },
  }));

  const byEntry = new Map<number, { main: CharacterEdge[]; supporting: CharacterEdge[] }>();
  for (const member of members) {
    const lists = byEntry.get(member.seriesId) ?? { main: [], supporting: [] };
    lists[member.role].push({
      role: member.role === "main" ? "MAIN" : "SUPPORTING",
      node: {
        id: member.id,
        name: { full: member.name, native: member.nameNative },
        image: { large: member.imageUrl },
        favourites: member.favourites,
      },
    });
    byEntry.set(member.seriesId, lists);
  }
  const characterFile: Record<string, CharactersPage[]> = {};
  for (const entry of entries) {
    const lists = byEntry.get(entry.id) ?? { main: [], supporting: [] };
    characterFile[String(entry.id)] = characterPages(lists.main, lists.supporting);
  }

  return {
    format: SNAPSHOT_FORMAT,
    takenAt: snapshot.takenAt.toISOString(),
    series: seriesPages,
    relations: relationPages,
    characters: characterFile,
  };
}
