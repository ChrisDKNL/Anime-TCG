import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import type { App } from "../../src/app.js";
import { createTestApp, testConfig } from "../support.js";

/**
 * T3: the limiter keys on the client address, so the address must not be
 * something the client chooses. `trustProxy` is "loopback, uniquelocal":
 * `X-Forwarded-For` counts only when it arrives from Caddy (compose network)
 * or Vite (loopback); from anywhere else it is just another header.
 */
describe("rate limit keying, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ RATE_LIMIT_MAX: "2" }) });
  });
  afterAll(() => app.close());

  const get = (remoteAddress: string, headers: Record<string, string> = {}) =>
    app.inject({ method: "GET", url: "/api/session", remoteAddress, headers });

  it("ignores X-Forwarded-For from a socket that is not a trusted proxy", async () => {
    // Three different claimed clients, one real socket address: the third is over the limit.
    expect((await get("203.0.113.50", { "x-forwarded-for": "10.0.0.1" })).statusCode).toBe(200);
    expect((await get("203.0.113.50", { "x-forwarded-for": "10.0.0.2" })).statusCode).toBe(200);
    const third = await get("203.0.113.50", { "x-forwarded-for": "10.0.0.3" });
    expect(third.statusCode).toBe(429);
    expect(third.json()).toEqual({
      error: { code: "rate_limited", message: "Too many requests; slow down" },
    });
    // And another real address is unaffected.
    expect((await get("203.0.113.51")).statusCode).toBe(200);
  });

  it("behind a trusted proxy, uses the address the proxy appended, not one the client prepended", async () => {
    // Caddy appends the real client; a client-supplied leftmost entry is attacker-controlled.
    expect((await get("127.0.0.1", { "x-forwarded-for": "198.51.100.1, 203.0.113.9" })).statusCode).toBe(200);
    expect((await get("127.0.0.1", { "x-forwarded-for": "198.51.100.2, 203.0.113.9" })).statusCode).toBe(200);
    expect((await get("127.0.0.1", { "x-forwarded-for": "198.51.100.3, 203.0.113.9" })).statusCode).toBe(429);
    expect((await get("127.0.0.1", { "x-forwarded-for": "198.51.100.3, 203.0.113.10" })).statusCode).toBe(
      200,
    );
  });

  it("trusts a proxy on the compose network (RFC 1918) the same way", async () => {
    expect((await get("172.18.0.2", { "x-forwarded-for": "203.0.113.77" })).statusCode).toBe(200);
    expect((await get("172.18.0.2", { "x-forwarded-for": "203.0.113.77" })).statusCode).toBe(200);
    expect((await get("172.18.0.2", { "x-forwarded-for": "203.0.113.77" })).statusCode).toBe(429);
    expect((await get("172.18.0.2", { "x-forwarded-for": "203.0.113.78" })).statusCode).toBe(200);
  });

  it("does not let a garbage X-Forwarded-For value crash the request or escape the limit", async () => {
    for (const value of ["not-an-ip", ",,,", "::ffff:", " ", "256.256.256.256"]) {
      const res = await get("127.0.0.1", { "x-forwarded-for": value });
      expect([200, 429], value).toContain(res.statusCode);
    }
    // Every one of those collapses to the same key or to the socket address; a fresh real client still gets in.
    expect((await get("203.0.113.60")).statusCode).toBe(200);
  });

  it("counts unknown-route GETs toward the same limit", async () => {
    const abuser = "203.0.113.99";
    expect((await app.inject({ method: "GET", url: "/api/nope", remoteAddress: abuser })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: "GET", url: "/api/nope2", remoteAddress: abuser })).statusCode).toBe(
      404,
    );
    expect((await get(abuser)).statusCode).toBe(429);
  });

  /**
   * Regression (fixed in #20): the CSRF hook used to run before the per-route
   * limiter, so a cross-site POST flood was rejected with 403 but never counted.
   */
  it("counts rejected cross-site POSTs toward the limit, on existing and unknown routes", async () => {
    const existing = "203.0.113.100";
    expect(
      (await app.inject({ method: "POST", url: "/api/session", remoteAddress: existing })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "POST", url: "/api/session", remoteAddress: existing })).statusCode,
    ).toBe(403);
    expect((await get(existing)).statusCode).toBe(429);

    const unknown = "203.0.113.101";
    expect((await app.inject({ method: "POST", url: "/api/nope", remoteAddress: unknown })).statusCode).toBe(
      403,
    );
    expect((await app.inject({ method: "POST", url: "/api/nope", remoteAddress: unknown })).statusCode).toBe(
      403,
    );
    expect((await get(unknown)).statusCode).toBe(429);
  });
});

/**
 * A route's own `config.rateLimit` replaces the global bucket for that route;
 * it does not stack on it (upstream semantics: one limiter counts per
 * request). The override still runs first, before CSRF and the session
 * lookup. Regression: before this fix the instance-wide hook always used the
 * global bucket and the plugin's route-level hook returned early, so an
 * override was silently ignored.
 */
describe("per-route rate limit overrides", () => {
  const GLOBAL_MAX = 3;
  const Ok = Type.Object({ ok: Type.Boolean() }, { additionalProperties: false });
  let app: App;
  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ RATE_LIMIT_MAX: String(GLOBAL_MAX) }) });
    app.get(
      "/test/limited",
      { schema: { response: { 200: Ok } }, config: { rateLimit: { max: 1, timeWindow: 60_000 } } },
      () => ({ ok: true }),
    );
  });
  afterAll(() => app.close());

  const get = (url: string, remoteAddress: string) => app.inject({ method: "GET", url, remoteAddress });

  it("limits a route carrying config.rateLimit by that override, with the shared envelope", async () => {
    const client = "203.0.113.110";
    const first = await get("/test/limited", client);
    expect(first.statusCode).toBe(200);
    expect(first.headers["x-ratelimit-limit"]).toBe("1");
    const second = await get("/test/limited", client);
    expect(second.statusCode).toBe(429);
    expect(second.headers["x-ratelimit-limit"]).toBe("1");
    expect(second.json()).toEqual({
      error: { code: "rate_limited", message: "Too many requests; slow down" },
    });
  });

  it("keeps the override bucket and the global bucket independent (replace, not stack)", async () => {
    // Hits on the override route do not spend the global quota...
    const client = "203.0.113.111";
    expect((await get("/test/limited", client)).statusCode).toBe(200);
    expect((await get("/test/limited", client)).statusCode).toBe(429);
    const sibling = await get("/api/session", client);
    expect(sibling.statusCode).toBe(200);
    expect(sibling.headers["x-ratelimit-remaining"]).toBe(String(GLOBAL_MAX - 1));

    // ...and an exhausted global quota does not close the override route.
    const other = "203.0.113.112";
    for (let i = 0; i < GLOBAL_MAX; i += 1) expect((await get("/api/session", other)).statusCode).toBe(200);
    expect((await get("/api/session", other)).statusCode).toBe(429);
    expect((await get("/test/limited", other)).statusCode).toBe(200);
  });

  it("leaves a sibling route without an override on the global limit", async () => {
    const res = await get("/api/session", "203.0.113.113");
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBe(String(GLOBAL_MAX));
  });

  it("still exempts a route with config.rateLimit: false", async () => {
    const client = "203.0.113.114";
    for (let i = 0; i < GLOBAL_MAX + 1; i += 1) {
      const res = await get("/healthz", client);
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
    }
  });
});
