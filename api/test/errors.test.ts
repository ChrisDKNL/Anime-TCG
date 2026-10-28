import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { createLogger } from "../src/plugins/logging.js";
import { createTestApp, FOREIGN_ORIGIN, registerProbeRoutes, WEB_ORIGIN } from "./support.js";

describe("error envelope, CSRF and rate limit", () => {
  const logged: string[] = [];
  let app: App;
  beforeAll(async () => {
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logged.push(chunk.toString());
        done();
      },
    });
    app = await createTestApp({ logger: createLogger("info", sink) });
    registerProbeRoutes(app);
  });
  afterAll(() => app.close());

  it("answers an unknown route with the 404 envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "not_found", message: "Route not found" } });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("rejects a body with an extra field as 400 validation_failed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/echo",
      headers: { origin: WEB_ORIGIN },
      payload: { name: "chris", role: "admin" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: "validation_failed", message: "body must NOT have additional properties" },
    });
  });

  it("names the failing path for a bad field and does not coerce types", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/echo",
      headers: { origin: WEB_ORIGIN },
      payload: { name: 42 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: "validation_failed", message: "body/name must be string" } });
  });

  it("rejects malformed JSON as 400 validation_failed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/echo",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("validation_failed");
  });

  it("rejects an unsupported content type as 415", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/echo",
      headers: { origin: WEB_ORIGIN, "content-type": "application/xml" },
      payload: "<name>chris</name>",
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({
      error: { code: "unsupported_media_type", message: "Unsupported content type" },
    });
  });

  it("passes a valid body through to the handler", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/echo",
      headers: { origin: WEB_ORIGIN },
      payload: { name: "chris" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "chris" });
  });

  describe("CSRF", () => {
    it("rejects a POST with no Origin and no Referer", async () => {
      const res = await app.inject({ method: "POST", url: "/test/echo", payload: { name: "chris" } });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: { code: "bad_origin", message: "Cross-origin request rejected" } });
    });

    it("rejects a POST with a foreign Origin", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/test/echo",
        headers: { origin: FOREIGN_ORIGIN },
        payload: { name: "chris" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("accepts the web origin via Origin, and via Referer when Origin is absent", async () => {
      const byOrigin = await app.inject({
        method: "POST",
        url: "/test/echo",
        headers: { origin: WEB_ORIGIN },
        payload: { name: "a" },
      });
      expect(byOrigin.statusCode).toBe(200);
      const byReferer = await app.inject({
        method: "POST",
        url: "/test/echo",
        headers: { referer: `${WEB_ORIGIN}/collection` },
        payload: { name: "a" },
      });
      expect(byReferer.statusCode).toBe(200);
    });

    it("checks the origin before the schema, so a cross-site probe learns nothing about the body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/test/echo",
        headers: { origin: FOREIGN_ORIGIN },
        payload: { nope: 1 },
      });
      expect(res.statusCode).toBe(403);
    });

    it("leaves GET alone", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/session",
        headers: { origin: FOREIGN_ORIGIN },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  it("hides an unexpected error behind 500 internal and logs it with the request id", async () => {
    const res = await app.inject({ method: "GET", url: "/test/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: "internal", message: "Something went wrong" } });
    expect(res.body).not.toContain("hunter2");
    expect(res.body).not.toContain("at ");

    const line = logged
      .map((entry) => JSON.parse(entry) as Record<string, unknown>)
      .find((entry) => entry.msg === "request failed");
    expect(line?.reqId).toEqual(expect.any(String));
    expect((line?.err as { stack: string }).stack).toContain("test/support.ts");
  });
});

describe("rate limit", () => {
  it("answers the 101st request in a minute with the 429 envelope and Retry-After", async () => {
    const app = await createTestApp();
    try {
      let last;
      for (let i = 0; i < 101; i++) last = await app.inject({ method: "GET", url: "/api/session" });
      expect(last?.statusCode).toBe(429);
      expect(last?.json()).toEqual({
        error: { code: "rate_limited", message: "Too many requests; slow down" },
      });
      expect(Number(last?.headers["retry-after"])).toBeGreaterThan(0);
      expect(last?.headers["x-ratelimit-limit"]).toBe("100");
      expect(last?.headers["x-ratelimit-remaining"]).toBe("0");
      const health = await app.inject({ method: "GET", url: "/healthz" });
      expect(health.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("keys on the client address Caddy forwards, so one abuser does not lock everyone out", async () => {
    const app = await createTestApp({
      config: (await import("./support.js")).testConfig({ RATE_LIMIT_MAX: "2" }),
    });
    try {
      const from = (ip: string) =>
        app.inject({ method: "GET", url: "/api/session", headers: { "x-forwarded-for": ip } });
      expect((await from("203.0.113.1")).statusCode).toBe(200);
      expect((await from("203.0.113.1")).statusCode).toBe(200);
      expect((await from("203.0.113.1")).statusCode).toBe(429);
      expect((await from("203.0.113.2")).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
