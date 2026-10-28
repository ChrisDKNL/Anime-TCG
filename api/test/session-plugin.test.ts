import { Writable } from "node:stream";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { sessions } from "../src/db/schema.js";
import { hashSessionId, newSessionId } from "../src/domain/session/ids.js";
import { PURGE_INTERVAL_MS, TOUCH_INTERVAL_MS } from "../src/domain/session/policy.js";
import { createLogger } from "../src/plugins/logging.js";
import {
  clearSessions,
  cookieHeader,
  createTestApp,
  registerProbeRoutes,
  sessionCookieFrom,
  TEST_SESSION_SECRET,
  WEB_ORIGIN,
} from "./support.js";

/**
 * What the engineer's session tests do not reach: parallel creation, the
 * hourly purge timer (both outcomes), the exact attributes of every
 * Set-Cookie line the plugin emits (a `__Host-` cookie the browser refuses to
 * clear is a session that cannot be logged out), and duplicate cookies.
 */

const CREATE_LINE =
  /^__Host-session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/;
// A `__Host-` cookie is only accepted (and so only cleared) with Secure, Path=/ and no Domain.
const CLEAR_LINE =
  /^__Host-session=; Max-Age=0; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax$/;

function setCookieLines(header: string | string[] | undefined): string[] {
  return Array.isArray(header) ? header : header === undefined ? [] : [header];
}

function captureLogs(): { sink: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  return {
    sink,
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("session plugin", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
    registerProbeRoutes(app);
  });
  beforeEach(() => clearSessions(app.db));
  afterAll(() => app.close());

  const create = () => app.inject({ method: "POST", url: "/test/sessions", headers: { origin: WEB_ORIGIN } });
  const whoami = (cookie: string) => app.inject({ method: "GET", url: "/test/whoami", headers: { cookie } });

  it("creates distinct sessions for parallel requests: separate cookies, separate rows, no shared id", async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, create));
    const cookies = responses.map((res) => {
      expect(res.statusCode).toBe(200);
      const value = sessionCookieFrom(res.headers["set-cookie"]);
      if (value === undefined) throw new Error("no session cookie was set");
      return value;
    });
    expect(new Set(cookies).size).toBe(5);

    const ids = responses.map((res) => res.json<{ session: { id: string } }>().session.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual(cookies.map((value) => hashSessionId(TEST_SESSION_SECRET, value)));

    const rows = await app.db.select({ id: sessions.id }).from(sessions);
    expect(rows.map((row) => row.id).sort()).toEqual([...ids].sort());

    for (const [index, cookie] of cookies.entries()) {
      const res = await whoami(cookieHeader(cookie));
      expect(res.json()).toEqual({ session: { id: ids[index], accountId: null } });
    }
  });

  it("emits exactly one creation line with the required attributes and nothing else", async () => {
    const res = await create();
    const lines = setCookieLines(res.headers["set-cookie"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(CREATE_LINE);
    expect(lines[0]).not.toMatch(/Domain=/i);
  });

  it("clears an unknown cookie with the attributes a browser needs to drop a __Host- cookie", async () => {
    const res = await whoami(cookieHeader(newSessionId()));
    const lines = setCookieLines(res.headers["set-cookie"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(CLEAR_LINE);
  });

  it("clears on logout with the same attributes", async () => {
    const value = sessionCookieFrom((await create()).headers["set-cookie"]) ?? "";
    const res = await app.inject({
      method: "DELETE",
      url: "/test/sessions",
      headers: { origin: WEB_ORIGIN, cookie: cookieHeader(value) },
    });
    const lines = setCookieLines(res.headers["set-cookie"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(CLEAR_LINE);
  });

  it("re-issues a touched cookie with exactly the creation attributes and the same value", async () => {
    const value = sessionCookieFrom((await create()).headers["set-cookie"]) ?? "";
    const id = hashSessionId(TEST_SESSION_SECRET, value);
    await app.db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - TOUCH_INTERVAL_MS) })
      .where(eq(sessions.id, id));

    const res = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: cookieHeader(value) },
    });
    const lines = setCookieLines(res.headers["set-cookie"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(CREATE_LINE);
    expect(lines[0]?.startsWith(`__Host-session=${value};`)).toBe(true);
  });

  it("replacing a dead cookie and issuing a new one in the same response yields one Set-Cookie, the new one", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/sessions",
      headers: { origin: WEB_ORIGIN, cookie: cookieHeader(newSessionId()) },
    });
    const lines = setCookieLines(res.headers["set-cookie"]);
    expect(lines.filter((line) => line.startsWith("__Host-session="))).toHaveLength(1);
    expect(lines[0]).toMatch(CREATE_LINE);
    const issued = sessionCookieFrom(res.headers["set-cookie"]);
    expect(issued).toBeDefined();
    expect(hashSessionId(TEST_SESSION_SECRET, issued ?? "")).toBe(
      res.json<{ session: { id: string } }>().session.id,
    );
  });

  it("never resolves a session from a tampered duplicate cookie, whichever order the pair arrives in", async () => {
    const valid = sessionCookieFrom((await create()).headers["set-cookie"]) ?? "";
    const validId = hashSessionId(TEST_SESSION_SECRET, valid);
    const tampered = `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`;

    for (const header of [
      `${cookieHeader(valid)}; ${cookieHeader(tampered)}`,
      `${cookieHeader(tampered)}; ${cookieHeader(valid)}`,
    ]) {
      const res = await whoami(header);
      expect(res.statusCode).toBe(200);
      const { session } = res.json<{ session: { id: string } | null }>();
      if (session !== null) expect(session.id).toBe(validId);
      // Whatever was or was not resolved, the response never hands out a usable cookie it did not mint.
      const issued = sessionCookieFrom(res.headers["set-cookie"]);
      expect(issued === undefined || issued === valid).toBe(true);
    }
  });

  it("answers an expired row on /api/session as signed out and clears the cookie", async () => {
    const value = newSessionId();
    const past = new Date(Date.now() - 1000);
    await app.db.insert(sessions).values({
      id: hashSessionId(TEST_SESSION_SECRET, value),
      accountId: null,
      expiresAt: past,
      lastSeenAt: past,
      userAgentHash: "x",
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: cookieHeader(value) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ signedIn: false });
    expect(setCookieLines(res.headers["set-cookie"])[0]).toMatch(CLEAR_LINE);
  });

  it("destroySession without a session touches no row and still clears the cookie", async () => {
    await create();
    const res = await app.inject({
      method: "DELETE",
      url: "/test/sessions",
      headers: { origin: WEB_ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ session: null });
    expect(setCookieLines(res.headers["set-cookie"])[0]).toMatch(CLEAR_LINE);
    expect(await app.db.select().from(sessions)).toHaveLength(1);
  });

  it("HEAD /api/session answers like GET without a body", async () => {
    const res = await app.inject({ method: "HEAD", url: "/api/session" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("hourly purge timer", () => {
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

  afterEach(() => {
    setIntervalSpy.mockClear();
    clearIntervalSpy.mockClear();
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  /** The interval the session plugin registered, with the callback the test can fire by hand. */
  function purgeTimer(): { tick: () => void; timer: NodeJS.Timeout } {
    const index = setIntervalSpy.mock.calls.findIndex(([, ms]) => ms === PURGE_INTERVAL_MS);
    expect(index).toBeGreaterThanOrEqual(0);
    const [callback] = setIntervalSpy.mock.calls[index] as [() => void, number];
    return { tick: callback, timer: setIntervalSpy.mock.results[index]?.value as NodeJS.Timeout };
  }

  it("starts only once the app is ready, does not keep the process alive, and removes expired rows only", async () => {
    const { sink, lines } = captureLogs();
    const app = await createTestApp({ logger: createLogger("info", sink) });
    try {
      expect(setIntervalSpy.mock.calls.some(([, ms]) => ms === PURGE_INTERVAL_MS)).toBe(false);
      await app.ready();
      const { tick, timer } = purgeTimer();
      expect(timer.hasRef()).toBe(false);

      await clearSessions(app.db);
      const past = new Date(Date.now() - 1000);
      const future = new Date(Date.now() + 60_000);
      await app.db.insert(sessions).values([
        { id: "expired-1", accountId: null, expiresAt: past, lastSeenAt: past, userAgentHash: "x" },
        { id: "expired-2", accountId: null, expiresAt: past, lastSeenAt: past, userAgentHash: "x" },
        { id: "live", accountId: null, expiresAt: future, lastSeenAt: future, userAgentHash: "x" },
      ]);

      tick();
      await vi.waitFor(async () => {
        const rows = await app.db.select({ id: sessions.id }).from(sessions);
        expect(rows).toEqual([{ id: "live" }]);
      });
      await vi.waitFor(() => {
        expect(lines()).toContainEqual(
          expect.objectContaining({ msg: "expired sessions purged", purged: 2 }),
        );
      });
    } finally {
      await app.close();
    }
    expect(clearIntervalSpy).toHaveBeenCalledWith(purgeTimer().timer);
  });

  it("survives a failed sweep: logs the error and keeps the process up", async () => {
    const { sink, lines } = captureLogs();
    const dead = await createTestApp({
      db: createDb("postgres://anime:anime@127.0.0.1:1/anime"),
      logger: createLogger("info", sink),
    });
    try {
      await dead.ready();
      const { tick } = purgeTimer();
      tick();
      await vi.waitFor(() => {
        expect(lines()).toContainEqual(expect.objectContaining({ level: 50, msg: "session purge failed" }));
      });
      // Still serving: the sweep's failure did not escape as an unhandled rejection or close the app.
      const res = await dead.inject({ method: "GET", url: "/api/session" });
      expect(res.statusCode).toBe(200);
    } finally {
      await dead.close();
    }
  });
});
