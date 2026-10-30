/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { makeCharacter, makeEntry, makeWallet } from "../src/test/fixtures";
import {
  envelope,
  expect,
  isolated,
  makeAccount,
  recordStatusTexts,
  signedIn,
  statusTexts,
  test,
  type ApiCall,
  type FakeApi,
} from "./support/fake-api";

/**
 * Test plan: the economy UI's two journeys in a real browser against the scripted api
 * (docs/design/market-and-shop.md §3.1 to §3.3, collection-overview.md §3.6, economy.md §12).
 *
 * - The header shows the server's balance, and every receipt's balance replaces it.
 * - Shop: the Shop link, the page's heading and title, a purchase from the confirmation to the
 *   reveal (focus on its heading), until the balance no longer covers the price.
 * - Shop refusals: `insufficient_funds` with the server's balance, 503 `pool_unavailable`, a 429
 *   with its countdown, and a lost answer whose `Try again` replays the same `requestId`, so the
 *   pack is bought once.
 * - Recycle: duplicates for Karma from the card dialog, `not_enough_copies` after the collection
 *   changed, `balance_limit`, and a lost answer replayed once.
 * - Nothing is written to storage or the address.
 */

const CHRIS = makeAccount({ cards: 0 });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const header = (page: Page) => page.getByRole("banner");
const theme = (page: Page) => page.getByRole("article", { name: "Action" });
const confirmation = (page: Page) => page.getByRole("dialog", { name: "Buy the Action pack?" });
const cardDialog = (page: Page) => page.getByRole("dialog");
const requestIds = (api: FakeApi, key: string) =>
  api.bodies(key).map((body) => (body as { requestId: string }).requestId);

/** The api handles the request, but the answer never reaches the browser. */
const answerLost = (api: FakeApi) => (call: ApiCall) => {
  api.game.reply(call.key, call.body);
  return "abort" as const;
};

async function openShop(page: Page) {
  await page.goto("/shop");
  await expect(h1(page, "Shop")).toBeVisible();
  await expect(header(page).getByText("1,240 Karma")).toBeVisible();
  await expect(theme(page)).toBeVisible();
}

async function confirmBuy(page: Page) {
  await openShop(page);
  await theme(page).getByRole("button", { name: "Buy…" }).click();
  await expect(confirmation(page)).toBeVisible();
}

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedIn(CHRIS));
});

test.describe("the Shop page", () => {
  test("a purchase from the header link to the reveal, until the balance no longer covers the price", async ({
    page,
    api,
  }) => {
    await recordStatusTexts(page);
    await page.goto("/packs");
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shop" }).click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(page).toHaveTitle("Shop · Anime TCG");
    await expect(h1(page, "Shop")).toBeFocused();
    await expect(theme(page).getByText("400 Karma")).toBeVisible();
    await expect(theme(page).getByText(/^At least one per pack: Common 99\.9%/)).toBeVisible();

    for (const balance of ["840", "440", "40"]) {
      await theme(page).getByRole("button", { name: "Buy…" }).click();
      await expect(confirmation(page).getByRole("heading")).toBeFocused();
      await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
      const reveal = page.getByRole("heading", { level: 2, name: "Action pack", exact: true });
      await expect(reveal).toBeFocused();
      await expect(page.getByRole("list", { name: "Action pack" }).getByRole("article")).toHaveCount(5);
      await expect(header(page).getByText(`${balance} Karma`)).toBeVisible();
    }
    expect(await statusTexts(page)).toContain(
      `Bought the ${isolated("Action")} pack for 400 Karma. You have 40 Karma.`,
    );
    await expect(page.getByRole("link", { name: "Collection (15)" })).toBeVisible();

    const buy = theme(page).getByRole("button", { name: "Buy…" });
    await expect(buy).toHaveAttribute("aria-disabled", "true");
    await expect(theme(page).getByText("Costs 400 Karma. You have 40.")).toBeVisible();
    await buy.click({ force: true });
    await expect(confirmation(page)).toHaveCount(0);

    expect(api.count("POST /api/shop/buy")).toBe(3);
    expect(new Set(requestIds(api, "POST /api/shop/buy")).size).toBe(3);
    for (const body of api.bodies("POST /api/shop/buy")) {
      expect(Object.keys(body as object).sort()).toEqual(["requestId", "themeId"]);
    }
    // A shop pack never touches the free allowance.
    expect(api.game.available).toBe(3);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(new URL(page.url()).search).toBe("");
  });

  test("insufficient_funds: the red line with the server's balance, which the header takes", async ({
    page,
    api,
  }) => {
    api.game.balance = 120;
    // The wallet was read before another device spent: the page still holds 1,240.
    api.on("GET /api/wallet", { status: 200, json: makeWallet(1_240) });
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(confirmation(page).getByRole("alert")).toHaveText(
      "This pack costs 400 Karma. You have 120 Karma.",
    );
    await expect(confirmation(page).getByRole("button", { name: "Buy for 400 Karma" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(header(page).getByText("120 Karma")).toBeVisible();
    expect(api.game.balance).toBe(120);
  });

  test("503 pool_unavailable: the red line, nothing changed; the next try is a new request", async ({
    page,
    api,
  }) => {
    api.on("POST /api/shop/buy", envelope(503, "pool_unavailable"), (call) =>
      api.game.reply(call.key, call.body)!,
    );
    await confirmBuy(page);
    const button = confirmation(page).getByRole("button", { name: "Buy for 400 Karma" });
    await button.click();
    await expect(confirmation(page).getByRole("alert")).toHaveText(
      "There are no cards to draw from right now. Nothing changed.",
    );
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await button.click();
    await expect(page.getByRole("heading", { level: 2, name: "Action pack", exact: true })).toBeFocused();
    const [first, second] = requestIds(api, "POST /api/shop/buy");
    expect(second).not.toBe(first);
  });

  test("429: the countdown from Retry-After, then the same requestId again", async ({ page, api }) => {
    api.on(
      "POST /api/shop/buy",
      { ...envelope(429, "rate_limited"), headers: { "Retry-After": "2" } },
      (call) => api.game.reply(call.key, call.body)!,
    );
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(confirmation(page).getByRole("button", { name: /^Try again in [12] s$/ })).toBeVisible();
    await expect(
      confirmation(page).getByText("That was a lot in a short time. Give it a few seconds."),
    ).toBeVisible();
    const button = confirmation(page).getByRole("button", { name: "Buy for 400 Karma" });
    await expect(button).toBeVisible({ timeout: 5_000 });
    await button.click();
    await expect(page.getByRole("heading", { level: 2, name: "Action pack", exact: true })).toBeFocused();
    const [first, second] = requestIds(api, "POST /api/shop/buy");
    expect(second).toBe(first);
  });

  test("a lost answer: Try again replays the same requestId and shows the pack bought once", async ({
    page,
    api,
  }) => {
    api.on("POST /api/shop/buy", answerLost(api), (call) => api.game.reply(call.key, call.body)!);
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(confirmation(page).getByRole("alert")).toHaveText(
      "Couldn't reach the game server, so this may not have gone through.",
    );
    await confirmation(page).getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Action pack", exact: true })).toBeFocused();
    await expect(header(page).getByText("840 Karma")).toBeVisible();
    const [first, second] = requestIds(api, "POST /api/shop/buy");
    expect(second).toBe(first);
    expect(api.game.balance).toBe(840);
    expect(api.game.purchases.size).toBe(1);
  });
});

test.describe("Recycle for Karma in the card dialog", () => {
  const spike = makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic", franchiseIds: [100] }), {
    count: 3,
  });

  async function openSpike(page: Page) {
    await page.goto("/collection");
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    await expect(
      cardDialog(page).getByRole("heading", { level: 3, name: "Recycle for Karma" }),
    ).toBeVisible();
  }

  test.beforeEach(({ api }) => {
    api.game.held = [spike];
  });

  test("duplicates become Karma: the confirmation, the receipt's line, the header, the last copy kept", async ({
    page,
    api,
  }) => {
    await openSpike(page);
    const dialog = cardDialog(page);
    await expect(dialog.getByText("Each duplicate recycles for 40 Karma.")).toBeVisible();
    const field = dialog.getByRole("textbox", { name: "Duplicates" });
    await expect(field).toHaveValue("2");
    await expect(dialog.getByText("You get 80 Karma.")).toBeVisible();
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await expect(
      dialog.getByRole("heading", { name: "Recycle 2 duplicates of Spike Spiegel?" }),
    ).toBeFocused();
    await expect(
      dialog.getByText("2 Epic copies become 80 Karma. You keep 1. There is no undo."),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Recycle for 80 Karma" }).click();

    await expect(dialog.getByRole("status")).toHaveText(
      "Recycled 2 copies of Spike Spiegel for 80 Karma. You have 1,320 Karma.",
    );
    await expect(dialog.getByRole("heading", { level: 2, name: "Spike Spiegel" })).toBeFocused();
    await expect(header(page).getByText("1,320 Karma")).toBeVisible();
    await expect(dialog.getByText("No duplicates. The last copy can't be recycled.")).toBeVisible();
    expect(api.bodies("POST /api/collection/recycle")).toEqual([
      { requestId: expect.any(String), characterId: 1, rarity: "epic", count: 2 },
    ]);
  });

  test("not_enough_copies after the collection changed: the neutral notice and the server's numbers", async ({
    page,
    api,
  }) => {
    await openSpike(page);
    api.game.held = [{ ...spike, count: 2, available: 2, recyclable: 1 }];
    const dialog = cardDialog(page);
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 80 Karma" }).click();
    await expect(
      dialog.getByText("Something changed since you opened this card. Check the numbers and try again."),
    ).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Duplicates" })).toHaveValue("1");
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
  });

  test("balance_limit: the confirmation stays with the red line and the confirm button disabled", async ({
    page,
    api,
  }) => {
    api.on("POST /api/collection/recycle", envelope(409, "balance_limit"));
    await openSpike(page);
    const dialog = cardDialog(page);
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 80 Karma" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Your balance is at its ceiling, so nothing was recycled.",
    );
    await expect(dialog.getByRole("button", { name: "Recycle for 80 Karma" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("a lost answer: Try again replays the same requestId, so the duplicates are recycled once", async ({
    page,
    api,
  }) => {
    api.on("POST /api/collection/recycle", answerLost(api), (call) => api.game.reply(call.key, call.body)!);
    await openSpike(page);
    const dialog = cardDialog(page);
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 80 Karma" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Couldn't reach the game server, so this may not have gone through.",
    );
    await dialog.getByRole("button", { name: "Try again" }).click();
    await expect(dialog.getByRole("status")).toHaveText(
      "Recycled 2 copies of Spike Spiegel for 80 Karma. You have 1,320 Karma.",
    );
    const [first, second] = requestIds(api, "POST /api/collection/recycle");
    expect(second).toBe(first);
    expect(api.game.balance).toBe(1_320);
    expect(api.game.recycles.size).toBe(1);
  });
});
