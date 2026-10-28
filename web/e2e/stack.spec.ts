import { expect, test } from "@playwright/test";

/**
 * Test plan: the deployed stack, through Caddy (spec §7, e2e).
 *
 * Runs only when STACK_URL points at a running compose stack (acceptance or
 * production profile), e.g. `STACK_URL=http://127.0.0.1:8080 npm run test:e2e -w web`;
 * without it the suite is skipped, so the default e2e run stays self-contained.
 * Nothing here touches AniList: every request goes to Caddy or, via Caddy, to the api.
 *
 * - Caddy's own /healthz answers the plain text "ok".
 * - GET /api/session is proxied to the api: {"signedIn":false}, no-store, nosniff,
 *   and Caddy's site-wide CSP and hardening headers on the proxied response too.
 * - The CSP is byte-for-byte the one in the Caddyfile (a silent relaxation would pass a looser check).
 * - No Server or Via header leaks from either layer (mirrors the CI docker job).
 * - A POST without an Origin is refused by the api's CSRF check with the 403 envelope.
 * - The api's own /healthz is not reachable through Caddy (it is the container healthcheck, not public).
 * - The SPA shell is served for an unknown path with the no-cache policy.
 */

const STACK_URL = process.env.STACK_URL?.replace(/\/$/, "");

// Must match the Caddyfile byte for byte; mirrored in .github/workflows/ci.yml.
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://s4.anilist.co; connect-src 'self' https://graphql.anilist.co; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

test.describe("deployed stack through Caddy", () => {
  test.skip(!STACK_URL, "set STACK_URL to a running compose stack, e.g. http://127.0.0.1:8080");

  test("/healthz answers ok", async ({ request }) => {
    const res = await request.get(`${STACK_URL}/healthz`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(res.headers()["server"]).toBeUndefined();
    expect(res.headers()["via"]).toBeUndefined();
  });

  test("GET /api/session reaches the api and comes back signed out with the security headers", async ({
    request,
  }) => {
    const res = await request.get(`${STACK_URL}/api/session`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('{"signedIn":false}');
    const headers = res.headers();
    expect(headers["content-type"]).toMatch(/^application\/json/);
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toBe(EXPECTED_CSP);
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(headers["server"]).toBeUndefined();
    expect(headers["via"]).toBeUndefined();
    expect(headers["set-cookie"]).toBeUndefined();
  });

  test("the SPA shell carries the exact CSP and is never cached", async ({ request }) => {
    const res = await request.get(`${STACK_URL}/some/client/route`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^text\/html/);
    expect(res.headers()["content-security-policy"]).toBe(EXPECTED_CSP);
    expect(res.headers()["cache-control"]).toBe("no-cache");
    expect(res.headers()["server"]).toBeUndefined();
    expect(res.headers()["via"]).toBeUndefined();
    expect(await res.text()).toContain("<title>Anime TCG");
  });

  test("a POST without an Origin is refused by the api with the 403 envelope", async ({ request }) => {
    const res = await request.post(`${STACK_URL}/api/session`, { data: {} });
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "bad_origin", message: "Cross-origin request rejected" },
    });
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  test("a POST with a foreign Origin is refused too", async ({ request }) => {
    const res = await request.post(`${STACK_URL}/api/session`, {
      data: {},
      headers: { origin: "http://evil.example" },
    });
    expect(res.status()).toBe(403);
  });

  test("an unknown api route answers the 404 envelope, not the SPA shell", async ({ request }) => {
    const res = await request.get(`${STACK_URL}/api/does-not-exist`);
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Route not found" } });
  });

  test("the api's own /healthz is not exposed through the proxy", async ({ request }) => {
    // /healthz is Caddy's; the api's version (with the db field) must only be reachable inside the network.
    const res = await request.get(`${STACK_URL}/healthz`);
    expect(await res.text()).not.toContain("db");
    const viaApi = await request.get(`${STACK_URL}/api/healthz`);
    expect(viaApi.status()).toBe(404);
  });
});
