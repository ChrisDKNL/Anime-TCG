/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { expect, signedOut, test } from "./support/fake-api";

/**
 * Bug (tester, 2026-10-30): the landing page's count of demo packs restarts on a soft navigation.
 *
 * navigation-and-landing.md §3.7 item 1.7 caps the demo at `perVisit` (10) demo packs **per page
 * load**, and names one thing that resets the count: a reload. Leaving `/` discards the cards (§3.7
 * "Demo cards are not kept"), but following a link to `/register` or `/login` and coming back with
 * Back, Forward or the wordmark is not a page load: the document, the router and the query cache all
 * stay. The count lives in `useReducer` inside `LandingPage` (web/src/hooks/useLandingDemo.ts), so it
 * unmounts with the page and every return to `/` starts a fresh ten. After the tenth pack the Join
 * offer stands in the button's place; one link out and one Back bring the button back.
 *
 * Reproduction (dev server, signed out):
 * 1. Open `/`, open 4 demo packs.
 * 2. Click `register` in the keep-cards line, then press Back.
 * 3. Open demo packs: the Join offer should replace the button after the 6th (10 in the page load);
 *    it appears after the 10th (14 in the page load), and the cycle repeats on every round trip.
 *
 * What the spec does say happens: the cards are gone after the round trip (they are not kept), and
 * a reload starts the count over (accepted, the server's DEMO_RATE_LIMIT is the real bound). Both
 * are asserted below so the fix keeps them.
 */

const JOIN = "Playing needs an account, and registering needs an invite code from the owner.";
const KEEP = "To keep cards, register with an invite code.";

const main = (page: Page) => page.getByRole("main");
const demoButton = (page: Page) => main(page).getByRole("button", { name: "Open a demo pack", exact: true });
const demoList = (page: Page) => page.getByRole("list", { name: "Demo pack" });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });

/** Opens `n` demo packs, waiting for each one's cards (the fake api deals new characters every time). */
async function openPacks(page: Page, api: { count: (key: string) => number }, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const before = api.count("POST /api/demo/open");
    await demoButton(page).click();
    await expect.poll(() => api.count("POST /api/demo/open")).toBe(before + 1);
    await expect(demoList(page).getByRole("article").first()).toHaveAccessibleName(
      new RegExp(`Character ${5_000 + (before + 1) * 10}\\b`),
    );
  }
}

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedOut);
});

test("a link out of `/` and Back: the cards are gone but the page load's count goes on (§3.7 item 1.7)", async ({
  page,
  api,
}) => {
  await page.goto("/");
  await openPacks(page, api, 4);
  await main(page).getByText(KEEP).getByRole("link", { name: "register" }).click();
  await expect(h1(page, "Register")).toBeFocused();
  await page.goBack();
  await expect(h1(page, "Anime TCG")).toBeVisible();
  // Not kept (§3.7): the round trip discards the cards.
  await expect(demoList(page)).toHaveCount(0);

  // Six more is ten in this page load: the Join offer takes the button's place.
  await openPacks(page, api, 6);
  expect(api.count("POST /api/demo/open")).toBe(10);
  await expect(main(page).getByText(JOIN).first()).toBeFocused();
  await expect(demoButton(page)).toHaveCount(0);
});

test("after the tenth demo pack, Log in and Back, Forward and Back again: still the Join offer, no button", async ({
  page,
  api,
}) => {
  await page.goto("/");
  await openPacks(page, api, 10);
  await expect(demoButton(page)).toHaveCount(0);
  // The offer's own `Log in`, the first one in the page's main.
  await main(page).getByRole("link", { name: "Log in" }).first().click();
  await expect(h1(page, "Log in")).toBeFocused();
  await page.goBack();
  await expect(h1(page, "Anime TCG")).toBeVisible();
  await expect(demoButton(page)).toHaveCount(0);
  await page.goForward();
  await expect(h1(page, "Log in")).toBeVisible();
  await page.goBack();
  await expect(h1(page, "Anime TCG")).toBeVisible();
  await expect(demoButton(page)).toHaveCount(0);
  expect(api.count("POST /api/demo/open")).toBe(10);

  // A reload is a new page load: the count starts over (§3.7 item 1.7, accepted).
  await page.reload();
  await expect(demoButton(page)).toBeVisible();
});
