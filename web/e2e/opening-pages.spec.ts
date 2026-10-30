/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import {
  deferred,
  envelope,
  expect,
  makeAccount,
  recordStatusTexts,
  signedIn,
  signedOut,
  statusTexts,
  test,
  type ApiCall,
  type FakeApi,
} from "./support/fake-api";

/**
 * Test plan: the opening pages, `/packs/open` and `/shop/open`, in a real browser against the
 * scripted api (docs/design/packs-page.md §3.7, §4.4, §10 item 17; navigation-and-landing.md
 * §3.13; market-and-shop.md §3.3 step 6).
 *
 * - `Open pack` on /packs: the URL, the title and the focus of /packs/open; no countdown, pity line
 *   or odds there. Back to /packs (its h1 focused, `See your latest pack`); Forward: the same cards,
 *   nothing animating, one `GET /api/packs`.
 * - A load and a reload of /packs/open end on /packs: its title, no focus move, no `POST`.
 * - Signed out, /packs/open goes to /login; logging in lands on /packs.
 * - A 409 on /packs/open's own button ends on /packs with the line, read once; a lost answer ends
 *   on /packs with `Try again`, which pushes /packs/open again and shows the same cards.
 * - An answer delayed while the player is on /collection: nothing announced there; Back onto
 *   /packs/open shows the cards without animation.
 * - The header's Packs link: `aria-current="true"` on /packs/open, `"page"` on /packs.
 * - The same for /shop/open: the push after a purchase, Back to /shop, Forward, a reload, the guard.
 */

const CHRIS = makeAccount({ cards: 0 });
const main = (page: Page) => page.getByRole("main");
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const packButton = (page: Page, name = "Open pack") => main(page).getByRole("button", { name, exact: true });
const reveal = (page: Page) => page.getByRole("list", { name: "Your pack" });
const NONE_LEFT = "There was no pack left to open.";

/** The default game, answered by the test's own script. */
const game = (api: FakeApi) => (call: ApiCall) => api.game.reply(call.key, call.body)!;

/** The character names of the reveal's cards, in slot order. */
function revealNames(page: Page): Promise<string[]> {
  return reveal(page)
    .getByRole("article")
    .evaluateAll((articles) => articles.map((a) => a.querySelector("[title]")?.textContent ?? ""));
}

/** What the scripted game deals for its `n`th opening. */
const namesOfOpening = (n: number) => [0, 1, 2, 3, 4].map((slot) => `Character ${1_000 + n * 10 + slot}`);

async function openFromPacks(page: Page) {
  await page.goto("/packs");
  await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
  await packButton(page).click();
  await expect(reveal(page).getByRole("article")).toHaveCount(5);
}

test.describe("/packs/open", () => {
  test.beforeEach(({ api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
  });

  test("Open pack moves there: its title, its h1 focused, the count, Open pack and Back to packs, no countdown or odds", async ({
    page,
  }) => {
    await openFromPacks(page);
    await expect(page).toHaveURL(/\/packs\/open$/);
    await expect(page).toHaveTitle("Pack opening · Anime TCG");
    await expect(h1(page, "Pack opening")).toBeFocused();
    await expect(main(page).getByText("2 of 3 packs ready")).toBeVisible();
    await expect(packButton(page)).toBeVisible();
    await expect(main(page).getByRole("link", { name: "Back to packs" })).toHaveAttribute("href", "/packs");
    await expect(page.getByText(/Next pack in/)).toHaveCount(0);
    await expect(page.getByText(/Mythic guaranteed/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pack odds" })).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Packs", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("Back to /packs with its h1 focused and See your latest pack; Forward shows the same cards, nothing animating, one GET", async ({
    page,
    api,
  }) => {
    await openFromPacks(page);
    const names = await revealNames(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/packs$/);
    await expect(h1(page, "Packs")).toBeFocused();
    await expect(main(page).getByRole("link", { name: "See your latest pack" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Packs", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.waitForLoadState("networkidle");
    const gets = api.count("GET /api/packs");

    await page.goForward();
    await expect(page).toHaveURL(/\/packs\/open$/);
    await expect(h1(page, "Pack opening")).toBeFocused();
    expect(await revealNames(page)).toEqual(names);
    expect(await reveal(page).evaluate((list) => list.getAnimations({ subtree: true }).length)).toBe(0);
    await expect.poll(() => api.count("GET /api/packs")).toBe(gets + 1);
  });

  test("a load and a reload of /packs/open end on /packs: its title, no focus move, no POST", async ({
    page,
    api,
  }) => {
    await page.goto("/packs/open");
    await expect(page).toHaveURL(/\/packs$/);
    await expect(page).toHaveTitle("Packs · Anime TCG");
    await expect(h1(page, "Packs")).not.toBeFocused();
    expect(api.count("POST /api/packs/open")).toBe(0);

    await packButton(page).click();
    await expect(reveal(page).getByRole("article")).toHaveCount(5);
    await page.reload();
    await expect(page).toHaveURL(/\/packs$/);
    await expect(h1(page, "Packs")).toBeVisible();
    await expect(h1(page, "Packs")).not.toBeFocused();
    await expect(main(page).getByRole("link", { name: "See your latest pack" })).toHaveCount(0);
    expect(api.count("POST /api/packs/open")).toBe(1);
  });

  test("a 409 on its own Open pack ends on /packs with the line, read once", async ({ page, api }) => {
    await recordStatusTexts(page);
    api.on("POST /api/packs/open", game(api), envelope(409, "no_pack_available", 600));
    await openFromPacks(page);
    // Another device spends the two packs left while this page shows `2 of 3`.
    api.game.available = 0;
    await packButton(page).click();
    await expect(page).toHaveURL(/\/packs$/);
    await expect(h1(page, "Packs")).toBeFocused();
    await expect(main(page).getByRole("status").filter({ hasText: NONE_LEFT })).toBeVisible();
    await expect(main(page).getByRole("link", { name: "See your latest pack" })).toHaveCount(0);
    await expect.poll(() => statusTexts(page)).toContain(NONE_LEFT);
    // Once by the line itself, once by the live region after the replace (packs-page.md §3.7 step 6).
    await page.waitForLoadState("networkidle");
    expect((await statusTexts(page)).filter((text) => text === NONE_LEFT)).toHaveLength(2);
  });

  test("a lost answer ends on /packs with Try again, which pushes /packs/open again and shows the same cards", async ({
    page,
    api,
  }) => {
    api.on(
      "POST /api/packs/open",
      (call) => {
        api.game.reply(call.key, call.body);
        return "abort";
      },
      game(api),
    );
    await page.goto("/packs");
    await packButton(page).click();
    await expect(page).toHaveURL(/\/packs$/);
    const retry = packButton(page, "Try again");
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page).toHaveURL(/\/packs\/open$/);
    await expect(reveal(page).getByRole("article")).toHaveCount(5);
    // The pack the lost answer carried, not a second one.
    expect(await revealNames(page)).toEqual(namesOfOpening(1));
    const ids = api.bodies("POST /api/packs/open").map((body) => (body as { requestId: string }).requestId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  test("an answer delayed while the player is on /collection: nothing announced; Back shows the cards without animation", async ({
    page,
    api,
  }) => {
    await recordStatusTexts(page);
    const opening = deferred();
    api.on("POST /api/packs/open", async (call) => {
      await opening.promise;
      return game(api)(call);
    });
    await page.goto("/packs");
    await packButton(page).click();
    await expect(h1(page, "Pack opening")).toBeFocused();
    await nav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await expect(h1(page, "Collection")).toBeFocused();
    opening.release();
    await expect(nav(page).getByRole("link", { name: "Collection (5)" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect((await statusTexts(page)).some((text) => text.startsWith("Your pack"))).toBe(false);

    await page.goBack();
    await expect(h1(page, "Pack opening")).toBeFocused();
    await expect(reveal(page).getByRole("article")).toHaveCount(5);
    expect(await reveal(page).evaluate((list) => list.getAnimations({ subtree: true }).length)).toBe(0);
  });
});

test.describe("signed out", () => {
  for (const [path, section, heading] of [
    ["/packs/open", "/packs", "Packs"],
    ["/shop/open", "/shop", "Shop"],
  ] as const) {
    test(`${path} goes to /login, and logging in lands on ${section}`, async ({ page, api }) => {
      api.on("GET /api/session", signedOut);
      api.on("POST /api/session/login", signedIn(CHRIS));
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      expect(await page.evaluate(() => (history.state as { returnTo?: unknown } | null)?.returnTo)).toBe(
        section,
      );
      await page.getByRole("textbox", { name: "Login", exact: true }).fill("Chris");
      await page.getByLabel("Password", { exact: true }).fill("correct horse");
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page).toHaveURL((url) => url.pathname === section);
      await expect(h1(page, heading)).toBeFocused();
    });
  }
});

test.describe("/shop/open", () => {
  test.beforeEach(({ api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
  });

  async function buy(page: Page) {
    await page.goto("/shop");
    await page.getByRole("article", { name: "Action" }).getByRole("button", { name: "Buy…" }).click();
    await page
      .getByRole("dialog", { name: "Buy the Action pack?" })
      .getByRole("button", { name: "Buy for 400 Karma" })
      .click();
    await expect(page.getByRole("list", { name: "Action pack" }).getByRole("article")).toHaveCount(5);
  }

  test("a purchase pushes it: Shop pack, Back to the shop, no buy button; Back, Forward and a reload", async ({
    page,
    api,
  }) => {
    await buy(page);
    await expect(page).toHaveURL(/\/shop\/open$/);
    await expect(page).toHaveTitle("Shop pack · Anime TCG");
    await expect(h1(page, "Shop pack")).toBeFocused();
    await expect(main(page).getByRole("button")).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Shop", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await page.goBack();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(h1(page, "Shop")).toBeFocused();
    await expect(main(page).getByRole("link", { name: "See your latest shop pack" })).toBeVisible();
    await page.goForward();
    await expect(h1(page, "Shop pack")).toBeFocused();
    const list = page.getByRole("list", { name: "Action pack" });
    expect(await list.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);

    await page.reload();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(h1(page, "Shop")).not.toBeFocused();
    await expect(main(page).getByRole("link", { name: "See your latest shop pack" })).toHaveCount(0);
    expect(api.count("POST /api/shop/buy")).toBe(1);
  });
});
