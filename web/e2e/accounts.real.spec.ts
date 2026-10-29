/// <reference lib="dom" />
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { isolated, mockCardImages } from "./support/fake-api";

/**
 * Test plan: the accounts journey against the real api through the Vite /api proxy
 * (docs/design/accounts.md §3, docs/design/accounts-api.md §6–7).
 *
 * Skipped unless REAL_API_URL names a Vite dev server whose /api proxy reaches a running
 * `npm run dev -w api`, REAL_API_INVITE_CODE is one of that api's INVITE_CODES, and
 * DATABASE_URL (the app role) points at the api's database for the cleanup. Example:
 *   REAL_API_URL=http://localhost:5174 REAL_API_INVITE_CODE=e2e-invite-code E2E_PORT=5174 \
 *     npx playwright test accounts.real.spec.ts
 * The api's WEB_ORIGIN must equal REAL_API_URL (CSRF origin check). AniList's image CDN stays mocked.
 *
 * One serial journey on a fresh login per run, so the steps share the server's state:
 * 1. Register with the invite code typed in another case with spaces (the server trims and
 *    case-folds); the browser holds __Host-session as HttpOnly, Secure, SameSite=Lax.
 * 2. Open a pack: 5 cards, Collection (5).
 * 3. Log out: the landing page at /, title reset; GET /api/session answers signed out.
 * 4. Log in with the login in a different case: signed in under the stored display login; the
 *    collection is empty again (in memory only until roadmap 1c).
 * 5. Rename: header, title and live region follow.
 * 6. Change password: the cookie is rotated and the old value is signed out; in a second browser
 *    the old password no longer signs in and the new one does; this tab survives a reload.
 * 7. Five wrong passwords (each "incorrect"), then the server's wait: the button counts down from
 *    the server's retryAfterSeconds (≤ 10) to 1, then `Log in` and `You can try again now.`
 * 8. Delete with the new password on /account: signed out on the landing page, `Deleted <login>.`,
 *    and the database holds no row for either login.
 * Since the navigation PR (navigation-and-landing.md) the Account screen is /login and /register,
 * Manage account is the /account page, sign-in lands on /packs with its h1 focused, and the title
 * names the page instead of the login.
 * Rate budget: 9 of the 10 log-in calls per minute the api allows one client (spec §6.6); wait a
 * minute between runs. Cleanup: DELETE on the app pool for this run's logins (accounts cascade to
 * sessions; auth_throttle rows by key), in afterAll, whatever happened. Never TRUNCATE: the
 * database is shared with the api route tests.
 */

const REAL_API_URL = process.env.REAL_API_URL?.replace(/\/$/, "");
const INVITE_CODE = process.env.REAL_API_INVITE_CODE;
const DATABASE_URL = process.env.DATABASE_URL;

const RUN = Date.now().toString(36).slice(-6);
const LOGIN = `E2e-Real-${RUN}`;
const RENAMED = `${LOGIN}-r`;
const PASSWORD_1 = `first pass ${RUN}`;
const PASSWORD_2 = `second pass ${RUN}`;

test.describe("accounts journey against the real api", () => {
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
      const keys = [LOGIN.toLowerCase(), RENAMED.toLowerCase()];
      await client.query("DELETE FROM accounts WHERE login_normalized = ANY($1::text[])", [keys]);
      await client.query("DELETE FROM auth_throttle WHERE key = ANY($1::text[])", [keys]);
    } finally {
      await client.end();
    }
  });

  test("register, play, log out, log in, rename, change password, wait out the breather, delete", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await mockCardImages(page);
    const other = await newSignedOutContext(browser);

    try {
      await test.step("register with the invite code; the session cookie is __Host-, HttpOnly, Secure, Lax", async () => {
        await page.goto("/");
        await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Register" }).click();
        await page.getByRole("textbox", { name: "Invite code" }).fill(`  ${INVITE_CODE!.toUpperCase()}  `);
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByText("Step 2 of 2")).toBeVisible();
        await page.getByRole("textbox", { name: "Login", exact: true }).fill(LOGIN);
        await page.getByLabel("Password", { exact: true }).fill(PASSWORD_1);
        await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD_1);
        await page.getByRole("button", { name: "Register", exact: true }).click();

        await expect(controlFor(page, LOGIN)).toBeVisible();
        await expect(page.getByRole("heading", { level: 1, name: "Packs" })).toBeFocused();
        await expect(page).toHaveTitle("Packs · Anime TCG");
        await expectSessionCookie(page.context());
      });

      await test.step("open a pack", async () => {
        await page.getByRole("button", { name: /open booster pack/i }).click();
        await expect(page.getByRole("article")).toHaveCount(5);
        await expect(page.getByRole("link", { name: "Collection (5)" })).toBeVisible();
      });

      await test.step("log out", async () => {
        await logOut(page, LOGIN);
        expect(await (await page.request.get("/api/session")).json()).toEqual({ signedIn: false });
      });

      await test.step("log in with the login in a different case", async () => {
        await openLogInForm(page);
        await logIn(page, LOGIN.toUpperCase(), PASSWORD_1);
        await expect(controlFor(page, LOGIN)).toBeVisible();
        await expect(page.getByRole("link", { name: "Collection (0)" })).toBeVisible();
        await expectSessionCookie(page.context());
      });

      await test.step("rename", async () => {
        await openManage(page, LOGIN);
        await page.getByRole("textbox", { name: "New login" }).fill(RENAMED);
        await page.getByRole("button", { name: "Save" }).click();
        await expect(controlFor(page, RENAMED)).toBeAttached();
        await expect(page).toHaveTitle("Manage account · Anime TCG");
        await expect(
          page.getByRole("status").filter({ hasText: `Login changed to ${RENAMED}.` }),
        ).toHaveCount(1);
      });

      await test.step("change password: old cookie and old password are dead, this tab survives", async () => {
        const before = await sessionCookieValue(page.context());
        await openManage(page, RENAMED);
        await page.getByLabel("Current password", { exact: true }).fill(PASSWORD_1);
        await page.getByLabel("New password", { exact: true }).fill(PASSWORD_2);
        await page.getByLabel("Confirm new password", { exact: true }).fill(PASSWORD_2);
        await page.getByRole("button", { name: "Change password" }).click();
        await expect(page.getByRole("main").getByText("Password changed.")).toBeVisible();

        const after = await sessionCookieValue(page.context());
        expect(after).not.toBe(before);
        // A fresh context holds no cookies, so the pre-rotation value is the only one this request sends.
        const stale = await browser.newContext({ baseURL: REAL_API_URL });
        try {
          const answer = await stale.request.get("/api/session", {
            headers: { cookie: `__Host-session=${before}` },
          });
          expect(await answer.json()).toEqual({ signedIn: false });
          const current = await stale.request.get("/api/session", {
            headers: { cookie: `__Host-session=${after}` },
          });
          expect(await current.json()).toMatchObject({ signedIn: true, account: { login: RENAMED } });
        } finally {
          await stale.close();
        }

        const otherPage = await other.newPage();
        await mockCardImages(otherPage);
        await otherPage.goto("/");
        await openLogInForm(otherPage);
        await logIn(otherPage, RENAMED, PASSWORD_1, "incorrect");
        await logIn(otherPage, RENAMED, PASSWORD_2);
        await expect(controlFor(otherPage, RENAMED)).toBeVisible();
        await logOut(otherPage, RENAMED);

        await page.reload();
        await expect(controlFor(page, RENAMED)).toBeVisible();
      });

      await test.step("five wrong passwords, then the countdown the server sets", async () => {
        const otherPage = other.pages()[0];
        await openLogInForm(otherPage);
        for (let miss = 1; miss <= 5; miss += 1) {
          await logIn(otherPage, RENAMED, `wrong ${miss} ${RUN}`, "incorrect");
        }
        const submit = otherPage.getByRole("button", { name: /^(Log in|Logging in…|Try again in \d+ s)$/ });
        await submit.evaluate((element) => {
          const labels = [element.textContent ?? ""];
          window.__labels = labels;
          new MutationObserver(() => {
            const text = element.textContent ?? "";
            if (labels.at(-1) !== text) labels.push(text);
          }).observe(element, { subtree: true, childList: true, characterData: true });
        });
        await otherPage.getByLabel("Password", { exact: true }).fill(`wrong 6 ${RUN}`);
        await submit.click();
        await expect(submit).toHaveText(/^Try again in \d+ s$/);
        await expect(submit).toBeDisabled();
        await expect(
          otherPage.getByRole("status").filter({ hasText: /^Five misses in a row\. Take ten seconds/ }),
        ).toBeVisible();

        await expect(submit).toHaveText("Log in", { timeout: 15_000 });
        await expect(
          otherPage.getByRole("status").filter({ hasText: /^You can try again now\.$/ }),
        ).toHaveCount(1);
        const labels = (await otherPage.evaluate(() => window.__labels ?? [])).filter(
          (label) => label !== "Logging in…",
        );
        const seconds = labels.slice(1, -1).map((label) => Number(/^Try again in (\d+) s$/.exec(label)?.[1]));
        expect(labels[0]).toBe("Log in");
        expect(labels.at(-1)).toBe("Log in");
        expect(seconds[0]).toBeGreaterThanOrEqual(8);
        expect(seconds[0]).toBeLessThanOrEqual(10);
        expect(seconds).toEqual(Array.from({ length: seconds[0] }, (_, i) => seconds[0] - i));
      });

      await test.step("delete with the new password", async () => {
        await openManage(page, RENAMED);
        await page.getByRole("button", { name: "Delete account…" }).click();
        await page.getByRole("dialog").getByLabel("Password", { exact: true }).fill(PASSWORD_2);
        await page.getByRole("button", { name: `Delete ${RENAMED}`, exact: true }).click();
        await expect(page.getByRole("heading", { level: 1, name: "Anime TCG" })).toBeFocused();
        await expect(page.getByRole("status").filter({ hasText: `Deleted ${RENAMED}.` })).toHaveCount(1);
        await expect(page).toHaveTitle("Anime TCG");
        expect(await (await page.request.get("/api/session")).json()).toEqual({ signedIn: false });
        expect(await accountRows([LOGIN, RENAMED])).toBe(0);
      });
    } finally {
      await other.close();
    }
  });
});

const controlFor = (page: Page, login: string) =>
  page.getByRole("button", { name: `Account menu. Signed in as ${isolated(login)}`, exact: true });

async function newSignedOutContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ baseURL: REAL_API_URL });
}

/**
 * Opens /account from the menu. Already on /account the item is the current page's own link, which
 * does nothing (navigation-and-landing.md §3.5 step 3): the menu closes onto its button, the address
 * and the history stay as they are, and the heading does not take focus.
 */
async function openManage(page: Page, login: string) {
  const alreadyThere = new URL(page.url()).pathname === "/account";
  const entries = await page.evaluate(() => history.length);
  await controlFor(page, login).click();
  await page.getByRole("menuitem", { name: "Manage account" }).click();
  if (alreadyThere) {
    await expect(controlFor(page, login)).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/account");
    expect(await page.evaluate(() => history.length)).toBe(entries);
  } else {
    await expect(page.getByRole("heading", { level: 1, name: "Manage account" })).toBeFocused();
  }
}

async function logOut(page: Page, login: string) {
  await controlFor(page, login).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Anime TCG" })).toBeFocused();
  await expect(page).toHaveTitle("Anime TCG");
}

/** From the landing page's header link to the Log in page (waits for the boot check to answer first). */
async function openLogInForm(page: Page) {
  if (page.url().endsWith("/login")) return;
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeFocused();
}

/** Submits the open Log in form; `incorrect` expects the one failure message. */
async function logIn(page: Page, login: string, password: string, outcome: "ok" | "incorrect" = "ok") {
  await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
  await page.getByRole("textbox", { name: "Login", exact: true }).fill(login);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  if (outcome === "incorrect") {
    // The password is cleared only when this attempt's answer arrives: a wait that cannot pass on stale state.
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAccessibleDescription(
      "Login or password is incorrect.",
    );
    await expect(page.getByRole("textbox", { name: "Login", exact: true })).toBeFocused();
  } else {
    await expect(page.getByRole("heading", { level: 1, name: "Packs" })).toBeFocused();
  }
}

async function sessionCookieValue(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((candidate) => candidate.name === "__Host-session");
  expect(cookie, "__Host-session cookie").toBeDefined();
  return cookie!.value;
}

/** The flags the browser itself recorded for the session cookie (accounts-api spec §9, 1a flags). */
async function expectSessionCookie(context: BrowserContext) {
  const cookies = (await context.cookies()).filter((cookie) => cookie.name.endsWith("session"));
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatchObject({
    name: "__Host-session",
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
}

async function accountRows(logins: string[]): Promise<number> {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      "SELECT count(*) FROM accounts WHERE login_normalized = ANY($1::text[])",
      [logins.map((login) => login.toLowerCase())],
    );
    return Number(result.rows[0].count);
  } finally {
    await client.end();
  }
}
