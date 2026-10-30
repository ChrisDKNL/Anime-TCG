import type { AccountPublic } from "@anime-tcg/shared/api";
import type { ErrorCode } from "@anime-tcg/shared/errors";
import { vi } from "vitest";

export function makeAccount(overrides: Partial<AccountPublic> = {}): AccountPublic {
  return {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    login: "Chris",
    createdAt: "2026-10-28T09:30:00.000Z",
    cards: 0,
    ...overrides,
  };
}

export interface MockAnswer {
  status: number;
  /** Serialised as JSON unless `raw` is set; omitted for 204. */
  body?: unknown;
  /** Sent verbatim (a proxy error page, an empty body). */
  raw?: string;
  /** Extra response headers, e.g. `Retry-After`. */
  headers?: Record<string, string>;
}

/** An answer, or a function of the request that gives one (a promise holds the request in flight). */
export type MockHandler =
  MockAnswer | ((init: RequestInit | undefined, url: string) => MockAnswer | Promise<MockAnswer>);

/** The api's envelope for an error code, exactly as `shared/errors` shapes it. */
export function envelope(status: number, code: ErrorCode, retryAfterSeconds?: number): MockAnswer {
  const error =
    retryAfterSeconds === undefined ? { code, message: code } : { code, message: code, retryAfterSeconds };
  return { status, body: { error } };
}

export const noContent: MockAnswer = { status: 204 };

/** The route rate limiter's 429: its envelope carries no seconds, only the `Retry-After` header does (when sent). */
export function rateLimited(retryAfter?: string): MockAnswer {
  const answer = envelope(429, "rate_limited");
  return retryAfter === undefined ? answer : { ...answer, headers: { "retry-after": retryAfter } };
}

function toResponse(answer: MockAnswer): Response {
  const { status, headers } = answer;
  if (answer.raw !== undefined) return new Response(answer.raw, { status, headers });
  if (answer.body === undefined) return new Response(null, { status, headers });
  return new Response(JSON.stringify(answer.body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Replaces `fetch` with a router keyed by `"METHOD path"` (`"GET /api/session"`,
 * `"POST /api/packs/open"`). An unrouted request fails the test
 * rather than silently answering, so a component cannot call something the
 * test did not expect. Returns the mock so tests can inspect bodies.
 */
export function mockFetch(routes: Record<string, MockHandler>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = routes[key];
    if (handler === undefined) return Promise.reject(new Error(`unmocked request ${key}`));
    const answer = typeof handler === "function" ? handler(init, url) : handler;
    return Promise.resolve(answer).then(toResponse);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The `requestId` an opening sent. */
export function requestIdOf(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") throw new Error("the opening sent no JSON body");
  return (JSON.parse(init.body) as { requestId: string }).requestId;
}

/** The JSON body the n-th call to `fetchMock` sent (0-based), parsed. */
export function sentBody(fetchMock: ReturnType<typeof mockFetch>, call = 0): unknown {
  const init = fetchMock.mock.calls[call]?.[1];
  const body = init?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}
