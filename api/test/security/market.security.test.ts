import { randomUUID } from "node:crypto";
import type { Listing, ListingsPage, PurchaseReceipt } from "@anime-tcg/shared/api";
import {
  MARKET_PRICE_MAX,
  MARKET_PRICE_MIN,
  MARKET_WINDOW_PAIR,
  RECYCLE_VALUE,
} from "@anime-tcg/shared/economy";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { main as auditMarket } from "../../src/cli/audit-market.js";
import { cards, marketListings, marketPurchases, sessions } from "../../src/db/schema.js";
import { marketFee } from "../../src/domain/economy/fee.js";
import { hashSessionId, newSessionId } from "../../src/domain/session/ids.js";
import { CARD_ACTION_RATE_LIMIT } from "../../src/routes/limits.js";
import {
  balanceOf,
  entryOf,
  expectClockBehindDatabase,
  expectLedgerConsistent,
  getWallet,
  ID,
  ledgerOf,
  pastClockStart,
  recycle,
  recycleBody,
} from "../economy-support.js";
import {
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
  patientDb,
} from "../market-support.js";
import {
  body,
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  loadSnapshot,
  newPlayer,
} from "../pool-support.js";
import {
  cookieHeader,
  createTestApp,
  send,
  type SignedInClient,
  TEST_SESSION_SECRET,
  testConfig,
  testDatabaseUrl,
  WEB_ORIGIN,
} from "../support.js";

const MINUTE = 60_000;
/** A name built to break markup and the reading order; the market must carry it as text. */
const HOSTILE = ID.common(5);
const HOSTILE_NAME = `<script>alert(1)</script>${String.fromCodePoint(0x202e)}`;

/**
 * The adversarial suite of economy.md §14 for the market (PR 3, T3,
 * docs/05-security.md): forged sessions, a double buy through two app
 * instances, tampered and overflowing bodies, replays across accounts, the
 * mint and farming loops and `audit-market`'s report on them, hostile
 * search strings and the rate limit. After every test the ledger audits clean.
 */
describe("market, adversarial (economy.md §10, §14)", () => {
  let app: App;
  let twin: App;
  let now = pastClockStart();
  const made: string[] = [];
  const snapshots: number[] = [];
  let snapshotId = 0;

  const player = async () => {
    const client = await newPlayer(app, "ms");
    made.push(client.account.id);
    return client;
  };
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

  beforeAll(async () => {
    const config = testConfig({ ACCOUNT_CAP: "1000" });
    app = await createTestApp({ config, db: patientDb(), clock: () => now });
    twin = await createTestApp({ config, db: patientDb(), clock: () => now });
    const current = await currentSnapshotId(app.db);
    if (current !== null) throw new Error(`snapshot ${current} is current; a previous run left it behind`);
    const pool = marketPool();
    pool.characters = pool.characters.map((character) =>
      character.id === HOSTILE ? { ...character, name: HOSTILE_NAME } : character,
    );
    snapshotId = (await loadSnapshot(app.db, pool, now)).version;
    snapshots.push(snapshotId);
  });
  afterAll(async () => {
    try {
      expectClockBehindDatabase(now);
      await expectLedgerConsistent(app);
    } finally {
      // Whatever the audit found, the next file must not find this file's snapshot current.
      await deleteAccounts(app.db, made);
      await deleteSnapshots(snapshots);
      await twin.close();
      await app.close();
    }
  });

  describe("1. session cookies", () => {
    it("answers forged, flipped, expired and never-issued cookies 401 on every market route, and moves nothing", async () => {
      const victim = await holding([ID.rare(1), ID.rare(2)]);
      await fund(app, victim, snapshotId, 100, now);
      const listing = await listed(app, victim, ID.rare(1), 30);
      const { cookieValue } = await app.sessions.create(victim.account.id, "test", new Date());
      await app.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - MINUTE) })
        .where(eq(sessions.id, hashSessionId(TEST_SESSION_SECRET, cookieValue)));
      const forgeries = [
        `${victim.cookie.slice(0, -1)}${victim.cookie.endsWith("A") ? "B" : "A"}`,
        victim.cookie.slice(0, 42),
        newSessionId(),
        hashSessionId(TEST_SESSION_SECRET, victim.cookie),
        cookieValue,
      ];
      const routes = [
        ["GET", "/api/market/listings", undefined],
        ["GET", "/api/market/mine", undefined],
        [
          "POST",
          "/api/market/listings",
          { requestId: randomUUID(), characterId: ID.rare(2), rarity: "rare", price: 30 },
        ],
        ["POST", `/api/market/listings/${listing.listingId}/buy`, { requestId: randomUUID() }],
        ["POST", `/api/market/listings/${listing.listingId}/cancel`, {}],
      ] as const;
      for (const cookie of forgeries) {
        for (const [method, url, payload] of routes) {
          const res = await send(app, { method, url, cookie, payload });
          expect(res.statusCode, `${method} ${url}`).toBe(401);
          expect(marketErrorOf(res).code).toBe("unauthenticated");
        }
      }
      expect(await ledgerOf(app, victim.account.id)).toHaveLength(1);
      expect(body<{ activeListings: number }>(await getWallet(app, victim.cookie)).activeListings).toBe(1);
    });
  });

  describe("2. double buy, self-trade and replays across accounts", () => {
    it("two buyers of one listing through two app instances on one database: exactly one purchase", async () => {
      for (let round = 0; round < 5; round += 1) {
        const seller = await holding([ID.legendary(1)]);
        const buyers = await Promise.all([0, 1].map(() => funded(MARKET_PRICE_MIN.legendary)));
        const listing = await listed(app, seller, ID.legendary(1), MARKET_PRICE_MIN.legendary);
        const results = await Promise.all([
          buyListing(app, buyers[0]?.cookie, listing.listingId),
          buyListing(twin, buyers[1]?.cookie, listing.listingId),
        ]);
        expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
        expect(
          await app.db.select().from(marketPurchases).where(eq(marketPurchases.listingId, listing.listingId)),
        ).toHaveLength(1);
        expect(await balanceOf(app, seller.account.id)).toBe(
          MARKET_PRICE_MIN.legendary - marketFee(MARKET_PRICE_MIN.legendary),
        );
      }
    });

    it("buying one's own listing is 409 own_listing and writes nothing, through either instance", async () => {
      const seller = await holding([ID.rare(3)]);
      await fund(app, seller, snapshotId, 100, now);
      const listing = await listed(app, seller, ID.rare(3), 30);
      for (const instance of [app, twin]) {
        const res = await buyListing(instance, seller.cookie, listing.listingId);
        expect(res.statusCode).toBe(409);
        expect(marketErrorOf(res).code).toBe("own_listing");
      }
      expect(await ledgerOf(app, seller.account.id)).toHaveLength(1);
      expect(await heldCopies(app, seller.account.id, ID.rare(3))).toHaveLength(1);
    });

    it("account B sending A's key buys for B: a key is scoped to its account", async () => {
      const seller = await holding([ID.rare(4), ID.rare(5)]);
      const [a, b] = await Promise.all([funded(100), funded(100)]);
      const key = randomUUID();
      const first = await listed(app, seller, ID.rare(4), 30);
      const second = await listed(app, seller, ID.rare(5), 30);
      expect((await buyListing(app, a?.cookie, first.listingId, key)).statusCode).toBe(201);
      const theirs = await buyListing(app, b?.cookie, second.listingId, key);
      expect(theirs.statusCode).toBe(201);
      expect(theirs.json<PurchaseReceipt>().listingId).toBe(second.listingId);
      // B replaying the key on A's listing is B's own key: another listing, so 409.
      expect(marketErrorOf(await buyListing(app, b?.cookie, first.listingId, key)).code).toBe(
        "request_id_reused",
      );
    });
  });

  describe("3. tampered bodies: the server holds the card, the fee and every amount", () => {
    it.each([
      ["cardId", (victimCard: string) => ({ cardId: victimCard })],
      ["kind", () => ({ kind: "card" })],
      ["variant", () => ({ variant: "standard" })],
      ["escrowId", () => ({ escrowId: randomUUID() })],
      ["fee", () => ({ fee: 1 })],
      ["expiresAt", () => ({ expiresAt: new Date(0).toISOString() })],
      ["sellerId", () => ({ sellerId: randomUUID() })],
    ])("a listing body with %s is 400, and another account's card is untouched", async (_field, extra) => {
      const victim = await holding([ID.rare(6)]);
      const [card] = await heldCopies(app, victim.account.id, ID.rare(6));
      const attacker = await holding([ID.rare(6)]);
      const res = await listCard(app, attacker.cookie, ID.rare(6), 30, { extra: extra(card?.id ?? "") });
      expect(res.statusCode).toBe(400);
      expect(marketErrorOf(res).code).toBe("validation_failed");
      expect(await entryOf(app, victim.cookie, ID.rare(6))).toMatchObject({ count: 1, listed: 0 });
      expect(await entryOf(app, attacker.cookie, ID.rare(6))).toMatchObject({ count: 1, listed: 0 });
    });

    it("refuses negative, zero, fractional, string, null, infinite, unsafe and oversized prices and ids with 400, writing nothing", async () => {
      const seller = await holding([ID.rare(7)]);
      const base = { requestId: randomUUID(), characterId: ID.rare(7), rarity: "rare", price: 30 };
      const raw = (text: string) =>
        send(app, {
          method: "POST",
          url: "/api/market/listings",
          cookie: seller.cookie,
          payload: text,
          headers: { "content-type": "application/json" },
        });
      for (const value of ["-1", "0", "1.5", '"30"', "null", "1e400", "9007199254740993", "-0.5"]) {
        for (const field of ["price", "characterId"]) {
          const text = JSON.stringify(base).replace(
            field === "price" ? '"price":30' : `"characterId":${ID.rare(7)}`,
            `"${field}":${value}`,
          );
          const res = await raw(text);
          expect(res.statusCode, `${field} ${value}`).toBe(400);
        }
      }
      // Over MAX_ENTRY_AMOUNT, and past a Postgres integer.
      expect(await raw(JSON.stringify({ ...base, price: 1_000_001 }))).toMatchObject({ statusCode: 400 });
      expect(await raw(JSON.stringify({ ...base, characterId: 2_147_483_648 }))).toMatchObject({
        statusCode: 400,
      });
      expect(
        await app.db.select().from(marketListings).where(eq(marketListings.sellerId, seller.account.id)),
      ).toEqual([]);
    });

    it("refuses a listing claiming a rarity the card does not have, and no route changes a listing's price", async () => {
      const seller = await holding([ID.common(10)]);
      const res = await listCard(app, seller.cookie, ID.common(10), MARKET_PRICE_MAX.mythic, {
        rarity: "mythic",
      });
      expect(res.statusCode).toBe(409);
      expect(marketErrorOf(res).code).toBe("not_enough_copies");
      const listing = await listed(app, seller, ID.common(10), 5);
      for (const [method, url] of [
        ["PATCH", `/api/market/listings/${listing.listingId}`],
        ["POST", `/api/market/listings/${listing.listingId}`],
        ["POST", `/api/market/listings/${listing.listingId}/price`],
      ] as const) {
        const changed = await send(app, { method, url, cookie: seller.cookie, payload: { price: 25 } });
        expect(changed.statusCode, `${method} ${url}`).toBe(404);
      }
      const [row] = await app.db
        .select({ price: marketListings.price })
        .from(marketListings)
        .where(eq(marketListings.id, listing.listingId));
      expect(row).toEqual({ price: 5 });
    });

    it("cancelling another account's listing is 404 and leaves it live; a listing id that is not a uuid is 400", async () => {
      const seller = await holding([ID.rare(8)]);
      const attacker = await player();
      const listing = await listed(app, seller, ID.rare(8), 30);
      expect((await cancelListing(app, attacker.cookie, listing.listingId)).statusCode).toBe(404);
      for (const id of ["x", "1; drop table market_listings", "%00"]) {
        expect((await cancelListing(app, attacker.cookie, encodeURIComponent(id))).statusCode, id).toBe(400);
        expect((await buyListing(app, attacker.cookie, encodeURIComponent(id))).statusCode, id).toBe(400);
      }
      const [row] = await app.db
        .select({ status: marketListings.status })
        .from(marketListings)
        .where(eq(marketListings.id, listing.listingId));
      expect(row).toEqual({ status: "active" });
    });
  });

  describe("4. no path from nothing to Karma", () => {
    it("an account with no cards and no Karma calls every market route; its balance stays 0 and it holds nothing", async () => {
      const seller = await holding([ID.rare(9)]);
      const listing = await listed(app, seller, ID.rare(9), 30);
      const nobody = await player();
      const calls = [
        listCard(app, nobody.cookie, ID.rare(9), 30),
        buyListing(app, nobody.cookie, listing.listingId),
        cancelListing(app, nobody.cookie, listing.listingId),
        browse(app, nobody.cookie),
        send(app, { method: "GET", url: "/api/market/mine", cookie: nobody.cookie }),
      ];
      const statuses = (await Promise.all(calls)).map((res) => res.statusCode);
      expect(statuses).toEqual([409, 409, 404, 200, 200]);
      expect(await balanceOf(app, nobody.account.id)).toBe(0);
      expect(await ledgerOf(app, nobody.account.id)).toEqual([]);
      expect(await app.db.select().from(cards).where(eq(cards.accountId, nobody.account.id))).toEqual([]);
    });
  });

  describe("5. mint loops", () => {
    it("buying a card at the floor and recycling it loses Karma in every tier", () => {
      for (const tier of RARITIES) expect(RECYCLE_VALUE[tier], tier).toBeLessThan(MARKET_PRICE_MIN[tier]);
    });

    it("through the routes: a Common bought at the floor and recycled returns 2 of the 5 it cost", async () => {
      const seller = await holding([ID.common(11)]);
      const buyer = await holding([ID.common(11)]);
      await fund(app, buyer, snapshotId, 1, now);
      const start = await balanceOf(app, buyer.account.id);
      await bought(app, buyer, (await listed(app, seller, ID.common(11), MARKET_PRICE_MIN.common)).listingId);
      expect((await recycle(app, buyer.cookie, recycleBody(ID.common(11), "common", 1))).statusCode).toBe(
        201,
      );
      expect(await balanceOf(app, buyer.account.id)).toBe(
        start - MARKET_PRICE_MIN.common + RECYCLE_VALUE.common,
      );
    });
  });

  describe("6. farming between accounts (economy.md §10)", () => {
    it("two accounts trading a Common back and forth at the cap lose the fee every round, and audit-market reports the pair", async () => {
      const main = await holding([ID.common(12)]);
      const alt = await player();
      await fund(app, main, snapshotId, 100, now);
      await fund(app, alt, snapshotId, 100, now);
      const total = async () =>
        (await balanceOf(app, main.account.id)) + (await balanceOf(app, alt.account.id));
      const fee = marketFee(MARKET_PRICE_MAX.common);
      let holder: SignedInClient = main;
      let other: SignedInClient = alt;
      for (let round = 0; round < 6; round += 1) {
        const before = await total();
        now = new Date(now.getTime() + 10_000);
        const listing = await listed(app, holder, ID.common(12), MARKET_PRICE_MAX.common);
        await bought(app, other, listing.listingId);
        expect(await total()).toBe(before - fee);
        [holder, other] = [other, holder];
      }
      const lines: string[] = [];
      const code = await auditMarket([], testDatabaseUrl(), {
        stdout: { write: (text: string) => lines.push(text) },
        stderr: { write: (text: string) => lines.push(`stderr: ${text}`) },
        clock: () => now,
      });
      expect(code).toBe(0);
      const report = lines.join("");
      const pair = (text: string) => text.includes(main.account.id) && text.includes(alt.account.id);
      expect(report).toContain("Net Karma per pair, last 7 days:");
      expect(
        report
          .split("\n")
          .filter(pair)
          .some((line) => line.includes("6 purchases")),
      ).toBe(true);
      expect(report).toContain("Same invite code, and traded:");
      expect(report.split("\n").some((line) => pair(line) && line.includes("same invite code"))).toBe(true);
      expect(report).toContain("Listings bought within 60 seconds:");
      expect(report).toContain("sold 0 cards at the floor and 3 at the cap");
    });

    it("the pair limit stops one alternate feeding one main at one Mythic at the cap a week", async () => {
      const main = await holding([ID.mythic(1), ID.mythic(2)]);
      const alt = await funded(2 * MARKET_WINDOW_PAIR);
      await bought(app, alt, (await listed(app, main, ID.mythic(1), MARKET_PRICE_MAX.mythic)).listingId);
      const second = await listed(app, main, ID.mythic(2), MARKET_PRICE_MIN.mythic);
      const res = await buyListing(app, alt.cookie, second.listingId);
      expect(res.statusCode).toBe(409);
      expect(marketErrorOf(res)).toMatchObject({ code: "market_limit", limit: "pair" });
    });
  });

  describe("7. hostile strings", () => {
    it("matches %, _, SQL, an RTL override and 100 combining marks as text, never as SQL or a pattern", async () => {
      const seller = await holding([HOSTILE]);
      await listed(app, seller, HOSTILE, 5);
      for (const q of [
        "%",
        "_",
        "'; drop table market_listings; --",
        String.fromCodePoint(0x202e),
        `a${String.fromCodePoint(0x301).repeat(99)}`,
      ]) {
        const res = await browse(app, seller.cookie, `q=${encodeURIComponent(q)}`);
        expect(res.statusCode, q).toBe(200);
      }
      const found = body<ListingsPage>(
        await browse(app, seller.cookie, `q=${encodeURIComponent("<script>")}`),
      );
      expect(found.listings.map((listing: Listing) => listing.character.name)).toEqual([HOSTILE_NAME]);
      const rtl = body<ListingsPage>(
        await browse(app, seller.cookie, `q=${encodeURIComponent(String.fromCodePoint(0x202e))}`),
      );
      expect(rtl.listings.map((listing) => listing.character.id)).toEqual([HOSTILE]);
      expect(
        body<ListingsPage>(
          await browse(app, seller.cookie, `q=${encodeURIComponent("'; drop table market_listings; --")}`),
        ).listings,
      ).toEqual([]);
      // The table is still there.
      expect(await app.db.select({ id: marketListings.id }).from(marketListings).limit(1)).toHaveLength(1);
    });
  });

  describe("8. brute force against CARD_ACTION_RATE_LIMIT", () => {
    it("the 31st listing, purchase or cancel from one address in a window is 429 and moves nothing", async () => {
      const client = await player();
      const address = "198.51.100.88";
      const call = (url: string, payload: unknown) =>
        app.inject({
          method: "POST",
          url,
          remoteAddress: address,
          headers: { origin: WEB_ORIGIN, cookie: cookieHeader(client.cookie) },
          payload: payload as Record<string, unknown>,
        });
      const missing = randomUUID();
      for (const [url, payload] of [
        [
          "/api/market/listings",
          () => ({ requestId: randomUUID(), characterId: ID.rare(10), rarity: "rare", price: 30 }),
        ],
        [`/api/market/listings/${missing}/buy`, () => ({ requestId: randomUUID() })],
        [`/api/market/listings/${missing}/cancel`, () => ({})],
      ] as const) {
        const statuses: number[] = [];
        for (let i = 0; i < CARD_ACTION_RATE_LIMIT.max; i += 1)
          statuses.push((await call(url, payload())).statusCode);
        expect(new Set(statuses), url).toEqual(new Set([url.endsWith("listings") ? 409 : 404]));
        const limited = await call(url, payload());
        expect(limited.statusCode, url).toBe(429);
        expect(marketErrorOf(limited).code).toBe("rate_limited");
      }
      expect(await ledgerOf(app, client.account.id)).toEqual([]);
    });
  });

  describe("9. copies of one entry across accounts", () => {
    it("a listing takes only the caller's own copy, even when another account holds the same entry", async () => {
      const a = await holding(copies(ID.uncommon(1), 2));
      const b = await holding([ID.uncommon(1)]);
      const listing = await listed(app, b, ID.uncommon(1), 20);
      const [row] = await app.db
        .select({ cardId: marketListings.cardId })
        .from(marketListings)
        .where(eq(marketListings.id, listing.listingId));
      const [own] = await heldCopies(app, b.account.id, ID.uncommon(1));
      expect(row?.cardId).toBe(own?.id);
      expect(await entryOf(app, a.cookie, ID.uncommon(1))).toMatchObject({
        count: 2,
        listed: 0,
        recyclable: 1,
      });
    });
  });
});
