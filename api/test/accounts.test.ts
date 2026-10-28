import { Writable } from "node:stream";
import type { AccountPublic } from "@anime-tcg/shared/api";
import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app.js";
import { accounts, authThrottle, sessions } from "../src/db/schema.js";
import { hashInviteCode } from "../src/domain/accounts/invites.js";
import { THROTTLE_MAX_FAILURES } from "../src/domain/accounts/throttle.js";
import { hashSessionId } from "../src/domain/session/ids.js";
import { PURGE_INTERVAL_MS } from "../src/domain/session/policy.js";
import { createLogger } from "../src/plugins/logging.js";
import {
  type Call,
  clearAccountData,
  createTestApp,
  loginAccount,
  registerAccount,
  send,
  sessionCookieFrom,
  TEST_INVITE_CODES,
  TEST_SESSION_SECRET,
  testConfig,
  UNKNOWN_INVITE_CODE,
} from "./support.js";

const COOKIE_LINE =
  /^__Host-session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/;
const CLEARED_LINE =
  /^__Host-session=; Max-Age=0; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PASSWORD = "correct horse battery";
const OTHER_PASSWORD = "another fine password";

/** Every response body this file received, so one test can prove no hash ever left the api. */
const bodies: string[] = [];

function envelope(res: LightMyRequestResponse): {
  code: string;
  message: string;
  retryAfterSeconds?: number;
} {
  return res.json<{ error: { code: string; message: string; retryAfterSeconds?: number } }>().error;
}

describe("account routes", () => {
  let app: App;
  const call = async (c: Call) => {
    const res = await send(app, c);
    bodies.push(res.body);
    return res;
  };
  const checkInvite = (inviteCode: unknown, extra: Partial<Call> = {}) =>
    call({ method: "POST", url: "/api/accounts/check-invite", payload: { inviteCode }, ...extra });
  const register = (payload: unknown, extra: Partial<Call> = {}) =>
    call({ method: "POST", url: "/api/accounts/register", payload, ...extra });
  const rename = (cookie: string | undefined, payload: unknown, extra: Partial<Call> = {}) =>
    call({ method: "PATCH", url: "/api/account/login", cookie, payload, ...extra });
  const changePassword = (cookie: string | undefined, payload: unknown, extra: Partial<Call> = {}) =>
    call({ method: "POST", url: "/api/account/change-password", cookie, payload, ...extra });
  const deleteAccount = (cookie: string | undefined, payload: unknown, extra: Partial<Call> = {}) =>
    call({ method: "POST", url: "/api/account/delete", cookie, payload, ...extra });
  const whoami = (cookie: string) => call({ method: "GET", url: "/api/session", cookie });
  const accountRows = () => app.db.select().from(accounts);

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  describe("POST /api/accounts/check-invite", () => {
    it("answers 204 with no body for a configured code, and sets no cookie", async () => {
      const res = await checkInvite(TEST_INVITE_CODES[0]);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(res.headers["content-type"]).toBeUndefined();
    });

    it("accepts every configured code, in any case and with surrounding whitespace", async () => {
      expect((await checkInvite(TEST_INVITE_CODES[1])).statusCode).toBe(204);
      expect((await checkInvite(TEST_INVITE_CODES[0].toUpperCase())).statusCode).toBe(204);
      expect((await checkInvite(`  ${TEST_INVITE_CODES[0].toLowerCase()}\t`)).statusCode).toBe(204);
    });

    it.each([
      ["an unknown code", UNKNOWN_INVITE_CODE],
      ["a configured code with one character appended", `${TEST_INVITE_CODES[0]}x`],
      [
        "a configured code with an inner space",
        `${TEST_INVITE_CODES[0].slice(0, 5)} ${TEST_INVITE_CODES[0].slice(5)}`,
      ],
      ["whitespace only", " "],
    ])("refuses %s with 403 invite_invalid", async (_label, inviteCode) => {
      const res = await checkInvite(inviteCode);
      expect(res.statusCode).toBe(403);
      expect(envelope(res)).toEqual({ code: "invite_invalid", message: "That invite code is not valid" });
    });

    it.each([
      [
        "an extra field",
        { inviteCode: TEST_INVITE_CODES[0], login: "x" },
        "body must NOT have additional properties",
      ],
      ["a missing code", {}, "body must have required property 'inviteCode'"],
      ["an empty code", { inviteCode: "" }, "body/inviteCode must NOT have fewer than 1 characters"],
      [
        "a 65-character code",
        { inviteCode: "x".repeat(65) },
        "body/inviteCode must NOT have more than 64 characters",
      ],
      ["a non-string code", { inviteCode: 1 }, "body/inviteCode must be string"],
    ])("rejects %s as 400 validation_failed", async (_label, payload, message) => {
      const res = await call({ method: "POST", url: "/api/accounts/check-invite", payload });
      expect(res.statusCode).toBe(400);
      expect(envelope(res)).toEqual({ code: "validation_failed", message });
    });

    it("is limited to 10 per minute per client", async () => {
      expect((await checkInvite(TEST_INVITE_CODES[0])).headers["x-ratelimit-limit"]).toBe("10");
    });
  });

  describe("POST /api/accounts/register", () => {
    it("creates the account, answers 201 with the public account and signs the client in", async () => {
      const res = await register({ inviteCode: TEST_INVITE_CODES[0], login: "Chris", password: PASSWORD });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ signedIn: true; account: AccountPublic }>();
      expect(body.signedIn).toBe(true);
      expect(body.account).toMatchObject({ login: "Chris", cards: 0 });
      expect(body.account.id).toMatch(UUID);
      expect(new Date(body.account.createdAt).toISOString()).toBe(body.account.createdAt);
      expect(Object.keys(body.account).sort()).toEqual(["cards", "createdAt", "id", "login"]);

      const lines = [res.headers["set-cookie"]].flat().filter((line) => line !== undefined);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(COOKIE_LINE);
      const cookie = sessionCookieFrom(res.headers["set-cookie"]) ?? "";
      expect((await whoami(cookie)).json()).toEqual({ signedIn: true, account: body.account });
    });

    it("stores the trimmed login as typed, its case-folded form as the key, an Argon2id hash and the invite digest", async () => {
      await register({
        inviteCode: ` ${TEST_INVITE_CODES[1].toUpperCase()} `,
        login: "  MiXed Case ",
        password: PASSWORD,
      });
      const [row] = await accountRows();
      expect(row).toMatchObject({
        login: "MiXed Case",
        loginNormalized: "mixed case",
        inviteCodeHash: hashInviteCode(TEST_INVITE_CODES[1]),
      });
      expect(row?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(row?.passwordHash).not.toContain(PASSWORD);
      expect(row?.createdAt.getTime()).toBe(row?.updatedAt.getTime());
    });

    it("rotates the session: a cookie the browser held before registering is dead afterwards", async () => {
      const planted = await call({ method: "POST", url: "/api/session/logout" });
      expect(planted.statusCode).toBe(204);
      const first = await registerAccount(app, { login: "first", password: PASSWORD });
      const res = await register(
        { inviteCode: TEST_INVITE_CODES[0], login: "second", password: PASSWORD },
        { cookie: first.cookie },
      );
      expect(res.statusCode).toBe(201);
      const issued = sessionCookieFrom(res.headers["set-cookie"]);
      expect(issued).toBeDefined();
      expect(issued).not.toBe(first.cookie);
      expect((await whoami(first.cookie)).json()).toEqual({ signedIn: false });
      expect((await whoami(issued ?? "")).json()).toMatchObject({
        signedIn: true,
        account: { login: "second" },
      });
    });

    it("refuses an unknown code with 403 invite_invalid and writes no row", async () => {
      const res = await register({ inviteCode: UNKNOWN_INVITE_CODE, login: "Chris", password: PASSWORD });
      expect(res.statusCode).toBe(403);
      expect(envelope(res).code).toBe("invite_invalid");
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(await accountRows()).toEqual([]);
    });

    it("re-checks the login length after trimming: two letters padded with spaces are a 400, not an account", async () => {
      const res = await register({ inviteCode: TEST_INVITE_CODES[0], login: "  ab  ", password: PASSWORD });
      expect(res.statusCode).toBe(400);
      expect(envelope(res)).toEqual({
        code: "validation_failed",
        message: "body/login must be 3 to 24 characters after trimming",
      });
      expect(await accountRows()).toEqual([]);
    });

    it.each([
      ["the same login", "Chris"],
      ["the login in another case", "CHRIS"],
      ["the login with surrounding spaces", "  chris "],
    ])("refuses %s with 409 login_taken and keeps one row", async (_label, login) => {
      await registerAccount(app, { login: "Chris", password: PASSWORD });
      const res = await register({ inviteCode: TEST_INVITE_CODES[1], login, password: OTHER_PASSWORD });
      expect(res.statusCode).toBe(409);
      expect(envelope(res)).toEqual({ code: "login_taken", message: "That login is already in use" });
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(await accountRows()).toHaveLength(1);
    });

    it.each([
      [
        "an extra field",
        { inviteCode: TEST_INVITE_CODES[0], login: "Chris", password: PASSWORD, admin: true },
      ],
      ["a missing password", { inviteCode: TEST_INVITE_CODES[0], login: "Chris" }],
      ["a 7-character password", { inviteCode: TEST_INVITE_CODES[0], login: "Chris", password: "1234567" }],
      [
        "a 129-character password",
        { inviteCode: TEST_INVITE_CODES[0], login: "Chris", password: "x".repeat(129) },
      ],
      ["a 2-character login", { inviteCode: TEST_INVITE_CODES[0], login: "ab", password: PASSWORD }],
      [
        "a 25-character login",
        { inviteCode: TEST_INVITE_CODES[0], login: "x".repeat(25), password: PASSWORD },
      ],
      ["a 65-character code", { inviteCode: "x".repeat(65), login: "Chris", password: PASSWORD }],
      ["a non-object body", [1, 2, 3]],
    ])("rejects %s as 400 validation_failed before anything is written", async (_label, payload) => {
      const res = await register(payload);
      expect(res.statusCode).toBe(400);
      expect(envelope(res).code).toBe("validation_failed");
      expect(await accountRows()).toEqual([]);
    });

    it("accepts a 128-character password and an 8-character one", async () => {
      expect(
        (await register({ inviteCode: TEST_INVITE_CODES[0], login: "long", password: "x".repeat(128) }))
          .statusCode,
      ).toBe(201);
      expect(
        (await register({ inviteCode: TEST_INVITE_CODES[0], login: "short", password: "12345678" }))
          .statusCode,
      ).toBe(201);
    });

    it("keeps unusual logins as text: RTL overrides, zero-width and emoji round-trip and stay unique", async () => {
      for (const login of [
        "\u202Eevil\u202C",
        "a\u200Bb\u200Bc",
        "\u{1F600}\u{1F600}\u{1F600}",
        "<b>bold</b>",
      ]) {
        const res = await register({ inviteCode: TEST_INVITE_CODES[0], login, password: PASSWORD });
        expect(res.statusCode, JSON.stringify(login)).toBe(201);
        expect(res.json<{ account: AccountPublic }>().account.login).toBe(login);
        const again = await register({ inviteCode: TEST_INVITE_CODES[0], login, password: PASSWORD });
        expect(again.statusCode, JSON.stringify(login)).toBe(409);
      }
    });

    it("refuses a null character in the login as 400 (Postgres cannot store it), never a 500", async () => {
      const res = await register({
        inviteCode: TEST_INVITE_CODES[0],
        login: "a\u0000b\u0000c",
        password: PASSWORD,
      });
      expect(res.statusCode).toBe(400);
      expect(envelope(res)).toEqual({
        code: "validation_failed",
        message: "body/login must not contain the null character",
      });
      expect(await accountRows()).toEqual([]);
    });

    it("is limited to 10 per minute per client", async () => {
      const res = await register({ inviteCode: TEST_INVITE_CODES[0], login: "Chris", password: PASSWORD });
      expect(res.headers["x-ratelimit-limit"]).toBe("10");
    });
  });

  describe("PATCH /api/account/login", () => {
    it("renames and answers 200 with the account; the session sees the new login", async () => {
      const { cookie, account } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const res = await rename(cookie, { login: "  Christopher " });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ account: { ...account, login: "Christopher" } });
      expect((await whoami(cookie)).json()).toEqual({
        signedIn: true,
        account: { ...account, login: "Christopher" },
      });
      const [row] = await accountRows();
      expect(row).toMatchObject({ login: "Christopher", loginNormalized: "christopher" });
      expect(row?.updatedAt.getTime()).toBeGreaterThan(row?.createdAt.getTime() ?? Infinity);
    });

    it("renaming to the current login is a 200 no-op that changes nothing", async () => {
      const { cookie, account } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const [before] = await accountRows();
      const res = await rename(cookie, { login: "Chris" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ account });
      expect(await accountRows()).toEqual([before]);
    });

    it("a change of case only is a rename", async () => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const res = await rename(cookie, { login: "chris" });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ account: AccountPublic }>().account.login).toBe("chris");
      expect((await accountRows())[0]).toMatchObject({ login: "chris", loginNormalized: "chris" });
    });

    it("refuses another account's login in a different case with 409 login_taken", async () => {
      await registerAccount(app, { login: "Taken", password: PASSWORD });
      const { cookie, account } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      for (const login of ["taken", "TAKEN", " Taken "]) {
        const res = await rename(cookie, { login });
        expect(res.statusCode, login).toBe(409);
        expect(envelope(res).code).toBe("login_taken");
      }
      expect((await whoami(cookie)).json()).toEqual({ signedIn: true, account });
    });

    it.each([
      ["an extra field", { login: "Christopher", id: "x" }],
      ["a missing login", {}],
      ["a 2-character login", { login: "ab" }],
      ["a 25-character login", { login: "x".repeat(25) }],
      ["two characters padded with spaces", { login: "  ab  " }],
    ])("rejects %s as 400 validation_failed and keeps the login", async (_label, payload) => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const res = await rename(cookie, payload);
      expect(res.statusCode).toBe(400);
      expect(envelope(res).code).toBe("validation_failed");
      expect((await accountRows())[0]?.login).toBe("Chris");
    });

    it("is limited to 30 per minute per client", async () => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      expect((await rename(cookie, { login: "Chris" })).headers["x-ratelimit-limit"]).toBe("30");
    });
  });

  describe("POST /api/account/change-password", () => {
    it("answers 204 with a rotated cookie, ends every other session, and the new password is the only one that works", async () => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const phone = await loginAccount(app, { login: "Chris", password: PASSWORD });
      const bystander = await registerAccount(app, { login: "Other", password: PASSWORD });

      const res = await changePassword(cookie, { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      const rotated = sessionCookieFrom(res.headers["set-cookie"]);
      expect(rotated).toBeDefined();
      expect(rotated).not.toBe(cookie);
      expect(String(res.headers["set-cookie"])).toMatch(COOKIE_LINE);

      expect((await whoami(rotated ?? "")).json()).toMatchObject({
        signedIn: true,
        account: { login: "Chris" },
      });
      expect((await whoami(cookie)).json()).toEqual({ signedIn: false });
      expect((await whoami(phone.cookie)).json()).toEqual({ signedIn: false });
      expect((await whoami(bystander.cookie)).json()).toMatchObject({
        signedIn: true,
        account: { login: "Other" },
      });
      expect(await app.db.select({ id: sessions.id }).from(sessions)).toHaveLength(2);

      const old = await call({
        method: "POST",
        url: "/api/session/login",
        payload: { login: "Chris", password: PASSWORD },
      });
      expect(old.statusCode).toBe(401);
      expect((await loginAccount(app, { login: "Chris", password: OTHER_PASSWORD })).account.login).toBe(
        "Chris",
      );
      const [row] = await app.db.select().from(accounts).where(eq(accounts.login, "Chris"));
      expect(row?.updatedAt.getTime()).toBeGreaterThan(row?.createdAt.getTime() ?? Infinity);
    });

    it("refuses a wrong current password with 403 wrong_password, keeps the session and counts the miss", async () => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const res = await changePassword(cookie, {
        currentPassword: "not it, sorry",
        newPassword: OTHER_PASSWORD,
      });
      expect(res.statusCode).toBe(403);
      expect(envelope(res)).toEqual({ code: "wrong_password", message: "That is not the current password" });
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect((await whoami(cookie)).json()).toMatchObject({ signedIn: true });
      expect(await app.db.select().from(authThrottle)).toMatchObject([
        { key: "chris", failures: 1, blockedUntil: null },
      ]);
      expect((await loginAccount(app, { login: "Chris", password: PASSWORD })).account.login).toBe("Chris");
    });

    it("after five wrong passwords answers 429 too_many_failures with Retry-After, even to the right password", async () => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      for (let i = 0; i < THROTTLE_MAX_FAILURES; i += 1) {
        const miss = await changePassword(cookie, {
          currentPassword: "wrong one",
          newPassword: OTHER_PASSWORD,
        });
        expect(miss.statusCode).toBe(403);
      }
      const blocked = await changePassword(cookie, {
        currentPassword: PASSWORD,
        newPassword: OTHER_PASSWORD,
      });
      expect(blocked.statusCode).toBe(429);
      const { retryAfterSeconds, ...rest } = envelope(blocked);
      expect(rest).toEqual({ code: "too_many_failures", message: "Too many wrong passwords; wait a moment" });
      expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(retryAfterSeconds).toBeLessThanOrEqual(10);
      expect(blocked.headers["retry-after"]).toBe(String(retryAfterSeconds));
      // The breather is keyed on the login, so signing in is refused the same way.
      const login = await call({
        method: "POST",
        url: "/api/session/login",
        payload: { login: "chris", password: PASSWORD },
      });
      expect(login.statusCode).toBe(429);
      // Still the old password: nothing was changed while blocked.
      await app.db.delete(authThrottle);
      expect((await loginAccount(app, { login: "Chris", password: PASSWORD })).account.login).toBe("Chris");
    });

    it.each([
      ["an extra field", { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD, login: "x" }],
      ["a missing new password", { currentPassword: PASSWORD }],
      ["a 7-character new password", { currentPassword: PASSWORD, newPassword: "1234567" }],
      ["a 129-character new password", { currentPassword: PASSWORD, newPassword: "x".repeat(129) }],
      ["an empty current password", { currentPassword: "", newPassword: OTHER_PASSWORD }],
    ])("rejects %s as 400 validation_failed without checking anything", async (_label, payload) => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const res = await changePassword(cookie, payload);
      expect(res.statusCode).toBe(400);
      expect(envelope(res).code).toBe("validation_failed");
      expect(await app.db.select().from(authThrottle)).toEqual([]);
    });

    it("is limited to 10 per minute per client", async () => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const res = await changePassword(cookie, { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD });
      expect(res.headers["x-ratelimit-limit"]).toBe("10");
    });
  });

  describe("POST /api/account/delete", () => {
    it("answers 204, clears the cookie, removes the row and every session of the account, and nobody else's", async () => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const phone = await loginAccount(app, { login: "Chris", password: PASSWORD });
      const bystander = await registerAccount(app, { login: "Other", password: PASSWORD });

      const res = await deleteAccount(cookie, { password: PASSWORD });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      expect(String(res.headers["set-cookie"])).toMatch(CLEARED_LINE);

      expect(await accountRows()).toMatchObject([{ login: "Other" }]);
      const rows = await app.db.select({ id: sessions.id }).from(sessions);
      expect(rows).toEqual([{ id: hashSessionId(TEST_SESSION_SECRET, bystander.cookie) }]);
      expect((await whoami(cookie)).json()).toEqual({ signedIn: false });
      expect((await whoami(phone.cookie)).json()).toEqual({ signedIn: false });
      expect((await whoami(bystander.cookie)).json()).toMatchObject({
        signedIn: true,
        account: { login: "Other" },
      });
      const login = await call({
        method: "POST",
        url: "/api/session/login",
        payload: { login: "Chris", password: PASSWORD },
      });
      expect(login.statusCode).toBe(401);
    });

    it("frees the login for a new account", async () => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      await deleteAccount(cookie, { password: PASSWORD });
      expect((await registerAccount(app, { login: "chris", password: OTHER_PASSWORD })).account.login).toBe(
        "chris",
      );
    });

    it("refuses a wrong password with 403 wrong_password and keeps everything", async () => {
      const { cookie, account } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const res = await deleteAccount(cookie, { password: OTHER_PASSWORD });
      expect(res.statusCode).toBe(403);
      expect(envelope(res).code).toBe("wrong_password");
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect((await whoami(cookie)).json()).toEqual({ signedIn: true, account });
      expect(await app.db.select().from(authThrottle)).toMatchObject([{ key: "chris", failures: 1 }]);
    });

    it("after five wrong passwords answers 429 too_many_failures, even to the right password", async () => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      for (let i = 0; i < THROTTLE_MAX_FAILURES; i += 1) {
        expect((await deleteAccount(cookie, { password: "wrong one" })).statusCode).toBe(403);
      }
      const blocked = await deleteAccount(cookie, { password: PASSWORD });
      expect(blocked.statusCode).toBe(429);
      expect(envelope(blocked).code).toBe("too_many_failures");
      expect(Number(blocked.headers["retry-after"])).toBe(envelope(blocked).retryAfterSeconds);
      expect(await accountRows()).toHaveLength(1);
    });

    it.each([
      ["an extra field", { password: PASSWORD, confirm: true }],
      ["a missing password", {}],
      ["an empty password", { password: "" }],
      ["a 129-character password", { password: "x".repeat(129) }],
    ])("rejects %s as 400 validation_failed", async (_label, payload) => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      const res = await deleteAccount(cookie, payload);
      expect(res.statusCode).toBe(400);
      expect(envelope(res).code).toBe("validation_failed");
      expect(await accountRows()).toHaveLength(1);
    });

    it("is limited to 10 per minute per client", async () => {
      const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
      expect((await deleteAccount(cookie, { password: PASSWORD })).headers["x-ratelimit-limit"]).toBe("10");
    });
  });

  describe("every account route", () => {
    const accountCalls: [
      string,
      (cookie?: string, extra?: Partial<Call>) => Promise<LightMyRequestResponse>,
    ][] = [
      ["PATCH /api/account/login", (cookie, extra) => rename(cookie, { login: "Christopher" }, extra)],
      [
        "POST /api/account/change-password",
        (cookie, extra) =>
          changePassword(cookie, { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD }, extra),
      ],
      ["POST /api/account/delete", (cookie, extra) => deleteAccount(cookie, { password: PASSWORD }, extra)],
    ];

    it.each(accountCalls)(
      "%s is 401 unauthenticated when signed out, with no cookie and with a dead one",
      async (_label, run) => {
        const none = await run(undefined);
        expect(none.statusCode).toBe(401);
        expect(envelope(none)).toEqual({ code: "unauthenticated", message: "Sign in first" });
        const dead = await run("A".repeat(43));
        expect(dead.statusCode).toBe(401);
        expect(String(dead.headers["set-cookie"])).toMatch(CLEARED_LINE);
        expect(await accountRows()).toEqual([]);
      },
    );

    it.each(accountCalls)(
      "%s is 403 bad_origin without an Origin, before touching the session or the body",
      async (_label, run) => {
        const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
        const res = await run(cookie, { origin: null });
        expect(res.statusCode).toBe(403);
        expect(envelope(res).code).toBe("bad_origin");
        expect((await accountRows())[0]?.login).toBe("Chris");
      },
    );

    it.each([
      ["POST /api/accounts/check-invite", () => checkInvite(TEST_INVITE_CODES[0], { origin: null })],
      [
        "POST /api/accounts/register",
        () =>
          register(
            { inviteCode: TEST_INVITE_CODES[0], login: "Chris", password: PASSWORD },
            { origin: null },
          ),
      ],
    ])("%s is 403 bad_origin without an Origin", async (_label, run) => {
      const res = await run();
      expect(res.statusCode).toBe(403);
      expect(envelope(res).code).toBe("bad_origin");
      expect(await accountRows()).toEqual([]);
    });
  });

  describe("the cap", () => {
    let capped: App;
    const CAP = 2;
    beforeAll(async () => {
      capped = await createTestApp({ config: testConfig({ ACCOUNT_CAP: String(CAP) }) });
    });
    afterAll(() => capped.close());

    const registerOn = (login: string) =>
      send(capped, {
        method: "POST",
        url: "/api/accounts/register",
        payload: { inviteCode: TEST_INVITE_CODES[0], login, password: PASSWORD },
      });

    it("refuses registration at the cap with 403 cap_reached and writes no row", async () => {
      expect((await registerOn("one")).statusCode).toBe(201);
      expect((await registerOn("two")).statusCode).toBe(201);
      const res = await registerOn("three");
      expect(res.statusCode).toBe(403);
      expect(envelope(res)).toEqual({
        code: "cap_reached",
        message: "No more accounts can be created right now",
      });
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(await capped.db.select().from(accounts)).toHaveLength(CAP);
    });

    it("check-invite reports the cap too, but an invalid code first", async () => {
      await registerOn("one");
      await registerOn("two");
      const full = await send(capped, {
        method: "POST",
        url: "/api/accounts/check-invite",
        payload: { inviteCode: TEST_INVITE_CODES[1] },
      });
      expect(full.statusCode).toBe(403);
      expect(envelope(full).code).toBe("cap_reached");
      const invalid = await send(capped, {
        method: "POST",
        url: "/api/accounts/check-invite",
        payload: { inviteCode: UNKNOWN_INVITE_CODE },
      });
      expect(envelope(invalid).code).toBe("invite_invalid");
    });

    it("two registrations racing for the last place: exactly one 201, one 403, the count is the cap", async () => {
      expect((await registerOn("one")).statusCode).toBe(201);
      const [a, b] = await Promise.all([registerOn("racer-a"), registerOn("racer-b")]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 403]);
      const loser = a.statusCode === 403 ? a : b;
      expect(envelope(loser).code).toBe("cap_reached");
      expect(await capped.db.select().from(accounts)).toHaveLength(CAP);
    });

    it("a deleted account frees its place", async () => {
      await registerOn("one");
      const res = await registerOn("two");
      const cookie = sessionCookieFrom(res.headers["set-cookie"]) ?? "";
      await send(capped, {
        method: "POST",
        url: "/api/account/delete",
        cookie,
        payload: { password: PASSWORD },
      });
      expect((await registerOn("three")).statusCode).toBe(201);
    });
  });

  describe("registration closed", () => {
    it("warns once at start-up and answers invite_invalid to every code", async () => {
      const chunks: string[] = [];
      const sink = new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk.toString());
          done();
        },
      });
      const closed = await createTestApp({
        config: testConfig({ INVITE_CODES: "" }),
        logger: createLogger("info", sink),
      });
      try {
        await closed.ready();
        const warnings = chunks
          .map((line) => JSON.parse(line) as { level: number; msg: string })
          .filter((line) => line.level === 40);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.msg).toContain("INVITE_CODES");
        expect(warnings[0]?.msg).toContain("closed");
        for (const inviteCode of [TEST_INVITE_CODES[0], UNKNOWN_INVITE_CODE, ""]) {
          const res = await send(closed, {
            method: "POST",
            url: "/api/accounts/check-invite",
            payload: { inviteCode },
          });
          expect(res.statusCode, inviteCode).toBe(inviteCode === "" ? 400 : 403);
          if (inviteCode !== "") expect(envelope(res).code).toBe("invite_invalid");
        }
        const res = await send(closed, {
          method: "POST",
          url: "/api/accounts/register",
          payload: { inviteCode: TEST_INVITE_CODES[0], login: "Chris", password: PASSWORD },
        });
        expect(res.statusCode).toBe(403);
        expect(await closed.db.select().from(accounts)).toEqual([]);
      } finally {
        await closed.close();
      }
    });
  });

  describe("hourly throttle purge", () => {
    it("removes rows untouched for an hour, keeps fresh ones, and logs the count", async () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const chunks: string[] = [];
      const sink = new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk.toString());
          done();
        },
      });
      const timed = await createTestApp({ logger: createLogger("info", sink) });
      try {
        await timed.ready();
        const hourly = setIntervalSpy.mock.calls.filter(([, ms]) => ms === PURGE_INTERVAL_MS);
        // The session purge registers first, the throttle purge second.
        expect(hourly).toHaveLength(2);
        const [tick] = hourly[1] as [() => void, number];

        const now = Date.now();
        await timed.db.insert(authThrottle).values([
          { key: "stale", failures: 3, blockedUntil: null, updatedAt: new Date(now - 61 * 60 * 1000) },
          { key: "fresh", failures: 3, blockedUntil: null, updatedAt: new Date(now - 59 * 60 * 1000) },
        ]);
        tick();
        await vi.waitFor(async () => {
          expect(await timed.db.select({ key: authThrottle.key }).from(authThrottle)).toEqual([
            { key: "fresh" },
          ]);
        });
        await vi.waitFor(() => {
          const lines = chunks.map((line) => JSON.parse(line) as Record<string, unknown>);
          expect(lines).toContainEqual(
            expect.objectContaining({ msg: "stale throttle rows purged", purged: 1 }),
          );
        });
      } finally {
        setIntervalSpy.mockRestore();
        await timed.close();
      }
    });
  });

  describe("response bodies", () => {
    it("never contained a password hash, an invite digest or a hash prefix", () => {
      expect(bodies.length).toBeGreaterThan(50);
      for (const body of bodies) {
        expect(body).not.toContain("password_hash");
        expect(body).not.toContain("passwordHash");
        expect(body).not.toContain("invite_code_hash");
        expect(body).not.toContain("inviteCodeHash");
        expect(body).not.toContain("$argon2id$");
        expect(body).not.toContain("loginNormalized");
      }
    });
  });
});
