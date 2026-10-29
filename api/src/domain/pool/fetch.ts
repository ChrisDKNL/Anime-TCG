import { desc, eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db } from "../../db/client.js";
import { poolFetches, poolFetchPages } from "../../db/schema.js";
import { type AniListClient, AniListRequestError, type QueryVariables } from "./anilist.js";
import { SnapshotRefused } from "./build.js";
import { nextHops } from "./franchises.js";
import {
  ANILIST_MAX_REQUESTS,
  ANILIST_MAX_RETRIES,
  ANILIST_SERIES_PER_PAGE,
  FETCH_RESUME_MAX_AGE_MS,
  FRANCHISE_MAX_HOPS,
  FRANCHISE_MAX_REQUESTS,
  SNAPSHOT_SERIES,
} from "./limits.js";
import {
  type CharactersPage,
  PageShapeError,
  parseCharactersPage,
  parseRelationsPage,
  parseSeriesPage,
  type RelationsPage,
  type SeriesPage,
} from "./pages.js";
import { CHARACTERS_QUERY, RELATIONS_QUERY, SERIES_QUERY } from "./queries.js";
import { entriesOf, hopEdgesOf, type SnapshotInput } from "./validate.js";

/** The fetch stopped after `ANILIST_MAX_RETRIES` retries of one request; its pages are kept for the next run. */
export class FetchPaused extends Error {
  constructor(
    readonly done: number,
    readonly estimated: number,
  ) {
    super(`Paused after ${done} of about ${estimated} requests; run again to resume.`);
    this.name = "FetchPaused";
  }
}

type PageKind = "series" | "relations" | "characters";

export type FetchLog = Pick<Logger, "info" | "warn">;

export interface StagedFetch {
  id: number;
  startedAt: Date;
  resumed: boolean;
}

/** Staging rows of a resumable fetch (collection-packs.md §5.1.5), each page in its own short transaction. */
export class FetchStaging {
  constructor(private readonly db: Db) {}

  /**
   * The newest unfinished fetch when it began less than `FETCH_RESUME_MAX_AGE`
   * ago and `restart` was not asked for; otherwise a new one, after the old
   * one is discarded so a snapshot never mixes rankings from days apart.
   */
  async open(now: Date, restart: boolean): Promise<StagedFetch> {
    const [newest] = await this.db
      .select({ id: poolFetches.id, startedAt: poolFetches.startedAt })
      .from(poolFetches)
      .orderBy(desc(poolFetches.id))
      .limit(1);
    if (
      newest !== undefined &&
      !restart &&
      now.getTime() - newest.startedAt.getTime() < FETCH_RESUME_MAX_AGE_MS
    ) {
      return { ...newest, resumed: true };
    }
    // Every fetch row is unfinished (a build deletes its own), so none of them can be resumed after this one starts.
    await this.db.delete(poolFetches);
    const [created] = await this.db
      .insert(poolFetches)
      .values({ startedAt: now })
      .returning({ id: poolFetches.id });
    if (created === undefined) throw new Error("fetch insert returned no row");
    return { id: created.id, startedAt: now, resumed: false };
  }

  async load(fetchId: number): Promise<Map<string, unknown>> {
    const rows = await this.db
      .select({
        kind: poolFetchPages.kind,
        key: poolFetchPages.key,
        page: poolFetchPages.page,
        body: poolFetchPages.body,
      })
      .from(poolFetchPages)
      .where(eq(poolFetchPages.fetchId, fetchId));
    return new Map(rows.map((row) => [pageKey(row.kind, row.key, row.page), row.body]));
  }

  async save(
    fetchId: number,
    kind: PageKind,
    key: string,
    page: number,
    body: unknown,
    now: Date,
  ): Promise<void> {
    await this.db.insert(poolFetchPages).values({ fetchId, kind, key, page, body, fetchedAt: now });
  }
}

function pageKey(kind: string, key: string, page: number): string {
  return `${kind}|${key}|${page}`;
}

export interface FetchResult {
  input: SnapshotInput;
  /** HTTP requests this run sent, retries included. */
  requests: number;
  /** Pages the snapshot is built from, stored earlier or fetched now. */
  pages: number;
  rateLimited: number;
}

const PROGRESS_EVERY = 25;
const BACKOFF_BASE_MS = 2_000;

/**
 * Fetches the snapshot's pages from AniList one request at a time, resuming
 * from the staged pages of `fetch`: the entries, up to `FRANCHISE_MAX_HOPS`
 * rounds of relation hops, then each entry's characters page by page. Every
 * page is parsed before it is stored, and nothing is built until all are in.
 */
export async function fetchSnapshotPages(
  staging: FetchStaging,
  client: AniListClient,
  fetch: StagedFetch,
  log: FetchLog,
  clock: () => Date = () => new Date(),
): Promise<FetchResult> {
  const stored = await staging.load(fetch.id);
  let pages = 0;
  let requests = 0;
  let rateLimited = 0;
  let estimatedRemaining = Math.ceil(SNAPSHOT_SERIES / ANILIST_SERIES_PER_PAGE) + SNAPSHOT_SERIES;

  async function page<T>(
    kind: PageKind,
    key: string,
    number: number,
    query: string,
    variables: QueryVariables,
    parse: (body: unknown) => T,
  ): Promise<T> {
    const known = stored.get(pageKey(kind, key, number));
    pages += 1;
    if (known !== undefined) return parse(known);
    if (pages > ANILIST_MAX_REQUESTS) {
      throw new SnapshotRefused(`The fetch would need more than ${ANILIST_MAX_REQUESTS} AniList requests.`);
    }
    for (let failures = 0; ;) {
      requests += 1;
      if (requests % PROGRESS_EVERY === 0) {
        log.info({ requests, pages, estimatedRemaining, rateLimited }, "snapshot fetch progress");
      }
      try {
        const parsed = parse(await client.request(query, variables));
        await staging.save(fetch.id, kind, key, number, parsed, clock());
        return parsed;
      } catch (err) {
        const failure =
          err instanceof AniListRequestError
            ? err.failure
            : err instanceof PageShapeError
              ? ({ kind: "retryable", reason: err.message } as const)
              : null;
        if (failure === null) throw err;
        if (failure.kind === "fatal")
          throw new SnapshotRefused(`${failure.reason}; nothing more was fetched.`);
        failures += 1;
        if (failures > ANILIST_MAX_RETRIES) throw new FetchPaused(pages - 1, pages - 1 + estimatedRemaining);
        if (failure.kind === "rate_limited") rateLimited += 1;
        const waitMs =
          failure.kind === "rate_limited" ? failure.waitMs : BACKOFF_BASE_MS * 2 ** (failures - 1);
        log.warn(
          { kind, key, page: number, reason: failure.reason, failures, waitMs },
          "AniList request failed; retrying",
        );
        await client.sleep(waitMs);
      }
    }
  }

  const series: SeriesPage[] = [];
  const seriesPages = Math.ceil(SNAPSHOT_SERIES / ANILIST_SERIES_PER_PAGE);
  for (let number = 1; number <= seriesPages; number += 1) {
    series.push(await page("series", "", number, SERIES_QUERY, { page: number }, parseSeriesPage));
    estimatedRemaining -= 1;
  }
  const { entries, edges } = entriesOf(series);
  const top = new Set(entries.map((entry) => entry.id));

  const relations: RelationsPage[] = [];
  const read = new Set<number>();
  let sources: ReadonlySet<number> = top;
  for (let round = 1; round <= FRANCHISE_MAX_HOPS; round += 1) {
    const frontier = nextHops([...edges, ...hopEdgesOf(relations)], sources, top, read);
    const batches: number[][] = [];
    for (let start = 0; start < frontier.length; start += ANILIST_SERIES_PER_PAGE) {
      batches.push(frontier.slice(start, start + ANILIST_SERIES_PER_PAGE));
    }
    if (relations.length + batches.length > FRANCHISE_MAX_REQUESTS) {
      throw new SnapshotRefused(
        `The franchise hops would need ${relations.length + batches.length} relation requests, more than ${FRANCHISE_MAX_REQUESTS}.`,
      );
    }
    for (const ids of batches) {
      relations.push(
        await page("relations", String(ids[0]), 1, RELATIONS_QUERY, { ids }, parseRelationsPage),
      );
      for (const id of ids) read.add(id);
    }
    sources = new Set(frontier);
  }

  const characters = new Map<number, CharactersPage[]>();
  estimatedRemaining = entries.length;
  for (const entry of entries) {
    const list: CharactersPage[] = [];
    for (let number = 1; ; number += 1) {
      const body = await page(
        "characters",
        String(entry.id),
        number,
        CHARACTERS_QUERY,
        { id: entry.id, page: number },
        parseCharactersPage,
      );
      list.push(body);
      const { main, supporting } = body.data.Media;
      if (!main.pageInfo.hasNextPage && !supporting.pageInfo.hasNextPage) break;
    }
    characters.set(entry.id, list);
    estimatedRemaining -= 1;
  }

  return { input: { series, relations, characters }, requests, pages, rateLimited };
}
