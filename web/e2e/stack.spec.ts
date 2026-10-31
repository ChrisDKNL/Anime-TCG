import { expect, test, type APIResponse } from "@playwright/test";
import { mockCardImages } from "./support/fake-api";

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
 * - POST /api/session/login with a foreign Origin is 403 bad_origin through Caddy and sets no
 *   cookie: the origin check runs before any credential is looked at (accounts-api spec §9, e2e).
 * - The api's own /healthz is not reachable through Caddy (it is the container healthcheck, not public).
 * - The SPA shell is served for an unknown path with the no-cache policy.
 *
 * Hosting for the routed app (docs/design/navigation-and-landing.md §3.12):
 * - Every page address (/packs, /collection, /account, /login) and an unknown one answers index.html
 *   with 200, the exact CSP, the hardening headers, no-cache and no Server or Via; the shell's title is
 *   `Anime TCG` and its asset URLs are absolute, so it works at any depth.
 * - /api itself goes to the api (its JSON 404), like every path under it; never the app shell.
 * - A missing /assets file is a plain 404, never index.html, with the site headers and no Server, and
 *   without the year-long cache an existing asset keeps.
 * - /packs/ is served the shell too (the app replaces it with /packs); /apix is not the api.
 * - /healthz stays Caddy's own `ok`, whatever the fallback.
 * - (tester) /assets without a slash is the shell like any page address, not a listing, with no-cache.
 * - In a browser through Caddy: a deep link signed out lands on /login with its guard line and survives a
 *   reload; an unknown path is the not-found page (§3.12 item 8). AniList's image CDN is mocked.
 * - An error Caddy answers itself (a POST to a page: 405) keeps the site headers, sends no Server and
 *   has an empty body; with STACK_API_DOWN=1 against a stack whose api is stopped, so does the 502 for /api.
 * - (tester, visual-identity.md §4.1, §11.1) /licenses/fonts.txt is text/plain, no-cache, with the site
 *   headers and the three OFL texts; in a browser under the real CSP the three families load from
 *   /assets as font/woff2 with the long cache, and no font is refused.
 */

const STACK_URL = process.env.STACK_URL?.replace(/\/$/, "");

// Must match the Caddyfile byte for byte; mirrored in .github/workflows/ci.yml.
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://s4.anilist.co; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

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

  test("POST /api/session/login with a foreign Origin is 403 bad_origin and sets no cookie", async ({
    request,
  }) => {
    const res = await request.post(`${STACK_URL}/api/session/login`, {
      data: { login: "nobody", password: "not a password" },
      headers: { origin: "http://evil.example" },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "bad_origin", message: "Cross-origin request rejected" },
    });
    expect(res.headers()["set-cookie"]).toBeUndefined();
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  test("an unknown api route answers the 404 envelope, not the SPA shell", async ({ request }) => {
    const res = await request.get(`${STACK_URL}/api/does-not-exist`);
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Route not found" } });
  });

  test("/api itself reaches the api and answers its 404 envelope, not the app shell", async ({ request }) => {
    for (const path of ["/api", "/api/"]) {
      const res = await request.get(`${STACK_URL}${path}`);
      expect(res.status(), path).toBe(404);
      expect(res.headers()["content-type"], path).toMatch(/^application\/json/);
      expect(await res.json(), path).toEqual({ error: { code: "not_found", message: "Route not found" } });
    }
  });

  for (const path of [
    "/demo",
    "/packs",
    "/packs/open",
    "/shop/open",
    "/collection",
    "/account",
    "/login",
    "/no-such-page",
    "/packs/1",
    "/packs/",
    "/apix",
  ]) {
    test(`${path} answers the app shell with 200, the exact CSP, the headers and no-cache`, async ({
      request,
    }) => {
      const res = await request.get(`${STACK_URL}${path}`);
      expect(res.status()).toBe(200);
      const headers = res.headers();
      expect(headers["content-type"]).toMatch(/^text\/html/);
      expect(headers["content-security-policy"]).toBe(EXPECTED_CSP);
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
      expect(headers["cache-control"]).toBe("no-cache");
      expect(headers["server"]).toBeUndefined();
      expect(headers["via"]).toBeUndefined();
      const html = await res.text();
      expect(html).toContain("<title>Anime TCG</title>");
      // Absolute asset URLs (Vite base `/`), so the shell loaded at /packs/1 still finds its script.
      expect(html).toMatch(/src="\/assets\/[^"]+\.js"/);
      expect(html).not.toMatch(/(src|href)="(\.\/|assets\/)/);
    });
  }

  test("a missing asset is a plain 404, never the app shell, with the site headers", async ({ request }) => {
    for (const path of ["/assets/no-such-chunk-0000.js", "/assets/"]) {
      const res = await request.get(`${STACK_URL}${path}`);
      expect(res.status(), path).toBe(404);
      const headers = res.headers();
      expect(headers["content-type"] ?? "", path).not.toMatch(/text\/html/);
      expect(await res.text(), path).not.toContain("<!doctype html>");
      expect(headers["content-security-policy"], path).toBe(EXPECTED_CSP);
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["server"], path).toBeUndefined();
      // Only an existing, content-hashed file is cached for a year; a miss is asked for again.
      expect(headers["cache-control"] ?? "", path).not.toContain("immutable");
    }
  });

  test("/assets without a slash is the app shell like any other page address, never a listing or a long cache", async ({
    request,
  }) => {
    // `/assets` is not under `/assets/`, so it is an address like `/no-such-page`: the shell, which the app
    // shows as the not-found page (owner decision 4). It must not be a file_server directory listing.
    const res = await request.get(`${STACK_URL}/assets`);
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["content-type"]).toMatch(/^text\/html/);
    expect(headers["content-security-policy"]).toBe(EXPECTED_CSP);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toBe("no-cache");
    expect(headers["server"]).toBeUndefined();
    const html = await res.text();
    expect(html).toContain("<title>Anime TCG</title>");
    expect(html).not.toMatch(/<a href="[^"]*\.js"/);
  });

  test("an existing asset keeps its long cache policy", async ({ request }) => {
    const shell = await (await request.get(`${STACK_URL}/`)).text();
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(shell)?.[1];
    expect(script, "the shell names its script").toBeDefined();
    const res = await request.get(`${STACK_URL}${script}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("/healthz stays Caddy's own ok next to the fallback", async ({ request }) => {
    const res = await request.get(`${STACK_URL}/healthz`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^text\/plain/);
    expect(await res.text()).toBe("ok");
  });

  test("in a browser through Caddy: a deep link signed out lands on /login, a reload keeps it, an unknown path is the not-found page", async ({
    page,
  }) => {
    await mockCardImages(page);
    await page.goto(`${STACK_URL}/collection`);
    await expect(page).toHaveURL(`${STACK_URL}/login`);
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
    await expect(page.getByText("Log in to see your collection.")).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(`${STACK_URL}/login`);
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();

    const response = await page.goto(`${STACK_URL}/no-such-page`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found · Anime TCG");
  });

  test("the api's own /healthz is not exposed through the proxy", async ({ request }) => {
    // /healthz is Caddy's; the api's version (with the db field) must only be reachable inside the network.
    const res = await request.get(`${STACK_URL}/healthz`);
    expect(await res.text()).not.toContain("db");
    const viaApi = await request.get(`${STACK_URL}/api/healthz`);
    expect(viaApi.status()).toBe(404);
  });

  test("an error Caddy answers itself keeps the site headers, sends no Server and has an empty body", async ({
    request,
  }) => {
    // file_server serves GET and HEAD only, so a POST to a page is Caddy's own 405: the same error
    // path a 502 from a stopped api takes (handle_errors in the Caddyfile).
    const res = await request.post(`${STACK_URL}/packs`, { headers: { Origin: STACK_URL ?? "" } });
    await expectErrorResponse(res, 405);
    expect(res.headers()["allow"]).toBe("GET, HEAD");
  });

  // (tester) The identity's fonts and their licence through Caddy (visual-identity.md §4.1, §11.1).
  test("/licenses/fonts.txt is the three OFL texts as text/plain, revalidated on every load, with the site headers", async ({
    request,
  }) => {
    const res = await request.get(`${STACK_URL}/licenses/fonts.txt`);
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["content-type"]).toMatch(/^text\/plain/);
    // Not under /assets and not content-hashed: a font update changes it in place, so it is never cached for good.
    expect(headers["cache-control"]).toBe("no-cache");
    expect(headers["content-security-policy"]).toBe(EXPECTED_CSP);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["server"]).toBeUndefined();
    const text = await res.text();
    expect(text).not.toContain("<!doctype html>");
    expect(text.match(/SIL OPEN FONT LICENSE Version 1\.1/g)).toHaveLength(3);
    for (const name of ["bricolage-grotesque", "figtree", "martian-mono"]) {
      expect(text).toContain(`@fontsource-variable/${name}`);
    }
  });

  test("in a browser under the real CSP: the three families load from /assets as font/woff2 with the long cache, and nothing is refused", async ({
    page,
  }) => {
    await mockCardImages(page);
    const fonts: Array<{ url: string; type: string | undefined; cache: string | undefined; status: number }> =
      [];
    page.on("response", (response) => {
      if (response.request().resourceType() !== "font") return;
      fonts.push({
        url: response.url(),
        type: response.headers()["content-type"],
        cache: response.headers()["cache-control"],
        status: response.status(),
      });
    });
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /Content Security Policy|font/i.test(message.text())) {
        errors.push(message.text());
      }
    });
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __violations: string[] }).__violations = seen;
      document.addEventListener("securitypolicyviolation", (event) =>
        seen.push(`${event.effectiveDirective} ${event.blockedURI}`),
      );
    });
    await page.goto(`${STACK_URL}/login`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() =>
      (() => {
        const list: FontFace[] = [];
        document.fonts.forEach((face) => list.push(face));
        return list;
      })()
        .filter((face) => face.status === "loaded")
        .map((face) => face.family.replace(/"/g, ""))
        .sort(),
    );
    expect(loaded).toEqual(["Bricolage Grotesque Variable", "Figtree Variable", "Martian Mono Variable"]);
    expect(fonts.length).toBeGreaterThanOrEqual(3);
    for (const font of fonts) {
      expect(new URL(font.url).origin, font.url).toBe(STACK_URL);
      expect(new URL(font.url).pathname, font.url).toMatch(/^\/assets\/[^/]+\.woff2$/);
      expect(font.status, font.url).toBe(200);
      expect(font.type, font.url).toBe("font/woff2");
      expect(font.cache, font.url).toBe("public, max-age=31536000, immutable");
    }
    expect(await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations)).toEqual(
      [],
    );
    expect(errors).toEqual([]);
  });
});

/**
 * Opt-in, against a stack whose api is stopped (`docker stop anime-tcg-api-acceptance`, then
 * `STACK_API_DOWN=1`): Caddy's 502 keeps the site headers, sends no Server and has an empty body.
 */
test.describe("deployed stack through Caddy, api stopped", () => {
  test.skip(!STACK_URL || process.env.STACK_API_DOWN !== "1", "set STACK_URL and STACK_API_DOWN=1");

  test("a 502 for /api keeps the site headers, sends no Server or Via and has an empty body", async ({
    request,
  }) => {
    for (const path of ["/api/session", "/api"]) {
      await expectErrorResponse(await request.get(`${STACK_URL}${path}`), 502);
    }
  });
});

/** Caddy's own error: its status, the site headers, no Server or Via, and an empty body (handle_errors). */
async function expectErrorResponse(res: APIResponse, status: number) {
  const url = res.url();
  expect(res.status(), url).toBe(status);
  expect(await res.text(), url).toBe("");
  const headers = res.headers();
  expect(headers["content-security-policy"], url).toBe(EXPECTED_CSP);
  expect(headers["x-content-type-options"], url).toBe("nosniff");
  expect(headers["referrer-policy"], url).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"], url).toBe("camera=(), microphone=(), geolocation=()");
  expect(headers["server"], url).toBeUndefined();
  expect(headers["via"], url).toBeUndefined();
}
