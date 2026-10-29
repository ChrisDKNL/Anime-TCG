import { Writable } from "node:stream";
import { DrizzleQueryError } from "drizzle-orm";
import type { Logger } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger, quieterOf } from "./logging.js";

function capture(): { logger: Logger; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  const logger = createLogger("info", sink);
  return {
    logger,
    lines: () =>
      chunks
        .join("")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as never),
  };
}

describe("log redaction", () => {
  it("masks cookies and authorization on a logged request", () => {
    const { logger, lines } = capture();
    logger.info(
      { req: { headers: { cookie: "__Host-session=abc", authorization: "Bearer x", host: "h" } } },
      "req",
    );
    const [line] = lines();
    const headers = (line?.req as { headers: Record<string, string> }).headers;
    expect(headers).toEqual({ cookie: "[redacted]", authorization: "[redacted]", host: "h" });
  });

  it("masks set-cookie on a logged response", () => {
    const { logger, lines } = capture();
    logger.info({ res: { headers: { "set-cookie": "__Host-session=abc" } } }, "res");
    expect((lines()[0]?.res as { headers: Record<string, string> }).headers["set-cookie"]).toBe("[redacted]");
  });

  it.each([
    "password",
    "currentPassword",
    "newPassword",
    "inviteCode",
    "inviteCodes",
    "passwordHash",
    "secret",
    "token",
    "SESSION_SECRET",
    "INVITE_CODES",
  ])("masks a field named %s at the top level and two levels down", (key) => {
    const { logger, lines } = capture();
    logger.info({ [key]: "v1", body: { [key]: "v2" }, body2: { nested: { [key]: "v3" } } }, "x");
    const text = JSON.stringify(lines()[0]);
    expect(text).not.toContain("v1");
    expect(text).not.toContain("v2");
    expect(text).not.toContain("v3");
    expect(text.match(/\[redacted\]/g)).toHaveLength(3);
  });

  it("logs a DrizzleQueryError without its parameters: the statement line, the frames and the cause only", () => {
    const { logger, lines } = capture();
    const hash =
      "$argon2id$v=19$m=19456,t=2,p=1$05jkupgj2Cq190TgKBWdWA$fu6mhx+znVx55S4LXmY7Hj8eY9AFHiwHunbRgOeUIkE";
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
    const err = new DrizzleQueryError(
      'insert into "accounts" ("login", "password_hash") values ($1, $2)',
      ["Chris", hash],
      cause,
    );
    logger.error({ err }, "request failed");
    const [line] = lines();
    const text = JSON.stringify(line);
    expect(text).not.toContain("argon2id");
    expect(text).not.toContain("params");
    const logged = line?.err as {
      type: string;
      message: string;
      stack: string;
      cause: { message: string; code: string };
    };
    expect(logged.type).toBe("DrizzleQueryError");
    expect(logged.message).toBe(
      'Failed query: insert into "accounts" ("login", "password_hash") values ($1, $2)',
    );
    expect(logged.stack.split("\n")[0]).toBe(`DrizzleQueryError: ${logged.message}`);
    expect(logged.stack).toMatch(/\n\s+at /);
    expect(logged.cause).toMatchObject({
      message: "duplicate key value violates unique constraint",
      code: "23505",
    });
  });

  it("serialises any other error as pino does, with message and stack", () => {
    const { logger, lines } = capture();
    logger.error({ err: new RangeError("out of range") }, "request failed");
    const logged = lines()[0]?.err as { type: string; message: string; stack: string };
    expect(logged.type).toBe("RangeError");
    expect(logged.message).toBe("out of range");
    expect(logged.stack).toMatch(/^RangeError: out of range\n\s+at /);
  });

  it("never writes the hostname", () => {
    const { logger, lines } = capture();
    logger.info("hello");
    expect(lines()[0]).not.toHaveProperty("hostname");
    expect(lines()[0]).toHaveProperty("pid");
  });

  it("quieterOf picks the more restrictive level", () => {
    expect(quieterOf("info", "warn")).toBe("warn");
    expect(quieterOf("error", "warn")).toBe("error");
    expect(quieterOf("silent", "warn")).toBe("silent");
    expect(quieterOf("trace", "trace")).toBe("trace");
  });

  it("createLogger honours the level", () => {
    const logger = createLogger("warn");
    expect(logger.level).toBe("warn");
    expect(logger.isLevelEnabled("info")).toBe(false);
    expect(createLogger("silent").isLevelEnabled("fatal")).toBe(false);
  });
});
