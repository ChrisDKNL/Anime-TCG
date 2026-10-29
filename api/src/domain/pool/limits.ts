/**
 * The pool's numbers (collection-packs.md §4.2). The snapshot bounds keep
 * every response of the game bounded; the AniList ones are politeness
 * towards a free API (CLAUDE.md: 90 a minute, often degraded to 30).
 */

/** Anime entries in a snapshot: AniList's top by `POPULARITY_DESC`. */
export const SNAPSHOT_SERIES = 100;
/** A snapshot with fewer valid entries is refused. */
export const SNAPSHOT_SERIES_MIN = 90;
/** A snapshot with fewer valid characters is refused: the smallest pool whose Mythic tier fills a pack. */
export const SNAPSHOT_CHARACTERS_MIN = 500;
/** A snapshot with more is refused. */
export const SNAPSHOT_CHARACTERS_MAX = 6_000;
/** The largest `--stdin` file, in bytes. */
export const SNAPSHOT_FILE_MAX = 64 * 1024 * 1024;

/** The AniList relation types that merge two entries into one franchise (spec §5.1.2). */
export const FRANCHISE_RELATIONS = ["SEQUEL", "PREQUEL", "SIDE_STORY", "PARENT"] as const;
/** Entries outside the top 100 a merge path may pass through. */
export const FRANCHISE_MAX_HOPS = 2;
/** Relation requests a fetch may make for the hops; more and the fetch is refused. */
export const FRANCHISE_MAX_REQUESTS = 40;

/**
 * Every value of AniList's `MediaRelation` enum, confirmed by introspection
 * on 2026-10-29. An edge with any other type is dropped and counted.
 */
export const ANILIST_RELATION_TYPES = [
  "ADAPTATION",
  "PREQUEL",
  "SEQUEL",
  "PARENT",
  "SIDE_STORY",
  "CHARACTER",
  "SUMMARY",
  "ALTERNATIVE",
  "SPIN_OFF",
  "OTHER",
  "SOURCE",
  "COMPILATION",
  "CONTAINS",
  "SAME_UNIVERSE",
] as const;

/** AniList's page maximum; also the batch size of a relations request. */
export const ANILIST_SERIES_PER_PAGE = 50;
/** Per role connection, per request. */
export const ANILIST_CHARACTERS_PER_PAGE = 25;
/** At most one request per gap: 24 a minute, below AniList's degraded 30. */
export const ANILIST_REQUEST_GAP_MS = 2_500;
/** A fetch that would need more requests stops and is refused. */
export const ANILIST_MAX_REQUESTS = 1_000;
/** Retries of one request after its first failure, waiting 2, 4, 8, 16 and 32 s, before the fetch pauses. */
export const ANILIST_MAX_RETRIES = 5;
/** The wait after a 429 without `Retry-After`. */
export const ANILIST_DEFAULT_RETRY_AFTER_MS = 60_000;
/** The longest `Retry-After` honoured; a larger one is treated as this, so a broken header cannot stall the owner for hours. */
export const ANILIST_MAX_RETRY_AFTER_MS = 15 * 60_000;
export const ANILIST_TIMEOUT_MS = 10_000;
/** Per response; a page is tens of kilobytes. */
export const ANILIST_MAX_BODY = 2 * 1024 * 1024;
/** An unfinished fetch older than this is started over, so a snapshot never mixes rankings from days apart. */
export const FETCH_RESUME_MAX_AGE_MS = 24 * 60 * 60_000;
/** The one endpoint the snapshot command calls; no request input ever reaches it. */
export const ANILIST_ENDPOINT = "https://graphql.anilist.co";

export const NAME_MAX = 200;
export const TITLE_MAX = 300;
/** The one image host the CSP allows in `img-src` (C8); a unit test keeps this and the Caddyfile in step. */
export const IMAGE_HOST = "s4.anilist.co";
/**
 * The longest image URL accepted. Not in the spec's table: an engineering
 * bound, like NAME_MAX, so no string a card carries is unbounded. AniList's
 * CDN URLs are under 100 characters.
 */
export const IMAGE_URL_MAX = 2_048;

/** Nesting deeper than any AniList page or snapshot file has; deeper input is refused before it is parsed. */
export const JSON_MAX_DEPTH = 32;
/** Relation edges read per entry; the rest are ignored. */
export const RELATION_EDGES_MAX = 200;
export const GENRES_MAX = 20;
export const GENRE_LENGTH = { min: 1, max: 50 } as const;
export const START_YEAR = { min: 1900, max: 2100 } as const;
