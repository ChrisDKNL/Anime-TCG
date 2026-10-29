/// <reference lib="dom" />
import { expect, test, type Page } from "@playwright/test";
import { isolated, mockAniList } from "./support/fake-api";

/**
 * Test plan: two tabs of one browser against the real api through the Vite /api proxy
 * (docs/design/navigation-and-landing.md §3.2 step 2, §3.5 steps 7 and 8; accounts.md §4.8).
 *
 * Skipped unless REAL_API_URL, REAL_API_INVITE_CODE and DATABASE_URL are set, exactly as
 * accounts.real.spec.ts (see there for how to start the api). AniList stays mocked.
 *
 * 1. Register a fresh login in tab 1; tab 2 (same cookie jar) opens /account and is signed in.
 * 2. Tab 1 logs out: the server ends the session.
 * 3. Tab 2 does not know yet: moving between its pages asks the server nothing (§3.2 step 2; the
 *    app never polls), so it still shows the signed-in header.
 * 4. Tab 2's next call (a rename) is answered `unauthenticated`: /login replaces /account, the
 *    session-ended banner shows, focus is on the `Log in` heading, the return path is /account,
 *    and the old login is unchanged on the server.
 * 5. Tab 2 logs in again and is back on /account; tab 1 on its next load is signed in too.
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
    await mockAniList(page);

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
    await mockAniList(other);
    await other.goto("/account");
    await expect(h1(other, "Manage account")).toBeVisible();
    await expect(controlFor(other, LOGIN)).toBeVisible();

    // Tab 1 logs out.
    await controlFor(page, LOGIN).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(h1(page, "Anime TCG")).toBeFocused();
    expect(await (await page.request.get("/api/session")).json()).toEqual({ signedIn: false });

    // Tab 2 moves between its pages without asking the server: it still shows the account.
    const sessionChecks: string[] = [];
    other.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/session") sessionChecks.push(request.method());
    });
    await mainNav(other).getByRole("link", { name: "Packs", exact: true }).click();
    await expect(h1(other, "Packs")).toBeFocused();
    await controlFor(other, LOGIN).click();
    await other.getByRole("menuitem", { name: "Manage account" }).click();
    await expect(h1(other, "Manage account")).toBeFocused();
    expect(sessionChecks).toEqual([]);

    // Its next call is answered unauthenticated.
    await other.getByRole("main").getByRole("textbox", { name: "New login" }).fill(`${LOGIN}-x`);
    await other.getByRole("main").getByRole("button", { name: "Save" }).click();
    await expect(other).toHaveURL(`${REAL_API_URL}/login`);
    await expect(h1(other, "Log in")).toBeFocused();
    await expect(
      other.getByRole("status").filter({ hasText: "You were logged out. Log in again to continue." }),
    ).toBeVisible();
    await expect(controlFor(other, LOGIN)).toHaveCount(0);
    expect(await other.evaluate(() => (history.state as { returnTo?: unknown } | null)?.returnTo)).toBe(
      "/account",
    );

    // Log in again in tab 2: back on /account, the login unchanged.
    await other.getByRole("textbox", { name: "Login", exact: true }).fill(LOGIN);
    await other.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await other.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(other).toHaveURL(`${REAL_API_URL}/account`);
    await expect(h1(other, "Manage account")).toBeFocused();
    await expect(controlFor(other, LOGIN)).toBeVisible();

    // Tab 1 picks the new session up on its next load.
    await page.reload();
    await expect(page).toHaveURL(`${REAL_API_URL}/packs`);
    await expect(controlFor(page, LOGIN)).toBeVisible();
  });
});
