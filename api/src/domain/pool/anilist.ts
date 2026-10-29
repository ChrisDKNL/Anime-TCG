import { setTimeout as delay } from "node:timers/promises";
import {
  ANILIST_DEFAULT_RETRY_AFTER_MS,
  ANILIST_ENDPOINT,
  ANILIST_MAX_BODY,
  ANILIST_MAX_RETRY_AFTER_MS,
  ANILIST_REQUEST_GAP_MS,
  ANILIST_TIMEOUT_MS,
  JSON_MAX_DEPTH,
} from "./limits.js";
import { nestsDeeperThan } from "./pages.js";

/**
 * How one request to AniList went wrong (collection-packs.md §5.1.5): a 429
 * waits `waitMs` and retries; a network error, a timeout, an oversized or
 * unparsable body, a 5xx or a GraphQL `errors` answer backs off and
 * retries; any other 4xx is a query bug, and retrying cannot help.
 */
export type AniListFailure =
  | { kind: "rate_limited"; waitMs: number; reason: string }
  | { kind: "retryable"; reason: string }
  | { kind: "fatal"; reason: string };

export class AniListRequestError extends Error {
  constructor(readonly failure: AniListFailure) {
    super(failure.reason);
    this.name = "AniListRequestError";
  }
}

export interface AniListClientOptions {
  endpoint?: string;
  gapMs?: number;
  timeoutMs?: number;
  maxBody?: number;
  /** Waits between requests and before retries; a test passes one that records instead of sleeping. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Variables carry page numbers and AniList's own ids, nothing a player or the owner typed. */
export type QueryVariables = Readonly<Record<string, number | readonly number[]>>;

/** The IMF-fixdate form of an HTTP date (`Thu, 29 Oct 2026 12:01:00 GMT`); `Date.parse` alone accepts far more. */
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** `Retry-After` in seconds or as an HTTP date, capped so a broken header cannot stall the command for hours. */
export function retryAfterMs(header: string | null, now: number): number {
  if (header === null) return ANILIST_DEFAULT_RETRY_AFTER_MS;
  const trimmed = header.trim();
  let ms: number;
  if (/^\d+$/.test(trimmed)) ms = Number(trimmed) * 1000;
  else if (HTTP_DATE.test(trimmed)) ms = Date.parse(trimmed) - now;
  else return ANILIST_DEFAULT_RETRY_AFTER_MS;
  if (!Number.isFinite(ms)) return ANILIST_DEFAULT_RETRY_AFTER_MS;
  return Math.min(Math.max(ms, 0), ANILIST_MAX_RETRY_AFTER_MS);
}

async function readBody(response: Response, maxBody: number): Promise<string> {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > maxBody) {
      await reader.cancel();
      throw new AniListRequestError({
        kind: "retryable",
        reason: `the answer is larger than ${maxBody} bytes`,
      });
    }
    chunks.push(read.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function hasGraphQlErrors(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "errors" in body &&
    Array.isArray(body.errors) &&
    body.errors.length > 0
  );
}

/**
 * The only AniList client in the system, used by the owner's `snapshot-pool`
 * command alone; the api server never constructs one. One request at a time,
 * at most one per `gapMs`, each bounded in time and size.
 */
export class AniListClient {
  private readonly endpoint: string;
  private readonly gapMs: number;
  private readonly timeoutMs: number;
  private readonly maxBody: number;
  readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastStart: number | null = null;

  constructor(options: AniListClientOptions = {}) {
    this.endpoint = options.endpoint ?? ANILIST_ENDPOINT;
    this.gapMs = options.gapMs ?? ANILIST_REQUEST_GAP_MS;
    this.timeoutMs = options.timeoutMs ?? ANILIST_TIMEOUT_MS;
    this.maxBody = options.maxBody ?? ANILIST_MAX_BODY;
    this.sleep = options.sleep ?? ((ms) => delay(ms));
    this.now = options.now ?? Date.now;
  }

  /** One attempt; every failure is an `AniListRequestError` saying whether and how to retry. */
  async request(query: string, variables: QueryVariables): Promise<unknown> {
    if (this.lastStart !== null) {
      const wait = this.lastStart + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastStart = this.now();

    let response: Response;
    let text: string;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
      if (response.status === 429) {
        await response.body?.cancel();
        throw new AniListRequestError({
          kind: "rate_limited",
          waitMs: retryAfterMs(response.headers.get("retry-after"), this.now()),
          reason: "AniList answered 429",
        });
      }
      text = await readBody(response, this.maxBody);
    } catch (err) {
      if (err instanceof AniListRequestError) throw err;
      const reason =
        err instanceof Error && err.name === "TimeoutError" ? "the request timed out" : "the request failed";
      throw new AniListRequestError({ kind: "retryable", reason });
    }
    if (response.status >= 500) {
      throw new AniListRequestError({ kind: "retryable", reason: `AniList answered ${response.status}` });
    }
    if (response.status >= 400) {
      throw new AniListRequestError({
        kind: "fatal",
        reason: `AniList refused the request (HTTP ${response.status})`,
      });
    }
    if (nestsDeeperThan(text, JSON_MAX_DEPTH)) {
      throw new AniListRequestError({ kind: "retryable", reason: "the answer nests too deeply" });
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AniListRequestError({ kind: "retryable", reason: "the answer is not valid JSON" });
    }
    if (hasGraphQlErrors(body)) {
      throw new AniListRequestError({ kind: "retryable", reason: "AniList answered with GraphQL errors" });
    }
    return body;
  }
}
