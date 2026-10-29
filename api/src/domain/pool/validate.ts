import {
  ANILIST_RELATION_TYPES,
  GENRE_LENGTH,
  GENRES_MAX,
  IMAGE_HOST,
  IMAGE_URL_MAX,
  NAME_MAX,
  START_YEAR,
  TITLE_MAX,
} from "./limits.js";
import type {
  CharacterEdge,
  CharactersPage,
  RelationEdge,
  RelationsPage,
  SeriesItem,
  SeriesPage,
} from "./pages.js";

/**
 * Field-level validation of AniList's answer (collection-packs.md §5.1.6),
 * from the parsed pages to the entries, edges and characters a snapshot can
 * be built from. Nothing here throws on bad data: an item that breaks a rule
 * is skipped and counted by reason, with the first offending path kept for
 * the log. Accepted strings are kept as sent apart from the trim.
 */

export type Role = "main" | "supporting";

export interface Entry {
  id: number;
  title: string;
  titleNative: string | null;
  startYear: number | null;
  popularity: number;
  /** The position in AniList's POPULARITY_DESC order; a file or fetch holds at most SNAPSHOT_SERIES of them. */
  popularityRank: number;
  genres: string[];
}

export interface Edge {
  fromId: number;
  toId: number;
  relationType: (typeof ANILIST_RELATION_TYPES)[number];
}

export interface Candidate {
  id: number;
  name: string;
  nameNative: string | null;
  imageUrl: string;
  favourites: number;
  /** Entry id → role, in the order the entries were read (most popular first). */
  memberships: Map<number, Role>;
}

export interface SnapshotInput {
  series: readonly SeriesPage[];
  relations: readonly RelationsPage[];
  /** Per entry id, its character pages in page order. */
  characters: ReadonlyMap<number, readonly CharactersPage[]>;
}

export interface Validated {
  entries: Entry[];
  /** Valid anime-to-anime edges of any relation type, from the entries' own relations and from the hop pages. */
  edges: Edge[];
  characters: Candidate[];
  skipped: SkipTally;
  /** Later appearances of an accepted character whose name, image or favourites differ from its first. */
  differingAppearances: number;
}

export type SkipKind = "entry" | "character" | "edge";

/** Counts skipped items by kind and reason, keeping the first path each reason was seen at. */
export class SkipTally {
  readonly reasons = new Map<string, { kind: SkipKind; count: number; firstPath: string }>();

  skip(kind: SkipKind, reason: string, path: string): void {
    const key = `${kind}:${reason}`;
    const seen = this.reasons.get(key);
    if (seen === undefined) this.reasons.set(key, { kind, count: 1, firstPath: path });
    else seen.count += 1;
  }

  /** Entries and characters skipped; dropped edges are reported apart. */
  get items(): number {
    let total = 0;
    for (const { kind, count } of this.reasons.values()) if (kind !== "edge") total += count;
    return total;
  }

  byReason(): Record<string, number> {
    return Object.fromEntries([...this.reasons].map(([key, { count }]) => [key, count]));
  }
}

const RELATION_TYPES: ReadonlySet<string> = new Set(ANILIST_RELATION_TYPES);

function isRelationType(value: string): value is Edge["relationType"] {
  return RELATION_TYPES.has(value);
}

/** Whitespace, a control character (C0, DEL, C1) or a backslash anywhere: what a URL served as is may not hold. */
const SPACE_CONTROL_OR_BACKSLASH = /[\s\p{Cc}\\]/u;

/**
 * Whitespace, control characters (General Category Cc: C0, DEL, C1) and
 * Unicode format characters (Cf: zero-width spaces, direction marks, BOMs,
 * soft hyphens).
 */
const INVISIBLE = /[\s\p{Cc}\p{Cf}]/gu;

/** At least one character is left once every whitespace and format character is removed (round 4, decision 7). */
function hasVisibleCharacter(text: string): boolean {
  return text.replace(INVISIBLE, "") !== "";
}

function hasNul(...values: (string | null | undefined)[]): boolean {
  return values.some((value) => value?.includes("\u0000") === true);
}

const characterLength = (text: string) => [...text].length;

/** Trimmed, and null when nothing is left; `undefined` when longer than `max`, which the caller rejects. */
function optionalText(value: string | null, max: number): string | null | undefined {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  return characterLength(trimmed) > max ? undefined : trimmed;
}

/**
 * A name that is acceptable: trimmed, 1 to `max` characters, and with a
 * visible character. Null when there is no name at all; `undefined` when it
 * breaks a rule, which the caller rejects. The test only decides
 * acceptance: the string kept is the trimmed one, format characters and all.
 */
function visibleText(value: string | null, max: number): string | null | undefined {
  const trimmed = optionalText(value, max);
  if (trimmed === null || trimmed === undefined) return trimmed;
  return hasVisibleCharacter(trimmed) ? trimmed : undefined;
}

/**
 * An image URL accepted only when it is already canonical (spec §5.1.6):
 * the WHATWG parser would serialise it to exactly the same string, so the
 * URL served, the URL the CSP judges and the URL the browser loads are one
 * string, and nothing is repaired or rewritten on the way. Besides that: of
 * bounded length (it is served with every card), https on exactly the image
 * host, and no port, userinfo, whitespace, control character or backslash.
 */
export function acceptableImageUrl(raw: string | null): boolean {
  if (raw === null || raw.length > IMAGE_URL_MAX || SPACE_CONTROL_OR_BACKSLASH.test(raw)) return false;
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  return (
    url.href === raw &&
    url.protocol === "https:" &&
    url.hostname === IMAGE_HOST &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}

function entryRejection(item: SeriesItem): { reason: string; path: string } | Omit<Entry, "popularityRank"> {
  if (item.id < 1) return { reason: "id", path: "id" };
  const { english, romaji, native } = item.title;
  if (hasNul(english, romaji, native, ...(item.genres ?? []))) return { reason: "nul", path: "title" };
  // English, else romaji: a romaji title only stands in when there is no English one, not when the English one is too long or invisible.
  const title = visibleText(english?.trim() ? english : romaji, TITLE_MAX);
  if (title === null || title === undefined) return { reason: "title", path: "title" };
  const titleNative = visibleText(native, TITLE_MAX);
  if (titleNative === undefined) return { reason: "title", path: "title.native" };
  const year = item.startDate?.year ?? null;
  if (year !== null && (year < START_YEAR.min || year > START_YEAR.max)) {
    return { reason: "year", path: "startDate.year" };
  }
  if (item.popularity === null || item.popularity < 0) return { reason: "popularity", path: "popularity" };
  const genres = item.genres;
  if (
    genres === null ||
    genres.length > GENRES_MAX ||
    genres.some(
      (genre) => characterLength(genre) < GENRE_LENGTH.min || characterLength(genre) > GENRE_LENGTH.max,
    )
  ) {
    return { reason: "genres", path: "genres" };
  }
  return { id: item.id, title, titleNative, startYear: year, popularity: item.popularity, genres };
}

function characterRejection(
  edge: CharacterEdge,
): { reason: string; path: string } | Omit<Candidate, "memberships"> {
  const { node } = edge;
  if (node.id < 1) return { reason: "id", path: "node.id" };
  if (hasNul(node.name.full, node.name.native, node.image?.large, edge.role)) {
    return { reason: "nul", path: "node.name" };
  }
  const name = visibleText(node.name.full, NAME_MAX);
  if (name === null || name === undefined) return { reason: "name", path: "node.name.full" };
  // A native name that is only invisible characters is a skip, not a missing native name.
  const nameNative = visibleText(node.name.native, NAME_MAX);
  if (nameNative === undefined) return { reason: "name", path: "node.name.native" };
  const imageUrl = node.image?.large ?? null;
  if (imageUrl === null || !acceptableImageUrl(imageUrl))
    return { reason: "image", path: "node.image.large" };
  const favourites = node.favourites ?? 0;
  if (favourites < 0) return { reason: "favourites", path: "node.favourites" };
  return { id: node.id, name, nameNative, imageUrl, favourites };
}

function roleOf(edge: CharacterEdge): Role | null {
  if (edge.role === "MAIN") return "main";
  if (edge.role === "SUPPORTING") return "supporting";
  return null;
}

function readEdges(
  fromId: number,
  edges: readonly (RelationEdge | null)[] | undefined,
  path: string,
  skipped: SkipTally,
): Edge[] {
  const kept: Edge[] = [];
  for (const [index, edge] of (edges ?? []).entries()) {
    if (edge === null) {
      skipped.skip("edge", "malformed", `${path}.relations.edges[${index}]`);
    } else if (!isRelationType(edge.relationType)) {
      skipped.skip("edge", "relation_type", `${path}.relations.edges[${index}].relationType`);
    } else if (edge.node.id >= 1 && edge.node.type === "ANIME" && edge.node.id !== fromId) {
      kept.push({ fromId, toId: edge.node.id, relationType: edge.relationType });
    }
  }
  return kept;
}

function readEntries(input: SnapshotInput, skipped: SkipTally): { entries: Entry[]; edges: Edge[] } {
  const entries: Entry[] = [];
  const edges: Edge[] = [];
  const seen = new Set<number>();
  let position = 0;
  for (const [pageIndex, page] of input.series.entries()) {
    for (const [index, item] of page.data.Page.media.entries()) {
      position += 1;
      const path = `series[${pageIndex}].media[${index}]`;
      if (item === null) {
        skipped.skip("entry", "malformed", path);
        continue;
      }
      if (seen.has(item.id)) {
        skipped.skip("entry", "duplicate_id", `${path}.id`);
        continue;
      }
      seen.add(item.id);
      const result = entryRejection(item);
      if ("reason" in result) {
        skipped.skip("entry", result.reason, `${path}.${result.path}`);
        continue;
      }
      entries.push({ ...result, popularityRank: position });
      edges.push(...readEdges(item.id, item.relations?.edges, path, skipped));
    }
  }
  return { entries, edges };
}

function readHopEdges(input: SnapshotInput, skipped: SkipTally): Edge[] {
  const edges: Edge[] = [];
  for (const [pageIndex, page] of input.relations.entries()) {
    for (const [index, item] of page.data.Page.media.entries()) {
      const path = `relations[${pageIndex}].media[${index}]`;
      if (item === null || item.id < 1) skipped.skip("edge", "malformed", path);
      else edges.push(...readEdges(item.id, item.relations?.edges, path, skipped));
    }
  }
  return edges;
}

function sameDisplay(a: Omit<Candidate, "memberships">, b: Omit<Candidate, "memberships">): boolean {
  return (
    a.name === b.name &&
    a.nameNative === b.nameNative &&
    a.imageUrl === b.imageUrl &&
    a.favourites === b.favourites
  );
}

export function validate(input: SnapshotInput): Validated {
  const skipped = new SkipTally();
  const { entries: listed, edges } = readEntries(input, skipped);
  const characters = new Map<number, Candidate>();
  let differingAppearances = 0;

  const withCharacters = new Set<number>();
  for (const entry of listed) {
    for (const [pageIndex, page] of (input.characters.get(entry.id) ?? []).entries()) {
      const { main, supporting } = page.data.Media;
      for (const [alias, edgesOfRole] of [
        ["main", main.edges],
        ["supporting", supporting.edges],
      ] as const) {
        for (const [index, edge] of edgesOfRole.entries()) {
          const path = `characters[${entry.id}][${pageIndex}].${alias}.edges[${index}]`;
          if (edge === null) {
            skipped.skip("character", "malformed", path);
            continue;
          }
          const role = roleOf(edge);
          if (role === null) {
            skipped.skip("character", "role", `${path}.role`);
            continue;
          }
          const result = characterRejection(edge);
          if ("reason" in result) {
            skipped.skip("character", result.reason, `${path}.${result.path}`);
            continue;
          }
          const known = characters.get(result.id);
          if (known === undefined) {
            characters.set(result.id, { ...result, memberships: new Map([[entry.id, role]]) });
          } else {
            if (!sameDisplay(known, result)) differingAppearances += 1;
            if (!known.memberships.has(entry.id)) known.memberships.set(entry.id, role);
          }
          withCharacters.add(entry.id);
        }
      }
    }
  }

  const entries: Entry[] = [];
  for (const entry of listed) {
    if (withCharacters.has(entry.id)) entries.push(entry);
    else skipped.skip("entry", "no_characters", `characters[${entry.id}]`);
  }
  return {
    entries,
    // An entry skipped for want of characters keeps its edges: it can still connect two others, like any entry outside the top 100.
    edges: [...edges, ...readHopEdges(input, skipped)],
    characters: [...characters.values()],
    skipped,
    differingAppearances,
  };
}

/** The valid entries and their edges from the series pages alone: what the fetch plans its next requests from. */
export function entriesOf(series: readonly SeriesPage[]): { entries: Entry[]; edges: Edge[] } {
  return readEntries({ series, relations: [], characters: new Map() }, new SkipTally());
}

/** The valid edges of the hop pages. */
export function hopEdgesOf(relations: readonly RelationsPage[]): Edge[] {
  return readHopEdges({ series: [], relations, characters: new Map() }, new SkipTally());
}
