/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { makeCharacter, makeListing } from "../src/test/fixtures";
import { expect, makeAccount, signedIn, test } from "./support/fake-api";

/**
 * Bug (tester hunt on feat/market-ui, 2026-10-31): at a 320 px viewport an unbroken AniList name
 * widens the listing dialog past the screen in two places that sit in a `flex flex-col items-start`
 * column, where the text is sized to its content and `break-words` (`overflow-wrap: break-word`)
 * does not lower its min-content width:
 *
 * 1. the purchase result's heading `<name> is in your collection` (ListingDialog `Bought`);
 * 2. the own listing's cancel status `Listing cancelled. <name> is available again.` (ListingDialog
 *    `OwnListing`, through CancelLine).
 *
 * Measured: the dialog's scrollWidth 1138 px against a clientWidth of 286 px for case 1.
 * collection-overview.md §5.6 and market-and-shop.md §5.3: an unbroken name wraps anywhere and
 * never widens the dialog; the details' heading and the confirmation's already do.
 */

test.use({ viewport: { width: 320, height: 720 } });

const LONG = `Wolfeschlegelsteinhausenbergerdorff${"x".repeat(80)}`;
const dialog = (page: Page) => page.getByRole("dialog");
const tile = (page: Page) =>
  page.getByRole("main").getByRole("list", { name: /shown/ }).getByRole("button").first();

async function dialogOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return dialog(page).evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
}

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedIn(makeAccount({ cards: 3 })));
});

test("the purchase result's heading wraps a long unbroken name at 320 px", async ({ page, api }) => {
  api.game.market = [
    makeListing(1, { price: 20, character: makeCharacter(2_001, { name: LONG, tier: "rare" }) }),
  ];
  await page.goto("/market");
  await tile(page).click();
  await dialog(page).getByRole("button", { name: "Buy…" }).click();
  await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
  await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
  const { scrollWidth, clientWidth } = await dialogOverflow(page);
  expect(scrollWidth, "the result widens the dialog").toBeLessThanOrEqual(clientWidth);
});

test("the own listing's cancel status wraps a long unbroken name at 320 px", async ({ page, api }) => {
  api.game.market = [
    makeListing(1, {
      price: 20,
      mine: true,
      character: makeCharacter(2_001, { name: LONG, tier: "rare" }),
    }),
  ];
  await page.goto("/market");
  await tile(page).click();
  await dialog(page).getByRole("button", { name: "Cancel listing" }).click();
  await expect(
    dialog(page)
      .getByRole("status")
      .filter({ hasText: /^Listing cancelled\./ }),
  ).toBeVisible();
  const { scrollWidth, clientWidth } = await dialogOverflow(page);
  expect(scrollWidth, "the cancel status widens the dialog").toBeLessThanOrEqual(clientWidth);
});
