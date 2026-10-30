/// <reference lib="dom" />
import type { Locator, Page } from "@playwright/test";
import { makeDemo, makeDemoOpened, makeUnavailableDemo } from "../src/test/fixtures";
import { deferred, expect, signedOut, test } from "./support/fake-api";

/**
 * Test plan: the redesigned landing page in a real browser against the scripted api
 * (docs/design/navigation-and-landing.md §3.7, §4.5, §5.3, §6.2, §7, §11 "e2e" items 1 to 6).
 * The demo pack's own page, `/demo`, is demo.spec.ts.
 *
 * - The order of the page; the facts in the lede, the numbered steps and the Pack odds section.
 * - The pack drawing: shown from 640 px, not at 320 px, and it never moves, glows or lifts, before a
 *   hover, during one and while a demo pack opens.
 * - The button is flat (no gradient) and does not lift; at 320 × 568 it is above the fold.
 * - One primary action in the hero: one button, no link styled as one.
 * - Only the app's origin and s4.anilist.co are asked for anything, three demo packs included.
 * - No sideways scroll at 320, 640 and 1024 px; the odds table's three columns fit at 320.
 * - No pool, and facts that get no answer.
 */

const LEDE = "2,983 characters from the 100 most popular anime on AniList, five to a pack.";
const DISCLOSURE =
  "A demo pack uses the same odds as every pack in the game. Its cards aren't kept: nothing is saved, and they don't go to any account.";

const main = (page: Page) => page.getByRole("main");
const demoButton = (page: Page) => main(page).getByRole("button", { name: "Open a demo pack", exact: true });
const hero = (page: Page) => page.getByRole("region", { name: "Anime TCG" });
const drawing = (page: Page) => page.getByTestId("landing-pack");

/** What the drawing is doing now: its running animations, its shadow and its transform. */
function stillness(pack: Locator) {
  return pack.evaluate((element) => ({
    animations: element.getAnimations({ subtree: true }).length,
    boxShadow: getComputedStyle(element).boxShadow,
    transform: getComputedStyle(element).transform,
  }));
}
const STILL = { animations: 0, boxShadow: "none", transform: "none" };

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedOut);
});

test("the page in order: h1, the button, the disclosure, How it plays, Pack odds, Join, the footer; no reveal", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText(LEDE)).toBeVisible();
  await expect(page.getByRole("table", { name: "Pack odds" })).toBeVisible();
  const order = await page.evaluate(() => {
    const at = (element: Element | null | undefined) =>
      element === null || element === undefined
        ? -1
        : Array.from(document.querySelectorAll("*")).indexOf(element);
    const byText = (text: string) =>
      Array.from(document.querySelectorAll("p")).find((element) => element.textContent === text);
    const heading = (level: string, name: string) =>
      Array.from(document.querySelectorAll(level)).find((element) => element.textContent === name);
    return [
      at(heading("h1", "Anime TCG")),
      at(
        Array.from(document.querySelectorAll("main button")).find(
          (b) => b.textContent === "Open a demo pack",
        ),
      ),
      at(
        byText(
          "A demo pack uses the same odds as every pack in the game. Its cards aren't kept: nothing is saved, and they don't go to any account.",
        ),
      ),
      at(heading("h2", "How it plays")),
      at(heading("h2", "Pack odds")),
      at(heading("h2", "Join")),
      at(document.querySelector("footer")),
    ];
  });
  expect(order.every((index) => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await expect(page.getByRole("list", { name: "Demo pack" })).toHaveCount(0);
  await expect(page.getByText(DISCLOSURE)).toBeVisible();

  const steps = page.getByRole("region", { name: "How it plays" }).getByRole("listitem");
  await expect(steps).toHaveCount(5);
  await expect(steps.getByRole("heading", { level: 3 })).toHaveText([
    "Packs",
    "Rarity",
    "Collection",
    "Karma",
    "Market",
  ]);
  await expect(steps.first()).toContainText("01");
  await expect(steps.first()).toContainText(
    "A new pack every 10 minutes, and up to 3 can pile up. Five cards each.",
  );

  const odds = page.getByRole("table", { name: "Pack odds" });
  await expect(odds.getByRole("row")).toHaveCount(7);
  await expect(odds.getByRole("row", { name: /Mythic/ })).toContainText("0.25%");
  await expect(odds.getByRole("row", { name: /Mythic/ })).toContainText("0.05%");
  await expect(page.getByText("Drawn from 2,983 characters, as of 29 Oct 2026.")).toBeVisible();
});

for (const width of [640, 1024]) {
  test(`at ${width} px the pack drawing sits beside the text and never moves, glows or lifts`, async ({
    page,
    api,
  }) => {
    const answer = deferred();
    api.on("POST /api/demo/open", async () => {
      await answer.promise;
      return { status: 200, json: makeDemoOpened() };
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const pack = drawing(page);
    await expect(pack).toBeVisible();
    await expect(pack).toHaveAttribute("aria-hidden", "true");
    await expect(pack).toContainText("Demo pack");
    await expect(pack).toContainText("Five cards");
    const box = await pack.boundingBox();
    expect(box?.width).toBe(180);
    expect(box?.height).toBe(252);
    const button = await demoButton(page).boundingBox();
    // Beside the text, not under it.
    expect(box !== null && button !== null && box.x > button.x + button.width).toBe(true);
    expect(await stillness(pack)).toEqual(STILL);

    await pack.hover({ force: true });
    expect(await stillness(pack)).toEqual(STILL);

    // While a demo pack opens: pressed on `/`, then back on `/` with the opening still in flight.
    await demoButton(page).click();
    await expect(page).toHaveURL(/\/demo$/);
    await page.goBack();
    await expect(main(page).getByRole("button", { name: "Opening…" })).toBeVisible();
    expect(await stillness(drawing(page))).toEqual(STILL);
    answer.release();
    await expect(demoButton(page)).toBeVisible();
    expect(await stillness(drawing(page))).toEqual(STILL);
  });
}

test("at 320 × 568 the pack drawing is not rendered and the button is above the fold", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await expect(demoButton(page)).toBeVisible();
  await expect(drawing(page)).toBeHidden();
  await expect(demoButton(page)).toBeInViewport({ ratio: 1 });
});

test("the button is the app's flat primary: no gradient, no lift on hover; the hero holds one action", async ({
  page,
}) => {
  await page.goto("/");
  const button = demoButton(page);
  await expect(button).toBeVisible();
  const look = () =>
    button.evaluate((element) => ({
      backgroundImage: getComputedStyle(element).backgroundImage,
      transform: getComputedStyle(element).transform,
    }));
  expect(await look()).toEqual({ backgroundImage: "none", transform: "none" });
  await button.hover();
  expect(await look()).toEqual({ backgroundImage: "none", transform: "none" });
  await expect(hero(page).getByRole("button")).toHaveCount(1);
  await expect(hero(page).getByRole("link")).toHaveCount(0);
});

test("loading / and opening three demo packs asks only the app's origin and s4.anilist.co", async ({
  page,
}) => {
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  await page.goto("/");
  await expect(page.getByRole("table", { name: "Pack odds" })).toBeVisible();
  await demoButton(page).click();
  const list = page.getByRole("list", { name: "Demo pack" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  for (let i = 0; i < 2; i += 1) {
    const first = await list.getByRole("article").first().getAttribute("aria-label");
    await demoButton(page).click();
    await expect(list.getByRole("article").first()).not.toHaveAttribute("aria-label", first ?? "");
  }
  const origin = new URL(page.url()).host;
  expect([...hosts].filter((host) => host !== origin && host !== "s4.anilist.co")).toEqual([]);
});

for (const width of [320, 640, 1024]) {
  test(`at ${width} px the landing page has no sideways scroll and the odds table fits`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const table = page.getByRole("table", { name: "Pack odds" });
    await expect(table).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const tableBox = await table.boundingBox();
    expect(tableBox !== null && tableBox.x + tableBox.width <= width).toBe(true);
    // The stars show from 640 px; below it the swatch alone stands before the word.
    const stars = table.getByRole("rowheader", { name: "Mythic" }).locator("span").nth(1);
    if (width < 640) await expect(stars).toBeHidden();
    else await expect(stars).toBeVisible();
  });
}

test("no pool: the unavailable line in the button's place and no Pack odds section", async ({
  page,
  api,
}) => {
  api.on("GET /api/demo", { status: 200, json: makeUnavailableDemo() });
  await page.goto("/");
  await expect(page.getByText("Demo packs are unavailable right now.")).toBeVisible();
  await expect(main(page).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Pack odds" })).toHaveCount(0);
  await expect(
    page.getByText("Characters from the most popular anime on AniList, five to a pack."),
  ).toBeVisible();
  expect(api.count("POST /api/demo/open")).toBe(0);
});

test("facts with no answer: the unreachable banner over the no-facts page, and the demo still opens", async ({
  page,
  api,
}) => {
  api.on("GET /api/demo", "abort", { status: 200, json: makeDemo() });
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't reach the game server." })).toBeVisible();
  await expect(
    page.getByText("Characters from the most popular anime on AniList, five to a pack."),
  ).toBeVisible();
  await demoButton(page).click();
  await expect(page.getByRole("list", { name: "Demo pack" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByText(LEDE)).toBeVisible();
});
