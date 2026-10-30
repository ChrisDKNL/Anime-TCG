import { describe, expect, it } from "vitest";
import {
  FRANCHISES,
  makeCharacter,
  makeEntry,
  makeFranchise,
  makeListing,
  makeListingsPage,
  makeRules,
} from "../test/fixtures";
import { MAX_WAIT_SECONDS, RATE_LIMITED_FALLBACK_SECONDS } from "./failures";
import {
  blocksEveryListing,
  DEFAULT_MARKET,
  feePreview,
  filtersActive,
  franchisesOf,
  heldEntries,
  lastCopy,
  limitBlock,
  listingsQuery,
  listRange,
  marketReducer,
  parsePrice,
  searchText,
  seriesOptions,
  shownListings,
  withoutListing,
  type MarketControls,
} from "./market";

const SPIKE = { id: 7, name: "Spike Spiegel" };
const BEBOP = makeFranchise(100, { title: "Cowboy Bebop" });

describe("the market's controls (market-and-shop.md §3.4 step 3)", () => {
  it("starts on Browse, lowest price first, with nothing filtered", () => {
    expect(DEFAULT_MARKET).toEqual({
      view: "browse",
      query: "",
      sent: "",
      rarity: null,
      series: null,
      sort: "price_asc",
      character: null,
    });
    expect(filtersActive(DEFAULT_MARKET)).toBe(false);
  });

  it("holds the typed search until it settles, then sends it cleaned", () => {
    const typed = marketReducer(DEFAULT_MARKET, { type: "query", query: "  Spike\tSpiegel " });
    expect(typed).toMatchObject({ query: "  Spike\tSpiegel ", sent: "" });
    expect(filtersActive(typed)).toBe(true);
    const sent = marketReducer(typed, { type: "send" });
    expect(sent.sent).toBe("Spike Spiegel");
    // Nothing new to send: the same state, so nothing re-renders or refetches.
    expect(marketReducer(sent, { type: "send" })).toBe(sent);
  });

  it("changes one filter at a time and never touches the sort on Clear filters", () => {
    let state: MarketControls = marketReducer(DEFAULT_MARKET, { type: "sort", sort: "newest" });
    state = marketReducer(state, { type: "rarity", rarity: "mythic" });
    state = marketReducer(state, { type: "series", series: BEBOP });
    state = marketReducer(state, { type: "query", query: "spike" });
    state = marketReducer(state, { type: "send" });
    expect(state).toMatchObject({ rarity: "mythic", series: BEBOP, sent: "spike", sort: "newest" });
    const cleared = marketReducer(state, { type: "clearFilters" });
    expect(cleared).toEqual({ ...DEFAULT_MARKET, sort: "newest" });
    expect(filtersActive(cleared)).toBe(false);
  });

  it("See <name> on the market: Browse, that character only, the other filters gone; Show all clears it", () => {
    const filtered = marketReducer(
      { ...DEFAULT_MARKET, view: "mine", rarity: "rare", query: "x", sent: "x", sort: "price_desc" },
      { type: "showCharacter", character: SPIKE },
    );
    expect(filtered).toEqual({ ...DEFAULT_MARKET, sort: "price_desc", character: SPIKE });
    expect(filtersActive(filtered)).toBe(true);
    expect(marketReducer(filtered, { type: "clearCharacter" }).character).toBeNull();
    expect(marketReducer(filtered, { type: "view", view: "mine" }).view).toBe("mine");
  });
});

describe("searchText (§3.4 step 3, ListingsQuery.q)", () => {
  it("trims, and turns control characters into spaces, which the server folds anyway", () => {
    expect(searchText("  Spike ")).toBe("Spike");
    expect(searchText("a\u0000b\u001fc\u007fd\u009fe")).toBe("a b c d e");
    expect(searchText("\t\n")).toBe("");
  });

  it("keeps at most 100 characters, counted as code points", () => {
    expect([...searchText("進".repeat(150))]).toHaveLength(100);
    expect([...searchText("😀".repeat(101))]).toHaveLength(100);
  });
});

describe("listingsQuery: the request's parameters, never the page's address", () => {
  it("sends the sort and only the filters that are set, ids as digit strings", () => {
    expect(listingsQuery(DEFAULT_MARKET)).toEqual({ sort: "price_asc" });
    expect(
      listingsQuery({
        ...DEFAULT_MARKET,
        sent: "spike",
        rarity: "epic",
        series: BEBOP,
        character: SPIKE,
        sort: "newest",
      }),
    ).toEqual({ sort: "newest", rarity: "epic", franchiseId: "100", characterId: "7", q: "spike" });
  });

  it("carries the sent search, not the text still being typed", () => {
    expect(listingsQuery({ ...DEFAULT_MARKET, query: "spi" })).toEqual({ sort: "price_asc" });
  });
});

describe("the browse pages (§3.4 steps 2 to 4)", () => {
  const one = makeListing(1);
  const two = makeListing(2);
  const three = makeListing(3);

  it("shows each listing once, in page order, even when a later page repeats it", () => {
    const pages = [makeListingsPage([one, two]), makeListingsPage([two, three], { first: false })];
    expect(shownListings(pages).map((listing) => listing.listingId)).toEqual(
      [one, two, three].map((listing) => listing.listingId),
    );
  });

  it("drops a listing from every page, and leaves pages without it as they were", () => {
    const first = makeListingsPage([one, two]);
    const second = makeListingsPage([three], { first: false });
    const [a, b] = withoutListing([first, second], two.listingId);
    expect(a?.listings).toEqual([one]);
    expect(b).toBe(second);
  });

  it("names every franchise the pages carry", () => {
    expect([...franchisesOf([makeListingsPage([])]).keys()]).toEqual(FRANCHISES.map((f) => f.id));
  });

  it("offers the first page's series in its order, and keeps the selected one after it has gone", () => {
    const first = { ...makeListingsPage([]), filterFranchiseIds: [102, 100, 999] };
    expect(seriesOptions(first, null).map((f) => f.id)).toEqual([102, 100]);
    const gone = makeFranchise(555, { title: "Gone Saga" });
    expect(seriesOptions(first, gone).map((f) => f.id)).toEqual([102, 100, 555]);
    expect(seriesOptions(first, FRANCHISES[0] ?? null).map((f) => f.id)).toEqual([102, 100]);
    expect(seriesOptions(undefined, gone)).toEqual([gone]);
  });
});

describe("List on the market (collection-overview.md §3.5)", () => {
  const rules = makeRules();

  it("previews the fee from the wallet's rule: rounded up, at least feeMin", () => {
    expect(feePreview(40, rules)).toBe(2);
    expect(feePreview(41, rules)).toBe(3);
    expect(feePreview(5, rules)).toBe(1);
    expect(feePreview(27_500, rules)).toBe(1_375);
    expect(feePreview(100, { feeBps: 250, feeMin: 10 })).toBe(10);
  });

  it("takes a whole number within the bounds, and nothing else", () => {
    expect(parsePrice(" 40 ", 18, 87)).toBe(40);
    expect(parsePrice("18", 18, 87)).toBe(18);
    expect(parsePrice("87", 18, 87)).toBe(87);
    for (const text of ["", "17", "88", "4.5", "-20", "1e2", "40 Karma", "٤٠", "0x20", "1234567890"]) {
      expect(parsePrice(text, 18, 87), text).toBeNull();
    }
  });

  it("offers the rarity's bounds while a copy is available and the cap is not reached", () => {
    const entry = makeEntry(makeCharacter(1, { tier: "epic" }), { count: 2 });
    expect(listRange(entry, 0, rules)).toEqual({ kind: "open", min: 80, max: 400 });
    expect(listRange({ ...entry, available: 0 }, 0, rules)).toEqual({
      kind: "closed",
      reason: "noneAvailable",
    });
    expect(listRange(entry, 50, rules)).toEqual({ kind: "closed", reason: "cap" });
  });

  it("names the only copy, the only copy out of the pool, or the last available copy of the rarity", () => {
    const spike = makeCharacter(1, { tier: "epic" });
    const only = makeEntry(spike);
    expect(lastCopy(only, [only])).toBe("onlyCopy");
    const dropped = makeEntry(makeCharacter(1, { inCurrentSnapshot: false, tier: null }), { rarity: "epic" });
    expect(lastCopy(dropped, [dropped])).toBe("onlyCopyOutOfPool");
    const listedOut = makeEntry(spike, { count: 3, listed: 2, available: 1 });
    expect(lastCopy(listedOut, [listedOut])).toBe("allOfRarity");
    // One copy of this rarity, but another entry holds the character too: not the only copy.
    const other = makeEntry(spike, { rarity: "common" });
    expect(lastCopy(only, [only, other])).toBe("allOfRarity");
    const plenty = makeEntry(spike, { count: 3 });
    expect(lastCopy(plenty, [plenty])).toBeNull();
  });

  it("lists the player's entries of a character, rarest first", () => {
    const entries = [
      makeEntry(makeCharacter(1), { rarity: "common", count: 3 }),
      makeEntry(makeCharacter(2), { rarity: "mythic" }),
      makeEntry(makeCharacter(1), { rarity: "legendary" }),
    ];
    expect(heldEntries(1, entries).map((entry) => entry.rarity)).toEqual(["legendary", "common"]);
    expect(heldEntries(9, entries)).toEqual([]);
  });
});

describe("market_limit (§3.5 step 4)", () => {
  const now = { wall: Date.UTC(2026, 9, 30, 9, 0), monotonic: 1_000 };

  it("names the date it frees up from the server's seconds, and waits at most MAX_WAIT_SECONDS", () => {
    const block = limitBlock("buyer_spend", 3 * 86_400, now);
    expect(block?.limit).toBe("buyer_spend");
    expect(block?.freesAt.toISOString()).toBe("2026-11-02T09:00:00.000Z");
    expect(block?.until).toBe(1_000 + MAX_WAIT_SECONDS * 1000);
    expect(limitBlock("pair", 30, now)?.until).toBe(31_000);
  });

  it("without seconds waits the fallback; without a limit is no block at all", () => {
    expect(limitBlock("pair", undefined, now)?.until).toBe(1_000 + RATE_LIMITED_FALLBACK_SECONDS * 1000);
    expect(limitBlock(undefined, 30, now)).toBeNull();
  });

  it("the buyer's own limits hold for every listing, the seller's and the pair's for one", () => {
    expect(blocksEveryListing("buyer_purchases")).toBe(true);
    expect(blocksEveryListing("buyer_spend")).toBe(true);
    expect(blocksEveryListing("seller_proceeds")).toBe(false);
    expect(blocksEveryListing("pair")).toBe(false);
  });
});
