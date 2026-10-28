import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { createTestApp, registerProbeRoutes, testConfig, WEB_ORIGIN } from "../support.js";

/**
 * T3 adversarial cases for the origin check at the HTTP layer, where the
 * header passes through Node's parser and Fastify before `originAllowed` sees
 * it. The unit tests prove the comparison; these prove nothing in between
 * normalises, trims or falls back in the attacker's favour.
 */
describe("CSRF origin check, adversarial", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
    registerProbeRoutes(app);
  });
  afterAll(() => app.close());

  const post = (headers: Record<string, string>) =>
    app.inject({ method: "POST", url: "/test/echo", headers, payload: { name: "a" } });

  it.each([
    ["a trailing slash", `${WEB_ORIGIN}/`],
    ["a path", `${WEB_ORIGIN}/collection`],
    ["a repeated port", `${WEB_ORIGIN}:5173`],
    ["the host without its port", "http://localhost"],
    ["the port on a different host", "http://127.0.0.1:5173"],
    ["a longer port", `${WEB_ORIGIN}0`],
    ["a suffix that makes it a different host", `${WEB_ORIGIN}.evil.example`],
    ["the host as a subdomain of the attacker", "http://localhost:5173.evil.example"],
    ["upper-case scheme and host", "HTTP://LOCALHOST:5173"],
    ["https instead of http", "https://localhost:5173"],
    ["userinfo in front of the host", "http://localhost:5173@evil.example"],
    ["the opaque origin", "null"],
    ["the web origin in a query of another", `http://evil.example/?${WEB_ORIGIN}`],
    ["the web origin after a fragment", `http://evil.example/#${WEB_ORIGIN}`],
    ["leading whitespace", ` ${WEB_ORIGIN}`],
    ["trailing whitespace", `${WEB_ORIGIN} `],
    ["an embedded NUL", `${WEB_ORIGIN}\u0000`],
    ["an empty value", ""],
  ])("rejects an Origin with %s", async (_label, origin) => {
    const res = await post({ origin });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: "bad_origin", message: "Cross-origin request rejected" } });
  });

  it("does not fall back to a matching Referer when Origin is present and wrong", async () => {
    for (const origin of ["null", "http://evil.example", ""]) {
      const res = await post({ origin, referer: `${WEB_ORIGIN}/page` });
      expect(res.statusCode).toBe(403);
    }
  });

  it.each([
    ["a different host", "http://evil.example/page"],
    ["the web origin as a path", `http://evil.example/${WEB_ORIGIN}`],
    ["the web origin as a query", `http://evil.example/?next=${WEB_ORIGIN}`],
    ["the web origin as userinfo", `http://${WEB_ORIGIN.slice("http://".length)}@evil.example/`],
    ["a suffix host", `${WEB_ORIGIN}.evil.example/`],
    ["a scheme-relative value", "//localhost:5173/"],
    ["not a URL", "localhost:5173"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["an empty value", ""],
  ])("rejects a Referer with %s when Origin is absent", async (_label, referer) => {
    const res = await post({ referer });
    expect(res.statusCode).toBe(403);
  });

  it("applies to every non-GET method on every path, including unknown and non-api ones", async () => {
    for (const [method, url] of [
      ["POST", "/healthz"],
      ["PUT", "/api/session"],
      ["PATCH", "/api/session"],
      ["DELETE", "/api/nope"],
      ["OPTIONS", "/api/session"],
      ["POST", "/"],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json<{ error: { code: string } }>().error.code).toBe("bad_origin");
    }
  });

  it("with an https production origin, rejects the default-port and http variants a forged header could carry", async () => {
    const prod = await createTestApp({
      config: testConfig({
        WEB_ORIGIN: "https://anime.example.com",
        API_ORIGIN: "https://anime.example.com",
      }),
    });
    registerProbeRoutes(prod);
    try {
      const attempt = (origin: string) =>
        prod.inject({ method: "POST", url: "/test/echo", headers: { origin }, payload: { name: "a" } });
      expect((await attempt("https://anime.example.com")).statusCode).toBe(200);
      for (const origin of [
        "https://anime.example.com:443",
        "http://anime.example.com",
        "https://anime.example.com/",
        "https://ANIME.example.com",
        "https://anime.example.com.evil.example",
        "https://evil-anime.example.com",
        "https://anime.example.com:8443",
      ]) {
        expect((await attempt(origin)).statusCode, origin).toBe(403);
      }
    } finally {
      await prod.close();
    }
  });
});
