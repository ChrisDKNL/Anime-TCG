/// <reference lib="dom" />
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { Listing } from "@anime-tcg/shared/api";
import { makeCharacter, makeEntry, makeListing } from "../src/test/fixtures";
import {
  deferred,
  envelope,
  expect,
  makeAccount,
  mockCardImages,
  signedIn,
  test,
  type ApiCall,
  type FakeApi,
} from "./support/fake-api";

/**
 * Test plan: the market UI in a real browser against the scripted api (market-and-shop.md §3.4 to
 * §3.6, collection-overview.md §3.5, economy.md §12).
 *
 * - Browse: the header link, the title and focus, keyset paging through `nextCursor` with Show more,
 *   a filter and the search sent as request parameters, never as the page's address.
 * - List: from the card dialog, the price, the fee preview, the confirmation and the server's
 *   listing; the tile's `<L> listed` line; My listings; Cancel.
 * - Buy: the confirmation and the result in place; the header takes the receipt's balance.
 * - Every refusal: listing_unavailable, listing_not_found, own_listing, insufficient_funds,
 *   market_limit with its date and its disabled confirm, request_id_reused, price_out_of_bounds,
 *   429 with its countdown, 401, and a proxy 503; a lost answer whose Try again replays the key.
 * - Two browsers buying the same listing: one card, the other told it is gone.
 * - Nothing is written to storage or the address.
 */

const CHRIS = makeAccount({ cards: 3 });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const header = (page: Page) => page.getByRole("banner");
const main = (page: Page) => page.getByRole("main");
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const results = (page: Page) => main(page).locator("#market-results");
const tile = (page: Page, name: string | RegExp) =>
  main(page).getByRole("list", { name: /shown/ }).getByRole("button", { name });
const dialog = (page: Page) => page.getByRole("dialog");
const requestIds = (api: FakeApi, key: string) =>
  api.bodies(key).map((body) => (body as { requestId: string }).requestId);

/** Five listings of other players at rising prices, Rare unless told otherwise. */
function seedMarket(api: FakeApi, extra: Listing[] = []) {
  api.game.market = [
    makeListing(1, { price: 20, character: makeCharacter(2_001, { name: "Asuka Langley", tier: "rare" }) }),
    makeListing(2, { price: 30, character: makeCharacter(2_002, { name: "Bulma", tier: "rare" }) }),
    makeListing(3, {
      price: 200,
      rarity: "epic",
      fee: 10,
      character: makeCharacter(2_003, { name: "Conan Edogawa", tier: "epic" }),
    }),
    makeListing(4, { price: 50, character: makeCharacter(2_004, { name: "Dio Brando", tier: "rare" }) }),
    makeListing(5, { price: 60, character: makeCharacter(2_005, { name: "Eren Yeager", tier: "rare" }) }),
    ...extra,
  ];
}

const buyKey = (n: number) =>
  `POST /api/market/listings/7d1e6a40-0b9c-4f2d-8e3a-${String(n).padStart(12, "0")}/buy`;

/** The api handles the request, but the answer never reaches the browser. */
const answerLost = (api: FakeApi) => (call: ApiCall) => {
  api.game.reply(call.key, call.body, call.search);
  return "abort" as const;
};

/** Holds every call of `key` until the test releases the gate, then lets the game answer it. */
function held(api: FakeApi, key: string) {
  const gate = deferred();
  api.on(key, async (call) => {
    await gate.promise;
    return api.game.reply(call.key, call.body, call.search)!;
  });
  return gate;
}

async function openMarket(page: Page) {
  await page.goto("/market");
  await expect(h1(page, "Market")).toBeVisible();
  await expect(header(page).getByText("1,240 Karma")).toBeVisible();
}

async function confirmBuy(page: Page, name: string) {
  await openMarket(page);
  await tile(page, new RegExp(name)).click();
  await dialog(page).getByRole("button", { name: "Buy…" }).click();
  await expect(
    dialog(page).getByRole("heading", { level: 2, name: new RegExp(`^Buy ${name}`) }),
  ).toBeFocused();
}

/** The one storage use the app may make: TanStack Router's scroll offsets (accepted in #30). */
const SCROLL_KEY = "tsr-scroll-restoration-v1_3";

async function expectNothingStored(page: Page) {
  const stored = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(stored.local).toEqual([]);
  expect(stored.session.filter((key) => key !== SCROLL_KEY)).toEqual([]);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
}

/** A second browser on the same scripted api: another device of another player. */
async function secondContext(
  browser: Browser,
  baseURL: string | undefined,
  api: FakeApi,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL });
  await mockCardImages(context);
  await context.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) => api.handle(route),
  );
  return { context, page: await context.newPage() };
}

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedIn(CHRIS));
  seedMarket(api);
});

test.describe("browse", () => {
  test("the header link, then keyset pages through Show more, focus kept until the last page", async ({
    page,
    api,
  }) => {
    api.game.pageSize = 2;
    await page.goto("/packs");
    await nav(page).getByRole("link", { name: "Market" }).click();
    await expect(page).toHaveURL(/\/market$/);
    await expect(page).toHaveTitle("Market · Anime TCG");
    await expect(h1(page, "Market")).toBeFocused();
    await expect(results(page)).toHaveText("2 listings shown");
    await expect(tile(page, /Asuka Langley/)).toContainText("20 Karma");

    await main(page).getByRole("button", { name: "Show more" }).click();
    await expect(results(page)).toHaveText("4 listings shown");
    await expect(main(page).getByRole("button", { name: "Show more" })).toBeFocused();
    await main(page).getByRole("button", { name: "Show more" }).click();
    await expect(results(page)).toHaveText("5 listings shown");
    await expect(results(page)).toBeFocused();
    // The dev build's StrictMode mounts the page twice, which can abort and resend the first page once.
    const asked = api.calls
      .filter((call) => call.key === "GET /api/market/listings")
      .map((call) => call.search);
    expect([...new Set(asked)]).toEqual([
      "?sort=price_asc",
      "?sort=price_asc&cursor=o2",
      "?sort=price_asc&cursor=o4",
    ]);
    expect(asked.filter((search) => search.includes("cursor="))).toHaveLength(2);
    await expectNothingStored(page);
  });

  test("a filter and the search are request parameters; Clear filters keeps the sort", async ({
    page,
    api,
  }) => {
    await openMarket(page);
    await expect(results(page)).toHaveText("5 listings shown");
    await main(page).getByLabel("Sort").selectOption("price_desc");
    await expect(tile(page, /Conan/).first()).toBeVisible();
    await main(page).getByLabel("Rarity").selectOption("rare");
    await expect(results(page)).toHaveText("4 listings shown");
    await main(page).getByRole("searchbox", { name: "Search" }).fill("bul");
    await expect(results(page)).toHaveText("1 listing shown");
    const searches = api.calls
      .filter((call) => call.key === "GET /api/market/listings")
      .map((call) => call.search);
    expect(searches.at(-1)).toBe("?rarity=rare&q=bul&sort=price_desc");
    // Typing sends one request after the pause, not one per keystroke.
    expect(searches.filter((search) => search.includes("q="))).toEqual([
      "?rarity=rare&q=bul&sort=price_desc",
    ]);
    await main(page).getByRole("button", { name: "Clear filters" }).click();
    await expect(results(page)).toHaveText("5 listings shown");
    await expect(results(page)).toBeFocused();
    await expect(main(page).getByLabel("Sort")).toHaveValue("price_desc");
    await expectNothingStored(page);
  });
});

test.describe("list, then cancel", () => {
  test("List on the market from the card dialog, the listed line, My listings and Cancel", async ({
    page,
    api,
  }) => {
    api.game.held = [makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), { count: 3 })];
    await page.goto("/collection");
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await main(page)
      .getByRole("button", { name: /Spike Spiegel/ })
      .click();
    const card = dialog(page);
    const price = card.getByRole("textbox", { name: "Price" });
    await expect(price).toHaveValue("");
    await expect(card.getByText("80 to 400 Karma")).toBeVisible();
    await price.fill("120");
    await expect(card.getByText("Fee 6 Karma (5%). You get 114 Karma if it sells.")).toBeVisible();
    await card.getByRole("button", { name: "List…" }).click();
    await expect(
      card.getByRole("heading", { level: 2, name: "List Spike Spiegel for 120 Karma?" }),
    ).toBeFocused();
    await card.getByRole("button", { name: "List for 120 Karma" }).click();
    await expect(card.getByRole("status")).toHaveText(
      /^Listed for 120 Karma until 6 Nov 2026, \d\d:\d\d\. The fee is 6 Karma if it sells\.$/,
    );
    await expect(card.getByRole("heading", { level: 2, name: "Spike Spiegel" })).toBeFocused();
    await expect(card.locator("dl")).toContainText("On the market1");
    expect(api.bodies("POST /api/market/listings")).toEqual([
      { requestId: expect.any(String), characterId: 1, rarity: "epic", price: 120 },
    ]);
    await page.keyboard.press("Escape");
    await expect(main(page).getByRole("button", { name: /Spike Spiegel/ })).toContainText("1 listed");

    await nav(page).getByRole("link", { name: "Market" }).click();
    await main(page).getByRole("button", { name: "My listings" }).click();
    await expect(main(page).getByRole("heading", { level: 2, name: "On the market, 1 of 50" })).toBeVisible();
    await expect(main(page).getByText("Fee 6 Karma · you get 114 Karma")).toBeVisible();
    await main(page).getByRole("button", { name: "Cancel listing of \u2068Spike Spiegel\u2069" }).click();
    const status = main(page).getByText("Listing cancelled. Spike Spiegel is available again.");
    await expect(status).toBeFocused();
    await expect(main(page).getByText("Nothing on the market.")).toBeVisible();
    await expect(main(page).getByText("Cancelled", { exact: true })).toBeVisible();
    expect(api.game.held[0]?.listed).toBe(0);
  });

  test("price_out_of_bounds: the neutral notice and the field error, nothing listed", async ({
    page,
    api,
  }) => {
    api.game.held = [makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), { count: 3 })];
    api.on("POST /api/market/listings", envelope(400, "price_out_of_bounds"));
    await page.goto("/collection");
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await main(page)
      .getByRole("button", { name: /Spike Spiegel/ })
      .click();
    await dialog(page).getByRole("textbox", { name: "Price" }).fill("120");
    await dialog(page).getByRole("button", { name: "List…" }).click();
    await dialog(page).getByRole("button", { name: "List for 120 Karma" }).click();
    await expect(
      dialog(page).getByText(
        "Something changed since you opened this card. Check the numbers and try again.",
      ),
    ).toBeVisible();
    await expect(dialog(page).getByRole("textbox", { name: "Price" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(api.game.market.filter((listing) => listing.mine)).toEqual([]);
  });
});

test.describe("buy", () => {
  test("a purchase confirms in place with the server's card and balance; the listing leaves the list", async ({
    page,
    api,
  }) => {
    await confirmBuy(page, "Bulma");
    await expect(
      dialog(page).getByText("One Rare card. You have 1,240 Karma. There is no undo."),
    ).toBeVisible();
    await dialog(page).getByRole("button", { name: "Buy for 30 Karma" }).dblclick();
    await expect(
      dialog(page).getByRole("heading", { level: 2, name: "Bulma is in your collection" }),
    ).toBeFocused();
    await expect(dialog(page).getByText("Bought for 30 Karma. You have 1,210 Karma.")).toBeVisible();
    await expect(header(page).getByText("1,210 Karma")).toBeVisible();
    expect(api.count(buyKey(2))).toBe(1);
    expect(api.bodies(buyKey(2))).toEqual([{ requestId: expect.any(String) }]);
    await dialog(page).getByRole("button", { name: "Close" }).last().click();
    await expect(tile(page, /Bulma/)).toHaveCount(0);
    await expect(results(page)).toBeFocused();

    await main(page).getByRole("button", { name: "My listings" }).click();
    const bought = main(page).getByRole("region", { name: "Bought in the last 30 days" });
    await expect(bought.getByRole("listitem")).toContainText("Bulma");
    await expect(
      main(page).getByText(
        "You can buy 99 more cards and spend 54,970 more Karma, and receive 55,000 more Karma from sales.",
      ),
    ).toBeVisible();
  });

  test("a lost answer: Try again replays the same key, and the card is bought once", async ({
    page,
    api,
  }) => {
    api.on(buyKey(1), answerLost(api), (call) => api.game.reply(call.key, call.body, call.search)!);
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(
      dialog(page)
        .getByRole("alert")
        .filter({ hasText: "Couldn't reach the game server, so this may not have gone through." }),
    ).toBeVisible();
    await dialog(page).getByRole("button", { name: "Try again" }).click();
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
    const ids = requestIds(api, buyKey(1));
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(api.game.balance).toBe(1_220);
    expect(api.game.bought.size).toBe(1);
  });

  test("a proxy 503 is no answer too: Try again replays the key", async ({ page, api }) => {
    api.on(buyKey(1), { status: 503, raw: "<html>Service Unavailable</html>" }, (call) =>
      api.game.reply(call.key, call.body, call.search)!,
    );
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await dialog(page).getByRole("button", { name: "Try again" }).click();
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
    expect(new Set(requestIds(api, buyKey(1))).size).toBe(1);
  });

  test("two browsers buy the same listing: one card, the other told it is gone", async ({
    page,
    api,
    browser,
    baseURL,
  }) => {
    const gate = held(api, buyKey(4));
    const other = await secondContext(browser, baseURL, api);
    try {
      for (const p of [page, other.page]) {
        await confirmBuy(p, "Dio Brando");
        await dialog(p).getByRole("button", { name: "Buy for 50 Karma" }).click();
        await expect(dialog(p).getByRole("button", { name: "Buying…" })).toBeVisible();
      }
      await expect.poll(() => api.count(buyKey(4))).toBe(2);
      gate.release();
      await expect(dialog(page).getByText("Bought for 50 Karma. You have 1,190 Karma.")).toBeVisible();
      await expect(dialog(other.page).getByText("This card is no longer on the market.")).toBeFocused();
      expect(api.game.bought.size).toBe(1);
      expect(api.game.balance).toBe(1_190);
      await dialog(other.page).getByRole("button", { name: "Close" }).last().click();
      await expect(tile(other.page, /Dio Brando/)).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  });
});

test.describe("every refusal of a purchase", () => {
  test("listing_unavailable: sold meanwhile", async ({ page, api }) => {
    await confirmBuy(page, "Asuka Langley");
    api.game.market[0] = { ...api.game.market[0], status: "sold" };
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByText("This card is no longer on the market.")).toBeFocused();
  });

  test("listing_not_found: the listing's account is gone", async ({ page, api }) => {
    api.on(buyKey(1), envelope(404, "listing_not_found"));
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByText("This card is no longer on the market.")).toBeVisible();
  });

  test("insufficient_funds: the server's balance in the line and the header; confirm disabled", async ({
    page,
    api,
  }) => {
    await confirmBuy(page, "Eren Yeager");
    api.game.balance = 12;
    await dialog(page).getByRole("button", { name: "Buy for 60 Karma" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText("This card costs 60 Karma. You have 12 Karma.");
    await expect(header(page).getByText("12 Karma", { exact: true })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Buy for 60 Karma" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("market_limit: the date it frees up, and the confirm stays disabled after Cancel", async ({
    page,
    api,
  }) => {
    api.game.limit = { limit: "buyer_purchases", retryAfterSeconds: 2 * 86_400 };
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      /^Your market limit for the last 7 days is used up\. It frees up on \d{1,2} \w{3} at \d\d:\d\d\.$/,
    );
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await dialog(page).getByRole("button", { name: "Buy…" }).click();
    const confirm = dialog(page).getByRole("button", { name: "Buy for 20 Karma" });
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await confirm.click({ force: true });
    expect(api.count(buyKey(1))).toBe(1);
    // A buyer's limit holds for every listing.
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await page.keyboard.press("Escape");
    await tile(page, /Bulma/).click();
    await dialog(page).getByRole("button", { name: "Buy…" }).click();
    await expect(dialog(page).getByRole("button", { name: "Buy for 30 Karma" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  for (const [code, status] of [
    ["own_listing", 409],
    ["request_id_reused", 409],
  ] as const) {
    test(`${code}: never expected, so the server failure banner`, async ({ page, api }) => {
      api.on(buyKey(1), envelope(status, code));
      await confirmBuy(page, "Asuka Langley");
      await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
      await expect(dialog(page).getByRole("alert")).toHaveText(
        "The game server couldn't finish this. Nothing changed. Try again.",
      );
    });
  }

  test("429: the countdown on the button, the line once, then the same key", async ({ page, api }) => {
    api.on(buyKey(1), { ...envelope(429, "rate_limited"), headers: { "retry-after": "2" } }, (call) =>
      api.game.reply(call.key, call.body, call.search)!,
    );
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(
      dialog(page).getByText("That was a lot in a short time. Give it a few seconds."),
    ).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: /^Try again in \d s$/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click({ timeout: 5_000 });
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
    const ids = requestIds(api, buyKey(1));
    expect(ids[1]).toBe(ids[0]);
  });

  test("401: the session ended, to Log in with /market as the return path", async ({ page, api }) => {
    api.on(buyKey(1), envelope(401, "unauthenticated"));
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(h1(page, "Log in")).toBeVisible();
    await expect(page.getByText("You were logged out. Log in again to continue.")).toBeVisible();
    expect(await page.evaluate(() => (history.state as { returnTo?: unknown } | null)?.returnTo)).toBe(
      "/market",
    );
  });
});
