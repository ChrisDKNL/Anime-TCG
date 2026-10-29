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
}

export type MockHandler = MockAnswer | ((init: RequestInit | undefined, url: string) => MockAnswer);

/** The api's envelope for an error code, exactly as `shared/errors` shapes it. */
export function envelope(status: number, code: ErrorCode, retryAfterSeconds?: number): MockAnswer {
  const error =
    retryAfterSeconds === undefined ? { code, message: code } : { code, message: code, retryAfterSeconds };
  return { status, body: { error } };
}

export const noContent: MockAnswer = { status: 204 };

function toResponse(answer: MockAnswer): Response {
  if (answer.raw !== undefined) return new Response(answer.raw, { status: answer.status });
  if (answer.body === undefined) return new Response(null, { status: answer.status });
  return new Response(JSON.stringify(answer.body), {
    status: answer.status,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Replaces `fetch` with a router keyed by `"METHOD path"` (`"GET /api/session"`,
 * `"POST https://graphql.anilist.co"`). An unrouted request fails the test
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
    return Promise.resolve(toResponse(answer));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The JSON body the n-th call to `fetchMock` sent (0-based), parsed. */
export function sentBody(fetchMock: ReturnType<typeof mockFetch>, call = 0): unknown {
  const init = fetchMock.mock.calls[call]?.[1];
  const body = init?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}
