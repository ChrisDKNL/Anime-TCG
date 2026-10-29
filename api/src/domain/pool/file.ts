import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { SnapshotRefused } from "./build.js";
import { JSON_MAX_DEPTH, SNAPSHOT_FILE_MAX, SNAPSHOT_SERIES, ANILIST_SERIES_PER_PAGE } from "./limits.js";
import {
  type CharactersPage,
  nestsDeeperThan,
  PageShapeError,
  parseCharactersPage,
  parseRelationsPage,
  parseSeriesPage,
  type RelationsPage,
  type SeriesPage,
} from "./pages.js";
import type { SnapshotInput } from "./validate.js";

/**
 * The snapshot file of collection-packs.md §7.1: AniList's page bodies in
 * their GraphQL shape, so a file goes through exactly the parse, validation
 * and refusal rules a fetch does. `--stdin` reads one, `--export` writes one.
 */
export const SNAPSHOT_FORMAT = "anime-tcg-snapshot/2";

const SERIES_PAGES_MAX = Math.ceil(SNAPSHOT_SERIES / ANILIST_SERIES_PER_PAGE);
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const SnapshotFileSchema = Type.Object(
  {
    format: Type.Literal(SNAPSHOT_FORMAT),
    takenAt: Type.String({ maxLength: 40 }),
    series: Type.Array(Type.Unknown(), { minItems: 1, maxItems: SERIES_PAGES_MAX }),
    relations: Type.Array(Type.Unknown()),
    characters: Type.Record(Type.String({ pattern: "^[1-9][0-9]{0,9}$" }), Type.Array(Type.Unknown()), {
      additionalProperties: false,
    }),
  },
  { additionalProperties: false },
);

export interface SnapshotFile {
  format: typeof SNAPSHOT_FORMAT;
  takenAt: string;
  series: SeriesPage[];
  relations: RelationsPage[];
  characters: Record<string, CharactersPage[]>;
}

function notASnapshot(reason: string): SnapshotRefused {
  return new SnapshotRefused(`The file is not a snapshot: ${reason}.`);
}

function pages<T>(values: readonly unknown[], parse: (body: unknown) => T, where: string): T[] {
  return values.map((body, index) => {
    try {
      return parse(body);
    } catch (err) {
      if (err instanceof PageShapeError) throw notASnapshot(`${where}[${index}] is ${err.message}`);
      throw err;
    }
  });
}

/** Parses and checks a snapshot file's text; every refusal is a `SnapshotRefused` naming what is wrong. */
export function readSnapshotFile(text: string): { takenAt: Date; input: SnapshotInput } {
  if (Buffer.byteLength(text) > SNAPSHOT_FILE_MAX) {
    throw notASnapshot(`it is larger than ${SNAPSHOT_FILE_MAX} bytes`);
  }
  if (nestsDeeperThan(text, JSON_MAX_DEPTH))
    throw notASnapshot(`it nests deeper than ${JSON_MAX_DEPTH} levels`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw notASnapshot("it is not valid JSON");
  }
  if (!Value.Check(SnapshotFileSchema, parsed)) {
    const first = Value.Errors(SnapshotFileSchema, parsed).First();
    throw notASnapshot(`${first?.path || "/"} ${first?.message ?? "is invalid"}`);
  }
  const file: Static<typeof SnapshotFileSchema> = parsed;
  const takenAt = new Date(file.takenAt);
  if (!ISO_DATE_TIME.test(file.takenAt) || Number.isNaN(takenAt.getTime())) {
    throw notASnapshot("takenAt is not an ISO date-time");
  }
  const characters = new Map<number, CharactersPage[]>();
  for (const [seriesId, bodies] of Object.entries(file.characters)) {
    characters.set(Number(seriesId), pages(bodies, parseCharactersPage, `characters.${seriesId}`));
  }
  return {
    takenAt,
    input: {
      series: pages(file.series, parseSeriesPage, "series"),
      relations: pages(file.relations, parseRelationsPage, "relations"),
      characters,
    },
  };
}

/** Reads a stream up to `max` bytes, refusing one that is longer without reading the rest of it. */
export async function readCapped(
  stream: AsyncIterable<Buffer | string>,
  max: number = SNAPSHOT_FILE_MAX,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > max) throw notASnapshot(`it is larger than ${max} bytes`);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}
