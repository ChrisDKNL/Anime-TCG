/// <reference lib="dom" />
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { Listing, PurchaseReceipt, Wallet } from "@anime-tcg/shared/api";
import {
  listingId,
  makeCharacter,
  makeEntry,
  makeListing,
  makeWallet,
  makeFranchise,
} from "../src/test/fixtures";
import { FORBIDDEN_WORDS } from "../src/test/copyWords";
import {
  deferred,
  envelope,
  expect,
  FakeApi,
  isolated,
  makeAccount,
  marketLimit,
  mockCardImages,
  noContent,
  signedIn,
  test,
  type Answer,
  type ApiCall,
} from "./support/fake-api";

/**
 * Hunt: what market.spec.ts does not cover, against the scripted api (market-and-shop.md §3.4 to
 * §3.8, collection-overview.md §3.5, economy.md §11 and §12).
 *
 * Test plan
 * - Double spend from the UI: a real double click and a held Enter (auto-repeat keydowns) on `Buy…`,
 *   `List…` and both confirm buttons send at most one request each; a buy racing the seller's cancel
 *   of the same listing from the seller's own browser, both orders: one of them wins, the other is
 *   told so, and the pages recover.
 * - requestId lifecycle: a listing's lost answer and a non-envelope 503 replay the key; Cancel,
 *   Escape-close and leaving the page each give the next purchase a fresh key; `request_id_reused`
 *   recovers with a fresh key (buy and list); a cancel's `Try again` after no answer resends it.
 * - `market_limit`: a seller's and a pair's limit block only that listing; the confirm stays disabled
 *   for `retryAfterSeconds` capped at MAX_WAIT_SECONDS (an hour), then the next press asks again; no
 *   countdown in the copy; no seconds waits 60 s; no `limit` is the server failure.
 * - Price bounds and fee: only whole numbers inside the published bounds are sent; the server's
 *   `price_out_of_bounds` shows the newly read bounds; the server's fee and balances replace anything
 *   the client could have computed.
 * - Paging against a keyset cursor (as the real api pages): Show more after a purchase and a refetch
 *   after a lost answer never duplicate or skip; changing a filter drops the cursor.
 * - Hostile names: AniList names and titles as text, isolated, in the tile, the dialog, the
 *   confirmation, the result, My listings and `See <name> on the market`; no other login anywhere;
 *   320 px with unbroken names.
 * - Copy: no forbidden word, "Karma" only after a number (or "more") or as the unit label, "free"
 *   only in "free pack(s)".
 * - No storage, no query string; the controls survive page changes and reset on log-out.
 */

const CHRIS = makeAccount({ cards: 3 });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const header = (page: Page) => page.getByRole("banner");
const main = (page: Page) => page.getByRole("main");
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const results = (page: Page) => main(page).locator("#market-results");
const grid = (page: Page) => main(page).getByRole("list", { name: /shown/ });
const tile = (page: Page, name: string | RegExp) => grid(page).getByRole("button", { name });
const dialog = (page: Page) => page.getByRole("dialog");
const requestIds = (api: FakeApi, key: string) =>
  api.bodies(key).map((body) => (body as { requestId: string }).requestId);
const LIST_KEY = "POST /api/market/listings";
const buyKey = (n: number) => `POST /api/market/listings/${listingId(n)}/buy`;
const cancelKey = (id: string) => `POST /api/market/listings/${id}/cancel`;

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

const answerLost = (api: FakeApi) => (call: ApiCall) => {
  api.game.reply(call.key, call.body, call.search);
  return "abort" as const;
};
const byGame = (api: FakeApi) => (call: ApiCall) => api.game.reply(call.key, call.body, call.search)!;

function held(api: FakeApi, key: string) {
  const gate = deferred();
  api.on(key, async (call) => {
    await gate.promise;
    return api.game.reply(call.key, call.body, call.search)!;
  });
  return gate;
}

/**
 * Browse as the real api pages it (economy.md §8.4): a keyset cursor after the last listing shown,
 * by (price, listingId), so a listing that sells or is added between pages moves no other listing
 * across a page boundary. The fake's default offset cursor would skip a listing after a sale, which
 * the real server does not; only `price_asc` and `rarity` are needed here.
 */
function keysetBrowse(api: FakeApi, pageSize: number) {
  api.on("GET /api/market/listings", (call) => {
    const query = new URLSearchParams(call.search);
    const rarity = query.get("rarity");
    const cursor = query.get("cursor");
    const active = api.game.market
      .filter((listing) => listing.status === "active" && (rarity === null || listing.rarity === rarity))
      .sort((a, b) => a.price - b.price || a.listingId.localeCompare(b.listingId));
    let rest = active;
    if (cursor !== null) {
      const [price, id] = cursor.slice(1).split("_");
      rest = active.filter(
        (listing) =>
          listing.price > Number(price) || (listing.price === Number(price) && listing.listingId > id),
      );
    }
    const page = rest.slice(0, pageSize);
    const last = page.at(-1);
    const json = {
      listings: page,
      filterFranchiseIds: cursor === null ? [100, 101, 102] : null,
      franchises: [makeFranchise(100), makeFranchise(101), makeFranchise(102)],
      nextCursor: rest.length > pageSize && last !== undefined ? `k${last.price}_${last.listingId}` : null,
    };
    return { status: 200, json };
  });
}

async function openMarket(page: Page) {
  await page.goto("/market");
  await expect(h1(page, "Market")).toBeVisible();
  await expect(header(page).getByText("1,240 Karma")).toBeVisible();
}

async function confirmBuy(page: Page, name: string, { goto = true } = {}) {
  if (goto) await openMarket(page);
  await tile(page, new RegExp(name)).click();
  await dialog(page).getByRole("button", { name: "Buy…" }).click();
  await expect(
    dialog(page).getByRole("heading", { level: 2, name: new RegExp(`^Buy ${name}`) }),
  ).toBeFocused();
}

/** Spike Spiegel, Epic ×3, in the collection; the card dialog opened on him. */
async function openSpike(page: Page, api: FakeApi, name = "Spike Spiegel") {
  api.game.held = [makeEntry(makeCharacter(1, { name, tier: "epic" }), { count: 3 })];
  await page.goto("/collection");
  await expect(header(page).getByText("1,240 Karma")).toBeVisible();
  await main(page)
    .getByRole("button", { name: new RegExp(`^${isolated(name)}`) })
    .click();
  await expect(dialog(page).getByRole("textbox", { name: "Price" })).toBeVisible();
}

async function askToList(page: Page, price: string) {
  await dialog(page).getByRole("textbox", { name: "Price" }).fill(price);
  await dialog(page).getByRole("button", { name: "List…" }).click();
  await expect(
    dialog(page).getByRole("heading", { level: 2, name: /^List .* for \d+ Karma\?$/ }),
  ).toBeFocused();
}

/**
 * Nothing in Web Storage but TanStack Router's scroll offsets (`tsr-scroll-restoration-v1_3`, accepted
 * in the #30 security review), which hold no control of the market; nothing in the address.
 */
async function expectNothingStored(page: Page) {
  const stored = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage).filter((key) => key !== "tsr-scroll-restoration-v1_3"),
    scroll: sessionStorage.getItem("tsr-scroll-restoration-v1_3") ?? "",
  }));
  expect([stored.local, stored.session]).toEqual([[], []]);
  expect(stored.scroll).not.toMatch(/bul|price_desc|rarity|characterId|market/i);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
}

async function otherBrowser(
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

// ---------------------------------------------------------------------------------------------
// Double spend from the UI
// ---------------------------------------------------------------------------------------------

test.describe("double spend from the UI", () => {
  test("a double click on Buy… opens the confirmation and sends nothing", async ({ page, api }) => {
    await openMarket(page);
    await tile(page, /Bulma/).click();
    await dialog(page).getByRole("button", { name: "Buy…" }).dblclick();
    // The second click lands wherever the confirmation put something; it is never a confirm.
    await expect(dialog(page).getByRole("heading", { level: 2, name: /^Buy Bulma/ })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Buy for 30 Karma" })).toBeVisible();
    expect(api.count(buyKey(2))).toBe(0);
  });

  test("a held Enter on Buy… then on Buy for 30 Karma buys once", async ({ page, api }) => {
    await openMarket(page);
    await tile(page, /Bulma/).click();
    await dialog(page).getByRole("button", { name: "Buy…" }).focus();
    for (let i = 0; i < 8; i++) await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await expect(dialog(page).getByRole("heading", { level: 2, name: /^Buy Bulma/ })).toBeFocused();
    expect(api.count(buyKey(2))).toBe(0);

    await dialog(page).getByRole("button", { name: "Buy for 30 Karma" }).focus();
    for (let i = 0; i < 8; i++) await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await expect(dialog(page).getByText("Bought for 30 Karma. You have 1,210 Karma.")).toBeVisible();
    expect(api.count(buyKey(2))).toBe(1);
    expect(api.game.bought.size).toBe(1);
  });

  test("a double click on List… then on List for 120 Karma lists once", async ({ page, api }) => {
    await openSpike(page, api);
    await dialog(page).getByRole("textbox", { name: "Price" }).fill("120");
    await dialog(page).getByRole("button", { name: "List…" }).dblclick();
    await expect(
      dialog(page).getByRole("heading", { level: 2, name: "List Spike Spiegel for 120 Karma?" }),
    ).toBeVisible();
    expect(api.count(LIST_KEY)).toBe(0);
    await dialog(page).getByRole("button", { name: "List for 120 Karma" }).dblclick();
    await expect(
      dialog(page)
        .getByRole("status")
        .filter({ hasText: /^Listed for 120 Karma/ }),
    ).toBeVisible();
    expect(api.count(LIST_KEY)).toBe(1);
    expect(api.game.market.filter((listing) => listing.mine)).toHaveLength(1);
  });

  test("a held Enter in the Price field, then on List for 120 Karma lists once", async ({ page, api }) => {
    await openSpike(page, api);
    await dialog(page).getByRole("textbox", { name: "Price" }).fill("120");
    await dialog(page).getByRole("textbox", { name: "Price" }).focus();
    for (let i = 0; i < 8; i++) await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await expect(
      dialog(page).getByRole("heading", { level: 2, name: "List Spike Spiegel for 120 Karma?" }),
    ).toBeFocused();
    expect(api.count(LIST_KEY)).toBe(0);
    await dialog(page).getByRole("button", { name: "List for 120 Karma" }).focus();
    for (let i = 0; i < 8; i++) await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await expect(
      dialog(page)
        .getByRole("status")
        .filter({ hasText: /^Listed for 120 Karma/ }),
    ).toBeVisible();
    expect(api.count(LIST_KEY)).toBe(1);
  });

  test.describe("a buy racing the seller's cancel of the same listing", () => {
    const DIO = listingId(4);

    /** The seller's own browser: another account whose only listing is Dio Brando's. */
    function sellerApi(api: FakeApi) {
      const seller = new FakeApi();
      seller.on(
        "GET /api/session",
        signedIn(makeAccount({ id: "9b2f0c1e-1111-4a2b-8c3d-000000000002", login: "Seller" })),
      );
      seller.game.market = [{ ...api.game.market[3], mine: true }];
      seller.game.held = [
        makeEntry(api.game.market[3].character, { rarity: "rare", listed: 1, available: 0 }),
      ];
      // One listing, two views of it: the cancel decides against the buyer's game, the one market.
      seller.on(cancelKey(DIO), () => {
        const index = api.game.market.findIndex((listing) => listing.listingId === DIO);
        const now = api.game.market[index];
        if (now.status === "sold") {
          seller.game.market[0] = { ...seller.game.market[0], status: "sold", closedAt: now.closedAt };
          return envelope(409, "listing_unavailable");
        }
        const cancelled = { ...now, status: "cancelled" as const, closedAt: "2026-10-30T12:40:00.000Z" };
        api.game.market[index] = cancelled;
        seller.game.market[0] = { ...cancelled, mine: true };
        return { status: 200, json: { ...cancelled, mine: true } };
      });
      return seller;
    }

    async function sellerOnMyListings(page: Page) {
      await page.goto("/market");
      await expect(h1(page, "Market")).toBeVisible();
      await main(page).getByRole("button", { name: "My listings" }).click();
      await expect(
        main(page).getByRole("heading", { level: 2, name: "On the market, 1 of 50" }),
      ).toBeVisible();
    }

    test("the cancel lands first: the seller's card is back, the buyer is told it is gone, nothing spent", async ({
      page,
      api,
      browser,
      baseURL,
    }) => {
      const seller = sellerApi(api);
      const gate = held(api, buyKey(4));
      const other = await otherBrowser(browser, baseURL, seller);
      try {
        await sellerOnMyListings(other.page);
        await confirmBuy(page, "Dio Brando");
        await dialog(page).getByRole("button", { name: "Buy for 50 Karma" }).click();
        await expect(dialog(page).getByRole("button", { name: "Buying…" })).toBeVisible();
        await expect.poll(() => api.count(buyKey(4))).toBe(1);

        await main(other.page)
          .getByRole("button", { name: `Cancel listing of ${isolated("Dio Brando")}` })
          .click();
        await expect(
          main(other.page).getByText("Listing cancelled. Dio Brando is available again."),
        ).toBeFocused();
        await expect(main(other.page).getByText("Nothing on the market.")).toBeVisible();

        gate.release();
        await expect(dialog(page).getByText("This card is no longer on the market.")).toBeFocused();
        expect(api.game.balance).toBe(1_240);
        expect(api.game.bought.size).toBe(0);
        await expect(header(page).getByText("1,240 Karma")).toBeVisible();
        await dialog(page).getByRole("button", { name: "Close" }).last().click();
        await expect(tile(page, /Dio Brando/)).toHaveCount(0);
        await expect(results(page)).toBeFocused();
        // The page recovers: another listing buys normally.
        await confirmBuy(page, "Bulma", { goto: false });
        await dialog(page).getByRole("button", { name: "Buy for 30 Karma" }).click();
        await expect(dialog(page).getByText("Bought for 30 Karma. You have 1,210 Karma.")).toBeVisible();
        expect(seller.unexpected).toEqual([]);
      } finally {
        await other.context.close();
      }
    });

    test("the buy lands first: the buyer has the card, the seller reads It sold before the cancel arrived", async ({
      page,
      api,
      browser,
      baseURL,
    }) => {
      const seller = sellerApi(api);
      const other = await otherBrowser(browser, baseURL, seller);
      try {
        await sellerOnMyListings(other.page);
        await confirmBuy(page, "Dio Brando");
        await dialog(page).getByRole("button", { name: "Buy for 50 Karma" }).click();
        await expect(dialog(page).getByText("Bought for 50 Karma. You have 1,190 Karma.")).toBeVisible();

        await main(other.page)
          .getByRole("button", { name: `Cancel listing of ${isolated("Dio Brando")}` })
          .click();
        await expect(main(other.page).getByText("It sold before the cancel arrived.")).toBeFocused();
        const closed = main(other.page).getByRole("region", { name: "Closed in the last 30 days" });
        await expect(closed.getByRole("listitem")).toContainText("Sold for 50 Karma · you got 48 Karma");
        await expect(main(other.page).getByText("Nothing on the market.")).toBeVisible();
        expect(api.game.bought.size).toBe(1);
        expect(seller.unexpected).toEqual([]);
      } finally {
        await other.context.close();
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// requestId lifecycle
// ---------------------------------------------------------------------------------------------

test.describe("requestId lifecycle", () => {
  test("a listing's lost answer: Try again replays the same key and lists once", async ({ page, api }) => {
    api.on(LIST_KEY, answerLost(api), byGame(api));
    await openSpike(page, api);
    await askToList(page, "120");
    await dialog(page).getByRole("button", { name: "List for 120 Karma" }).click();
    await expect(
      dialog(page)
        .getByRole("alert")
        .filter({ hasText: "Couldn't reach the game server, so this may not have gone through." }),
    ).toBeVisible();
    await dialog(page).getByRole("button", { name: "Try again" }).click();
    await expect(
      dialog(page)
        .getByRole("status")
        .filter({ hasText: /^Listed for 120 Karma/ }),
    ).toBeVisible();
    const ids = requestIds(api, LIST_KEY);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(api.game.market.filter((listing) => listing.mine)).toHaveLength(1);
    expect(api.bodies(LIST_KEY)[1]).toEqual(api.bodies(LIST_KEY)[0]);
  });

  test("a listing's non-envelope 503 is no answer: Try again replays the key", async ({ page, api }) => {
    api.on(LIST_KEY, { status: 503, raw: "<html>Bad Gateway</html>" }, byGame(api));
    await openSpike(page, api);
    await askToList(page, "120");
    await dialog(page).getByRole("button", { name: "List for 120 Karma" }).click();
    await dialog(page).getByRole("button", { name: "Try again" }).click();
    await expect(
      dialog(page)
        .getByRole("status")
        .filter({ hasText: /^Listed for 120 Karma/ }),
    ).toBeVisible();
    expect(new Set(requestIds(api, LIST_KEY)).size).toBe(1);
  });

  test("a 503 envelope is the server failure, and the next press is a fresh key", async ({ page, api }) => {
    api.on(buyKey(1), envelope(503, "internal"), byGame(api));
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
    const ids = requestIds(api, buyKey(1));
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  test("after no answer, Cancel gives the next purchase a fresh key and reads the market again", async ({
    page,
    api,
  }) => {
    api.on(buyKey(1), "abort", byGame(api));
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByRole("button", { name: "Try again" })).toBeVisible();
    const walletReads = api.count("GET /api/wallet");
    const pageReads = api.count("GET /api/market/listings");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page).getByRole("button", { name: "Buy…" })).toBeFocused();
    await expect.poll(() => api.count("GET /api/wallet")).toBeGreaterThan(walletReads);
    await expect.poll(() => api.count("GET /api/market/listings")).toBeGreaterThan(pageReads);
    await dialog(page).getByRole("button", { name: "Buy…" }).click();
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
    const ids = requestIds(api, buyKey(1));
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  test("after no answer, Escape and Close each give the next purchase a fresh key", async ({ page, api }) => {
    api.on(buyKey(1), "abort", "abort", byGame(api));
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByRole("button", { name: "Try again" })).toBeVisible();
    // Escape on the confirmation is its Cancel; a second Escape closes the dialog.
    await page.keyboard.press("Escape");
    await expect(dialog(page).getByRole("button", { name: "Buy…" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    await confirmBuy(page, "Asuka Langley", { goto: false });
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByRole("button", { name: "Try again" })).toBeVisible();
    // The top Close from the confirmation closes the dialog as Cancel does.
    await dialog(page).getByRole("button", { name: "Close" }).first().click();
    await expect(dialog(page)).toHaveCount(0);

    await confirmBuy(page, "Asuka Langley", { goto: false });
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
    const ids = requestIds(api, buyKey(1));
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  test("after no answer, leaving the page (Back) gives the next purchase a fresh key", async ({
    page,
    api,
  }) => {
    api.on(buyKey(1), "abort", byGame(api));
    await page.goto("/packs");
    await nav(page).getByRole("link", { name: "Market" }).click();
    await expect(h1(page, "Market")).toBeFocused();
    await confirmBuy(page, "Asuka Langley", { goto: false });
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByRole("button", { name: "Try again" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/packs$/);
    await expect(dialog(page)).toHaveCount(0);
    await nav(page).getByRole("link", { name: "Market" }).click();
    await confirmBuy(page, "Asuka Langley", { goto: false });
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
    const ids = requestIds(api, buyKey(1));
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  test("a 429 then Cancel: the wait survives, and the first try after it is a fresh key", async ({
    page,
    api,
  }) => {
    api.on(buyKey(1), { ...envelope(429, "rate_limited"), headers: { "retry-after": "2" } }, byGame(api));
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByRole("button", { name: /^Try again in \d s$/ })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await dialog(page).getByRole("button", { name: "Buy…" }).click();
    // The wait lives on the page, not in the confirmation.
    await expect(dialog(page).getByRole("button", { name: /^Try again in \d s$/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click({ timeout: 5_000 });
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
    const ids = requestIds(api, buyKey(1));
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  test("request_id_reused on a purchase recovers: the next press is a fresh key and buys", async ({
    page,
    api,
  }) => {
    api.on(buyKey(1), envelope(409, "request_id_reused"), byGame(api));
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
    const ids = requestIds(api, buyKey(1));
    expect(ids[1]).not.toBe(ids[0]);
  });

  test("request_id_reused on a listing: the neutral notice, the price kept, then a fresh key lists", async ({
    page,
    api,
  }) => {
    api.on(LIST_KEY, envelope(409, "request_id_reused"), byGame(api));
    await openSpike(page, api);
    await askToList(page, "120");
    await dialog(page).getByRole("button", { name: "List for 120 Karma" }).click();
    await expect(
      dialog(page).getByText(
        "Something changed since you opened this card. Check the numbers and try again.",
      ),
    ).toBeVisible();
    await expect(dialog(page).getByRole("heading", { level: 2, name: "Spike Spiegel" })).toBeFocused();
    await expect(dialog(page).getByRole("textbox", { name: "Price" })).toHaveValue("120");
    await dialog(page).getByRole("button", { name: "List…" }).click();
    await dialog(page).getByRole("button", { name: "List for 120 Karma" }).click();
    await expect(
      dialog(page)
        .getByRole("status")
        .filter({ hasText: /^Listed for 120 Karma/ }),
    ).toBeVisible();
    const ids = requestIds(api, LIST_KEY);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  test("a cancel with no answer: the row's Try again resends it, and the banner clears", async ({
    page,
    api,
  }) => {
    const spike = makeCharacter(1, { name: "Spike Spiegel", tier: "epic" });
    const mine = makeListing(9, { character: spike, rarity: "epic", price: 120, fee: 6, mine: true });
    api.game.market.push(mine);
    api.game.held = [makeEntry(spike, { count: 3, listed: 1, available: 2 })];
    api.on(cancelKey(mine.listingId), answerLost(api), byGame(api));
    await openMarket(page);
    await main(page).getByRole("button", { name: "My listings" }).click();
    await main(page)
      .getByRole("button", { name: `Cancel listing of ${isolated("Spike Spiegel")}` })
      .click();
    await expect(
      main(page)
        .getByRole("alert")
        .filter({ hasText: "Couldn't reach the game server, so this may not have gone through." }),
    ).toBeVisible();
    const retry = main(page).getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(main(page).getByText("Listing cancelled. Spike Spiegel is available again.")).toBeFocused();
    expect(api.bodies(cancelKey(mine.listingId))).toEqual([{}, {}]);
    await expect(page.getByText("Couldn't reach the game server.", { exact: false })).toHaveCount(0);
    await expect(main(page).getByText("Nothing on the market.")).toBeVisible();
  });

  test("a cancel of the player's own listing in the listing dialog: no answer, then Try again", async ({
    page,
    api,
  }) => {
    const spike = makeCharacter(1, { name: "Spike Spiegel", tier: "epic" });
    const mine = makeListing(9, { character: spike, rarity: "epic", price: 120, fee: 6, mine: true });
    api.game.market.push(mine);
    api.on(cancelKey(mine.listingId), "abort", byGame(api));
    await openMarket(page);
    await tile(page, /Spike Spiegel.*yours$/).click();
    await expect(dialog(page).getByText("This is your listing.")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel listing" }).click();
    await dialog(page).getByRole("button", { name: "Try again" }).click();
    await expect(
      dialog(page).getByText("Listing cancelled. Spike Spiegel is available again."),
    ).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: /Cancel listing|Try again/ })).toHaveCount(0);
    expect(api.count(cancelKey(mine.listingId))).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// market_limit
// ---------------------------------------------------------------------------------------------

test.describe("market_limit", () => {
  for (const [limit, line] of [
    [
      "seller_proceeds",
      /^This seller can't take more sales right now\. Try again on \d{1,2} \w{3} at \d\d:\d\d\.$/,
    ],
    [
      "pair",
      /^You've bought as much from this seller as the market allows for now\. Try again on \d{1,2} \w{3} at \d\d:\d\d\.$/,
    ],
  ] as const) {
    test(`${limit} blocks only that listing; another listing still buys`, async ({ page, api }) => {
      api.on(buyKey(1), marketLimit(limit, 2 * 86_400));
      await confirmBuy(page, "Asuka Langley");
      await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
      await expect(dialog(page).getByRole("alert")).toHaveText(line);
      // Reopening the same listing does not ask again.
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
      await confirmBuy(page, "Asuka Langley", { goto: false });
      await expect(dialog(page).getByRole("button", { name: "Buy for 20 Karma" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await expect(dialog(page).getByRole("alert")).toHaveText(line);
      expect(api.count(buyKey(1))).toBe(1);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await confirmBuy(page, "Bulma", { goto: false });
      const other = dialog(page).getByRole("button", { name: "Buy for 30 Karma" });
      await expect(other).not.toHaveAttribute("aria-disabled", "true");
      await other.click();
      await expect(dialog(page).getByText("Bought for 30 Karma. You have 1,210 Karma.")).toBeVisible();
    });
  }

  test("the confirm stays disabled for at most MAX_WAIT_SECONDS, nothing counts down, then the next press asks again", async ({
    page,
    api,
  }) => {
    await page.clock.install();
    api.game.limit = { limit: "buyer_spend", retryAfterSeconds: 2 * 86_400 };
    await confirmBuy(page, "Asuka Langley");
    await page.clock.pauseAt(Date.now() + 1_000);
    const freesAt = await page.evaluate(() => Date.now() + 2 * 86_400_000);
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    const alert = dialog(page).getByRole("alert");
    await expect(alert).toHaveText(
      /^Your market limit for the last 7 days is used up\. It frees up on .+\.$/,
    );
    // The line names the date from the full two days, not the capped hour.
    const expected = await page.evaluate((at) => {
      const date = new Date(at);
      const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
      const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
      return `${day} at ${time}`;
    }, freesAt);
    await expect(alert).toContainText(expected);
    const confirm = dialog(page).getByRole("button", { name: "Buy for 20 Karma" });
    await expect(confirm).toHaveAttribute("aria-disabled", "true");

    await page.clock.runFor(30 * 60_000);
    // No countdown: the label and the line read the same half an hour later.
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await expect(alert).toContainText(expected);
    expect(await dialog(page).innerText()).not.toMatch(/\d+ ?(s|sec|seconds|min|minutes)\b/);

    await page.clock.runFor(29 * 60_000 + 50_000);
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await page.clock.runFor(15_000);
    await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
    api.game.limit = null;
    await confirm.click();
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
    expect(api.count(buyKey(1))).toBe(2);
  });

  test("a market_limit without seconds waits 60 s", async ({ page, api }) => {
    await page.clock.install();
    api.on(
      buyKey(1),
      { status: 409, json: { error: { code: "market_limit", message: "m", limit: "buyer_purchases" } } },
      byGame(api),
    );
    await confirmBuy(page, "Asuka Langley");
    await page.clock.pauseAt(Date.now() + 1_000);
    const confirm = dialog(page).getByRole("button", { name: "Buy for 20 Karma" });
    await confirm.click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      /^Your market limit for the last 7 days is used up\./,
    );
    await page.clock.runFor(55_000);
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await page.clock.runFor(6_000);
    await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
    await confirm.click();
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
  });

  test("a market_limit without limit is the server failure, and the confirm stays usable", async ({
    page,
    api,
  }) => {
    api.on(buyKey(1), envelope(409, "market_limit", 86_400), byGame(api));
    await confirmBuy(page, "Asuka Langley");
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
    const confirm = dialog(page).getByRole("button", { name: "Buy for 20 Karma" });
    await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
    await confirm.click();
    await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// Price bounds and fee
// ---------------------------------------------------------------------------------------------

test.describe("price bounds and the fee", () => {
  test("only a whole number inside the published bounds is sent; everything else is the field error", async ({
    page,
    api,
  }) => {
    await openSpike(page, api);
    const price = dialog(page).getByRole("textbox", { name: "Price" });
    for (const text of ["79", "401", "0", "-80", "120.5", "1e2", "١٢٠", "12 0", "+120", "0x78"]) {
      await price.fill(text);
      await expect(dialog(page).getByText(/^Fee \d/)).toHaveCount(0);
      await dialog(page).getByRole("button", { name: "List…" }).click();
      await expect(dialog(page).getByText("Choose a whole number from 80 to 400.")).toBeVisible();
      await expect(price).toBeFocused();
      await expect(price).toHaveAttribute("aria-invalid", "true");
    }
    expect(api.count(LIST_KEY)).toBe(0);
    for (const [text, sent] of [
      ["80", 80],
      ["400", 400],
    ] as const) {
      await price.fill(text);
      await dialog(page).getByRole("button", { name: "List…" }).click();
      await dialog(page)
        .getByRole("button", { name: `List for ${sent} Karma` })
        .click();
      await expect(
        dialog(page)
          .getByRole("status")
          .filter({ hasText: `Listed for ${sent} Karma` }),
      ).toBeVisible();
    }
    expect(api.bodies(LIST_KEY).map((body) => (body as { price: number }).price)).toEqual([80, 400]);
  });

  test("price_out_of_bounds: the wallet is read again and the hint and the error name the new bounds", async ({
    page,
    api,
  }) => {
    let wallet: Wallet = makeWallet(1_240);
    api.on("GET /api/wallet", () => ({ status: 200, json: wallet }));
    api.on(LIST_KEY, () => {
      wallet = makeWallet(1_240, {
        priceMin: { ...wallet.rules.priceMin, epic: 150 },
        priceMax: { ...wallet.rules.priceMax, epic: 600 },
      });
      return envelope(400, "price_out_of_bounds");
    });
    await openSpike(page, api);
    await askToList(page, "120");
    await dialog(page).getByRole("button", { name: "List for 120 Karma" }).click();
    await expect(dialog(page).getByText("150 to 600 Karma")).toBeVisible();
    await expect(dialog(page).getByText("Choose a whole number from 150 to 600.")).toBeVisible();
    await expect(dialog(page).getByRole("textbox", { name: "Price" })).toHaveValue("120");
    await expect(dialog(page).getByText(/^Fee \d/)).toHaveCount(0);
  });

  test("the server's fee replaces the preview in the status line and in My listings", async ({
    page,
    api,
  }) => {
    api.on(LIST_KEY, (call) => {
      const answer = api.game.reply(call.key, call.body, call.search)!;
      const listing = { ...(answer.json as Listing), fee: 9 };
      api.game.market[api.game.market.length - 1] = listing;
      return { ...answer, json: listing };
    });
    await openSpike(page, api);
    await dialog(page).getByRole("textbox", { name: "Price" }).fill("120");
    await expect(dialog(page).getByText("Fee 6 Karma (5%). You get 114 Karma if it sells.")).toBeVisible();
    await dialog(page).getByRole("button", { name: "List…" }).click();
    await dialog(page).getByRole("button", { name: "List for 120 Karma" }).click();
    await expect(
      dialog(page)
        .getByRole("status")
        .filter({ hasText: /^Listed/ }),
    ).toHaveText(/^Listed for 120 Karma until 6 Nov 2026, \d\d:\d\d\. The fee is 9 Karma if it sells\.$/);
    await page.keyboard.press("Escape");
    await nav(page).getByRole("link", { name: "Market" }).click();
    await main(page).getByRole("button", { name: "My listings" }).click();
    await expect(main(page).getByText("Fee 9 Karma · you get 111 Karma")).toBeVisible();
    await expect(main(page).getByText(/Fee 6 Karma|114 Karma/)).toHaveCount(0);
  });

  test("a purchase shows the receipt's balance, not one the browser worked out", async ({ page, api }) => {
    api.on(buyKey(2), (call) => {
      const answer = api.game.reply(call.key, call.body, call.search)!;
      return { ...answer, json: { ...(answer.json as PurchaseReceipt), balance: 777 } };
    });
    await confirmBuy(page, "Bulma");
    await dialog(page).getByRole("button", { name: "Buy for 30 Karma" }).click();
    await expect(dialog(page).getByText("Bought for 30 Karma. You have 777 Karma.")).toBeVisible();
    await expect(header(page).getByText("777 Karma")).toBeVisible();
    await expect(page.getByText(/1,210/)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------------------------

test.describe("paging with a keyset cursor", () => {
  const shownNames = async (page: Page) =>
    (
      await grid(page)
        .getByRole("button")
        .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label") ?? ""))
    ).map((label) => label.split(",")[0].replace(/[\u2068\u2069]/g, ""));

  test("Show more after a purchase neither skips nor repeats a listing", async ({ page, api }) => {
    keysetBrowse(api, 2);
    await openMarket(page);
    await expect(results(page)).toHaveText("2 listings shown");
    await confirmBuy(page, "Bulma", { goto: false });
    await dialog(page).getByRole("button", { name: "Buy for 30 Karma" }).click();
    await expect(dialog(page).getByText(/^Bought for 30 Karma/)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Close" }).last().click();
    await main(page).getByRole("button", { name: "Show more" }).click();
    await expect(results(page)).toHaveText("3 listings shown");
    await main(page).getByRole("button", { name: "Show more" }).click();
    await expect(results(page)).toHaveText("4 listings shown");
    expect(await shownNames(page)).toEqual(["Asuka Langley", "Dio Brando", "Eren Yeager", "Conan Edogawa"]);
  });

  test("a refetch of every page after a lost answer shows each active listing once, in order", async ({
    page,
    api,
  }) => {
    keysetBrowse(api, 2);
    api.on(buyKey(1), answerLost(api));
    await openMarket(page);
    await main(page).getByRole("button", { name: "Show more" }).click();
    await expect(results(page)).toHaveText("4 listings shown");
    await main(page).getByRole("button", { name: "Show more" }).click();
    await expect(results(page)).toHaveText("5 listings shown");
    // Meanwhile on the server: Bulma sells to someone else and a new listing comes in between.
    api.game.market[1] = { ...api.game.market[1], status: "sold" };
    api.game.market.push(
      makeListing(6, { price: 55, character: makeCharacter(2_006, { name: "Frieren", tier: "rare" }) }),
    );
    await confirmBuy(page, "Asuka Langley", { goto: false });
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    await expect(dialog(page).getByRole("button", { name: "Try again" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(results(page)).toHaveText("4 listings shown");
    expect(await shownNames(page)).toEqual(["Dio Brando", "Frieren", "Eren Yeager", "Conan Edogawa"]);
  });

  test("changing a filter drops the cursor: the first page of the new filter only", async ({ page, api }) => {
    keysetBrowse(api, 2);
    await openMarket(page);
    await main(page).getByRole("button", { name: "Show more" }).click();
    await expect(results(page)).toHaveText("4 listings shown");
    const before = api.calls.length;
    await main(page).getByLabel("Rarity").selectOption("rare");
    await expect(results(page)).toHaveText("2 listings shown");
    const asked = api.calls.slice(before).filter((call) => call.key === "GET /api/market/listings");
    expect(asked.map((call) => call.search)).toEqual(["?rarity=rare&sort=price_asc"]);
    expect(await shownNames(page)).toEqual(["Asuka Langley", "Bulma"]);
    await main(page).getByRole("button", { name: "Show more" }).click();
    await expect(results(page)).toHaveText("4 listings shown");
    expect(await shownNames(page)).toEqual(["Asuka Langley", "Bulma", "Dio Brando", "Eren Yeager"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Hostile names
// ---------------------------------------------------------------------------------------------

const HOSTILE = "\u202Eevil\u202C<img src=x onerror=window.__pwned=1>";
const HOSTILE_TITLE = "\u202BTitle\u202C<script>window.__pwned=2</script>";
const OTHER_LOGIN = "MalloryTheSeller";

/** A listing page whose series title is hostile and whose listings carry undeclared login fields. */
function hostileBrowse(api: FakeApi) {
  api.on("GET /api/market/listings", (call) => {
    const answer = api.game.reply(call.key, call.body, call.search)! as Answer & {
      json: { listings: Listing[]; franchises: { id: number; title: string }[] };
    };
    return {
      ...answer,
      json: {
        ...answer.json,
        listings: answer.json.listings.map((listing) => ({
          ...listing,
          seller: OTHER_LOGIN,
          sellerLogin: OTHER_LOGIN,
        })),
        franchises: answer.json.franchises.map((franchise) => ({ ...franchise, title: HOSTILE_TITLE })),
      },
    };
  });
}

async function expectNoInjection(page: Page) {
  expect(await page.evaluate(() => (window as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.content()).not.toContain(OTHER_LOGIN);
}

test.describe("hostile names", () => {
  test("names and titles as isolated text in the tile, the dialog, the confirmation and the result", async ({
    page,
    api,
  }) => {
    api.game.market[0] = {
      ...api.game.market[0],
      character: makeCharacter(2_001, { name: HOSTILE, tier: "rare" }),
    };
    hostileBrowse(api);
    api.on(buyKey(1), (call) => {
      const answer = api.game.reply(call.key, call.body, call.search)!;
      return { ...answer, json: { ...(answer.json as object), seller: OTHER_LOGIN } };
    });
    await openMarket(page);
    const hostileTile = grid(page).getByRole("button").first();
    expect(await hostileTile.getAttribute("aria-label")).toBe(
      `${isolated(HOSTILE)}, Rare, ${isolated(HOSTILE_TITLE)}, 20 Karma`,
    );
    await hostileTile.click();
    const name = dialog(page).getByRole("heading", { level: 2 });
    await expect(name).toHaveText(HOSTILE);
    await expect(name).toHaveAttribute("dir", "auto");
    await expectNoInjection(page);
    await dialog(page).getByRole("button", { name: "Buy…" }).click();
    const heading = dialog(page).getByRole("heading", { level: 2 });
    await expect(heading.locator("bdi")).toHaveText(HOSTILE);
    await expect(heading).toHaveText(`Buy ${HOSTILE} for 20 Karma?`);
    await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
    const result = dialog(page).getByRole("heading", { level: 2 });
    await expect(result.locator("bdi")).toHaveText(HOSTILE);
    await expect(result).toHaveText(`${HOSTILE} is in your collection`);
    await expectNoInjection(page);
    await dialog(page).getByRole("button", { name: "Close" }).last().click();

    await main(page).getByRole("button", { name: "My listings" }).click();
    const bought = main(page).getByRole("region", { name: "Bought in the last 30 days" });
    await expect(bought.locator('p[dir="auto"]')).toHaveText(HOSTILE);
    await expectNoInjection(page);
  });

  test("My listings: the name isolated in the row, the Cancel listing name and the status line", async ({
    page,
    api,
  }) => {
    const character = makeCharacter(1, { name: HOSTILE, tier: "epic" });
    api.game.market.push(
      makeListing(9, { character, rarity: "epic", price: 120, fee: 6, mine: true }),
      makeListing(10, {
        character,
        rarity: "epic",
        price: 90,
        fee: 5,
        mine: true,
        status: "sold",
        closedAt: "2026-10-29T10:00:00.000Z",
      }),
    );
    api.game.held = [makeEntry(character, { count: 3, listed: 1, available: 2 })];
    await openMarket(page);
    await main(page).getByRole("button", { name: "My listings" }).click();
    const active = main(page).getByRole("region", { name: /^On the market/ });
    await expect(active.locator('p[dir="auto"]')).toHaveText(HOSTILE);
    const closed = main(page).getByRole("region", { name: "Closed in the last 30 days" });
    await expect(closed.locator('p[dir="auto"]')).toHaveText(HOSTILE);
    await main(page)
      .getByRole("button", { name: `Cancel listing of ${isolated(HOSTILE)}`, exact: true })
      .click();
    const status = main(page)
      .getByRole("status")
      .filter({ hasText: /^Listing cancelled\./ });
    await expect(status.locator("bdi")).toHaveText(HOSTILE);
    await expectNoInjection(page);
  });

  test("See <name> on the market and the character line isolate the name", async ({ page, api }) => {
    await openSpike(page, api, HOSTILE);
    const link = dialog(page).getByRole("button", { name: /on the market$/ });
    await expect(link.locator("bdi")).toHaveText(HOSTILE);
    await link.click();
    await expect(h1(page, "Market")).toBeVisible();
    const line = main(page).getByText(/^Showing .* only\./);
    await expect(line.locator("bdi")).toHaveText(HOSTILE);
    expect(api.calls.filter((call) => call.key === "GET /api/market/listings").at(-1)?.search).toBe(
      "?characterId=1&sort=price_asc",
    );
    await expectNoInjection(page);
    await expectNothingStored(page);
  });

  test.describe("at 320 px", () => {
    test.use({ viewport: { width: 320, height: 720 } });
    const LONG = `Wolfeschlegelsteinhausenbergerdorff${"x".repeat(80)}`;
    const noSideScroll = async (page: Page, where: string) =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth), where).toBeLessThanOrEqual(320);
    const dialogFits = async (page: Page, where: string) =>
      expect(
        await dialog(page).evaluate((element) => element.scrollWidth <= element.clientWidth),
        where,
      ).toBe(true);

    test("long unbroken names fit the tile, the dialog, the confirmation, the result and My listings", async ({
      page,
      api,
    }) => {
      const character = makeCharacter(2_001, { name: LONG, tier: "rare" });
      api.game.market[0] = { ...api.game.market[0], character };
      api.game.market.push(makeListing(9, { character, price: 25, fee: 2, mine: true }));
      await openMarket(page);
      await noSideScroll(page, "browse");
      await grid(page).getByRole("button").first().click();
      await dialogFits(page, "listing dialog");
      await dialog(page).getByRole("button", { name: "Buy…" }).click();
      await dialogFits(page, "confirmation");
      await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
      await expect(dialog(page).getByText(/^Bought for 20 Karma/)).toBeVisible();
      await dialogFits(page, "result");
      await dialog(page).getByRole("button", { name: "Close" }).last().click();
      await main(page).getByRole("button", { name: "My listings" }).click();
      await expect(
        main(page).getByRole("region", { name: "Bought in the last 30 days" }).getByRole("listitem"),
      ).toHaveCount(1);
      await noSideScroll(page, "My listings");
      await main(page)
        .getByRole("button", { name: `Cancel listing of ${isolated(LONG)}`, exact: true })
        .click();
      await expect(
        main(page)
          .getByRole("status")
          .filter({ hasText: /^Listing cancelled\./ }),
      ).toBeFocused();
      await noSideScroll(page, "My listings after a cancel");
    });

    /**
     * Regression (tester hunt on #60, 2026-10-31): in a `flex flex-col items-start` column the text
     * was sized to its content, and `break-words` does not lower its min-content width, so an
     * unbroken name widened the dialog to 1138 px against 286 px.
     */
    const dialogOverflow = (page: Page) =>
      dialog(page).evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));

    test("regression: the purchase result's heading wraps a long unbroken name", async ({ page, api }) => {
      api.game.market = [
        makeListing(1, { price: 20, character: makeCharacter(2_001, { name: LONG, tier: "rare" }) }),
      ];
      await page.goto("/market");
      await grid(page).getByRole("button").first().click();
      await dialog(page).getByRole("button", { name: "Buy…" }).click();
      await dialog(page).getByRole("button", { name: "Buy for 20 Karma" }).click();
      await expect(dialog(page).getByText("Bought for 20 Karma. You have 1,220 Karma.")).toBeVisible();
      const { scrollWidth, clientWidth } = await dialogOverflow(page);
      expect(scrollWidth, "the result widens the dialog").toBeLessThanOrEqual(clientWidth);
    });

    test("regression: the own listing's cancel status wraps a long unbroken name", async ({ page, api }) => {
      api.game.market = [
        makeListing(1, {
          price: 20,
          mine: true,
          character: makeCharacter(2_001, { name: LONG, tier: "rare" }),
        }),
      ];
      await page.goto("/market");
      await grid(page).getByRole("button").first().click();
      await dialog(page).getByRole("button", { name: "Cancel listing" }).click();
      await expect(
        dialog(page)
          .getByRole("status")
          .filter({ hasText: /^Listing cancelled\./ }),
      ).toBeVisible();
      const { scrollWidth, clientWidth } = await dialogOverflow(page);
      expect(scrollWidth, "the cancel status widens the dialog").toBeLessThanOrEqual(clientWidth);
    });

    test("the character line with a long name fits", async ({ page, api }) => {
      await openSpike(page, api, LONG);
      await dialogFits(page, "card dialog");
      await dialog(page)
        .getByRole("button", { name: /on the market$/ })
        .click();
      await expect(main(page).getByText(/^Showing .* only\./)).toBeVisible();
      await noSideScroll(page, "character line");
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------

/** Every visible string and accessible name on the page: text nodes, aria-labels, the title. */
async function pageStrings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const strings: string[] = [document.title];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest("script, style") !== null) continue;
      const text = (node.textContent ?? "").trim();
      if (text !== "") strings.push(text);
    }
    document.querySelectorAll("[aria-label]").forEach((element) => {
      strings.push(element.getAttribute("aria-label") ?? "");
    });
    return strings;
  });
}

function copyProblems(strings: readonly string[]): string[] {
  const problems: string[] = [];
  for (const text of strings) {
    for (const word of FORBIDDEN_WORDS) if (word.test(text)) problems.push(`${word}: ${text}`);
    if (/\bfree\b(?!\s+packs?\b)/i.test(text)) problems.push(`free: ${text}`);
    // The unit label after the Price field; the recycle section's heading (collection-overview.md §8,
    // shipped with #51, not this PR's copy) is the one other spelled-out use.
    if (text === "Karma" || text === "Recycle for Karma") continue;
    for (const match of text.matchAll(/Karma/g)) {
      const before = text.slice(0, match.index);
      // "<n> more Karma" is the limits line as market-and-shop.md §8 words it.
      if (!/\d( more)? $/.test(before)) problems.push(`Karma not after a number: ${text}`);
    }
  }
  return problems;
}

test.describe("copy", () => {
  test("every market screen: no money, scarcity or urgency word; Karma after a number or as the unit", async ({
    page,
    api,
  }) => {
    const seen: string[] = [];
    const take = async () => seen.push(...(await pageStrings(page)));
    const spike = makeCharacter(1, { name: "Spike Spiegel", tier: "epic" });
    api.game.market.push(
      makeListing(9, { character: spike, rarity: "epic", price: 120, fee: 6, mine: true }),
      makeListing(10, {
        character: spike,
        rarity: "epic",
        price: 90,
        fee: 5,
        mine: true,
        status: "sold",
        closedAt: "2026-10-29T10:00:00.000Z",
      }),
      makeListing(11, {
        character: spike,
        rarity: "epic",
        price: 90,
        fee: 5,
        mine: true,
        status: "expired",
        closedAt: "2026-10-28T10:00:00.000Z",
      }),
    );
    // The buyer's own limit last: it holds for every listing after it.
    api.on(buyKey(5), marketLimit("seller_proceeds", 3_600));
    api.on(buyKey(3), marketLimit("pair", 3_600));
    api.on(buyKey(4), marketLimit("buyer_purchases", 3_600));
    api.on(
      buyKey(2),
      { status: 409, json: { error: { code: "insufficient_funds", message: "m", balance: 12 } } },
      byGame(api),
    );

    await openMarket(page);
    await take();
    for (const [name, price] of [
      ["Eren Yeager", 60],
      ["Conan Edogawa", 200],
    ] as const) {
      await confirmBuy(page, name, { goto: false });
      await dialog(page)
        .getByRole("button", { name: `Buy for ${price} Karma` })
        .click();
      await expect(dialog(page).getByRole("alert")).toBeVisible();
      await take();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
    }
    await confirmBuy(page, "Bulma", { goto: false });
    await take();
    await dialog(page).getByRole("button", { name: "Buy for 30 Karma" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText("This card costs 30 Karma. You have 12 Karma.");
    await take();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // The too-little reason on the details.
    await tile(page, /Asuka Langley/).click();
    await expect(dialog(page).getByText("Costs 20 Karma. You have 12.")).toBeVisible();
    await take();
    await page.keyboard.press("Escape");
    // My listings reads the wallet again; then the buyer's own limit, which holds for every listing.
    api.game.balance = 1_240;
    await main(page).getByRole("button", { name: "My listings" }).click();
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await main(page).getByRole("button", { name: "Browse" }).click();
    await confirmBuy(page, "Dio Brando", { goto: false });
    await dialog(page).getByRole("button", { name: "Buy for 50 Karma" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(/^Your market limit/);
    await take();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await main(page).getByRole("searchbox", { name: "Search" }).fill("zzz");
    await expect(main(page).getByText('No listings match "zzz".')).toBeVisible();
    await take();
    await main(page).getByRole("button", { name: "Clear filters" }).last().click();
    await main(page).getByRole("button", { name: "My listings" }).click();
    await expect(main(page).getByText("Sold for 90 Karma · you got 85 Karma")).toBeVisible();
    await take();

    await openSpike(page, api);
    await dialog(page).getByRole("textbox", { name: "Price" }).fill("120");
    await take();
    await dialog(page).getByRole("button", { name: "List…" }).click();
    await take();
    await dialog(page).getByRole("button", { name: "List for 120 Karma" }).click();
    await expect(
      dialog(page)
        .getByRole("status")
        .filter({ hasText: /^Listed/ }),
    ).toBeVisible();
    await take();

    expect(copyProblems(seen)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// No storage, no query string; the controls' lifetime
// ---------------------------------------------------------------------------------------------

test.describe("the controls' lifetime", () => {
  test("the controls survive page changes, never reach the address or storage, and reset on log-out", async ({
    page,
    api,
  }) => {
    api.on("POST /api/session/logout", noContent);
    api.on("POST /api/session/login", signedIn(CHRIS));
    await page.goto("/packs");
    await nav(page).getByRole("link", { name: "Market" }).click();
    await expect(results(page)).toHaveText("5 listings shown");
    await main(page).getByLabel("Sort").selectOption("price_desc");
    await main(page).getByLabel("Rarity").selectOption("rare");
    await main(page).getByRole("searchbox", { name: "Search" }).fill("bul");
    await expect(results(page)).toHaveText("1 listing shown");
    await expectNothingStored(page);

    await nav(page).getByRole("link", { name: "Collection", exact: false }).click();
    await expect(h1(page, "Collection")).toBeVisible();
    await nav(page).getByRole("link", { name: "Market" }).click();
    await expect(main(page).getByLabel("Sort")).toHaveValue("price_desc");
    await expect(main(page).getByLabel("Rarity")).toHaveValue("rare");
    await expect(main(page).getByRole("searchbox", { name: "Search" })).toHaveValue("bul");
    await expect(results(page)).toHaveText("1 listing shown");
    await expectNothingStored(page);

    await page
      .getByRole("button", { name: `Account menu. Signed in as ${isolated("Chris")}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expectNothingStored(page);
    await nav(page).getByRole("link", { name: "Log in" }).click();
    await page.getByRole("textbox", { name: "Login", exact: true }).fill("Chris");
    await page.getByLabel("Password", { exact: true }).fill("correct horse");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(nav(page).getByRole("link", { name: "Market" })).toBeVisible();
    await nav(page).getByRole("link", { name: "Market" }).click();
    await expect(results(page)).toHaveText("5 listings shown");
    await expect(main(page).getByLabel("Sort")).toHaveValue("price_asc");
    await expect(main(page).getByLabel("Rarity")).toHaveValue("");
    await expect(main(page).getByRole("searchbox", { name: "Search" })).toHaveValue("");
    await expect(main(page).getByRole("button", { name: "Browse" })).toHaveAttribute("aria-pressed", "true");
    await expectNothingStored(page);
  });

  test("the view (My listings) survives a page change and resets on reload", async ({ page }) => {
    await page.goto("/packs");
    await nav(page).getByRole("link", { name: "Market" }).click();
    await main(page).getByRole("button", { name: "My listings" }).click();
    await expect(main(page).getByText("Nothing on the market.")).toBeVisible();
    await nav(page).getByRole("link", { name: "Packs" }).click();
    await nav(page).getByRole("link", { name: "Market" }).click();
    await expect(main(page).getByText("Nothing on the market.")).toBeVisible();
    await page.reload();
    await expect(results(page)).toHaveText("5 listings shown");
    await expectNothingStored(page);
  });
});
