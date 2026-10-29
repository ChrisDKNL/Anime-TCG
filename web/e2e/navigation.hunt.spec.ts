/// <reference lib="dom" />
import type { BrowserContext, Locator, Page } from "@playwright/test";
import {
  deferred,
  envelope,
  expect,
  isolated,
  makeAccount,
  noContent,
  PNG,
  recordStatusTexts,
  signedIn,
  signedOut,
  statusTexts,
  test,
  type Answer,
} from "./support/fake-api";
import { makeAniListResponse } from "../src/test/fixtures";

/**
 * Test plan (tester's hunt): what the navigation PR's own suites do not reach, in a real browser
 * against the scripted api (docs/design/navigation-and-landing.md; ADR 0012).
 *
 * Dialogs, openings and the session (§3.10 step 4, §3.5 steps 4 and 8)
 * - Back with the delete confirmation open: the page is left, the dialog goes with it, focus lands
 *   on the previous page's `h1`, nothing stays inert.
 * - Back with the delete request still in flight: the request finishes, its result applies (signed
 *   out, on `/`), and `Deleted <login>.` is still announced once.
 * - Leaving `/packs` while a pack opens: the cards land, `Collection (5)` updates, and the reveal is
 *   on `/packs` on return without its entrance.
 * - The session ending while a pack opens (a rename answered `unauthenticated` after the player
 *   moved on to `/packs` and pressed the pack button): `/login` with the session-ended banner; the
 *   pack never reaches the next sign-in.
 * - Unreachable at boot on an account page: `/login` with the banner and the guard line; `Try again`
 *   that finds a session replaces `/login` with the page asked for (§3.2 step 4).
 *
 * Modified clicks (§3.5 step 3, §3.9 item 8)
 * - Ctrl-click and middle-click on every header link (signed in: the wordmark, Packs, Collection,
 *   Manage account; signed out: the wordmark, Log in, Register) open a new tab at that address; the
 *   current tab keeps its address, history length, title, focus and state. The new tab boots from
 *   its own session check and carries no return path.
 *
 * Phone widths (§5.1, §7 "Touch targets")
 * - At 320 and 400 px no page scrolls sideways (every route, both sessions, with a long login and a
 *   full collection); signed in, the page links sit on their own row under the wordmark; signed
 *   out, the wordmark, Log in and Register share one row; every header link, the Account control
 *   and the skip link are at least 40 px tall. Below 400 px `(<N>)` leaves the screen but not the
 *   accessible name.
 *
 * Screen reader order (§3.6, §7 "Titles", "Live region")
 * - On every page change the title is already the new page's when focus reaches the `h1`; plain
 *   navigation writes nothing to any `role=status` element; the first render moves no focus.
 *
 * Scroll (§3.11)
 * - Forward restores the position of the entry it returns to; Back across a reload starts at the top
 *   (the data is gone) with the `h1` focused.
 *
 * Return path and open redirects (§3.3; docs/05-security.md)
 * - A forged `history.state.returnTo` written by script (then a reload, or a forged history entry
 *   reached by Back and Forward) in every rejected form of §3.3 step 3 shows no guard line and a
 *   log in lands on `/packs`; no request or navigation leaves the origin. A valid forged value is the
 *   positive control.
 * - A query or hash on the guarded address is not carried: the return path is the bare page.
 * - Addresses shaped like other hosts (`//evil.example`, `/\evil.example`, encoded slashes) stay on
 *   this origin and are the not-found page; so does `/assets` without a slash.
 * - A `returnTo` or `next` in the query string of `/login` is never followed.
 *
 * Addresses (§3.1 rule 2)
 * - Every route with a trailing slash (one or more) is replaced by its own path; every route in
 *   another case is the not-found page; signed out, `/collection/` still records `/collection`.
 * - A reload on every deep link keeps it (signed in), or keeps `/login` with the guard line and the
 *   return path (signed out).
 * - The not-found page reached by Back keeps the signed-in game state.
 * - The title of every route, signed in and out.
 *
 * Encoded letters: `/%70acks` is decoded by the router to `/packs` and the address rewritten to the
 *   list's entry (pinned as observed; the guard records the entry, never the typed string).
 *
 * Failing on purpose until fixed (bugs, not flakes):
 * - Delete account… pressed right after Escape closed the confirmation is lost (ManageAccount.tsx
 *   learns of the close only from the later `close` event); the same race makes accounts.spec.ts
 *   "the delete confirmation: focus in its field, ..." fail intermittently.
 * - The wordmark link is 28 px tall on phone; §7 wants every header link at 40 px.
 *
 * Copy (§8 "Words")
 * - The rendered text of every page a signed-out visitor can see, and of the signed-in pages, holds
 *   none of the forbidden words, no exclamation mark and no currency symbol.
 */

const CHRIS = makeAccount();
const LONG = makeAccount({ login: "W".repeat(24) });
const SESSION_ENDED = "You were logged out. Log in again to continue.";

const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const control = (page: Page, login = "Chris") =>
  page.getByRole("button", { name: `Account menu. Signed in as ${isolated(login)}`, exact: true });
const packButton = (page: Page) => page.getByRole("button", { name: /open booster pack/i });
const loginField = (page: Page) => page.getByRole("textbox", { name: "Login", exact: true });
const passwordField = (page: Page) => page.getByLabel("Password", { exact: true });
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
/**
 * Scrolls the window and waits for the `scroll` event: the router records a position only for a target
 * that fired one since the last page change, and the event comes a frame after `scrollY` changes, so
 * pressing Back before it would leave nothing to restore.
 */
const scrollTo600 = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        document.addEventListener("scroll", () => resolve(), { once: true, capture: true });
        window.scrollTo(0, 600);
      }),
  );
const focusedHeading = (page: Page) =>
  page.evaluate(() => (document.activeElement?.tagName === "H1" ? document.activeElement.textContent : null));
const heldReturnTo = (page: Page) =>
  page.evaluate(() => (history.state as { returnTo?: unknown } | null)?.returnTo);

async function logIn(page: Page) {
  await loginField(page).fill("Chris");
  await passwordField(page).fill("correct horse");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

async function signedInAt(page: Page, path: string, login = "Chris") {
  await page.goto(path);
  await expect(control(page, login)).toBeVisible();
}

/** Every request and every top-level navigation the page makes, to prove nothing leaves the origin. */
function recordOrigins(page: Page): { foreign: string[] } {
  const foreign: string[] = [];
  const own = (url: string) => {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "about:" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      // AniList is mocked by the fixture; anything else is foreign.
      hostname === "graphql.anilist.co" ||
      hostname === "s4.anilist.co"
    );
  };
  page.on("request", (request) => {
    if (!own(request.url())) foreign.push(`request ${request.url()}`);
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && !own(frame.url())) foreign.push(`navigation ${frame.url()}`);
  });
  return { foreign };
}

/** Records, in the page, the title at the moment each `h1` receives focus. */
async function recordTitleOnHeadingFocus(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __focusTitles: string[] }).__focusTitles = seen;
    document.addEventListener(
      "focusin",
      (event) => {
        const target = event.target as Element | null;
        if (target?.tagName === "H1") seen.push(`${target.textContent ?? ""} | ${document.title}`);
      },
      true,
    );
  });
}
const focusTitles = (page: Page) =>
  page.evaluate(() => (window as unknown as { __focusTitles?: string[] }).__focusTitles ?? []);

test.describe("dialogs, openings and the session (§3.10, §3.5)", () => {
  test("Back with the delete confirmation open leaves the page; the dialog goes with it and nothing stays inert", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInAt(page, "/packs");
    await control(page).click();
    await page.getByRole("menuitem", { name: "Manage account" }).click();
    await expect(h1(page, "Manage account")).toBeFocused();
    await page.getByRole("button", { name: "Delete account…" }).click();
    await expect(page.getByRole("dialog", { name: "Delete Chris?" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/packs$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => focusedHeading(page)).toBe("Packs");
    await expect(page).toHaveTitle("Packs · Anime TCG");
    // The page behind is usable: a click reaches the header, which a leftover modal would block.
    await mainNav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await expect(h1(page, "Collection")).toBeFocused();
  });

  test("Back with the delete request in flight: it finishes, the visitor is signed out on /, and it is announced once", async ({
    page,
    api,
  }) => {
    await recordStatusTexts(page);
    api.on("GET /api/session", signedIn(CHRIS));
    const hold = deferred();
    api.on("POST /api/account/delete", async () => {
      await hold.promise;
      return noContent;
    });
    await signedInAt(page, "/packs");
    await control(page).click();
    await page.getByRole("menuitem", { name: "Manage account" }).click();
    await expect(h1(page, "Manage account")).toBeFocused();
    await page.getByRole("button", { name: "Delete account…" }).click();
    await page.getByRole("dialog").getByLabel("Password", { exact: true }).fill("correct horse");
    await page.getByRole("button", { name: "Delete Chris", exact: true }).click();
    await expect.poll(() => api.count("POST /api/account/delete")).toBe(1);

    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    hold.release();

    // §3.10 step 4: the result applies whatever page is showing; the account is gone, so is the game.
    await expect(page).toHaveURL(/\/$/);
    await expect(h1(page, "Anime TCG")).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(control(page)).toHaveCount(0);
    await expect(page).toHaveTitle("Anime TCG");
    await expect.poll(() => statusTexts(page)).toContain("Deleted Chris.");
    expect((await statusTexts(page)).filter((text) => text === "Deleted Chris.")).toHaveLength(1);
  });

  test("leaving /packs while a pack opens: the cards land, the count updates, the reveal waits without its entrance", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInAt(page, "/packs");
    await expect(packButton(page)).toBeEnabled();
    await packButton(page).click();
    // The links stay usable during an opening; the Account control does not (accounts.md §4.5).
    await mainNav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await expect(h1(page, "Collection")).toBeFocused();
    await expect(mainNav(page).getByRole("link", { name: "Collection (5)" })).toBeVisible();
    await expect(control(page)).toBeEnabled();

    await mainNav(page).getByRole("link", { name: "Packs", exact: true }).click();
    await expect(h1(page, "Packs")).toBeFocused();
    await expect(page.getByRole("article")).toHaveCount(5);
    await expect(page.locator("article.card-reveal")).toHaveCount(0);
  });

  test("the session ending while a pack opens: /login with the banner, and the pack never reaches the next sign-in", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    const hold = deferred();
    api.on("PATCH /api/account/login", async () => {
      await hold.promise;
      return envelope(401, "unauthenticated");
    });
    api.on("POST /api/session/login", signedIn(CHRIS));
    // A fake clock that flows like the real one, so the reveal timer can be run out below instead of waited for.
    await page.clock.install();
    await signedInAt(page, "/account");
    await page.getByRole("main").getByRole("textbox", { name: "New login" }).fill("Kris");
    await page.getByRole("main").getByRole("button", { name: "Save" }).click();
    await expect.poll(() => api.count("PATCH /api/account/login")).toBe(1);

    await mainNav(page).getByRole("link", { name: "Packs", exact: true }).click();
    await expect(packButton(page)).toBeEnabled();
    await packButton(page).click();
    hold.release();

    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page, "Log in")).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: SESSION_ENDED })).toBeVisible();
    expect(await heldReturnTo(page)).toBe("/packs");
    // Fires every timer due in the next second, useGame's 350 ms reveal among them: the pack has
    // landed, while signed out, before the next sign-in starts.
    await page.clock.runFor(1_000);
    await logIn(page);
    await expect(page).toHaveURL(/\/packs$/);
    await expect(h1(page, "Packs")).toBeFocused();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(mainNav(page).getByRole("link", { name: /^Collection/ })).toHaveAccessibleName(
      "Collection (0)",
    );
  });

  // BUG, and the race behind the intermittent failure of accounts.spec.ts "the delete confirmation:
  // focus in its field, Tab stays inside, Escape and Cancel return to its trigger": Escape closes the
  // native dialog at once and the browser puts focus back on `Delete account…`, but React learns of
  // it only from the `close` event, which arrives in a later task. A press of `Delete account…` in
  // between finds `confirming` still true, changes nothing, and the `close` event then sets it false:
  // the press is lost and the confirmation stays shut. Here the two happen in one task, so the
  // outcome does not depend on timing.
  test("Delete account… pressed right after Escape closed the confirmation opens it again", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInAt(page, "/account");
    const trigger = page.getByRole("button", { name: "Delete account…" });
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Delete Chris?" })).toBeVisible();

    await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement & { requestClose?: () => void }>(
        "dialog[open]",
      );
      if (dialog === null) throw new Error("no open dialog");
      // requestClose is what Escape does (cancel, then close); close() where it is missing.
      if (typeof dialog.requestClose === "function") dialog.requestClose();
      else dialog.close();
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent === "Delete account…",
      );
      button?.click();
    });

    await expect(page.getByRole("dialog", { name: "Delete Chris?" })).toBeVisible();
    await expect(page.getByRole("dialog").getByLabel("Password", { exact: true })).toBeFocused();
  });

  test("unreachable at boot on an account page: /login with banner and guard line; Try again with a session returns to it", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", "abort", signedIn(CHRIS));
    await page.goto("/collection");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("alert")).toContainText("Couldn't reach the game server.");
    await expect(page.getByText("Log in to see your collection.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page).toHaveURL(/\/collection$/);
    await expect(control(page)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page).toHaveTitle("Collection · Anime TCG");
  });
});

test.describe("modified clicks open a new tab and leave this one alone (§3.5 step 3)", () => {
  /** The new tab boots from its own session check: script it for the whole context. */
  async function scriptContext(context: BrowserContext, session: Answer) {
    await context.route("https://graphql.anilist.co/**", (route) =>
      route.fulfill({ json: makeAniListResponse(20) }),
    );
    await context.route("https://s4.anilist.co/**", (route) =>
      route.fulfill({ body: PNG, contentType: "image/png" }),
    );
    await context.route(
      (url) => url.pathname.startsWith("/api/"),
      (route) =>
        new URL(route.request().url()).pathname === "/api/session"
          ? route.fulfill({ status: session.status, json: session.json })
          : route.fulfill(envelope(500, "internal")),
    );
  }

  async function snapshot(page: Page) {
    return page.evaluate(() => ({
      href: location.href,
      length: history.length,
      title: document.title,
      focused: document.activeElement?.textContent ?? null,
      state: JSON.stringify(history.state),
    }));
  }

  async function expectNewTab(
    page: Page,
    link: Locator,
    how: "ctrl" | "middle",
    path: string,
    h1Name: string,
  ) {
    const before = await snapshot(page);
    const opened = page.context().waitForEvent("page");
    if (how === "ctrl") await link.click({ modifiers: ["ControlOrMeta"] });
    else await link.click({ button: "middle" });
    const tab = await opened;
    await tab.waitForLoadState();
    await expect(tab).toHaveURL((url) => url.pathname === path);
    await expect(h1(tab, h1Name)).toBeVisible();
    // A new tab is a fresh load: no return path, no state from this one.
    expect(await heldReturnTo(tab)).toBeUndefined();
    await tab.close();
    // This tab: same address, no new entry, same title and state.
    const after = await snapshot(page);
    expect({ ...after, focused: undefined }).toEqual({ ...before, focused: undefined });
  }

  for (const how of ["ctrl", "middle"] as const) {
    test(`signed in, ${how}-click on the wordmark, Packs, Collection and Manage account`, async ({
      page,
      api,
      context,
    }) => {
      api.on("GET /api/session", signedIn(CHRIS));
      await scriptContext(context, signedIn(CHRIS));
      await signedInAt(page, "/collection");
      await expect(packButton(page)).toHaveCount(0);

      await expectNewTab(page, page.getByRole("link", { name: "Anime TCG" }), how, "/packs", "Packs");
      await expectNewTab(
        page,
        mainNav(page).getByRole("link", { name: "Packs", exact: true }),
        how,
        "/packs",
        "Packs",
      );
      // The current page's own link too: the inert plain click must not swallow a modified one.
      await expectNewTab(
        page,
        mainNav(page).getByRole("link", { name: /^Collection/ }),
        how,
        "/collection",
        "Collection",
      );
      await control(page).click();
      await expectNewTab(
        page,
        page.getByRole("menuitem", { name: "Manage account" }),
        how,
        "/account",
        "Manage account",
      );
      await expect(page).toHaveURL(/\/collection$/);
      await expect(h1(page, "Collection")).toBeVisible();
    });

    test(`signed out, ${how}-click on the wordmark, Log in and Register`, async ({ page, api, context }) => {
      api.on("GET /api/session", signedOut);
      await scriptContext(context, signedOut);
      await page.goto("/login");
      await expect(h1(page, "Log in")).toBeVisible();

      await expectNewTab(page, page.getByRole("link", { name: "Anime TCG" }), how, "/", "Anime TCG");
      await expectNewTab(page, mainNav(page).getByRole("link", { name: "Log in" }), how, "/login", "Log in");
      await expectNewTab(
        page,
        mainNav(page).getByRole("link", { name: "Register" }),
        how,
        "/register",
        "Register",
      );
      await expect(page).toHaveURL(/\/login$/);
    });
  }
});

test.describe("phone widths (§5.1, §7 touch targets)", () => {
  const box = async (locator: Locator) => {
    const b = await locator.boundingBox();
    if (b === null) throw new Error("not rendered");
    return b;
  };
  const noSidewaysScroll = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  for (const width of [320, 400]) {
    test(`${width} px signed out: no sideways scroll on any page; one header row; 40 px header links`, async ({
      page,
      api,
    }) => {
      api.on("GET /api/session", signedOut);
      await page.setViewportSize({ width, height: 700 });
      for (const path of ["/", "/login", "/register", "/no-such-page"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await noSidewaysScroll(page), path).toBe(true);
        const wordmark = await box(page.getByRole("link", { name: "Anime TCG" }));
        const logInLink = await box(mainNav(page).getByRole("link", { name: "Log in" }));
        const registerLink = await box(mainNav(page).getByRole("link", { name: "Register" }));
        // One row: the three share a vertical band.
        expect(
          Math.abs(logInLink.y + logInLink.height / 2 - (wordmark.y + wordmark.height / 2)),
          path,
        ).toBeLessThan(wordmark.height);
        expect(registerLink.y, path).toBeLessThan(wordmark.y + wordmark.height);
        for (const [name, b] of [
          ["Log in", logInLink],
          ["Register", registerLink],
        ] as const) {
          expect(b.height, `${path} ${name} height`).toBeGreaterThanOrEqual(40);
        }
      }
      // The skip link, once focused, is a 40 px target too.
      await page.goto("/");
      await expect(h1(page, "Anime TCG")).toBeVisible();
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip).toBeFocused();
      expect((await box(skip)).height).toBeGreaterThanOrEqual(40);
    });

    test(`${width} px signed in with a 24-character login and a full collection: no sideways scroll; links on their own row; 40 px targets`, async ({
      page,
      api,
    }) => {
      api.on("GET /api/session", signedIn(LONG));
      await page.setViewportSize({ width, height: 700 });

      const checkHeader = async (path: string) => {
        expect(await noSidewaysScroll(page), path).toBe(true);
        const wordmark = await box(page.getByRole("link", { name: "Anime TCG" }));
        const nav = await box(mainNav(page));
        const account = await box(control(page, LONG.login));
        // Row 1: wordmark and Account control; row 2: the links, the full width of the container (§5.1).
        expect(nav.y, `${path} links on their own row`).toBeGreaterThanOrEqual(
          Math.max(wordmark.y + wordmark.height, account.y + account.height) - 1,
        );
        expect(nav.width, `${path} links full width`).toBeGreaterThanOrEqual(width - 2 * 16 - 1);
        for (const link of await mainNav(page).getByRole("link").all()) {
          const name = (await link.innerText()).replace(/\s+/g, " ");
          expect((await box(link)).height, `${path} ${name} height`).toBeGreaterThanOrEqual(40);
        }
        expect(account.height, `${path} Account control height`).toBeGreaterThanOrEqual(40);
      };

      // Pages that need no collection, by address.
      for (const [path, heading] of [
        ["/profile", "Profile"],
        ["/no-such-page", "Page not found"],
        ["/account", "Manage account"],
      ] as const) {
        await signedInAt(page, path, LONG.login);
        await expect(h1(page, heading)).toBeVisible();
        await checkHeader(path);
      }

      // Then a full collection, reached in-app so it is kept.
      await mainNav(page).getByRole("link", { name: "Packs", exact: true }).click();
      await expect(h1(page, "Packs")).toBeFocused();
      for (let pack = 1; pack <= 3; pack += 1) {
        await expect(packButton(page)).toBeEnabled();
        await packButton(page).click();
        await expect(mainNav(page).getByRole("link", { name: `Collection (${pack * 5})` })).toBeVisible();
      }
      await expect(page.getByRole("article")).toHaveCount(5);
      await checkHeader("/packs");
      const collectionLink = mainNav(page).getByRole("link", { name: "Collection (15)" });
      await collectionLink.click();
      await expect(h1(page, "Collection")).toBeFocused();
      await checkHeader("/collection");
      // Below 400 px the count leaves the screen but stays in the accessible name (§5.1).
      await expect(collectionLink).toHaveAccessibleName("Collection (15)");
      const count = await box(collectionLink.getByText("(15)"));
      if (width < 400) expect(count.width).toBeLessThanOrEqual(1);
      else expect(count.width).toBeGreaterThan(1);
    });

    // BUG (navigation-and-landing.md §7 "Touch targets", accounts.md §7): the wordmark is a header link
    // (§3.5 steps 1 and 2) and renders 28 px tall on phone; every other header link is 40 px.
    test(`${width} px: the wordmark link is a 40 px target too, signed out and signed in`, async ({
      page,
      api,
    }) => {
      api.on("GET /api/session", signedOut, signedIn(CHRIS));
      await page.setViewportSize({ width, height: 700 });
      const heights: Record<string, number> = {};
      await page.goto("/");
      await expect(h1(page, "Anime TCG")).toBeVisible();
      heights["signed out"] = (await box(page.getByRole("link", { name: "Anime TCG" }))).height;
      await signedInAt(page, "/packs");
      heights["signed in"] = (await box(page.getByRole("link", { name: "Anime TCG" }))).height;
      const short = Object.entries(heights).filter(([, height]) => height < 40);
      expect(short, "wordmark heights under 40 px").toEqual([]);
    });
  }
});

test.describe("screen-reader order on navigation (§3.6, §7)", () => {
  test("the title is the new page's when focus reaches the h1, and plain navigation announces nothing", async ({
    page,
    api,
  }) => {
    await recordTitleOnHeadingFocus(page);
    await recordStatusTexts(page);
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInAt(page, "/packs");
    // The first render moves no focus (§3.6 step 2).
    expect(await focusTitles(page)).toEqual([]);

    await mainNav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await expect(h1(page, "Collection")).toBeFocused();
    await control(page).click();
    await page.getByRole("menuitem", { name: "Manage account" }).click();
    await expect(h1(page, "Manage account")).toBeFocused();
    await page.goBack();
    await expect.poll(() => focusedHeading(page)).toBe("Collection");
    await page.goBack();
    await expect.poll(() => focusedHeading(page)).toBe("Packs");
    await page.goForward();
    await expect.poll(() => focusedHeading(page)).toBe("Collection");
    await page.getByRole("link", { name: "Anime TCG" }).click();
    await expect(h1(page, "Packs")).toBeFocused();

    expect(await focusTitles(page)).toEqual([
      "Collection | Collection · Anime TCG",
      "Manage account | Manage account · Anime TCG",
      "Collection | Collection · Anime TCG",
      "Packs | Packs · Anime TCG",
      "Collection | Collection · Anime TCG",
      "Packs | Packs · Anime TCG",
    ]);
    // No "navigated to" in the live region or any other status element (§7 "Live region").
    expect(await statusTexts(page)).toEqual([]);
  });

  test("signed out: the same order on the public pages, nothing announced", async ({ page, api }) => {
    await recordTitleOnHeadingFocus(page);
    await recordStatusTexts(page);
    api.on("GET /api/session", signedOut);
    await page.goto("/");
    await expect(h1(page, "Anime TCG")).toBeVisible();
    await mainNav(page).getByRole("link", { name: "Log in" }).click();
    await expect(h1(page, "Log in")).toBeFocused();
    await page.getByRole("main").getByRole("link", { name: "Register" }).click();
    await expect(h1(page, "Register")).toBeFocused();
    await page.getByRole("link", { name: "Anime TCG" }).click();
    await expect(h1(page, "Anime TCG")).toBeFocused();
    expect(await focusTitles(page)).toEqual([
      "Log in | Log in · Anime TCG",
      "Register | Register · Anime TCG",
      "Anime TCG | Anime TCG",
    ]);
    expect(await statusTexts(page)).toEqual([]);
  });
});

test.describe("scroll (§3.11)", () => {
  test("Forward restores the position of the entry it returns to", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await page.setViewportSize({ width: 800, height: 420 });
    await signedInAt(page, "/packs");
    for (let pack = 1; pack <= 4; pack += 1) {
      await expect(packButton(page)).toBeEnabled();
      await packButton(page).click();
      await expect(mainNav(page).getByRole("link", { name: `Collection (${pack * 5})` })).toBeVisible();
    }
    await mainNav(page).getByRole("link", { name: "Collection (20)" }).click();
    await expect(h1(page, "Collection")).toBeFocused();
    await scrollTo600(page);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(500);

    await page.goBack();
    await expect.poll(() => focusedHeading(page)).toBe("Packs");
    await page.goForward();
    await expect(page).toHaveURL(/\/collection$/);
    await expect.poll(() => focusedHeading(page)).toBe("Collection");
    await expect.poll(() => scrollY(page)).toBeGreaterThan(500);
  });

  test("Back across a reload starts at the top, with the h1 focused", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await page.setViewportSize({ width: 800, height: 420 });
    await signedInAt(page, "/packs");
    for (let pack = 1; pack <= 4; pack += 1) {
      await expect(packButton(page)).toBeEnabled();
      await packButton(page).click();
      await expect(mainNav(page).getByRole("link", { name: `Collection (${pack * 5})` })).toBeVisible();
    }
    await mainNav(page).getByRole("link", { name: "Collection (20)" }).click();
    await scrollTo600(page);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(500);
    await mainNav(page)
      .getByRole("link", { name: "Packs", exact: true })
      .evaluate((link) => (link as HTMLAnchorElement).click());
    await expect(h1(page, "Packs")).toBeFocused();

    await page.reload();
    await expect(h1(page, "Packs")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/collection$/);
    await expect.poll(() => focusedHeading(page)).toBe("Collection");
    // The reload discarded the collection (§3.10 step 3), so there is nothing to restore into.
    await expect(mainNav(page).getByRole("link", { name: /^Collection/ })).toHaveAccessibleName(
      "Collection (0)",
    );
    await expect.poll(() => scrollY(page)).toBe(0);
  });
});

/** Every rejected form of §3.3 step 3, as values a script on this origin could leave in history.state. */
const FORGED: { name: string; value: () => unknown }[] = [
  { name: "a full URL", value: () => "https://evil.example/" },
  { name: "a protocol-relative URL", value: () => "//evil.example" },
  { name: "a backslash host", value: () => "/\\evil.example" },
  { name: "encoded slashes", value: () => "%2F%2Fevil.example" },
  { name: "a path of encoded slashes", value: () => "/%2F%2Fevil.example" },
  { name: "javascript:", value: () => "javascript:alert(1)" },
  { name: "data:", value: () => "data:text/html,<p>x</p>" },
  { name: "an unknown path", value: () => "/unknown" },
  { name: "a page with a query", value: () => "/collection?next=//evil.example" },
  { name: "a page with a hash", value: () => "/collection#x" },
  { name: "a page in another case", value: () => "/COLLECTION" },
  { name: "a page with a trailing slash", value: () => "/collection/" },
  { name: "a page with a leading space", value: () => " /collection" },
  { name: "a page with an encoded letter", value: () => "/c%6Fllection" },
  { name: "a public page", value: () => "/login" },
  { name: "a dot segment", value: () => "/collection/../account" },
  { name: "a very long value", value: () => `/${"a".repeat(5000)}` },
  { name: "a number", value: () => 42 },
  { name: "null", value: () => null },
  { name: "an array", value: () => ["/collection"] },
  { name: "an object", value: () => ({ pathname: "/collection" }) },
];

test.describe("a forged return path in history.state (§3.3 step 3, docs/05-security.md)", () => {
  for (const { name, value } of FORGED) {
    test(`${name}: no guard line, and a log in lands on /packs on this origin`, async ({ page, api }) => {
      const origins = recordOrigins(page);
      api.on("GET /api/session", signedOut);
      api.on("POST /api/session/login", signedIn(CHRIS));
      await page.goto("/login");
      await expect(h1(page, "Log in")).toBeVisible();
      await page.evaluate((forged) => {
        history.replaceState({ ...(history.state as object), returnTo: forged }, "");
      }, value());
      await page.reload();
      await expect(h1(page, "Log in")).toBeVisible();
      await expect(page.getByText(/^Log in to /)).toHaveCount(0);
      await logIn(page);
      await expect(h1(page, "Packs")).toBeFocused();
      expect(new URL(page.url()).pathname).toBe("/packs");
      expect(origins.foreign).toEqual([]);
    });
  }

  test("positive control: a forged return path that is a listed page is followed", async ({ page, api }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/session/login", signedIn(CHRIS));
    await page.goto("/login");
    await page.evaluate(() =>
      history.replaceState({ ...(history.state as object), returnTo: "/account" }, ""),
    );
    await page.reload();
    await expect(page.getByText("Log in to manage your account.")).toBeVisible();
    await logIn(page);
    await expect(h1(page, "Manage account")).toBeFocused();
  });

  for (const { name, value } of FORGED.slice(0, 7)) {
    test(`a forged history entry reached by Back and Forward (${name}) is not followed either`, async ({
      page,
      api,
    }) => {
      const origins = recordOrigins(page);
      api.on("GET /api/session", signedOut);
      api.on("POST /api/session/login", signedIn(CHRIS));
      await page.goto("/");
      await expect(h1(page, "Anime TCG")).toBeVisible();
      // A script writes a new /login entry the router never made, then the visitor goes Back and Forward to it.
      await page.evaluate((forged) => {
        history.pushState({ returnTo: forged }, "", "/login");
      }, value());
      await page.goBack();
      await expect(h1(page, "Anime TCG")).toBeVisible();
      await page.goForward();
      await expect(h1(page, "Log in")).toBeVisible();
      await expect(page.getByText(/^Log in to /)).toHaveCount(0);
      await logIn(page);
      await expect(h1(page, "Packs")).toBeFocused();
      expect(new URL(page.url()).pathname).toBe("/packs");
      expect(origins.foreign).toEqual([]);
    });
  }

  test("the register cross-link does not carry a forged value either", async ({ page, api }) => {
    api.on("GET /api/session", signedOut);
    await page.goto("/login");
    await page.evaluate(() =>
      history.replaceState({ ...(history.state as object), returnTo: "//evil.example" }, ""),
    );
    await page.reload();
    await page.getByRole("main").getByRole("link", { name: "Register" }).click();
    await expect(h1(page, "Register")).toBeFocused();
    expect(await heldReturnTo(page)).toBeUndefined();
  });
});

test.describe("open-redirect probes on the address (§3.3, §3.1 rule 2)", () => {
  test("a query or hash on a guarded address is not carried into the return path or the address", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/session/login", signedIn(CHRIS));
    await page.goto("/collection?next=//evil.example#https://evil.example");
    await expect(h1(page, "Log in")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
    expect(await heldReturnTo(page)).toBe("/collection");
    await logIn(page);
    await expect(h1(page, "Collection")).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/collection");
    expect(new URL(page.url()).search).toBe("");
  });

  for (const query of [
    "?returnTo=//evil.example",
    "?next=https://evil.example/",
    "?redirect=/account",
    "?returnTo=/collection",
  ]) {
    test(`/login${query} is never followed: a log in lands on /packs`, async ({ page, api }) => {
      const origins = recordOrigins(page);
      api.on("GET /api/session", signedOut);
      api.on("POST /api/session/login", signedIn(CHRIS));
      await page.goto(`/login${query}`);
      await expect(h1(page, "Log in")).toBeVisible();
      await expect(page.getByText(/^Log in to /)).toHaveCount(0);
      await logIn(page);
      await expect(h1(page, "Packs")).toBeFocused();
      expect(new URL(page.url()).pathname).toBe("/packs");
      expect(new URL(page.url()).search).toBe("");
      expect(origins.foreign).toEqual([]);
    });
  }

  for (const path of [
    "//evil.example",
    "//evil.example/",
    "//evil.example/packs",
    "/\\evil.example",
    "/%2F%2Fevil.example",
    "/%2Fpacks",
    "/packs%2F",
    "/assets",
  ]) {
    for (const session of ["signed out", "signed in"] as const) {
      test(`${path} ${session} stays on this origin and is the not-found page`, async ({
        page,
        api,
        baseURL,
      }) => {
        const origins = recordOrigins(page);
        api.on("GET /api/session", session === "signed in" ? signedIn(CHRIS) : signedOut);
        // Typed exactly, without the URL parser folding the leading slashes into a host.
        const response = await page.goto(`${baseURL}${path}`);
        expect(response?.status()).toBe(200);
        await expect(h1(page, "Page not found")).toBeVisible();
        expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
        await expect(page).toHaveTitle("Page not found · Anime TCG");
        // Its own link and the header still lead inside the site.
        await page.getByRole("main").getByRole("link").click();
        await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
        expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
        expect(new URL(page.url()).pathname).toBe(session === "signed in" ? "/packs" : "/");
        expect(origins.foreign).toEqual([]);
      });
    }
  }
});

test.describe("an encoded letter in the address (§3.1 rule 2)", () => {
  // Observed behaviour, pinned so a router upgrade cannot change it silently: the router decodes an
  // encoded unreserved letter (RFC 3986 §6.2.2.2 treats `/%70acks` and `/packs` as the same path) and
  // rewrites the address to the list's own entry. What the guard records is that entry, never the
  // typed string, so the return-path check of §3.3 step 3 still only ever sees listed paths.
  for (const [typed, path, heading] of [
    ["/%70acks", "/packs", "Packs"],
    ["/col%6Cection", "/collection", "Collection"],
  ] as const) {
    test(`${typed} signed in is ${path}, and the address becomes ${path}`, async ({ page, api }) => {
      api.on("GET /api/session", signedIn(CHRIS));
      await signedInAt(page, typed);
      await expect(h1(page, heading)).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page).toHaveTitle(`${heading} · Anime TCG`);
    });

    test(`${typed} signed out records ${path} as the return path`, async ({ page, api }) => {
      api.on("GET /api/session", signedOut);
      await page.goto(typed);
      await expect(h1(page, "Log in")).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/login");
      expect(await heldReturnTo(page)).toBe(path);
    });
  }

  test("an encoded letter in another case is still the not-found page", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInAt(page, "/%70ACKS");
    await expect(h1(page, "Page not found")).toBeVisible();
  });
});

const ACCOUNT_ROUTES = [
  ["/packs", "Packs", "Log in to open your packs."],
  ["/collection", "Collection", "Log in to see your collection."],
  ["/profile", "Profile", "Log in to see your profile."],
  ["/account", "Manage account", "Log in to manage your account."],
] as const;
const PUBLIC_ROUTES = [
  ["/", "Anime TCG", "Anime TCG"],
  ["/login", "Log in", "Log in · Anime TCG"],
  ["/register", "Register", "Register · Anime TCG"],
] as const;

test.describe("addresses on every route (§3.1 rule 2)", () => {
  for (const [path, heading, guardLine] of ACCOUNT_ROUTES) {
    test(`${path}: trailing slashes are replaced, another case is not found, a reload keeps it`, async ({
      page,
      api,
    }) => {
      api.on("GET /api/session", signedIn(CHRIS));
      for (const slashes of ["/", "//"]) {
        await page.goto(`${path}${slashes}`);
        await expect(h1(page, heading)).toBeVisible();
        expect(new URL(page.url()).pathname, `${path}${slashes}`).toBe(path);
      }
      await page.reload();
      await expect(h1(page, heading)).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page).toHaveTitle(`${heading} · Anime TCG`);
      for (const other of [path.toUpperCase(), path[0] + path[1].toUpperCase() + path.slice(2)]) {
        await page.goto(other);
        await expect(h1(page, "Page not found"), other).toBeVisible();
        expect(new URL(page.url()).pathname).toBe(other);
      }
    });

    test(`${path} signed out: with a trailing slash still the guard; a reload on /login keeps the guard line and the return path`, async ({
      page,
      api,
    }) => {
      api.on("GET /api/session", signedOut);
      api.on("POST /api/session/login", signedIn(CHRIS));
      await page.goto(`${path}/`);
      await expect(h1(page, "Log in")).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/login");
      await expect(page.getByText(guardLine)).toBeVisible();
      expect(await heldReturnTo(page)).toBe(path);
      await page.reload();
      await expect(h1(page, "Log in")).toBeVisible();
      await expect(page.getByText(guardLine)).toBeVisible();
      await logIn(page);
      await expect(h1(page, heading)).toBeFocused();
      expect(new URL(page.url()).pathname).toBe(path);
    });
  }

  for (const [path, heading, title] of PUBLIC_ROUTES) {
    test(`${path} signed out: the title, a trailing slash, another case, a reload`, async ({ page, api }) => {
      api.on("GET /api/session", signedOut);
      if (path !== "/") {
        await page.goto(`${path}/`);
        await expect(h1(page, heading)).toBeVisible();
        expect(new URL(page.url()).pathname).toBe(path);
        await page.goto(path.toUpperCase());
        await expect(h1(page, "Page not found")).toBeVisible();
      }
      await page.goto(path);
      await expect(h1(page, heading)).toBeVisible();
      await expect(page).toHaveTitle(title);
      await page.reload();
      await expect(h1(page, heading)).toBeVisible();
      await expect(page).toHaveTitle(title);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    });

    test(`${path} signed in, with or without a trailing slash, is replaced by /packs`, async ({
      page,
      api,
    }) => {
      api.on("GET /api/session", signedIn(CHRIS));
      for (const typed of path === "/" ? ["/"] : [path, `${path}/`]) {
        await page.goto(typed);
        await expect(h1(page, "Packs")).toBeVisible();
        expect(new URL(page.url()).pathname, typed).toBe("/packs");
      }
    });
  }

  test("the not-found page reached by Back keeps the signed-in game state", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await signedInAt(page, "/no-such-page");
    await page.getByRole("link", { name: "Go to Packs" }).click();
    await expect(h1(page, "Packs")).toBeFocused();
    await expect(packButton(page)).toBeEnabled();
    await packButton(page).click();
    await expect(page.getByRole("article")).toHaveCount(5);
    await page.goBack();
    await expect.poll(() => focusedHeading(page)).toBe("Page not found");
    await expect(page).toHaveTitle("Page not found · Anime TCG");
    await expect(mainNav(page).getByRole("link", { name: "Collection (5)" })).toBeVisible();
    await page.goForward();
    await expect.poll(() => focusedHeading(page)).toBe("Packs");
    await expect(page.getByRole("article")).toHaveCount(5);
  });
});

/** §8 "Words", the accounts words and the money and nudge rules, as whole words in the rendered text. */
const FORBIDDEN = [
  "secure",
  "verified",
  "protected",
  "safe",
  "private",
  "attempt",
  "locked",
  "blocked",
  "pay",
  "paid",
  "cash",
  "money",
  "coins?",
  "earn",
  "profit",
  "worth",
  "value",
  "balance",
  "wallet",
  "store",
  "checkout",
  "purchase",
  "hurry",
  "act now",
  "today only",
  "ending soon",
  "last chance",
  "don't miss",
  "only \\d+ left",
  "limited",
  "free",
  "lucky",
  "jackpot",
  "win",
  "prize",
  "you could get",
  "try your luck",
  "one more",
  "another",
];
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN.join("|")})\\b|[!$€£¥₩]`, "i");

test.describe("copy (§8 Words)", () => {
  test("the landing, log in, register and not-found pages hold no forbidden word, no exclamation mark, no currency symbol", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    for (const path of ["/", "/login", "/register", "/no-such-page"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const text = await page.evaluate(() => document.body.innerText);
      expect(text.match(FORBIDDEN_RE)?.[0] ?? null, `${path}: ${text}`).toBeNull();
    }
    // Register step 2 too.
    api.on("POST /api/accounts/check-invite", noContent);
    await page.goto("/register");
    await page.getByRole("textbox", { name: "Invite code" }).fill("ANIME-TCG-2026");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Step 2 of 2")).toBeVisible();
    const step2 = await page.evaluate(() => document.body.innerText);
    expect(step2.match(FORBIDDEN_RE)?.[0] ?? null, step2).toBeNull();
  });

  test("the signed-in pages hold none either", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    for (const path of ["/packs", "/collection", "/profile", "/account", "/no-such-page"]) {
      await signedInAt(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const text = await page.evaluate(() => document.body.innerText);
      expect(text.match(FORBIDDEN_RE)?.[0] ?? null, `${path}: ${text}`).toBeNull();
    }
  });
});
