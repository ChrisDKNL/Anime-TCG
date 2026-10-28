import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { sessions } from "../src/db/schema.js";
import { hashSessionId, newSessionId } from "../src/domain/session/ids.js";
import {
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_TTL_MS,
  TOUCH_INTERVAL_MS,
} from "../src/domain/session/policy.js";
import {
  clearSessions,
  cookieHeader,
  createTestApp,
  registerProbeRoutes,
  sessionCookieFrom,
  TEST_SESSION_SECRET,
  WEB_ORIGIN,
} from "./support.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("GET /api/session", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
    registerProbeRoutes(app);
  });
  beforeEach(() => clearSessions(app.db));
  afterAll(() => app.close());

  async function signIn(): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/test/sessions", headers: { origin: WEB_ORIGIN } });
    expect(res.statusCode).toBe(200);
    const value = sessionCookieFrom(res.headers["set-cookie"]);
    if (value === undefined) throw new Error("no session cookie was set");
    return value;
  }

  it("is signed out with no cookie and sets none", async () => {
    const res = await app.inject({ method: "GET", url: "/api/session" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ signedIn: false });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("is signed out with a garbage cookie, which it clears", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: cookieHeader("garbage") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ signedIn: false });
    expect(sessionCookieFrom(res.headers["set-cookie"])).toBeUndefined();
    expect(String(res.headers["set-cookie"])).toMatch(/__Host-session=;.*Max-Age=0/);
  });

  it("is signed out with a well-formed but unknown cookie", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: cookieHeader(newSessionId()) },
    });
    expect(res.json()).toEqual({ signedIn: false });
    expect(String(res.headers["set-cookie"])).toMatch(/Max-Age=0/);
  });

  it("is signed out with an expired session row, and the purge removes that row", async () => {
    const cookieValue = newSessionId();
    const id = hashSessionId(TEST_SESSION_SECRET, cookieValue);
    const past = new Date(Date.now() - 1000);
    await app.db
      .insert(sessions)
      .values({ id, accountId: null, expiresAt: past, lastSeenAt: past, userAgentHash: "x" });

    const res = await app.inject({
      method: "GET",
      url: "/test/whoami",
      headers: { cookie: cookieHeader(cookieValue) },
    });
    expect(res.json()).toEqual({ session: null });

    expect(await app.sessions.purgeExpired(new Date())).toBe(1);
    expect(await app.db.select().from(sessions).where(eq(sessions.id, id))).toEqual([]);
  });

  it("is signed out once a session is 90 days old, however far ahead expires_at is, and the purge removes it", async () => {
    const cookieValue = await signIn();
    const id = hashSessionId(TEST_SESSION_SECRET, cookieValue);
    const ninetyOneDaysAgo = new Date(Date.now() - SESSION_ABSOLUTE_LIFETIME_MS - DAY_MS);
    await app.db.update(sessions).set({ createdAt: ninetyOneDaysAgo }).where(eq(sessions.id, id));

    const res = await app.inject({
      method: "GET",
      url: "/test/whoami",
      headers: { cookie: cookieHeader(cookieValue) },
    });
    expect(res.json()).toEqual({ session: null });
    expect(String(res.headers["set-cookie"])).toMatch(/Max-Age=0/);

    expect(await app.sessions.purgeExpired(new Date())).toBe(1);
    expect(await app.db.select().from(sessions).where(eq(sessions.id, id))).toEqual([]);
  });

  it("stays signed in one day short of the absolute lifetime, and the purge keeps the row", async () => {
    const cookieValue = await signIn();
    const id = hashSessionId(TEST_SESSION_SECRET, cookieValue);
    const eightyNineDaysAgo = new Date(Date.now() - SESSION_ABSOLUTE_LIFETIME_MS + DAY_MS);
    await app.db.update(sessions).set({ createdAt: eightyNineDaysAgo }).where(eq(sessions.id, id));

    const res = await app.inject({
      method: "GET",
      url: "/test/whoami",
      headers: { cookie: cookieHeader(cookieValue) },
    });
    expect(res.json()).toEqual({ session: { id, accountId: null } });
    expect(await app.sessions.purgeExpired(new Date())).toBe(0);
  });

  it("sets the cookie with exactly the required attributes on creation", async () => {
    const res = await app.inject({ method: "POST", url: "/test/sessions", headers: { origin: WEB_ORIGIN } });
    const line = String(res.headers["set-cookie"]);
    expect(line).toMatch(
      /^__Host-session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(2592000 * 1000).toBe(SESSION_TTL_MS);
  });

  it("stores only the HMAC of the cookie value, with the user agent hashed", async () => {
    const cookieValue = await signIn();
    const rows = await app.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(hashSessionId(TEST_SESSION_SECRET, cookieValue));
    expect(rows[0]?.id).not.toContain(cookieValue);
    expect(rows[0]?.userAgentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resolves a live session on later requests without touching it inside the interval", async () => {
    const cookieValue = await signIn();
    const res = await app.inject({
      method: "GET",
      url: "/test/whoami",
      headers: { cookie: cookieHeader(cookieValue) },
    });
    expect(res.json()).toEqual({
      session: { id: hashSessionId(TEST_SESSION_SECRET, cookieValue), accountId: null },
    });
    expect(res.headers["set-cookie"]).toBeUndefined();
    const api = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: cookieHeader(cookieValue) },
    });
    expect(api.json()).toEqual({ signedIn: false });
  });

  it("slides last_seen_at and expires_at once the touch interval has passed, re-issuing the cookie", async () => {
    const cookieValue = await signIn();
    const id = hashSessionId(TEST_SESSION_SECRET, cookieValue);
    const stale = new Date(Date.now() - TOUCH_INTERVAL_MS - 1000);
    const oldExpiry = new Date(Date.now() + 1000);
    await app.db.update(sessions).set({ lastSeenAt: stale, expiresAt: oldExpiry }).where(eq(sessions.id, id));

    const res = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: cookieHeader(cookieValue) },
    });
    expect(res.statusCode).toBe(200);
    expect(sessionCookieFrom(res.headers["set-cookie"])).toBe(cookieValue);

    const [row] = await app.db.select().from(sessions).where(eq(sessions.id, id));
    expect(row?.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
    expect(row?.expiresAt.getTime()).toBeGreaterThan(oldExpiry.getTime() + SESSION_TTL_MS / 2);
  });

  it("destroySession deletes the row and clears the cookie", async () => {
    const cookieValue = await signIn();
    const res = await app.inject({
      method: "DELETE",
      url: "/test/sessions",
      headers: { origin: WEB_ORIGIN, cookie: cookieHeader(cookieValue) },
    });
    expect(res.json()).toEqual({ session: null });
    expect(String(res.headers["set-cookie"])).toMatch(/Max-Age=0/);
    expect(await app.db.select().from(sessions)).toEqual([]);
    const after = await app.inject({
      method: "GET",
      url: "/test/whoami",
      headers: { cookie: cookieHeader(cookieValue) },
    });
    expect(after.json()).toEqual({ session: null });
  });
});
