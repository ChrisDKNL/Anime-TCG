import type { ListingStatus } from "@anime-tcg/shared/api";
import { MARKET_LISTING_TTL_SECONDS, MARKET_PRICE_MAX, MARKET_PRICE_MIN } from "@anime-tcg/shared/economy";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { ApiError } from "../errors.js";

/**
 * The listing rules of the market (economy.md §8.3 to §8.5), pure. A
 * listing's stored status lags time: one still `active` past its
 * `expires_at` is expired for every purpose (§8.5), whether or not the
 * hourly purge has marked it yet.
 */

/** §8.3 step 1: the asking price lies within the bounds of the card's granted rarity, else 400. */
export function checkPrice(rarity: Rarity, price: number): void {
  if (price < MARKET_PRICE_MIN[rarity] || price > MARKET_PRICE_MAX[rarity]) {
    throw new ApiError(
      400,
      "price_out_of_bounds",
      `A ${rarity} card lists between ${MARKET_PRICE_MIN[rarity]} and ${MARKET_PRICE_MAX[rarity]}`,
    );
  }
}

export function expiryOf(listedAt: Date): Date {
  return new Date(listedAt.getTime() + MARKET_LISTING_TTL_SECONDS * 1_000);
}

/** A listing as the rules see it: its stored status and its expiry. */
export interface ListingState {
  status: ListingStatus;
  expiresAt: Date;
  closedAt: Date | null;
}

/** Active and not yet past its expiry: the only listings that can be bought, and whose card is not available. */
export function isLive(listing: Pick<ListingState, "status" | "expiresAt">, now: Date): boolean {
  return listing.status === "active" && listing.expiresAt.getTime() > now.getTime();
}

/** The status and closing time the market shows: a lapsed `active` listing is `expired`, closed at its expiry. */
export function shownState(
  listing: ListingState,
  now: Date,
): { status: ListingStatus; closedAt: Date | null } {
  if (listing.status === "active" && !isLive(listing, now)) {
    return { status: "expired", closedAt: listing.expiresAt };
  }
  return { status: listing.status, closedAt: listing.closedAt };
}

/** What makes two listing requests "the same request" (§8.8): the entry and the price, never the key. */
export interface ListingRequest {
  characterId: number;
  rarity: Rarity;
  price: number;
}

export function sameListingRequest(stored: ListingRequest, asked: ListingRequest): boolean {
  return (
    stored.characterId === asked.characterId && stored.rarity === asked.rarity && stored.price === asked.price
  );
}

/** What the seller kept of a sale; nothing for a listing that did not sell. */
export function proceedsOf(listing: { status: ListingStatus; price: number; fee: number }): number | null {
  return listing.status === "sold" ? listing.price - listing.fee : null;
}

export function listingUnavailable(): ApiError {
  return new ApiError(409, "listing_unavailable", "That listing is no longer for sale");
}

/** §8.5 steps 4 and 7: a listing a buyer can still buy is live; anything else is gone. */
export function assertBuyable(listing: Pick<ListingState, "status" | "expiresAt">, now: Date): void {
  if (!isLive(listing, now)) throw listingUnavailable();
}
