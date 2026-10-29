import { ANILIST_CHARACTERS_PER_PAGE, ANILIST_SERIES_PER_PAGE } from "../../src/domain/pool/limits.js";

/**
 * Builds snapshot files (`anime-tcg-snapshot/2`) in AniList's page shapes
 * from a short description, so tests feed the real parse, validation and
 * build through `--stdin` instead of hand-writing GraphQL bodies. Values
 * are deliberately loose (`unknown`) so a test can plant hostile content.
 */

export interface FixtureEdge {
  type: string;
  to: number;
  nodeType?: string | null;
}

export interface FixtureEntry {
  id: number;
  title?: string | null;
  romaji?: string | null;
  native?: string | null;
  year?: unknown;
  popularity?: unknown;
  genres?: unknown;
  relations?: FixtureEdge[];
  /** Replaces the whole item as AniList would send it. */
  raw?: unknown;
}

export interface FixtureMembership {
  entry: number;
  role?: string;
}

export interface FixtureCharacter {
  id: number;
  name?: unknown;
  native?: unknown;
  image?: unknown;
  favourites?: unknown;
  in: FixtureMembership[];
}

export interface FixturePool {
  entries: FixtureEntry[];
  characters: FixtureCharacter[];
  /** Entries outside the top 100 and their relations, as the hop requests return them. */
  hops?: { id: number; relations: FixtureEdge[] }[];
  takenAt?: string;
}

export const imageUrl = (id: number) => `https://s4.anilist.co/file/anilistcdn/character/large/b${id}.png`;

export interface StandardOptions {
  entries?: number;
  characters?: number;
  entryBase?: number;
  characterBase?: number;
}

/**
 * `entries` anime (ids `entryBase + 1 ...`, most popular first) and
 * `characters` characters (ids `characterBase + 1 ...`), character k MAIN in
 * entry k mod entries. Favourites fall with the id, so the lowest ids are
 * the top tiers: at 600 characters, the first 6 are Mythic, the next 24
 * Legendary, 60 Epic, 150 Rare and the last 360 Common.
 */
export function standardPool(options: StandardOptions = {}): FixturePool {
  const { entries = 100, characters = 600, entryBase = 900_000, characterBase = 800_000 } = options;
  return {
    entries: Array.from({ length: entries }, (_, i) => ({ id: entryBase + i + 1, title: `Series ${i + 1}` })),
    characters: Array.from({ length: characters }, (_, i) => ({
      id: characterBase + i + 1,
      favourites: (characters - i) * 10,
      in: [{ entry: entryBase + (i % entries) + 1 }],
    })),
  };
}

function relationEdges(edges: readonly FixtureEdge[] | undefined) {
  return {
    edges: (edges ?? []).map((edge) => ({
      relationType: edge.type,
      node: { id: edge.to, type: edge.nodeType === undefined ? "ANIME" : edge.nodeType },
    })),
  };
}

function seriesItem(entry: FixtureEntry): unknown {
  if ("raw" in entry) return entry.raw;
  return {
    id: entry.id,
    title: {
      english: entry.title === undefined ? `Entry ${entry.id}` : entry.title,
      romaji: entry.romaji === undefined ? null : entry.romaji,
      native: entry.native === undefined ? null : entry.native,
    },
    startDate: { year: entry.year === undefined ? 2013 : entry.year },
    popularity: entry.popularity === undefined ? 1_000 : entry.popularity,
    genres: entry.genres === undefined ? ["Action"] : entry.genres,
    relations: relationEdges(entry.relations),
  };
}

function characterEdge(character: FixtureCharacter, role: string): unknown {
  return {
    role,
    node: {
      id: character.id,
      name: {
        full: character.name === undefined ? `Character ${character.id}` : character.name,
        native: character.native === undefined ? null : character.native,
      },
      image: { large: character.image === undefined ? imageUrl(character.id) : character.image },
      favourites: character.favourites === undefined ? 0 : character.favourites,
    },
  };
}

function pagesOf(main: unknown[], supporting: unknown[]): unknown[] {
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

export function snapshotFile(pool: FixturePool): Record<string, unknown> {
  const series: unknown[] = [];
  for (let start = 0; start < pool.entries.length; start += ANILIST_SERIES_PER_PAGE) {
    series.push({
      data: { Page: { media: pool.entries.slice(start, start + ANILIST_SERIES_PER_PAGE).map(seriesItem) } },
    });
  }
  const hops = pool.hops ?? [];
  const relations: unknown[] = [];
  for (let start = 0; start < hops.length; start += ANILIST_SERIES_PER_PAGE) {
    relations.push({
      data: {
        Page: {
          media: hops
            .slice(start, start + ANILIST_SERIES_PER_PAGE)
            .map((hop) => ({ id: hop.id, relations: relationEdges(hop.relations) })),
        },
      },
    });
  }
  const characters: Record<string, unknown[]> = {};
  for (const entry of pool.entries) {
    const main: unknown[] = [];
    const supporting: unknown[] = [];
    for (const character of pool.characters) {
      for (const membership of character.in) {
        if (membership.entry !== entry.id) continue;
        const role = membership.role ?? "MAIN";
        (role === "SUPPORTING" ? supporting : main).push(characterEdge(character, role));
      }
    }
    characters[String(entry.id)] = pagesOf(main, supporting);
  }
  return {
    format: "anime-tcg-snapshot/2",
    takenAt: pool.takenAt ?? "2026-10-29T09:00:00.000Z",
    series,
    relations,
    characters,
  };
}

export const snapshotText = (pool: FixturePool) => JSON.stringify(snapshotFile(pool));
