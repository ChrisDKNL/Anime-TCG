import { Writable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { accounts } from "../src/db/schema.js";
import { createLogger } from "../src/plugins/logging.js";
import {
  clearAccountData,
  createTestApp,
  registerAccount,
  send,
  sessionCookieFrom,
  TEST_INVITE_CODES,
} from "./support.js";

const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a brand new password";

/**
 * Spec §6.7 and acceptance criterion 4: what the account flows log at
 * `info`, and what they never log however the request went.
 */
describe("account logging", () => {
  const chunks: string[] = [];
  let app: App;
  const lines = () => chunks.map((line) => JSON.parse(line) as Record<string, unknown>);
  const everything = () => chunks.join("\n");

  beforeAll(async () => {
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk.toString());
        done();
      },
    });
    app = await createTestApp({ logger: createLogger("info", sink) });
  });
  beforeEach(async () => {
    await clearAccountData(app.db);
    chunks.length = 0;
  });
  afterAll(() => app.close());

  it("logs account created, login failed and login succeeded with the request id, and never a secret", async () => {
    const { cookie, account } = await registerAccount(app, {
      login: "Chris",
      password: PASSWORD,
      inviteCode: TEST_INVITE_CODES[1],
    });
    const failed = await send(app, {
      method: "POST",
      url: "/api/session/login",
      payload: { login: "CHRIS", password: "not the password" },
    });
    expect(failed.statusCode).toBe(401);
    const ok = await send(app, {
      method: "POST",
      url: "/api/session/login",
      payload: { login: "chris", password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    const secondCookie = sessionCookieFrom(ok.headers["set-cookie"]) ?? "";
    const [row] = await app.db.select({ passwordHash: accounts.passwordHash }).from(accounts);

    const created = lines().find((line) => line.msg === "account created");
    expect(created).toMatchObject({ accountId: account.id, login: "Chris" });
    const refused = lines().find((line) => line.msg === "login failed");
    expect(refused).toMatchObject({
      login: "chris",
      outcome: "bad_credentials",
      throttle: { failures: 1, blockedUntil: null },
    });
    const succeeded = lines().find((line) => line.msg === "login succeeded");
    expect(succeeded).toMatchObject({ accountId: account.id, login: "Chris", outcome: "success" });
    for (const line of [created, refused, succeeded]) expect(typeof line?.reqId).toBe("string");
    expect(created?.reqId).not.toBe(refused?.reqId);

    for (const secret of [
      PASSWORD,
      "not the password",
      TEST_INVITE_CODES[1],
      TEST_INVITE_CODES[1].toLowerCase(),
      "$argon2id$",
      row?.passwordHash ?? "unreachable",
      cookie,
      secondCookie,
    ]) {
      expect(everything(), secret).not.toContain(secret);
    }
  });

  it("logs rename, password change and delete with the account id, and still no secret", async () => {
    const { cookie, account } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    await send(app, {
      method: "PATCH",
      url: "/api/account/login",
      cookie,
      payload: { login: "Christopher" },
    });
    const changed = await send(app, {
      method: "POST",
      url: "/api/account/change-password",
      cookie,
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(changed.statusCode).toBe(204);
    const rotated = sessionCookieFrom(changed.headers["set-cookie"]) ?? "";
    const wrong = await send(app, {
      method: "POST",
      url: "/api/account/delete",
      cookie: rotated,
      payload: { password: PASSWORD },
    });
    expect(wrong.statusCode).toBe(403);
    const deleted = await send(app, {
      method: "POST",
      url: "/api/account/delete",
      cookie: rotated,
      payload: { password: NEW_PASSWORD },
    });
    expect(deleted.statusCode).toBe(204);

    expect(lines().find((line) => line.msg === "account renamed")).toMatchObject({
      accountId: account.id,
      from: "Chris",
      login: "Christopher",
    });
    expect(lines().find((line) => line.msg === "password changed")).toMatchObject({ accountId: account.id });
    expect(lines().find((line) => line.msg === "password check failed")).toMatchObject({
      accountId: account.id,
      action: "delete",
      outcome: "wrong_password",
      throttle: { failures: 1 },
    });
    expect(lines().find((line) => line.msg === "account deleted")).toMatchObject({
      accountId: account.id,
      login: "Christopher",
    });
    for (const secret of [PASSWORD, NEW_PASSWORD, "$argon2id$", cookie, rotated, TEST_INVITE_CODES[0]]) {
      expect(everything(), secret).not.toContain(secret);
    }
  });

  it("redacts the request body fields by name if a body is ever logged", () => {
    app.log.info(
      {
        body: {
          inviteCode: "the-code",
          login: "x",
          password: "pw1",
          currentPassword: "pw2",
          newPassword: "pw3",
        },
      },
      "probe",
    );
    const probe = lines().find((line) => line.msg === "probe");
    expect(probe?.body).toEqual({
      inviteCode: "[redacted]",
      login: "x",
      password: "[redacted]",
      currentPassword: "[redacted]",
      newPassword: "[redacted]",
    });
  });
});
