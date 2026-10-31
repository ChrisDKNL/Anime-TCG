import { afterEach, describe, expect, it, vi } from "vitest";
import { envelope, makeAccount, mockFetch, noContent, rateLimited, sentBody } from "../test/api";
import {
  listingId,
  makeCollection,
  makeListing,
  makeListingsPage,
  makeMarketMine,
  makePurchaseReceipt,
  makeDemo,
  makeDemoOpened,
  makePackOpened,
  makePacks,
  makeRecycleReceipt,
  makeShop,
  makeShopReceipt,
  makeWallet,
} from "../test/fixtures";
import {
  ApiError,
  buyListing,
  buyShopPack,
  cancelListing,
  getListings,
  getMarketMine,
  listCard,
  changePassword,
  checkInvite,
  deleteAccount,
  getCollection,
  getDemo,
  getPacks,
  getSession,
  getShop,
  getWallet,
  isApiError,
  login,
  logout,
  NetworkError,
  openDemoPack,
  openPack,
  register,
  readRetryAfter,
  recycleDuplicates,
  renameLogin,
} from "./api";

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("GET /api/session returns the session with same-origin credentials", async () => {
    const fetchMock = mockFetch({ "GET /api/session": { status: 200, body: { signedIn: false } } });
    await expect(getSession()).resolves.toEqual({ signedIn: false });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/session");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.body).toBeUndefined();
  });

  it("checkInvite posts the code and resolves on 204", async () => {
    const fetchMock = mockFetch({ "POST /api/accounts/check-invite": noContent });
    await expect(checkInvite({ inviteCode: "local-dev-invite" })).resolves.toBeUndefined();
    expect(sentBody(fetchMock)).toEqual({ inviteCode: "local-dev-invite" });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("content-type")).toBe("application/json");
  });

  it("register returns the signed-in body of a 201", async () => {
    const account = makeAccount();
    const fetchMock = mockFetch({
      "POST /api/accounts/register": { status: 201, body: { signedIn: true, account } },
    });
    await expect(register({ inviteCode: "c", login: "Chris", password: "longenough" })).resolves.toEqual({
      signedIn: true,
      account,
    });
    expect(sentBody(fetchMock)).toEqual({ inviteCode: "c", login: "Chris", password: "longenough" });
  });

  it("login returns the signed-in body", async () => {
    const account = makeAccount();
    mockFetch({ "POST /api/session/login": { status: 200, body: { signedIn: true, account } } });
    await expect(login({ login: "chris", password: "pw" })).resolves.toEqual({ signedIn: true, account });
  });

  it("logout sends no body at all", async () => {
    const fetchMock = mockFetch({ "POST /api/session/logout": noContent });
    await expect(logout()).resolves.toBeUndefined();
    const init = fetchMock.mock.calls[0]![1];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
  });

  it("renameLogin PATCHes and returns the account", async () => {
    const account = makeAccount({ login: "Chris2" });
    const fetchMock = mockFetch({ "PATCH /api/account/login": { status: 200, body: { account } } });
    await expect(renameLogin({ login: "Chris2" })).resolves.toEqual({ account });
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("PATCH");
  });

  it("changePassword and deleteAccount resolve on 204", async () => {
    mockFetch({
      "POST /api/account/change-password": noContent,
      "POST /api/account/delete": noContent,
    });
    await expect(
      changePassword({ currentPassword: "a", newPassword: "longenough" }),
    ).resolves.toBeUndefined();
    await expect(deleteAccount({ password: "a" })).resolves.toBeUndefined();
  });

  it("maps an error envelope to ApiError with status and code", async () => {
    mockFetch({ "POST /api/session/login": envelope(401, "bad_credentials") });
    const err = await login({ login: "x", password: "y" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: "bad_credentials", retryAfterSeconds: undefined });
    expect(isApiError(err, "bad_credentials")).toBe(true);
    expect(isApiError(err, "unauthenticated")).toBe(false);
  });

  it("passes retryAfterSeconds through on too_many_failures", async () => {
    mockFetch({ "POST /api/account/delete": envelope(429, "too_many_failures", 7) });
    const err = await deleteAccount({ password: "x" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, code: "too_many_failures", retryAfterSeconds: 7 });
  });

  it("takes a rate_limited answer's seconds from Retry-After", async () => {
    mockFetch({ "POST /api/session/login": rateLimited("42") });
    const err = await login({ login: "x", password: "y" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", retryAfterSeconds: 42 });
  });

  it("a rate_limited answer without Retry-After carries no seconds", async () => {
    mockFetch({ "POST /api/session/login": rateLimited() });
    const err = await login({ login: "x", password: "y" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", retryAfterSeconds: undefined });
  });

  it("reads Retry-After only as whole positive seconds", async () => {
    for (const header of ["0", "-5", "1.5", "soon", "Fri, 30 Oct 2026 12:00:00 GMT", ""]) {
      mockFetch({ "POST /api/account/change-password": rateLimited(header) });
      const err = await changePassword({ currentPassword: "a", newPassword: "b" }).catch((e: unknown) => e);
      expect(err, header).toMatchObject({ code: "rate_limited", retryAfterSeconds: undefined });
    }
    mockFetch({ "POST /api/account/change-password": rateLimited(" 7 ") });
    const err = await changePassword({ currentPassword: "a", newPassword: "b" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ retryAfterSeconds: 7 });
  });

  it("reads a Retry-After too large to count exactly as no seconds, and passes a large exact one on", async () => {
    mockFetch({ "POST /api/session/login": rateLimited("9".repeat(400)) });
    const huge = await login({ login: "x", password: "y" }).catch((e: unknown) => e);
    expect(huge).toMatchObject({ code: "rate_limited", retryAfterSeconds: undefined });

    mockFetch({ "POST /api/session/login": rateLimited("86400") });
    const day = await login({ login: "x", password: "y" }).catch((e: unknown) => e);
    expect(day).toMatchObject({ code: "rate_limited", retryAfterSeconds: 86400 });
  });

  it("an envelope whose seconds do not count exactly is not the envelope", async () => {
    mockFetch({ "POST /api/session/login": envelope(429, "too_many_failures", 1e300) });
    await expect(login({ login: "x", password: "y" })).rejects.toBeInstanceOf(NetworkError);
  });

  it("the envelope's own seconds win over the header", async () => {
    mockFetch({
      "POST /api/account/delete": {
        ...envelope(429, "too_many_failures", 7),
        headers: { "retry-after": "30" },
      },
    });
    const err = await deleteAccount({ password: "x" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "too_many_failures", retryAfterSeconds: 7 });
  });

  it("a non-JSON failure answer is a NetworkError, not an ApiError", async () => {
    mockFetch({ "GET /api/session": { status: 502, raw: "<html>Bad Gateway</html>" } });
    await expect(getSession()).rejects.toBeInstanceOf(NetworkError);
  });

  it("JSON that is not the envelope is a NetworkError", async () => {
    mockFetch({ "GET /api/session": { status: 500, body: { message: "boom" } } });
    await expect(getSession()).rejects.toBeInstanceOf(NetworkError);
    mockFetch({ "GET /api/session": { status: 500, body: { error: { code: "made_up", message: "x" } } } });
    await expect(getSession()).rejects.toBeInstanceOf(NetworkError);
  });

  it("a rejected fetch is a NetworkError carrying the cause", async () => {
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(cause)),
    );
    const err = await getSession().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).cause).toBe(cause);
  });

  it("a success answer without JSON is a NetworkError", async () => {
    mockFetch({ "GET /api/session": { status: 200, raw: "" } });
    await expect(getSession()).rejects.toBeInstanceOf(NetworkError);
  });

  it("GET /api/packs and GET /api/collection send no body and return the answer", async () => {
    const fetchMock = mockFetch({
      "GET /api/packs": { status: 200, body: makePacks() },
      "GET /api/collection": { status: 200, body: makeCollection() },
    });
    await expect(getPacks()).resolves.toEqual(makePacks());
    await expect(getCollection()).resolves.toEqual(makeCollection());
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBe("same-origin");
    }
  });

  it("POST /api/packs/open sends the requestId and nothing else; a replay's 200 is the same answer", async () => {
    const fetchMock = mockFetch({ "POST /api/packs/open": { status: 200, body: makePackOpened() } });
    const requestId = "0b8f3c1e-6a3d-4c55-9a47-2f0d8a6b1c11";
    await expect(openPack({ requestId })).resolves.toEqual(makePackOpened());
    expect(sentBody(fetchMock)).toEqual({ requestId });
  });

  it("GET /api/demo returns the facts; POST /api/demo/open sends no body at all and returns the cards", async () => {
    const fetchMock = mockFetch({
      "GET /api/demo": { status: 200, body: makeDemo() },
      "POST /api/demo/open": { status: 200, body: makeDemoOpened() },
    });
    await expect(getDemo()).resolves.toEqual(makeDemo());
    await expect(openDemoPack()).resolves.toEqual(makeDemoOpened());
    const open = fetchMock.mock.calls[1]?.[1];
    expect(open?.method).toBe("POST");
    expect(open?.body).toBeUndefined();
    expect(new Headers(open?.headers).get("content-type")).toBeNull();
    expect(open?.credentials).toBe("same-origin");
  });

  it("a demo opening's 503 and 429 are api answers the landing page maps", async () => {
    mockFetch({ "POST /api/demo/open": envelope(503, "pool_unavailable") });
    await expect(openDemoPack()).rejects.toMatchObject({ status: 503, code: "pool_unavailable" });
    mockFetch({
      "POST /api/demo/open": { ...envelope(429, "rate_limited"), headers: { "Retry-After": "12" } },
    });
    await expect(openDemoPack()).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 12 });
  });

  it("no_pack_available carries the seconds to the next pack", async () => {
    mockFetch({ "POST /api/packs/open": envelope(409, "no_pack_available", 420) });
    const err = await openPack({ requestId: "x" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, code: "no_pack_available", retryAfterSeconds: 420 });
  });

  it("rate_limited takes its wait from Retry-After, which is all a 429 carries (packs-page.md §9)", async () => {
    mockFetch({
      "POST /api/packs/open": { ...envelope(429, "rate_limited"), headers: { "Retry-After": "3" } },
    });
    const err = await openPack({ requestId: "x" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", retryAfterSeconds: 3 });

    mockFetch({ "POST /api/packs/open": envelope(429, "rate_limited") });
    const without = await openPack({ requestId: "x" }).catch((e: unknown) => e);
    expect(without).toMatchObject({ code: "rate_limited", retryAfterSeconds: undefined });
  });

  it("the envelope's own number wins over the header", async () => {
    mockFetch({
      "POST /api/packs/open": { ...envelope(409, "no_pack_available", 420), headers: { "Retry-After": "9" } },
    });
    const err = await openPack({ requestId: "x" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ retryAfterSeconds: 420 });
  });

  it("reads Retry-After as whole seconds, at least 1, and ignores anything else", () => {
    const read = (value: string) => readRetryAfter(new Headers({ "Retry-After": value }));
    expect(read("3")).toBe(3);
    expect(read(" 60 ")).toBe(60);
    expect(read("0")).toBeUndefined();
    expect(read("9".repeat(400))).toBeUndefined();
    expect(read("1.5")).toBeUndefined();
    expect(read("-2")).toBeUndefined();
    expect(read("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(read("")).toBeUndefined();
    expect(readRetryAfter(new Headers())).toBeUndefined();
  });

  it("GET /api/wallet and GET /api/shop send no body and return the answer", async () => {
    const fetchMock = mockFetch({
      "GET /api/wallet": { status: 200, body: makeWallet() },
      "GET /api/shop": { status: 200, body: makeShop() },
    });
    await expect(getWallet()).resolves.toEqual(makeWallet());
    await expect(getShop()).resolves.toEqual(makeShop());
    for (const [, init] of fetchMock.mock.calls) expect(init?.body).toBeUndefined();
  });

  it("POST /api/shop/buy and POST /api/collection/recycle send exactly the body given; a replay is the same answer", async () => {
    const fetchMock = mockFetch({
      "POST /api/shop/buy": { status: 200, body: makeShopReceipt() },
      "POST /api/collection/recycle": { status: 201, body: makeRecycleReceipt() },
    });
    const requestId = "0b8f3c1e-6a3d-4c55-9a47-2f0d8a6b1c11";
    await expect(buyShopPack({ requestId, themeId: "genre-action" })).resolves.toEqual(makeShopReceipt());
    expect(sentBody(fetchMock, 0)).toEqual({ requestId, themeId: "genre-action" });
    await expect(recycleDuplicates({ requestId, characterId: 1, rarity: "epic", count: 2 })).resolves.toEqual(
      makeRecycleReceipt(),
    );
    expect(sentBody(fetchMock, 1)).toEqual({ requestId, characterId: 1, rarity: "epic", count: 2 });
  });

  it("insufficient_funds carries the balance the server read; other envelopes carry none", async () => {
    mockFetch({
      "POST /api/shop/buy": {
        status: 409,
        body: { error: { code: "insufficient_funds", message: "insufficient_funds", balance: 120 } },
      },
    });
    const err = await buyShopPack({ requestId: "x", themeId: "genre-action" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "insufficient_funds", balance: 120 });

    mockFetch({ "POST /api/shop/buy": envelope(404, "theme_unavailable") });
    const gone = await buyShopPack({ requestId: "x", themeId: "genre-action" }).catch((e: unknown) => e);
    expect(gone).toMatchObject({ code: "theme_unavailable", balance: undefined });
  });

  it.each(["-1", "1.5", "1e400", '"120"', "null"])(
    "an envelope whose balance does not count exactly (%s) is not the envelope",
    async (balance) => {
      mockFetch({
        "POST /api/shop/buy": {
          status: 409,
          raw: `{"error":{"code":"insufficient_funds","message":"m","balance":${balance}}}`,
        },
      });
      const err = await buyShopPack({ requestId: "x", themeId: "genre-action" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetworkError);
    },
  );

  it("GET /api/market/listings names only the parameters set, in a fixed order, encoded", async () => {
    const page = makeListingsPage([makeListing(1)]);
    const fetchMock = mockFetch({
      "GET /api/market/listings": { status: 200, body: page },
      "GET /api/market/listings?rarity=epic&franchiseId=100&characterId=7&q=%E9%80%B2%E6%92%83+%26+co&sort=newest&cursor=abc_-1":
        { status: 200, body: page },
    });
    await expect(getListings({})).resolves.toEqual(page);
    await getListings({
      cursor: "abc_-1",
      sort: "newest",
      q: "進撃 & co",
      characterId: "7",
      franchiseId: "100",
      rarity: "epic",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toHaveLength(2);
    for (const [, init] of fetchMock.mock.calls) expect(init?.body).toBeUndefined();
  });

  it("an aborted browse request is the caller's own abort, not a lost answer", async () => {
    const controller = new AbortController();
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        controller.abort();
        return Promise.reject(abort);
      }),
    );
    const err = await getListings({}, controller.signal).catch((e: unknown) => e);
    expect(err).toBe(abort);
    expect(err).not.toBeInstanceOf(NetworkError);
  });

  it("a browse request that fails without an abort is a NetworkError", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    await expect(getListings({}, controller.signal)).rejects.toBeInstanceOf(NetworkError);
  });

  it("GET /api/market/mine returns the answer", async () => {
    mockFetch({ "GET /api/market/mine": { status: 200, body: makeMarketMine() } });
    await expect(getMarketMine()).resolves.toEqual(makeMarketMine());
  });

  it("list, buy and cancel send exactly their bodies: the asking price, the key alone, nothing", async () => {
    const id = listingId(1);
    const fetchMock = mockFetch({
      "POST /api/market/listings": { status: 201, body: makeListing(1, { mine: true }) },
      [`POST /api/market/listings/${id}/buy`]: { status: 201, body: makePurchaseReceipt() },
      [`POST /api/market/listings/${id}/cancel`]: {
        status: 200,
        body: makeListing(1, { status: "cancelled" }),
      },
    });
    const requestId = "0b8f3c1e-6a3d-4c55-9a47-2f0d8a6b1c11";
    await listCard({ requestId, characterId: 2001, rarity: "rare", price: 40 });
    expect(sentBody(fetchMock, 0)).toEqual({ requestId, characterId: 2001, rarity: "rare", price: 40 });
    await expect(buyListing(id, requestId)).resolves.toEqual(makePurchaseReceipt());
    expect(sentBody(fetchMock, 1)).toEqual({ requestId });
    await expect(cancelListing(id)).resolves.toMatchObject({ status: "cancelled" });
    expect(sentBody(fetchMock, 2)).toEqual({});
  });

  it("a listing id is one encoded path segment, so no id can reach another route", async () => {
    const fetchMock = mockFetch({
      "POST /api/market/listings/..%2Fx%3Fy/cancel": { status: 200, body: makeListing(1) },
    });
    await cancelListing("../x?y");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["0", "-1", "1.5", '"60"', "null", "1e400"])(
    "market_limit with seconds %s is still market_limit, the seconds missing",
    async (seconds) => {
      const id = listingId(1);
      mockFetch({
        [`POST /api/market/listings/${id}/buy`]: {
          status: 409,
          raw: `{"error":{"code":"market_limit","message":"m","limit":"pair","retryAfterSeconds":${seconds}}}`,
        },
      });
      const err = await buyListing(id, "k").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ code: "market_limit", limit: "pair", retryAfterSeconds: undefined });
    },
  );

  it("any other code with seconds that do not count is still not the envelope", async () => {
    mockFetch({
      "POST /api/packs/open": {
        status: 409,
        raw: '{"error":{"code":"no_pack_available","message":"m","retryAfterSeconds":0}}',
      },
    });
    await expect(openPack({ requestId: "k" })).rejects.toBeInstanceOf(NetworkError);
  });

  it("market_limit carries which limit it hit and its seconds; an unknown limit is not the envelope", async () => {
    const id = listingId(1);
    mockFetch({
      [`POST /api/market/listings/${id}/buy`]: {
        status: 409,
        body: { error: { code: "market_limit", message: "m", limit: "pair", retryAfterSeconds: 86_400 } },
        headers: { "retry-after": "86400" },
      },
    });
    const err = await buyListing(id, "k").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "market_limit", limit: "pair", retryAfterSeconds: 86_400 });

    mockFetch({
      [`POST /api/market/listings/${id}/buy`]: {
        status: 409,
        raw: '{"error":{"code":"market_limit","message":"m","limit":"everyone"}}',
      },
    });
    await expect(buyListing(id, "k")).rejects.toBeInstanceOf(NetworkError);
  });
});
