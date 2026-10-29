import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { describePasswordReset, ResetPasswordError, resetPassword } from "../src/cli/reset-password.js";
import { accounts, sessions } from "../src/db/schema.js";
import {
  clearAccountData,
  createTestApp,
  loginAccount,
  registerAccount,
  send,
  testDatabaseUrl,
} from "./support.js";

const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a brand new password";
const apiDir = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");

/**
 * Spec §8: the owner's reset command, through its exported function (the
 * rules) and as a child process (stdin, the exact output line, exit codes).
 */
describe("resetPassword", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  const tryLogin = (login: string, password: string) =>
    send(app, { method: "POST", url: "/api/session/login", payload: { login, password } });

  it("rehashes the password, ends every session of that account only, and reports the stored login", async () => {
    const { account } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    await loginAccount(app, { login: "Chris", password: PASSWORD });
    await loginAccount(app, { login: "Chris", password: PASSWORD });
    const bystander = await registerAccount(app, { login: "Other", password: PASSWORD });
    const [before] = await app.db.select().from(accounts).where(eq(accounts.id, account.id));

    expect(await resetPassword(app.db, "  chris ", NEW_PASSWORD)).toEqual({
      login: "Chris",
      sessionsEnded: 3,
    });

    const [after] = await app.db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(after?.passwordHash).not.toBe(before?.passwordHash);
    expect(after?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? Infinity);
    expect(await app.db.select({ accountId: sessions.accountId }).from(sessions)).toEqual([
      { accountId: bystander.account.id },
    ]);
    expect((await tryLogin("Chris", PASSWORD)).statusCode).toBe(401);
    expect((await tryLogin("Chris", NEW_PASSWORD)).statusCode).toBe(200);
    expect(
      (await send(app, { method: "GET", url: "/api/session", cookie: bystander.cookie })).json(),
    ).toMatchObject({
      signedIn: true,
    });
  });

  it("never trims the password", async () => {
    await registerAccount(app, { login: "Chris", password: PASSWORD });
    await resetPassword(app.db, "Chris", "  spaced out  ");
    expect((await tryLogin("Chris", "spaced out")).statusCode).toBe(401);
    expect((await tryLogin("Chris", "  spaced out  ")).statusCode).toBe(200);
  });

  it("reports zero sessions when there were none", async () => {
    await registerAccount(app, { login: "Chris", password: PASSWORD });
    await app.db.delete(sessions);
    expect(await resetPassword(app.db, "Chris", NEW_PASSWORD)).toEqual({ login: "Chris", sessionsEnded: 0 });
  });

  it("refuses an unknown login and changes nothing", async () => {
    const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    await expect(resetPassword(app.db, "nobody", NEW_PASSWORD)).rejects.toThrow(ResetPasswordError);
    await expect(resetPassword(app.db, "nobody", NEW_PASSWORD)).rejects.toThrow(
      'No account has the login "nobody"',
    );
    expect((await tryLogin("Chris", PASSWORD)).statusCode).toBe(200);
    expect((await send(app, { method: "GET", url: "/api/session", cookie })).json()).toMatchObject({
      signedIn: true,
    });
  });

  it.each([
    ["7 characters", "1234567"],
    ["129 characters", "x".repeat(129)],
    ["empty", ""],
  ])("refuses a new password of %s before touching the account or its sessions", async (_label, bad) => {
    const { cookie } = await registerAccount(app, { login: "Chris", password: PASSWORD });
    await expect(resetPassword(app.db, "Chris", bad)).rejects.toThrow("must be 8 to 128 characters");
    expect((await tryLogin("Chris", PASSWORD)).statusCode).toBe(200);
    expect((await send(app, { method: "GET", url: "/api/session", cookie })).json()).toMatchObject({
      signedIn: true,
    });
  });

  it("accepts exactly 8 and exactly 128 characters, counted in characters", async () => {
    await registerAccount(app, { login: "Chris", password: PASSWORD });
    await resetPassword(app.db, "Chris", "12345678");
    expect((await tryLogin("Chris", "12345678")).statusCode).toBe(200);
    await resetPassword(app.db, "Chris", "\u{1F600}".repeat(128));
    expect((await tryLogin("Chris", "\u{1F600}".repeat(128))).statusCode).toBe(200);
  });
});

describe("reset-password as a command", () => {
  let app: App;
  beforeAll(async () => {
    // The child resolves `@anime-tcg/shared/*` through the package's `exports`, which point at dist/.
    await promisify(execFile)(process.execPath, [tsc, "-b", "../shared"], { cwd: apiDir });
    app = await createTestApp();
  }, 60_000);
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  interface Run {
    code: number | null;
    stdout: string;
    stderr: string;
  }

  /** Runs the source entry point with only DATABASE_URL in its environment (nothing inherited), feeding `stdin` and closing it. */
  function run(
    args: string[],
    stdin: string | null,
    env: Record<string, string> = { DATABASE_URL: testDatabaseUrl() },
  ): Promise<Run> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "src/cli/reset-password.ts", ...args], {
        cwd: apiDir,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, stdout, stderr }));
      if (stdin !== null) child.stdin.write(stdin);
      child.stdin.end();
    });
  }

  it("prints the stored login JSON-quoted, so a control sequence in it never reaches the terminal", () => {
    expect(describePasswordReset({ login: "a\u001b]0;owned\u0007b", sessionsEnded: 1 })).toBe(
      'Password reset for "a\\u001b]0;owned\\u0007b"; 1 sessions ended.',
    );
  });

  it("prints exactly one line and exits 0, with the shell's trailing newline stripped from the password", async () => {
    await registerAccount(app, { login: "Chris", password: PASSWORD });
    await loginAccount(app, { login: "Chris", password: PASSWORD });
    const result = await run(["chris"], `${NEW_PASSWORD}\n`);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe('Password reset for "Chris"; 2 sessions ended.\n');
    expect(result.code).toBe(0);
    const login = await send(app, {
      method: "POST",
      url: "/api/session/login",
      payload: { login: "Chris", password: NEW_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(await app.db.select().from(sessions)).toHaveLength(1);
  }, 30_000);

  it("exits 1 with a one-line reason for an unknown login", async () => {
    const result = await run(["nobody"], `${NEW_PASSWORD}\n`);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe('No account has the login "nobody"\n');
  }, 30_000);

  it("exits 1 with a one-line reason for a short password, and never echoes it", async () => {
    await registerAccount(app, { login: "Chris", password: PASSWORD });
    const result = await run(["Chris"], "short\n");
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("The new password must be 8 to 128 characters\n");
    expect(result.stdout).not.toContain("short");
  }, 30_000);

  it("exits 1 with usage when the login is missing or there are extra arguments", async () => {
    for (const args of [[], ["Chris", NEW_PASSWORD]]) {
      const result = await run(args, null);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.stderr).toMatch(/^Usage: /);
    }
  }, 30_000);

  it("exits 1 when DATABASE_URL is not set", async () => {
    const result = await run(["Chris"], `${NEW_PASSWORD}\n`, {});
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("DATABASE_URL is not set\n");
  }, 30_000);
});
