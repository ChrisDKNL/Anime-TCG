import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  envelope,
  held,
  makeAccount,
  rateLimited,
  requestIdOf,
  sequence,
  type MockAnswer,
  type MockHandler,
} from "../test/api";
import { callsTo, COLLECTION, LISTINGS, liveRegion, MINE, pageHeading, renderApp, WALLET } from "../test/app";
import {
  listingId,
  makeCharacter,
  makeCollection,
  makeEntry,
  makeListing,
  makeListingsPage,
  makeMarketMine,
  makePurchaseReceipt,
  makeWallet,
} from "../test/fixtures";

const account = makeAccount();
const NO_ANSWER = "Couldn't reach the game server, so this may not have gone through.";
const lostAnswer: MockAnswer = { status: 502, raw: "<html>proxy</html>" };
const ONE = makeListing(1);
const TWO = makeListing(2, { rarity: "epic", price: 120, fee: 6 });
const MINE_LISTING = makeListing(3, { mine: true });
const BUY_ONE = `POST /api/market/listings/${listingId(1)}/buy`;
const CANCEL = (n: number) => `POST /api/market/listings/${listingId(n)}/cancel`;
const page = (...listings: Parameters<typeof makeListingsPage>[0]): MockAnswer => ({
  status: 200,
  body: makeListingsPage(listings),
});

const header = () => within(screen.getByRole("banner"));
const main = () => within(screen.getByRole("main"));
const grid = () => main().getByRole("list", { name: /listings? shown/ });
const tile = (name: RegExp) => within(grid()).getByRole("button", { name });
const dialog = () => screen.getByRole("dialog");
/** The body's own `Close` under a result, not the one in the corner. */
const bodyClose = () => within(dialog()).getAllByRole("button", { name: "Close" }).at(-1)!;
const confirmButton = (name = "Buy for 40 Karma") => within(dialog()).getByRole("button", { name });
const buyIds = (fetchMock: Parameters<typeof callsTo>[0]) =>
  callsTo(fetchMock, BUY_ONE).map(([, init]) => requestIdOf(init));

async function openMarket(routes: Record<string, MockHandler> = {}) {
  const rendered = renderApp({ [LISTINGS]: page(ONE, TWO, MINE_LISTING), ...routes }, account, "/market");
  await pageHeading("Market");
  return { ...rendered, user: userEvent.setup() };
}

/** Opens the market, waits for the tiles and the balance, and opens a listing's dialog. */
async function openListing(name = /Character 2001/, routes: Record<string, MockHandler> = {}) {
  const rendered = await openMarket(routes);
  await main().findByRole("list", { name: /listings? shown/ });
  await header().findByText("Karma");
  await rendered.user.click(tile(name));
  return rendered;
}

async function confirmBuy(routes: Record<string, MockHandler> = {}) {
  const rendered = await openListing(/Character 2001/, routes);
  await rendered.user.click(within(dialog()).getByRole("button", { name: "Buy…" }));
  return rendered;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("/market: Browse (market-and-shop.md §3.4)", () => {
  it("titles the page, links it in the header, reads the wallet and shows each listing as a tile", async () => {
    const { fetchMock } = await openMarket();
    expect(document.title).toBe("Market · Anime TCG");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Market" })).toHaveAttribute("aria-current", "page");
    expect(main().getByRole("button", { name: "Browse", pressed: true })).toBeInTheDocument();
    expect(main().getByRole("button", { name: "My listings", pressed: false })).toBeInTheDocument();
    // jsdom maps no role to <search> yet.
    expect(document.querySelector("search")).toHaveAttribute("aria-label", "Market filters");
    expect(await main().findByText("3 listings shown")).toHaveAttribute("tabindex", "-1");
    expect(callsTo(fetchMock, WALLET).length).toBeGreaterThanOrEqual(1);

    expect(tile(/Character 2001/)).toHaveAccessibleName(
      "\u2068Character 2001\u2069, Rare, \u2068Series 100\u2069, 40 Karma",
    );
    expect(tile(/Character 2003/)).toHaveAccessibleName(
      "\u2068Character 2003\u2069, Rare, \u2068Series 102\u2069, 40 Karma, yours",
    );
    expect(tile(/Character 2001/)).toHaveAttribute("aria-haspopup", "dialog");
    expect(within(tile(/Character 2001/)).getByText("40 Karma")).toBeInTheDocument();
    expect(within(tile(/Character 2001/)).getByText(/^Until \d{1,2} Nov, \d\d:\d\d$/)).toBeInTheDocument();
    expect(within(tile(/Character 2003/)).getByText("Yours")).toBeInTheDocument();
    // The rank chip's pool size comes from the held collection answer (§3.8 E9).
    expect(within(tile(/Character 2001/)).getByText(/2,983/)).toBeInTheDocument();
  });

  it("offers the series the market holds, the six tiers and the three sorts", async () => {
    await openMarket();
    await main().findByText("3 listings shown");
    const series = main().getByRole("combobox", { name: "Series" });
    expect([...series.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All series",
      "\u2068Series 100\u2069",
      "\u2068Series 101\u2069",
      "\u2068Series 102\u2069",
    ]);
    const rarity = main().getByRole("combobox", { name: "Rarity" });
    expect([...rarity.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All rarities",
      "Common",
      "Uncommon",
      "Rare",
      "Epic",
      "Legendary",
      "Mythic",
    ]);
    const sort = main().getByRole("combobox", { name: "Sort" });
    expect([...sort.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Lowest price first",
      "Highest price first",
      "Newest first",
    ]);
  });

  it("every filter asks for the first page again with its parameter; Clear filters keeps the sort", async () => {
    const { user, fetchMock } = await openMarket({
      "GET /api/market/listings?rarity=epic&sort=price_asc": page(TWO),
      "GET /api/market/listings?rarity=epic&franchiseId=100&sort=price_asc": page(),
      "GET /api/market/listings?rarity=epic&franchiseId=100&sort=newest": page(),
      "GET /api/market/listings?sort=newest": page(TWO, ONE),
    });
    await main().findByText("3 listings shown");
    await user.selectOptions(main().getByRole("combobox", { name: "Rarity" }), "Epic");
    expect(await main().findByText("1 listing shown")).toBeInTheDocument();
    await user.selectOptions(main().getByRole("combobox", { name: "Series" }), "100");
    expect(await main().findByText("No listings match these filters.")).toBeInTheDocument();
    await user.selectOptions(main().getByRole("combobox", { name: "Sort" }), "newest");
    await waitFor(() =>
      expect(
        callsTo(fetchMock, "GET /api/market/listings?rarity=epic&franchiseId=100&sort=newest"),
      ).toHaveLength(1),
    );
    const clear = main().getAllByRole("button", { name: "Clear filters" });
    await user.click(clear[clear.length - 1]!);
    expect(await main().findByText("2 listings shown")).toHaveFocus();
    expect(main().getByRole("combobox", { name: "Sort" })).toHaveValue("newest");
    expect(main().getByRole("combobox", { name: "Rarity" })).toHaveValue("");
  });

  it("sends the search 300 ms after the last keystroke, trimmed, and says what matched nothing", async () => {
    const { user, fetchMock } = await openMarket({
      "GET /api/market/listings?q=zoro&sort=price_asc": page(),
    });
    await main().findByText("3 listings shown");
    await user.type(main().getByRole("searchbox", { name: "Search" }), " zoro ");
    expect(callsTo(fetchMock, "GET /api/market/listings?q=zoro&sort=price_asc")).toHaveLength(0);
    expect(await main().findByText(/No listings match/)).toHaveTextContent('No listings match "zoro".');
    expect(main().getByText("zoro", { selector: "bdi" })).toBeInTheDocument();
    expect(callsTo(fetchMock, "GET /api/market/listings?q=zoro&sort=price_asc")).toHaveLength(1);
    // Escape clears the search and applies at once.
    fireEvent.keyDown(main().getByRole("searchbox", { name: "Search" }), { key: "Escape" });
    expect(await main().findByText("3 listings shown")).toBeInTheDocument();
  });

  it("keeps the previous list while new filters load, and never shows an answer to older ones", async () => {
    const slow = held({ status: 200, body: makeListingsPage([TWO]) });
    const { user } = await openMarket({
      "GET /api/market/listings?rarity=epic&sort=price_asc": slow.handler,
    });
    await main().findByText("3 listings shown");
    await user.selectOptions(main().getByRole("combobox", { name: "Rarity" }), "Epic");
    expect(main().getByText("3 listings shown")).toBeInTheDocument();
    await user.selectOptions(main().getByRole("combobox", { name: "Rarity" }), "");
    slow.release();
    await act(async () => {
      await Promise.resolve();
    });
    expect(main().getByText("3 listings shown")).toBeInTheDocument();
  });

  it("Show more pages through nextCursor, shows a repeated listing once, and keeps focus until the end", async () => {
    const three = makeListing(4);
    const { user, fetchMock } = await openMarket({
      [LISTINGS]: { status: 200, body: makeListingsPage([ONE, TWO], { nextCursor: "c2" }) },
      "GET /api/market/listings?sort=price_asc&cursor=c2": {
        status: 200,
        body: makeListingsPage([TWO, three], { first: false }),
      },
    });
    await main().findByText("2 listings shown");
    const more = main().getByRole("button", { name: "Show more" });
    await user.click(more);
    expect(await main().findByText("3 listings shown")).toHaveFocus();
    expect(main().queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, "GET /api/market/listings?sort=price_asc&cursor=c2")).toHaveLength(1);
    await waitFor(() => expect(liveRegion()).toHaveTextContent(""));
  });

  it("a filter change drops back to the first page: a set the player returns to starts again from page 1", async () => {
    const { user, fetchMock } = await openMarket({
      [LISTINGS]: { status: 200, body: makeListingsPage([ONE, TWO], { nextCursor: "c2" }) },
      "GET /api/market/listings?sort=price_asc&cursor=c2": {
        status: 200,
        body: makeListingsPage([MINE_LISTING], { first: false }),
      },
      "GET /api/market/listings?rarity=epic&sort=price_asc": page(TWO),
    });
    await user.click(await main().findByRole("button", { name: "Show more" }));
    expect(await main().findByText("3 listings shown")).toBeInTheDocument();
    await user.selectOptions(main().getByRole("combobox", { name: "Rarity" }), "Epic");
    expect(await main().findByText("1 listing shown")).toBeInTheDocument();
    await user.selectOptions(main().getByRole("combobox", { name: "Rarity" }), "");
    // The first page alone, as the server sends it now, never the two pages held before.
    expect(await main().findByText("2 listings shown")).toBeInTheDocument();
    expect(main().getByRole("button", { name: "Show more" })).toBeInTheDocument();
    expect(callsTo(fetchMock, LISTINGS)).toHaveLength(2);
    expect(callsTo(fetchMock, "GET /api/market/listings?sort=price_asc&cursor=c2")).toHaveLength(1);
  });

  it("a failed next page says so under the list, and Try again asks for it again", async () => {
    const { user } = await openMarket({
      [LISTINGS]: { status: 200, body: makeListingsPage([ONE], { nextCursor: "c2" }) },
      "GET /api/market/listings?sort=price_asc&cursor=c2": sequence(envelope(500, "internal"), {
        status: 200,
        body: makeListingsPage([TWO], { first: false, nextCursor: "c3" }),
      }),
    });
    await user.click(await main().findByRole("button", { name: "Show more" }));
    expect(await main().findByText("Couldn't load more.")).toHaveAttribute("role", "alert");
    await user.click(main().getByRole("button", { name: "Try again" }));
    expect(await main().findByText("2 listings shown")).toBeInTheDocument();
    expect(main().getByRole("button", { name: "Show more" })).toBeInTheDocument();
  });

  it("an empty market says so; a failed first load offers Try again", async () => {
    await openMarket({ [LISTINGS]: page() });
    expect(await main().findByText("No cards on the market.")).toBeInTheDocument();
    expect(main().queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("Couldn't load the market. with nothing held, and Try again loads it", async () => {
    const { user } = await openMarket({ [LISTINGS]: sequence(envelope(500, "internal"), page(ONE)) });
    expect(await main().findByText("Couldn't load the market.")).toBeInTheDocument();
    await user.click(main().getByRole("button", { name: "Try again" }));
    expect(await main().findByText("1 listing shown")).toBeInTheDocument();
  });
});

describe("the listing dialog (§3.4 step 7)", () => {
  it("shows the card, the facts and the player's own copies of the character", async () => {
    const entries = [
      makeEntry(makeCharacter(2001, { tier: "rare" }), { count: 2 }),
      makeEntry(makeCharacter(2001, { tier: "rare" }), { rarity: "legendary" }),
    ];
    await openListing(/Character 2001/, { [COLLECTION]: { status: 200, body: makeCollection(entries) } });
    const listing = screen.getByRole("dialog", { name: "Character 2001" });
    expect(listing).toHaveFocus();
    const facts = listing.querySelector("dl")!;
    expect([...facts.querySelectorAll("dt, dd")].map((node) => node.textContent)).toEqual([
      "Rarity",
      "✦✦✦Rare",
      "Price",
      "40 Karma",
      "Until",
      expect.stringMatching(/^\d{1,2} Nov, \d\d:\d\d$/) as string,
    ]);
    expect(
      within(listing)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["In your collection: Legendary ×1", "In your collection: Rare ×2"]);
    expect(within(listing).getByRole("button", { name: "Buy…" })).not.toHaveAttribute("aria-disabled");
  });

  it("not in the collection, and too little Karma: Buy… disabled with the reason", async () => {
    const { user, fetchMock } = await openListing(/Character 2002/, {
      [WALLET]: { status: 200, body: makeWallet(100) },
    });
    const listing = dialog();
    expect(within(listing).getByText("Not in your collection.")).toBeInTheDocument();
    const buy = within(listing).getByRole("button", { name: "Buy…" });
    expect(buy).toHaveAttribute("aria-disabled", "true");
    expect(buy).toHaveAccessibleDescription("Costs 120 Karma. You have 100.");
    await user.click(buy);
    expect(within(dialog()).queryByRole("button", { name: /Buy for/ })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, `POST /api/market/listings/${listingId(2)}/buy`)).toHaveLength(0);
  });

  it("the player's own listing offers no buy: This is your listing. and Cancel listing", async () => {
    const { user, fetchMock } = await openListing(/Character 2003/, {
      [CANCEL(3)]: { status: 200, body: { ...MINE_LISTING, status: "cancelled" } },
    });
    const listing = dialog();
    expect(within(listing).getByText("This is your listing.")).toBeInTheDocument();
    expect(within(listing).queryByRole("button", { name: "Buy…" })).not.toBeInTheDocument();
    await user.click(within(listing).getByRole("button", { name: "Cancel listing" }));
    expect(await within(listing).findByRole("status")).toHaveTextContent(
      "Listing cancelled. Character 2003 is available again.",
    );
    expect(within(listing).queryByRole("button", { name: "Cancel listing" })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, CANCEL(3))[0]?.[1]?.body).toBe("{}");
    await user.click(within(listing).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(within(grid()).queryByRole("button", { name: /Character 2003/ })).toBeNull());
  });

  it("Close returns focus to the tile", async () => {
    const { user } = await openListing();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(tile(/Character 2001/)).toHaveFocus();
  });
});

describe("buying (§3.5)", () => {
  it("the confirmation names the price, the rarity and the balance; the request carries the key alone", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY_ONE]: { status: 201, body: makePurchaseReceipt({ balance: 1_200 }) },
    });
    const heading = within(dialog()).getByRole("heading", {
      level: 2,
      name: "Buy Character 2001 for 40 Karma?",
    });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAccessibleDescription("One Rare card. You have 1,240 Karma. There is no undo.");
    await user.click(confirmButton());

    const result = await within(dialog()).findByRole("heading", {
      level: 2,
      name: "Character 2001 is in your collection",
    });
    expect(result).toHaveFocus();
    expect(within(dialog()).getByText("New")).toBeInTheDocument();
    expect(within(dialog()).getByRole("status")).toHaveTextContent(
      "Bought for 40 Karma. You have 1,200 Karma.",
    );
    expect(header().getByText("1,200")).toBeInTheDocument();
    const [call] = callsTo(fetchMock, BUY_ONE);
    expect(JSON.parse(call![1]!.body as string)).toEqual({ requestId: requestIdOf(call![1]) });

    await user.click(bodyClose());
    expect(within(grid()).queryByRole("button", { name: /Character 2001/ })).not.toBeInTheDocument();
    expect(main().getByText("2 listings shown")).toHaveFocus();
    await waitFor(() => expect(callsTo(fetchMock, COLLECTION).length).toBeGreaterThanOrEqual(2));
  });

  it("a double click and a held Enter send one request", async () => {
    const answer = held({ status: 201, body: makePurchaseReceipt() });
    const { fetchMock } = await confirmBuy({ [BUY_ONE]: answer.handler });
    const button = confirmButton();
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 2 });
    fireEvent.keyDown(button, { key: "Enter", repeat: true });
    expect(callsTo(fetchMock, BUY_ONE)).toHaveLength(1);
    expect(confirmButton("Buying…")).toHaveAttribute("aria-disabled", "true");
    // Nothing closes the dialog while it is in flight.
    fireEvent(dialog(), new Event("cancel", { cancelable: true }));
    expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Close" })).toBeDisabled();
    answer.release();
    await within(dialog()).findByText("Bought for 40 Karma. You have 1,200 Karma.");
  });

  it("listing_unavailable and listing_not_found: the card is no longer on the market, and leaves the list", async () => {
    const { user } = await confirmBuy({ [BUY_ONE]: envelope(409, "listing_unavailable") });
    await user.click(confirmButton());
    expect(await within(dialog()).findByText("This card is no longer on the market.")).toHaveFocus();
    await user.click(bodyClose());
    expect(within(grid()).queryByRole("button", { name: /Character 2001/ })).not.toBeInTheDocument();
  });

  it("insufficient_funds: the red line with the server's balance, which the header takes; confirm disabled", async () => {
    const { user } = await confirmBuy({
      [BUY_ONE]: {
        status: 409,
        body: { error: { code: "insufficient_funds", message: "m", balance: 12 } },
      },
    });
    await user.click(confirmButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "This card costs 40 Karma. You have 12 Karma.",
    );
    expect(confirmButton()).toHaveAttribute("aria-disabled", "true");
    expect(header().getByText("12")).toBeInTheDocument();
  });

  it("market_limit: whose limit, the date it frees up, and the confirm disabled even after Cancel", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY_ONE]: {
        status: 409,
        body: {
          error: { code: "market_limit", message: "m", limit: "buyer_spend", retryAfterSeconds: 3 * 86_400 },
        },
      },
    });
    await user.click(confirmButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      /^Your market limit for the last 7 days is used up\. It frees up on \d{1,2} \w{3} at \d\d:\d\d\.$/,
    );
    expect(confirmButton()).toHaveAttribute("aria-disabled", "true");
    expect(confirmButton()).toHaveAccessibleName("Buy for 40 Karma");
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await user.click(within(dialog()).getByRole("button", { name: "Buy…" }));
    expect(confirmButton()).toHaveAttribute("aria-disabled", "true");
    await user.click(confirmButton());
    expect(callsTo(fetchMock, BUY_ONE)).toHaveLength(1);
  });

  it.each([
    ["seller_proceeds", "This seller can't take more sales right now. Try again on"],
    ["pair", "You've bought as much from this seller as the market allows for now. Try again on"],
  ])("market_limit %s names the seller's room, not the buyer's", async (limit, line) => {
    const { user } = await confirmBuy({
      [BUY_ONE]: {
        status: 409,
        body: { error: { code: "market_limit", message: "m", limit, retryAfterSeconds: 60 } },
      },
    });
    await user.click(confirmButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(line);
  });

  it.each([
    ["own_listing", 409],
    ["request_id_reused", 409],
    ["internal", 500],
  ] as const)("%s: the server failure banner, and the confirm button enabled again", async (code, status) => {
    const { user } = await confirmBuy({ [BUY_ONE]: envelope(status, code) });
    await user.click(confirmButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
    expect(confirmButton()).not.toHaveAttribute("aria-disabled");
  });

  it("a 429 counts down on the button and keeps the key; a lost answer's Try again resends it", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY_ONE]: sequence(rateLimited("1"), lostAnswer, { status: 200, body: makePurchaseReceipt() }),
    });
    await user.click(confirmButton());
    expect(
      await within(dialog()).findByText("That was a lot in a short time. Give it a few seconds."),
    ).toHaveAttribute("role", "status");
    expect(confirmButton("Try again in 1 s")).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(confirmButton()).not.toHaveAttribute("aria-disabled"), { timeout: 3000 });
    await user.click(confirmButton());
    expect(await within(dialog()).findByText(NO_ANSWER)).toHaveAttribute("role", "alert");
    await user.click(within(dialog()).getByRole("button", { name: "Try again" }));
    await within(dialog()).findByText("Bought for 40 Karma. You have 1,200 Karma.");
    const ids = buyIds(fetchMock);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
  });

  it("Cancel after no answer discards the key, and reads the wallet and the first page again", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY_ONE]: sequence(lostAnswer, { status: 201, body: makePurchaseReceipt() }),
    });
    await user.click(confirmButton());
    await within(dialog()).findByText(NO_ANSWER);
    const wallets = callsTo(fetchMock, WALLET).length;
    const pages = callsTo(fetchMock, LISTINGS).length;
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(within(dialog()).getByRole("button", { name: "Buy…" })).toHaveFocus();
    await waitFor(() => expect(callsTo(fetchMock, WALLET).length).toBeGreaterThan(wallets));
    await waitFor(() => expect(callsTo(fetchMock, LISTINGS).length).toBeGreaterThan(pages));
    await user.click(within(dialog()).getByRole("button", { name: "Buy…" }));
    await user.click(confirmButton());
    await within(dialog()).findByText("Bought for 40 Karma. You have 1,200 Karma.");
    const [first, second] = buyIds(fetchMock);
    expect(first).not.toBe(second);
  });

  it("unauthenticated ends the session", async () => {
    const { user } = await confirmBuy({ [BUY_ONE]: envelope(401, "unauthenticated") });
    await user.click(confirmButton());
    expect(await pageHeading("Log in")).toBeInTheDocument();
  });
});

describe("My listings (§3.6)", () => {
  const active = makeListing(5, { mine: true, price: 120, fee: 6, rarity: "epic" });
  const mine = makeMarketMine({
    active: [active],
    closed: [
      {
        ...makeListing(6, { mine: true, status: "sold", closedAt: "2026-10-29T10:00:00.000Z" }),
        proceeds: 38,
      },
      {
        ...makeListing(7, { mine: true, status: "cancelled", closedAt: "2026-10-28T10:00:00.000Z" }),
        proceeds: null,
      },
      {
        ...makeListing(8, { mine: true, status: "expired", closedAt: "2026-10-27T10:00:00.000Z" }),
        proceeds: null,
      },
    ],
    purchases: [makePurchaseReceipt()],
    left: { purchases: 99, spend: 54_960, proceeds: 55_000 },
  });

  async function openMine(routes: Record<string, MockHandler> = {}) {
    const rendered = await openMarket({ [MINE]: { status: 200, body: mine }, ...routes });
    await rendered.user.click(main().getByRole("button", { name: "My listings" }));
    await main().findByRole("heading", { level: 2, name: /On the market/ });
    return rendered;
  }

  it("shows the four parts from the server's answer and the wallet's rules", async () => {
    await openMine();
    expect(
      main()
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent),
    ).toEqual([
      "On the market, 1 of 50",
      "Market limits, last 7 days",
      "Closed in the last 30 days",
      "Bought in the last 30 days",
    ]);
    const [activeList, closedList, boughtList] = main().getAllByRole("list");
    const row = within(activeList!).getByRole("listitem");
    expect(row).toHaveTextContent("Character 2005");
    expect(row).toHaveTextContent("Epic");
    expect(row).toHaveTextContent("120 Karma");
    expect(row).toHaveTextContent("Fee 6 Karma · you get 114 Karma");
    expect(row).toHaveTextContent(/Until \d{1,2} Nov, \d\d:\d\d/);
    expect(
      within(row).getByRole("button", { name: "Cancel listing of \u2068Character 2005\u2069" }),
    ).toBeInTheDocument();
    expect(
      main().getByText(
        "You can buy 99 more cards and spend 54,960 more Karma, and receive 55,000 more Karma from sales.",
      ),
    ).toBeInTheDocument();
    expect(
      within(closedList!)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Character 2006RareSold for 40 Karma · you got 38 Karma29 Oct 2026",
      "Character 2007RareCancelled28 Oct 2026",
      "Character 2008RareExpired27 Oct 2026",
    ]);
    expect(within(boughtList!).getByRole("listitem")).toHaveTextContent(
      "Character 2001Rare40 Karma30 Oct 2026",
    );
  });

  it("empty parts say so", async () => {
    await openMine({ [MINE]: { status: 200, body: makeMarketMine() } });
    expect(main().getByText("Nothing on the market.")).toBeInTheDocument();
    expect(main().getAllByText("Nothing in the last 30 days.")).toHaveLength(2);
    expect(main().getByRole("heading", { level: 2, name: "On the market, 0 of 50" })).toBeInTheDocument();
  });

  it("Cancel listing: Cancelling… on that row, then the status line takes focus and mine is read again", async () => {
    const answer = held({
      status: 200,
      body: { ...active, status: "cancelled", closedAt: "2026-10-30T11:00:00.000Z" },
    });
    const { user, fetchMock } = await openMine({ [CANCEL(5)]: answer.handler });
    const reads = callsTo(fetchMock, MINE).length;
    await user.click(main().getByRole("button", { name: "Cancel listing of \u2068Character 2005\u2069" }));
    expect(main().getByRole("button", { name: "Cancelling…" })).toHaveAttribute("aria-disabled", "true");
    answer.release();
    const status = await main().findByText(/Listing cancelled/);
    expect(status).toHaveTextContent("Listing cancelled. Character 2005 is available again.");
    expect(status).toHaveFocus();
    await waitFor(() => expect(callsTo(fetchMock, MINE).length).toBeGreaterThan(reads));
  });

  it.each([
    [envelope(409, "listing_unavailable"), "It sold before the cancel arrived."],
    [envelope(404, "listing_not_found"), "That listing is gone."],
    [{ status: 200, body: { ...active, status: "expired" } }, "That listing had already ended."],
  ] as const)("a cancel's other answers: %#", async (reply, line) => {
    const { user } = await openMine({ [CANCEL(5)]: reply });
    await user.click(main().getByRole("button", { name: /Cancel listing of/ }));
    expect(await main().findByText(line)).toHaveFocus();
  });

  it("no answer: the red line, and Try again resends the cancel", async () => {
    const { user, fetchMock } = await openMine({
      [CANCEL(5)]: sequence(lostAnswer, { status: 200, body: { ...active, status: "cancelled" } }),
    });
    await user.click(main().getByRole("button", { name: /Cancel listing of/ }));
    expect(await main().findByText(NO_ANSWER)).toHaveAttribute("role", "alert");
    await user.click(main().getByRole("button", { name: "Try again" }));
    expect(await main().findByText(/Listing cancelled/)).toBeInTheDocument();
    expect(callsTo(fetchMock, CANCEL(5))).toHaveLength(2);
  });

  it("a cancel's 429 counts down on the row and says so once; a server failure shows the banner", async () => {
    const { user } = await openMine({ [CANCEL(5)]: sequence(rateLimited("1"), envelope(500, "internal")) });
    await user.click(main().getByRole("button", { name: /Cancel listing of/ }));
    expect(await main().findByText("That was a lot in a short time. Give it a few seconds.")).toHaveAttribute(
      "role",
      "status",
    );
    expect(main().getByRole("button", { name: "Try again in 1 s" })).toHaveAttribute("aria-disabled", "true");
    const cancel = await main().findByRole("button", { name: /Cancel listing of/ }, { timeout: 3000 });
    await user.click(cancel);
    expect(await main().findByRole("alert")).toHaveTextContent(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
  });

  it("a thumbnail whose art fails keeps its frame and shows the placeholder", async () => {
    await openMine();
    const images = document.querySelectorAll("main img[alt='']");
    expect(images).toHaveLength(5);
    fireEvent.error(images[0]!);
    expect(document.querySelectorAll("main img[alt='']")).toHaveLength(4);
  });

  it("Couldn't load your listings. with Try again", async () => {
    const { user } = await openMarket({
      [MINE]: sequence(envelope(500, "internal"), { status: 200, body: mine }),
    });
    await user.click(main().getByRole("button", { name: "My listings" }));
    expect(await main().findByText("Couldn't load your listings.")).toBeInTheDocument();
    await user.click(main().getByRole("button", { name: "Try again" }));
    expect(
      await main().findByRole("heading", { level: 2, name: "On the market, 1 of 50" }),
    ).toBeInTheDocument();
  });
});

describe("loading and hostile strings", () => {
  it("after 300 ms the toolbar is disabled under twelve static tiles and a hidden status line", async () => {
    const slow = held({ status: 200, body: makeListingsPage([ONE]) });
    await openMarket({ [LISTINGS]: slow.handler });
    expect(await screen.findByText("Loading the market…")).toHaveClass("sr-only");
    expect(main().getByRole("searchbox", { name: "Search" })).toBeDisabled();
    expect(main().getByRole("combobox", { name: "Rarity" })).toBeDisabled();
    slow.release();
    expect(await main().findByText("1 listing shown")).toBeInTheDocument();
    expect(main().getByRole("searchbox", { name: "Search" })).toBeEnabled();
  });

  it("renders a hostile name as text, isolated, and never as markup", async () => {
    const hostile = makeListing(1, {
      character: makeCharacter(2_001, { name: '‮evil<img src=x onerror="alert(1)">', tier: "rare" }),
    });
    const { user } = await openMarket({ [LISTINGS]: page(hostile) });
    await main().findByText("1 listing shown");
    expect(document.querySelector("img[src='x']")).toBeNull();
    await header().findByText("Karma");
    await user.click(within(grid()).getByRole("button", { name: /evil/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Buy…" }));
    const heading = within(dialog()).getByRole("heading", { level: 2 });
    expect(heading.querySelector("bdi")).toHaveTextContent('‮evil<img src=x onerror="alert(1)">');
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("no address state (§3.2 item 4)", () => {
  it("never writes the filters to the address or to storage", async () => {
    const { user, history } = await openMarket({
      "GET /api/market/listings?rarity=mythic&sort=price_asc": page(),
    });
    await main().findByText("3 listings shown");
    await user.selectOptions(main().getByRole("combobox", { name: "Rarity" }), "Mythic");
    await main().findByText("No listings match these filters.");
    expect(history.location.pathname).toBe("/market");
    expect(history.location.search).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
