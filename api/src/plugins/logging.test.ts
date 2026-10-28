import { Writable } from "node:stream";
import type { Logger } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logging.js";

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

  it.each(["password", "secret", "token"])(
    "masks a field named %s at the top level and two levels down",
    (key) => {
      const { logger, lines } = capture();
      logger.info({ [key]: "v1", body: { [key]: "v2" }, body2: { nested: { [key]: "v3" } } }, "x");
      const text = JSON.stringify(lines()[0]);
      expect(text).not.toContain("v1");
      expect(text).not.toContain("v2");
      expect(text).not.toContain("v3");
      expect(text.match(/\[redacted\]/g)).toHaveLength(3);
    },
  );

  it("never writes the hostname", () => {
    const { logger, lines } = capture();
    logger.info("hello");
    expect(lines()[0]).not.toHaveProperty("hostname");
    expect(lines()[0]).toHaveProperty("pid");
  });

  it("createLogger honours the level", () => {
    const logger = createLogger("warn");
    expect(logger.level).toBe("warn");
    expect(logger.isLevelEnabled("info")).toBe(false);
    expect(createLogger("silent").isLevelEnabled("fatal")).toBe(false);
  });
});
