import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EXAMPLE_SESSION_SECRET } from "../src/config.js";
import { testConfig } from "./support.js";

/**
 * `api/src/server.ts` is the one module with side effects (reads the
 * environment, listens, handles signals, exits), so it is tested as a child
 * process: this is the only place the SIGTERM → drain → exit 0 path of the
 * spec and the fail-fast-on-bad-config path are exercised end to end.
 */

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");

type LogLine = Record<string, unknown>;

interface Child {
  process: ChildProcess;
  lines: () => LogLine[];
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  waitFor: (predicate: (line: LogLine) => boolean) => Promise<LogLine>;
}

/** A minimal environment: the api's variables and nothing inherited, so the test proves what it says. */
function childEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const config = testConfig();
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    HOST: "127.0.0.1",
    PORT: "0",
    DATABASE_URL: config.DATABASE_URL,
    SESSION_SECRET: config.SESSION_SECRET,
    API_ORIGIN: config.API_ORIGIN,
    WEB_ORIGIN: config.WEB_ORIGIN,
    ...overrides,
  };
}

function startChild(env: Record<string, string>): Child {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: apiDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const lines = () =>
    stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as LogLine);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  const waitFor = async (predicate: (line: LogLine) => boolean): Promise<LogLine> => {
    const deadline = Date.now() + 12_000;
    for (;;) {
      const hit = lines().find(predicate);
      if (hit) return hit;
      if (child.exitCode !== null || Date.now() > deadline) {
        throw new Error(`server.ts did not log what was expected\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  return { process: child, lines, exited, waitFor };
}

describe("server.ts as a process", () => {
  let child: Child | undefined;

  beforeAll(async () => {
    // The child resolves `@anime-tcg/shared/*` through the package's `exports`, which point at dist/.
    await promisify(execFile)(process.execPath, [tsc, "-b", "../shared"], { cwd: apiDir });
  }, 60_000);

  afterEach(async () => {
    if (child && child.process.exitCode === null) {
      child.process.kill("SIGKILL");
      await child.exited;
    }
    child = undefined;
  });

  it("refuses to start on a bad config, naming the variable and never its value, with exit code 1", async () => {
    child = startChild(childEnv({ SESSION_SECRET: EXAMPLE_SESSION_SECRET }));
    const { code } = await child.exited;
    expect(code).toBe(1);
    const fatal = child.lines().find((line) => line.level === 60);
    expect(fatal).toMatchObject({ variable: "SESSION_SECRET" });
    expect(String(fatal?.msg)).toContain("SESSION_SECRET");
    const everything = JSON.stringify(child.lines());
    expect(everything).not.toContain("replace-with-32");
    expect(everything).not.toContain(childEnv().DATABASE_URL);
    expect(everything).not.toHaveProperty("hostname");
  });

  it("refuses to start when a required variable is missing, with exit code 1", async () => {
    const env = childEnv();
    delete env.DATABASE_URL;
    child = startChild(env);
    expect((await child.exited).code).toBe(1);
    expect(child.lines().find((line) => line.level === 60)).toMatchObject({ variable: "DATABASE_URL" });
  });

  it("migrates, listens, serves, and on SIGTERM drains, closes and exits 0", async () => {
    child = startChild(childEnv());
    await child.waitFor((line) => line.msg === "migrations applied");
    const listening = await child.waitFor((line) => /^Server listening at /.test(String(line.msg)));
    const url = String(listening.msg).replace(/^Server listening at /, "");

    const res = await fetch(`${url}/api/session`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: false });
    expect(res.headers.get("cache-control")).toBe("no-store");

    child.process.kill("SIGTERM");
    const { code, signal } = await child.exited;
    expect(signal).toBeNull();
    expect(code).toBe(0);
    expect(child.lines()).toContainEqual(
      expect.objectContaining({ signal: "SIGTERM", msg: "shutting down" }),
    );
    await expect(fetch(`${url}/healthz`)).rejects.toThrow();

    // Nothing in a whole start-up and shutdown at `info` names the secret, the database password or the host.
    const everything = JSON.stringify(child.lines());
    expect(everything).not.toContain(childEnv().SESSION_SECRET);
    expect(everything).not.toContain("anime:anime@");
    expect(everything).not.toContain('"hostname"');
  });
});
