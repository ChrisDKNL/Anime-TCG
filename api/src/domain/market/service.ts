import type {
  BuyBody,
  ListBody,
  Listing,
  ListingSort,
  ListingsPage,
  ListingsQuery,
  MarketMine,
  PurchaseReceipt,
} from "@anime-tcg/shared/api";
import { MARKET_MAX_LISTINGS, MARKET_PAGE_SIZE, MAX_BALANCE } from "@anime-tcg/shared/economy";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db, Queryable } from "../../db/client.js";
import { accounts, cards, ledgerEntries, marketListings, marketPurchases } from "../../db/schema.js";
import { marketFee } from "../economy/fee.js";
import { type LockedBalance, type PostedEntry, postEntry } from "../economy/ledger.js";
import { newestFirst } from "../economy/recycle.js";
import { lockBalance } from "../economy/service.js";
import { ApiError } from "../errors.js";
import { requestIdReused } from "../packs/service.js";
import { currentSnapshot, describeCharacters } from "../pool/catalog.js";
import { type CursorPosition, decodeCursor, encodeCursor } from "./cursor.js";
import { firstLimitHit, type WindowPurchase, windowLeft, windowStart } from "./limits.js";
import {
  describeListing,
  describeListings,
  LISTING_COLUMNS,
  type ListingRow,
  liveListing,
  liveListingCount,
  orderedFranchiseRefs,
  withoutProceeds,
} from "./listings.js";
import {
  assertBuyable,
  checkPrice,
  expiryOf,
  isLive,
  listingUnavailable,
  sameListingRequest,
} from "./rules.js";
import { LIKE_ESCAPE, searchPatterns } from "./search.js";

/** What the service logs through: the request's logger, so each line carries the request id. */
export type MarketLog = Pick<Logger, "info" | "warn">;

/** `GET /api/market/mine` looks back this far for closed listings and purchases (economy.md §8.4). */
const MINE_HISTORY_MS = 30 * 86_400_000;
/** The largest id a query may name: a Postgres `integer`. */
const MAX_ID = 2_147_483_647;

function listingNotFound(): ApiError {
  return new ApiError(404, "listing_not_found", "No such listing");
}

function signedOut(): ApiError {
  return new ApiError(401, "unauthenticated", "Sign in first");
}

/** A query id is digits by its schema; one beyond an `integer` can name nothing, and is refused like a malformed one. */
function queryId(text: string | undefined, name: string): number | null {
  if (text === undefined) return null;
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id > MAX_ID)
    throw new ApiError(400, "validation_failed", `querystring/${name} must be at most ${MAX_ID}`);
  return id;
}

/** A purchase as stored, with what its receipt needs. */
interface StoredPurchase {
  id: string;
  createdAt: Date;
  listingId: string | null;
  price: number;
  characterId: number;
  rarity: Rarity;
  variant: "standard";
  /** The delivered card's flag; null once an owner reset deleted the card. */
  isNew: boolean | null;
}

const STORED_PURCHASE_COLUMNS = {
  id: marketPurchases.id,
  createdAt: marketPurchases.createdAt,
  listingId: marketPurchases.listingId,
  price: marketPurchases.price,
  characterId: marketPurchases.characterId,
  rarity: marketPurchases.rarity,
  variant: marketPurchases.variant,
  isNew: cards.isNew,
};

async function storedPurchase(
  tx: Queryable,
  buyerId: string,
  requestId: string,
): Promise<StoredPurchase | null> {
  const [row] = await tx
    .select(STORED_PURCHASE_COLUMNS)
    .from(marketPurchases)
    .leftJoin(cards, eq(cards.purchaseId, marketPurchases.id))
    .where(and(eq(marketPurchases.buyerId, buyerId), eq(marketPurchases.requestId, requestId)))
    .limit(1);
  return row ?? null;
}

/**
 * The replay of a purchase (economy.md §8.5 step 1): the receipt never
 * changes, unless the key named another listing. A purchase whose listing
 * went with its seller's account no longer says which listing it was, so
 * its key answers its receipt (manager decision, 2026-10-30).
 */
function replayOf(stored: StoredPurchase, listingId: string): StoredPurchase {
  if (stored.listingId !== null && stored.listingId !== listingId) throw requestIdReused();
  return stored;
}

async function balanceOf(db: Queryable, accountId: string): Promise<number> {
  const [row] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (row === undefined) throw signedOut();
  return row.balance;
}

/**
 * An account's market purchases or sales inside the window, as the ledger
 * rows that recorded them (through `ledger_entries_account_kind_created_idx`,
 * economy.md §7): a sale stays counted even after its buyer's account went.
 */
async function windowEntries(
  db: Queryable,
  accountId: string,
  kind: "market_purchase" | "market_sale",
  now: Date,
): Promise<WindowPurchase[]> {
  const rows = await db
    .select({ at: ledgerEntries.createdAt, amount: ledgerEntries.amount })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.accountId, accountId),
        eq(ledgerEntries.kind, kind),
        gt(ledgerEntries.createdAt, windowStart(now)),
      ),
    );
  return rows.map((row) => ({ at: row.at, price: Math.abs(row.amount) }));
}

function pairPurchases(
  tx: Queryable,
  buyerId: string,
  sellerId: string,
  now: Date,
): Promise<WindowPurchase[]> {
  return tx
    .select({ at: marketPurchases.createdAt, price: marketPurchases.price })
    .from(marketPurchases)
    .where(
      and(
        eq(marketPurchases.buyerId, buyerId),
        eq(marketPurchases.sellerId, sellerId),
        gt(marketPurchases.createdAt, windowStart(now)),
      ),
    );
}

/** Lapsed listings marked expired, closed at their expiry: the partial unique index then frees their cards for a new listing. */
const EXPIRED = { status: "expired" as const, closedAt: sql`${marketListings.expiresAt}` };

function lapsed(now: Date) {
  return and(eq(marketListings.status, "active"), lte(marketListings.expiresAt, now));
}

/**
 * The seller's two rows of a sale, the sale and then its fee. Only when the
 * sale alone would pass `MAX_BALANCE` while what the seller keeps fits does
 * the fee go first, so no row's `balance_after` leaves its bounds; a balance
 * that high always covers the fee.
 */
async function postSale(
  tx: Queryable,
  seller: LockedBalance,
  price: number,
  fee: number,
  now: Date,
): Promise<{ saleEntry: PostedEntry; feeEntry: PostedEntry }> {
  if (seller.balance + price > MAX_BALANCE) {
    const feeEntry = await postEntry(tx, seller, "market_fee", -fee, now);
    const saleEntry = await postEntry(
      tx,
      { id: seller.id, balance: feeEntry.balanceAfter },
      "market_sale",
      price,
      now,
    );
    return { saleEntry, feeEntry };
  }
  const saleEntry = await postEntry(tx, seller, "market_sale", price, now);
  const feeEntry = await postEntry(
    tx,
    { id: seller.id, balance: saleEntry.balanceAfter },
    "market_fee",
    -fee,
    now,
  );
  return { saleEntry, feeEntry };
}

/** The figures a purchase's log line carries (economy.md §8.12). */
interface SaleRecord {
  sellerId: string;
  fee: number;
  buyerBalance: number;
  sellerBalance: number;
}

/**
 * The player market (economy.md §8.3 to §8.5): listing a card, cancelling,
 * buying, browsing, the caller's own view and the hourly expiry. Every path
 * that changes something locks account rows first (both, in id order, for
 * a purchase), then listing rows, then card rows, and writes every Karma
 * change through `postEntry` in the transaction of the cards it pays for.
 */
export class MarketService {
  constructor(private readonly db: Db) {}

  /** §8.3. `replayed` is true when `requestId` named a listing this account already made with the same body. */
  async list(
    log: MarketLog,
    sellerId: string,
    body: ListBody,
    clock: () => Date,
  ): Promise<{ replayed: boolean; listing: Listing }> {
    checkPrice(body.rarity, body.price);
    const { replayed, row, now } = await this.db.transaction(async (tx) => {
      await lockBalance(tx, sellerId);
      const now = clock();
      const [stored] = await tx
        .select(LISTING_COLUMNS)
        .from(marketListings)
        .where(and(eq(marketListings.sellerId, sellerId), eq(marketListings.requestId, body.requestId)));
      if (stored !== undefined) {
        if (!sameListingRequest(stored, body)) throw requestIdReused();
        return { replayed: true, row: stored, now };
      }

      await tx
        .update(marketListings)
        .set(EXPIRED)
        .where(and(eq(marketListings.sellerId, sellerId), lapsed(now)));
      if ((await liveListingCount(tx, sellerId, now)) >= MARKET_MAX_LISTINGS) {
        throw new ApiError(409, "listing_limit", `At most ${MARKET_MAX_LISTINGS} listings at a time`);
      }
      const copies = await tx
        .select({ id: cards.id, pulledAt: cards.pulledAt })
        .from(cards)
        .where(
          and(
            eq(cards.accountId, sellerId),
            eq(cards.characterId, body.characterId),
            eq(cards.rarity, body.rarity),
            eq(cards.variant, "standard"),
            isNull(cards.removedAt),
            isNull(cards.escrowId),
            sql`not exists (select 1 from ${marketListings} where ${marketListings.cardId} = ${cards.id} and ${marketListings.status} = 'active')`,
          ),
        )
        .for("update");
      // Newest first, as a recycle takes them, so the copy kept longest is the first one pulled.
      const [card] = copies.map((copy) => ({ ...copy, listed: false, escrowed: false })).sort(newestFirst);
      if (card === undefined) throw new ApiError(409, "not_enough_copies", "No unlisted copy of that card");

      const [inserted] = await tx
        .insert(marketListings)
        .values({
          sellerId,
          requestId: body.requestId,
          cardId: card.id,
          characterId: body.characterId,
          rarity: body.rarity,
          variant: "standard",
          price: body.price,
          fee: marketFee(body.price),
          status: "active",
          createdAt: now,
          expiresAt: expiryOf(now),
        })
        .returning(LISTING_COLUMNS);
      if (inserted === undefined) throw new Error("listing insert returned no row");
      return { replayed: false, row: inserted, now };
    });

    log.info(
      {
        listingId: row.id,
        sellerId,
        characterId: row.characterId,
        rarity: row.rarity,
        price: row.price,
        replayed,
      },
      "listed",
    );
    return { replayed, listing: await describeListing(this.db, row, sellerId, now) };
  }

  /**
   * §8.5, cancel: idempotent for a listing already closed without a sale,
   * and a lapsed one is closed as expired; a sold one cannot be cancelled.
   * Another account's listing is not found, so its existence is not revealed.
   */
  async cancel(log: MarketLog, accountId: string, listingId: string, clock: () => Date): Promise<Listing> {
    const { row, now, changed } = await this.db.transaction(async (tx) => {
      await lockBalance(tx, accountId);
      const now = clock();
      const [listing] = await tx
        .select(LISTING_COLUMNS)
        .from(marketListings)
        .where(and(eq(marketListings.id, listingId), eq(marketListings.sellerId, accountId)))
        .for("update");
      if (listing === undefined) throw listingNotFound();
      if (listing.status === "sold") throw listingUnavailable();
      if (listing.status !== "active") return { row: listing, now, changed: false };
      const [closed] = await tx
        .update(marketListings)
        .set(isLive(listing, now) ? { status: "cancelled", closedAt: now } : EXPIRED)
        .where(eq(marketListings.id, listing.id))
        .returning(LISTING_COLUMNS);
      if (closed === undefined) throw new Error("listing update returned no row");
      return { row: closed, now, changed: true };
    });

    if (changed) {
      log.info(
        {
          listingId: row.id,
          sellerId: row.sellerId,
          characterId: row.characterId,
          rarity: row.rarity,
          price: row.price,
          replayed: false,
        },
        row.status === "expired" ? "listing expired" : "listing cancelled",
      );
    }
    return describeListing(this.db, row, accountId, now);
  }

  /**
   * §8.5, buy, all or nothing in one transaction: both account rows locked
   * in id order, then the listing, then the card; the window limits; the
   * buyer's debit and the seller's sale and fee through `postEntry`; the
   * seller's card removed by the purchase and a new card for the buyer.
   */
  async buy(
    log: MarketLog,
    buyerId: string,
    listingId: string,
    body: BuyBody,
    clock: () => Date,
  ): Promise<{ replayed: boolean; receipt: PurchaseReceipt }> {
    const outcome = await this.db.transaction(
      async (tx): Promise<{ stored: StoredPurchase; sale: SaleRecord | null }> => {
        const early = await storedPurchase(tx, buyerId, body.requestId);
        if (early !== null) return { stored: replayOf(early, listingId), sale: null };

        const [target] = await tx
          .select({ sellerId: marketListings.sellerId })
          .from(marketListings)
          .where(eq(marketListings.id, listingId));
        if (target === undefined) throw listingNotFound();
        if (target.sellerId === buyerId) throw new ApiError(409, "own_listing", "That listing is your own");

        const locked = await tx
          .select({ id: accounts.id, balance: accounts.balance })
          .from(accounts)
          .where(inArray(accounts.id, [buyerId, target.sellerId]))
          .orderBy(asc(accounts.id))
          .for("update");
        const buyer = locked.find((row) => row.id === buyerId);
        const seller = locked.find((row) => row.id === target.sellerId);
        if (buyer === undefined) throw signedOut();
        // The seller's account went while this request waited, and its listings with it.
        if (seller === undefined) throw listingNotFound();
        const now = clock();
        const again = await storedPurchase(tx, buyerId, body.requestId);
        if (again !== null) return { stored: replayOf(again, listingId), sale: null };

        const [listing] = await tx
          .select(LISTING_COLUMNS)
          .from(marketListings)
          .where(eq(marketListings.id, listingId))
          .for("update");
        if (listing === undefined) throw listingNotFound();
        assertBuyable(listing, now);
        if (listing.cardId === null) throw new Error(`active listing ${listing.id} has no card`);
        const [card] = await tx
          .select({
            id: cards.id,
            accountId: cards.accountId,
            characterId: cards.characterId,
            rarity: cards.rarity,
            variant: cards.variant,
            snapshotId: cards.snapshotId,
            removedAt: cards.removedAt,
            escrowId: cards.escrowId,
          })
          .from(cards)
          .where(eq(cards.id, listing.cardId))
          .for("update");
        if (
          card?.accountId !== seller.id ||
          card.removedAt !== null ||
          card.escrowId !== null ||
          card.characterId !== listing.characterId ||
          card.rarity !== listing.rarity ||
          card.variant !== listing.variant
        ) {
          throw new Error(`listing ${listing.id}: its card is no longer the seller's to sell`);
        }

        const hit = firstLimitHit(
          {
            bought: await windowEntries(tx, buyer.id, "market_purchase", now),
            sold: await windowEntries(tx, seller.id, "market_sale", now),
            pair: await pairPurchases(tx, buyer.id, seller.id, now),
          },
          listing.price,
          now,
        );
        if (hit !== null) {
          log.warn(
            { listingId, buyerId, sellerId: seller.id, limit: hit.limit },
            "purchase refused by market_limit",
          );
          throw new ApiError(
            409,
            "market_limit",
            "A market limit for this week is reached",
            hit.retryAfterSeconds,
            undefined,
            hit.limit,
          );
        }

        const buyerEntry = await postEntry(tx, buyer, "market_purchase", -listing.price, now);
        // §8.5 step 7: what the seller keeps must fit; the buyer cannot resolve it.
        if (seller.balance + listing.price - listing.fee > MAX_BALANCE) throw listingUnavailable();
        const { saleEntry, feeEntry } = await postSale(tx, seller, listing.price, listing.fee, now);
        const [purchase] = await tx
          .insert(marketPurchases)
          .values({
            buyerId: buyer.id,
            requestId: body.requestId,
            listingId: listing.id,
            sellerId: seller.id,
            characterId: listing.characterId,
            rarity: listing.rarity,
            variant: listing.variant,
            price: listing.price,
            fee: listing.fee,
            buyerEntryId: buyerEntry.id,
            sellerSaleEntryId: saleEntry.id,
            sellerFeeEntryId: feeEntry.id,
            createdAt: now,
          })
          .returning({ id: marketPurchases.id });
        if (purchase === undefined) throw new Error("purchase insert returned no row");
        await tx
          .update(cards)
          .set({ removedAt: now, removedByPurchase: purchase.id })
          .where(eq(cards.id, card.id));
        const [held] = await tx
          .select({ id: cards.id })
          .from(cards)
          .where(
            and(
              eq(cards.accountId, buyer.id),
              eq(cards.characterId, card.characterId),
              isNull(cards.removedAt),
            ),
          )
          .limit(1);
        const isNew = held === undefined;
        await tx.insert(cards).values({
          accountId: buyer.id,
          purchaseId: purchase.id,
          characterId: card.characterId,
          rarity: card.rarity,
          variant: card.variant,
          snapshotId: card.snapshotId,
          isNew,
          pulledAt: now,
        });
        await tx
          .update(marketListings)
          .set({ status: "sold", closedAt: now })
          .where(eq(marketListings.id, listing.id));
        return {
          stored: {
            id: purchase.id,
            createdAt: now,
            listingId: listing.id,
            price: listing.price,
            characterId: card.characterId,
            rarity: card.rarity,
            variant: card.variant,
            isNew,
          },
          sale: {
            sellerId: seller.id,
            fee: listing.fee,
            buyerBalance: buyerEntry.balanceAfter,
            sellerBalance: feeEntry.balanceAfter,
          },
        };
      },
    );

    const { stored, sale } = outcome;
    log.info(
      {
        listingId,
        purchaseId: stored.id,
        buyerId,
        sellerId: sale?.sellerId,
        price: stored.price,
        fee: sale?.fee,
        buyerBalanceAfter: sale?.buyerBalance,
        sellerBalanceAfter: sale?.sellerBalance,
        replayed: sale === null,
      },
      "bought",
    );
    const balance = sale === null ? await balanceOf(this.db, buyerId) : sale.buyerBalance;
    const [receipt] = await this.receiptsOf([stored], balance);
    if (receipt === undefined) throw new Error(`purchase ${stored.id} was not described`);
    return { replayed: sale === null, receipt };
  }

  private async receiptsOf(stored: readonly StoredPurchase[], balance: number): Promise<PurchaseReceipt[]> {
    const snapshot = await currentSnapshot(this.db);
    const described = await describeCharacters(
      this.db,
      stored.map((purchase) => purchase.characterId),
      snapshot?.id ?? null,
    );
    const refs = new Map(
      (await orderedFranchiseRefs(this.db, [...described.franchiseIds])).map((ref) => [ref.id, ref]),
    );
    return stored.map((purchase) => {
      const character = described.characters.get(purchase.characterId);
      if (character === undefined) throw new Error(`purchase ${purchase.id}: its character is missing`);
      return {
        purchaseId: purchase.id,
        boughtAt: purchase.createdAt.toISOString(),
        listingId: purchase.listingId,
        price: purchase.price,
        card: {
          kind: "card",
          character,
          rarity: purchase.rarity,
          variant: purchase.variant,
          // An owner reset deletes the card a purchase delivered; its receipt then reports it as not new.
          isNew: purchase.isNew ?? false,
        },
        franchises: character.franchiseIds.flatMap((id) => {
          const ref = refs.get(id);
          return ref === undefined ? [] : [ref];
        }),
        balance,
      };
    });
  }

  /** §8.4: a page of live listings of every account, filtered, searched and sorted, keyset-paged on (sort key, id). */
  async browse(viewerId: string, query: ListingsQuery, now: Date): Promise<ListingsPage> {
    const sort = query.sort ?? "price_asc";
    const position = query.cursor === undefined ? null : decodeCursor(query.cursor, sort);
    const characterId = queryId(query.characterId, "characterId");
    const franchiseId = queryId(query.franchiseId, "franchiseId");
    const snapshot = await currentSnapshot(this.db);
    const current = snapshot?.id ?? 0;

    const conditions = [sql`l.status = 'active'`, sql`l.expires_at > ${now}`];
    if (query.rarity !== undefined) conditions.push(sql`l.rarity = ${query.rarity}`);
    if (characterId !== null) conditions.push(sql`l.character_id = ${characterId}`);
    if (franchiseId !== null) {
      conditions.push(
        sql`exists (select 1 from character_franchises cf where cf.character_id = l.character_id and cf.franchise_id = ${franchiseId})`,
      );
    }
    for (const pattern of searchPatterns(query.q)) conditions.push(matchesTerm(pattern));
    if (position !== null) conditions.push(afterCursor(position));

    const result = await this.db.execute<RawListing>(sql`
      with ${characterFranchises(now, current)}
      select l.id, l.seller_id as "sellerId", l.card_id as "cardId", l.character_id as "characterId",
             l.rarity, l.variant, l.price, l.fee, l.status, l.created_at as "createdAt",
             l.expires_at as "expiresAt", l.closed_at as "closedAt"
      from market_listings l
      join characters c on c.id = l.character_id
      where ${sql.join(conditions, sql` and `)}
      order by ${ORDER_BY[sort]}
      limit ${MARKET_PAGE_SIZE + 1}
    `);
    const rows = result.rows.map(listingRowOf);
    const page = rows.slice(0, MARKET_PAGE_SIZE);
    const last = page.at(-1);
    const nextCursor =
      rows.length > MARKET_PAGE_SIZE && last !== undefined ? encodeCursor(positionOf(sort, last)) : null;

    const filterFranchiseIds = position === null ? await this.marketFranchises(now, current) : null;
    const { listings, franchiseIds } = await describeListings(this.db, page, viewerId, now);
    return {
      listings: listings.map(withoutProceeds),
      filterFranchiseIds,
      franchises: await orderedFranchiseRefs(this.db, [
        ...new Set([...(filterFranchiseIds ?? []), ...franchiseIds]),
      ]),
      nextCursor,
    };
  }

  /** Every franchise with a live listing, in the current snapshot's popularity order, then by id (§8.4). */
  private async marketFranchises(now: Date, current: number): Promise<number[]> {
    const result = await this.db.execute<{ franchiseId: number }>(sql`
      with ${characterFranchises(now, current)}
      select cf.franchise_id as "franchiseId"
      from character_franchises cf
      left join pool_snapshot_franchises f on f.snapshot_id = ${current} and f.franchise_id = cf.franchise_id
      group by cf.franchise_id, f.popularity_rank
      order by f.popularity_rank nulls last, cf.franchise_id
    `);
    return result.rows.map((row) => row.franchiseId);
  }

  /** §8.4, `GET /api/market/mine`: live listings, those closed in the last 30 days, purchases, and the window's room. */
  async mine(accountId: string, now: Date): Promise<MarketMine> {
    const since = new Date(now.getTime() - MINE_HISTORY_MS);
    const rows = await this.db
      .select(LISTING_COLUMNS)
      .from(marketListings)
      .where(
        and(
          eq(marketListings.sellerId, accountId),
          or(
            liveListing(now),
            and(eq(marketListings.status, "active"), gte(marketListings.expiresAt, since)),
            gte(marketListings.closedAt, since),
          ),
        ),
      )
      .orderBy(desc(marketListings.createdAt), desc(marketListings.id));
    const { listings, franchiseIds } = await describeListings(this.db, rows, accountId, now);
    const active = listings.filter((listing) => listing.status === "active").map(withoutProceeds);
    const closed = listings
      .filter((listing) => listing.status !== "active")
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));

    const purchases = await this.db
      .select(STORED_PURCHASE_COLUMNS)
      .from(marketPurchases)
      .leftJoin(cards, eq(cards.purchaseId, marketPurchases.id))
      .where(and(eq(marketPurchases.buyerId, accountId), gte(marketPurchases.createdAt, since)))
      .orderBy(desc(marketPurchases.createdAt), desc(marketPurchases.id));
    const receipts = await this.receiptsOf(purchases, await balanceOf(this.db, accountId));
    const named = new Set([
      ...franchiseIds,
      ...receipts.flatMap((receipt) => receipt.card.character.franchiseIds),
    ]);
    return {
      active,
      closed,
      purchases: receipts,
      left: windowLeft(
        await windowEntries(this.db, accountId, "market_purchase", now),
        await windowEntries(this.db, accountId, "market_sale", now),
      ),
      franchises: await orderedFranchiseRefs(this.db, [...named]),
    };
  }

  /**
   * The hourly purge (§8.5): every lapsed listing marked expired, closed at
   * its expiry. Listing rows only, and no account lock, so it cannot
   * deadlock with a purchase, which takes the accounts first.
   */
  async expireLapsed(log: MarketLog, now: Date): Promise<number> {
    const expired = await this.db
      .update(marketListings)
      .set(EXPIRED)
      .where(lapsed(now))
      .returning(LISTING_COLUMNS);
    for (const row of expired) {
      log.info(
        {
          listingId: row.id,
          sellerId: row.sellerId,
          characterId: row.characterId,
          rarity: row.rarity,
          price: row.price,
          replayed: false,
        },
        "listing expired",
      );
    }
    return expired.length;
  }
}

/** A listing row as a raw query returns it: timestamps as Postgres's text. */
type RawListing = Omit<ListingRow, "createdAt" | "expiresAt" | "closedAt"> & {
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
};

function listingRowOf(row: RawListing): ListingRow {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    closedAt: row.closedAt === null ? null : new Date(row.closedAt),
  };
}

/**
 * Each character with a live listing and the franchises of its placement
 * snapshot: the current one if it holds the character, else the newest that
 * did, as `describeCharacters` places it (§8.4: "current or last snapshot").
 */
function characterFranchises(now: Date, current: number) {
  return sql`character_franchises as (
    select p.character_id, s.franchise_id
    from (
      select distinct on (psc.character_id) psc.character_id, psc.snapshot_id
      from pool_snapshot_characters psc
      where psc.character_id in (
        select character_id from market_listings where status = 'active' and expires_at > ${now}
      )
      order by psc.character_id, (psc.snapshot_id = ${current}) desc, psc.snapshot_id desc
    ) p
    join pool_snapshot_memberships m on m.snapshot_id = p.snapshot_id and m.character_id = p.character_id
    join pool_snapshot_series s on s.snapshot_id = m.snapshot_id and s.series_id = m.series_id
  )`;
}

/**
 * One search term (§8.4, collection-overview.md §3.3): a substring of the
 * character's name or native name, or of the title or native title of one
 * of its franchises, as their anchor entries name them, which is what the
 * collection's search matches too (manager decision, 2026-10-30).
 */
function matchesTerm(pattern: string) {
  return sql`(
    c.search_name like ${pattern} escape ${LIKE_ESCAPE}
    or c.search_name_native like ${pattern} escape ${LIKE_ESCAPE}
    or exists (
      select 1 from character_franchises cf join series f on f.id = cf.franchise_id
      where cf.character_id = l.character_id
        and (f.search_title like ${pattern} escape ${LIKE_ESCAPE}
             or f.search_title_native like ${pattern} escape ${LIKE_ESCAPE})
    )
  )`;
}

const ORDER_BY = {
  price_asc: sql`l.price asc, l.id asc`,
  price_desc: sql`l.price desc, l.id desc`,
  newest: sql`l.created_at desc, l.id desc`,
} as const satisfies Record<ListingSort, unknown>;

function afterCursor(position: CursorPosition) {
  if (position.sort === "newest")
    return sql`(l.created_at, l.id) < (${position.listedAt}, ${position.id}::uuid)`;
  if (position.sort === "price_asc") return sql`(l.price, l.id) > (${position.price}, ${position.id}::uuid)`;
  return sql`(l.price, l.id) < (${position.price}, ${position.id}::uuid)`;
}

function positionOf(sort: ListingSort, row: ListingRow): CursorPosition {
  if (sort === "newest") return { sort, listedAt: row.createdAt, id: row.id };
  return { sort, price: row.price, id: row.id };
}
