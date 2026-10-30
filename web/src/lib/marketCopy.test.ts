import { describe, expect, it } from "vitest";
import { FORBIDDEN_WORDS, walkCopy } from "../test/copyWords";
import * as copy from "./marketCopy";
import {
  browseCopy,
  buyCopy,
  cancelCopy,
  duration,
  feePercent,
  listCopy,
  listingDialogCopy,
  listingTileCopy,
  mineCopy,
} from "./marketCopy";

const RTL = "‮evil‬";
/** 9:30 on 30 Oct 2026 in the viewer's time zone, so the clock reads the same everywhere. */
const LOCAL = new Date(2026, 9, 30, 9, 30).toISOString();
const LEFT = { purchases: 100, spend: 55_000, proceeds: 55_000 };
const BODY = { rarity: "epic", ttlSeconds: 604_800, net: 114, fee: 6, lastCopy: null } as const;

/** Every function of the module, called with the arguments the pages give it. */
const CALLS: Record<string, string[]> = {
  duration: [duration(604_800), duration(86_400), duration(129_600)],
  feePercent: [feePercent(500)],
  "browseCopy.rarity": [browseCopy.rarity("mythic")],
  "browseCopy.seriesOption": [browseCopy.seriesOption("Cowboy Bebop", null)],
  "browseCopy.sort": [browseCopy.sort("price_asc"), browseCopy.sort("price_desc"), browseCopy.sort("newest")],
  "browseCopy.character": [browseCopy.character("Spike")],
  "browseCopy.results": [browseCopy.results(1), browseCopy.results(50)],
  "browseCopy.noMatchQuery": [browseCopy.noMatchQuery("zoro")],
  "listingTileCopy.price": [listingTileCopy.price(40)],
  "listingTileCopy.until": [listingTileCopy.until(LOCAL)],
  "listingTileCopy.label": [
    listingTileCopy.label("Spike", "rare", "Cowboy Bebop", 40, false),
    listingTileCopy.label("Spike", "rare", null, 40, true),
  ],
  "listingDialogCopy.price": [listingDialogCopy.price(40)],
  "listingDialogCopy.until": [listingDialogCopy.until(LOCAL)],
  "listingDialogCopy.inCollection": [listingDialogCopy.inCollection("rare", 2)],
  "listingDialogCopy.tooLittle": [listingDialogCopy.tooLittle(400, 120)],
  "buyCopy.confirmHeading": [buyCopy.confirmHeading("Spike", 40)],
  "buyCopy.confirmBody": [buyCopy.confirmBody("rare", 1_240)],
  "buyCopy.confirm": [buyCopy.confirm(40)],
  "buyCopy.resultHeading": [buyCopy.resultHeading("Spike")],
  "buyCopy.bought": [buyCopy.bought(40, 1_200)],
  "buyCopy.tooLittleRefused": [buyCopy.tooLittleRefused(400, 120)],
  "buyCopy.limit": [
    buyCopy.limit("buyer_purchases", 604_800, new Date(LOCAL)),
    buyCopy.limit("buyer_spend", null, new Date(LOCAL)),
    buyCopy.limit("seller_proceeds", 604_800, new Date(LOCAL)),
    buyCopy.limit("pair", 604_800, new Date(LOCAL)),
  ],
  "mineCopy.activeHeading": [mineCopy.activeHeading(2, 50), mineCopy.activeHeading(2, null)],
  "mineCopy.price": [mineCopy.price(40)],
  "mineCopy.fee": [mineCopy.fee(2, 38)],
  "mineCopy.until": [mineCopy.until(LOCAL)],
  "mineCopy.cancelName": [mineCopy.cancelName("Spike")],
  "mineCopy.limitsHeading": [mineCopy.limitsHeading(604_800), mineCopy.limitsHeading(null)],
  "mineCopy.limits": [mineCopy.limits(LEFT), mineCopy.limits({ purchases: 1, spend: 0, proceeds: 0 })],
  "mineCopy.sold": [mineCopy.sold(40, 38)],
  "mineCopy.soldFor": [mineCopy.soldFor(40)],
  "mineCopy.date": [mineCopy.date(LOCAL)],
  "cancelCopy.cancelled": [cancelCopy.cancelled("Spike")],
  "listCopy.hint": [listCopy.hint(80, 400)],
  "listCopy.fee": [listCopy.fee(6, 500, 114)],
  "listCopy.priceError": [listCopy.priceError(80, 400)],
  "listCopy.marketLink": [listCopy.marketLink("Spike")],
  "listCopy.confirmHeading": [listCopy.confirmHeading("Spike", 120)],
  "listCopy.confirmBody": [
    listCopy.confirmBody("Spike", BODY),
    listCopy.confirmBody("Spike", { ...BODY, lastCopy: "onlyCopy" }),
    listCopy.confirmBody("Spike", { ...BODY, lastCopy: "onlyCopyOutOfPool" }),
    listCopy.confirmBody("Spike", { ...BODY, lastCopy: "allOfRarity" }),
  ],
  "listCopy.confirm": [listCopy.confirm(120)],
  "listCopy.listed": [listCopy.listed(120, 6, LOCAL)],
  "listCopy.cap": [listCopy.cap(50), listCopy.cap(1)],
};

const { strings, functions } = walkCopy(copy);
const rendered = [...strings, ...Object.values(CALLS).flat()];

describe("market copy words (collection-overview.md §8, market-and-shop.md §8)", () => {
  it("renders every string of the module and calls every function in it", () => {
    expect(functions.sort()).toEqual(Object.keys(CALLS).sort());
    expect(strings.length).toBeGreaterThan(50);
  });

  it("contains none of the forbidden words, money words or casino nudges", () => {
    expect(rendered.filter((text) => FORBIDDEN_WORDS.some((word) => word.test(text)))).toEqual([]);
  });

  it("no scarcity or urgency: no counts of what is left on the market, no countdown words", () => {
    const pressure = [/\bleft\b/i, /\bremaining\b/i, /\bhurry\b/i, /\bexpires? soon\b/i, /\blast\b(?! \d)/i];
    const offenders = rendered.filter(
      (text) => pressure.some((word) => word.test(text)) && !/for the last|in the last|last \d/.test(text),
    );
    expect(offenders).toEqual([]);
  });

  it("says Karma only after a number (`500 more Karma` included) or as a label", () => {
    for (const text of rendered) {
      for (const match of text.matchAll(/(\S*) Karma\b/g)) {
        expect(match[1], text).toMatch(/^(?:[\d,]+|more)$/);
      }
    }
    expect(listCopy.afterField).toBe("Karma");
  });

  it("names no other account: no login appears in any string", () => {
    expect(rendered.filter((text) => /\bseller\b.*\b(named|called)\b|login/i.test(text))).toEqual([]);
  });
});

describe("browse copy (market-and-shop.md §8 Market, browse)", () => {
  it("is the spec's exact text", () => {
    expect(browseCopy.views).toEqual({ group: "View", browse: "Browse", mine: "My listings" });
    expect(browseCopy.filters).toBe("Market filters");
    expect(browseCopy.searchPlaceholder).toBe("Name or series");
    expect(browseCopy.allRarities).toBe("All rarities");
    expect(browseCopy.allSeries).toBe("All series");
    expect([browseCopy.sort("price_asc"), browseCopy.sort("price_desc"), browseCopy.sort("newest")]).toEqual([
      "Lowest price first",
      "Highest price first",
      "Newest first",
    ]);
    expect(browseCopy.character("Spike")).toBe("Showing Spike only.");
    expect(browseCopy.showAll).toBe("Show all");
    expect(browseCopy.results(1)).toBe("1 listing shown");
    expect(browseCopy.results(1_050)).toBe("1,050 listings shown");
    expect(browseCopy.more).toBe("Show more");
    expect(browseCopy.loadingMore).toBe("Loading…");
    expect(browseCopy.moreFailed).toBe("Couldn't load more.");
    expect(browseCopy.empty).toBe("No cards on the market.");
    expect(browseCopy.noMatchQuery("zoro")).toBe('No listings match "zoro".');
    expect(browseCopy.noMatchFilters).toBe("No listings match these filters.");
    expect(browseCopy.loading).toBe("Loading the market…");
    expect(browseCopy.error).toBe("Couldn't load the market.");
  });

  it("isolates AniList strings in plain-string sinks and cuts a long series title", () => {
    expect(browseCopy.seriesOption(RTL, null)).toBe(`⁨${RTL}⁩`);
    expect(browseCopy.seriesOption("Hunter x Hunter", 2011)).toBe("⁨Hunter x Hunter, 2011⁩");
    expect(browseCopy.seriesOption("x".repeat(70), null)).toBe(`⁨${"x".repeat(60)}…⁩`);
    expect(listingTileCopy.label(RTL, "rare", "Cowboy Bebop", 40, false)).toBe(
      `⁨${RTL}⁩, Rare, ⁨Cowboy Bebop⁩, 40 Karma`,
    );
    expect(listingTileCopy.label("Spike", "mythic", null, 27_500, true)).toBe(
      "⁨Spike⁩, Mythic, 27,500 Karma, yours",
    );
    expect(mineCopy.cancelName(RTL)).toBe(`Cancel listing of ⁨${RTL}⁩`);
  });

  it("writes the listing's end as D Mon, HH:MM in the viewer's time zone", () => {
    expect(listingTileCopy.until(LOCAL)).toBe("Until 30 Oct, 09:30");
    expect(listingTileCopy.yours).toBe("Yours");
  });
});

describe("listing dialog and buy copy (market-and-shop.md §8)", () => {
  it("is the spec's exact text", () => {
    expect(listingDialogCopy.facts).toEqual({ rarity: "Rarity", price: "Price", until: "Until" });
    expect(listingDialogCopy.inCollection("legendary", 2)).toBe("In your collection: Legendary ×2");
    expect(listingDialogCopy.notInCollection).toBe("Not in your collection.");
    expect(listingDialogCopy.yours).toBe("This is your listing.");
    expect(listingDialogCopy.cancelListing).toBe("Cancel listing");
    expect(listingDialogCopy.buy).toBe("Buy…");
    expect(listingDialogCopy.tooLittle(400, 120)).toBe("Costs 400 Karma. You have 120.");
    expect(buyCopy.confirmHeading("Spike", 1_400)).toBe("Buy Spike for 1,400 Karma?");
    expect(buyCopy.confirmBody("rare", 1_240)).toBe("One Rare card. You have 1,240 Karma. There is no undo.");
    expect(buyCopy.confirm(40)).toBe("Buy for 40 Karma");
    expect(buyCopy.buying).toBe("Buying…");
    expect(buyCopy.resultHeading("Spike")).toBe("Spike is in your collection");
    expect(buyCopy.newMarker).toBe("New");
    expect(buyCopy.bought(40, 1_200)).toBe("Bought for 40 Karma. You have 1,200 Karma.");
    expect(buyCopy.gone).toBe("This card is no longer on the market.");
    expect(buyCopy.tooLittleRefused(400, 120)).toBe("This card costs 400 Karma. You have 120 Karma.");
  });

  it("names the limit that was hit and the date it frees up, with no countdown", () => {
    const at = new Date(LOCAL);
    expect(buyCopy.limit("buyer_purchases", 604_800, at)).toBe(
      "Your market limit for the last 7 days is used up. It frees up on 30 Oct at 09:30.",
    );
    expect(buyCopy.limit("buyer_spend", 604_800, at)).toBe(buyCopy.limit("buyer_purchases", 604_800, at));
    expect(buyCopy.limit("seller_proceeds", 604_800, at)).toBe(
      "This seller can't take more sales right now. Try again on 30 Oct at 09:30.",
    );
    expect(buyCopy.limit("pair", 604_800, at)).toBe(
      "You've bought as much from this seller as the market allows for now. Try again on 30 Oct at 09:30.",
    );
  });
});

describe("My listings and cancel copy (market-and-shop.md §8)", () => {
  it("is the spec's exact text", () => {
    expect(mineCopy.activeHeading(3, 50)).toBe("On the market, 3 of 50");
    expect(mineCopy.fee(2, 38)).toBe("Fee 2 Karma · you get 38 Karma");
    expect(mineCopy.until(LOCAL)).toBe("Until 30 Oct, 09:30");
    expect(mineCopy.cancelling).toBe("Cancelling…");
    expect(mineCopy.activeEmpty).toBe("Nothing on the market.");
    expect(mineCopy.limitsHeading(604_800)).toBe("Market limits, last 7 days");
    expect(mineCopy.limits(LEFT)).toBe(
      "You can buy 100 more cards and spend 55,000 more Karma, and receive 55,000 more Karma from sales.",
    );
    expect(mineCopy.limits({ purchases: 1, spend: 0, proceeds: 0 })).toBe(
      "You can buy 1 more card and spend 0 more Karma, and receive 0 more Karma from sales.",
    );
    expect(mineCopy.closedHeading).toBe("Closed in the last 30 days");
    expect(mineCopy.sold(40, 38)).toBe("Sold for 40 Karma · you got 38 Karma");
    expect(mineCopy.cancelled).toBe("Cancelled");
    expect(mineCopy.expired).toBe("Expired");
    expect(mineCopy.boughtHeading).toBe("Bought in the last 30 days");
    expect(mineCopy.empty).toBe("Nothing in the last 30 days.");
    expect(mineCopy.loading).toBe("Loading your listings…");
    expect(mineCopy.error).toBe("Couldn't load your listings.");
    expect(cancelCopy.cancelled("Spike")).toBe("Listing cancelled. Spike is available again.");
    expect(cancelCopy.alreadyEnded).toBe("That listing had already ended.");
    expect(cancelCopy.soldFirst).toBe("It sold before the cancel arrived.");
    expect(cancelCopy.gone).toBe("That listing is gone.");
  });
});

describe("List on the market copy (collection-overview.md §8)", () => {
  it("is the spec's exact text, with the server's numbers", () => {
    expect(listCopy.heading).toBe("List on the market");
    expect(listCopy.priceLabel).toBe("Price");
    expect(listCopy.hint(80, 400)).toBe("80 to 400 Karma");
    expect(listCopy.fee(6, 500, 114)).toBe("Fee 6 Karma (5%). You get 114 Karma if it sells.");
    expect(listCopy.priceError(5_500, 27_500)).toBe("Choose a whole number from 5,500 to 27,500.");
    expect(listCopy.button).toBe("List…");
    expect(listCopy.noneAvailable).toBe("Every copy is already on the market.");
    expect(listCopy.marketLink("Spike")).toBe("See Spike on the market");
    expect(listCopy.confirmHeading("Spike", 120)).toBe("List Spike for 120 Karma?");
    expect(listCopy.confirm(120)).toBe("List for 120 Karma");
    expect(listCopy.listing).toBe("Listing…");
    expect(listCopy.myListings).toBe("My listings");
  });

  it("builds the confirmation body sentence by sentence, with at most one last-copy sentence", () => {
    const lead =
      "One Epic copy goes on the market for 7 days. If someone buys it, you get 114 Karma after the 6 Karma fee. It stays in your collection until it sells, and you can cancel the listing until then.";
    expect(listCopy.confirmBody("Spike", BODY)).toBe(`${lead} A sale can't be undone.`);
    expect(listCopy.confirmBody("Spike", { ...BODY, lastCopy: "onlyCopy" })).toBe(
      `${lead} This is your only Spike; once it sells, it stops counting toward completion. A sale can't be undone.`,
    );
    expect(listCopy.confirmBody("Spike", { ...BODY, lastCopy: "onlyCopyOutOfPool" })).toBe(
      `${lead} This is your only Spike, and packs no longer include this character. A sale can't be undone.`,
    );
    expect(listCopy.confirmBody("Spike", { ...BODY, lastCopy: "allOfRarity" })).toBe(
      `${lead} That puts every Epic copy you have on the market. A sale can't be undone.`,
    );
  });

  it("states the listing from the server's answer, and the cap without a nudge word", () => {
    expect(listCopy.listed(120, 6, LOCAL)).toBe(
      "Listed for 120 Karma until 30 Oct 2026, 09:30. The fee is 6 Karma if it sells.",
    );
    expect(listCopy.cap(50)).toBe(
      "You have 50 cards on the market, the most at once. Cancel a listing to list this card.",
    );
  });

  it("shows rule times in days when they divide into days, else hours; the fee rule as a percentage", () => {
    expect(duration(604_800)).toBe("7 days");
    expect(duration(86_400)).toBe("1 day");
    expect(duration(129_600)).toBe("36 hours");
    expect(duration(1_800)).toBe("1 hour");
    expect(feePercent(500)).toBe("5%");
    expect(feePercent(250)).toBe("2.5%");
  });
});
