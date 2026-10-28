import { describe, expect, it } from "vitest";
import { ConfigError, EXAMPLE_SESSION_SECRET, parseConfig } from "./config.js";

const SECRET = "unit-test-session-secret-not-for-real-use-0123456789";

const valid = {
  DATABASE_URL: "postgres://anime:anime@127.0.0.1:5432/anime",
  SESSION_SECRET: SECRET,
  API_ORIGIN: "http://localhost:3000",
  WEB_ORIGIN: "http://localhost:5173",
};

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    parseConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error("expected parseConfig to throw");
}

describe("parseConfig", () => {
  it("applies defaults for everything optional and freezes the result", () => {
    const config = parseConfig(valid);
    expect(config).toMatchObject({
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      HOST: "127.0.0.1",
      PORT: 3000,
      RATE_LIMIT_MAX: 100,
      RATE_LIMIT_WINDOW_MS: 60_000,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("converts numeric strings and keeps the typed values", () => {
    const config = parseConfig({
      ...valid,
      PORT: "4000",
      RATE_LIMIT_MAX: "10",
      RATE_LIMIT_WINDOW_MS: "5000",
    });
    expect(config.PORT).toBe(4000);
    expect(config.RATE_LIMIT_MAX).toBe(10);
    expect(config.RATE_LIMIT_WINDOW_MS).toBe(5000);
  });

  it("ignores unknown variables and treats empty strings as unset", () => {
    const config = parseConfig({ ...valid, UNRELATED: "x", LOG_LEVEL: "" });
    expect(config.LOG_LEVEL).toBe("info");
    expect("UNRELATED" in config).toBe(false);
  });

  it.each(["DATABASE_URL", "SESSION_SECRET", "API_ORIGIN", "WEB_ORIGIN"])(
    "names %s when it is missing, without echoing any value",
    (name) => {
      const err = failure({ ...valid, [name]: undefined });
      expect(err.variable).toBe(name);
      expect(err.message).toContain(name);
      for (const value of Object.values(valid)) expect(err.message).not.toContain(value);
    },
  );

  it("rejects a non-integer or out-of-range port", () => {
    expect(failure({ ...valid, PORT: "abc" }).variable).toBe("PORT");
    expect(failure({ ...valid, PORT: "70000" }).variable).toBe("PORT");
  });

  it("rejects an unknown log level and node env", () => {
    expect(failure({ ...valid, LOG_LEVEL: "loud" }).variable).toBe("LOG_LEVEL");
    expect(failure({ ...valid, NODE_ENV: "staging" }).variable).toBe("NODE_ENV");
  });

  it("rejects a database url that is not postgres", () => {
    expect(failure({ ...valid, DATABASE_URL: "mysql://x" }).variable).toBe("DATABASE_URL");
  });

  it("rejects a session secret shorter than 32 bytes", () => {
    const err = failure({ ...valid, SESSION_SECRET: "x".repeat(31) });
    expect(err.variable).toBe("SESSION_SECRET");
    expect(err.message).toMatch(/32 bytes/);
    expect(err.message).not.toContain("xxx");
  });

  it("measures the secret in bytes, not characters", () => {
    expect(failure({ ...valid, SESSION_SECRET: "é".repeat(15) }).variable).toBe("SESSION_SECRET");
    expect(parseConfig({ ...valid, SESSION_SECRET: "é".repeat(16) }).SESSION_SECRET).toHaveLength(16);
  });

  it("rejects the placeholder from .env.example even though it is long enough", () => {
    expect(EXAMPLE_SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    const err = failure({ ...valid, SESSION_SECRET: EXAMPLE_SESSION_SECRET });
    expect(err.variable).toBe("SESSION_SECRET");
    expect(err.message).toMatch(/placeholder/);
    expect(err.message).not.toContain(EXAMPLE_SESSION_SECRET);
  });

  it.each([
    ["ftp://example.com", "scheme"],
    ["http://example.com/", "trailing slash"],
    ["http://example.com/app", "path"],
    ["http://example.com:80", "default port"],
    ["http://exa mple.com", "space"],
    ["http://[::1", "unparseable host"],
  ])("rejects WEB_ORIGIN %s (%s)", (origin) => {
    const err = failure({ ...valid, WEB_ORIGIN: origin });
    expect(err.variable).toBe("WEB_ORIGIN");
    expect(err.message).not.toContain(origin);
  });

  it("accepts origins with an explicit non-default port and https", () => {
    expect(parseConfig({ ...valid, WEB_ORIGIN: "https://anime.example.com" }).WEB_ORIGIN).toBe(
      "https://anime.example.com",
    );
    expect(parseConfig({ ...valid, API_ORIGIN: "http://127.0.0.1:8080" }).API_ORIGIN).toBe(
      "http://127.0.0.1:8080",
    );
  });
});
