/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { deferred, expect, isolated, makeAccount, signedIn, signedOut, test } from "./support/fake-api";

/**
 * Test plan: addresses, the guard and page changes in a real browser against a scripted api
 * (docs/design/navigation-and-landing.md §3.1–§3.6, §3.11, §4.7). The Vite dev server falls back
 * to index.html for every path, as Caddy does (§3.12 item 8), so a typed address is a real load.
 *
 * - A deep link to /collection signed out lands on /login (the address bar says /login and nothing
 *   else, the guard line names the page); logging in replaces /login with /collection, and Back
 *   then skips both /login and the guard.
 * - Back and Forward between pages: the title follows, the `h1` takes focus, and the scroll
 *   position of the entry comes back; a new page starts at the top.
 * - Unknown addresses, wrong case and deeper paths are the not-found page with a 200 and the header
 *   that matches the session; `/packs/` is replaced by `/packs`.
 * - A reload on a deep link stays on that page; the first render moves no focus.
 * - The current page's own link adds no history entry. A query string is dropped on the next
 *   navigation. The skip link is the first stop and changes no address.
 * - A log in still in flight when the visitor follows a header link to /register signs them in
 *   when it answers, and lands them on /packs (§4.3).
 */

const CHRIS = makeAccount();
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const control = (page: Page) =>
  page.getByRole("button", { name: `Account menu. Signed in as ${isolated("Chris")}`, exact: true });
const historyLength = (page: Page) => page.evaluate(() => history.length);
const focusedHeading = (page: Page) =>
  page.evaluate(() => (document.activeElement?.tagName === "H1" ? document.activeElement.textContent : null));

test("a deep link to /collection signed out goes to /login and back to /collection after logging in", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedOut);
  api.on("POST /api/session/login", signedIn(CHRIS));
  await page.goto("/collection");
  await expect(page).toHaveURL(/\/login$/);
  await expect(h1(page, "Log in")).toBeVisible();
  await expect(page.getByText("Log in to see your collection.")).toBeVisible();
  // The return path is in history state only: nothing in the address, nothing a link could forge.
  expect(new URL(page.url()).search).toBe("");
  expect(await page.evaluate(() => (history.state as { returnTo?: unknown } | null)?.returnTo)).toBe(
    "/collection",
  );
  await expect(page).toHaveTitle("Log in · Anime TCG");
  const entries = await historyLength(page);

  await page.getByRole("textbox", { name: "Login", exact: true }).fill("Chris");
  await page.getByLabel("Password", { exact: true }).fill("correct horse");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/collection$/);
  await expect(h1(page, "Collection")).toBeFocused();
  await expect(page).toHaveTitle("Collection · Anime TCG");
  // The guard and the sign-in replaced the entry, they did not push one.
  expect(await historyLength(page)).toBe(entries);

  // Back leaves the site: neither /login nor the guarded /collection entry is in between.
  await page.goBack();
  expect(page.url()).toBe("about:blank");
});

test("Back and Forward: title and focus follow, and each entry's scroll position comes back", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedIn(CHRIS));
  await page.setViewportSize({ width: 800, height: 420 });
  await page.goto("/packs");
  const open = page.getByRole("button", { name: /open booster pack/i });
  await expect(open).toBeEnabled();
  for (let pack = 1; pack <= 4; pack += 1) {
    await open.click();
    await expect(mainNav(page).getByRole("link", { name: `Collection (${pack * 5})` })).toBeVisible();
  }

  await mainNav(page).getByRole("link", { name: "Collection (20)" }).click();
  await expect(h1(page, "Collection")).toBeFocused();
  await expect(page).toHaveTitle("Collection · Anime TCG");
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);

  // A new page starts at the top. The click is dispatched in the page: Playwright would scroll the
  // header link into view first, and the position to restore is the one the reader left.
  await mainNav(page)
    .getByRole("link", { name: "Packs", exact: true })
    .evaluate((link) => (link as HTMLAnchorElement).click());
  await expect(h1(page, "Packs")).toBeFocused();
  await expect(page).toHaveTitle("Packs · Anime TCG");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  // Back restores the collection's position, and focusing its h1 does not scroll it away.
  await page.goBack();
  await expect(page).toHaveURL(/\/collection$/);
  await expect.poll(() => focusedHeading(page)).toBe("Collection");
  await expect(page).toHaveTitle("Collection · Anime TCG");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);

  await page.goForward();
  await expect(page).toHaveURL(/\/packs$/);
  await expect.poll(() => focusedHeading(page)).toBe("Packs");
  // The last reveal is still there, without its entrance (§3.10 step 2).
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(page.locator("article.card-reveal")).toHaveCount(0);
});

test.describe("addresses (§3.1 rule 2, §4.7)", () => {
  for (const path of ["/no-such-page", "/Packs", "/packs/1", "/shop", "/market", "/index.html"]) {
    test(`${path} is the not-found page with a 200, signed out with the public header`, async ({
      page,
      api,
    }) => {
      api.on("GET /api/session", signedOut);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(h1(page, "Page not found")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${path.replace(/[.]/g, "\\.")}$`));
      await expect(page.getByText("There's no page at this address.")).toBeVisible();
      await expect(mainNav(page).getByRole("link", { name: "Log in" })).toBeVisible();
      await expect(page).toHaveTitle("Page not found · Anime TCG");
      await page.getByRole("link", { name: "Go to the start page" }).click();
      await expect(h1(page, "Anime TCG")).toBeFocused();
    });
  }

  test("signed in, the not-found page has the signed-in header and leads to Packs", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await page.goto("/no-such-page");
    await expect(h1(page, "Page not found")).toBeVisible();
    await expect(control(page)).toBeVisible();
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Go to Packs" }).click();
    await expect(h1(page, "Packs")).toBeFocused();
  });

  test("/packs/ is replaced by /packs at load", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await page.goto("/packs/");
    await expect(page).toHaveURL(/\/packs$/);
    await expect(h1(page, "Packs")).toBeVisible();
    await expect(page).toHaveTitle("Packs · Anime TCG");
  });

  test("a query string is never read and is dropped on the next navigation", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await page.goto("/packs?view=grid#top");
    await expect(h1(page, "Packs")).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: "Packs", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await mainNav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await expect(page).toHaveURL(/\/collection$/);
  });
});

test("a reload on a deep link stays on it; the first render moves no focus", async ({ page, api }) => {
  api.on("GET /api/session", signedIn(CHRIS));
  await page.goto("/account");
  await expect(h1(page, "Manage account")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/account$/);
  await expect(h1(page, "Manage account")).toBeVisible();
  await expect(page).toHaveTitle("Manage account · Anime TCG");
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  // The menu marks the current page (§3.4 step 1).
  await control(page).click();
  await expect(page.getByRole("menuitem", { name: "Manage account" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the current page's own link adds no history entry", async ({ page, api }) => {
  api.on("GET /api/session", signedIn(CHRIS));
  await page.goto("/packs");
  await expect(h1(page, "Packs")).toBeVisible();
  const before = await historyLength(page);
  const packs = mainNav(page).getByRole("link", { name: "Packs", exact: true });
  await packs.click();
  await page.getByRole("link", { name: "Anime TCG" }).click();
  await expect(packs).toHaveAttribute("aria-current", "page");
  expect(await historyLength(page)).toBe(before);
});

test("the skip link is the first stop and focuses the heading without touching the address", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedIn(CHRIS));
  await page.goto("/collection");
  await expect(h1(page, "Collection")).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(h1(page, "Collection")).toBeFocused();
  expect(new URL(page.url()).hash).toBe("");
});

test("a signed-in visitor at /login is replaced by /packs, and Back does not return to /login", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedIn(CHRIS));
  await page.goto("/login");
  await expect(page).toHaveURL(/\/packs$/);
  await expect(h1(page, "Packs")).toBeVisible();
  await page.goBack();
  expect(page.url()).toBe("about:blank");
});

test("the landing page: heading, How it plays and Join, with Register one step away", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedOut);
  await page.goto("/");
  await expect(h1(page, "Anime TCG")).toBeVisible();
  await expect(
    page.getByText("Characters from the most popular anime on AniList, five to a pack."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["How it plays", "Join"]);
  await expect(page.getByRole("term")).toHaveText(["Packs", "Rarity", "Collection"]);
  // No demo block before 1c's server pool (§9 decision 1): no button, no odds table, nothing called.
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("main").getByRole("link", { name: "Register" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(h1(page, "Register")).toBeFocused();
});

test("a log in that answers after the visitor moved on to /register still signs them in", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedOut);
  const hold = deferred();
  api.on("POST /api/session/login", async () => {
    await hold.promise;
    return signedIn(CHRIS);
  });
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Login", exact: true }).fill("Chris");
  await page.getByLabel("Password", { exact: true }).fill("correct horse");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect.poll(() => api.count("POST /api/session/login")).toBe(1);

  // The links stay usable while the form waits (§4.3); leaving drops the answer from the screen only.
  await mainNav(page).getByRole("link", { name: "Register" }).click();
  await expect(h1(page, "Register")).toBeFocused();
  hold.release();

  await expect(page).toHaveURL(/\/packs$/);
  await expect(control(page)).toBeVisible();
  await expect(h1(page, "Packs")).toBeFocused();
});
