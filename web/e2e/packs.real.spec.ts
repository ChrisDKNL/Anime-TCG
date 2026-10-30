/// <reference lib="dom" />
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { PackOpened } from "@anime-tcg/shared/api";
import { isolated, mockCardImages, recordAniListApiCalls } from "./support/fake-api";

/**
 * Test plan: the packs page against the real api through the Vite /api proxy, with a real
 * snapshot loaded (docs/design/packs-page.md §10; collection-packs.md §5.3, §8).
 *
 * Skipped unless REAL_API_URL, REAL_API_INVITE_CODE and DATABASE_URL are set, exactly as
 * accounts.real.spec.ts (see there for how to start the api); the api's database must hold an
 * active snapshot (`snapshot-pool --stdin`). AniList's image CDN stays mocked; no request may go to
 * AniList's API.
 *
 * One serial journey on a fresh login:
 * 1. Register: `3 of 3 packs ready`, no countdown, the pity line at 300, the odds dialog names the
 *    snapshot's character count.
 * 2. Lost answer (§10 item 6): `route.fetch()` lets the first `POST` reach the server, then the
 *    answer is dropped. The banner and `Try again`; the retry sends the same `requestId`, the server
 *    answers 200 with exactly the cards of the dropped 201 (slot order), `2 of 3`, the countdown
 *    from 10:00, the pity line at 299, `Collection (5)`.
 * 3. 401 (§10 item 11): the cookie is cleared, `Open pack` goes to `/login` with the banner and the
 *    return path `/packs`; logging in returns there with no reveal and `2 of 3`.
 * 4. 429 (§10 item 12, §9 question 3): replays of step 2's `requestId` (which spend nothing) use up
 *    the route's budget; the real 429 carries `Retry-After` and no number in the body. The button
 *    then reads `Try again in <S> s` from that header and comes back by itself; the retry carries
 *    the same `requestId` and opens the pack: `1 of 3`.
 * 5. 409 (§10 item 9): a second browser logs in and opens the last pack; this tab's click shows
 *    `There was no pack left to open.`, `0 of 3` with a countdown, and sends one follow-up `GET`.
 * 6. A reload: `Collection (15)`, the same as `totals.cards`; no `anime-tcg:` key in storage.
 * Throughout: no request to AniList's API and, when REAL_API_URL is a stack behind Caddy, no CSP
 * violation (the production build under `connect-src 'self'`).
 * Rate budget: three of the ten log-in calls per minute (register, two log ins) and the twenty pack
 * openings per minute, all of them, in step 4: run it a minute after accounts.real.spec.ts.
 * Cleanup: DELETE this run's login in afterAll.
 */

const REAL_API_URL = process.env.REAL_API_URL?.replace(/\/$/, "");
const INVITE_CODE = process.env.REAL_API_INVITE_CODE;
const DATABASE_URL = process.env.DATABASE_URL;

const RUN = Date.now().toString(36).slice(-6);
const LOGIN = `E2e-Packs-${RUN}`;
const PASSWORD = `packs pass ${RUN}`;

const main = (page: Page) => page.getByRole("main");
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const controlFor = (page: Page) =>
  page.getByRole("button", { name: `Account menu. Signed in as ${isolated(LOGIN)}`, exact: true });
const packButton = (page: Page, name: string | RegExp = "Open pack") =>
  main(page).getByRole("button", { name, exact: typeof name === "string" ? true : undefined });
const reveal = (page: Page) => page.getByRole("list", { name: /pack$/ });
const collectionLink = (page: Page) =>
  page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Collection/ });

async function revealNames(page: Page): Promise<string[]> {
  return reveal(page)
    .getByRole("article")
    .evaluateAll((articles) => articles.map((a) => a.querySelector("[title]")?.getAttribute("title") ?? ""));
}

async function logIn(page: Page) {
  await page.getByRole("textbox", { name: "Login", exact: true }).fill(LOGIN);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

async function otherBrowserOpensOnePack(browser: Browser) {
  const context = await browser.newContext({ baseURL: REAL_API_URL });
  try {
    await mockCardImages(context);
    const page = await context.newPage();
    await page.goto("/login");
    await logIn(page);
    await expect(h1(page, "Packs")).toBeFocused();
    await expect(page.getByText("1 of 3 packs ready")).toBeVisible();
    await packButton(page).click();
    await expect(reveal(page).getByRole("article")).toHaveCount(5);
    await expect(page.getByText("0 of 3 packs ready")).toBeVisible();
  } finally {
    await context.close();
  }
}

test.describe("the packs page against the real api", () => {
  test.skip(
    !REAL_API_URL || !INVITE_CODE || !DATABASE_URL,
    "set REAL_API_URL, REAL_API_INVITE_CODE and DATABASE_URL to run against a real api",
  );
  test.use({ baseURL: REAL_API_URL });

  test.afterAll(async () => {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      await client.query("DELETE FROM accounts WHERE login_normalized = $1", [LOGIN.toLowerCase()]);
    } finally {
      await client.end();
    }
  });

  test("a lost answer, a 401, a 429 and a 409, each costing what the server says and no more", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await mockCardImages(page);
    const aniListApi = recordAniListApiCalls(page);
    // Through Caddy the page runs under the site's CSP (connect-src 'self'): nothing may be refused.
    await page.addInitScript(() => {
      const refused: string[] = [];
      (window as { __cspRefused?: string[] }).__cspRefused = refused;
      document.addEventListener("securitypolicyviolation", (event) =>
        refused.push(`${event.effectiveDirective} ${event.blockedURI}`),
      );
    });
    const requestIds: string[] = [];
    const packGets: number[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (request.method() === "POST" && pathname === "/api/packs/open") {
        requestIds.push((JSON.parse(request.postData() ?? "{}") as { requestId: string }).requestId);
      }
      if (request.method() === "GET" && pathname === "/api/packs") packGets.push(Date.now());
    });

    await test.step("register: the cap, no countdown, the pity line, the odds", async () => {
      await page.goto("/register");
      await page.getByRole("textbox", { name: "Invite code" }).fill(INVITE_CODE!);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("textbox", { name: "Login", exact: true }).fill(LOGIN);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Register", exact: true }).click();
      await expect(h1(page, "Packs")).toBeFocused();
      await expect(controlFor(page)).toBeVisible();
      await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
      await expect(page.getByText(/Next pack in/)).toHaveCount(0);
      await expect(page.getByText("Mythic guaranteed within 300 free packs.")).toBeVisible();
      await page.getByRole("button", { name: "Pack odds" }).click();
      const dialog = page.getByRole("dialog", { name: "Pack odds" });
      await expect(dialog.getByText(/among the 2,983 characters of the current pool/)).toBeVisible();
      await dialog.getByRole("button", { name: "Close" }).click();
    });

    const intercepted: { pack?: PackOpened } = {};
    await test.step("a lost answer: the retry replays the pack the server dealt", async () => {
      await page.route(
        "**/api/packs/open",
        async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          intercepted.pack = (await response.json()) as PackOpened;
          await route.abort("connectionreset");
        },
        { times: 1 },
      );
      await packButton(page).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "Couldn't reach the game server." }),
      ).toBeVisible();
      await expect(packButton(page, "Try again")).toBeVisible();
      await expect(page.getByText("3 of 3 packs ready")).toBeVisible();

      const replay = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/packs/open",
      );
      await packButton(page, "Try again").click();
      expect((await replay).status()).toBe(200);
      await expect(reveal(page).getByRole("article")).toHaveCount(5);
      expect(requestIds).toHaveLength(2);
      expect(requestIds[1]).toBe(requestIds[0]);
      const { pack } = intercepted;
      if (pack === undefined) throw new Error("the first answer was not intercepted");
      expect(await revealNames(page)).toEqual(
        [...pack.cards].sort((a, b) => a.slot - b.slot).map((card) => card.character.name),
      );
      await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
      await expect(page.getByText(/^Next pack in (10:00|9:5\d)$/)).toBeVisible();
      await expect(page.getByText("Mythic guaranteed within 299 free packs.")).toBeVisible();
      await expect(collectionLink(page)).toHaveAccessibleName("Collection (5)");
    });

    await test.step("a 401: the cookie is gone; /login, then back to /packs with no reveal", async () => {
      await page.context().clearCookies();
      await packButton(page).click();
      await expect(page).toHaveURL(`${REAL_API_URL}/login`);
      await expect(h1(page, "Log in")).toBeFocused();
      await expect(
        page.getByRole("status").filter({ hasText: "You were logged out. Log in again to continue." }),
      ).toBeVisible();
      expect(await page.evaluate(() => (history.state as { returnTo?: unknown } | null)?.returnTo)).toBe(
        "/packs",
      );
      await logIn(page);
      await expect(page).toHaveURL(`${REAL_API_URL}/packs`);
      await expect(h1(page, "Packs")).toBeFocused();
      await expect(page.getByRole("article")).toHaveCount(0);
      await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
      await expect(packButton(page)).toBeVisible();
    });

    await test.step("a 429: Retry-After read, the key kept, the retry opens the pack", async () => {
      // Replays of a known requestId spend nothing; they only use up the route's budget.
      let limited: { status: number; retryAfter: string | undefined; body: unknown } | null = null;
      for (let call = 0; call < 25 && limited === null; call += 1) {
        const response = await page.request.post("/api/packs/open", {
          data: { requestId: requestIds[0] },
          headers: { origin: REAL_API_URL! },
        });
        if (response.status() === 429) {
          limited = {
            status: response.status(),
            retryAfter: response.headers()["retry-after"],
            body: await response.json(),
          };
        } else expect(response.status()).toBe(200);
      }
      if (limited === null) throw new Error("no 429 within 25 calls");
      expect(limited.retryAfter).toMatch(/^\d+$/);
      expect(limited.body).toEqual({
        error: { code: "rate_limited", message: expect.any(String) as unknown },
      });
      await expect(page.getByText("2 of 3 packs ready")).toBeVisible();

      const before = requestIds.length;
      await packButton(page).click();
      const waiting = packButton(page, /^Try again in \d+ s$/);
      await expect(waiting).toBeVisible();
      const seconds = Number((await waiting.textContent())?.match(/\d+/)?.[0]);
      expect(seconds).toBeGreaterThanOrEqual(1);
      expect(seconds).toBeLessThanOrEqual(60);
      await expect(waiting).toHaveAttribute("aria-disabled", "true");
      await expect(
        main(page).getByText(
          "Packs take a short pause after many requests in a row. The button comes back by itself.",
        ),
      ).toBeVisible();
      await expect(packButton(page, "Try again")).toBeVisible({ timeout: (seconds + 5) * 1000 });
      await packButton(page, "Try again").click();
      await expect(reveal(page).getByRole("article")).toHaveCount(5);
      expect(requestIds).toHaveLength(before + 2);
      expect(requestIds[before + 1]).toBe(requestIds[before]);
      await expect(page.getByText("1 of 3 packs ready")).toBeVisible();
      await expect(collectionLink(page)).toHaveAccessibleName("Collection (10)");
    });

    await test.step("a 409: another browser opened the last pack", async () => {
      await otherBrowserOpensOnePack(browser);
      const gets = packGets.length;
      await packButton(page).click();
      await expect(
        main(page).getByRole("status").filter({ hasText: "There was no pack left to open." }),
      ).toBeVisible();
      await expect(page.getByText("0 of 3 packs ready")).toBeVisible();
      await expect(packButton(page)).toHaveAttribute("aria-disabled", "true");
      await expect(page.getByText(/^Next pack in \d+:\d\d$/)).toBeVisible();
      await expect.poll(() => packGets.length).toBe(gets + 1);
      await expect(collectionLink(page)).toHaveAccessibleName("Collection (15)");
    });

    await test.step("a reload: the server's count, nothing in storage", async () => {
      await page.reload();
      await expect(collectionLink(page)).toHaveAccessibleName("Collection (15)");
      const totals = (await (await page.request.get("/api/collection")).json()) as {
        totals: { cards: number };
      };
      expect(totals.totals.cards).toBe(15);
      expect(
        await page.evaluate(() =>
          [localStorage, sessionStorage].flatMap((storage) =>
            Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key) =>
              key?.startsWith("anime-tcg:"),
            ),
          ),
        ),
      ).toEqual([]);
    });

    expect(aniListApi).toEqual([]);
    expect(await page.evaluate(() => (window as { __cspRefused?: string[] }).__cspRefused)).toEqual([]);
  });
});
