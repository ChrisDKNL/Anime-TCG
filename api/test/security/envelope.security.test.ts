import { Type } from "@sinclair/typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { ApiError } from "../../src/domain/errors.js";
import { createTestApp, FOREIGN_ORIGIN, registerProbeRoutes, WEB_ORIGIN } from "../support.js";

/**
 * T3: every error path, not just the happy one, emits exactly the envelope
 * and exactly the api's headers. A route's `response` schema does not cover
 * the statuses the error plugin produces, so the envelope's shape rests on
 * `errorEnvelopeFor` alone; these tests pin that from the outside.
 */
describe("error envelope on every error path, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
    registerProbeRoutes(app);
    app.get(
      "/test/decorated-error",
      { schema: { response: { 200: Type.Object({ ok: Type.Boolean() }) } } },
      () => {
        // A future domain error might carry context for the log; none of it may reach the client.
        throw Object.assign(new ApiError(409, "bad_request", "Already exists"), {
          details: { accountId: "0b7a1b2c", passwordHash: "$argon2id$leak" },
          cause: new Error("duplicate key value violates unique constraint accounts_login_key"),
        });
      },
    );
    app.get("/test/stringy-error", () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the point is a non-Error reaching the handler
      throw "a bare string from postgres://anime:hunter2@db";
    });
    app.get("/test/status-error", () => {
      const err = Object.assign(new Error("deep internal detail"), { statusCode: 418 });
      throw err;
    });
  });
  afterAll(() => app.close());

  const paths: [
    string,
    () => Promise<{ statusCode: number; json: <T>() => T; headers: Record<string, unknown>; body: string }>,
  ][] = [
    [
      "403 cross-site POST",
      () =>
        app.inject({
          method: "POST",
          url: "/test/echo",
          headers: { origin: FOREIGN_ORIGIN },
          payload: { name: "a" },
        }),
    ],
    [
      "400 extra field",
      () =>
        app.inject({
          method: "POST",
          url: "/test/echo",
          headers: { origin: WEB_ORIGIN },
          payload: { name: "a", x: 1 },
        }),
    ],
    ["404 unknown route", () => app.inject({ method: "GET", url: "/api/does-not-exist" })],
    [
      "413 oversized body",
      () =>
        app.inject({
          method: "POST",
          url: "/test/echo",
          headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
          payload: JSON.stringify({ name: "x".repeat(70 * 1024) }),
        }),
    ],
    [
      "415 wrong content type",
      () =>
        app.inject({
          method: "POST",
          url: "/test/echo",
          headers: { origin: WEB_ORIGIN, "content-type": "text/plain" },
          payload: "name=a",
        }),
    ],
    ["500 thrown Error", () => app.inject({ method: "GET", url: "/test/boom" })],
    ["500 thrown string", () => app.inject({ method: "GET", url: "/test/stringy-error" })],
    [
      "500 unexpected error with a 4xx statusCode outside the fixed map",
      () => app.inject({ method: "GET", url: "/test/status-error" }),
    ],
    [
      "409 ApiError decorated with extra properties",
      () => app.inject({ method: "GET", url: "/test/decorated-error" }),
    ],
  ];

  it.each(paths)("%s: envelope only, api headers, nothing else", async (_label, send) => {
    const res = await send();
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const body = res.json<{ error: Record<string, unknown> }>();
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(typeof body.error.code).toBe("string");
    expect(typeof body.error.message).toBe("string");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.headers["set-cookie"]).toBeUndefined();
    for (const needle of [
      "hunter2",
      "argon2",
      "0b7a1b2c",
      "unique constraint",
      "deep internal",
      "    at ",
      "stack",
    ]) {
      expect(res.body, needle).not.toContain(needle);
    }
  });

  it("an ApiError's own status and code survive while its extra properties do not", async () => {
    const res = await app.inject({ method: "GET", url: "/test/decorated-error" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: "bad_request", message: "Already exists" } });
  });

  it("an error with a 4xx status the api does not know is not trusted: it becomes a 500 internal", async () => {
    const res = await app.inject({ method: "GET", url: "/test/status-error" });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({ error: { code: "bad_request", message: "Request could not be processed" } });
  });

  it("a 404 for a path that looks like a file does not turn into a different content type", async () => {
    for (const url of ["/api/session.json", "/api/../etc/passwd", "/api/session%00", "/api/session/"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers["content-type"], url).toMatch(/^application\/json/);
      expect(res.json()).toEqual({ error: { code: "not_found", message: "Route not found" } });
    }
  });
});
