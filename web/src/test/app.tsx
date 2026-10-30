import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import App from "../App";
import { createQueryClient } from "../lib/queryClient";
import { createAppRouter } from "../router";
import { envelope, makeAccount, mockFetch, urlOf, type MockHandler } from "./api";
import {
  makeAllowance,
  makeCollection,
  makeDemo,
  makeDemoOpened,
  makeEntry,
  makeListingsPage,
  makeMarketMine,
  makePackOpened,
  makePacks,
  makeRecycleReceipt,
  makeShop,
  makeShopReceipt,
  makeWallet,
} from "./fixtures";

export const PACKS = "GET /api/packs";
export const OPEN = "POST /api/packs/open";
export const COLLECTION = "GET /api/collection";
export const WALLET = "GET /api/wallet";
export const SHOP = "GET /api/shop";
export const BUY = "POST /api/shop/buy";
export const RECYCLE = "POST /api/collection/recycle";
export const DEMO = "GET /api/demo";
/** The browse request for the default controls: the lowest price first, nothing else. */
export const LISTINGS = "GET /api/market/listings?sort=price_asc";
export const MINE = "GET /api/market/mine";
export const LIST = "POST /api/market/listings";
export const DEMO_OPEN = "POST /api/demo/open";

/**
 * The api of a signed-in account with a full allowance, an empty collection, a balance of 1,240 and one
 * theme; a purchase and a recycle answer with the fixture receipts; an empty market; the landing page's
 * demo for a signed-out visit.
 */
export function signedInRoutes(account = makeAccount()): Record<string, MockHandler> {
  return {
    "GET /api/session": { status: 200, body: { signedIn: true, account } },
    [PACKS]: { status: 200, body: makePacks() },
    [COLLECTION]: { status: 200, body: makeCollection() },
    [OPEN]: { status: 201, body: makePackOpened() },
    [WALLET]: { status: 200, body: makeWallet() },
    [SHOP]: { status: 200, body: makeShop() },
    [BUY]: { status: 201, body: makeShopReceipt() },
    [RECYCLE]: { status: 201, body: makeRecycleReceipt() },
    [DEMO]: { status: 200, body: makeDemo() },
    [LISTINGS]: { status: 200, body: makeListingsPage([]) },
    [MINE]: { status: 200, body: makeMarketMine() },
    [DEMO_OPEN]: { status: 200, body: makeDemoOpened() },
  };
}

/**
 * Boots the whole app at `path` (a memory history) with the api mocked at
 * `fetch`: signed in, a full allowance, an empty collection and an opening
 * that deals the fixture pack. Extra routes override the defaults. The
 * router is the app's own, so the guards, titles and focus rules are the
 * real ones. Any other request (AniList included) fails the test.
 */
export function renderApp(routes: Record<string, MockHandler>, account = makeAccount(), path = "/") {
  const fetchMock = mockFetch({ ...signedInRoutes(account), ...routes });
  const queryClient = createQueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ queryClient, history });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>,
  );
  return { ...result, fetchMock, queryClient, router, history };
}

export const signedOutSession: MockHandler = { status: 200, body: { signedIn: false } };

/** The single app-level live region (the one with `aria-live`). */
export function liveRegion(): HTMLElement {
  const region = screen.getAllByRole("status").find((element) => element.hasAttribute("aria-live"));
  if (region === undefined) throw new Error("no live region rendered");
  return region;
}

/** The page's `h1`, once the router has rendered it. */
export function pageHeading(name: string) {
  return screen.findByRole("heading", { level: 1, name });
}

/** The `fetch` calls made to `key` (`"GET /api/packs"`), in order. */
export function callsTo(fetchMock: ReturnType<typeof mockFetch>, key: string) {
  return fetchMock.mock.calls.filter(([input, init]) => `${init?.method ?? "GET"} ${urlOf(input)}` === key);
}

/**
 * A scripted server with state, for flows across several calls: `available`
 * packs of a cap of 3 (one every 10 minutes), and each opening deals the
 * fixture pack (under a new id) into the collection.
 */
export function gameServer({ available: start = 3 }: { available?: number } = {}) {
  const server = { available: start, opened: 0 };
  const allowance = () =>
    makeAllowance({ available: server.available, nextPackInSeconds: server.available >= 3 ? null : 600 });
  const routes: Record<string, MockHandler> = {
    [PACKS]: () => ({ status: 200, body: makePacks({ allowance: allowance() }) }),
    [OPEN]: () => {
      if (server.available === 0) return envelope(409, "no_pack_available", 600);
      server.available -= 1;
      server.opened += 1;
      const pack = makePackOpened({
        openingId: `6f9c1a52-4c1e-4b8e-9d3a-${String(server.opened).padStart(12, "0")}`,
        allowance: allowance(),
        packsUntilGuarantee: 300 - server.opened,
      });
      return { status: 201, body: pack };
    },
    [COLLECTION]: () => ({
      status: 200,
      body: makeCollection(
        server.opened === 0
          ? []
          : makePackOpened().cards.map((card) => makeEntry(card.character, { count: server.opened })),
      ),
    }),
  };
  return { server, routes };
}
