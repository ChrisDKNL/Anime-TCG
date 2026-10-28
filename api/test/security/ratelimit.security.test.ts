import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
