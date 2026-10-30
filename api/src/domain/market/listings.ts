import type { FranchiseRef, Listing, ListingStatus } from "@anime-tcg/shared/api";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { and, count, eq, gt, sql } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { marketListings } from "../../db/schema.js";
import { currentSnapshot, describeCharacters, franchiseRefs } from "../pool/catalog.js";
import { proceedsOf, shownState } from "./rules.js";

/**
 * Reads of listings shared by the market's routes, the wallet and the
 * collection: the rows as stored, and the listings as the api shows them.
 */

/** A listing row as the market reads it. */
export interface ListingRow {
  id: string;
  sellerId: string;
  cardId: string | null;
  characterId: number;
  rarity: Rarity;
  variant: "standard";
  price: number;
  fee: number;
  status: ListingStatus;
  createdAt: Date;
  expiresAt: Date;
  closedAt: Date | null;
}

export const LISTING_COLUMNS = {
  id: marketListings.id,
  sellerId: marketListings.sellerId,
  cardId: marketListings.cardId,
  characterId: marketListings.characterId,
  rarity: marketListings.rarity,
  variant: marketListings.variant,
  price: marketListings.price,
  fee: marketListings.fee,
  status: marketListings.status,
  createdAt: marketListings.createdAt,
  expiresAt: marketListings.expiresAt,
  closedAt: marketListings.closedAt,
};

/** Listings that can be bought at `now`: active, and not past their expiry, whether or not the purge has run (§8.5). */
export function liveListing(now: Date) {
  return and(eq(marketListings.status, "active"), gt(marketListings.expiresAt, now));
}

/** `Wallet.activeListings`: the account's live listings, the number the listing cap counts. */
export async function liveListingCount(db: Queryable, sellerId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(marketListings)
    .where(and(eq(marketListings.sellerId, sellerId), liveListing(now)));
  return row?.total ?? 0;
}

/** True when a held card is the card of a live listing, as a column of a query over `cards`. */
export function cardIsListed(now: Date) {
  return sql<boolean>`exists (select 1 from ${marketListings} where ${marketListings.cardId} = "cards"."id" and ${marketListings.status} = 'active' and ${marketListings.expiresAt} > ${now})`;
}

/**
 * Listings as the api shows them (economy.md §11.2): each character as the
 * game shows it now, the status time has given it, and `mine` for the
 * viewer's own. `rows` keeps its order.
 */
export async function describeListings(
  db: Queryable,
  rows: readonly ListingRow[],
  viewerId: string,
  now: Date,
): Promise<{ listings: (Listing & { proceeds: number | null })[]; franchiseIds: Set<number> }> {
  const snapshot = await currentSnapshot(db);
  const described = await describeCharacters(
    db,
    rows.map((row) => row.characterId),
    snapshot?.id ?? null,
  );
  const listings = rows.map((row) => {
    const character = described.characters.get(row.characterId);
    if (character === undefined)
      throw new Error(`listing ${row.id}: character ${row.characterId} is missing`);
    const shown = shownState(row, now);
    return {
      listingId: row.id,
      kind: "card" as const,
      character,
      rarity: row.rarity,
      variant: row.variant,
      price: row.price,
      fee: row.fee,
      listedAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      closedAt: shown.closedAt?.toISOString() ?? null,
      status: shown.status,
      mine: row.sellerId === viewerId,
      proceeds: proceedsOf({ status: shown.status, price: row.price, fee: row.fee }),
    };
  });
  return { listings, franchiseIds: described.franchiseIds };
}

/** A listing without its `proceeds`, for every answer but `mine.closed`. */
export function withoutProceeds({
  proceeds: _proceeds,
  ...listing
}: Listing & { proceeds: number | null }): Listing {
  return listing;
}

export async function describeListing(
  db: Queryable,
  row: ListingRow,
  viewerId: string,
  now: Date,
): Promise<Listing> {
  const { listings } = await describeListings(db, [row], viewerId, now);
  const [listing] = listings;
  if (listing === undefined) throw new Error(`listing ${row.id} was not described`);
  return withoutProceeds(listing);
}

/** Franchise refs in the order given; ids without a series row are dropped. */
export async function orderedFranchiseRefs(db: Queryable, ids: readonly number[]): Promise<FranchiseRef[]> {
  const refs = new Map((await franchiseRefs(db, ids)).map((ref) => [ref.id, ref]));
  return ids.flatMap((id) => {
    const ref = refs.get(id);
    return ref === undefined ? [] : [ref];
  });
}
