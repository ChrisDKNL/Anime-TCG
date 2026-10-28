import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { createTestApp, testConfig } from "./support.js";

describe("GET /healthz", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it("is 200 ok/ok when the database answers", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("sets no-store and nosniff but is not rate-limited", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("says nothing about versions or hosts", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(Object.keys(res.json<object>())).toEqual(["status", "db"]);
    expect(res.headers.server).toBeUndefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("is 503 down/down when the pool points at a dead port", async () => {
    const dead = await createTestApp({ db: createDb("postgres://anime:anime@127.0.0.1:1/anime") });
    try {
      const res = await dead.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: "down", db: "down" });
    } finally {
      await dead.close();
    }
  });

  it("accepts the config's own database url for the test database", () => {
    expect(testConfig().DATABASE_URL).toMatch(/^postgres/);
  });
});
