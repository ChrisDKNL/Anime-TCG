import { describe, expect, it } from "vitest";
import { ConfigError, databaseUser, EXAMPLE_SESSION_SECRET, parseConfig } from "./config.js";

const SECRET = "unit-test-session-secret-not-for-real-use-0123456789";

const valid = {
  DATABASE_URL: "postgres://anime_app:anime_app@127.0.0.1:5432/anime",
  MIGRATIONS_DATABASE_URL: "postgres://anime:anime@127.0.0.1:5432/anime",
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

  it.each(["DATABASE_URL", "MIGRATIONS_DATABASE_URL", "SESSION_SECRET", "API_ORIGIN", "WEB_ORIGIN"])(
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
    expect(failure({ ...valid, MIGRATIONS_DATABASE_URL: "mysql://x" }).variable).toBe(
      "MIGRATIONS_DATABASE_URL",
    );
  });

  it("rejects the same role in DATABASE_URL and MIGRATIONS_DATABASE_URL, without echoing either", () => {
    const err = failure({ ...valid, MIGRATIONS_DATABASE_URL: "postgres://anime_app:other@db:5432/anime" });
    expect(err.variable).toBe("MIGRATIONS_DATABASE_URL");
    expect(err.message).toMatch(/different role/);
    expect(err.message).not.toContain("anime_app:");
    expect(err.message).not.toContain("other");
  });

  it("compares the role only, not the password, host or database", () => {
    const config = parseConfig({
      ...valid,
      DATABASE_URL: "postgresql://anime_app:pw1@[::1]:5433/other",
      MIGRATIONS_DATABASE_URL: "postgres://anime:pw1@[::1]:5433/other",
    });
    expect(databaseUser(config.DATABASE_URL)).toBe("anime_app");
    expect(databaseUser(config.MIGRATIONS_DATABASE_URL)).toBe("anime");
  });

  it("rejects a url that names no role at all", () => {
    expect(failure({ ...valid, DATABASE_URL: "postgres://127.0.0.1:5432/anime" }).variable).toBe(
      "DATABASE_URL",
    );
    expect(failure({ ...valid, DATABASE_URL: "postgres://:pw@127.0.0.1/anime" }).variable).toBe(
      "DATABASE_URL",
    );
    expect(failure({ ...valid, MIGRATIONS_DATABASE_URL: "postgres://@db/anime" }).variable).toBe(
      "MIGRATIONS_DATABASE_URL",
    );
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

describe("parseConfig edge cases", () => {
  it("never echoes credentials from a rejected DATABASE_URL or origin", () => {
    const db = failure({ ...valid, DATABASE_URL: "mysql://anime:hunter2@db.internal:3306/anime" });
    expect(db.variable).toBe("DATABASE_URL");
    expect(db.message).not.toContain("hunter2");
    expect(db.message).not.toContain("db.internal");

    const origin = failure({ ...valid, WEB_ORIGIN: "https://owner:hunter2@anime.example.com" });
    expect(origin.variable).toBe("WEB_ORIGIN");
    expect(origin.message).not.toContain("hunter2");
  });

  it("accepts the postgresql:// spelling and an IPv6 literal origin", () => {
    expect(
      parseConfig({ ...valid, DATABASE_URL: "postgresql://anime_app:anime_app@[::1]:5432/anime" })
        .DATABASE_URL,
    ).toMatch(/^postgresql:/);
    expect(parseConfig({ ...valid, WEB_ORIGIN: "http://[::1]:5173" }).WEB_ORIGIN).toBe("http://[::1]:5173");
  });

  it("accepts only the canonical form of an origin: lower-case host, no default port", () => {
    expect(failure({ ...valid, WEB_ORIGIN: "http://Localhost:5173" }).variable).toBe("WEB_ORIGIN");
    expect(failure({ ...valid, WEB_ORIGIN: "HTTP://localhost:5173" }).variable).toBe("WEB_ORIGIN");
    expect(failure({ ...valid, API_ORIGIN: "https://anime.example.com:443" }).variable).toBe("API_ORIGIN");
    expect(failure({ ...valid, API_ORIGIN: "https://anime.example.com?x=1" }).variable).toBe("API_ORIGIN");
    expect(failure({ ...valid, API_ORIGIN: "https://anime.example.com#top" }).variable).toBe("API_ORIGIN");
  });

  it("accepts port 0 (OS-assigned) and the top of the range, rejects out-of-range and non-numeric ports", () => {
    expect(parseConfig({ ...valid, PORT: "0" }).PORT).toBe(0);
    expect(parseConfig({ ...valid, PORT: "65535" }).PORT).toBe(65535);
    for (const port of ["-1", "65536", "abc", "3000abc"]) {
      expect(failure({ ...valid, PORT: port }).variable, port).toBe("PORT");
    }
  });

  /**
   * Regression (fixed in #20): TypeBox's `Value.Convert` used to coerce "3000.5",
   * "1e3" and "true" to integers before validation, so a mistyped number was
   * silently accepted as a different number instead of failing fast.
   */
  it("rejects a non-integer numeric string rather than silently truncating it", () => {
    for (const port of ["3000.5", "1e3", "true"]) {
      expect(failure({ ...valid, PORT: port }).variable, port).toBe("PORT");
    }
    expect(failure({ ...valid, RATE_LIMIT_MAX: "10.9" }).variable).toBe("RATE_LIMIT_MAX");
  });

  it("rejects a zero rate limit and a window under one second", () => {
    expect(failure({ ...valid, RATE_LIMIT_MAX: "0" }).variable).toBe("RATE_LIMIT_MAX");
    expect(failure({ ...valid, RATE_LIMIT_MAX: "-5" }).variable).toBe("RATE_LIMIT_MAX");
    expect(failure({ ...valid, RATE_LIMIT_WINDOW_MS: "999" }).variable).toBe("RATE_LIMIT_WINDOW_MS");
    expect(parseConfig({ ...valid, RATE_LIMIT_WINDOW_MS: "1000" }).RATE_LIMIT_WINDOW_MS).toBe(1000);
  });

  it("accepts a secret of exactly 32 bytes and rejects one padded to 32 with whitespace only by its bytes", () => {
    expect(parseConfig({ ...valid, SESSION_SECRET: "x".repeat(32) }).SESSION_SECRET).toHaveLength(32);
    // Whitespace is bytes too: the check is length, not entropy. Documented here so nobody mistakes it for a strength check.
    expect(parseConfig({ ...valid, SESSION_SECRET: `${"x".repeat(31)} ` }).SESSION_SECRET).toHaveLength(32);
    expect(failure({ ...valid, SESSION_SECRET: "" }).variable).toBe("SESSION_SECRET");
  });

  it("treats empty required variables as missing rather than as empty values", () => {
    expect(failure({ ...valid, SESSION_SECRET: "" }).message).toMatch(/required/i);
    expect(failure({ ...valid, WEB_ORIGIN: "" }).message).toMatch(/required/i);
  });

  it("does not let an unknown variable with a known-looking name leak in", () => {
    const config = parseConfig({ ...valid, session_secret: "lower", WEB_ORIGIN_: "x", "WEB_ORIGIN ": "y" });
    expect(config.SESSION_SECRET).toBe(SECRET);
    expect(Object.keys(config).sort()).toEqual([
      "API_ORIGIN",
      "DATABASE_URL",
      "HOST",
      "LOG_LEVEL",
      "MIGRATIONS_DATABASE_URL",
      "NODE_ENV",
      "PORT",
      "RATE_LIMIT_MAX",
      "RATE_LIMIT_WINDOW_MS",
      "SESSION_SECRET",
      "WEB_ORIGIN",
    ]);
  });
});
