import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { isolated, mockAniList } from "./support/fake-api";

/**
 * Test plan: a short accounts journey through Caddy on a deployed compose stack
 * (docs/design/accounts.md §3.3–3.5, docs/design/accounts-api.md §4.2 and §9).
 *
 * Runs only when STACK_URL points at a running stack AND STACK_INVITE_CODE is one of its
 * INVITE_CODES, e.g. `STACK_URL=http://127.0.0.1:8180 STACK_INVITE_CODE=... npm run test:e2e -w web`.
 * The second variable is a deliberate opt-in: this spec creates an account, so it must never run
 * by accident against a stack whose accounts are real (the owner's acceptance stack counts toward
 * the 10-account cap). It deletes what it creates at the end, and again after the test whatever
 * its outcome, so a failed run does not keep one of the cap's places. AniList stays mocked.
 *
 * - Register through the two steps; the browser stores the session cookie as __Host-session,
 *   HttpOnly, Secure, SameSite=Lax, Path=/ and host-only (no Domain), and page script cannot read it.
 * - Log out: the cookie is gone and GET /api/session answers signed out.
 * - Log in again: a new cookie value with the same flags (sign-in rotates the session).
 * - Delete the account with its password: signed out, cookie cleared.
 */

const STACK_URL = process.env.STACK_URL?.replace(/\/$/, "");
const INVITE_CODE = process.env.STACK_INVITE_CODE;

const RUN = Date.now().toString(36).slice(-6);
const LOGIN = `stack-e2e-${RUN}`;
const PASSWORD = `stack pass ${RUN}`;

test.describe("accounts journey through Caddy", () => {
  test.skip(
    !STACK_URL || !INVITE_CODE,
    "set STACK_URL and STACK_INVITE_CODE to register a throwaway account on a running stack",
  );
  test.use({ baseURL: STACK_URL });
  test.afterEach(async ({ page }) => deleteThrowawayAccount(page.request));

  test("register, cookie flags, log out, log in, delete", async ({ page, context }) => {
    await mockAniList(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Register", exact: true }).click();
    await page.getByRole("textbox", { name: "Invite code" }).fill(INVITE_CODE!);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("textbox", { name: "Login", exact: true }).fill(LOGIN);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(control(page)).toBeVisible();
    const registered = await expectSessionCookie(context, page);

    await control(page).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page.getByRole("heading", { name: "Your account" })).toBeFocused();
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain("__Host-session");
    expect(await (await page.request.get("/api/session")).json()).toEqual({ signedIn: false });

    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.getByRole("textbox", { name: "Login", exact: true }).fill(LOGIN);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(control(page)).toBeVisible();
    const loggedIn = await expectSessionCookie(context, page);
    expect(loggedIn).not.toBe(registered);

    await control(page).click();
    await page.getByRole("menuitem", { name: "Manage account…" }).click();
    await page.getByRole("button", { name: "Delete account…" }).click();
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: `Delete ${LOGIN}`, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your account" })).toBeFocused();
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain("__Host-session");
    expect(await (await page.request.get("/api/session")).json()).toEqual({ signedIn: false });
  });
});

/**
 * Best-effort cleanup through the api, for a run that failed before its own Delete. A 401 on log in
 * means there is nothing to delete (never registered, or the journey already deleted it); any other
 * failure is reported, because it would leave an account holding one of the 10 places.
 */
async function deleteThrowawayAccount(request: APIRequestContext): Promise<void> {
  const headers = { origin: STACK_URL! };
  const login = await request.post("/api/session/login", {
    data: { login: LOGIN, password: PASSWORD },
    headers,
  });
  if (login.status() === 401) return;
  expect(login.status(), "cleanup: log in as the throwaway account").toBe(200);
  const deleted = await request.post("/api/account/delete", { data: { password: PASSWORD }, headers });
  expect(deleted.status(), "cleanup: delete the throwaway account").toBe(204);
}

const control = (page: Page) =>
  page.getByRole("button", { name: `Account menu. Signed in as ${isolated(LOGIN)}`, exact: true });

/** The cookie as the browser stored it, and proof page script cannot see it (HttpOnly). Returns its value. */
async function expectSessionCookie(context: BrowserContext, page: Page): Promise<string> {
  const cookies = (await context.cookies()).filter((cookie) => cookie.name.endsWith("session"));
  expect(cookies).toHaveLength(1);
  const host = new URL(STACK_URL!).hostname;
  expect(cookies[0]).toMatchObject({
    name: "__Host-session",
    domain: host,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain("session");
  return cookies[0].value;
}
