/// <reference lib="dom" />
import { expect, test as base, type Page, type Route } from "@playwright/test";
import type { AccountPublic, SessionResponse } from "@anime-tcg/shared/api";
import type { ErrorCode } from "@anime-tcg/shared/errors";
import { makeAniListResponse } from "../../src/test/fixtures";

/**
 * e2e support for the accounts UI against a scripted api (docs/design/accounts.md).
 *
 * `page.route` answers every `/api/*` request before it reaches the Vite proxy, so these
 * tests never need the real api, and AniList is always served from fixtures (the tester
 * rule: never hit the real AniList API). A request the test did not script is answered
 * with a 500 envelope and fails the test in the fixture teardown, so the UI cannot call
 * something unexpected without the test noticing.
 */

// 1x1 transparent PNG so card images resolve without hitting AniList's CDN.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Deterministic AniList: a 20-character pool and a 1x1 image for every portrait. */
export async function mockAniList(page: Page): Promise<void> {
  await page.route("https://graphql.anilist.co/**", (route) =>
    route.fulfill({ json: makeAniListResponse(20) }),
  );
  await page.route("https://s4.anilist.co/**", (route) =>
    route.fulfill({ body: PNG, contentType: "image/png" }),
  );
}

/**
 * The login as the app writes it into a plain string (the Account control's aria-label, the
 * title bar, the Reset confirm): between U+2068 FIRST STRONG ISOLATE and U+2069 POP DIRECTIONAL
 * ISOLATE, the plain-text counterpart of <bdi> (T1, docs/05-security.md).
 */
export const isolated = (login: string): string => `\u2068${login}\u2069`;

export function makeAccount(overrides: Partial<AccountPublic> = {}): AccountPublic {
  return {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    login: "Chris",
    createdAt: "2026-10-28T09:30:00.000Z",
    cards: 0,
    ...overrides,
  };
}

/** What the scripted api sends back: JSON, a raw non-JSON body (a proxy error page), or nothing (204). */
export interface Answer {
  status: number;
  json?: unknown;
  raw?: string;
  headers?: Record<string, string>;
}

export interface ApiCall {
  /** `"METHOD /path"`, e.g. `"POST /api/session/login"`. */
  key: string;
  body: unknown;
}

/** An answer, a dropped connection, or a function of the call (which may wait, to hold a request in flight). */
export type Reply = Answer | "abort" | ((call: ApiCall) => Answer | "abort" | Promise<Answer | "abort">);

export const signedIn = (account: AccountPublic): Answer => ({
  status: 200,
  json: { signedIn: true, account } satisfies SessionResponse,
});
export const signedOut: Answer = { status: 200, json: { signedIn: false } satisfies SessionResponse };
export const noContent: Answer = { status: 204 };
export const accountAnswer = (account: AccountPublic): Answer => ({ status: 200, json: { account } });

/** The api's error envelope for a code, shaped like `shared/errors`. */
export function envelope(status: number, code: ErrorCode, retryAfterSeconds?: number): Answer {
  const error =
    retryAfterSeconds === undefined ? { code, message: code } : { code, message: code, retryAfterSeconds };
  return { status, json: { error } };
}

/** A promise the test resolves itself: hold a request in flight, then let it answer. */
export function deferred(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export class FakeApi {
  readonly calls: ApiCall[] = [];
  readonly unexpected: string[] = [];
  private readonly replies = new Map<string, Reply[]>();

  /** Scripts `"METHOD /path"`: each call takes the next reply; the last one keeps answering. */
  on(key: string, ...replies: Reply[]): this {
    this.replies.set(key, [...replies]);
    return this;
  }

  count(key: string): number {
    return this.calls.filter((call) => call.key === key).length;
  }

  bodies(key: string): unknown[] {
    return this.calls.filter((call) => call.key === key).map((call) => call.body);
  }

  async handle(route: Route): Promise<void> {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    const raw = request.postData();
    const call: ApiCall = { key, body: raw === null ? undefined : (JSON.parse(raw) as unknown) };
    this.calls.push(call);
    const queue = this.replies.get(key);
    if (queue === undefined || queue.length === 0) {
      this.unexpected.push(key);
      await route.fulfill(envelope(500, "internal"));
      return;
    }
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    const answer = typeof reply === "function" ? await reply(call) : reply;
    if (answer === "abort") {
      await route.abort("connectionrefused");
    } else if (answer.raw !== undefined) {
      await route.fulfill({
        status: answer.status,
        headers: answer.headers,
        body: answer.raw,
        contentType: "text/html",
      });
    } else if (answer.json === undefined) {
      await route.fulfill({ status: answer.status, headers: answer.headers });
    } else {
      await route.fulfill({ status: answer.status, headers: answer.headers, json: answer.json });
    }
  }
}

/** `test` with AniList mocked and a scripted api on every page; unscripted api calls fail the test. */
export const test = base.extend<{ api: FakeApi }>({
  api: async ({ page }, provide) => {
    await mockAniList(page);
    const api = new FakeApi();
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      (route) => api.handle(route),
    );
    await provide(api);
    expect(api.unexpected, "api calls the test did not script").toEqual([]);
  },
});

export { expect };

declare global {
  interface Window {
    __statusTexts?: string[];
    __labels?: string[];
    __seenAt?: Record<string, number>;
  }
}

/**
 * Records, in order, every non-empty text any `role="status"` element takes (the app's live
 * region, the session-ended banner, the breather). This is how "announced once" is checked
 * without racing a polling assertion against a one-second countdown. Call before `goto`.
 */
export async function recordStatusTexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    window.__statusTexts = seen;
    const last = new WeakMap<Element, string>();
    const scan = () => {
      document.querySelectorAll('[role="status"]').forEach((element) => {
        const text = element.textContent ?? "";
        if (text !== "" && last.get(element) !== text) seen.push(text);
        last.set(element, text);
      });
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

export async function statusTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__statusTexts ?? []);
}

/**
 * Records `performance.now()` the first time each needle appears in the page text, so a
 * delay ("Loading… only after 300 ms") is measured in the page instead of by polling.
 */
export async function recordFirstSeen(page: Page, needles: string[]): Promise<void> {
  await page.addInitScript((wanted: string[]) => {
    const seenAt: Record<string, number> = {};
    window.__seenAt = seenAt;
    new MutationObserver(() => {
      const text = document.body?.textContent ?? "";
      for (const needle of wanted) {
        if (!(needle in seenAt) && text.includes(needle)) seenAt[needle] = performance.now();
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, needles);
}

export async function firstSeen(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => window.__seenAt ?? {});
}
