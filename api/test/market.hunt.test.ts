import { randomUUID } from "node:crypto";
import type { Listing, ListingsPage, MarketMine, PurchaseReceipt } from "@anime-tcg/shared/api";
import {
  MARKET_LISTING_TTL_SECONDS,
  MARKET_PRICE_MAX,
  MARKET_PRICE_MIN,
  MARKET_WINDOW_PAIR,
  MARKET_WINDOW_PROCEEDS,
  MARKET_WINDOW_SECONDS,
  MARKET_WINDOW_SPEND,
  MAX_BALANCE,
  MAX_ENTRY_AMOUNT,
  RECYCLE_VALUE,
} from "@anime-tcg/shared/economy";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { main as auditMarket } from "../src/cli/audit-market.js";
import { cards, marketListings, marketPurchases } from "../src/db/schema.js";
import { resetCollection } from "../src/domain/collection/reset.js";
import { auditLedger } from "../src/domain/economy/audit.js";
import { encodeCursor } from "../src/domain/market/cursor.js";
import {
  balanceOf,
  entryOf,
  expectClockBehindDatabase,
  expectLedgerConsistent,
  forgeBalance,
  ID,
  ledgerOf,
  pastClockStart,
  recycle,
  recycleBody,
} from "./economy-support.js";
import {
  BACKSLASH,
  bought,
  browse,
  buyListing,
  cancelListing,
  copies,
  fund,
  grantCards,
  heldCopies,
  listCard,
  listed,
  marketErrorOf,
  marketPool,
  mine,
  page,
  patientDb,
  PERCENT,
  POKEMON,
  seedListings,
  UNDERSCORE,
} from "./market-support.js";
import {
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  loadSnapshot,
  newPlayer,
} from "./pool-support.js";
import { createTestApp, send, type SignedInClient, testConfig, testDatabaseUrl } from "./support.js";

/**
 * Tester's hunt over the market server (economy.md §7, §8.3 to §8.10, §10,
 * §13; PR 3, T3), after the engineer's `market.test.ts` and
 * `market.security.test.ts`. Test plan, by what the engineer's suites leave open:
 *
 * Races (parallel `inject()` against one database)
 * - five buyers of one listing: exactly one wins, the seller is credited once;
 * - a buy racing the seller's recycle of the same entry: the buy always wins
 *   (a listed card is not recyclable) and the recycle sees the buy's result;
 * - a buy racing an owner reset of the seller, and of the buyer: either order
 *   is whole, and `audit-ledger` explains what the reset deleted;
 * - a buy racing the hourly expiry sweep one millisecond before expiry:
 *   exactly one of sold and expired;
 * - one card listed twice in parallel, and two copies three times;
 * - a three-way cycle A buys B, B buys C, C buys A, in parallel (lock order).
 * Ledger and audit
 * - a seeded mixed burst of list, buy and cancel over four accounts: Karma
 *   falls by exactly the fees, cards are conserved, both audits are clean;
 * - the fee at boundary prices of every tier through the route, and the
 *   seller's net;
 * - the seller's sale-or-fee-first switch at MAX_BALANCE − price, and the
 *   refusal one above MAX_BALANCE − net;
 * - a buyer with exactly the price.
 * Limits (fake clock, millisecond edges)
 * - buyer_spend at and above the bound, `retryAfterSeconds` when the oldest
 *   row frees the excess and when it takes two rows, the order of limits when
 *   buyer_spend and pair are both hit, and the rolling edge at ±1 ms;
 * - seller_proceeds with its `retryAfterSeconds` and its rolling edge;
 * - the pair limit counted per direction: A → B full does not stop B → A.
 * Cards
 * - the last copy listed, sold and resold: removed for each seller, a new row
 *   for each buyer with the same character, rarity, variant and snapshot; the
 *   seller cannot list or recycle what it sold; a reset of the middle account;
 * - a lapsed but unswept listing frees its card for `available` and recycling.
 * Least privilege
 * - the app role cannot DELETE a card; `delete_bought_cards` refuses while
 *   the account has an active listing (0007), exactly what it then lets it
 *   do to another account, and that `audit-ledger` sees a stray call;
 *   PUBLIC has no EXECUTE; a temp table named `cards` does not redirect it;
 * - the app role cannot null `removed_by_purchase` on a sold card while its
 *   purchase exists (0008); the foreign key's set null after the buyer's
 *   account is deleted still passes.
 * Search and exposure
 * - fullwidth `％`, `＿` and `＼` fold to the LIKE specials under NFKC and must
 *   still match as text;
 * - no answer to one account names another account's login or id.
 * Browse input outside Postgres's ranges (found as 500s, fixed in #53)
 * - a cursor whose price key is beyond a Postgres integer or MAX_ENTRY_AMOUNT,
 *   a newest cursor outside the epoch to year 9999, and `q` holding a control
 *   character, U+0000 included, are each 400 `validation_failed`, never 500.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WINDOW_MS = MARKET_WINDOW_SECONDS * SECOND;
const TTL_MS = MARKET_LISTING_TTL_SECONDS * SECOND;
const HEAVY_MS = 120_000;
const PERMISSION_DENIED = "42501";

/** economy.md §5: the fee, written independently of `marketFee`: 5 % rounded up, at least 1. */
const feeOf = (price: number) => Math.max(1, Math.floor((price * 500 + 9_999) / 10_000));

describe("market hunt (tester, economy.md PR 3)", () => {
  let app: App;
  // Far enough behind the database's clock for the three week-long windows this file waits out.
  let now = new Date(pastClockStart().getTime() - 40 * DAY);
  const made: string[] = [];
  const forged: string[] = [];
  const snapshots: number[] = [];
  let snapshotId = 0;

  const tick = (ms = SECOND) => {
    now = new Date(now.getTime() + ms);
  };
  const player = async () => {
    const client = await newPlayer(app, "mh");
    made.push(client.account.id);
    return client;
  };
  const holding = async (ids: readonly number[]) => {
    const client = await player();
    await grantCards(app, client.account.id, snapshotId, ids, now);
    return client;
  };
  const funded = async (karma: number, ids: readonly number[] = []) => {
    const client = await holding(ids);
    await fund(app, client, snapshotId, karma, now);
    return client;
  };
  const statuses = (results: readonly LightMyRequestResponse[]) => results.map((res) => res.statusCode);
  const listingRow = async (listingId: string) => {
    const [row] = await app.db
      .select({
        status: marketListings.status,
        cardId: marketListings.cardId,
        closedAt: marketListings.closedAt,
      })
      .from(marketListings)
      .where(eq(marketListings.id, listingId));
    return row;
  };
  const purchasesOf = (listingId: string) =>
    app.db.select().from(marketPurchases).where(eq(marketPurchases.listingId, listingId));
  const cardRow = async (cardId: string) => {
    const [row] = await app.db.select().from(cards).where(eq(cards.id, cardId));
    return row;
  };
  const allCardsOf = (accountId: string) => app.db.select().from(cards).where(eq(cards.accountId, accountId));
  const reset = (client: SignedInClient, keepKarma: boolean) =>
    resetCollection(app.db, client.account.login, { confirm: true, keepKarma, clock: () => now });

  beforeAll(async () => {
    app = await createTestApp({
      config: testConfig({ ACCOUNT_CAP: "1000" }),
      db: patientDb(),
      clock: () => now,
    });
    const current = await currentSnapshotId(app.db);
    if (current !== null) throw new Error(`snapshot ${current} is current; a previous run left it behind`);
    snapshotId = (await loadSnapshot(app.db, marketPool(), now)).version;
    snapshots.push(snapshotId);
  });
  afterAll(async () => {
    try {
      expectClockBehindDatabase(now);
      await expectLedgerConsistent(app, forged);
    } finally {
      await deleteAccounts(app.db, made);
      await deleteSnapshots(snapshots);
      await app.close();
    }
  });

  describe("two-account races", () => {
    it("five buyers of one listing: exactly one 201, four listing_unavailable, the seller credited once", async () => {
      const seller = await holding([ID.legendary(3)]);
      const buyers = await Promise.all([0, 1, 2, 3, 4].map(() => funded(MARKET_PRICE_MAX.legendary)));
      const listing = await listed(app, seller, ID.legendary(3), MARKET_PRICE_MAX.legendary);
      const results = await Promise.all(
        buyers.map((buyer) => buyListing(app, buyer.cookie, listing.listingId)),
      );
      expect(statuses(results).sort()).toEqual([201, 409, 409, 409, 409]);
      for (const res of results.filter((r) => r.statusCode === 409))
        expect(marketErrorOf(res).code).toBe("listing_unavailable");
      expect(await purchasesOf(listing.listingId)).toHaveLength(1);
      expect(await ledgerOf(app, seller.account.id)).toHaveLength(2);
      const balances = await Promise.all(buyers.map((buyer) => balanceOf(app, buyer.account.id)));
      const start = 1 * RECYCLE_VALUE.mythic;
      expect(balances.filter((b) => b === start - MARKET_PRICE_MAX.legendary)).toHaveLength(1);
      expect(balances.filter((b) => b === start)).toHaveLength(4);
    });

    it(
      "a buy racing the seller's recycle of the same entry: the buy always wins, the recycle sees its result",
      { timeout: HEAVY_MS },
      async () => {
        for (let round = 0; round < 5; round += 1) {
          const seller = await holding(copies(ID.uncommon(3), 3));
          const buyer = await funded(100);
          const listing = await listed(app, seller, ID.uncommon(3), 20);
          const [buy, recycled] = await Promise.all([
            buyListing(app, buyer.cookie, listing.listingId),
            recycle(app, seller.cookie, recycleBody(ID.uncommon(3), "uncommon", 2)),
          ]);
          expect(buy.statusCode, buy.body).toBe(201);
          const held = await heldCopies(app, seller.account.id, ID.uncommon(3));
          if (recycled.statusCode === 201) {
            // The recycle ran first: it took the two unlisted copies and kept the listed one, which then sold.
            expect(held).toHaveLength(0);
          } else {
            // The buy ran first: two held, one may go (never the last).
            expect(marketErrorOf(recycled).code).toBe("not_enough_copies");
            expect(held).toHaveLength(2);
          }
          const [purchase] = await purchasesOf(listing.listingId);
          const sold = await app.db
            .select()
            .from(cards)
            .where(eq(cards.removedByPurchase, purchase?.id ?? ""));
          expect(sold).toHaveLength(1);
          expect(sold[0]?.removedByRecycle).toBeNull();
        }
      },
    );

    it(
      "a buy racing an owner reset of the seller: either the sale or the cancellation, whole",
      { timeout: HEAVY_MS },
      async () => {
        for (let round = 0; round < 4; round += 1) {
          const seller = await holding([ID.rare(1)]);
          const buyer = await funded(100);
          const listing = await listed(app, seller, ID.rare(1), 30);
          tick();
          const [buy] = await Promise.all([
            buyListing(app, buyer.cookie, listing.listingId),
            reset(seller, round % 2 === 0),
          ]);
          const row = await listingRow(listing.listingId);
          expect(await allCardsOf(seller.account.id)).toEqual([]);
          if (buy.statusCode === 201) {
            expect(row?.status).toBe("sold");
            expect(await purchasesOf(listing.listingId)).toHaveLength(1);
            expect(await heldCopies(app, buyer.account.id, ID.rare(1))).toHaveLength(1);
          } else {
            expect(marketErrorOf(buy).code).toBe("listing_unavailable");
            expect(row?.status).toBe("cancelled");
            expect(await purchasesOf(listing.listingId)).toEqual([]);
            expect(await balanceOf(app, buyer.account.id)).toBe(RECYCLE_VALUE.mythic);
          }
        }
        await expectLedgerConsistent(app, forged.splice(0));
      },
    );

    it(
      "a buy racing an owner reset of the buyer: either order is whole and the ledger explains it",
      { timeout: HEAVY_MS },
      async () => {
        for (let round = 0; round < 4; round += 1) {
          const seller = await holding([ID.rare(2)]);
          const buyer = await funded(100);
          const listing = await listed(app, seller, ID.rare(2), 30);
          tick();
          const keepKarma = round % 2 === 1;
          const [buy] = await Promise.all([
            buyListing(app, buyer.cookie, listing.listingId),
            reset(buyer, keepKarma),
          ]);
          const sold = (await listingRow(listing.listingId))?.status === "sold";
          expect(sold).toBe(buy.statusCode === 201);
          if (buy.statusCode !== 201) {
            // Only a reset that zeroed the balance first can stop the buy.
            expect(keepKarma).toBe(false);
            expect(marketErrorOf(buy)).toMatchObject({ code: "insufficient_funds", balance: 0 });
          }
          expect(await purchasesOf(listing.listingId)).toHaveLength(sold ? 1 : 0);
          expect(await heldCopies(app, seller.account.id, ID.rare(2))).toHaveLength(sold ? 0 : 1);
        }
        await expectLedgerConsistent(app, forged.splice(0));
      },
    );

    it(
      "a buy racing the expiry sweep one millisecond before expiry: exactly one of sold and expired",
      { timeout: HEAVY_MS },
      async () => {
        for (let round = 0; round < 6; round += 1) {
          const seller = await holding([ID.rare(3)]);
          const buyer = await funded(100);
          // Listed a week less a millisecond ago: live now, lapsed at now + 1 ms.
          const [seeded] = await seedListings(
            app,
            seller,
            ID.rare(3),
            30,
            1,
            new Date(now.getTime() - TTL_MS + 1),
          );
          if (seeded === undefined) throw new Error("one listing");
          const expiry = new Date(now.getTime() + 1);
          const [buy, swept] = await Promise.all([
            buyListing(app, buyer.cookie, seeded.listingId),
            app.market.expireLapsed(app.log, expiry),
          ]);
          const row = await listingRow(seeded.listingId);
          if (buy.statusCode === 201) {
            expect(row?.status).toBe("sold");
            expect(await purchasesOf(seeded.listingId)).toHaveLength(1);
          } else {
            expect(marketErrorOf(buy).code).toBe("listing_unavailable");
            expect(row).toMatchObject({ status: "expired", closedAt: expiry });
            expect(swept).toBeGreaterThanOrEqual(1);
            expect(await purchasesOf(seeded.listingId)).toEqual([]);
            expect(await balanceOf(app, buyer.account.id)).toBe(RECYCLE_VALUE.mythic);
          }
          tick();
        }
      },
    );

    it("one card listed twice in parallel is one listing; two copies listed three times are two, on different cards", async () => {
      const single = await holding([ID.epic(1)]);
      const once = await Promise.all([0, 1].map(() => listCard(app, single.cookie, ID.epic(1), 100)));
      expect(statuses(once).sort()).toEqual([201, 409]);
      expect(marketErrorOf(once.find((res) => res.statusCode === 409) as LightMyRequestResponse).code).toBe(
        "not_enough_copies",
      );
      const pair = await holding(copies(ID.epic(2), 2));
      const thrice = await Promise.all([0, 1, 2].map(() => listCard(app, pair.cookie, ID.epic(2), 100)));
      expect(statuses(thrice).sort()).toEqual([201, 201, 409]);
      const live = await app.db
        .select({ cardId: marketListings.cardId })
        .from(marketListings)
        .where(and(eq(marketListings.sellerId, pair.account.id), eq(marketListings.status, "active")));
      expect(new Set(live.map((row) => row.cardId)).size).toBe(2);
      expect(await entryOf(app, pair.cookie, ID.epic(2))).toMatchObject({
        count: 2,
        listed: 2,
        available: 0,
      });
    });

    it(
      "a three-way cycle, A buys from B, B from C and C from A, ten times each in parallel: no deadlock",
      { timeout: HEAVY_MS },
      async () => {
        const ids = [ID.common(10), ID.common(11), ID.common(12)];
        const clients = await Promise.all(ids.map((id) => funded(100, copies(id, 10))));
        const listings = await Promise.all(
          clients.map((client, index) => seedListings(app, client, ids[index] as number, 5, 10, now)),
        );
        const results = await Promise.all(
          clients.flatMap((buyer, index) =>
            (listings[(index + 1) % 3] ?? []).map((listing) =>
              buyListing(app, buyer.cookie, listing.listingId),
            ),
          ),
        );
        expect(statuses(results)).toEqual(results.map(() => 201));
        for (const client of clients) {
          // Bought ten at 5, sold ten at 5 less the fee of 1 each.
          expect(await balanceOf(app, client.account.id)).toBe(RECYCLE_VALUE.mythic - 10);
        }
      },
    );
  });

  describe("ledger and audit", () => {
    it(
      "a seeded mixed burst of list, buy and cancel over four accounts: Karma falls by the fees, cards are conserved, both audits clean",
      { timeout: HEAVY_MS },
      async () => {
        let seed = 20_261_030;
        const random = (n: number) => {
          seed = (seed * 48_271) % 2_147_483_647;
          return seed % n;
        };
        const entries = [0, 1, 2, 3].map((i) => ID.common(20 + i));
        const clients = await Promise.all(entries.map((id) => funded(200, copies(id, 12))));
        const ids = clients.map((client) => client.account.id);
        const karma = async () =>
          (await Promise.all(ids.map((id) => balanceOf(app, id)))).reduce((sum, b) => sum + b, 0);
        const heldTotal = async () =>
          (
            await app.db
              .select({ id: cards.id })
              .from(cards)
              .where(and(inArray(cards.accountId, ids), isNull(cards.removedAt)))
          ).length;
        const karmaBefore = await karma();
        const heldBefore = await heldTotal();

        for (let wave = 0; wave < 3; wave += 1) {
          tick(MINUTE);
          const lists = await Promise.all(
            clients.flatMap((client, i) =>
              [0, 1, 2].map(() =>
                listCard(app, client.cookie, entries[i] as number, MARKET_PRICE_MIN.common + random(21)),
              ),
            ),
          );
          const open = lists.filter((res) => res.statusCode === 201).map((res) => res.json<Listing>());
          if (open.length === 0)
            throw new Error(lists.map((res) => `${res.statusCode} ${res.body}`).join(" | "));
          const sellerOf = (listing: Listing) =>
            clients.findIndex((_, i) => listing.character.id === entries[i]);
          const burst: Promise<LightMyRequestResponse>[] = [];
          for (const listing of open) {
            const seller = sellerOf(listing);
            const action = random(4);
            const other = (seller + 1 + random(3)) % 4;
            const buyer = clients[other] as SignedInClient;
            if (action === 0) {
              burst.push(cancelListing(app, (clients[seller] as SignedInClient).cookie, listing.listingId));
            } else if (action === 1) {
              // Two buyers at once, or a buy and the seller's cancel.
              const rival = clients[(other + 1 + random(2)) % 4] as SignedInClient;
              burst.push(buyListing(app, buyer.cookie, listing.listingId));
              burst.push(
                rival === clients[seller]
                  ? cancelListing(app, rival.cookie, listing.listingId)
                  : buyListing(app, rival.cookie, listing.listingId),
              );
            } else {
              burst.push(buyListing(app, buyer.cookie, listing.listingId));
            }
          }
          for (const [i, client] of clients.entries())
            burst.push(listCard(app, client.cookie, entries[i] as number, MARKET_PRICE_MAX.common));
          for (const res of await Promise.all(burst)) {
            expect([200, 201, 409], res.body).toContain(res.statusCode);
            if (res.statusCode === 409)
              expect(["listing_unavailable", "not_enough_copies"]).toContain(marketErrorOf(res).code);
          }
        }

        const purchases = await app.db
          .select({ listingId: marketPurchases.listingId, fee: marketPurchases.fee })
          .from(marketPurchases)
          .where(inArray(marketPurchases.buyerId, ids));
        expect(purchases.length).toBeGreaterThan(10);
        const fees = purchases.reduce((sum, purchase) => sum + purchase.fee, 0);
        expect(await karma()).toBe(karmaBefore - fees);
        expect(await heldTotal()).toBe(heldBefore);
        const sold = await app.db
          .select({ id: marketListings.id })
          .from(marketListings)
          .where(and(inArray(marketListings.sellerId, ids), eq(marketListings.status, "sold")));
        expect(new Set(purchases.map((purchase) => purchase.listingId))).toEqual(
          new Set(sold.map((row) => row.id)),
        );
        expect(sold).toHaveLength(purchases.length);

        const audit = await auditLedger(app.db);
        expect(audit.failures.filter((failure) => ids.includes(failure.id))).toEqual([]);
        const lines: string[] = [];
        const code = await auditMarket([], testDatabaseUrl(), {
          stdout: { write: (text: string) => lines.push(text) },
          stderr: { write: (text: string) => lines.push(`stderr: ${text}`) },
          clock: () => now,
        });
        expect(code, lines.join("")).toBe(0);
        expect(lines.join("")).not.toContain("stderr:");
      },
    );

    it("fixes the fee at every boundary price through the route, and pays the seller the price less it", async () => {
      const prices: [number, number][] = [
        [ID.common(30), 5],
        [ID.common(31), 20],
        [ID.common(32), 21],
        [ID.common(33), 25],
        [ID.uncommon(30), 12],
        [ID.uncommon(31), 40],
        [ID.uncommon(32), 41],
        [ID.uncommon(33), 57],
        [ID.rare(30), 18],
        [ID.rare(31), 60],
        [ID.rare(32), 61],
        [ID.rare(33), 87],
        [ID.epic(30), 80],
        [ID.epic(31), 400],
        [ID.legendary(30), 500],
        [ID.legendary(31), 2_500],
        [ID.mythic(1), 5_500],
        [ID.mythic(2), 27_481],
        [ID.mythic(3), 27_500],
      ];
      const seller = await holding(prices.map(([id]) => id));
      const listings: Listing[] = [];
      for (const [id, price] of prices) {
        const listing = await listed(app, seller, id, price);
        expect(listing.fee, `fee at ${price}`).toBe(feeOf(price));
        expect(listing.fee).toBeGreaterThanOrEqual(1);
        expect(listing.fee).toBeLessThanOrEqual(price);
        listings.push(listing);
      }
      expect(listings.map((listing) => listing.fee)).toEqual([
        1, 1, 2, 2, 1, 2, 3, 3, 1, 3, 4, 5, 4, 20, 25, 125, 275, 1_375, 1_375,
      ]);
      // 27 481 + 5 stays inside the pair limit of one buyer and one seller.
      const buyer = await funded(27_481 + 5);
      for (const index of [17, 0]) {
        const listing = listings[index] as Listing;
        await bought(app, buyer, listing.listingId);
        expect((await ledgerOf(app, seller.account.id)).slice(-2)).toMatchObject([
          { kind: "market_sale", amount: listing.price },
          { kind: "market_fee", amount: -feeOf(listing.price) },
        ]);
      }
      expect(await balanceOf(app, seller.account.id)).toBe(27_481 - 1_375 + 5 - 1);
    });

    it("posts the sale first at exactly MAX_BALANCE − price, the fee first one above, and refuses one above MAX_BALANCE − net", async () => {
      const price = MARKET_PRICE_MAX.rare;
      const fee = feeOf(price);
      const buyer = await funded(3 * price);
      const start = await balanceOf(app, buyer.account.id);
      const sellerAt = async (balance: number, id: number) => {
        const seller = await holding([id]);
        forged.push(seller.account.id);
        await forgeBalance(app, seller.account.id, balance);
        return { seller, listing: await listed(app, seller, id, price) };
      };

      const exact = await sellerAt(MAX_BALANCE - price, ID.rare(40));
      await bought(app, buyer, exact.listing.listingId);
      expect((await ledgerOf(app, exact.seller.account.id)).slice(-2)).toEqual([
        { seq: 2, kind: "market_sale", amount: price, balanceAfter: MAX_BALANCE },
        { seq: 3, kind: "market_fee", amount: -fee, balanceAfter: MAX_BALANCE - fee },
      ]);

      const above = await sellerAt(MAX_BALANCE - price + 1, ID.rare(41));
      await bought(app, buyer, above.listing.listingId);
      expect((await ledgerOf(app, above.seller.account.id)).slice(-2)).toEqual([
        { seq: 2, kind: "market_fee", amount: -fee, balanceAfter: MAX_BALANCE - price + 1 - fee },
        { seq: 3, kind: "market_sale", amount: price, balanceAfter: MAX_BALANCE + 1 - fee },
      ]);

      const over = await sellerAt(MAX_BALANCE - (price - fee) + 1, ID.rare(42));
      const res = await buyListing(app, buyer.cookie, over.listing.listingId);
      expect(res.statusCode).toBe(409);
      expect(marketErrorOf(res).code).toBe("listing_unavailable");
      expect(await balanceOf(app, over.seller.account.id)).toBe(MAX_BALANCE - (price - fee) + 1);
      expect(await ledgerOf(app, over.seller.account.id)).toHaveLength(1);
      expect(await purchasesOf(over.listing.listingId)).toEqual([]);
      expect(await listingRow(over.listing.listingId)).toMatchObject({ status: "active" });
      expect(await heldCopies(app, over.seller.account.id, ID.rare(42))).toHaveLength(1);
      expect(await balanceOf(app, buyer.account.id)).toBe(start - 2 * price);
    });

    it("lets a buyer with exactly the price buy, to a balance of 0", async () => {
      const seller = await holding([ID.mythic(4)]);
      const buyer = await funded(MARKET_PRICE_MIN.mythic);
      expect(await balanceOf(app, buyer.account.id)).toBe(MARKET_PRICE_MIN.mythic);
      const receipt = await bought(
        app,
        buyer,
        (await listed(app, seller, ID.mythic(4), MARKET_PRICE_MIN.mythic)).listingId,
      );
      expect(receipt.balance).toBe(0);
      expect((await ledgerOf(app, buyer.account.id)).at(-1)).toMatchObject({
        kind: "market_purchase",
        amount: -MARKET_PRICE_MIN.mythic,
        balanceAfter: 0,
      });
    });
  });

  describe("window limits on a fake clock (economy.md §10, M3)", () => {
    const limitOf = (res: LightMyRequestResponse) => {
      expect(res.statusCode, res.body).toBe(409);
      return marketErrorOf(res);
    };
    const secondsUntil = (at: number) => Math.ceil((at - now.getTime()) / SECOND);

    it(
      "buyer_spend: exactly at the bound passes; above it waits for the oldest rows that free the excess, to the millisecond",
      { timeout: HEAVY_MS },
      async () => {
        const s1 = await holding([ID.mythic(5), ID.common(40)]);
        const s2 = await holding([ID.mythic(6)]);
        const s3 = await holding([ID.legendary(5)]);
        const s4 = await holding([ID.legendary(6), ID.common(41)]);
        const buyer = await funded(MARKET_WINDOW_SPEND + 1_000);
        const start = await balanceOf(app, buyer.account.id);
        const t0 = now.getTime();
        await bought(app, buyer, (await listed(app, s3, ID.legendary(5), 500)).listingId);
        now = new Date(t0 + HOUR);
        await bought(app, buyer, (await listed(app, s1, ID.mythic(5), 27_500)).listingId);
        now = new Date(t0 + 2 * HOUR);
        // 500 + 27 500 + 27 000 = 55 000: exactly at the bound.
        await bought(app, buyer, (await listed(app, s2, ID.mythic(6), 27_000)).listingId);
        expect((await mine(app, buyer.cookie)).left.spend).toBe(0);

        now = new Date(t0 + 3 * HOUR);
        const cheap = await listed(app, s4, ID.common(41), 5);
        const dear = await listed(app, s4, ID.legendary(6), 501);
        const pairToo = await listed(app, s1, ID.common(40), 5);
        // 5 over: the 500 at t0 frees it.
        const over5 = limitOf(await buyListing(app, buyer.cookie, cheap.listingId));
        expect(over5).toMatchObject({
          code: "market_limit",
          limit: "buyer_spend",
          retryAfterSeconds: secondsUntil(t0 + WINDOW_MS),
        });
        // 501 over: the 500 at t0 is not enough, the 27 500 at t0 + 1 h is.
        expect(limitOf(await buyListing(app, buyer.cookie, dear.listingId))).toMatchObject({
          limit: "buyer_spend",
          retryAfterSeconds: secondsUntil(t0 + HOUR + WINDOW_MS),
        });
        // From s1 the pair (27 500 + 5) is past its bound too; buyer_spend is named, first in §8.5's order.
        expect(limitOf(await buyListing(app, buyer.cookie, pairToo.listingId))).toMatchObject({
          limit: "buyer_spend",
        });

        now = new Date(t0 + WINDOW_MS - 1);
        expect(limitOf(await buyListing(app, buyer.cookie, cheap.listingId))).toMatchObject({
          limit: "buyer_spend",
          retryAfterSeconds: 1,
        });
        now = new Date(t0 + WINDOW_MS);
        expect((await buyListing(app, buyer.cookie, cheap.listingId)).statusCode).toBe(201);
        // 27 500 + 27 000 + 5 + 501 = 55 006: 6 over, freed by the 27 500 at t0 + 1 h.
        expect(limitOf(await buyListing(app, buyer.cookie, dear.listingId))).toMatchObject({
          limit: "buyer_spend",
          retryAfterSeconds: HOUR / SECOND,
        });
        expect(await balanceOf(app, buyer.account.id)).toBe(start - MARKET_WINDOW_SPEND - 5);
      },
    );

    it("seller_proceeds: two Mythics at the cap fill it exactly; the next sale waits for the oldest, to the millisecond", async () => {
      const seller = await holding([ID.mythic(7), ID.mythic(8), ID.common(42)]);
      const b1 = await funded(MARKET_PRICE_MAX.mythic);
      const b2 = await funded(MARKET_PRICE_MAX.mythic);
      const b3 = await funded(100);
      const t0 = now.getTime();
      await bought(app, b1, (await listed(app, seller, ID.mythic(7), MARKET_PRICE_MAX.mythic)).listingId);
      now = new Date(t0 + HOUR);
      await bought(app, b2, (await listed(app, seller, ID.mythic(8), MARKET_PRICE_MAX.mythic)).listingId);
      expect(2 * MARKET_PRICE_MAX.mythic).toBe(MARKET_WINDOW_PROCEEDS);
      expect((await mine(app, seller.cookie)).left.proceeds).toBe(0);
      now = new Date(t0 + 2 * HOUR);
      const cheap = await listed(app, seller, ID.common(42), 5);
      const res = await buyListing(app, b3.cookie, cheap.listingId);
      expect(limitOf(res)).toMatchObject({
        code: "market_limit",
        limit: "seller_proceeds",
        retryAfterSeconds: secondsUntil(t0 + WINDOW_MS),
      });
      expect(res.headers["retry-after"]).toBe(String(secondsUntil(t0 + WINDOW_MS)));
      now = new Date(t0 + WINDOW_MS - 1);
      expect(limitOf(await buyListing(app, b3.cookie, cheap.listingId))).toMatchObject({
        limit: "seller_proceeds",
        retryAfterSeconds: 1,
      });
      now = new Date(t0 + WINDOW_MS);
      expect((await buyListing(app, b3.cookie, cheap.listingId)).statusCode).toBe(201);
    });

    it("the pair limit is per direction: A → B at its bound stops A, never B → A; A may buy again at the edge", async () => {
      const a = await funded(MARKET_WINDOW_PAIR + 10, [ID.common(43)]);
      const b = await funded(100, [ID.mythic(9), ID.common(44)]);
      const t0 = now.getTime();
      await bought(app, a, (await listed(app, b, ID.mythic(9), MARKET_WINDOW_PAIR)).listingId);
      now = new Date(t0 + MINUTE);
      const fromB = await listed(app, b, ID.common(44), 5);
      expect(limitOf(await buyListing(app, a.cookie, fromB.listingId))).toMatchObject({
        code: "market_limit",
        limit: "pair",
        retryAfterSeconds: secondsUntil(t0 + WINDOW_MS),
      });
      // B → A is another pair: B's purchase from A is not counted against A → B, nor A → B against it.
      await bought(app, b, (await listed(app, a, ID.common(43), MARKET_PRICE_MAX.common)).listingId);
      now = new Date(t0 + WINDOW_MS - 1);
      expect(limitOf(await buyListing(app, a.cookie, fromB.listingId))).toMatchObject({
        limit: "pair",
        retryAfterSeconds: 1,
      });
      now = new Date(t0 + WINDOW_MS);
      expect((await buyListing(app, a.cookie, fromB.listingId)).statusCode).toBe(201);
    });
  });

  describe("cards", () => {
    it("the last copy listed, sold and resold: removed for each seller, a new row for each buyer, the same card throughout", async () => {
      const first = await holding([ID.legendary(7)]);
      const middle = await funded(MARKET_PRICE_MAX.legendary);
      const last = await funded(MARKET_PRICE_MAX.legendary);
      const [original] = await heldCopies(app, first.account.id, ID.legendary(7));
      if (original === undefined) throw new Error("one copy");
      const one = await listed(app, first, ID.legendary(7), 1_000);
      const receipt1 = await bought(app, middle, one.listingId);
      expect(receipt1.card).toMatchObject({ rarity: "legendary", variant: "standard", isNew: true });

      const sold = await cardRow(original.id);
      expect(sold).toMatchObject({ removedByPurchase: receipt1.purchaseId, removedByRecycle: null });
      expect(sold?.removedAt).not.toBeNull();
      expect(await entryOf(app, first.cookie, ID.legendary(7))).toBeUndefined();
      expect(marketErrorOf(await listCard(app, first.cookie, ID.legendary(7), 1_000)).code).toBe(
        "not_enough_copies",
      );
      expect(
        marketErrorOf(await recycle(app, first.cookie, recycleBody(ID.legendary(7), "legendary", 1))).code,
      ).toBe("not_enough_copies");

      const [delivered] = await app.db.select().from(cards).where(eq(cards.purchaseId, receipt1.purchaseId));
      expect(delivered).toMatchObject({
        accountId: middle.account.id,
        characterId: ID.legendary(7),
        rarity: "legendary",
        variant: "standard",
        snapshotId: original.snapshotId,
        openingId: null,
        slot: null,
        removedAt: null,
      });
      expect(await entryOf(app, middle.cookie, ID.legendary(7))).toMatchObject({
        count: 1,
        listed: 0,
        available: 1,
        recyclable: 0,
      });

      tick();
      const two = await listed(app, middle, ID.legendary(7), 1_500);
      expect(await entryOf(app, middle.cookie, ID.legendary(7))).toMatchObject({
        count: 1,
        listed: 1,
        available: 0,
      });
      const receipt2 = await bought(app, last, two.listingId);
      const resold = await cardRow(delivered?.id ?? "");
      expect(resold).toMatchObject({
        purchaseId: receipt1.purchaseId,
        removedByPurchase: receipt2.purchaseId,
      });
      const [third] = await app.db.select().from(cards).where(eq(cards.purchaseId, receipt2.purchaseId));
      expect(third).toMatchObject({
        accountId: last.account.id,
        snapshotId: original.snapshotId,
        rarity: "legendary",
      });

      // The middle account's reset deletes its bought-and-resold card; the audit explains it by the reset.
      tick();
      await reset(middle, true);
      expect(await allCardsOf(middle.account.id)).toEqual([]);
      expect(await heldCopies(app, last.account.id, ID.legendary(7))).toHaveLength(1);
      await expectLedgerConsistent(app, forged.splice(0));
    });

    it("a lapsed listing not yet swept frees its card: listed 0, available again, recyclable, and never buyable", async () => {
      const seller = await holding(copies(ID.uncommon(40), 3));
      const live = await listed(app, seller, ID.uncommon(40), 20);
      const liveCard = (await listingRow(live.listingId))?.cardId;
      const free = (await heldCopies(app, seller.account.id, ID.uncommon(40))).find(
        (card) => card.id !== liveCard,
      );
      if (free === undefined) throw new Error("an unlisted copy");
      // Listed a week ago, as the route writes it, and not yet swept: still `active`, lapsed at now.
      const [lapsed] = await app.db
        .insert(marketListings)
        .values({
          sellerId: seller.account.id,
          requestId: randomUUID(),
          cardId: free.id,
          characterId: ID.uncommon(40),
          rarity: "uncommon",
          price: 20,
          fee: feeOf(20),
          status: "active",
          createdAt: new Date(now.getTime() - TTL_MS),
          expiresAt: now,
        })
        .returning({ id: marketListings.id });
      if (lapsed === undefined) throw new Error("a lapsed listing");
      expect(await entryOf(app, seller.cookie, ID.uncommon(40))).toMatchObject({
        count: 3,
        listed: 1,
        available: 2,
        recyclable: 2,
      });
      const buyer = await funded(100);
      expect(marketErrorOf(await buyListing(app, buyer.cookie, lapsed.id)).code).toBe("listing_unavailable");
      const res = await recycle(app, seller.cookie, recycleBody(ID.uncommon(40), "uncommon", 2));
      expect(res.statusCode, res.body).toBe(201);
      expect((await heldCopies(app, seller.account.id, ID.uncommon(40))).map((card) => card.id)).toEqual([
        liveCard,
      ]);
      expect(await entryOf(app, seller.cookie, ID.uncommon(40))).toMatchObject({
        count: 1,
        listed: 1,
        available: 0,
        recyclable: 0,
      });
      expect(await app.market.expireLapsed(app.log, now)).toBeGreaterThanOrEqual(1);
      expect(await listingRow(lapsed.id)).toMatchObject({ status: "expired", closedAt: now });
      const closed = (await mine(app, seller.cookie)).closed.map((listing) => [
        listing.listingId,
        listing.status,
      ]);
      expect(closed).toContainEqual([lapsed.id, "expired"]);
      expect((await mine(app, seller.cookie)).active.map((listing) => listing.listingId)).toEqual([
        live.listingId,
      ]);
    });

    it("the reset's listing rule (§8.10, M7): the dry run counts live listings only; the reset cancels a live one at its time and closes a lapsed one as expired at its expiry", async () => {
      const seller = await holding([ID.epic(50), ID.epic(51)]);
      const live = await listed(app, seller, ID.epic(50), 100);
      const [lapsed] = await app.db
        .insert(marketListings)
        .values({
          sellerId: seller.account.id,
          requestId: randomUUID(),
          cardId: (await heldCopies(app, seller.account.id, ID.epic(51)))[0]?.id ?? null,
          characterId: ID.epic(51),
          rarity: "epic",
          price: 100,
          fee: feeOf(100),
          status: "active",
          createdAt: new Date(now.getTime() - TTL_MS - HOUR),
          expiresAt: new Date(now.getTime() - HOUR),
        })
        .returning({ id: marketListings.id, expiresAt: marketListings.expiresAt });
      if (lapsed === undefined) throw new Error("a lapsed listing");
      tick();
      const dry = await resetCollection(app.db, seller.account.login, { confirm: false, clock: () => now });
      expect(dry).toMatchObject({ listings: 1, applied: false });
      expect(await listingRow(live.listingId)).toMatchObject({ status: "active", closedAt: null });
      await reset(seller, false);
      expect(await listingRow(live.listingId)).toMatchObject({
        status: "cancelled",
        closedAt: now,
        cardId: null,
      });
      expect(await listingRow(lapsed.id)).toMatchObject({
        status: "expired",
        closedAt: lapsed.expiresAt,
        cardId: null,
      });
      const buyer = await funded(200);
      expect(marketErrorOf(await buyListing(app, buyer.cookie, live.listingId)).code).toBe(
        "listing_unavailable",
      );
      await expectLedgerConsistent(app, forged.splice(0));
    });
  });

  describe("least privilege (economy.md §7, PR 3's rights)", () => {
    it("the app role cannot DELETE a card, its own or anyone's", async () => {
      const holder = await holding([ID.common(50)]);
      await expect(app.db.delete(cards).where(eq(cards.accountId, holder.account.id))).rejects.toMatchObject({
        cause: { code: PERMISSION_DENIED },
      });
      expect(await heldCopies(app, holder.account.id, ID.common(50))).toHaveLength(1);
    });

    it("delete_bought_cards(x) refuses while x has an active listing, then deletes exactly x's cards with a purchase_id, held, once listed or resold, nothing else; audit-ledger sees a stray call", async () => {
      const source = await holding([ID.common(51), ID.common(52), ID.common(53), ID.common(54)]);
      const x = await funded(100, [ID.common(55)]);
      const y = await funded(100);
      for (const id of [ID.common(51), ID.common(52), ID.common(53)])
        await bought(app, x, (await listed(app, source, id, 5)).listingId);
      await bought(app, y, (await listed(app, source, ID.common(54), 5)).listingId);
      const xListing = await listed(app, x, ID.common(52), 5);
      await bought(app, y, (await listed(app, x, ID.common(53), 5)).listingId);
      const byId = <T extends { id: string }>(rows: T[]) =>
        [...rows].sort((a, b) => a.id.localeCompare(b.id));
      const xBefore = byId(await allCardsOf(x.account.id));
      expect(xBefore.filter((card) => card.purchaseId !== null)).toHaveLength(3);
      const yBefore = byId(await allCardsOf(y.account.id));
      const sourceBefore = byId(await allCardsOf(source.account.id));

      // Manager decision, 2026-10-30 (0007): never while x has an active listing, so no listing loses its card.
      const refused: unknown = await app.db
        .execute(sql`select delete_bought_cards(${x.account.id}) as deleted`)
        .then(
          () => null,
          (err: unknown) => err,
        );
      expect(refused).toMatchObject({ cause: { code: "23000" } });
      expect(byId(await allCardsOf(x.account.id))).toEqual(xBefore);
      expect((await cancelListing(app, x.cookie, xListing.listingId)).statusCode).toBe(200);

      const result = await app.db.execute<{ deleted: number }>(
        sql`select delete_bought_cards(${x.account.id}) as deleted`,
      );
      expect(result.rows).toEqual([{ deleted: 3 }]);
      // x's resold card goes too, so y's purchase from x has lost its sold card: both fail the audit
      // (economy.md, the accepted residual of a call outside a reset).
      forged.push(x.account.id, y.account.id);
      expect(byId(await allCardsOf(x.account.id))).toEqual(
        xBefore.filter((card) => card.purchaseId === null),
      );
      expect(byId(await allCardsOf(y.account.id))).toEqual(yBefore);
      expect(byId(await allCardsOf(source.account.id))).toEqual(sourceBefore);
      // The cancelled listing keeps its history without the card; nothing active names no card.
      expect(await listingRow(xListing.listingId)).toMatchObject({ status: "cancelled", cardId: null });
      const audit = await auditLedger(app.db);
      expect(audit.failures.map((failure) => failure.id)).toEqual(
        expect.arrayContaining([x.account.id, y.account.id]),
      );
      // A buyer of that listing moves nothing.
      const z = await funded(100);
      const res = await buyListing(app, z.cookie, xListing.listingId);
      expect(res.statusCode).not.toBe(201);
      expect(await balanceOf(app, z.account.id)).toBe(RECYCLE_VALUE.mythic);
      expect(await purchasesOf(xListing.listingId)).toEqual([]);
      // Null names no account: nothing.
      expect(
        (await app.db.execute<{ deleted: number }>(sql`select delete_bought_cards(null) as deleted`)).rows,
      ).toEqual([{ deleted: 0 }]);
    });

    it("delete_bought_cards: PUBLIC has no EXECUTE, the app role cannot create in public, and a temp table named cards does not redirect it", async () => {
      const privileges = await app.db.execute<{ pub: boolean; app: boolean; create: boolean }>(sql`
        select has_function_privilege('public', 'public.delete_bought_cards(uuid)', 'EXECUTE') as pub,
               has_function_privilege('anime_app', 'public.delete_bought_cards(uuid)', 'EXECUTE') as app,
               has_schema_privilege('anime_app', 'public', 'CREATE') as "create"
      `);
      expect(privileges.rows).toEqual([{ pub: false, app: true, create: false }]);
      const target = await player();
      const shadow = await app.db
        .transaction(async (tx) => {
          await tx.execute(sql`create temp table cards (account_id uuid, purchase_id uuid) on commit drop`);
          await tx.execute(sql`insert into cards values (${target.account.id}, ${randomUUID()})`);
          const deleted = await tx.execute<{ deleted: number }>(
            sql`select public.delete_bought_cards(${target.account.id}) as deleted`,
          );
          const kept = await tx.execute<{ n: number }>(sql`select count(*)::int as n from pg_temp.cards`);
          return { deleted: deleted.rows[0]?.deleted, kept: kept.rows[0]?.n };
        })
        .catch((err: unknown) => ({ refused: (err as { cause?: { code?: string } }).cause?.code }));
      // Either the app role may not make temp tables at all, or the function ignores them.
      expect([{ deleted: 0, kept: 1 }, { refused: PERMISSION_DENIED }]).toContainEqual(shadow);
    });

    it("the app role cannot null removed_by_purchase while the purchase exists (0008); the buyer's account deletion still does", async () => {
      const seller = await holding([ID.common(56)]);
      const buyer = await funded(100);
      const [card] = await heldCopies(app, seller.account.id, ID.common(56));
      await bought(app, buyer, (await listed(app, seller, ID.common(56), 5)).listingId);
      const refused: unknown = await app.db
        .update(cards)
        .set({ removedByPurchase: null })
        .where(eq(cards.id, card?.id ?? ""))
        .then(
          () => null,
          (err: unknown) => err,
        );
      expect(refused).toMatchObject({ cause: { code: "23000" } });
      expect((await cardRow(card?.id ?? ""))?.removedByPurchase).not.toBeNull();
      // The foreign key's set null, once the purchase goes with the buyer's account, still passes.
      await deleteAccounts(app.db, [buyer.account.id]);
      const after = await cardRow(card?.id ?? "");
      expect(after?.removedAt).not.toBeNull();
      expect(after?.removedByPurchase).toBeNull();
      await expectLedgerConsistent(app, forged.splice(0));
    });
  });

  describe("search and exposure", () => {
    it("fullwidth ％, ＿ and ＼ fold to the LIKE specials under NFKC and still match as text", async () => {
      const seller = await holding([PERCENT, UNDERSCORE, BACKSLASH, POKEMON]);
      for (const id of [PERCENT, UNDERSCORE, BACKSLASH, POKEMON]) await listed(app, seller, id, 5);
      const found = async (q: string) =>
        new Set(
          (await page(app, seller.cookie, `q=${encodeURIComponent(q)}`)).listings.map((l) => l.character.id),
        );
      expect(await found("％")).toEqual(new Set([PERCENT]));
      expect(await found("＿")).toEqual(new Set([UNDERSCORE]));
      expect(await found("＼")).toEqual(new Set([BACKSLASH]));
      expect(await found("ＰＯＫＥ")).toEqual(new Set([POKEMON]));
    });

    it("no answer to one account names another account's login or id", async () => {
      const seller = await holding([ID.epic(40), ID.epic(41)]);
      const buyer = await funded(1_000);
      const secrets = (client: SignedInClient) => [client.account.login, client.account.id];
      const listing = await listed(app, seller, ID.epic(40), 100);
      const answers: [SignedInClient, string][] = [];
      const browsed = await browse(app, buyer.cookie, `characterId=${ID.epic(40)}`);
      answers.push([seller, browsed.body]);
      expect(browsed.json<ListingsPage>().listings.map((l) => l.mine)).toEqual([false]);
      const buy = await buyListing(app, buyer.cookie, listing.listingId);
      answers.push([seller, buy.body]);
      const receipt = buy.json<PurchaseReceipt>();
      answers.push([
        seller,
        (await send(app, { method: "GET", url: "/api/market/mine", cookie: buyer.cookie })).body,
      ]);
      answers.push([buyer, JSON.stringify(await mine(app, seller.cookie))]);
      answers.push([buyer, (await listCard(app, seller.cookie, ID.epic(41), 100)).body]);
      answers.push([seller, (await buyListing(app, buyer.cookie, listing.listingId, randomUUID())).body]);
      answers.push([seller, (await cancelListing(app, buyer.cookie, listing.listingId)).body]);
      for (const [other, text] of answers)
        for (const secret of secrets(other)) expect(text, text).not.toContain(secret);
      expect(Object.keys(receipt).sort()).toEqual(
        ["balance", "boughtAt", "card", "franchises", "listingId", "price", "purchaseId"].sort(),
      );
      const sellerMine: MarketMine = await mine(app, seller.cookie);
      expect(sellerMine.closed.map((l) => l.proceeds)).toContain(100 - feeOf(100));
    });
  });

  describe("browse input outside Postgres's ranges is 400, not 500 (economy.md §8.4, §11.2, M2)", () => {
    const forged = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const ID0 = "00000000-0000-4000-8000-000000000000";
    let cookie = "";

    beforeAll(async () => {
      const seller = await holding([ID.common(7)]);
      cookie = seller.cookie;
      await listed(app, seller, ID.common(7), 5);
    });

    it("control: a well-formed cursor at the edge of every range pages normally", async () => {
      for (const [sort, cursor] of [
        ["price_asc", encodeCursor({ sort: "price_asc", price: 1, id: ID0 })],
        ["price_desc", encodeCursor({ sort: "price_desc", price: MAX_ENTRY_AMOUNT, id: ID0 })],
        ["newest", encodeCursor({ sort: "newest", listedAt: new Date("9999-12-31T23:59:59.999Z"), id: ID0 })],
        ["newest", encodeCursor({ sort: "newest", listedAt: new Date(0), id: ID0 })],
      ] as const) {
        const query = `sort=${sort}&cursor=${cursor}`;
        const res = await browse(app, cookie, query);
        expect(res.statusCode, query).toBe(200);
        expect(res.json<ListingsPage>().filterFranchiseIds).toBeNull();
      }
    });

    it("refuses a price key beyond MAX_ENTRY_AMOUNT or a Postgres integer with 400 validation_failed", async () => {
      for (const [sort, price] of [
        ["price_asc", 2_147_483_648],
        ["price_desc", 2_147_483_648],
        ["price_asc", Number.MAX_SAFE_INTEGER],
        ["price_desc", 2_147_483_647],
        ["price_asc", MAX_ENTRY_AMOUNT + 1],
      ] as const) {
        const res = await browse(app, cookie, `sort=${sort}&cursor=${forged([sort, price, ID0])}`);
        expect(res.statusCode, `${sort} ${price}: ${res.body}`).toBe(400);
        expect(marketErrorOf(res).code).toBe("validation_failed");
      }
    });

    it("refuses a newest key outside the epoch to year 9999 with 400 validation_failed", async () => {
      for (const key of [
        new Date(-8.64e15).toISOString(),
        new Date(-2e14).toISOString(),
        new Date(-1).toISOString(),
        new Date(Date.UTC(10_000, 0, 1)).toISOString(),
      ]) {
        const res = await browse(app, cookie, `sort=newest&cursor=${forged(["newest", key, ID0])}`);
        expect(res.statusCode, `${key}: ${res.body}`).toBe(400);
        expect(marketErrorOf(res).code).toBe("validation_failed");
      }
    });

    it("refuses a search text holding U+0000 or any other control character with 400 validation_failed", async () => {
      for (const q of ["%00", "a%00b", "%01", "%1F", "tab%09", "line%0A", "%7F", "%C2%85", "%C2%9F"]) {
        const res = await browse(app, cookie, `q=${q}`);
        expect(res.statusCode, `q=${q}: ${res.body}`).toBe(400);
        expect(marketErrorOf(res).code).toBe("validation_failed");
      }
      // Format characters are text, as the collection's search keeps them.
      expect(
        (await browse(app, cookie, `q=${encodeURIComponent(String.fromCodePoint(0x202e))}`)).statusCode,
      ).toBe(200);
    });
  });
});
