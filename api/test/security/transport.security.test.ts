import { connect } from "node:net";
import { Type } from "@sinclair/typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { createTestApp, FOREIGN_ORIGIN, registerProbeRoutes, WEB_ORIGIN } from "../support.js";

/** T3 adversarial cases for the transport layer: header injection, oversized bodies, stalled connections, response leaks. */
describe("transport, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp({ connectionTimeout: 300 });
    registerProbeRoutes(app);
    app.get(
      "/test/leaky",
      { schema: { response: { 200: Type.Object({ ok: Type.Boolean() }, { additionalProperties: false }) } } },
      () => ({
        ok: true,
        passwordHash: "$argon2id$leak",
        email: "owner@example.com",
      }),
    );
  });
  afterAll(() => app.close());

  it("header injection through Origin is rejected and never reflected", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/echo",
      headers: { origin: `${WEB_ORIGIN}\r\nX-Injected: 1` },
      payload: { name: "a" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["x-injected"]).toBeUndefined();
    expect(res.body).not.toContain(WEB_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("a foreign Origin is not echoed in any CORS header", async () => {
    const res = await app.inject({ method: "GET", url: "/api/session", headers: { origin: FOREIGN_ORIGIN } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("a 2 MB body is refused with 413 before it reaches any handler", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/echo",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(2 * 1024 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({
      error: { code: "payload_too_large", message: "Request body is too large" },
    });
  });

  it("a slowloris-style connection that never finishes its request is closed by the inactivity timeout", async () => {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = new URL(address);
    const started = Date.now();
    const closedAfterMs = await new Promise<number>((resolve, reject) => {
      const socket = connect(Number(port), "127.0.0.1", () => {
        socket.write("GET /api/session HTTP/1.1\r\nHost: localhost\r\nX-Slow: ");
      });
      socket.on("close", () => resolve(Date.now() - started));
      socket.on("error", reject);
    });
    expect(closedAfterMs).toBeGreaterThanOrEqual(250);
    expect(closedAfterMs).toBeLessThan(5_000);
  });

  it("the response schema strips fields the handler did not declare", async () => {
    const res = await app.inject({ method: "GET", url: "/test/leaky" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.body).not.toContain("argon2");
    expect(res.body).not.toContain("owner@example.com");
  });

  it("every response, including errors, says no-store and nosniff", async () => {
    for (const url of ["/api/session", "/nope", "/test/boom"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    }
  });
});
