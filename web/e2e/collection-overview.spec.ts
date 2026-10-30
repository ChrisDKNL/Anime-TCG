/// <reference lib="dom" />
import type { Locator, Page } from "@playwright/test";
import { makeLargeCollection, makeOverviewCollection } from "../src/test/collectionFixtures";
import { expect, makeAccount, recordStatusTexts, signedIn, statusTexts, test } from "./support/fake-api";

/**
 * Test plan: the collection overview's main journeys in a real browser against a scripted api
 * (docs/design/collection-overview.md). The tester hunts further.
 *
 * - The keyboard path of §7, end to end: the header link, the `Collection` heading, the view
 *   switch, the toolbar in order, a tile, the dialog (focused, trapped, Escape closes it) and focus
 *   back on the tile.
 * - Search, chips, series, duplicates and sort apply at once over the held answer with no request;
 *   the live region hears the results line once, after the typing stops.
 * - Pages: 60 tiles, Next scrolls the results line to the top and focuses it.
 * - The Series view: rows in the server's order, `Show cards` lands on the filtered Cards view.
 * - Layout: the column counts of §5.1 at each width, no sideways scroll at 320 px, the dialog's two
 *   columns from 640 px; glint plays on keyboard focus and stops under reduced motion.
 * - A query string is never read, and no control writes one.
 * - 3,000 entries: at most 60 tiles; a keystroke's time with the CPU throttled 4× is recorded.
 */

const CHRIS = makeAccount({ cards: 8 });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const resultsLine = (page: Page) => page.locator("#collection-results");
const grid = (page: Page) => page.getByRole("list", { name: /results?/ });
const tiles = (page: Page) => grid(page).getByRole("button");
const search = (page: Page) => page.getByRole("searchbox", { name: "Search" });

async function signedInAt(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

async function tileNames(page: Page): Promise<string[]> {
  const labels = await tiles(page).evaluateAll((buttons) =>
    buttons.map((b) => b.getAttribute("aria-label") ?? ""),
  );
  return labels.map((label) => label.split(",")[0].replace(/[\u2068\u2069]/g, ""));
}

async function expectTabOrder(page: Page, stops: Locator[]) {
  for (const stop of stops) {
    await page.keyboard.press("Tab");
    await expect(stop).toBeFocused();
  }
}

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedIn(CHRIS));
  api.on("GET /api/collection", { status: 200, json: makeOverviewCollection() });
});

test("the keyboard path: header link, toolbar in order, a tile, the dialog, Escape, focus back", async ({
  page,
}) => {
  await signedInAt(page, "/packs");
  await mainNav(page).getByRole("link", { name: "Collection (8)" }).focus();
  await page.keyboard.press("Enter");
  await expect(h1(page, "Collection")).toBeFocused();
  await expect(page).toHaveTitle("Collection · Anime TCG");
  await expect(page.getByRole("search", { name: "Collection filters" })).toBeVisible();

  const rarity = page.getByRole("group", { name: "Rarity" });
  await expectTabOrder(page, [
    page.getByRole("button", { name: "Cards", exact: true }),
    page.getByRole("button", { name: "Series", exact: true }),
    search(page),
    page.getByRole("combobox", { name: "Series" }),
    page.getByRole("combobox", { name: "Sort" }),
    rarity.getByRole("button", { name: "All", exact: true }),
    rarity.getByRole("button", { name: "Common", exact: true }),
    rarity.getByRole("button", { name: "Uncommon", exact: true }),
    rarity.getByRole("button", { name: "Rare", exact: true }),
    rarity.getByRole("button", { name: "Epic", exact: true }),
    rarity.getByRole("button", { name: "Legendary", exact: true }),
    rarity.getByRole("button", { name: "Mythic", exact: true }),
    page.getByRole("checkbox", { name: "Duplicates only" }),
    tiles(page).first(),
    tiles(page).nth(1),
  ]);

  // The second tile is Spike (Epic): Enter opens its dialog, which takes focus and traps it.
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Spike Spiegel" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog.getByText("Packs now give")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(tiles(page).nth(1)).toBeFocused();
});

test("search, chips, series, duplicates and sort apply at once with no request; the live region hears the line once", async ({
  page,
  api,
}) => {
  await recordStatusTexts(page);
  await signedInAt(page, "/collection");
  await expect(resultsLine(page)).toHaveText("5 results");
  const asked = api.count("GET /api/collection");

  // One change, so one announcement; the unit test pins the 500 ms debounce across keystrokes.
  await search(page).fill("pok");
  await expect(resultsLine(page)).toHaveText("2 results");
  expect(await tileNames(page)).toEqual(["Moved Star", "Pikachu"]);
  await expect
    .poll(async () => (await statusTexts(page)).filter((text) => text.includes("result")))
    .toEqual(["2 results"]);
  await search(page).press("Escape");
  await expect(search(page)).toHaveValue("");
  await expect(search(page)).toBeFocused();

  const rarity = page.getByRole("group", { name: "Rarity" });
  await rarity.getByRole("button", { name: "Epic", exact: true }).click();
  await rarity.getByRole("button", { name: "Rare", exact: true }).click();
  expect(await tileNames(page)).toEqual(["Spike Spiegel", "Gon Freecss"]);
  await rarity.getByRole("button", { name: "All", exact: true }).click();

  await page.getByRole("combobox", { name: "Series" }).selectOption("100");
  await expect(page.getByText("Cowboy Bebop: 2 of 4 characters")).toBeVisible();
  expect(await tileNames(page)).toEqual(["Spike Spiegel", "Pikachu"]);
  await page.getByRole("checkbox", { name: "Duplicates only" }).check();
  expect(await tileNames(page)).toEqual(["Spike Spiegel"]);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(resultsLine(page)).toBeFocused();
  await page.getByRole("combobox", { name: "Sort" }).selectOption("name");
  expect(await tileNames(page)).toEqual([
    "Gon Freecss",
    "Moved Star",
    "Old Hero",
    "Pikachu",
    "Spike Spiegel",
  ]);

  expect(api.count("GET /api/collection")).toBe(asked);
  expect(new URL(page.url()).search).toBe("");
});

test("pages: 60 tiles a page; Next scrolls the results line to the top and focuses it", async ({
  page,
  api,
}) => {
  api.on("GET /api/collection", { status: 200, json: makeLargeCollection(130) });
  await page.setViewportSize({ width: 1200, height: 800 });
  await signedInAt(page, "/collection");
  await expect(resultsLine(page)).toHaveText("130 results · page 1 of 3");
  await expect(tiles(page)).toHaveCount(60);
  const pages = page.getByRole("navigation", { name: "Pages" });
  await pages.getByRole("button", { name: "Next page" }).click();
  await expect(resultsLine(page)).toHaveText("130 results · page 2 of 3");
  await expect(resultsLine(page)).toBeFocused();
  const top = await resultsLine(page).evaluate((line) => line.getBoundingClientRect().top);
  expect(Math.abs(top)).toBeLessThan(2);
  await pages.getByRole("combobox", { name: "Page" }).selectOption("3");
  await expect(tiles(page)).toHaveCount(10);
  await expect(pages.getByRole("button", { name: "Next page" })).toBeDisabled();
});

test("the Series view: every series in the server's order; Show cards lands on the filtered Cards view", async ({
  page,
}) => {
  await signedInAt(page, "/collection");
  await page.getByRole("button", { name: "Series", exact: true }).click();
  await expect(page.getByRole("button", { name: "Series", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const section = page.getByRole("region", { name: "Series completion" });
  await expect(section.getByRole("listitem")).toHaveCount(5);
  await expect(section.getByRole("listitem").first()).toContainText("Bleach");
  await expect(section.getByRole("listitem").first()).toContainText("0 of 12");
  await expect(section.getByRole("listitem").first().getByRole("button")).toHaveCount(0);
  await expect(section.getByText("5 series from the 100 most popular anime on AniList")).toBeVisible();

  await section.getByRole("button", { name: "Show cards from \u2068Pokémon\u2069" }).click();
  await expect(page.getByRole("button", { name: "Cards", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(resultsLine(page)).toBeFocused();
  await expect(resultsLine(page)).toHaveText("2 results");
  await expect(page.getByRole("combobox", { name: "Series" })).toHaveValue("101");
});

test.describe("layout (§5.1, §5.4)", () => {
  for (const [width, columns] of [
    [320, 2],
    [559, 2],
    [600, 3],
    [800, 4],
    [1000, 5],
    [1200, 6],
  ] as const) {
    test(`${width} px: ${columns} columns, no sideways scroll`, async ({ page, api }) => {
      api.on("GET /api/collection", { status: 200, json: makeLargeCollection(12) });
      await page.setViewportSize({ width, height: 900 });
      await signedInAt(page, "/collection");
      await expect(tiles(page)).toHaveCount(12);
      const tops = await tiles(page).evaluateAll((buttons) =>
        buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
      );
      expect(tops.filter((top) => top === tops[0])).toHaveLength(columns);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test("the dialog: two columns from 640 px, the card above the heading on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await signedInAt(page, "/collection");
    await tiles(page).nth(1).click();
    const dialog = page.getByRole("dialog", { name: "Spike Spiegel" });
    const card = dialog.getByRole("article");
    const heading = dialog.getByRole("heading", { level: 2 });
    await expect(card).toHaveCSS("width", "240px");
    const wide = { card: (await card.boundingBox())!, heading: (await heading.boundingBox())! };
    expect(wide.heading.x).toBeGreaterThan(wide.card.x + wide.card.width);

    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 360, height: 800 });
    await tiles(page).nth(1).click();
    const narrow = { card: (await card.boundingBox())!, heading: (await heading.boundingBox())! };
    expect(narrow.heading.y).toBeGreaterThan(narrow.card.y + narrow.card.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  test("a focused Epic tile glints; under reduced motion nothing loops", async ({ page }) => {
    await signedInAt(page, "/collection");
    const spike = tiles(page).nth(1);
    const glint = (tile: Locator) =>
      tile.locator(".card-frame-epic").evaluate((frame) => getComputedStyle(frame, "::after").animationName);
    await expect.poll(() => glint(spike)).toBe("none");
    await spike.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(spike).toBeFocused();
    await expect.poll(() => glint(spike)).toBe("card-glint");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});

test("a query string is never read", async ({ page }) => {
  await signedInAt(page, "/packs");
  await page.goto("/collection?q=spike&page=2&series=100");
  await expect(h1(page, "Collection")).toBeVisible();
  await expect(resultsLine(page)).toHaveText("5 results");
  await expect(search(page)).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Series" })).toHaveValue("");
});

test("3,000 entries: at most 60 tiles, and a keystroke's time with the CPU throttled 4×", async ({
  page,
  api,
}, testInfo) => {
  api.on("GET /api/collection", { status: 200, json: makeLargeCollection(3_000) });
  await signedInAt(page, "/collection");
  await expect(resultsLine(page)).toHaveText("3,000 results · page 1 of 50");
  await expect(tiles(page)).toHaveCount(60);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await search(page).focus();
  const elapsed = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const line = document.getElementById("collection-results")!;
        const start = performance.now();
        new MutationObserver((_, observer) => {
          observer.disconnect();
          resolve(performance.now() - start);
        }).observe(line, { childList: true, characterData: true, subtree: true });
        const field = document.querySelector<HTMLInputElement>('input[type="search"]')!;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setValue.call(field, "card 1");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }),
  );
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  testInfo.annotations.push({
    type: "keystroke to the new page of tiles, ms (4x CPU)",
    description: elapsed.toFixed(1),
  });
  await expect(resultsLine(page)).toHaveText("1,542 results · page 1 of 26");
  await expect(tiles(page)).toHaveCount(60);
});
