/// <reference lib="dom" />
import type { Locator, Page } from "@playwright/test";
import {
  accountAnswer,
  deferred,
  envelope,
  expect,
  firstSeen,
  makeAccount,
  noContent,
  recordFirstSeen,
  recordStatusTexts,
  signedIn,
  signedOut,
  statusTexts,
  test,
  type Answer,
} from "./support/fake-api";

/**
 * Test plan: the accounts UI in a real browser against a scripted api (docs/design/accounts.md).
 *
 * Every `/api/*` call is answered by `page.route` (support/fake-api.ts), so each state in §4 that is
 * hard to produce with a real server is deterministic; AniList is served from fixtures. Waits are
 * measured inside the page (MutationObserver recorders) rather than raced with polling assertions.
 *
 * Journeys
 * - Register in two steps (trimmed code and login, untrimmed password), land on Booster with the
 *   pack button focused, the login in the header and the title, and the live region announcing.
 * - Log in (trimmed login), same landing. Log out from the keyboard: Account screen, title reset,
 *   heading focused, `Logged out.` announced, no body on the request. Inventory Reset names the login.
 *
 * Boot (§3.1, §4.1)
 * - While the session check runs: title block only, no Account control, no game; `Loading…` appears
 *   no earlier than 300 ms after the page shell rendered.
 * - Unreachable (a 502 proxy page, then a dropped connection): red alert with `Try again` above a
 *   usable Account screen; `Try again` repeats the check; a later success clears the banner.
 * - Unreachable at boot, Log in still submits and clears the banner.
 *
 * Failure states (§4.4, §4.6, §4.8)
 * - Session ended mid-session (`unauthenticated` on rename, and on delete): dialog closes, reveal grid
 *   clears, neutral `role=status` banner (not an alert), focus on the Account heading.
 * - Log-in wait: retryAfterSeconds 3 → `Try again in 3 s`, 2, 1, then `Log in`; button disabled, fields
 *   editable; the breather and `You can try again now.` each announced exactly once.
 * - Register: cap reached on step 1 and on step 2 (form replaced, Back to the choice); the code
 *   rejected at submit (back to step 1, code field focused and invalid, login kept); duplicate login.
 * - Manage: duplicate login on rename, a 500 on rename (in-form copy, nothing changes), wrong current
 *   password (inline, cleared, focused), change password success, the delete flow (password focused,
 *   button enabled only with a password, wrong password inline and cleared, success signs out).
 * - Log out the server does not answer: still the Account screen, with the unreachable banner.
 *
 * Keyboard (§7)
 * - Menu: Enter/Space/ArrowDown open on the first item, ArrowUp on the last, arrows wrap, Home/End,
 *   roving tabindex, Escape returns focus to the button, Tab closes and moves on, click outside closes.
 * - Dialog: focus starts on it, Tab never leaves it, Escape and Close return focus to the control.
 * - Escape twice in the delete confirm: first back to the sections, then the dialog closes.
 * - Tab order through the Account screen: choice, Log in, Register step 1 and step 2.
 *
 * Hunt
 * - Double-submit: a double click on Continue, Register or Log in sends one request.
 * - Back on step 2 keeps the code. The Account control is disabled while a pack opens.
 * - A 24-character login truncates in the header with a `title`, the page never scrolls sideways at
 *   phone width, the dialog keeps a `title`, the delete heading wraps the full login. An RTL login
 *   renders as text with its `title` in the header, the dialog and the title bar.
 * - §7 "Forms": the submit button keeps focus while its request is in flight.
 */

const CHRIS = makeAccount();
/** The widest login the rules allow: 24 characters, no spaces to break at. */
const LONG_LOGIN = "W".repeat(24);
const BREATHER =
  "Five misses in a row. Take ten seconds, check the spelling of your login and whether caps lock is on, then try again.";
const UNREACHABLE = "Couldn't reach the game server. Check your connection and try again.";
const UNREACHABLE_FORM = "Couldn't reach the game server. Nothing was changed. Try again.";
const SESSION_ENDED = "You were logged out. Log in again to continue.";

const accountControl = (page: Page, login = "Chris") =>
  page.getByRole("button", { name: `Account menu. Signed in as ${login}`, exact: true });
const accountHeading = (page: Page) => page.getByRole("heading", { name: "Your account" });
const packButton = (page: Page) => page.getByRole("button", { name: /open booster pack/i });
const loginField = (page: Page) => page.getByRole("textbox", { name: "Login", exact: true });
const passwordField = (page: Page) => page.getByLabel("Password", { exact: true });
const manageDialog = (page: Page) => page.getByRole("dialog", { name: "Manage account" });
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A `role=status` element whose whole text is `text`: the app's live region, or a status banner. */
const status = (page: Page, text: string) =>
  page.getByRole("status").filter({ hasText: new RegExp(`^${escapeRegExp(text)}$`) });

async function openLogIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeFocused();
}

async function openRegister(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Register" })).toBeFocused();
}

async function toStep2(page: Page, code = "ANIME-TCG-2026") {
  await page.getByRole("textbox", { name: "Invite code" }).fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 2")).toBeVisible();
}

async function fillCredentials(page: Page, login = "Chris", password = "correct horse") {
  await loginField(page).fill(login);
  await passwordField(page).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
}

async function signedInPage(page: Page) {
  await page.goto("/");
  await expect(packButton(page)).toBeEnabled();
}

async function openManage(page: Page, login = "Chris") {
  await accountControl(page, login).click();
  await page.getByRole("menuitem", { name: "Manage account…" }).click();
  await expect(manageDialog(page)).toBeVisible();
}

/** Records every text the button shows, in order, so a countdown is checked without racing it. */
async function recordLabels(button: Locator) {
  await button.evaluate((element) => {
    const labels = [element.textContent ?? ""];
    window.__labels = labels;
    new MutationObserver(() => {
      const text = element.textContent ?? "";
      if (labels.at(-1) !== text) labels.push(text);
    }).observe(element, { subtree: true, childList: true, characterData: true });
  });
}

/** Presses Tab once per entry and expects focus on each in turn. */
async function expectTabOrder(page: Page, stops: Locator[]) {
  for (const stop of stops) {
    await page.keyboard.press("Tab");
    await expect(stop).toBeFocused();
  }
}

test.describe("boot (§3.1, §4.1)", () => {
  test("while the session check runs: the title block only, and Loading… no earlier than 300 ms", async ({
    page,
    api,
  }) => {
    const hold = deferred();
    api.on("GET /api/session", async () => {
      await hold.promise;
      return signedOut;
    });
    await recordFirstSeen(page, ["Anime TCG", "Loading…"]);
    await page.goto("/");

    await expect(page.getByText("Loading…")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Anime TCG", level: 1 })).toBeVisible();
    // No Account control, no tabs, no pack button, no Account screen: nothing game-related.
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(accountHeading(page)).toHaveCount(0);
    const seen = await firstSeen(page);
    expect(seen["Loading…"] - seen["Anime TCG"]).toBeGreaterThanOrEqual(290);

    hold.release();
    await expect(accountHeading(page)).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
    await expect(page).toHaveTitle("Anime TCG");
  });

  test("unreachable: a red alert with Try again above a usable Account screen; Try again repeats the check", async ({
    page,
    api,
  }) => {
    api.on(
      "GET /api/session",
      { status: 502, raw: "<html><body>502 Bad Gateway</body></html>" },
      "abort",
      signedIn(CHRIS),
    );
    await page.goto("/");

    const banner = page.getByRole("alert").filter({ hasText: UNREACHABLE });
    await expect(banner).toBeVisible();
    await expect(accountHeading(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Register", exact: true })).toBeEnabled();

    await banner.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => api.count("GET /api/session")).toBe(2);
    await expect(banner).toBeVisible();

    await banner.getByRole("button", { name: "Try again" }).click();
    await expect(accountControl(page)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(api.count("GET /api/session")).toBe(3);
  });

  test("unreachable at boot: Log in still submits, and signing in clears the banner", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", "abort");
    api.on("POST /api/session/login", signedIn(CHRIS));
    await page.goto("/");
    await expect(page.getByRole("alert").filter({ hasText: UNREACHABLE })).toBeVisible();

    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await loginField(page).fill("Chris");
    await passwordField(page).fill("correct horse");
    await page.getByRole("button", { name: "Log in", exact: true }).click();

    await expect(accountControl(page)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("register (§3.3, §4.4-A)", () => {
  test("two steps: trimmed code and login, untrimmed password; lands on Booster with the pack focused", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/accounts/check-invite", noContent);
    api.on("POST /api/accounts/register", { status: 201, json: { signedIn: true, account: CHRIS } });
    await openRegister(page);
    await expect(page.getByRole("heading", { name: "Register" })).toHaveAccessibleDescription("Step 1 of 2");

    await toStep2(page, "  anime-tcg-2026  ");
    await expect(loginField(page)).toBeFocused();
    await expect(passwordField(page)).toHaveAccessibleDescription(
      "8 to 128 characters. Letters, numbers, spaces and symbols are all fine.",
    );
    await fillCredentials(page, "  Chris ", " correct horse ");
    await page.getByRole("button", { name: "Register", exact: true }).click();

    await expect(accountControl(page)).toBeVisible();
    await expect(packButton(page)).toBeFocused();
    await expect(page.getByRole("button", { name: "Booster", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Collection (0)" })).toBeVisible();
    await expect(page).toHaveTitle("Chris · Anime TCG");
    await expect(status(page, "Registered Chris. You're now on Chris.")).toHaveCount(1);
    expect(api.bodies("POST /api/accounts/check-invite")).toEqual([{ inviteCode: "anime-tcg-2026" }]);
    expect(api.bodies("POST /api/accounts/register")).toEqual([
      { inviteCode: "anime-tcg-2026", login: "Chris", password: " correct horse " },
    ]);
  });

  test("cap reached on step 1: the form is replaced by the cap message and Back", async ({ page, api }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/accounts/check-invite", envelope(403, "cap_reached"));
    await openRegister(page);
    await page.getByRole("textbox", { name: "Invite code" }).fill("ANIME-TCG-2026");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "All 10 places are taken for now. Ask the owner to make room." }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Invite code" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(accountHeading(page)).toBeFocused();
  });

  test("cap reached on step 2: the form is replaced by the cap message and Back", async ({ page, api }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/accounts/check-invite", noContent);
    api.on("POST /api/accounts/register", envelope(403, "cap_reached"));
    await openRegister(page);
    await toStep2(page);
    await fillCredentials(page);
    await page.getByRole("button", { name: "Register", exact: true }).click();

    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "All 10 places are taken for now. Ask the owner to make room." }),
    ).toBeVisible();
    await expect(loginField(page)).toHaveCount(0);
    await expect(passwordField(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(accountHeading(page)).toBeFocused();
    await expect(page.getByRole("button", { name: /^Account menu/ })).toHaveCount(0);
  });

  test("a code rejected at submit goes back to step 1 with the code field focused, and keeps the login", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/accounts/check-invite", noContent);
    api.on("POST /api/accounts/register", envelope(403, "invite_invalid"), {
      status: 201,
      json: { signedIn: true, account: CHRIS },
    });
    await openRegister(page);
    await toStep2(page, "old-code-1");
    await fillCredentials(page);
    await page.getByRole("button", { name: "Register", exact: true }).click();

    const code = page.getByRole("textbox", { name: "Invite code" });
    await expect(page.getByText("Step 1 of 2")).toBeVisible();
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute("aria-invalid", "true");
    await expect(code).toHaveAccessibleDescription(/That invite code isn't valid\./);
    await expect(code).toHaveValue("old-code-1");

    await code.fill("new-code-2");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Step 2 of 2")).toBeVisible();
    await expect(loginField(page)).toHaveValue("Chris");
    await passwordField(page).fill("correct horse");
    await page.getByLabel("Confirm password", { exact: true }).fill("correct horse");
    await page.getByRole("button", { name: "Register", exact: true }).click();

    await expect(accountControl(page)).toBeVisible();
    expect(api.bodies("POST /api/accounts/register")).toEqual([
      { inviteCode: "old-code-1", login: "Chris", password: "correct horse" },
      { inviteCode: "new-code-2", login: "Chris", password: "correct horse" },
    ]);
  });

  test("a duplicate login names the clash on Login and focuses it", async ({ page, api }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/accounts/check-invite", noContent);
    api.on("POST /api/accounts/register", envelope(409, "login_taken"));
    await openRegister(page);
    await toStep2(page);
    await fillCredentials(page, " Chris ");
    await page.getByRole("button", { name: "Register", exact: true }).click();

    await expect(loginField(page)).toBeFocused();
    await expect(loginField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(loginField(page)).toHaveAccessibleDescription(/The login "Chris" is already taken\./);
    await expect(
      page.getByRole("alert").filter({ hasText: 'The login "Chris" is already taken.' }),
    ).toBeVisible();
    await expect(passwordField(page)).toHaveValue("correct horse");
  });

  test("Back on step 2 keeps the code and focuses it; Continue sends the same code again", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/accounts/check-invite", noContent);
    await openRegister(page);
    await toStep2(page, "kept-code-9");
    await page.getByRole("button", { name: "Back" }).click();

    const code = page.getByRole("textbox", { name: "Invite code" });
    await expect(page.getByText("Step 1 of 2")).toBeVisible();
    await expect(code).toBeFocused();
    await expect(code).toHaveValue("kept-code-9");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Step 2 of 2")).toBeVisible();
    expect(api.bodies("POST /api/accounts/check-invite")).toEqual([
      { inviteCode: "kept-code-9" },
      { inviteCode: "kept-code-9" },
    ]);
  });
});

test.describe("log in (§3.4, §4.4-B)", () => {
  test("logs in with the trimmed login and the untrimmed password; lands on Booster with the pack focused", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/session/login", signedIn(CHRIS));
    await openLogIn(page);
    await expect(
      page.getByText(
        "There is no way to recover a forgotten password yourself. Ask the owner to set a new one.",
      ),
    ).toBeVisible();
    await loginField(page).fill("  Chris ");
    await passwordField(page).fill(" secret pw ");
    await page.getByRole("button", { name: "Log in", exact: true }).click();

    await expect(packButton(page)).toBeFocused();
    await expect(page).toHaveTitle("Chris · Anime TCG");
    await expect(status(page, "Logged in. You're now on Chris.")).toHaveCount(1);
    expect(api.bodies("POST /api/session/login")).toEqual([{ login: "Chris", password: " secret pw " }]);
  });

  test("incorrect: both fields invalid, one message under Password, password cleared, focus on Login", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/session/login", envelope(401, "bad_credentials"));
    await openLogIn(page);
    await loginField(page).fill("Chris");
    await passwordField(page).fill("wrong password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();

    await expect(loginField(page)).toBeFocused();
    await expect(loginField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(passwordField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(passwordField(page)).toHaveValue("");
    await expect(passwordField(page)).toHaveAccessibleDescription("Login or password is incorrect.");
    await expect(page.getByText("Login or password is incorrect.")).toHaveCount(1);
    await expect(loginField(page)).toHaveValue("Chris");
  });

  test("the server's wait: Try again in 3, 2, 1 s, then Log in; breather and end each announced once", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/session/login", envelope(429, "too_many_failures", 3));
    await recordStatusTexts(page);
    await openLogIn(page);
    await loginField(page).fill("Chris");
    await passwordField(page).fill("wrong password");
    const submit = page.getByRole("button", { name: /^(Log in|Logging in…|Try again in \d+ s)$/ });
    await recordLabels(submit);
    await submit.click();

    await expect(submit).toHaveText(/^Try again in \d s$/);
    await expect(submit).toBeDisabled();
    await expect(status(page, BREATHER)).toBeVisible();
    // Fields stay editable during the wait.
    await expect(loginField(page)).toBeEditable();
    await loginField(page).fill("chris");
    await expect(passwordField(page)).toBeEditable();

    await expect(submit).toHaveText("Log in", { timeout: 6_000 });
    await expect(submit).toBeEnabled();
    await expect(status(page, "You can try again now.")).toHaveCount(1);
    // One more interval's worth: the end must not be announced again a second later.
    await page.waitForTimeout(1_500);

    const labels = await page.evaluate(() => window.__labels ?? []);
    expect(labels.filter((label) => label !== "Logging in…")).toEqual([
      "Log in",
      "Try again in 3 s",
      "Try again in 2 s",
      "Try again in 1 s",
      "Log in",
    ]);
    const texts = await statusTexts(page);
    expect(texts.filter((text) => text === "You can try again now.")).toHaveLength(1);
    expect(texts.filter((text) => text === BREATHER)).toHaveLength(1);
    // Accepted engineer decision: the breather stays visible after the countdown until the next submit.
    await expect(status(page, BREATHER)).toBeVisible();
    expect(api.count("POST /api/session/login")).toBe(1);
  });
});

test.describe("signed in (§3.5, §3.6)", () => {
  test("keyboard log out: Account screen, title reset, heading focused, Logged out. announced, no body sent", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/session/logout", noContent);
    await signedInPage(page);
    await expect(page).toHaveTitle("Chris · Anime TCG");

    await accountControl(page).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "Log out" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(accountHeading(page)).toBeFocused();
    await expect(page).toHaveTitle("Anime TCG");
    await expect(status(page, "Logged out.")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Booster", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
    expect(api.bodies("POST /api/session/logout")).toEqual([undefined]);
    // The session query never refetches on its own (accepted decision, spec §4.8).
    expect(api.count("GET /api/session")).toBe(1);
  });

  test("a log-out the server does not answer still drops to the Account screen, with the banner", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/session/logout", "abort");
    await signedInPage(page);
    await accountControl(page).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();

    await expect(accountHeading(page)).toBeFocused();
    await expect(page.getByRole("alert").filter({ hasText: UNREACHABLE })).toBeVisible();
    await expect(page).toHaveTitle("Anime TCG");
  });

  test("the Inventory Reset confirm names the login", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInPage(page);
    await packButton(page).click();
    await expect(page.getByRole("article")).toHaveCount(5);
    await page.getByRole("button", { name: "Collection (5)" }).click();

    const messages: string[] = [];
    page.once("dialog", (dialog) => {
      messages.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "Reset" }).click();
    await expect.poll(() => messages).toEqual(["Delete every card in Chris? This cannot be undone."]);
    await expect(page.getByText("5 cards")).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText("Your collection is empty. Open a pack to get started.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Collection (0)" })).toBeVisible();
  });

  test("session ended on rename: dialog closes, reveal grid clears, neutral banner, focus on the heading", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("PATCH /api/account/login", envelope(401, "unauthenticated"));
    await signedInPage(page);
    await packButton(page).click();
    await expect(page.getByRole("article")).toHaveCount(5);
    await openManage(page);
    await manageDialog(page).getByRole("textbox", { name: "New login" }).fill("Kris");
    await manageDialog(page).getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(accountHeading(page)).toBeFocused();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(status(page, SESSION_ENDED)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page).toHaveTitle("Anime TCG");
    await expect(page.getByRole("button", { name: /^Collection/ })).toHaveCount(0);
    // The Log in form is one click away.
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Log in" })).toBeFocused();
  });

  test("session ended on delete: the confirm panel closes the same way", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/account/delete", envelope(401, "unauthenticated"));
    await signedInPage(page);
    await openManage(page);
    await page.getByRole("button", { name: "Delete account…" }).click();
    await passwordField(page).fill("correct horse");
    await page.getByRole("button", { name: "Delete Chris" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(accountHeading(page)).toBeFocused();
    await expect(status(page, SESSION_ENDED)).toBeVisible();
  });
});

test.describe("manage account (§3.5.3, §4.6)", () => {
  test("opens with the account header: login, card count and creation date, then three sections", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(makeAccount({ cards: 3 })));
    await signedInPage(page);
    await openManage(page);
    const dialog = manageDialog(page);
    await expect(dialog.getByText("Chris", { exact: true })).toHaveAttribute("title", "Chris");
    await expect(dialog.getByText("3 cards · Created 28 Oct 2026")).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 3 })).toHaveText([
      "Login",
      "Password",
      "Delete account",
    ]);
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("rename: header, title, dialog header and live region follow the new login", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("PATCH /api/account/login", accountAnswer(makeAccount({ login: "Kris" })));
    await signedInPage(page);
    await openManage(page);
    const dialog = manageDialog(page);
    await dialog.getByRole("textbox", { name: "New login" }).fill("  Kris ");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(accountControl(page, "Kris")).toBeAttached();
    await expect(page).toHaveTitle("Kris · Anime TCG");
    await expect(dialog.getByText("Kris", { exact: true })).toHaveAttribute("title", "Kris");
    await expect(status(page, "Login changed to Kris.")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(api.bodies("PATCH /api/account/login")).toEqual([{ login: "Kris" }]);
  });

  test("rename to a taken login names the clash on the field and focuses it; the header keeps the old login", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("PATCH /api/account/login", envelope(409, "login_taken"));
    await signedInPage(page);
    await openManage(page);
    const field = manageDialog(page).getByRole("textbox", { name: "New login" });
    await field.fill("Taken");
    await manageDialog(page).getByRole("button", { name: "Save" }).click();

    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription('The login "Taken" is already taken.');
    await expect(accountControl(page)).toBeAttached();
    await expect(page).toHaveTitle("Chris · Anime TCG");
  });

  test("a 500 on rename shows the in-form unreachable copy and changes nothing", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("PATCH /api/account/login", envelope(500, "internal"), {
      status: 502,
      raw: "<html>Bad Gateway</html>",
    });
    await signedInPage(page);
    await openManage(page);
    const dialog = manageDialog(page);
    await dialog.getByRole("textbox", { name: "New login" }).fill("Kris");
    await dialog.getByRole("button", { name: "Save" }).click();

    const banner = dialog.getByRole("alert").filter({ hasText: UNREACHABLE_FORM });
    await expect(banner).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "New login" })).toHaveValue("Kris");
    await expect(page).toHaveTitle("Chris · Anime TCG");
    await expect(dialog.getByText("Chris", { exact: true })).toBeVisible();

    // A proxy error page (not the envelope) reads the same.
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => api.count("PATCH /api/account/login")).toBe(2);
    await expect(banner).toBeVisible();
    await expect(page).toHaveTitle("Chris · Anime TCG");
  });

  test("a wrong current password is inline on that field, cleared and focused; success clears and announces", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/account/change-password", envelope(403, "wrong_password"), noContent);
    await signedInPage(page);
    await openManage(page);
    const dialog = manageDialog(page);
    const current = dialog.getByLabel("Current password", { exact: true });
    await current.fill("not it at all");
    await dialog.getByLabel("New password", { exact: true }).fill("brand new pw");
    await dialog.getByLabel("Confirm new password", { exact: true }).fill("brand new pw");
    await dialog.getByRole("button", { name: "Change password" }).click();

    await expect(current).toBeFocused();
    await expect(current).toHaveValue("");
    await expect(current).toHaveAttribute("aria-invalid", "true");
    await expect(current).toHaveAccessibleDescription("That password is incorrect.");
    await expect(dialog.getByLabel("New password", { exact: true })).toHaveValue("brand new pw");

    await current.fill("the old one");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(dialog.getByText("Password changed.")).toBeVisible();
    await expect(status(page, "Password changed.")).toHaveCount(1);
    await expect(current).toHaveValue("");
    await expect(dialog.getByLabel("New password", { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel("Confirm new password", { exact: true })).toHaveValue("");
    expect(api.bodies("POST /api/account/change-password")).toEqual([
      { currentPassword: "not it at all", newPassword: "brand new pw" },
      { currentPassword: "the old one", newPassword: "brand new pw" },
    ]);
  });

  test("delete: password focused, button needs a password, wrong password inline and cleared, success signs out", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(makeAccount({ cards: 3 })));
    api.on("POST /api/account/delete", envelope(403, "wrong_password"), noContent);
    await signedInPage(page);
    await openManage(page);
    await page.getByRole("button", { name: "Delete account…" }).click();

    const confirm = page.getByRole("dialog", { name: "Delete Chris?" });
    await expect(confirm).toHaveAccessibleDescription(
      "This permanently deletes Chris and its 3 cards. There is no undo.",
    );
    const password = confirm.getByLabel("Password", { exact: true });
    const remove = confirm.getByRole("button", { name: "Delete Chris", exact: true });
    await expect(password).toBeFocused();
    await expect(remove).toBeDisabled();
    // Enter with an empty field does nothing (the button is disabled).
    await page.keyboard.press("Enter");
    await password.fill("not it");
    await expect(remove).toBeEnabled();
    await remove.click();

    await expect(password).toBeFocused();
    await expect(password).toHaveValue("");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(password).toHaveAccessibleDescription("That password is incorrect.");
    await expect(remove).toBeDisabled();

    await password.fill("correct horse");
    await password.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(accountHeading(page)).toBeFocused();
    await expect(status(page, "Deleted Chris.")).toHaveCount(1);
    await expect(page).toHaveTitle("Anime TCG");
    expect(api.bodies("POST /api/account/delete")).toEqual([
      { password: "not it" },
      { password: "correct horse" },
    ]);
  });

  test("Escape twice in the delete confirm: back to the sections, then the dialog closes onto the control", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInPage(page);
    await openManage(page);
    await page.getByRole("button", { name: "Delete account…" }).click();
    await expect(page.getByRole("dialog", { name: "Delete Chris?" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(manageDialog(page)).toBeVisible();
    await expect(manageDialog(page).getByRole("button", { name: "Delete account…" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(accountControl(page)).toBeFocused();
  });
});

test.describe("keyboard (§7)", () => {
  test("the Account menu key map", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInPage(page);
    const control = accountControl(page);
    const menu = page.getByRole("menu", { name: "Account menu. Signed in as Chris" });
    const manage = page.getByRole("menuitem", { name: "Manage account…" });
    const logOut = page.getByRole("menuitem", { name: "Log out" });
    await expect(control).toHaveAttribute("aria-haspopup", "menu");
    await expect(control).toHaveAttribute("aria-expanded", "false");

    await control.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await expect(control).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("menuitem")).toHaveCount(2);
    await expect(manage).toBeFocused();
    await expect(manage).toHaveAttribute("tabindex", "0");
    await expect(logOut).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("ArrowDown");
    await expect(logOut).toBeFocused();
    await expect(logOut).toHaveAttribute("tabindex", "0");
    await page.keyboard.press("ArrowDown");
    await expect(manage).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(logOut).toBeFocused();
    await page.keyboard.press("Home");
    await expect(manage).toBeFocused();
    await page.keyboard.press("End");
    await expect(logOut).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(control).toBeFocused();
    await expect(control).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Space");
    await expect(manage).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowDown");
    await expect(manage).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowUp");
    await expect(logOut).toBeFocused();

    // Tab closes the menu and moves on past the button, to the pack button.
    await page.keyboard.press("Tab");
    await expect(menu).toHaveCount(0);
    await expect(packButton(page)).toBeFocused();

    // Clicking outside closes.
    await control.click();
    await expect(menu).toBeVisible();
    await page.getByRole("heading", { name: "Anime TCG", level: 1 }).click();
    await expect(menu).toHaveCount(0);
  });

  test("the dialog: focus starts on it, Tab stays inside, Escape and Close return focus to the control", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInPage(page);
    const control = accountControl(page);
    await control.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    const dialog = manageDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    // Twice round the dialog's controls: focus never lands on the page behind the modal.
    for (let i = 0; i < 24; i += 1) {
      await page.keyboard.press("Tab");
      const outside = await dialog.evaluate((element) => {
        const active = document.activeElement;
        return active !== null && active !== document.body && !element.contains(active);
      });
      expect(outside, `Tab ${i + 2} left the dialog`).toBe(false);
    }

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(control).toBeFocused();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(control).toBeFocused();
  });

  test("Tab order through the Account screen: choice, Log in, Register step 1 and step 2", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/accounts/check-invite", noContent);
    await page.goto("/");
    await expect(accountHeading(page)).toBeVisible();
    await expectTabOrder(page, [
      page.getByRole("link", { name: "AniList" }),
      page.getByRole("button", { name: "Account", exact: true }),
      page.getByRole("button", { name: "Log in", exact: true }),
      page.getByRole("button", { name: "Register", exact: true }),
    ]);

    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Log in" })).toBeFocused();
    await expectTabOrder(page, [
      loginField(page),
      passwordField(page),
      page.getByRole("button", { name: "Show password", exact: true }),
      page.getByRole("button", { name: "Log in", exact: true }),
      page.getByRole("button", { name: "Back" }),
    ]);

    await page.keyboard.press("Enter");
    await expect(accountHeading(page)).toBeFocused();
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Register" })).toBeFocused();
    await expectTabOrder(page, [
      page.getByRole("textbox", { name: "Invite code" }),
      page.getByRole("button", { name: "Continue" }),
      page.getByRole("button", { name: "Back" }),
    ]);

    await toStep2(page);
    await expect(loginField(page)).toBeFocused();
    await expectTabOrder(page, [
      passwordField(page),
      page.getByRole("button", { name: "Show password", exact: true }),
      page.getByLabel("Confirm password", { exact: true }),
      page.getByRole("button", { name: "Show password confirmation", exact: true }),
      page.getByRole("button", { name: "Register", exact: true }),
      page.getByRole("button", { name: "Back" }),
    ]);
  });
});

const DOUBLE_SUBMIT = [
  { button: "Continue", route: "POST /api/accounts/check-invite" },
  { button: "Register", route: "POST /api/accounts/register" },
  { button: "Log in", route: "POST /api/session/login" },
] as const;

test.describe("hunt", () => {
  for (const { button, route } of DOUBLE_SUBMIT) {
    test(`a double click on ${button} sends one request`, async ({ page, api }) => {
      const hold = deferred();
      const held = async (): Promise<Answer> => {
        await hold.promise;
        return envelope(401, "bad_credentials");
      };
      api.on("GET /api/session", signedOut);
      api.on("POST /api/accounts/check-invite", noContent);
      api.on(route, held);
      if (button === "Log in") {
        await openLogIn(page);
        await loginField(page).fill("Chris");
        await passwordField(page).fill("correct horse");
      } else {
        await openRegister(page);
        if (button === "Register") {
          await toStep2(page);
          await fillCredentials(page);
        } else {
          await page.getByRole("textbox", { name: "Invite code" }).fill("ANIME-TCG-2026");
        }
      }

      await page.getByRole("button", { name: button, exact: true }).dblclick();
      await expect.poll(() => api.count(route)).toBe(1);
      // Give a second request every chance to leave before the first one answers.
      await page.waitForTimeout(300);
      expect(api.count(route)).toBe(1);
      hold.release();
    });
  }

  test("§7 Forms: the submit button keeps focus while its request is in flight", async ({ page, api }) => {
    const hold = deferred();
    api.on("GET /api/session", signedOut);
    api.on("POST /api/session/login", async () => {
      await hold.promise;
      return "abort" as const;
    });
    await openLogIn(page);
    await loginField(page).fill("Chris");
    await passwordField(page).fill("correct horse");
    // Keyboard-only: Tab from Password over its toggle to Log in, then Enter.
    await passwordField(page).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");

    const pending = page.getByRole("button", { name: "Logging in…" });
    await expect(pending).toBeDisabled();
    await expect(page.getByRole("button", { name: "Show password", exact: true })).toBeDisabled();
    await expect(loginField(page)).toBeDisabled();
    hold.release();
    await expect(page.getByRole("alert").filter({ hasText: UNREACHABLE_FORM })).toBeVisible();
    // "While a request is in flight the submit button is disabled and keeps focus" (accounts.md §7):
    // a keyboard user who pressed Log in is still on Log in when the answer arrives.
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeFocused();
  });

  test("the Account control is disabled while a pack opens", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInPage(page);
    await accountControl(page).evaluate((element) => {
      const button = element as HTMLButtonElement;
      const states = [String(button.disabled)];
      window.__labels = states;
      new MutationObserver(() => states.push(String(button.disabled))).observe(button, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    });
    await packButton(page).click();
    await expect(page.getByRole("article")).toHaveCount(5);
    await expect(accountControl(page)).toBeEnabled();
    expect(await page.evaluate(() => window.__labels)).toEqual(["false", "true", "false"]);
  });

  test("a 24-character login truncates in the header and keeps its full text in the title", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(makeAccount({ login: LONG_LOGIN })));
    await page.setViewportSize({ width: 375, height: 740 });
    await signedInPage(page);

    const headerLogin = accountControl(page, LONG_LOGIN).getByText(LONG_LOGIN, { exact: true });
    await expect(headerLogin).toHaveAttribute("title", LONG_LOGIN);
    const header = await headerLogin.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(header.clientWidth).toBeLessThanOrEqual(128); // max-w-[8rem] on phone
    expect(header.scrollWidth).toBeGreaterThan(header.clientWidth); // truncated; the title has it all
    await expect(page).toHaveTitle(`${LONG_LOGIN} · Anime TCG`);
  });

  test("§5 phone header: a 24-character login does not push the page sideways at 375 px", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(makeAccount({ login: LONG_LOGIN })));
    await page.setViewportSize({ width: 375, height: 740 });
    await signedInPage(page);

    // Row 2 on phone is the view tabs left and the Account control right, the login truncated (§5 "Header").
    const box = await accountControl(page, LONG_LOGIN).boundingBox();
    expect(box!.x + box!.width, "the Account control's right edge").toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "page width").toBeLessThanOrEqual(
      375,
    );
  });

  test("a 24-character login: the dialog keeps it in a title and the delete heading wraps it in full", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(makeAccount({ login: LONG_LOGIN })));
    await page.setViewportSize({ width: 375, height: 740 });
    await signedInPage(page);
    await openManage(page, LONG_LOGIN);

    const dialog = manageDialog(page);
    await expect(dialog.getByText(LONG_LOGIN, { exact: true })).toHaveAttribute("title", LONG_LOGIN);
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(375);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    await dialog.getByRole("button", { name: "Delete account…" }).click();
    const confirm = page.getByRole("dialog", { name: `Delete ${LONG_LOGIN}?` });
    const heading = confirm.getByRole("heading", { name: `Delete ${LONG_LOGIN}?` });
    await expect(heading).toHaveText(`Delete ${LONG_LOGIN}?`);
    // Headings and confirm panels wrap the login instead of truncating it (§5 "Truncation").
    expect(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(confirm.getByRole("button", { name: `Delete ${LONG_LOGIN}`, exact: true })).toBeVisible();
    expect(await confirm.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  for (const [kind, login] of [
    ["an RTL override", "\u202Egnp.exe"],
    ["a Hebrew", "שלום עולם"],
  ] as const) {
    test(`${kind} login renders as text with its title in the header, the dialog and the title bar`, async ({
      page,
      api,
    }) => {
      api.on("GET /api/session", signedIn(makeAccount({ login })));
      await signedInPage(page);
      const control = accountControl(page, login);
      await expect(control.getByText(login, { exact: true })).toHaveAttribute("title", login);
      await expect(page).toHaveTitle(`${login} · Anime TCG`);
      await openManage(page, login);
      const dialogLogin = manageDialog(page).getByText(login, { exact: true });
      await expect(dialogLogin).toHaveAttribute("title", login);
      expect(await dialogLogin.evaluate((element) => element.textContent)).toBe(login);
      await page.getByRole("button", { name: "Delete account…" }).click();
      await expect(page.getByRole("button", { name: `Delete ${login}`, exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(control).toBeFocused();
    });
  }
});
