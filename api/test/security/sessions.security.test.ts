import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { createDb } from "../../src/db/client.js";
import { newSessionId } from "../../src/domain/session/ids.js";
import {
  clearSessions,
  cookieHeader,
  createTestApp,
  registerProbeRoutes,
  sessionCookieFrom,
  WEB_ORIGIN,
} from "../support.js";

/** T3 adversarial cases for sessions (docs/05-security.md): tampering, fixation, replay after logout. */
describe("session cookie, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
    registerProbeRoutes(app);
  });
  beforeEach(() => clearSessions(app.db));
  afterAll(() => app.close());

  async function signIn(): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/test/sessions", headers: { origin: WEB_ORIGIN } });
    const value = sessionCookieFrom(res.headers["set-cookie"]);
    if (value === undefined) throw new Error("no session cookie was set");
    return value;
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
