import { randomUUID } from "node:crypto";
import type { Listing, PurchaseReceipt, Wallet } from "@anime-tcg/shared/api";
import {
  MARKET_LISTING_TTL_SECONDS,
  MARKET_MAX_LISTINGS,
  MARKET_PAGE_SIZE,
  MARKET_PRICE_MAX,
  MARKET_PRICE_MIN,
  MARKET_WINDOW_PAIR,
  MARKET_WINDOW_PROCEEDS,
  MARKET_WINDOW_PURCHASES,
  MARKET_WINDOW_SECONDS,
  MARKET_WINDOW_SPEND,
  MAX_BALANCE,
  RECYCLE_VALUE,
  THEMED_PACK_PRICE,
} from "@anime-tcg/shared/economy";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { cards, marketListings, marketPurchases, poolSnapshotFranchises } from "../src/db/schema.js";
import { resetCollection } from "../src/domain/collection/reset.js";
import { marketFee } from "../src/domain/economy/fee.js";
import {
  balanceOf,
  buyPack,
  entryOf,
  expectClockBehindDatabase,
  expectLedgerConsistent,
  forgeBalance,
  getWallet,
  ID,
  ledgerOf,
  pastClockStart,
  recycle,
  recycleBody,
} from "./economy-support.js";
import {
  ATTACK_ON_TITAN,
  BACKSLASH,
  bought,
  browse,
  buyListing,
  cancelListing,
  copies,
  EREN,
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
  seedListings,
  POKEMON,
  UNDERSCORE,
} from "./market-support.js";
import {
  body,
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  loadSnapshot,
  newPlayer,
} from "./pool-support.js";
import { createTestApp, send, type SignedInClient, testConfig } from "./support.js";

const SECOND = 1_000;
const HOUR = 3_600_000;
const WINDOW_MS = MARKET_WINDOW_SECONDS * SECOND;
const TTL_MS = MARKET_LISTING_TTL_SECONDS * SECOND;
/** The tests that make a hundred purchases: seconds on an idle machine, so the bound only catches a hang. */
const HEAVY_MS = 120_000;

describe("market routes (economy.md §8.3 to §8.5, §11.3, §14)", () => {
  let app: App;
  // Far enough behind the database's clock for the windows and expiries this file waits out (about 45 days).
  let now = new Date(pastClockStart().getTime() - 90 * 24 * HOUR);
  const made: string[] = [];
  const forged: string[] = [];
  const snapshots: number[] = [];
  let snapshotId = 0;

  const tick = (ms = SECOND) => {
    now = new Date(now.getTime() + ms);
  };
  const player = async () => {
    const client = await newPlayer(app, "mk");
    made.push(client.account.id);
    return client;
  };
  /** A player holding one card per id. */
  const holding = async (ids: readonly number[]) => {
    const client = await player();
    await grantCards(app, client.account.id, snapshotId, ids, now);
    return client;
  };
  const funded = async (karma: number) => {
    const client = await player();
    await fund(app, client, snapshotId, karma, now);
    return client;
  };
  const wallet = async (client: SignedInClient) => body<Wallet>(await getWallet(app, client.cookie));
  /** Deletes every account made so far, and with them every listing, so a browse sees only what a test lists. */
  const clearMarket = async () => {
    await expectLedgerConsistent(app, forged.splice(0));
    await deleteAccounts(app.db, made.splice(0));
  };

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
      // Whatever the audit found, the next file must not find this file's snapshot current.
      await deleteAccounts(app.db, made);
      await deleteSnapshots(snapshots);
      await app.close();
    }
  });

  describe("POST /api/market/listings", () => {
    it("lists the newest unlisted copy at the asking price, with the fee and the expiry the server sets", async () => {
      const seller = await holding([ID.epic(1)]);
      tick(HOUR);
      await grantCards(app, seller.account.id, snapshotId, [ID.epic(1)], now);
      const [, newest] = await app.db
        .select({ id: cards.id, pulledAt: cards.pulledAt })
        .from(cards)
        .where(eq(cards.accountId, seller.account.id))
        .orderBy(cards.pulledAt);
      const res = await listCard(app, seller.cookie, ID.epic(1), 123);
      expect(res.statusCode).toBe(201);
      const listing = res.json<Listing>();
      expect(listing).toEqual({
        listingId: expect.any(String) as string,
        kind: "card",
        character: expect.objectContaining({ id: ID.epic(1), tier: "epic" }) as object,
        rarity: "epic",
        variant: "standard",
        price: 123,
        fee: 7,
        listedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
        closedAt: null,
        status: "active",
        mine: true,
      });
      const [row] = await app.db
        .select({ cardId: marketListings.cardId })
        .from(marketListings)
        .where(eq(marketListings.id, listing.listingId));
      expect(row?.cardId).toBe(newest?.id);
      expect(await wallet(seller)).toMatchObject({ activeListings: 1 });
      // No Karma moves at listing time.
      expect(await ledgerOf(app, seller.account.id)).toEqual([]);
    });

    it("answers a replay 200 with the listing, and a reused key with another price 409 request_id_reused", async () => {
      const seller = await holding([ID.rare(10), ID.rare(10)]);
      const requestId = randomUUID();
      const first = await listCard(app, seller.cookie, ID.rare(10), 30, { requestId });
      expect(first.statusCode).toBe(201);
      const again = await listCard(app, seller.cookie, ID.rare(10), 30, { requestId });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual(first.json());
      const reused = await listCard(app, seller.cookie, ID.rare(10), 31, { requestId });
      expect(reused.statusCode).toBe(409);
      expect(marketErrorOf(reused).code).toBe("request_id_reused");
      expect(await wallet(seller)).toMatchObject({ activeListings: 1 });
    });

    it("refuses a price below the floor or above the cap of every tier with 400 price_out_of_bounds, and accepts both bounds", async () => {
      const seller = await player();
      for (const tier of RARITIES) {
        for (const price of [MARKET_PRICE_MIN[tier] - 1, MARKET_PRICE_MAX[tier] + 1]) {
          const res = await listCard(app, seller.cookie, ID.common(9), price, { rarity: tier });
          expect(res.statusCode, `${tier} ${price}`).toBe(400);
          expect(marketErrorOf(res).code).toBe("price_out_of_bounds");
        }
      }
      const holder = await holding([ID.legendary(1), ID.legendary(1)]);
      expect(
        (await listCard(app, holder.cookie, ID.legendary(1), MARKET_PRICE_MIN.legendary)).statusCode,
      ).toBe(201);
      expect(
        (await listCard(app, holder.cookie, ID.legendary(1), MARKET_PRICE_MAX.legendary)).statusCode,
      ).toBe(201);
    });

    it("refuses an extra field, a query string, a missing Origin and a signed-out caller", async () => {
      const seller = await holding([ID.rare(11)]);
      const [card] = await heldCopies(app, seller.account.id, ID.rare(11));
      for (const extra of [
        { cardId: card?.id },
        { fee: 1 },
        { kind: "card" },
        { variant: "standard" },
        { sellerId: seller.account.id },
      ]) {
        const res = await listCard(app, seller.cookie, ID.rare(11), 30, { extra });
        expect(res.statusCode, JSON.stringify(extra)).toBe(400);
        expect(marketErrorOf(res).code).toBe("validation_failed");
      }
      const query = await send(app, {
        method: "POST",
        url: "/api/market/listings?price=1",
        cookie: seller.cookie,
        payload: { requestId: randomUUID(), characterId: ID.rare(11), rarity: "rare", price: 30 },
      });
      expect(query.statusCode).toBe(400);
      const noOrigin = await send(app, {
        method: "POST",
        url: "/api/market/listings",
        cookie: seller.cookie,
        origin: null,
        payload: { requestId: randomUUID(), characterId: ID.rare(11), rarity: "rare", price: 30 },
      });
      expect(noOrigin.statusCode).toBe(403);
      expect((await listCard(app, undefined, ID.rare(11), 30)).statusCode).toBe(401);
      expect(await wallet(seller)).toMatchObject({ activeListings: 0 });
    });

    it("refuses a card the account does not hold: another account's, one that does not exist, another rarity", async () => {
      const owner = await holding([ID.rare(12)]);
      const other = await player();
      for (const [characterId, rarity] of [
        [ID.rare(12), "rare"],
        [999_999, "rare"],
      ] as const) {
        const res = await listCard(app, other.cookie, characterId, 30, { rarity });
        expect(res.statusCode).toBe(409);
        expect(marketErrorOf(res).code).toBe("not_enough_copies");
      }
      const wrongRarity = await listCard(app, owner.cookie, ID.rare(12), MARKET_PRICE_MIN.mythic, {
        rarity: "mythic",
      });
      expect(marketErrorOf(wrongRarity).code).toBe("not_enough_copies");
      expect(await wallet(owner)).toMatchObject({ activeListings: 0 });
    });

    it("lists the last copy: the entry shows listed 1, available 0, recyclable 0, and the card can be neither recycled nor listed again", async () => {
      const seller = await holding([ID.uncommon(1)]);
      await listed(app, seller, ID.uncommon(1), 20);
      expect(await entryOf(app, seller.cookie, ID.uncommon(1))).toMatchObject({
        count: 1,
        listed: 1,
        available: 0,
        recyclable: 0,
      });
      const again = await listCard(app, seller.cookie, ID.uncommon(1), 20);
      expect(marketErrorOf(again).code).toBe("not_enough_copies");
      const recycled = await recycle(app, seller.cookie, recycleBody(ID.uncommon(1), "uncommon", 1));
      expect(marketErrorOf(recycled).code).toBe("not_enough_copies");
    });

    it("with two copies both listed, recycling is 409; with three and one listed two can go; with two and one listed the unlisted one can", async () => {
      const both = await holding(copies(ID.common(20), 2));
      await listed(app, both, ID.common(20), 5);
      await listed(app, both, ID.common(20), 6);
      expect(await entryOf(app, both.cookie, ID.common(20))).toMatchObject({
        count: 2,
        listed: 2,
        available: 0,
        recyclable: 0,
      });
      const refused = await recycle(app, both.cookie, recycleBody(ID.common(20), "common", 1));
      expect(refused.statusCode).toBe(409);
      expect(marketErrorOf(refused).code).toBe("not_enough_copies");

      const three = await holding(copies(ID.common(21), 3));
      await listed(app, three, ID.common(21), 5);
      expect(await entryOf(app, three.cookie, ID.common(21))).toMatchObject({
        count: 3,
        listed: 1,
        available: 2,
        recyclable: 2,
      });
      expect((await recycle(app, three.cookie, recycleBody(ID.common(21), "common", 2))).statusCode).toBe(
        201,
      );
      // The listed copy is the one left: still held, still listed.
      expect(await entryOf(app, three.cookie, ID.common(21))).toMatchObject({
        count: 1,
        listed: 1,
        recyclable: 0,
      });

      const two = await holding(copies(ID.common(22), 2));
      await listed(app, two, ID.common(22), 5);
      expect(await entryOf(app, two.cookie, ID.common(22))).toMatchObject({
        count: 2,
        available: 1,
        recyclable: 1,
      });
      expect((await recycle(app, two.cookie, recycleBody(ID.common(22), "common", 1))).statusCode).toBe(201);
      expect(await entryOf(app, two.cookie, ID.common(22))).toMatchObject({ count: 1, listed: 1 });
    });

    it(
      `holds an account to ${MARKET_MAX_LISTINGS} live listings, 409 listing_limit, until one closes`,
      { timeout: HEAVY_MS },
      async () => {
        const seller = await holding(copies(ID.common(30), MARKET_MAX_LISTINGS + 1));
        for (let i = 0; i < MARKET_MAX_LISTINGS; i += 1) await listed(app, seller, ID.common(30), 5);
        const over = await listCard(app, seller.cookie, ID.common(30), 5);
        expect(over.statusCode).toBe(409);
        expect(marketErrorOf(over).code).toBe("listing_limit");
        expect(await wallet(seller)).toMatchObject({ activeListings: MARKET_MAX_LISTINGS });
        const [first] = (await mine(app, seller.cookie)).active;
        if (first === undefined) throw new Error("no active listing");
        expect((await cancelListing(app, seller.cookie, first.listingId)).statusCode).toBe(200);
        expect((await listCard(app, seller.cookie, ID.common(30), 5)).statusCode).toBe(201);
      },
    );
  });

  describe("POST /api/market/listings/{listingId}/buy", () => {
    it("moves exactly the price and the 5 % fee, removes the seller's card and gives the buyer a new one of the same character, rarity, variant and snapshot", async () => {
      const seller = await holding([ID.mythic(1)]);
      const buyer = await funded(MARKET_PRICE_MAX.mythic);
      const listing = await listed(app, seller, ID.mythic(1), MARKET_PRICE_MAX.mythic);
      const [sold] = await heldCopies(app, seller.account.id, ID.mythic(1));
      tick();
      const res = await buyListing(app, buyer.cookie, listing.listingId);
      expect(res.statusCode, res.body).toBe(201);
      const receipt = res.json<PurchaseReceipt>();
      // One Mythic at the cap, from one seller, in an empty window: every limit holds it, the pair limit exactly.
      expect(receipt).toEqual({
        purchaseId: expect.any(String) as string,
        boughtAt: now.toISOString(),
        listingId: listing.listingId,
        price: 27_500,
        card: {
          kind: "card",
          character: expect.objectContaining({ id: ID.mythic(1) }) as object,
          rarity: "mythic",
          variant: "standard",
          isNew: true,
        },
        franchises: expect.any(Array) as unknown[],
        balance: 0,
      });
      expect(receipt.franchises.map((ref) => ref.id)).toEqual(receipt.card.character.franchiseIds);
      expect(await ledgerOf(app, buyer.account.id)).toEqual([
        { seq: 1, kind: "recycle_credit", amount: 27_500, balanceAfter: 27_500 },
        { seq: 2, kind: "market_purchase", amount: -27_500, balanceAfter: 0 },
      ]);
      expect(await ledgerOf(app, seller.account.id)).toEqual([
        { seq: 1, kind: "market_sale", amount: 27_500, balanceAfter: 27_500 },
        { seq: 2, kind: "market_fee", amount: -1_375, balanceAfter: 26_125 },
      ]);
      expect(await heldCopies(app, seller.account.id, ID.mythic(1))).toEqual([]);
      const [removed] = await app.db
        .select({ removedAt: cards.removedAt, removedByPurchase: cards.removedByPurchase })
        .from(cards)
        .where(eq(cards.id, sold?.id ?? ""));
      expect(removed).toEqual({ removedAt: now, removedByPurchase: receipt.purchaseId });
      expect(await heldCopies(app, buyer.account.id, ID.mythic(1))).toEqual([
        { id: expect.any(String) as string, purchaseId: receipt.purchaseId, snapshotId: sold?.snapshotId },
      ]);
      expect(await entryOf(app, buyer.cookie, ID.mythic(1))).toMatchObject({ rarity: "mythic", count: 1 });
      expect(await wallet(seller)).toMatchObject({ balance: 26_125, activeListings: 0 });
      const [row] = await app.db
        .select({ status: marketListings.status, closedAt: marketListings.closedAt })
        .from(marketListings)
        .where(eq(marketListings.id, listing.listingId));
      expect(row).toEqual({ status: "sold", closedAt: now });
    });

    it("computes the fee rounded up, at least 1, and pays the seller the price less it", async () => {
      const cases = [
        [ID.common(40), MARKET_PRICE_MIN.common, 1],
        [ID.common(41), MARKET_PRICE_MAX.common, 2],
        [ID.rare(20), MARKET_PRICE_MAX.rare, 5],
        [ID.legendary(2), MARKET_PRICE_MAX.legendary, 125],
      ] as const;
      const buyer = await funded(5_000);
      for (const [characterId, price, fee] of cases) {
        expect(marketFee(price)).toBe(fee);
        const seller = await holding([characterId]);
        const listing = await listed(app, seller, characterId, price);
        expect(listing.fee).toBe(fee);
        await bought(app, buyer, listing.listingId);
        expect(await balanceOf(app, seller.account.id)).toBe(price - fee);
      }
    });

    it("answers a replay 200 with the same receipt and the current balance; the key on another listing is 409 request_id_reused", async () => {
      const seller = await holding([ID.rare(21), ID.rare(22)]);
      const buyer = await funded(100);
      const first = await listed(app, seller, ID.rare(21), 30);
      const second = await listed(app, seller, ID.rare(22), 30);
      const requestId = randomUUID();
      const res = await buyListing(app, buyer.cookie, first.listingId, requestId);
      expect(res.statusCode).toBe(201);
      tick();
      const replay = await buyListing(app, buyer.cookie, first.listingId, requestId);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(res.json());
      const reused = await buyListing(app, buyer.cookie, second.listingId, requestId);
      expect(reused.statusCode).toBe(409);
      expect(marketErrorOf(reused).code).toBe("request_id_reused");
      expect(
        await app.db.select().from(marketPurchases).where(eq(marketPurchases.buyerId, buyer.account.id)),
      ).toHaveLength(1);
    });

    it("refuses buying one's own listing with 409 own_listing and writes nothing", async () => {
      const seller = await holding([ID.rare(23)]);
      await fund(app, seller, snapshotId, 100, now);
      const listing = await listed(app, seller, ID.rare(23), 30);
      const before = await ledgerOf(app, seller.account.id);
      const res = await buyListing(app, seller.cookie, listing.listingId);
      expect(res.statusCode).toBe(409);
      expect(marketErrorOf(res).code).toBe("own_listing");
      expect(await ledgerOf(app, seller.account.id)).toEqual(before);
      expect(await wallet(seller)).toMatchObject({ activeListings: 1 });
    });

    it("answers an unknown listing 404, a malformed id 400, and a body with anything but the key 400", async () => {
      const buyer = await funded(100);
      const unknown = await buyListing(app, buyer.cookie, randomUUID());
      expect(unknown.statusCode).toBe(404);
      expect(marketErrorOf(unknown).code).toBe("listing_not_found");
      for (const id of ["not-a-uuid", "1", "00000000-0000-0000-0000-00000000000g"]) {
        expect((await buyListing(app, buyer.cookie, id)).statusCode, id).toBe(400);
      }
      const seller = await holding([ID.rare(24)]);
      const listing = await listed(app, seller, ID.rare(24), 30);
      for (const extra of [
        { price: 1 },
        { amount: 1 },
        { fee: 0 },
        { characterId: ID.rare(24) },
        { sellerId: seller.account.id },
      ]) {
        const res = await buyListing(app, buyer.cookie, listing.listingId, randomUUID(), extra);
        expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      }
      expect(await wallet(seller)).toMatchObject({ activeListings: 1 });
    });

    it("refuses a buyer one below the price with 409 insufficient_funds carrying the balance", async () => {
      const seller = await holding([ID.mythic(11)]);
      const buyer = await funded(2 * RECYCLE_VALUE.mythic);
      const listing = await listed(app, seller, ID.mythic(11), 2 * RECYCLE_VALUE.mythic + 1);
      const res = await buyListing(app, buyer.cookie, listing.listingId);
      expect(res.statusCode).toBe(409);
      expect(marketErrorOf(res)).toMatchObject({
        code: "insufficient_funds",
        balance: 2 * RECYCLE_VALUE.mythic,
      });
      expect(await ledgerOf(app, seller.account.id)).toEqual([]);
      expect(await wallet(seller)).toMatchObject({ activeListings: 1 });
    });

    it("takes a sale that leaves the seller at exactly MAX_BALANCE, the fee posted before the sale so no row passes it", async () => {
      const seller = await holding([ID.rare(29)]);
      forged.push(seller.account.id);
      const price = MARKET_PRICE_MAX.rare;
      await forgeBalance(app, seller.account.id, MAX_BALANCE - price + marketFee(price));
      const buyer = await funded(100);
      await bought(app, buyer, (await listed(app, seller, ID.rare(29), price)).listingId);
      expect(await balanceOf(app, seller.account.id)).toBe(MAX_BALANCE);
      expect((await ledgerOf(app, seller.account.id)).slice(-2)).toEqual([
        { seq: 2, kind: "market_fee", amount: -marketFee(price), balanceAfter: MAX_BALANCE - price },
        { seq: 3, kind: "market_sale", amount: price, balanceAfter: MAX_BALANCE },
      ]);
    });

    it("refuses a sale that would take the seller past MAX_BALANCE with listing_unavailable, writing nothing", async () => {
      const seller = await holding([ID.rare(25)]);
      forged.push(seller.account.id);
      await forgeBalance(app, seller.account.id, MAX_BALANCE - 1);
      const buyer = await funded(100);
      const listing = await listed(app, seller, ID.rare(25), 30);
      const res = await buyListing(app, buyer.cookie, listing.listingId);
      expect(res.statusCode).toBe(409);
      expect(marketErrorOf(res).code).toBe("listing_unavailable");
      expect(await balanceOf(app, buyer.account.id)).toBe(RECYCLE_VALUE.mythic);
      expect(await balanceOf(app, seller.account.id)).toBe(MAX_BALANCE - 1);
      expect(await heldCopies(app, seller.account.id, ID.rare(25))).toHaveLength(1);
    });

    it("refuses a sold, a cancelled and an expired listing with 409 listing_unavailable", async () => {
      const seller = await holding([ID.rare(26), ID.rare(27), ID.rare(28)]);
      const buyer = await funded(200);
      const sold = await listed(app, seller, ID.rare(26), 30);
      await bought(app, buyer, sold.listingId);
      const cancelled = await listed(app, seller, ID.rare(27), 30);
      expect((await cancelListing(app, seller.cookie, cancelled.listingId)).statusCode).toBe(200);
      const lapsing = await listed(app, seller, ID.rare(28), 30);
      const other = await funded(100);
      tick(TTL_MS);
      for (const listing of [sold, cancelled, lapsing]) {
        const res = await buyListing(app, other.cookie, listing.listingId);
        expect(res.statusCode, listing.listingId).toBe(409);
        expect(marketErrorOf(res).code).toBe("listing_unavailable");
      }
      expect(await balanceOf(app, other.account.id)).toBe(RECYCLE_VALUE.mythic);
    });
  });

  describe("the window limits (economy.md §10)", () => {
    it(
      "refuses the buyer's 101st purchase in the window, buyer_purchases, and lets it through once the oldest leaves",
      { timeout: HEAVY_MS },
      async () => {
        const sellers = await Promise.all([0, 1, 2].map(() => holding(copies(ID.common(50), 34))));
        const buyer = await funded(MARKET_WINDOW_PURCHASES * 6);
        const listings: { listingId: string }[] = [];
        for (const seller of sellers)
          listings.push(...(await seedListings(app, seller, ID.common(50), 5, 34, now)));
        const firstAt = now;
        for (const listing of listings.slice(0, MARKET_WINDOW_PURCHASES)) {
          await bought(app, buyer, listing.listingId);
          tick(SECOND);
        }
        const last = listings[MARKET_WINDOW_PURCHASES];
        if (last === undefined) throw new Error("101 listings");
        const res = await buyListing(app, buyer.cookie, last.listingId);
        expect(res.statusCode).toBe(409);
        const expected = Math.ceil((firstAt.getTime() + WINDOW_MS - now.getTime()) / SECOND);
        expect(marketErrorOf(res)).toMatchObject({
          code: "market_limit",
          limit: "buyer_purchases",
          retryAfterSeconds: expected,
        });
        expect(res.headers["retry-after"]).toBe(String(expected));
        expect((await mine(app, buyer.cookie)).left).toEqual({
          purchases: 0,
          spend: MARKET_WINDOW_SPEND - MARKET_WINDOW_PURCHASES * 5,
          proceeds: MARKET_WINDOW_PROCEEDS,
        });
        // A second before the oldest purchase leaves the window it still counts; at its time plus the window it does not.
        now = new Date(firstAt.getTime() + WINDOW_MS - SECOND);
        const seller = sellers[2];
        if (seller === undefined) throw new Error("three sellers");
        // Its two unsold listings are still live, so the seller lists a fresh copy that outlives the wait.
        await grantCards(app, seller.account.id, snapshotId, [ID.common(50)], now);
        const fresh = await listed(app, seller, ID.common(50), 5);
        expect(marketErrorOf(await buyListing(app, buyer.cookie, fresh.listingId))).toMatchObject({
          limit: "buyer_purchases",
          retryAfterSeconds: 1,
        });
        tick(SECOND);
        expect((await buyListing(app, buyer.cookie, fresh.listingId)).statusCode).toBe(201);
      },
    );

    it(
      "refuses a buyer past MARKET_WINDOW_SPEND, buyer_spend, after two Mythics at the cap from two sellers",
      { timeout: HEAVY_MS },
      async () => {
        const sellers = await Promise.all([ID.mythic(2), ID.mythic(3)].map((id) => holding([id])));
        const third = await holding([ID.common(60)]);
        const buyer = await funded(MARKET_WINDOW_SPEND + 5);
        for (const [index, seller] of sellers.entries()) {
          const listing = await listed(app, seller, ID.mythic(2 + index), MARKET_PRICE_MAX.mythic);
          await bought(app, buyer, listing.listingId);
        }
        const extra = await listed(app, third, ID.common(60), 5);
        const res = await buyListing(app, buyer.cookie, extra.listingId);
        expect(res.statusCode).toBe(409);
        expect(marketErrorOf(res)).toMatchObject({
          code: "market_limit",
          limit: "buyer_spend",
          retryAfterSeconds: MARKET_WINDOW_SECONDS,
        });
        expect(await balanceOf(app, buyer.account.id)).toBeGreaterThanOrEqual(5);
      },
    );

    it("refuses a seller past MARKET_WINDOW_PROCEEDS, seller_proceeds, exactly at the bound", async () => {
      const seller = await holding([ID.mythic(4), ID.mythic(5), ID.common(61)]);
      const buyers = await Promise.all([0, 1, 2].map(() => funded(MARKET_PRICE_MAX.mythic)));
      for (const [index, id] of [ID.mythic(4), ID.mythic(5)].entries()) {
        const listing = await listed(app, seller, id, MARKET_PRICE_MAX.mythic);
        await bought(app, buyers[index] as SignedInClient, listing.listingId);
      }
      expect((await mine(app, seller.cookie)).left.proceeds).toBe(
        MARKET_WINDOW_PROCEEDS - 2 * MARKET_PRICE_MAX.mythic,
      );
      const cheap = await listed(app, seller, ID.common(61), 5);
      const res = await buyListing(app, (buyers[2] as SignedInClient).cookie, cheap.listingId);
      expect(res.statusCode).toBe(409);
      expect(marketErrorOf(res)).toMatchObject({ code: "market_limit", limit: "seller_proceeds" });
    });

    it("refuses a buyer past MARKET_WINDOW_PAIR from one seller, pair, and lets the same buyer buy from another", async () => {
      const seller = await holding([ID.mythic(6), ID.common(62)]);
      const other = await holding([ID.common(63)]);
      const buyer = await funded(MARKET_WINDOW_PAIR + 10);
      await bought(app, buyer, (await listed(app, seller, ID.mythic(6), MARKET_WINDOW_PAIR)).listingId);
      const res = await buyListing(
        app,
        buyer.cookie,
        (await listed(app, seller, ID.common(62), 5)).listingId,
      );
      expect(res.statusCode).toBe(409);
      expect(marketErrorOf(res)).toMatchObject({ code: "market_limit", limit: "pair" });
      expect(
        (await buyListing(app, buyer.cookie, (await listed(app, other, ID.common(63), 5)).listingId))
          .statusCode,
      ).toBe(201);
    });
  });

  describe("POST /api/market/listings/{listingId}/cancel", () => {
    it("cancels a live listing, idempotently, with closedAt; the card is available at once", async () => {
      const seller = await holding([ID.rare(30)]);
      const listing = await listed(app, seller, ID.rare(30), 30);
      tick();
      const res = await cancelListing(app, seller.cookie, listing.listingId);
      expect(res.statusCode).toBe(200);
      expect(res.json<Listing>()).toMatchObject({
        status: "cancelled",
        closedAt: now.toISOString(),
        mine: true,
      });
      tick();
      const again = await cancelListing(app, seller.cookie, listing.listingId);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual(res.json());
      expect(await entryOf(app, seller.cookie, ID.rare(30))).toMatchObject({ listed: 0, available: 1 });
      expect(await wallet(seller)).toMatchObject({ activeListings: 0 });
    });

    it("answers another account's listing and an unknown one 404, leaving it as it was; a sold one 409", async () => {
      const seller = await holding([ID.rare(31), ID.rare(32)]);
      const other = await funded(100);
      const listing = await listed(app, seller, ID.rare(31), 30);
      for (const id of [listing.listingId, randomUUID()]) {
        const res = await cancelListing(app, other.cookie, id);
        expect(res.statusCode).toBe(404);
        expect(marketErrorOf(res).code).toBe("listing_not_found");
      }
      expect(await wallet(seller)).toMatchObject({ activeListings: 1 });
      const sold = await listed(app, seller, ID.rare(32), 30);
      await bought(app, other, sold.listingId);
      const res = await cancelListing(app, seller.cookie, sold.listingId);
      expect(res.statusCode).toBe(409);
      expect(marketErrorOf(res).code).toBe("listing_unavailable");
    });

    it("takes an empty body only, and no Origin is 403", async () => {
      const seller = await holding([ID.rare(33)]);
      const listing = await listed(app, seller, ID.rare(33), 30);
      expect(
        (await cancelListing(app, seller.cookie, listing.listingId, { requestId: randomUUID() })).statusCode,
      ).toBe(400);
      const noOrigin = await send(app, {
        method: "POST",
        url: `/api/market/listings/${listing.listingId}/cancel`,
        cookie: seller.cookie,
        origin: null,
        payload: {},
      });
      expect(noOrigin.statusCode).toBe(403);
      expect((await cancelListing(app, undefined, listing.listingId)).statusCode).toBe(401);
      expect(await wallet(seller)).toMatchObject({ activeListings: 1 });
    });
  });

  describe("expiry (economy.md §8.5)", () => {
    it("treats a listing past expires_at as expired before and after the purge: not browsed, not bought, under mine.closed", async () => {
      const seller = await holding([ID.rare(40)]);
      const listing = await listed(app, seller, ID.rare(40), 30);
      tick(TTL_MS - SECOND);
      expect((await page(app, seller.cookie, `characterId=${ID.rare(40)}`)).listings).toHaveLength(1);
      expect(await wallet(seller)).toMatchObject({ activeListings: 1 });
      tick(SECOND);
      expect((await page(app, seller.cookie, `characterId=${ID.rare(40)}`)).listings).toEqual([]);
      expect(await wallet(seller)).toMatchObject({ activeListings: 0 });
      expect(await entryOf(app, seller.cookie, ID.rare(40))).toMatchObject({ listed: 0, available: 1 });
      const before = await mine(app, seller.cookie);
      const expired = {
        listingId: listing.listingId,
        status: "expired",
        closedAt: listing.expiresAt,
        proceeds: null,
      };
      expect(before.active).toEqual([]);
      expect(before.closed).toEqual([expect.objectContaining(expired)]);
      expect(await app.market.expireLapsed(app.log, now)).toBeGreaterThanOrEqual(1);
      const [row] = await app.db
        .select({ status: marketListings.status, closedAt: marketListings.closedAt })
        .from(marketListings)
        .where(eq(marketListings.id, listing.listingId));
      expect(row).toEqual({ status: "expired", closedAt: new Date(listing.expiresAt) });
      const after = await mine(app, seller.cookie);
      expect(after.active).toEqual([]);
      expect(after.closed).toEqual(before.closed);
      // The card can be listed again at once.
      expect((await listCard(app, seller.cookie, ID.rare(40), 30)).statusCode).toBe(201);
    });

    it("lets the card of an unpurged lapsed listing be listed again, closing the old one as expired", async () => {
      const seller = await holding([ID.rare(41)]);
      const old = await listed(app, seller, ID.rare(41), 30);
      tick(TTL_MS);
      const fresh = await listed(app, seller, ID.rare(41), 31);
      const { closed, active } = await mine(app, seller.cookie);
      expect(active.map((listing) => listing.listingId)).toEqual([fresh.listingId]);
      expect(closed).toEqual([
        expect.objectContaining({ listingId: old.listingId, status: "expired", closedAt: old.expiresAt }),
      ]);
      // Cancelling a lapsed listing closes it as expired, not cancelled.
      tick(TTL_MS);
      const res = await cancelListing(app, seller.cookie, fresh.listingId);
      expect(res.json<Listing>()).toMatchObject({ status: "expired", closedAt: fresh.expiresAt });
    });
  });

  describe("GET /api/market/mine", () => {
    it("shows live listings, closed ones with proceeds for a sale, purchases and the window's room", async () => {
      const seller = await holding([ID.rare(50), ID.rare(51), ID.rare(52)]);
      const buyer = await funded(100);
      const live = await listed(app, seller, ID.rare(50), 30);
      const sold = await listed(app, seller, ID.rare(51), 40);
      const cancelled = await listed(app, seller, ID.rare(52), 50);
      tick();
      const receipt = await bought(app, buyer, sold.listingId);
      tick();
      await cancelListing(app, seller.cookie, cancelled.listingId);
      const view = await mine(app, seller.cookie);
      expect(view.active).toEqual([live]);
      expect(view.closed).toEqual([
        { ...cancelled, status: "cancelled", closedAt: now.toISOString(), proceeds: null },
        { ...sold, status: "sold", closedAt: receipt.boughtAt, proceeds: 40 - marketFee(40) },
      ]);
      expect(view.purchases).toEqual([]);
      expect(view.left).toEqual({
        purchases: MARKET_WINDOW_PURCHASES,
        spend: MARKET_WINDOW_SPEND,
        proceeds: MARKET_WINDOW_PROCEEDS - 40,
      });
      const ids = new Set(view.franchises.map((ref) => ref.id));
      for (const listing of [...view.active, ...view.closed])
        for (const id of listing.character.franchiseIds) expect(ids.has(id)).toBe(true);
      const theirs = await mine(app, buyer.cookie);
      expect(theirs.purchases).toEqual([{ ...receipt, balance: RECYCLE_VALUE.mythic - 40 }]);
      expect(theirs.left).toMatchObject({
        purchases: MARKET_WINDOW_PURCHASES - 1,
        spend: MARKET_WINDOW_SPEND - 40,
      });
    });

    it("takes no query string and is 401 signed out", async () => {
      const client = await player();
      expect(
        (await send(app, { method: "GET", url: "/api/market/mine?all=1", cookie: client.cookie })).statusCode,
      ).toBe(400);
      expect((await send(app, { method: "GET", url: "/api/market/mine" })).statusCode).toBe(401);
    });
  });

  describe("accounts that go (economy.md §7)", () => {
    it("deleting a seller's account leaves the buyer's card and receipt intact, the receipt without its listing", async () => {
      const seller = await holding([ID.epic(10)]);
      const buyer = await funded(200);
      const receipt = await bought(app, buyer, (await listed(app, seller, ID.epic(10), 150)).listingId);
      await deleteAccounts(app.db, [seller.account.id]);
      expect(await heldCopies(app, buyer.account.id, ID.epic(10))).toHaveLength(1);
      const { purchases } = await mine(app, buyer.cookie);
      expect(purchases).toEqual([{ ...receipt, listingId: null, balance: RECYCLE_VALUE.mythic - 150 }]);
      await expectLedgerConsistent(app, forged.splice(0));
    });

    it("deleting a buyer's account leaves the seller's sale and fee, which the audit accepts as a sale to a deleted account", async () => {
      const seller = await holding([ID.epic(11)]);
      const buyer = await funded(200);
      await bought(app, buyer, (await listed(app, seller, ID.epic(11), 150)).listingId);
      await deleteAccounts(app.db, [buyer.account.id]);
      expect(await ledgerOf(app, seller.account.id)).toHaveLength(2);
      expect((await mine(app, seller.cookie)).closed).toEqual([
        expect.objectContaining({ status: "sold", proceeds: 150 - marketFee(150) }),
      ]);
      await expectLedgerConsistent(app, forged.splice(0));
    });
  });

  describe("the owner reset (economy.md §8.10)", () => {
    it("cancels the account's listings and deletes every card, bought ones too, zeroing the balance with one owner_reset row", async () => {
      const target = await holding([ID.epic(20), ID.epic(21), ID.common(70)]);
      const other = await holding([ID.epic(22)]);
      await fund(app, target, snapshotId, 1_000, now);
      const theirs = await bought(app, target, (await listed(app, other, ID.epic(22), 200)).listingId);
      const live = await listed(app, target, ID.epic(20), 200);
      const buyer = await funded(300);
      await bought(app, buyer, (await listed(app, target, ID.epic(21), 200)).listingId);
      tick();
      expect(
        await resetCollection(app.db, target.account.login, { confirm: false, clock: () => now }),
      ).toMatchObject({
        listings: 1,
        applied: false,
      });
      const balance = await balanceOf(app, target.account.id);
      const result = await resetCollection(app.db, target.account.login, { confirm: true, clock: () => now });
      expect(result).toMatchObject({ listings: 1, balance, applied: true });
      expect(await app.db.select().from(cards).where(eq(cards.accountId, target.account.id))).toEqual([]);
      const [row] = await app.db
        .select({
          status: marketListings.status,
          cardId: marketListings.cardId,
          closedAt: marketListings.closedAt,
        })
        .from(marketListings)
        .where(eq(marketListings.id, live.listingId));
      expect(row).toEqual({ status: "cancelled", cardId: null, closedAt: now });
      expect((await ledgerOf(app, target.account.id)).at(-1)).toMatchObject({
        kind: "owner_reset",
        amount: -balance,
        balanceAfter: 0,
      });
      // The purchases stay: the target's receipt, and the buyer's card bought from it.
      expect((await mine(app, target.cookie)).purchases).toEqual([
        { ...theirs, card: { ...theirs.card, isNew: false }, balance: 0 },
      ]);
      expect(await heldCopies(app, buyer.account.id, ID.epic(21))).toHaveLength(1);
      const res = await buyListing(app, buyer.cookie, live.listingId);
      expect(marketErrorOf(res).code).toBe("listing_unavailable");
      await expectLedgerConsistent(app, forged.splice(0));
    });

    it("with --keep-karma leaves the balance and writes no ledger row", async () => {
      const target = await holding([ID.epic(23)]);
      await fund(app, target, snapshotId, 100, now);
      await listed(app, target, ID.epic(23), 100);
      tick();
      const before = await ledgerOf(app, target.account.id);
      await resetCollection(app.db, target.account.login, {
        confirm: true,
        keepKarma: true,
        clock: () => now,
      });
      expect(await ledgerOf(app, target.account.id)).toEqual(before);
      expect(await wallet(target)).toMatchObject({ balance: RECYCLE_VALUE.mythic, activeListings: 0 });
    });
  });

  describe("concurrency (economy.md §8.9, §14)", () => {
    it("two buyers of one listing: exactly one 201 and one 409 listing_unavailable, one purchase, the seller credited once", async () => {
      const seller = await holding([ID.legendary(10)]);
      const buyers = await Promise.all([0, 1].map(() => funded(MARKET_PRICE_MAX.legendary)));
      const listing = await listed(app, seller, ID.legendary(10), MARKET_PRICE_MAX.legendary);
      const results = await Promise.all(
        buyers.map((buyer) => buyListing(app, buyer.cookie, listing.listingId)),
      );
      expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
      expect(results.map((res) => res.statusCode === 409 && marketErrorOf(res).code).filter(Boolean)).toEqual(
        ["listing_unavailable"],
      );
      expect(
        await app.db.select().from(marketPurchases).where(eq(marketPurchases.listingId, listing.listingId)),
      ).toHaveLength(1);
      expect(await ledgerOf(app, seller.account.id)).toHaveLength(2);
    });

    it("a buy and a cancel of one listing: exactly one succeeds", async () => {
      for (let round = 0; round < 5; round += 1) {
        const seller = await holding([ID.rare(60)]);
        const buyer = await funded(100);
        const listing = await listed(app, seller, ID.rare(60), 30);
        const [buy, cancel] = await Promise.all([
          buyListing(app, buyer.cookie, listing.listingId),
          cancelListing(app, seller.cookie, listing.listingId),
        ]);
        const won = [
          buy.statusCode === 201,
          cancel.statusCode === 200 && cancel.json<Listing>().status === "cancelled",
        ];
        expect(won.filter(Boolean)).toHaveLength(1);
        if (buy.statusCode !== 201) expect(marketErrorOf(buy).code).toBe("listing_unavailable");
        if (cancel.statusCode !== 200) expect(marketErrorOf(cancel).code).toBe("listing_unavailable");
      }
    });

    it(
      "A buys B's listing while B buys A's, 50 times in parallel pairs: every request finishes and the ledgers balance",
      { timeout: HEAVY_MS },
      async () => {
        const a = await holding(copies(ID.common(80), MARKET_MAX_LISTINGS));
        const b = await holding(copies(ID.common(81), MARKET_MAX_LISTINGS));
        await fund(app, a, snapshotId, 50 * 5, now);
        await fund(app, b, snapshotId, 50 * 5, now);
        const fromA = await seedListings(app, a, ID.common(80), 5, MARKET_MAX_LISTINGS, now);
        const fromB = await seedListings(app, b, ID.common(81), 5, MARKET_MAX_LISTINGS, now);
        const results = await Promise.all(
          fromA.flatMap((listing, index) => [
            buyListing(app, b.cookie, listing.listingId),
            buyListing(app, a.cookie, fromB[index]?.listingId ?? ""),
          ]),
        );
        expect(results.map((res) => res.statusCode)).toEqual(results.map(() => 201));
        for (const client of [a, b]) {
          const sum = (await ledgerOf(app, client.account.id)).reduce(
            (total, entry) => total + entry.amount,
            0,
          );
          expect(await balanceOf(app, client.account.id)).toBe(sum);
        }
        await expectLedgerConsistent(app, forged.splice(0));
      },
    );

    it("two spends with the balance for one, a shop pack and a purchase: one 201, one 409 insufficient_funds, balance ≥ 0", async () => {
      const seller = await holding([ID.epic(30)]);
      const buyer = await player();
      // 400 exactly: a hundred Commons recycled for 2 each, then two hundred more.
      await grantCards(app, buyer.account.id, snapshotId, copies(ID.common(90), 201), now);
      expect((await recycle(app, buyer.cookie, recycleBody(ID.common(90), "common", 100))).statusCode).toBe(
        201,
      );
      expect((await recycle(app, buyer.cookie, recycleBody(ID.common(90), "common", 100))).statusCode).toBe(
        201,
      );
      expect(await balanceOf(app, buyer.account.id)).toBe(THEMED_PACK_PRICE);
      const listing = await listed(app, seller, ID.epic(30), THEMED_PACK_PRICE);
      const [shop, market] = await Promise.all([
        buyPack(app, buyer.cookie, "genre-comedy"),
        buyListing(app, buyer.cookie, listing.listingId),
      ]);
      expect([shop.statusCode, market.statusCode].sort()).toEqual([201, 409]);
      const refused = shop.statusCode === 409 ? shop : market;
      expect(marketErrorOf(refused)).toMatchObject({ code: "insufficient_funds", balance: 0 });
      expect(await balanceOf(app, buyer.account.id)).toBe(0);
    });

    it("a listing and a recycle racing for an entry's copies: the recycle never takes the listed card or the last copy", async () => {
      for (let round = 0; round < 5; round += 1) {
        const seller = await holding(copies(ID.uncommon(20), 2));
        const [listing, recycled] = await Promise.all([
          listCard(app, seller.cookie, ID.uncommon(20), 20),
          recycle(app, seller.cookie, recycleBody(ID.uncommon(20), "uncommon", 1)),
        ]);
        const held = await heldCopies(app, seller.account.id, ID.uncommon(20));
        expect(held.length).toBeGreaterThanOrEqual(1);
        if (listing.statusCode === 201) {
          const [row] = await app.db
            .select({ cardId: marketListings.cardId })
            .from(marketListings)
            .where(eq(marketListings.id, listing.json<Listing>().listingId));
          expect(held.map((card) => card.id)).toContain(row?.cardId);
        }
        expect([listing.statusCode, recycled.statusCode]).toContain(201);
      }
    });

    it("the same requestId twice in parallel: one 201 and one 200 with the same body, for a listing and a purchase", async () => {
      const seller = await holding(copies(ID.rare(70), 2));
      const requestId = randomUUID();
      const lists = await Promise.all(
        [0, 1].map(() => listCard(app, seller.cookie, ID.rare(70), 30, { requestId })),
      );
      expect(lists.map((res) => res.statusCode).sort()).toEqual([200, 201]);
      expect(lists[0]?.json()).toEqual(lists[1]?.json());
      const buyer = await funded(100);
      const listing = lists[0]?.json<Listing>();
      if (listing === undefined) throw new Error("a listing");
      const buyKey = randomUUID();
      const buys = await Promise.all(
        [0, 1].map(() => buyListing(app, buyer.cookie, listing.listingId, buyKey)),
      );
      expect(buys.map((res) => res.statusCode).sort()).toEqual([200, 201]);
      expect(buys[0]?.json()).toEqual(buys[1]?.json());
      expect(await ledgerOf(app, buyer.account.id)).toHaveLength(2);
    });

    it(
      "101 parallel purchases by one buyer in a window: 100 succeed, the rest are market_limit buyer_purchases",
      { timeout: HEAVY_MS },
      async () => {
        const sellers = await Promise.all([0, 1, 2].map(() => holding(copies(ID.common(95), 34))));
        const buyer = await funded(MARKET_WINDOW_PURCHASES * 6);
        const listings: { listingId: string }[] = [];
        for (const seller of sellers)
          listings.push(...(await seedListings(app, seller, ID.common(95), 5, 34, now)));
        const results = await Promise.all(
          listings
            .slice(0, MARKET_WINDOW_PURCHASES + 1)
            .map((listing) => buyListing(app, buyer.cookie, listing.listingId)),
        );
        const statuses = results.map((res) => res.statusCode);
        expect(statuses.filter((status) => status === 201)).toHaveLength(MARKET_WINDOW_PURCHASES);
        const refused = results.filter((res) => res.statusCode !== 201);
        expect(refused.map((res) => marketErrorOf(res).limit)).toEqual(["buyer_purchases"]);
      },
    );

    it("purchases racing a seller to MARKET_WINDOW_PROCEEDS: exactly the ones that fit succeed", async () => {
      const seller = await holding([ID.mythic(7), ID.mythic(8), ID.mythic(9)]);
      const buyers = await Promise.all([0, 1, 2].map(() => funded(MARKET_PRICE_MAX.mythic)));
      const listings = [];
      for (const id of [ID.mythic(7), ID.mythic(8), ID.mythic(9)])
        listings.push(await listed(app, seller, id, MARKET_PRICE_MAX.mythic));
      const results = await Promise.all(
        listings.map((listing, index) =>
          buyListing(app, (buyers[index] as SignedInClient).cookie, listing.listingId),
        ),
      );
      expect(results.filter((res) => res.statusCode === 201)).toHaveLength(2);
      expect(results.filter((res) => res.statusCode === 409).map((res) => marketErrorOf(res).limit)).toEqual([
        "seller_proceeds",
      ]);
      expect(await balanceOf(app, seller.account.id)).toBe(
        2 * (MARKET_PRICE_MAX.mythic - marketFee(MARKET_PRICE_MAX.mythic)),
      );
    });
  });

  describe("GET /api/market/listings", () => {
    let alice: SignedInClient;
    let bob: SignedInClient;
    const all: Listing[] = [];
    const alices = new Set<string>();

    beforeAll(async () => {
      await clearMarket();
      alice = await holding([EREN, PERCENT, UNDERSCORE, BACKSLASH, POKEMON, ...copies(ID.common(100), 30)]);
      bob = await holding([ID.mythic(10), ID.legendary(20), ...copies(ID.common(101), 30)]);
      for (const [client, id, price] of [
        [alice, EREN, 50],
        [alice, PERCENT, 5],
        [alice, UNDERSCORE, 6],
        [alice, BACKSLASH, 7],
        [alice, POKEMON, 8],
        [bob, ID.mythic(10), 20_000],
        [bob, ID.legendary(20), 900],
      ] as const) {
        const listing = await listed(app, client, id, price);
        all.push(listing);
        if (client === alice) alices.add(listing.listingId);
        tick();
      }
      for (let i = 0; i < 30; i += 1) {
        const own = await listed(app, alice, ID.common(100), 10 + (i % 5));
        alices.add(own.listingId);
        all.push(own, await listed(app, bob, ID.common(101), 10 + (i % 7)));
        tick();
      }
    }, HEAVY_MS);

    it("pages every live listing of every account, cheapest first, marking the caller's own, and keyset-pages the rest", async () => {
      const first = await page(app, alice.cookie);
      expect(first.listings).toHaveLength(MARKET_PAGE_SIZE);
      expect(first.nextCursor).not.toBeNull();
      const second = await page(app, alice.cookie, `cursor=${first.nextCursor ?? ""}`);
      expect(second.filterFranchiseIds).toBeNull();
      expect(second.nextCursor).toBeNull();
      const seen = [...first.listings, ...second.listings];
      expect(seen).toHaveLength(all.length);
      expect(new Set(seen.map((listing) => listing.listingId)).size).toBe(all.length);
      const prices = seen.map((listing) => listing.price);
      expect(prices).toEqual([...prices].sort((x, y) => x - y));
      for (const listing of seen) expect(listing.mine, listing.listingId).toBe(alices.has(listing.listingId));
      expect(alices.size).toBe(35);
      const bobs = await page(app, bob.cookie, "rarity=mythic");
      expect(bobs.listings).toEqual([expect.objectContaining({ price: 20_000, mine: true })]);
    });

    it("sorts by price descending and by newest, each with its own cursor; a cursor of another sort is 400", async () => {
      const desc = await page(app, alice.cookie, "sort=price_desc");
      expect(desc.listings[0]).toMatchObject({ price: 20_000 });
      const more = await page(app, alice.cookie, `sort=price_desc&cursor=${desc.nextCursor ?? ""}`);
      const descPrices = [...desc.listings, ...more.listings].map((listing) => listing.price);
      expect(descPrices).toEqual([...descPrices].sort((x, y) => y - x));
      const newest = await page(app, alice.cookie, "sort=newest");
      const times = newest.listings.map((listing) => listing.listedAt);
      expect(times).toEqual([...times].sort().reverse());
      const rest = await page(app, alice.cookie, `sort=newest&cursor=${newest.nextCursor ?? ""}`);
      expect(newest.listings.length + rest.listings.length).toBe(all.length);
      const wrong = await browse(app, alice.cookie, `sort=price_asc&cursor=${newest.nextCursor ?? ""}`);
      expect(wrong.statusCode).toBe(400);
    });

    it("lists on the first page every franchise with a live listing, whatever the filter, in popularity order", async () => {
      const filtered = await page(app, alice.cookie, "rarity=mythic");
      const listedFranchises = new Set(all.flatMap((listing) => listing.character.franchiseIds));
      const ranked = await app.db
        .select({ id: poolSnapshotFranchises.franchiseId })
        .from(poolSnapshotFranchises)
        .where(eq(poolSnapshotFranchises.snapshotId, snapshotId))
        .orderBy(asc(poolSnapshotFranchises.popularityRank), asc(poolSnapshotFranchises.franchiseId));
      const expected = ranked.map((row) => row.id).filter((id) => listedFranchises.has(id));
      expect(expected.length).toBeGreaterThan(1);
      expect(filtered.filterFranchiseIds).toEqual(expected);
      const named = new Set(filtered.franchises.map((ref) => ref.id));
      for (const id of expected) expect(named.has(id)).toBe(true);
    });

    it("filters by rarity, character and franchise", async () => {
      expect(
        (await page(app, alice.cookie, "rarity=legendary")).listings.map((listing) => listing.price),
      ).toEqual([900]);
      expect(
        (await page(app, alice.cookie, `characterId=${EREN}`)).listings.map(
          (listing) => listing.character.id,
        ),
      ).toEqual([EREN]);
      const titan = await page(app, alice.cookie, `franchiseId=${ATTACK_ON_TITAN}`);
      expect(titan.listings.map((listing) => listing.character.id)).toContain(EREN);
      for (const listing of titan.listings) expect(listing.character.franchiseIds).toContain(ATTACK_ON_TITAN);
      expect((await page(app, alice.cookie, "franchiseId=1")).listings).toEqual([]);
    });

    it("searches names, native names and franchise titles, normalised as the collection does", async () => {
      const found = async (q: string) =>
        (await page(app, alice.cookie, `q=${encodeURIComponent(q)}`)).listings.map(
          (listing) => listing.character.id,
        );
      expect(await found("eren")).toEqual([EREN]);
      expect(await found("ＥＲＥＮ yeager")).toEqual([EREN]);
      expect(await found("エレン")).toEqual([EREN]);
      expect(await found("進撃")).toEqual(expect.arrayContaining([EREN]));
      expect(await found("titan eren")).toEqual([EREN]);
      expect(await found("pokemon")).toEqual([POKEMON]);
      expect(await found("eren pokemon")).toEqual([]);
    });

    it("matches %, _ and \\ as the characters they are, never as patterns", async () => {
      const found = async (q: string) =>
        (await page(app, alice.cookie, `q=${encodeURIComponent(q)}`)).listings.map(
          (listing) => listing.character.id,
        );
      expect(await found("%")).toEqual([PERCENT]);
      expect(await found("50%")).toEqual([PERCENT]);
      expect(await found("_")).toEqual([UNDERSCORE]);
      expect(await found("e_c")).toEqual([UNDERSCORE]);
      expect(await found("k\\s")).toEqual([BACKSLASH]);
      expect(await found("\\")).toEqual([BACKSLASH]);
    });

    it("refuses an unknown parameter, a malformed id, an empty or overlong query and a forged cursor with 400", async () => {
      for (const query of [
        "seller=1",
        "characterId=abc",
        "characterId=0",
        "characterId=01",
        "characterId=1.5",
        "characterId=-1",
        "characterId=99999999999",
        "franchiseId=2147483648",
        "rarity=masterwork",
        "sort=cheapest",
        "q=",
        `q=${"a".repeat(101)}`,
        "cursor=bm90IGEgY3Vyc29y",
        "cursor=%25%25",
        "rarity=common&rarity=rare",
      ]) {
        const res = await browse(app, alice.cookie, query);
        expect(res.statusCode, query).toBe(400);
        expect(marketErrorOf(res).code).toBe("validation_failed");
      }
      expect((await browse(app, undefined)).statusCode).toBe(401);
    });

    it("never returns an expired listing, and counts it out of filterFranchiseIds", async () => {
      tick(TTL_MS);
      const after = await page(app, alice.cookie);
      expect(after.listings).toEqual([]);
      expect(after.filterFranchiseIds).toEqual([]);
      expect(after.nextCursor).toBeNull();
    });
  });
});
