import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ANILIST_CHARACTERS_PER_PAGE,
  ANILIST_SERIES_PER_PAGE,
  JSON_MAX_DEPTH,
  PG_INTEGER_MAX,
  RELATION_EDGES_MAX,
} from "./limits.js";

/**
 * The schema parse of collection-packs.md §5.1.6: what an AniList page, from
 * the network or from a snapshot file, is reduced to before anything stores
 * or reads it. The page envelope must have the declared shape or the whole
 * page is refused; each item is checked against its declared fields, which
 * are all it keeps, and an item of the wrong shape becomes `null` so the
 * build can count it as skipped. Field values are validated later
 * (`validate.ts`), from the stored pages, so a resumed fetch and a file go
 * through the same rules.
 */

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableInteger = Type.Union([Type.Integer(), Type.Null()]);
/** An integer that fits the Postgres `integer` column it is stored in. */
const StoredInteger = Type.Integer({ maximum: PG_INTEGER_MAX });
const NullableStoredInteger = Type.Union([StoredInteger, Type.Null()]);

export const RelationEdge = Type.Object({
  relationType: Type.String(),
  node: Type.Object({ id: StoredInteger, type: NullableString }),
});
export type RelationEdge = Static<typeof RelationEdge>;

const RelationEdges = Type.Object({ edges: Type.Array(Type.Union([RelationEdge, Type.Null()])) });

export const SeriesItem = Type.Object({
  id: StoredInteger,
  title: Type.Object({ english: NullableString, romaji: NullableString, native: NullableString }),
  startDate: Type.Union([Type.Object({ year: NullableInteger }), Type.Null()]),
  popularity: NullableStoredInteger,
  genres: Type.Union([Type.Array(Type.String()), Type.Null()]),
  relations: Type.Union([RelationEdges, Type.Null()]),
});
export type SeriesItem = Static<typeof SeriesItem>;

export const RelationsItem = Type.Object({
  id: StoredInteger,
  relations: Type.Union([RelationEdges, Type.Null()]),
});
export type RelationsItem = Static<typeof RelationsItem>;

export const CharacterEdge = Type.Object({
  role: NullableString,
  node: Type.Object({
    id: StoredInteger,
    name: Type.Object({ full: NullableString, native: NullableString }),
    image: Type.Union([Type.Object({ large: NullableString }), Type.Null()]),
    favourites: NullableStoredInteger,
  }),
});
export type CharacterEdge = Static<typeof CharacterEdge>;

/** `{ data: { Page: { media: [...] } } }`, the shape of both series and relations pages. */
const MediaPageEnvelope = Type.Object({
  data: Type.Object({ Page: Type.Object({ media: Type.Array(Type.Unknown()) }) }),
});

const Connection = Type.Object({
  pageInfo: Type.Object({ hasNextPage: Type.Boolean() }),
  edges: Type.Array(Type.Unknown()),
});
const CharactersEnvelope = Type.Object({
  data: Type.Object({ Media: Type.Object({ main: Connection, supporting: Connection }) }),
});

export interface SeriesPage {
  data: { Page: { media: (SeriesItem | null)[] } };
}
export interface RelationsPage {
  data: { Page: { media: (RelationsItem | null)[] } };
}
export interface CharacterConnection {
  pageInfo: { hasNextPage: boolean };
  edges: (CharacterEdge | null)[];
}
export interface CharactersPage {
  data: { Media: { main: CharacterConnection; supporting: CharacterConnection } };
}

/** The answer was not an AniList page of the expected kind; the message names where it went wrong. */
export class PageShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageShapeError";
  }
}

function envelope<T extends TSchema>(schema: T, body: unknown, kind: string): Static<T> {
  if (!Value.Check(schema, body)) {
    const first = Value.Errors(schema, body).First();
    throw new PageShapeError(`not a ${kind} page: ${first?.path || "/"} ${first?.message ?? "is invalid"}`);
  }
  return body;
}

/** The declared fields of `item`, or null when it does not have the declared shape. */
function item<T extends TSchema>(schema: T, value: unknown): Static<T> | null {
  if (typeof value !== "object" || value === null) return null;
  const cleaned: unknown = Value.Clean(schema, value);
  return Value.Check(schema, cleaned) ? cleaned : null;
}

/** Edges beyond the first `RELATION_EDGES_MAX` are never read; the rest are checked one by one. */
function relationEdges(value: unknown): { edges: (RelationEdge | null)[] } | null {
  if (typeof value !== "object" || value === null || !("edges" in value) || !Array.isArray(value.edges)) {
    return null;
  }
  const edges: unknown[] = value.edges;
  return { edges: edges.slice(0, RELATION_EDGES_MAX).map((edge) => item(RelationEdge, edge)) };
}

/** An item whose `relations` are read edge by edge, so one bad edge drops the edge, not the entry. */
function withRelations<T extends TSchema>(schema: T, value: unknown): Static<T> | null {
  if (typeof value !== "object" || value === null) return null;
  const relations = "relations" in value ? relationEdges(value.relations) : null;
  return item(schema, { ...value, relations });
}

export function parseSeriesPage(body: unknown): SeriesPage {
  const media = envelope(MediaPageEnvelope, body, "series").data.Page.media;
  if (media.length > ANILIST_SERIES_PER_PAGE) throw new PageShapeError("not a series page: too many entries");
  return { data: { Page: { media: media.map((value) => withRelations(SeriesItem, value)) } } };
}

export function parseRelationsPage(body: unknown): RelationsPage {
  const media = envelope(MediaPageEnvelope, body, "relations").data.Page.media;
  if (media.length > ANILIST_SERIES_PER_PAGE)
    throw new PageShapeError("not a relations page: too many entries");
  return { data: { Page: { media: media.map((value) => withRelations(RelationsItem, value)) } } };
}

function connection(value: { pageInfo: { hasNextPage: boolean }; edges: unknown[] }): CharacterConnection {
  return {
    pageInfo: { hasNextPage: value.pageInfo.hasNextPage },
    edges: value.edges.slice(0, ANILIST_CHARACTERS_PER_PAGE).map((edge) => item(CharacterEdge, edge)),
  };
}

export function parseCharactersPage(body: unknown): CharactersPage {
  const media = envelope(CharactersEnvelope, body, "characters").data.Media;
  return { data: { Media: { main: connection(media.main), supporting: connection(media.supporting) } } };
}

/**
 * Whether `text` nests arrays and objects deeper than `limit`, found by one
 * pass over the characters before `JSON.parse` builds anything, so a
 * hostile file costs no more memory than its own bytes.
 */
export function nestsDeeperThan(text: string, limit: number = JSON_MAX_DEPTH): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charCodeAt(i);
    if (inString) {
      if (char === 0x5c) i += 1;
      else if (char === 0x22) inString = false;
    } else if (char === 0x22) {
      inString = true;
    } else if (char === 0x5b || char === 0x7b) {
      depth += 1;
      if (depth > limit) return true;
    } else if (char === 0x5d || char === 0x7d) {
      depth -= 1;
    }
  }
  return false;
}
