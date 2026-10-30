/// <reference lib="dom" />
import { expect, test, type Page } from "@playwright/test";
import { isolated, mockCardImages } from "./support/fake-api";

/**
 * Test plan: two tabs of one browser against the real api through the Vite /api proxy
 * (docs/design/navigation-and-landing.md §3.2 step 2, §3.5 steps 7 and 8; accounts.md §4.8).
 *
 * Skipped unless REAL_API_URL, REAL_API_INVITE_CODE and DATABASE_URL are set, exactly as
 * accounts.real.spec.ts (see there for how to start the api). AniList's image CDN stays mocked.
 *
 * 1. Register a fresh login in tab 1; tab 2 (same cookie jar) opens /account and is signed in.
 * 2. Tab 1 logs out: the server ends the session.
 * 3. Tab 2 does not know yet: it still shows the signed-in header, and nothing polls (§3.2 step 2).
 * 4. Tab 2's next call is answered `unauthenticated`. Since 1c that call is the `GET /api/packs`
 *    that showing /packs sends (packs-page.md §3.1 step 2), not a session check: /login replaces
 *    /packs, the session-ended banner shows, focus is on the `Log in` heading and the return path
 *    is /packs. (Before 1c the pages asked nothing and the first call was a rename on /account.)
 * 5. Tab 2 logs in again and is back on /packs; tab 1 on its next load is signed in too.
 * Rate budget: one register and one log in. Cleanup: DELETE this run's login in afterAll.
 */

const REAL_API_URL = process.env.REAL_API_URL?.replace(/\/$/, "");
const INVITE_CODE = process.env.REAL_API_INVITE_CODE;
const DATABASE_URL = process.env.DATABASE_URL;

const RUN = Date.now().toString(36).slice(-6);
const LOGIN = `E2e-Tabs-${RUN}`;
const PASSWORD = `two tabs ${RUN}`;

const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const controlFor = (page: Page, login: string) =>
  page.getByRole("button", { name: `Account menu. Signed in as ${isolated(login)}`, exact: true });
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test.describe("two tabs against the real api", () => {
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
      const keys = [LOGIN.toLowerCase(), `${LOGIN}-x`.toLowerCase()];
      await client.query("DELETE FROM accounts WHERE login_normalized = ANY($1::text[])", [keys]);
      await client.query("DELETE FROM auth_throttle WHERE key = ANY($1::text[])", [keys]);
    } finally {
      await client.end();
    }
  });

  test("logging out in one tab: the other finds out on its next call, and returns to its page after logging in", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await mockCardImages(page);

    await page.goto("/register");
    await page.getByRole("textbox", { name: "Invite code" }).fill(INVITE_CODE!);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Step 2 of 2")).toBeVisible();
    await page.getByRole("textbox", { name: "Login", exact: true }).fill(LOGIN);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(controlFor(page, LOGIN)).toBeVisible();

    const other = await context.newPage();
    await mockCardImages(other);
    await other.goto("/account");
    await expect(h1(other, "Manage account")).toBeVisible();
    await expect(controlFor(other, LOGIN)).toBeVisible();

    // Tab 1 logs out.
    await controlFor(page, LOGIN).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(h1(page, "Anime TCG")).toBeFocused();
    expect(await (await page.request.get("/api/session")).json()).toEqual({ signedIn: false });

    // Tab 2 does not know yet: nothing polls, so it still shows the account.
    await expect(controlFor(other, LOGIN)).toBeVisible();
    const sessionChecks: string[] = [];
    other.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/session") sessionChecks.push(request.method());
    });

    // Its next call, the allowance /packs asks for when it is shown, is answered unauthenticated.
    await mainNav(other).getByRole("link", { name: "Packs", exact: true }).click();
    await expect(other).toHaveURL(`${REAL_API_URL}/login`);
    await expect(h1(other, "Log in")).toBeFocused();
    await expect(
      other.getByRole("status").filter({ hasText: "You were logged out. Log in again to continue." }),
    ).toBeVisible();
    await expect(controlFor(other, LOGIN)).toHaveCount(0);
    expect(await other.evaluate(() => (history.state as { returnTo?: unknown } | null)?.returnTo)).toBe(
      "/packs",
    );
    expect(sessionChecks).toEqual([]);

    // Log in again in tab 2: back on /packs.
    await other.getByRole("textbox", { name: "Login", exact: true }).fill(LOGIN);
    await other.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await other.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(other).toHaveURL(`${REAL_API_URL}/packs`);
    await expect(h1(other, "Packs")).toBeFocused();
    await expect(controlFor(other, LOGIN)).toBeVisible();
    await expect(other.getByText("3 of 3 packs ready")).toBeVisible();

    // Tab 1 picks the new session up on its next load.
    await page.reload();
    await expect(page).toHaveURL(`${REAL_API_URL}/packs`);
    await expect(controlFor(page, LOGIN)).toBeVisible();
  });
});
