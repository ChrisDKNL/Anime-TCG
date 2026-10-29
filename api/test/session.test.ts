import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { accounts, authThrottle, sessions } from "../src/db/schema.js";
import { THROTTLE_BLOCK_MS, THROTTLE_MAX_FAILURES } from "../src/domain/accounts/throttle.js";
import { hashSessionId, newSessionId } from "../src/domain/session/ids.js";
import {
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_TTL_MS,
  TOUCH_INTERVAL_MS,
} from "../src/domain/session/policy.js";
import {
  clearAccountData,
  clearSessions,
  cookieHeader,
  createTestApp,
  loginAccount,
  registerAccount,
  registerProbeRoutes,
  send,
  sessionCookieFrom,
  TEST_SESSION_SECRET,
  WEB_ORIGIN,
} from "./support.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "correct horse battery";
const COOKIE_LINE =
  /^__Host-session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/;
const CLEARED_LINE =
  /^__Host-session=; Max-Age=0; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax$/;

function envelope(res: LightMyRequestResponse): {
  code: string;
  message: string;
  retryAfterSeconds?: number;
} {
  return res.json<{ error: { code: string; message: string; retryAfterSeconds?: number } }>().error;
}

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

describe("GET /api/session, signed in", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  it("returns the account behind a live session, with the stored display login", async () => {
    const { cookie, account } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const res = await send(app, { method: "GET", url: "/api/session", cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ signedIn: true, account });
    expect(Object.keys(res.json<{ account: object }>().account).sort()).toEqual([
      "cards",
      "createdAt",
      "id",
      "login",
    ]);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("is signed out once the account is gone, and clears the cookie", async () => {
    const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    await app.db.delete(accounts);
    const res = await send(app, { method: "GET", url: "/api/session", cookie });
    expect(res.json()).toEqual({ signedIn: false });
    expect(String(res.headers["set-cookie"])).toMatch(CLEARED_LINE);
  });
});

describe("POST /api/session/login", () => {
  let app: App;
  const login = (payload: unknown, cookie?: string) =>
    send(app, { method: "POST", url: "/api/session/login", payload, cookie });
  const whoami = (cookie: string) => send(app, { method: "GET", url: "/api/session", cookie });

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await clearAccountData(app.db);
    await registerAccount(app, { login: "Chris", password: PASSWORD });
  });
  afterAll(() => app.close());

  it("answers 200 with the account and a new session cookie", async () => {
    const res = await login({ login: "Chris", password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ signedIn: boolean; account: Record<string, unknown> }>();
    expect(body.signedIn).toBe(true);
    expect(body.account).toMatchObject({ login: "Chris", cards: 0 });
    expect(Object.keys(body.account).sort()).toEqual(["cards", "createdAt", "id", "login"]);
    expect(String(res.headers["set-cookie"])).toMatch(COOKIE_LINE);
    const cookie = sessionCookieFrom(res.headers["set-cookie"]) ?? "";
    expect((await whoami(cookie)).json()).toEqual(res.json());
    expect(await app.db.select().from(authThrottle)).toEqual([]);
  });

  it.each(["chris", "CHRIS", "  Chris ", "\tchris\n"])(
    "signs in with the login written as %j and returns the stored display login",
    async (typed) => {
      const res = await login({ login: typed, password: PASSWORD });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ account: { login: string } }>().account.login).toBe("Chris");
    },
  );

  it("rotates the session: the cookie sent with the login is dead afterwards and only one row remains for it", async () => {
    const planted = await loginAccount(app, { login: "Chris", password: PASSWORD });
    const res = await login({ login: "Chris", password: PASSWORD }, planted.cookie);
    const issued = sessionCookieFrom(res.headers["set-cookie"]);
    expect(issued).toBeDefined();
    expect(issued).not.toBe(planted.cookie);
    expect([res.headers["set-cookie"]].flat().filter((line) => line !== undefined)).toHaveLength(1);
    expect((await whoami(planted.cookie)).json()).toEqual({ signedIn: false });
    expect((await whoami(issued ?? "")).json()).toMatchObject({ signedIn: true });
    // The registration's session plus the new one; the planted one is gone.
    expect(await app.db.select({ id: sessions.id }).from(sessions)).toHaveLength(2);
  });

  it.each([
    ["a wrong password", { login: "Chris", password: "not the password" }],
    ["the password with a trailing space", { login: "Chris", password: `${PASSWORD} ` }],
    ["the password in another case", { login: "Chris", password: PASSWORD.toUpperCase() }],
    ["an unknown login", { login: "nobody", password: PASSWORD }],
  ])("refuses %s with the same 401 bad_credentials and no cookie", async (_label, payload) => {
    const res = await login(payload);
    expect(res.statusCode).toBe(401);
    expect(envelope(res)).toEqual({ code: "bad_credentials", message: "Incorrect login or password" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("counts misses per normalised login in auth_throttle, across clients and spellings", async () => {
    expect((await login({ login: "Chris", password: "wrong" })).statusCode).toBe(401);
    expect((await login({ login: "CHRIS ", password: "wrong" })).statusCode).toBe(401);
    expect(await app.db.select().from(authThrottle)).toMatchObject([
      { key: "chris", failures: 2, blockedUntil: null },
    ]);
    expect((await login({ login: "nobody", password: "wrong" })).statusCode).toBe(401);
    expect(
      await app.db.select({ key: authThrottle.key }).from(authThrottle).orderBy(authThrottle.key),
    ).toEqual([{ key: "chris" }, { key: "nobody" }]);
  });

  it("four misses are 401s, the fifth starts the breather, and the sixth is 429 before the password is looked at", async () => {
    for (let i = 1; i < THROTTLE_MAX_FAILURES; i += 1) {
      const miss = await login({ login: "Chris", password: "wrong" });
      expect(miss.statusCode).toBe(401);
      expect(await app.db.select().from(authThrottle)).toMatchObject([{ failures: i, blockedUntil: null }]);
    }
    const fifth = await login({ login: "Chris", password: "wrong" });
    expect(fifth.statusCode).toBe(401);
    const [row] = await app.db.select().from(authThrottle);
    expect(row?.failures).toBe(0);
    expect(row?.blockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(row?.blockedUntil?.getTime()).toBeLessThanOrEqual(Date.now() + THROTTLE_BLOCK_MS);

    const blocked = await login({ login: "chris", password: PASSWORD });
    expect(blocked.statusCode).toBe(429);
    const { retryAfterSeconds, ...rest } = envelope(blocked);
    expect(rest).toEqual({ code: "too_many_failures", message: "Too many wrong passwords; wait a moment" });
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retryAfterSeconds).toBeLessThanOrEqual(10);
    expect(blocked.headers["retry-after"]).toBe(String(retryAfterSeconds));
    expect(blocked.headers["set-cookie"]).toBeUndefined();
    // Another login is not affected.
    await registerAccount(app, { login: "Other", password: PASSWORD });
    expect((await login({ login: "Other", password: PASSWORD })).statusCode).toBe(200);
  });

  it("lets the right password in once the breather is over, and clears the row", async () => {
    for (let i = 0; i < THROTTLE_MAX_FAILURES; i += 1) await login({ login: "Chris", password: "wrong" });
    expect((await login({ login: "Chris", password: PASSWORD })).statusCode).toBe(429);
    await app.db.update(authThrottle).set({ blockedUntil: new Date(Date.now() - 1) });
    const res = await login({ login: "Chris", password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(await app.db.select().from(authThrottle)).toEqual([]);
  });

  it("the breather on one login survives a restart of the api (it lives in the database)", async () => {
    for (let i = 0; i < THROTTLE_MAX_FAILURES; i += 1) await login({ login: "Chris", password: "wrong" });
    const restarted = await createTestApp();
    try {
      const res = await send(restarted, {
        method: "POST",
        url: "/api/session/login",
        payload: { login: "Chris", password: PASSWORD },
      });
      expect(res.statusCode).toBe(429);
    } finally {
      await restarted.close();
    }
  });

  it.each([
    ["an extra field", { login: "Chris", password: PASSWORD, remember: true }],
    ["a missing password", { login: "Chris" }],
    ["an empty login", { login: "", password: PASSWORD }],
    ["an empty password", { login: "Chris", password: "" }],
    ["a 25-character login", { login: "x".repeat(25), password: PASSWORD }],
    ["a 129-character password", { login: "Chris", password: "x".repeat(129) }],
    ["a 1000-character password", { login: "Chris", password: "x".repeat(1000) }],
    ["a numeric login", { login: 42, password: PASSWORD }],
  ])("rejects %s as 400 validation_failed without counting a miss", async (_label, payload) => {
    const res = await login(payload);
    expect(res.statusCode).toBe(400);
    expect(envelope(res).code).toBe("validation_failed");
    expect(await app.db.select().from(authThrottle)).toEqual([]);
  });

  it("is 403 bad_origin without an Origin, and no miss is counted", async () => {
    const res = await send(app, {
      method: "POST",
      url: "/api/session/login",
      payload: { login: "Chris", password: "wrong" },
      origin: null,
    });
    expect(res.statusCode).toBe(403);
    expect(envelope(res).code).toBe("bad_origin");
    expect(await app.db.select().from(authThrottle)).toEqual([]);
  });

  it("is limited to 10 per minute per client", async () => {
    expect((await login({ login: "Chris", password: PASSWORD })).headers["x-ratelimit-limit"]).toBe("10");
  });
});

describe("POST /api/session/logout", () => {
  let app: App;
  const logout = (cookie?: string, payload?: unknown, origin: string | null = WEB_ORIGIN) =>
    send(app, {
      method: "POST",
      url: "/api/session/logout",
      cookie,
      payload,
      origin,
      // A JSON content type on every body, including the string one; without a body inject sends neither.
      headers: payload === undefined ? {} : { "content-type": "application/json" },
    });

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  it("ends the session: 204, cookie cleared, row gone, cookie dead", async () => {
    const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const res = await logout(cookie);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(String(res.headers["set-cookie"])).toMatch(CLEARED_LINE);
    expect(await app.db.select().from(sessions)).toEqual([]);
    expect((await send(app, { method: "GET", url: "/api/session", cookie })).json()).toEqual({
      signedIn: false,
    });
  });

  it("is 204 when already signed out, with or without a dead cookie", async () => {
    expect((await logout()).statusCode).toBe(204);
    const dead = await logout("A".repeat(43));
    expect(dead.statusCode).toBe(204);
    expect(String(dead.headers["set-cookie"])).toMatch(CLEARED_LINE);
  });

  it("ends only the session it was sent with", async () => {
    const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const phone = await loginAccount(app, { login: "Chris", password: PASSWORD });
    await logout(cookie);
    expect(
      (await send(app, { method: "GET", url: "/api/session", cookie: phone.cookie })).json(),
    ).toMatchObject({
      signedIn: true,
    });
  });

  it.each([
    ["an empty object", {}],
    ["a field", { all: true }],
    ["a string", JSON.stringify("bye")],
    ["a number", "1"],
  ])("rejects a body (%s) as 400 validation_failed and keeps the session", async (_label, payload) => {
    const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const res = await logout(cookie, payload);
    expect(res.statusCode).toBe(400);
    expect(envelope(res).code).toBe("validation_failed");
    expect((await send(app, { method: "GET", url: "/api/session", cookie })).json()).toMatchObject({
      signedIn: true,
    });
  });

  it("is 403 bad_origin without an Origin, and the session stays", async () => {
    const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const res = await logout(cookie, undefined, null);
    expect(res.statusCode).toBe(403);
    expect((await send(app, { method: "GET", url: "/api/session", cookie })).json()).toMatchObject({
      signedIn: true,
    });
  });

  it("is on the global limit, not the auth one", async () => {
    expect((await logout()).headers["x-ratelimit-limit"]).toBe("100");
  });
});
