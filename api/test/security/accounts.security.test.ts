import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { createDb } from "../../src/db/client.js";
import { accounts, authThrottle, sessions } from "../../src/db/schema.js";
import { DUMMY_HASH, verifyPassword } from "../../src/domain/accounts/password.js";
import { THROTTLE_BLOCK_MS, THROTTLE_MAX_FAILURES } from "../../src/domain/accounts/throttle.js";
import { hashSessionId, newSessionId } from "../../src/domain/session/ids.js";
import { SESSION_TTL_MS } from "../../src/domain/session/policy.js";
import {
  type Call,
  clearAccountData,
  createTestApp,
  loginAccount,
  migrationsDatabaseUrl,
  registerAccount,
  registerProbeRoutes,
  send,
  sessionCookieFrom,
  TEST_INVITE_CODES,
  TEST_SESSION_SECRET,
  testConfig,
  UNKNOWN_INVITE_CODE,
} from "../support.js";

/**
 * Test plan: T3 adversarial suite for the accounts api (docs/design/accounts-api.md §9
 * "Adversarial", docs/05-security.md C3-C7, C17, C18). The route tests prove the routes do
 * what the engineer meant; this file attacks them the way a player with a browser would.
 *
 * Sessions (C5)
 * - Fixation: a pre-auth cookie planted before login or register, and a value the server never
 *   issued, are never promoted; afterwards they resolve to signedIn:false and their rows are gone.
 * - Password change: of three live sessions the other two die, the current one is rotated to a
 *   new live cookie, and exactly one row remains for the account.
 * - Delete: every session row of the account is gone and every cookie dead; a bystander's lives.
 * - Forged, flipped, truncated and garbage cookies on every account route: 401, cookie cleared,
 *   nothing changed. Logout with a cookie of a deleted account is still 204.
 * - An account removed straight in the database (owner pool): its cookie is signed out and the
 *   row is gone (the FK cascade of the migration, not just of the Drizzle schema).
 * - The cookie after login and after register carries exactly the 1a flags.
 *
 * Throttle (C17)
 * - Five misses on one api instance block the login on a second instance over the same database.
 * - retryAfterSeconds is an integer in 1..10, never grows across blocked attempts, equals the
 *   Retry-After header, and a blocked attempt does not extend the breather or sign anyone in.
 * - An unknown login is throttled exactly like a known one (no enumeration through the breather).
 * - change-password and delete: five wrong passwords block them, and the right password while
 *   blocked is refused without the hash or the row changing.
 *
 * Timing (C18)
 * - Median response time of a wrong password for a known login versus an unknown login: within
 *   tolerance of each other and both at least the cost of one Argon2id derivation.
 * - A 1000-character password is a 400 in far less than one derivation (no CPU spent).
 * - check-invite with an invalid code versus a valid code at the cap: same median, both far
 *   below one derivation (both refuse before any slow work).
 *
 * Invite codes (C18)
 * - Case and whitespace variants of a valid code are accepted by check-invite and register; one
 *   extra character, an inner space and whitespace-only are 403; empty is 400.
 * - Without a valid code, register never reveals whether a login is taken.
 *
 * Logins as text
 * - RTL overrides, zero-width characters and HTML round-trip byte-identical as JSON text and stay
 *   unique case-insensitively, through register, GET /api/session and rename.
 * - U+0000 in a login is 400 validation_failed on register, rename and login, never a 500.
 *
 * Authorisation (C3)
 * - Naming another account in the body (accountId, id) is a 400 and in the path a 404; a query
 *   string naming it is ignored; the other account is untouched every time.
 * - A wrong password for a known login and an unknown login give byte-identical 401s.
 * - A registration refused for a taken login leaves no account, no session, no throttle row.
 * - Two accounts renaming to the same login at once: exactly one 200, one 409, one row.
 * - At the cap, check-invite is 403 cap_reached even for a valid code.
 *
 * Every response body this file receives is kept and grepped at the end for password_hash,
 * login_normalized, invite_code_hash, the Argon2 prefix, and the passwords themselves.
 *
 * Timing bounds: two medians count as equal when the slower is under twice the faster, or
 * within TIMING_NOISE_MS when both are tiny (so a 2 ms versus 3 ms count query is not a failure).
 * "At least one derivation" is half the fastest derivation measured in the same process, which
 * allows for CPU frequency scaling between the probe and the requests while still being far
 * from the near-zero a missing dummy verification would show.
 */

const PASSWORD = "correct horse battery";
const OTHER_PASSWORD = "another fine password";
const UNKNOWN_LOGIN = "nobody-here";
/** Spec §4.2: the cookie's Max-Age is 30 days, pinned as the literal the 1a flags promise. */
const SPEC_MAX_AGE_SECONDS = 2_592_000;
const COOKIE_LINE = new RegExp(
  `^__Host-session=[A-Za-z0-9_-]{43}; Max-Age=${SPEC_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax$`,
);
const CLEARED_LINE =
  /^__Host-session=; Max-Age=0; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax$/;
const BLOCK_SECONDS = THROTTLE_BLOCK_MS / 1000;

/** Alternating attempts per side for a median; the spec asks for at least 15. */
const TIMING_SAMPLES = 20;
/** Requests on a path that must be fast; a median of five rides out one scheduler hiccup. */
const FAST_PATH_SAMPLES = 5;
/** Argon2id verifications measured directly to calibrate "one derivation" on this machine. */
const DERIVATION_SAMPLES = 5;
/** Absolute allowance between two medians that should be equal; above the jitter of a loopback database query. */
const TIMING_NOISE_MS = 25;
/** A route that pays for one derivation can only be faster than the probe by frequency scaling, never by half. */
const DERIVATION_FLOOR_SHARE = 0.5;
/** Blocked attempts in a row while the breather lasts. */
const BLOCKED_ATTEMPTS = 6;

/** Every response body this file received, so the last test can prove nothing secret ever left the api. */
const bodies: string[] = [];

function envelope(res: LightMyRequestResponse): {
  code: string;
  message: string;
  retryAfterSeconds?: number;
} {
  return res.json<{ error: { code: string; message: string; retryAfterSeconds?: number } }>().error;
}

async function call(app: App, c: Call): Promise<LightMyRequestResponse> {
  const res = await send(app, c);
  bodies.push(res.body);
  return res;
}

const login = (app: App, payload: unknown, cookie?: string) =>
  call(app, { method: "POST", url: "/api/session/login", payload, cookie });
const register = (app: App, payload: unknown, cookie?: string) =>
  call(app, { method: "POST", url: "/api/accounts/register", payload, cookie });
const checkInvite = (app: App, inviteCode: unknown) =>
  call(app, { method: "POST", url: "/api/accounts/check-invite", payload: { inviteCode } });
const rename = (app: App, cookie: string | undefined, payload: unknown, url = "/api/account/login") =>
  call(app, { method: "PATCH", url, cookie, payload });
const changePassword = (app: App, cookie: string | undefined, payload: unknown) =>
  call(app, { method: "POST", url: "/api/account/change-password", cookie, payload });
const deleteAccount = (app: App, cookie: string | undefined, payload: unknown) =>
  call(app, { method: "POST", url: "/api/account/delete", cookie, payload });
const whoami = (app: App, cookie: string) => call(app, { method: "GET", url: "/api/session", cookie });
const logout = (app: App, cookie: string) =>
  call(app, { method: "POST", url: "/api/session/logout", cookie });

async function rowExists(app: App, cookieValue: string): Promise<boolean> {
  const id = hashSessionId(TEST_SESSION_SECRET, cookieValue);
  const rows = await app.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id));
  return rows.length === 1;
}

function sessionRowsOf(app: App, accountId: string) {
  return app.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.accountId, accountId));
}

/** A session with no account, as a future pre-auth flow would leave in the browser before sign-in. */
async function preAuthCookie(app: App): Promise<string> {
  const res = await send(app, { method: "POST", url: "/test/sessions" });
  expect(res.statusCode).toBe(200);
  const value = sessionCookieFrom(res.headers["set-cookie"]);
  if (value === undefined) throw new Error("no pre-auth cookie was set");
  return value;
}

function setCookieLines(res: LightMyRequestResponse): string[] {
  return [res.headers["set-cookie"]].flat().filter((line): line is string => line !== undefined);
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + upper) / 2 : upper;
}

async function elapsedMs(run: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await run();
  return performance.now() - start;
}

/** The fastest of a few Argon2id verifications in this process: nothing that pays for one can be much quicker. */
async function derivationFloorMs(): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < DERIVATION_SAMPLES; i += 1) {
    samples.push(await elapsedMs(() => verifyPassword("timing probe", DUMMY_HASH)));
  }
  return Math.min(...samples);
}

/** Two medians that should be equal: the slower under twice the faster, or within the noise allowance. */
function expectSameTiming(a: number, b: number): void {
  const faster = Math.min(a, b);
  const slower = Math.max(a, b);
  expect(slower - faster, `medians ${a.toFixed(1)} ms and ${b.toFixed(1)} ms`).toBeLessThan(
    Math.max(faster, TIMING_NOISE_MS),
  );
}

function swapCase(text: string): string {
  return text === text.toUpperCase() ? text.toLowerCase() : text.toUpperCase();
}

describe("sessions, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
    registerProbeRoutes(app);
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  it("login: a planted pre-auth cookie and a never-issued value are not promoted and are unknown afterwards", async () => {
    await registerAccount(app, { login: "Chris", password: PASSWORD });
    const planted = await preAuthCookie(app);
    const forged = newSessionId();

    for (const cookie of [planted, forged]) {
      const res = await login(app, { login: "Chris", password: PASSWORD }, cookie);
      expect(res.statusCode).toBe(200);
      expect(setCookieLines(res)).toHaveLength(1);
      const issued = sessionCookieFrom(res.headers["set-cookie"]);
      expect(issued).toBeDefined();
      expect(issued).not.toBe(cookie);
      expect((await whoami(app, cookie)).json()).toEqual({ signedIn: false });
      expect(await rowExists(app, cookie)).toBe(false);
      expect((await whoami(app, issued ?? "")).json()).toMatchObject({
        signedIn: true,
        account: { login: "Chris" },
      });
    }
  });

  it("register: a planted pre-auth cookie and a never-issued value are not promoted and are unknown afterwards", async () => {
    const planted = await preAuthCookie(app);
    const forged = newSessionId();

    for (const [cookie, loginName] of [
      [planted, "first"],
      [forged, "second"],
    ] as const) {
      const res = await register(
        app,
        { inviteCode: TEST_INVITE_CODES[0], login: loginName, password: PASSWORD },
        cookie,
      );
      expect(res.statusCode).toBe(201);
      expect(setCookieLines(res)).toHaveLength(1);
      const issued = sessionCookieFrom(res.headers["set-cookie"]);
      expect(issued).toBeDefined();
      expect(issued).not.toBe(cookie);
      expect((await whoami(app, cookie)).json()).toEqual({ signedIn: false });
      expect(await rowExists(app, cookie)).toBe(false);
      expect((await whoami(app, issued ?? "")).json()).toMatchObject({
        signedIn: true,
        account: { login: loginName },
      });
    }
  });

  it("changing the password ends the other two sessions, rotates the current one and leaves one row", async () => {
    const laptop = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const phone = await loginAccount(app, { login: "Chris", password: PASSWORD });
    const tablet = await loginAccount(app, { login: "Chris", password: PASSWORD });
    expect(await sessionRowsOf(app, laptop.account.id)).toHaveLength(3);

    const res = await changePassword(app, laptop.cookie, {
      currentPassword: PASSWORD,
      newPassword: OTHER_PASSWORD,
    });
    expect(res.statusCode).toBe(204);
    expect(setCookieLines(res)).toHaveLength(1);
    expect(setCookieLines(res)[0]).toMatch(COOKIE_LINE);
    const rotated = sessionCookieFrom(res.headers["set-cookie"]);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(laptop.cookie);

    for (const dead of [laptop.cookie, phone.cookie, tablet.cookie]) {
      expect((await whoami(app, dead)).json()).toEqual({ signedIn: false });
      expect(await rowExists(app, dead)).toBe(false);
    }
    expect((await whoami(app, rotated ?? "")).json()).toEqual({
      signedIn: true,
      account: laptop.account,
    });
    expect(await sessionRowsOf(app, laptop.account.id)).toEqual([
      { id: hashSessionId(TEST_SESSION_SECRET, rotated ?? "") },
    ]);
  });

  it("deleting the account removes every one of its sessions and none of anyone else's", async () => {
    const bystander = await registerAccount(app, { login: "Other", password: PASSWORD });
    const victim = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const phone = await loginAccount(app, { login: "Chris", password: PASSWORD });
    const tablet = await loginAccount(app, { login: "Chris", password: PASSWORD });
    expect(await sessionRowsOf(app, victim.account.id)).toHaveLength(3);

    const res = await deleteAccount(app, victim.cookie, { password: PASSWORD });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(CLEARED_LINE);

    expect(await sessionRowsOf(app, victim.account.id)).toEqual([]);
    for (const dead of [victim.cookie, phone.cookie, tablet.cookie]) {
      const after = await whoami(app, dead);
      expect(after.json()).toEqual({ signedIn: false });
      expect(String(after.headers["set-cookie"])).toMatch(CLEARED_LINE);
    }
    expect((await whoami(app, bystander.cookie)).json()).toEqual({
      signedIn: true,
      account: bystander.account,
    });
    expect(await app.db.select({ id: sessions.id }).from(sessions)).toEqual([
      { id: hashSessionId(TEST_SESSION_SECRET, bystander.cookie) },
    ]);
  });

  const accountCalls: [string, (cookie: string) => Promise<LightMyRequestResponse>][] = [
    ["PATCH /api/account/login", (cookie) => rename(app, cookie, { login: "Hijacked" })],
    [
      "POST /api/account/change-password",
      (cookie) => changePassword(app, cookie, { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD }),
    ],
    ["POST /api/account/delete", (cookie) => deleteAccount(app, cookie, { password: PASSWORD })],
  ];

  it.each(accountCalls)(
    "%s with a forged, flipped, truncated or garbage cookie is 401, clears the cookie and changes nothing",
    async (_label, run) => {
      const { cookie, account } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const last = cookie.at(-1);
      const flipped = `${cookie.slice(0, -1)}${last === "A" ? "B" : "A"}`;
      // A live value with attributes appended is not a forgery: the Cookie parser reads the
      // live value and two unrelated cookies, so that case lives in sessions.security.test.ts
      // as a Set-Cookie reflection check instead.
      const forgeries = [
        "garbage",
        newSessionId(),
        flipped,
        cookie.slice(0, -1),
        `${cookie}A`,
        `${"A".repeat(41)}+/`,
      ];
      for (const forged of forgeries) {
        const res = await run(forged);
        expect(res.statusCode, forged).toBe(401);
        expect(envelope(res)).toEqual({ code: "unauthenticated", message: "Sign in first" });
        expect(String(res.headers["set-cookie"])).toMatch(CLEARED_LINE);
      }
      expect((await whoami(app, cookie)).json()).toEqual({ signedIn: true, account });
      expect(await app.db.select({ login: accounts.login }).from(accounts)).toEqual([{ login: "Chris" }]);
      // The password is still the old one, so the change-password attempts went nowhere.
      expect((await loginAccount(app, { login: "Chris", password: PASSWORD })).account).toEqual(account);
    },
  );

  it("logging out with the cookie of a deleted account is still a 204 that clears the cookie", async () => {
    const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    expect((await deleteAccount(app, cookie, { password: PASSWORD })).statusCode).toBe(204);
    const res = await logout(app, cookie);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(String(res.headers["set-cookie"])).toMatch(CLEARED_LINE);
    expect(await app.db.select().from(sessions)).toEqual([]);
  });

  it("a session whose account was removed in the database is signed out, its row gone, and account routes refuse it", async () => {
    const { cookie, account } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const owner = createDb(migrationsDatabaseUrl());
    try {
      await owner.delete(accounts).where(eq(accounts.id, account.id));
    } finally {
      await owner.$client.end();
    }
    const res = await whoami(app, cookie);
    expect(res.json()).toEqual({ signedIn: false });
    expect(String(res.headers["set-cookie"])).toMatch(CLEARED_LINE);
    expect(await rowExists(app, cookie)).toBe(false);
    const renamed = await rename(app, cookie, { login: "Ghost" });
    expect(renamed.statusCode).toBe(401);
    expect(envelope(renamed).code).toBe("unauthenticated");
    expect(await app.db.select().from(accounts)).toEqual([]);
  });

  it("the cookie after register and after login carries exactly the 1a flags", async () => {
    expect(SPEC_MAX_AGE_SECONDS * 1000).toBe(SESSION_TTL_MS);
    const registered = await register(app, {
      inviteCode: TEST_INVITE_CODES[0],
      login: "Chris",
      password: PASSWORD,
    });
    expect(registered.statusCode).toBe(201);
    expect(setCookieLines(registered)).toHaveLength(1);
    expect(setCookieLines(registered)[0]).toMatch(COOKIE_LINE);

    const signedIn = await login(app, { login: "Chris", password: PASSWORD });
    expect(signedIn.statusCode).toBe(200);
    expect(setCookieLines(signedIn)).toHaveLength(1);
    expect(setCookieLines(signedIn)[0]).toMatch(COOKIE_LINE);
    expect(sessionCookieFrom(signedIn.headers["set-cookie"])).not.toBe(
      sessionCookieFrom(registered.headers["set-cookie"]),
    );
  });
});

describe("sign-in breather, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await clearAccountData(app.db);
    await registerAccount(app, { login: "Chris", password: PASSWORD });
  });
  afterAll(() => app.close());

  async function missFiveTimes(loginName: string): Promise<void> {
    for (let i = 0; i < THROTTLE_MAX_FAILURES; i += 1) {
      expect((await login(app, { login: loginName, password: "wrong" })).statusCode).toBe(401);
    }
  }

  function expectBlocked(res: LightMyRequestResponse): number {
    expect(res.statusCode).toBe(429);
    const { code, message, retryAfterSeconds } = envelope(res);
    expect({ code, message }).toEqual({
      code: "too_many_failures",
      message: "Too many wrong passwords; wait a moment",
    });
    expect(Number.isInteger(retryAfterSeconds)).toBe(true);
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retryAfterSeconds).toBeLessThanOrEqual(BLOCK_SECONDS);
    expect(res.headers["retry-after"]).toBe(String(retryAfterSeconds));
    expect(res.headers["set-cookie"]).toBeUndefined();
    return retryAfterSeconds ?? 0;
  }

  it("five misses on one api instance block the login on a second instance over the same database", async () => {
    await missFiveTimes("Chris");
    const second = await createTestApp();
    try {
      const res = await call(second, {
        method: "POST",
        url: "/api/session/login",
        payload: { login: "Chris", password: PASSWORD },
      });
      expectBlocked(res);
    } finally {
      await second.close();
    }
  });

  it("retryAfterSeconds stays in 1..10 and never grows across blocked attempts, which neither extend the breather nor sign in", async () => {
    await missFiveTimes("Chris");
    const [before] = await app.db.select().from(authThrottle);
    const sessionsBefore = await app.db.select({ id: sessions.id }).from(sessions);

    let previous = BLOCK_SECONDS;
    for (let i = 0; i < BLOCKED_ATTEMPTS; i += 1) {
      // Right and wrong passwords alike: while blocked nothing is looked at.
      const res = await login(app, { login: "Chris", password: i % 2 === 0 ? PASSWORD : "wrong" });
      const wait = expectBlocked(res);
      expect(wait).toBeLessThanOrEqual(previous);
      previous = wait;
    }
    expect(await app.db.select().from(authThrottle)).toEqual([before]);
    expect(await app.db.select({ id: sessions.id }).from(sessions)).toEqual(sessionsBefore);
  });

  it("an unknown login is throttled exactly like a known one, so the breather reveals nothing", async () => {
    for (let i = 0; i < THROTTLE_MAX_FAILURES; i += 1) {
      const known = await login(app, { login: "Chris", password: "wrong" });
      const unknown = await login(app, { login: UNKNOWN_LOGIN, password: "wrong" });
      expect(known.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(unknown.body).toBe(known.body);
    }
    const knownBlocked = await login(app, { login: "Chris", password: PASSWORD });
    const unknownBlocked = await login(app, { login: UNKNOWN_LOGIN, password: PASSWORD });
    expectBlocked(knownBlocked);
    expectBlocked(unknownBlocked);
    expect(envelope(unknownBlocked).code).toBe(envelope(knownBlocked).code);
    expect(
      await app.db.select({ key: authThrottle.key }).from(authThrottle).orderBy(authThrottle.key),
    ).toEqual([{ key: "chris" }, { key: UNKNOWN_LOGIN }]);
  });

  it("change-password: five wrong current passwords block it, and the right one while blocked leaves the hash untouched", async () => {
    const { cookie } = await loginAccount(app, { login: "Chris", password: PASSWORD });
    const [before] = await app.db
      .select({ passwordHash: accounts.passwordHash, updatedAt: accounts.updatedAt })
      .from(accounts);
    for (let i = 0; i < THROTTLE_MAX_FAILURES; i += 1) {
      const miss = await changePassword(app, cookie, {
        currentPassword: "wrong",
        newPassword: OTHER_PASSWORD,
      });
      expect(miss.statusCode).toBe(403);
      expect(envelope(miss).code).toBe("wrong_password");
    }
    const blocked = await changePassword(app, cookie, {
      currentPassword: PASSWORD,
      newPassword: OTHER_PASSWORD,
    });
    expectBlocked(blocked);
    expect(
      await app.db
        .select({ passwordHash: accounts.passwordHash, updatedAt: accounts.updatedAt })
        .from(accounts),
    ).toEqual([before]);
    // The session the attempts rode on is still live: a breather is not a sign-out.
    expect((await whoami(app, cookie)).json()).toMatchObject({ signedIn: true });
  });

  it("delete: five wrong passwords block it, and the right one while blocked leaves the account and its sessions", async () => {
    const { cookie, account } = await loginAccount(app, { login: "Chris", password: PASSWORD });
    for (let i = 0; i < THROTTLE_MAX_FAILURES; i += 1) {
      const miss = await deleteAccount(app, cookie, { password: "wrong" });
      expect(miss.statusCode).toBe(403);
      expect(envelope(miss).code).toBe("wrong_password");
    }
    const blocked = await deleteAccount(app, cookie, { password: PASSWORD });
    expectBlocked(blocked);
    expect(await app.db.select({ id: accounts.id }).from(accounts)).toEqual([{ id: account.id }]);
    expect(await sessionRowsOf(app, account.id)).toHaveLength(2);
    expect((await whoami(app, cookie)).json()).toEqual({ signedIn: true, account });
  });
});

describe("timing, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await clearAccountData(app.db);
    await registerAccount(app, { login: "Chris", password: PASSWORD });
  });
  afterAll(() => app.close());

  it("a wrong password for a known login and an unknown login cost the same, and both cost one derivation", async () => {
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < TIMING_SAMPLES; i += 1) {
      // Every miss counts toward the breather; cleared between samples so the fifth does not become a fast 429.
      await app.db.delete(authThrottle);
      known.push(
        await elapsedMs(async () => {
          expect((await login(app, { login: "Chris", password: "wrong" })).statusCode).toBe(401);
        }),
      );
      await app.db.delete(authThrottle);
      unknown.push(
        await elapsedMs(async () => {
          expect((await login(app, { login: UNKNOWN_LOGIN, password: "wrong" })).statusCode).toBe(401);
        }),
      );
    }
    const floor = await derivationFloorMs();
    const knownMedian = median(known);
    const unknownMedian = median(unknown);
    expect(
      knownMedian,
      `known ${knownMedian.toFixed(1)} ms, derivation ${floor.toFixed(1)} ms`,
    ).toBeGreaterThan(floor * DERIVATION_FLOOR_SHARE);
    expect(
      unknownMedian,
      `unknown ${unknownMedian.toFixed(1)} ms, derivation ${floor.toFixed(1)} ms`,
    ).toBeGreaterThan(floor * DERIVATION_FLOOR_SHARE);
    expectSameTiming(knownMedian, unknownMedian);
  });

  it("a 1000-character password is a 400 on login and register in far less than one derivation", async () => {
    const oversized = "x".repeat(1000);
    const samples: number[] = [];
    for (let i = 0; i < FAST_PATH_SAMPLES; i += 1) {
      samples.push(
        await elapsedMs(async () => {
          const res = await login(app, { login: "Chris", password: oversized });
          expect(res.statusCode).toBe(400);
          expect(envelope(res).code).toBe("validation_failed");
        }),
      );
      samples.push(
        await elapsedMs(async () => {
          const res = await register(app, {
            inviteCode: TEST_INVITE_CODES[0],
            login: "Newcomer",
            password: oversized,
          });
          expect(res.statusCode).toBe(400);
          expect(envelope(res).code).toBe("validation_failed");
        }),
      );
    }
    const floor = await derivationFloorMs();
    const fast = median(samples);
    expect(fast, `400 median ${fast.toFixed(1)} ms, derivation ${floor.toFixed(1)} ms`).toBeLessThan(
      floor * DERIVATION_FLOOR_SHARE,
    );
    expect(await app.db.select().from(authThrottle)).toEqual([]);
    expect(await app.db.select({ login: accounts.login }).from(accounts)).toEqual([{ login: "Chris" }]);
  });
});

describe("invite codes, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  const [first, second] = TEST_INVITE_CODES;

  it.each([
    ["upper case", first.toUpperCase()],
    ["lower case", first.toLowerCase()],
    ["surrounding spaces", `  ${first}  `],
    ["a tab and a newline around it", `\t${first}\n`],
    ["the second code, mixed case and padded", ` ${swapCase(second)} `],
  ])("accepts a valid code written with %s on check-invite and register", async (_label, inviteCode) => {
    expect((await checkInvite(app, inviteCode)).statusCode).toBe(204);
    const res = await register(app, { inviteCode, login: "Chris", password: PASSWORD });
    expect(res.statusCode).toBe(201);
  });

  it.each([
    ["one character appended", `${first}x`],
    ["one character prepended", `x${first}`],
    ["one character dropped", first.slice(0, -1)],
    ["an inner space", `${first.slice(0, 5)} ${first.slice(5)}`],
    ["whitespace only", " \t "],
    ["an unknown code", UNKNOWN_INVITE_CODE],
  ])(
    "refuses a code with %s as 403 invite_invalid on both routes, writing nothing",
    async (_label, inviteCode) => {
      const checked = await checkInvite(app, inviteCode);
      expect(checked.statusCode).toBe(403);
      expect(envelope(checked)).toEqual({ code: "invite_invalid", message: "That invite code is not valid" });
      const registered = await register(app, { inviteCode, login: "Chris", password: PASSWORD });
      expect(registered.statusCode).toBe(403);
      expect(envelope(registered).code).toBe("invite_invalid");
      expect(registered.headers["set-cookie"]).toBeUndefined();
      expect(await app.db.select().from(accounts)).toEqual([]);
      expect(await app.db.select().from(sessions)).toEqual([]);
    },
  );

  it("an empty code is a 400 on both routes", async () => {
    const checked = await checkInvite(app, "");
    expect(checked.statusCode).toBe(400);
    expect(envelope(checked).code).toBe("validation_failed");
    const registered = await register(app, { inviteCode: "", login: "Chris", password: PASSWORD });
    expect(registered.statusCode).toBe(400);
    expect(envelope(registered).code).toBe("validation_failed");
    expect(await app.db.select().from(accounts)).toEqual([]);
  });

  it("without a valid code, register does not reveal whether a login is taken", async () => {
    await registerAccount(app, { login: "Chris", password: PASSWORD });
    const taken = await register(app, {
      inviteCode: UNKNOWN_INVITE_CODE,
      login: "chris",
      password: PASSWORD,
    });
    const free = await register(app, {
      inviteCode: UNKNOWN_INVITE_CODE,
      login: "nobody",
      password: PASSWORD,
    });
    expect(taken.statusCode).toBe(403);
    expect(free.statusCode).toBe(403);
    expect(taken.body).toBe(free.body);
    expect(envelope(taken).code).toBe("invite_invalid");
  });
});

describe("logins as text, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  it.each([
    ["an RTL override", "‮evil‬"],
    ["zero-width spaces", "a​b​c"],
    ["a zero-width joiner and non-joiner", "ab‍‌cd"],
    ["an HTML element", "<b onclick=x>b</b>"],
    ["a script element", "<script>x</script>"],
    ["an SQL-looking value", "'; drop table a;--"],
  ])(
    "%s round-trips byte-identical as JSON text through register, the session and rename, and stays unique",
    async (_label, hostile) => {
      // None of these need JSON escaping, so the bytes in the body are the bytes of the login.
      expect(JSON.stringify(hostile)).toBe(`"${hostile}"`);
      const res = await register(app, {
        inviteCode: TEST_INVITE_CODES[0],
        login: hostile,
        password: PASSWORD,
      });
      expect(res.statusCode).toBe(201);
      expect(res.body).toContain(`"login":${JSON.stringify(hostile)}`);
      const cookie = sessionCookieFrom(res.headers["set-cookie"]) ?? "";
      const session = await whoami(app, cookie);
      expect(session.body).toContain(`"login":${JSON.stringify(hostile)}`);

      const duplicate = await register(app, {
        inviteCode: TEST_INVITE_CODES[0],
        login: swapCase(hostile),
        password: PASSWORD,
      });
      expect(duplicate.statusCode).toBe(409);
      expect(envelope(duplicate).code).toBe("login_taken");

      const other = await registerAccount(app, { login: "Other", password: PASSWORD });
      const collision = await rename(app, other.cookie, { login: swapCase(hostile) });
      expect(collision.statusCode).toBe(409);
      const renamed = await rename(app, other.cookie, { login: `${hostile}2` });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.body).toContain(`"login":${JSON.stringify(`${hostile}2`)}`);
      expect(
        await app.db.select({ login: accounts.login }).from(accounts).orderBy(accounts.createdAt),
      ).toEqual([{ login: hostile }, { login: `${hostile}2` }]);
    },
  );

  it("U+0000 in a login is 400 validation_failed on register, rename and login, never a 500", async () => {
    const { cookie, account } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const nul = "ab\u0000c";

    const registered = await register(app, {
      inviteCode: TEST_INVITE_CODES[0],
      login: nul,
      password: PASSWORD,
    });
    expect(registered.statusCode).toBe(400);
    expect(envelope(registered).code).toBe("validation_failed");

    const renamed = await rename(app, cookie, { login: nul });
    expect(renamed.statusCode).toBe(400);
    expect(envelope(renamed).code).toBe("validation_failed");

    const signedIn = await login(app, { login: nul, password: PASSWORD });
    expect(signedIn.statusCode).toBe(400);
    expect(envelope(signedIn).code).toBe("validation_failed");

    expect(await app.db.select().from(authThrottle)).toEqual([]);
    expect((await whoami(app, cookie)).json()).toEqual({ signedIn: true, account });
  });
});

describe("authorisation and enumeration, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  it("naming another account in the body is a 400 on every account route, and that account is untouched", async () => {
    const other = await registerAccount(app, { login: "Other", password: PASSWORD });
    const me = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const attempts: Promise<LightMyRequestResponse>[] = [];
    for (const field of ["accountId", "id"]) {
      const target = { [field]: other.account.id };
      attempts.push(
        rename(app, me.cookie, { login: "Hijacked", ...target }),
        changePassword(app, me.cookie, { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD, ...target }),
        deleteAccount(app, me.cookie, { password: PASSWORD, ...target }),
      );
    }
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode).toBe(400);
      expect(envelope(res)).toEqual({
        code: "validation_failed",
        message: "body must NOT have additional properties",
      });
    }
    expect((await whoami(app, other.cookie)).json()).toEqual({ signedIn: true, account: other.account });
    expect((await whoami(app, me.cookie)).json()).toEqual({ signedIn: true, account: me.account });
    expect((await loginAccount(app, { login: "Other", password: PASSWORD })).account).toEqual(other.account);
    expect(await app.db.select({ id: accounts.id }).from(accounts)).toHaveLength(2);
  });

  it("naming another account in the path is a 404 on every shape, and that account is untouched", async () => {
    const other = await registerAccount(app, { login: "Other", password: PASSWORD });
    const me = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const id = other.account.id;
    const attempts: Call[] = [
      { method: "PATCH", url: `/api/account/login/${id}`, cookie: me.cookie, payload: { login: "Hijacked" } },
      { method: "PATCH", url: `/api/account/${id}/login`, cookie: me.cookie, payload: { login: "Hijacked" } },
      { method: "PATCH", url: `/api/accounts/${id}`, cookie: me.cookie, payload: { login: "Hijacked" } },
      {
        method: "POST",
        url: `/api/account/${id}/delete`,
        cookie: me.cookie,
        payload: { password: PASSWORD },
      },
      {
        method: "POST",
        url: `/api/account/delete/${id}`,
        cookie: me.cookie,
        payload: { password: PASSWORD },
      },
      { method: "DELETE", url: `/api/account/${id}`, cookie: me.cookie },
      { method: "DELETE", url: `/api/accounts/${id}`, cookie: me.cookie },
      { method: "DELETE", url: "/api/account", cookie: me.cookie },
    ];
    for (const attempt of attempts) {
      const res = await call(app, attempt);
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(404);
      expect(envelope(res)).toEqual({ code: "not_found", message: "Route not found" });
    }
    expect((await whoami(app, other.cookie)).json()).toEqual({ signedIn: true, account: other.account });
    expect(await app.db.select({ login: accounts.login }).from(accounts).orderBy(accounts.createdAt)).toEqual(
      [{ login: "Other" }, { login: "Chris" }],
    );
  });

  it("a query string naming another account is ignored: the caller's own account is what changes", async () => {
    const other = await registerAccount(app, { login: "Other", password: PASSWORD });
    const me = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const res = await rename(
      app,
      me.cookie,
      { login: "Renamed" },
      `/api/account/login?accountId=${other.account.id}&id=${other.account.id}`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ account: { ...me.account, login: "Renamed" } });
    expect((await whoami(app, other.cookie)).json()).toEqual({ signedIn: true, account: other.account });
  });

  it("a wrong password for a known login and an unknown login answer byte-identical 401s", async () => {
    await registerAccount(app, { login: "Chris", password: PASSWORD });
    const known = await login(app, { login: "Chris", password: "wrong" });
    const unknown = await login(app, { login: UNKNOWN_LOGIN, password: "wrong" });
    expect(known.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(unknown.body).toBe(known.body);
    expect(envelope(known)).toEqual({ code: "bad_credentials", message: "Incorrect login or password" });
    expect(unknown.headers["content-length"]).toBe(known.headers["content-length"]);
    expect(known.headers["set-cookie"]).toBeUndefined();
    expect(unknown.headers["set-cookie"]).toBeUndefined();
    expect(Object.keys(unknown.headers).sort()).toEqual(Object.keys(known.headers).sort());
  });

  it("a registration refused for a taken login leaves no account, no session and no throttle row", async () => {
    const existing = await registerAccount(app, { login: "Chris", password: PASSWORD });
    const sessionsBefore = await app.db.select({ id: sessions.id }).from(sessions);
    const res = await register(app, {
      inviteCode: TEST_INVITE_CODES[1],
      login: " CHRIS ",
      password: OTHER_PASSWORD,
    });
    expect(res.statusCode).toBe(409);
    expect(envelope(res).code).toBe("login_taken");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(await app.db.select({ id: accounts.id }).from(accounts)).toEqual([{ id: existing.account.id }]);
    expect(await app.db.select({ id: sessions.id }).from(sessions)).toEqual(sessionsBefore);
    expect(await app.db.select().from(authThrottle)).toEqual([]);
    // The existing account's password is the one it had.
    expect((await login(app, { login: "Chris", password: OTHER_PASSWORD })).statusCode).toBe(401);
    expect((await login(app, { login: "Chris", password: PASSWORD })).statusCode).toBe(200);
  });

  it("two accounts renaming to the same login at once: exactly one 200, one 409, one row with that login", async () => {
    const alpha = await registerAccount(app, { login: "alpha", password: PASSWORD });
    const beta = await registerAccount(app, { login: "beta", password: PASSWORD });
    const [a, b] = await Promise.all([
      rename(app, alpha.cookie, { login: "Winner" }),
      rename(app, beta.cookie, { login: "winner" }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(envelope(loser)).toEqual({ code: "login_taken", message: "That login is already in use" });
    expect(
      await app.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.loginNormalized, "winner")),
    ).toHaveLength(1);
    const loserAccount = a.statusCode === 409 ? alpha : beta;
    expect((await whoami(app, loserAccount.cookie)).json()).toEqual({
      signedIn: true,
      account: loserAccount.account,
    });
  });
});

describe("the cap, adversarial", () => {
  const CAP = 1;
  let capped: App;
  beforeAll(async () => {
    capped = await createTestApp({ config: testConfig({ ACCOUNT_CAP: String(CAP) }) });
  });
  beforeEach(async () => {
    await clearAccountData(capped.db);
    await registerAccount(capped, { login: "Only", password: PASSWORD });
  });
  afterAll(() => capped.close());

  it("at the cap, check-invite is 403 cap_reached even for a valid code, and register writes nothing", async () => {
    for (const inviteCode of [TEST_INVITE_CODES[0], TEST_INVITE_CODES[1].toUpperCase()]) {
      const checked = await checkInvite(capped, inviteCode);
      expect(checked.statusCode).toBe(403);
      expect(envelope(checked)).toEqual({
        code: "cap_reached",
        message: "No more accounts can be created right now",
      });
    }
    const registered = await register(capped, {
      inviteCode: TEST_INVITE_CODES[0],
      login: "Second",
      password: PASSWORD,
    });
    expect(registered.statusCode).toBe(403);
    expect(envelope(registered).code).toBe("cap_reached");
    expect(registered.headers["set-cookie"]).toBeUndefined();
    expect(await capped.db.select({ login: accounts.login }).from(accounts)).toEqual([{ login: "Only" }]);
    expect(await capped.db.select({ id: sessions.id }).from(sessions)).toHaveLength(1);
  });

  it("refusing an invalid code and refusing a valid code at the cap take the same time, far below one derivation", async () => {
    const invalid: number[] = [];
    const atCap: number[] = [];
    for (let i = 0; i < TIMING_SAMPLES; i += 1) {
      invalid.push(
        await elapsedMs(async () => {
          expect(envelope(await checkInvite(capped, UNKNOWN_INVITE_CODE)).code).toBe("invite_invalid");
        }),
      );
      atCap.push(
        await elapsedMs(async () => {
          expect(envelope(await checkInvite(capped, TEST_INVITE_CODES[0])).code).toBe("cap_reached");
        }),
      );
    }
    const floor = await derivationFloorMs();
    const invalidMedian = median(invalid);
    const atCapMedian = median(atCap);
    const detail = `invalid ${invalidMedian.toFixed(1)} ms, at cap ${atCapMedian.toFixed(1)} ms, derivation ${floor.toFixed(1)} ms`;
    expect(invalidMedian, detail).toBeLessThan(floor * DERIVATION_FLOOR_SHARE);
    expect(atCapMedian, detail).toBeLessThan(floor * DERIVATION_FLOOR_SHARE);
    expectSameTiming(invalidMedian, atCapMedian);
  });
});

describe("response bodies", () => {
  it("never contained a hash, a normalised login, an invite digest or a password", () => {
    expect(bodies.length).toBeGreaterThan(100);
    const forbidden = [
      "password_hash",
      "passwordHash",
      "login_normalized",
      "loginNormalized",
      "invite_code_hash",
      "inviteCodeHash",
      "user_agent_hash",
      "userAgentHash",
      "$argon2id$",
      PASSWORD,
      OTHER_PASSWORD,
      ...TEST_INVITE_CODES,
    ];
    for (const body of bodies) {
      for (const needle of forbidden) expect(body, needle).not.toContain(needle);
    }
  });
});
