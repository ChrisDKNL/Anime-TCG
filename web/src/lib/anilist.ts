import type { Character } from "../types";

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

/**
 * Fetches a page of characters sorted by favourites (AniList's popularity
 * proxy). `media(perPage: 1, sort: POPULARITY_DESC)` picks the single most
 * popular anime for each character so we have a clean "origin" label.
 *
 * AniList docs: https://docs.anilist.co/  (schema verified 2026-10-28)
 */
const CHARACTER_POOL_QUERY = /* GraphQL */ `
  query CharacterPool($page: Int!, $perPage: Int!) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        hasNextPage
      }
      characters(sort: FAVOURITES_DESC) {
        id
        favourites
        name {
          full
        }
        image {
          large
        }
        media(perPage: 1, sort: POPULARITY_DESC, type: ANIME) {
          nodes {
            title {
              english
              native
              romaji
            }
          }
        }
      }
    }
  }
`;

/** Raw shape of the GraphQL response — kept private; callers get `Character`. */
interface CharacterPoolResponse {
  data?: {
    Page: {
      pageInfo: { hasNextPage: boolean };
      characters: Array<{
        id: number;
        favourites: number | null;
        name: { full: string | null };
        image: { large: string | null };
        media: {
          nodes: Array<{
            title: { english: string | null; native: string | null; romaji: string | null };
          }>;
        };
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

const CACHE_KEY = "anime-tcg:character-pool:v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — AniList rate-limits to 90 req/min

interface CachedPool {
  fetchedAt: number;
  characters: Character[];
}

function readCache(): Character[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPool;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.characters;
  } catch {
    return null;
  }
}

function writeCache(characters: Character[]): void {
  try {
    const payload: CachedPool = { fetchedAt: Date.now(), characters };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be full or blocked (private mode); the app works without it.
  }
}

async function fetchPage(page: number, perPage: number, signal?: AbortSignal) {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: CHARACTER_POOL_QUERY, variables: { page, perPage } }),
    signal,
  });

  if (res.status === 429) {
    throw new Error("AniList rate limit hit (HTTP 429). Wait a minute and retry.");
  }
  if (!res.ok) {
    throw new Error(`AniList request failed: HTTP ${res.status}`);
  }

  const json = (await res.json()) as CharacterPoolResponse;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) {
    throw new Error("AniList returned no data.");
  }
  return json.data.Page;
}

/**
 * Loads a pool of popular characters. Fetches `pages` pages of `perPage`
 * (AniList caps perPage at 50) and normalises them into `Character` objects.
 * Results are cached in localStorage for 24h to be polite to the API.
 */
export async function fetchCharacterPool(
  opts: { pages?: number; perPage?: number; signal?: AbortSignal; force?: boolean } = {},
): Promise<Character[]> {
  const { pages = 2, perPage = 50, signal, force = false } = opts;

  if (!force) {
    const cached = readCache();
    if (cached && cached.length > 0) return cached;
  }

  const characters: Character[] = [];
  for (let page = 1; page <= pages; page++) {
    const result = await fetchPage(page, perPage, signal);
    for (const c of result.characters) {
      const primary = c.media.nodes[0];
      // Skip characters with no usable image or name — rare but happens.
      if (!c.image.large || !c.name.full) continue;
      characters.push({
        id: c.id,
        name: c.name.full,
        imageUrl: c.image.large,
        animeTitle: primary?.title.english ?? primary?.title.romaji ?? "Unknown anime",
        animeTitleNative: primary?.title.native ?? null,
        favourites: c.favourites ?? 0,
      });
    }
    if (!result.pageInfo.hasNextPage) break;
  }

  writeCache(characters);
  return characters;
}
