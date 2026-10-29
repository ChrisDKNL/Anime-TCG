import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { createDb } from "../../src/db/client.js";
import { sessions } from "../../src/db/schema.js";
import { hashSessionId, newSessionId } from "../../src/domain/session/ids.js";
import { SESSION_ABSOLUTE_LIFETIME_MS } from "../../src/domain/session/policy.js";
import {
  clearAccountData,
  cookieHeader,
  createTestApp,
  insertAccount,
  registerProbeRoutes,
  sessionCookieFrom,
  TEST_SESSION_SECRET,
  WEB_ORIGIN,
} from "../support.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * T3 adversarial cases for sessions (docs/05-security.md): tampering,
 * fixation, replay after logout, rotation on sign-in, the absolute lifetime
 * and the blast radius of ending an account's sessions.
 */
describe("session cookie, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
    registerProbeRoutes(app);
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  async function signIn(accountId?: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/test/sessions",
      query: accountId === undefined ? {} : { accountId },
      headers: { origin: WEB_ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    const value = sessionCookieFrom(res.headers["set-cookie"]);
    if (value === undefined) throw new Error("no session cookie was set");
    return value;
  }

  async function rowExists(cookieValue: string): Promise<boolean> {
    const id = hashSessionId(TEST_SESSION_SECRET, cookieValue);
    const rows = await app.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id));
    return rows.length === 1;
  }

  async function whoami(cookieValue: string) {
    const res = await app.inject({
      method: "GET",
      url: "/test/whoami",
      headers: { cookie: cookieHeader(cookieValue) },
    });
    return res.json<{ session: unknown }>().session;
  }

  it("a flipped character in a live cookie resolves no session", async () => {
    const real = await signIn();
    expect(await whoami(real)).not.toBeNull();
    const last = real.at(-1);
    const flipped = `${real.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    expect(await whoami(flipped)).toBeNull();
    const middle = `${real.slice(0, 20)}${real[20] === "x" ? "y" : "x"}${real.slice(21)}`;
    expect(await whoami(middle)).toBeNull();
  });

  it("a cookie of the wrong length resolves no session", async () => {
    const real = await signIn();
    expect(await whoami(real.slice(0, 42))).toBeNull();
    expect(await whoami(`${real}A`)).toBeNull();
    expect(await whoami("")).toBeNull();
  });

  it("a cookie with characters outside base64url resolves no session", async () => {
    await signIn();
    expect(await whoami(`${"A".repeat(41)}+/`)).toBeNull();
    expect(await whoami(`${"A".repeat(42)}=`)).toBeNull();
    expect(await whoami(`${"A".repeat(40)}%2B`)).toBeNull();
    expect(await whoami(`${"A".repeat(42)}'`)).toBeNull();
  });

  it("malformed cookies never reach the database", async () => {
    const dead = await createTestApp({ db: createDb("postgres://anime:anime@127.0.0.1:1/anime") });
    registerProbeRoutes(dead);
    try {
      for (const value of ["garbage", "A".repeat(42), `${"A".repeat(41)}+/`]) {
        const res = await dead.inject({
          method: "GET",
          url: "/test/whoami",
          headers: { cookie: cookieHeader(value) },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ session: null });
      }
      // A well-formed one does, and a dead database fails closed rather than silently signing out.
      const res = await dead.inject({
        method: "GET",
        url: "/test/whoami",
        headers: { cookie: cookieHeader(newSessionId()) },
      });
      expect(res.statusCode).toBe(500);
    } finally {
      await dead.close();
    }
  });

  it("session fixation: a client-supplied id is never adopted as the new session", async () => {
    const supplied = newSessionId();
    const res = await app.inject({
      method: "POST",
      url: "/test/sessions",
      headers: { origin: WEB_ORIGIN, cookie: cookieHeader(supplied) },
    });
    expect(res.statusCode).toBe(200);
    const issued = sessionCookieFrom(res.headers["set-cookie"]);
    expect(issued).toBeDefined();
    expect(issued).not.toBe(supplied);
    expect(await whoami(supplied)).toBeNull();
    expect(await whoami(issued ?? "")).not.toBeNull();
  });

  it("replay after logout: a destroyed session's cookie is dead", async () => {
    const value = await signIn();
    await app.inject({
      method: "DELETE",
      url: "/test/sessions",
      headers: { origin: WEB_ORIGIN, cookie: cookieHeader(value) },
    });
    expect(await whoami(value)).toBeNull();
    const again = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: cookieHeader(value) },
    });
    expect(again.json()).toEqual({ signedIn: false });
  });

  it("two sessions do not see each other", async () => {
    const a = await signIn();
    const b = await signIn();
    const [sa, sb] = [await whoami(a), await whoami(b)];
    expect(sa).not.toEqual(sb);
    expect(await whoami(a)).toEqual(sa);
  });

  it("rotation on sign-in: the live session fixed before createSession is destroyed, not promoted", async () => {
    const planted = await signIn();
    expect(await whoami(planted)).not.toBeNull();

    const accountId = await insertAccount(app.db, "rotated");
    const res = await app.inject({
      method: "POST",
      url: "/test/sessions",
      query: { accountId },
      headers: { origin: WEB_ORIGIN, cookie: cookieHeader(planted) },
    });
    expect(res.statusCode).toBe(200);
    const issued = sessionCookieFrom(res.headers["set-cookie"]);
    expect(issued).toBeDefined();
    expect(issued).not.toBe(planted);
    // One Set-Cookie line, the new one: the browser never sees a clear followed by a set.
    expect([res.headers["set-cookie"]].flat().filter((line) => line !== undefined)).toHaveLength(1);

    expect(await whoami(planted)).toBeNull();
    expect(await rowExists(planted)).toBe(false);
    expect(await whoami(issued ?? "")).toEqual({
      id: hashSessionId(TEST_SESSION_SECRET, issued ?? ""),
      accountId,
    });
    expect(await app.db.select({ id: sessions.id }).from(sessions)).toHaveLength(1);
    const signedOut = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: cookieHeader(planted) },
    });
    expect(signedOut.json()).toEqual({ signedIn: false });
  });

  it("absolute lifetime: constant activity cannot keep a session alive past 90 days", async () => {
    const value = await signIn(await insertAccount(app.db, "longlived"));
    const id = hashSessionId(TEST_SESSION_SECRET, value);
    const now = Date.now();
    // As an attacker who touches the session every few minutes would leave it: fresh expiry, recent activity.
    await app.db
      .update(sessions)
      .set({
        createdAt: new Date(now - SESSION_ABSOLUTE_LIFETIME_MS - DAY_MS),
        lastSeenAt: new Date(now),
        expiresAt: new Date(now + 29 * DAY_MS),
      })
      .where(eq(sessions.id, id));

    expect(await whoami(value)).toBeNull();
    expect(await rowExists(value)).toBe(true);
    expect(await app.sessions.purgeExpired(new Date())).toBe(1);
    expect(await rowExists(value)).toBe(false);
  });

  it("destroyAllForAccount ends exactly that account's sessions and keeps the excepted one", async () => {
    const victim = await insertAccount(app.db, "victim");
    const bystander = await insertAccount(app.db, "bystander");
    const [current, laptop, phone, other, anonymous] = await Promise.all([
      signIn(victim),
      signIn(victim),
      signIn(victim),
      signIn(bystander),
      signIn(),
    ]);
    const currentId = hashSessionId(TEST_SESSION_SECRET, current);

    expect(await app.sessions.destroyAllForAccount(victim, currentId)).toBe(2);
    expect(await whoami(current)).toEqual({ id: currentId, accountId: victim });
    expect(await whoami(laptop)).toBeNull();
    expect(await whoami(phone)).toBeNull();
    expect(await rowExists(laptop)).toBe(false);
    expect(await rowExists(phone)).toBe(false);
    expect(await whoami(other)).toEqual({
      id: hashSessionId(TEST_SESSION_SECRET, other),
      accountId: bystander,
    });
    expect(await whoami(anonymous)).not.toBeNull();

    // Without an exception (the owner's CLI reset) the current one goes too; nobody else is touched.
    expect(await app.sessions.destroyAllForAccount(victim)).toBe(1);
    expect(await whoami(current)).toBeNull();
    expect(await app.sessions.destroyAllForAccount(victim)).toBe(0);
    expect(await app.sessions.destroyAllForAccount("00000000-0000-4000-8000-000000000000")).toBe(0);
    expect(await app.db.select({ id: sessions.id }).from(sessions)).toHaveLength(2);
  });

  it("a cookie sent to a session-creating route cannot be reflected in the response", async () => {
    const hostile = `${"A".repeat(43)}; Path=/; Domain=evil.example`;
    const res = await app.inject({
      method: "POST",
      url: "/test/sessions",
      headers: { origin: WEB_ORIGIN, cookie: cookieHeader(hostile) },
    });
    expect(String(res.headers["set-cookie"])).not.toContain("evil.example");
    expect(String(res.headers["set-cookie"])).not.toContain("A".repeat(43));
  });
});
