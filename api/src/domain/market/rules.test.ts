import { MARKET_LISTING_TTL_SECONDS, MARKET_PRICE_MAX, MARKET_PRICE_MIN } from "@anime-tcg/shared/economy";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import {
  assertBuyable,
  checkPrice,
  expiryOf,
  isLive,
  proceedsOf,
  sameListingRequest,
  shownState,
} from "./rules.js";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("the market's listing rules (economy.md §8.3 to §8.5)", () => {
  it("accepts a price at either bound of every tier and refuses one past either, with 400 price_out_of_bounds", () => {
    for (const tier of RARITIES) {
      expect(() => checkPrice(tier, MARKET_PRICE_MIN[tier])).not.toThrow();
      expect(() => checkPrice(tier, MARKET_PRICE_MAX[tier])).not.toThrow();
      for (const price of [MARKET_PRICE_MIN[tier] - 1, MARKET_PRICE_MAX[tier] + 1]) {
        expect(() => checkPrice(tier, price)).toThrow(ApiError);
        expect(() => checkPrice(tier, price)).toThrow(
          expect.objectContaining({ statusCode: 400, code: "price_out_of_bounds" }),
        );
      }
    }
  });

  it("expires a listing MARKET_LISTING_TTL after it was made", () => {
    expect(expiryOf(NOW)).toEqual(at(MARKET_LISTING_TTL_SECONDS * 1_000));
  });

  it("treats a listing as live only while active and before its expiry, to the millisecond", () => {
    expect(isLive({ status: "active", expiresAt: at(1) }, NOW)).toBe(true);
    expect(isLive({ status: "active", expiresAt: NOW }, NOW)).toBe(false);
    for (const status of ["sold", "cancelled", "expired"] as const)
      expect(isLive({ status, expiresAt: at(60_000) }, NOW)).toBe(false);
    expect(() => assertBuyable({ status: "active", expiresAt: NOW }, NOW)).toThrow(
      expect.objectContaining({ statusCode: 409, code: "listing_unavailable" }),
    );
    expect(() => assertBuyable({ status: "active", expiresAt: at(1) }, NOW)).not.toThrow();
  });

  it("shows a lapsed active listing as expired, closed at its expiry, purged or not", () => {
    expect(shownState({ status: "active", expiresAt: at(-1), closedAt: null }, NOW)).toEqual({
      status: "expired",
      closedAt: at(-1),
    });
    expect(shownState({ status: "active", expiresAt: at(1), closedAt: null }, NOW)).toEqual({
      status: "active",
      closedAt: null,
    });
    expect(shownState({ status: "cancelled", expiresAt: at(1), closedAt: at(-5) }, NOW)).toEqual({
      status: "cancelled",
      closedAt: at(-5),
    });
  });

  it("matches a replayed listing on its entry and price, never on the key", () => {
    const stored = { characterId: 1, rarity: "mythic" as const, price: 27_500 };
    expect(sameListingRequest(stored, { ...stored })).toBe(true);
    expect(sameListingRequest(stored, { ...stored, price: 27_499 })).toBe(false);
    expect(sameListingRequest(stored, { ...stored, characterId: 2 })).toBe(false);
    expect(sameListingRequest(stored, { ...stored, rarity: "legendary" })).toBe(false);
  });

  it("reports a sale's net proceeds, and none for a listing that did not sell", () => {
    expect(proceedsOf({ status: "sold", price: 27_500, fee: 1_375 })).toBe(26_125);
    expect(proceedsOf({ status: "sold", price: 5, fee: 1 })).toBe(4);
    for (const status of ["active", "cancelled", "expired"] as const)
      expect(proceedsOf({ status, price: 5, fee: 1 })).toBeNull();
  });
});
