import { randomUUID } from "node:crypto";
import type {
  PackOpened,
  RecycleReceipt,
  SessionResponse,
  ShopReceipt,
  ShopResponse,
  Wallet,
} from "@anime-tcg/shared/api";
import {
  MAX_BALANCE,
  PACK_CAP,
  PACK_SIZE,
  RECYCLE_VALUE,
  THEMED_PACK_PRICE,
} from "@anime-tcg/shared/economy";
import { RADIANT_ODDS, RADIANT_SLOT_ODDS, SLOT_FLOOR, SLOT_ODDS } from "@anime-tcg/shared/rarity";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { main as auditMain } from "../src/cli/audit-ledger.js";
import { createDb } from "../src/db/client.js";
import { accounts, cards, ledgerEntries, packOpenings, recycles } from "../src/db/schema.js";
import { resetCollection } from "../src/domain/collection/reset.js";
import { karmaRules } from "../src/domain/economy/rules.js";
import {
  balanceOf,
  buyPack,
  economyPool,
  entryOf,
  errorOf,
  expectLedgerConsistent,
  forgeBalance,
  getShop,
  getWallet,
  ID,
  inComedy,
  ledgerOf,
  recycle,
  recycleBody,
} from "./economy-support.js";
import {
  body,
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  forceNextPack,
  getCollection,
  getPacks,
  loadSnapshot,
  newPlayer,
  openPack,
  scriptedRng,
} from "./pool-support.js";
import { createTestApp, migrationsDatabaseUrl, send, type SignedInClient, testConfig } from "./support.js";

const MINUTE = 60_000;
/** The Comedy theme: every eligible genre is offered, and Comedy's set is half the pool. */
const COMEDY = "genre-comedy";

describe("economy routes (economy.md §8, §11.3, §14)", () => {
  let app: App;
  let now = new Date("2026-10-30T12:00:00.000Z");
  const rng = scriptedRng();
  const made: string[] = [];
  const forged: string[] = [];
  const snapshots: number[] = [];
  let snapshotId = 0;

  const player = async () => {
    const client = await newPlayer(app, "ec");
    made.push(client.account.id);
    return client;
  };

  /** Opens one free pack dealing exactly `ids`, ten minutes after the last, so the allowance always has one. */
  async function deal(client: SignedInClient, ids: readonly number[]): Promise<PackOpened> {
    now = new Date(now.getTime() + 10 * MINUTE);
    await forceNextPack(app.db, rng, snapshotId, ids);
    const res = await openPack(app, client.cookie);
    expect(res.statusCode, res.body).toBe(201);
    return body<PackOpened>(res);
  }

  /** A standard pack around `card`: the other four slots from the pool's tail, never `card` itself. */
  const packWith = (card: number, slot: "common" | "mythic" | "rare", n = 0): number[] => {
    const filler = [ID.common(200 - n), ID.common(199 - n), ID.uncommon(150 - n), ID.uncommon(149 - n)];
    if (slot === "common") return [card, filler[0] ?? 0, filler[1] ?? 0, filler[2] ?? 0, ID.rare(120 - n)];
    return [filler[0] ?? 0, filler[1] ?? 0, filler[3] ?? 0, filler[2] ?? 0, card];
  };

  /** A player holding `copies` copies of `card` (a Common in slot 1, or a Rare-or-better in slot 5). */
  async function holder(card: number, copies: number, slot: "common" | "mythic" | "rare" = "common") {
    const client = await player();
    for (let i = 0; i < copies; i += 1) await deal(client, packWith(card, slot, i));
    return client;
  }

  /** A player with 2 750 Karma, earned by recycling one Mythic duplicate; `mythicCopies − 1` copies stay. */
  async function earner(mythicCopies = 2) {
    const client = await holder(ID.mythic(1), mythicCopies, "mythic");
    const res = await recycle(app, client.cookie, recycleBody(ID.mythic(1), "mythic", 1));
    expect(res.statusCode, res.body).toBe(201);
    return client;
  }

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng, clock: () => now });
  });
  afterAll(async () => {
    await expectLedgerConsistent(app, forged);
    await deleteAccounts(app.db, made);
    await deleteSnapshots(snapshots);
    await app.close();
  });

  describe("before the owner has taken a snapshot", () => {
    beforeAll(async () => {
      const current = await currentSnapshotId(app.db);
      if (current !== null) throw new Error(`snapshot ${current} is current; a previous run left it behind`);
    });

    it("GET /api/shop answers no themes and snapshot: null", async () => {
      const { cookie } = await player();
      const res = await getShop(app, cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ themes: [], franchises: [], snapshot: null });
    });

    it("a purchase is 503 pool_unavailable and writes nothing, whatever the theme", async () => {
      const { cookie, account } = await player();
      for (const themeId of [COMEDY, "genre-nothing"]) {
        const res = await buyPack(app, cookie, themeId);
        expect(res.statusCode).toBe(503);
        expect(errorOf(res).code).toBe("pool_unavailable");
      }
      expect(await ledgerOf(app, account.id)).toEqual([]);
    });
  });

  describe("with a snapshot", () => {
    beforeAll(async () => {
      const summary = await loadSnapshot(app.db, economyPool(), now);
      snapshotId = summary.version;
      snapshots.push(snapshotId);
    });

    describe("GET /api/wallet", () => {
      it("answers a new account's balance of 0, no listings and every rule of §5", async () => {
        const { cookie } = await player();
        const res = await getWallet(app, cookie);
        expect(res.statusCode).toBe(200);
        expect(res.json<Wallet>()).toEqual({ balance: 0, activeListings: 0, rules: karmaRules() });
        expect(res.json<Wallet>().rules).toMatchObject({
          recycleValues: RECYCLE_VALUE,
          themedPackPrice: THEMED_PACK_PRICE,
          feeBps: 500,
          feeMin: 1,
          maxRecycleCount: 100,
          window: { seconds: 604_800, purchases: 100, spend: 55_000, proceeds: 55_000, pair: 27_500 },
        });
      });

      it("is 401 signed out and 400 with a query string", async () => {
        expect((await getWallet(app, undefined)).statusCode).toBe(401);
        const { cookie } = await player();
        const res = await send(app, { method: "GET", url: "/api/wallet?balance=1", cookie });
        expect(res.statusCode).toBe(400);
        expect(errorOf(res).code).toBe("validation_failed");
      });

      it("never names the currency: the api sends amounts, the UI the name", async () => {
        const { cookie } = await player();
        expect((await getWallet(app, cookie)).body).not.toMatch(/karma/i);
      });
    });

    describe("a timer opening", () => {
      it("credits no Karma and writes no ledger row", async () => {
        const client = await player();
        await deal(client, packWith(ID.common(1), "common"));
        expect(await balanceOf(app, client.account.id)).toBe(0);
        expect(await ledgerOf(app, client.account.id)).toEqual([]);
      });
    });

    describe("POST /api/collection/recycle", () => {
      it("credits exactly count × RECYCLE_VALUE, removes that many copies newest first, and keeps the first one pulled", async () => {
        const client = await holder(ID.common(1), 4);
        const before = await app.db
          .select({ id: cards.id, pulledAt: cards.pulledAt })
          .from(cards)
          .where(and(eq(cards.accountId, client.account.id), eq(cards.characterId, ID.common(1))))
          .orderBy(asc(cards.pulledAt));
        const res = await recycle(app, client.cookie, recycleBody(ID.common(1), "common", 3));
        expect(res.statusCode).toBe(201);
        const receipt = res.json<RecycleReceipt>();
        expect(receipt).toEqual({
          recycleId: expect.any(String) as string,
          recycledAt: now.toISOString(),
          recycled: { characterId: ID.common(1), rarity: "common", count: 3 },
          credited: 3 * RECYCLE_VALUE.common,
          balance: 3 * RECYCLE_VALUE.common,
        });
        const held = await app.db
          .select({ id: cards.id })
          .from(cards)
          .where(
            and(
              eq(cards.accountId, client.account.id),
              eq(cards.characterId, ID.common(1)),
              isNull(cards.removedAt),
            ),
          );
        expect(held).toEqual([{ id: before[0]?.id }]);
        const removed = await app.db
          .select({ id: cards.id })
          .from(cards)
          .where(eq(cards.removedByRecycle, receipt.recycleId));
        expect(removed.map((row) => row.id).sort()).toEqual(
          before
            .slice(1)
            .map((row) => row.id)
            .sort(),
        );
        expect(await ledgerOf(app, client.account.id)).toEqual([
          { seq: 1, kind: "recycle_credit", amount: 6, balanceAfter: 6 },
        ]);
        expect(
          await app.db
            .select({ count: recycles.count, unitValue: recycles.unitValue })
            .from(recycles)
            .where(eq(recycles.id, receipt.recycleId)),
        ).toEqual([{ count: 3, unitValue: RECYCLE_VALUE.common }]);
        expect(await entryOf(app, client.cookie, ID.common(1))).toMatchObject({
          count: 1,
          listed: 0,
          available: 1,
          recyclable: 0,
        });
        expect(body<Wallet>(await getWallet(app, client.cookie)).balance).toBe(6);
        const session = body<SessionResponse>(
          await send(app, { method: "GET", url: "/api/session", cookie: client.cookie }),
        );
        expect(session).toMatchObject({ account: { cards: 4 * PACK_SIZE - 3 } });
      });

      it("recycles every tier, a duplicate Mythic for 2 750", async () => {
        const client = await holder(ID.mythic(2), 3, "mythic");
        const res = await recycle(app, client.cookie, recycleBody(ID.mythic(2), "mythic", 2));
        expect(res.statusCode).toBe(201);
        expect(res.json<RecycleReceipt>()).toMatchObject({ credited: 5_500, balance: 5_500 });
      });

      it("shows the collection's additions: listed, available and recyclable = min(count − 1, available)", async () => {
        const client = await holder(ID.common(2), 3);
        const collection = body<{
          entries: { character: { id: number }; count: number; recyclable: number }[];
        }>(await getCollection(app, client.cookie));
        for (const entry of collection.entries) {
          expect(entry).toMatchObject({ listed: 0, available: entry.count, recyclable: entry.count - 1 });
        }
        expect(await entryOf(app, client.cookie, ID.common(2))).toMatchObject({ count: 3, recyclable: 2 });
      });

      it("never recycles the last copy: 409 not_enough_copies and nothing written", async () => {
        const client = await holder(ID.common(3), 2);
        const res = await recycle(app, client.cookie, recycleBody(ID.common(3), "common", 2));
        expect(res.statusCode).toBe(409);
        expect(errorOf(res)).toEqual({
          code: "not_enough_copies",
          message: "Not enough duplicates of that card",
        });
        const single = await recycle(app, client.cookie, recycleBody(ID.common(200), "common", 1));
        expect(errorOf(single).code).toBe("not_enough_copies");
        expect(await ledgerOf(app, client.account.id)).toEqual([]);
        expect(await app.db.select().from(recycles).where(eq(recycles.accountId, client.account.id))).toEqual(
          [],
        );
        expect(await entryOf(app, client.cookie, ID.common(3))).toMatchObject({ count: 2 });
      });

      it("refuses a character the account does not hold, one that does not exist and a rarity it does not hold it at", async () => {
        const owner = await holder(ID.common(4), 3);
        const other = await player();
        for (const [characterId, rarity] of [
          [ID.common(4), "common"],
          [999_999, "common"],
          [ID.common(4), "mythic"],
        ] as const) {
          const res = await recycle(app, other.cookie, recycleBody(characterId, rarity, 1));
          expect(res.statusCode).toBe(409);
          expect(errorOf(res).code).toBe("not_enough_copies");
        }
        const wrongRarity = await recycle(app, owner.cookie, recycleBody(ID.common(4), "rare", 1));
        expect(errorOf(wrongRarity).code).toBe("not_enough_copies");
        expect(await entryOf(app, owner.cookie, ID.common(4))).toMatchObject({ count: 3 });
      });

      it("answers a replay 200 with the original receipt and the current balance; another request with the key is 409", async () => {
        const client = await holder(ID.common(5), 4);
        const requestId = randomUUID();
        const first = await recycle(app, client.cookie, recycleBody(ID.common(5), "common", 1, requestId));
        expect(first.statusCode).toBe(201);
        await recycle(app, client.cookie, recycleBody(ID.common(5), "common", 1));
        now = new Date(now.getTime() + MINUTE);
        const replay = await recycle(app, client.cookie, recycleBody(ID.common(5), "common", 1, requestId));
        expect(replay.statusCode).toBe(200);
        expect(replay.json()).toEqual({ ...first.json<RecycleReceipt>(), balance: 2 * RECYCLE_VALUE.common });
        for (const changed of [
          recycleBody(ID.common(5), "common", 2, requestId),
          recycleBody(ID.common(6), "common", 1, requestId),
          recycleBody(ID.common(5), "uncommon", 1, requestId),
        ]) {
          const res = await recycle(app, client.cookie, changed);
          expect(res.statusCode).toBe(409);
          expect(errorOf(res).code).toBe("request_id_reused");
        }
        expect(await balanceOf(app, client.account.id)).toBe(2 * RECYCLE_VALUE.common);
        expect(await entryOf(app, client.cookie, ID.common(5))).toMatchObject({ count: 2 });
      });

      it("a refused request leaves no record, so its key succeeds later", async () => {
        const client = await holder(ID.common(7), 1);
        const requestId = randomUUID();
        expect(
          (await recycle(app, client.cookie, recycleBody(ID.common(7), "common", 1, requestId))).statusCode,
        ).toBe(409);
        await deal(client, packWith(ID.common(7), "common", 1));
        expect(
          (await recycle(app, client.cookie, recycleBody(ID.common(7), "common", 1, requestId))).statusCode,
        ).toBe(201);
      });

      it("at MAX_BALANCE − 1 refuses with 409 balance_limit and writes nothing", async () => {
        const client = await holder(ID.common(8), 2);
        forged.push(client.account.id);
        await forgeBalance(app, client.account.id, MAX_BALANCE - 1);
        const before = await ledgerOf(app, client.account.id);
        const res = await recycle(app, client.cookie, recycleBody(ID.common(8), "common", 1));
        expect(res.statusCode).toBe(409);
        expect(errorOf(res).code).toBe("balance_limit");
        expect(await ledgerOf(app, client.account.id)).toEqual(before);
        expect(await balanceOf(app, client.account.id)).toBe(MAX_BALANCE - 1);
        expect(await entryOf(app, client.cookie, ID.common(8))).toMatchObject({ count: 2 });
      });

      it.each([
        ["an amount", { amount: 2 }],
        ["a value", { value: 2 }],
        ["a credit", { credit: 2 }],
      ])("refuses a body with %s as an unknown field (400)", async (_label, extra) => {
        const client = await holder(ID.common(9), 2);
        const res = await recycle(app, client.cookie, {
          ...recycleBody(ID.common(9), "common", 1),
          ...extra,
        });
        expect(res.statusCode).toBe(400);
        expect(errorOf(res).code).toBe("validation_failed");
        expect(await ledgerOf(app, client.account.id)).toEqual([]);
      });

      it("is 401 signed out, 403 without an Origin and 400 with a query string", async () => {
        const client = await holder(ID.common(10), 2);
        const payload = recycleBody(ID.common(10), "common", 1);
        expect((await recycle(app, undefined, payload)).statusCode).toBe(401);
        const noOrigin = await send(app, {
          method: "POST",
          url: "/api/collection/recycle",
          cookie: client.cookie,
          origin: null,
          payload,
        });
        expect(noOrigin.statusCode).toBe(403);
        expect(errorOf(noOrigin).code).toBe("bad_origin");
        const query = await send(app, {
          method: "POST",
          url: "/api/collection/recycle?count=100",
          cookie: client.cookie,
          payload,
        });
        expect(query.statusCode).toBe(400);
        expect(await ledgerOf(app, client.account.id)).toEqual([]);
      });
    });

    describe("GET /api/shop", () => {
      it("offers every eligible genre without a command, with the free pack's tables, the Radiant rule and the theme's tier sizes", async () => {
        const { cookie } = await player();
        const res = await getShop(app, cookie);
        expect(res.statusCode).toBe(200);
        const shop = res.json<ShopResponse>();
        expect(shop.themes.map((theme) => [theme.id, theme.title])).toEqual([
          ["genre-action", "Action"],
          ["genre-comedy", "Comedy"],
        ]);
        expect(shop.snapshot?.version).toBe(snapshotId);
        const [action, comedy] = shop.themes;
        expect(action?.odds.tierSizes).toEqual({
          common: 210,
          uncommon: 150,
          rare: 120,
          epic: 72,
          legendary: 36,
          mythic: 12,
        });
        expect(comedy?.odds.tierSizes).toEqual({
          common: 105,
          uncommon: 75,
          rare: 60,
          epic: 36,
          legendary: 18,
          mythic: 6,
        });
        expect(comedy).toMatchObject({ cards: PACK_SIZE, price: THEMED_PACK_PRICE });
        expect(comedy?.odds.scale).toBe(1_000_000);
        expect(comedy?.odds.perSlot).toEqual(
          SLOT_ODDS.map((table, slot) => ({ floor: SLOT_FLOOR[slot], odds: { ...table } })),
        );
        expect(comedy?.odds.perPack).toEqual({
          common: 999_704,
          uncommon: 1_000_000,
          rare: 800_000,
          epic: 170_000,
          legendary: 27_500,
          mythic: 2_500,
        });
        expect(comedy?.odds.radiant).toEqual({
          chance: RADIANT_ODDS,
          odds: { ...RADIANT_SLOT_ODDS },
          lastSlot: "mythic",
        });
        // Comedy is every other entry: 50 franchises, most popular first.
        expect(comedy?.franchiseIds).toHaveLength(50);
        expect(comedy?.franchiseIds[0]).toBe(900_001);
        expect(new Set(shop.franchises.map((franchise) => franchise.id))).toEqual(
          new Set(shop.themes.flatMap((theme) => theme.franchiseIds)),
        );
      });

      it("is 401 signed out and 400 with a query string", async () => {
        expect((await getShop(app, undefined)).statusCode).toBe(401);
        const { cookie } = await player();
        expect((await send(app, { method: "GET", url: "/api/shop?theme=x", cookie })).statusCode).toBe(400);
      });
    });

    describe("POST /api/shop/buy", () => {
      it("debits 400, deals PACK_SIZE cards only from the theme's set and leaves the allowance unchanged", async () => {
        const client = await earner();
        const packsBefore = body<{ allowance: unknown }>(await getPacks(app, client.cookie)).allowance;
        const [anchorBefore] = await app.db
          .select({ anchor: accounts.packsAnchorAt, opened: accounts.freePacksOpened })
          .from(accounts)
          .where(eq(accounts.id, client.account.id));
        const res = await buyPack(app, client.cookie, COMEDY);
        expect(res.statusCode, res.body).toBe(201);
        const receipt = res.json<ShopReceipt>();
        expect(receipt).toMatchObject({
          themeId: COMEDY,
          price: THEMED_PACK_PRICE,
          balance: 2_750 - THEMED_PACK_PRICE,
        });
        expect(receipt.pack.cards).toHaveLength(PACK_SIZE);
        for (const card of receipt.pack.cards)
          expect(inComedy(card.character.id), String(card.character.id)).toBe(true);
        expect(receipt.pack.allowance).toEqual(packsBefore);
        const [anchorAfter] = await app.db
          .select({ anchor: accounts.packsAnchorAt, opened: accounts.freePacksOpened })
          .from(accounts)
          .where(eq(accounts.id, client.account.id));
        expect(anchorAfter).toEqual(anchorBefore);
        const [opening] = await app.db
          .select({
            source: packOpenings.source,
            themeId: packOpenings.themeId,
            entry: packOpenings.ledgerEntryId,
            price: packOpenings.price,
          })
          .from(packOpenings)
          .where(eq(packOpenings.id, receipt.pack.openingId));
        expect(opening).toMatchObject({ source: "shop", themeId: COMEDY, price: THEMED_PACK_PRICE });
        expect((await ledgerOf(app, client.account.id)).at(-1)).toEqual({
          seq: 2,
          kind: "shop_purchase",
          amount: -THEMED_PACK_PRICE,
          balanceAfter: 2_350,
        });
        expect(body<Wallet>(await getWallet(app, client.cookie)).balance).toBe(2_350);
      });

      it("answers a replay 200 with the same pack and price and the current balance; another theme with the key is 409", async () => {
        const client = await earner();
        const requestId = randomUUID();
        const first = await buyPack(app, client.cookie, COMEDY, requestId);
        expect(first.statusCode).toBe(201);
        expect((await buyPack(app, client.cookie, "genre-action")).statusCode).toBe(201);
        const replay = await buyPack(app, client.cookie, COMEDY, requestId);
        expect(replay.statusCode).toBe(200);
        const original = first.json<ShopReceipt>();
        expect(replay.json<ShopReceipt>()).toMatchObject({
          themeId: COMEDY,
          price: THEMED_PACK_PRICE,
          balance: 2_750 - 2 * THEMED_PACK_PRICE,
          pack: { openingId: original.pack.openingId, cards: original.pack.cards },
        });
        const other = await buyPack(app, client.cookie, "genre-action", requestId);
        expect(other.statusCode).toBe(409);
        expect(errorOf(other).code).toBe("request_id_reused");
        expect(await balanceOf(app, client.account.id)).toBe(2_750 - 2 * THEMED_PACK_PRICE);
      });

      it("shares the openings' keys: a timer key never buys, and a shop key never opens a timer pack", async () => {
        const client = await earner();
        const timerKey = randomUUID();
        now = new Date(now.getTime() + 10 * MINUTE);
        expect((await openPack(app, client.cookie, timerKey)).statusCode).toBe(201);
        const asShop = await buyPack(app, client.cookie, COMEDY, timerKey);
        expect(asShop.statusCode).toBe(409);
        expect(errorOf(asShop).code).toBe("request_id_reused");
        const shopKey = randomUUID();
        expect((await buyPack(app, client.cookie, COMEDY, shopKey)).statusCode).toBe(201);
        const asTimer = await openPack(app, client.cookie, shopKey);
        expect(asTimer.statusCode).toBe(409);
        expect(errorOf(asTimer).code).toBe("request_id_reused");
        expect(await balanceOf(app, client.account.id)).toBe(2_750 - THEMED_PACK_PRICE);
      });

      it("refuses an empty balance with 409 insufficient_funds carrying the balance, and writes nothing", async () => {
        const client = await holder(ID.common(11), 2);
        await recycle(app, client.cookie, recycleBody(ID.common(11), "common", 1));
        const res = await buyPack(app, client.cookie, COMEDY);
        expect(res.statusCode).toBe(409);
        expect(errorOf(res)).toMatchObject({ code: "insufficient_funds", balance: RECYCLE_VALUE.common });
        expect(errorOf(res).message).not.toMatch(/karma/i);
        expect(await ledgerOf(app, client.account.id)).toHaveLength(1);
        expect(
          await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, client.account.id)),
        ).toHaveLength(2);
      });

      it.each([
        ["an ineligible genre", "genre-sports"],
        ["an unknown theme id", "genre-nothing"],
        ["a franchise id", "franchise-900001"],
        ["a raw genre name", "Comedy"],
      ])("answers %s 404 theme_unavailable and writes nothing", async (_label, themeId) => {
        const client = await earner();
        const res = await buyPack(app, client.cookie, themeId);
        expect(res.statusCode).toBe(404);
        expect(errorOf(res).code).toBe("theme_unavailable");
        expect(await balanceOf(app, client.account.id)).toBe(2_750);
      });

      it("is 401 signed out, 403 without an Origin and 400 with an extra field", async () => {
        const client = await earner();
        expect((await buyPack(app, undefined, COMEDY)).statusCode).toBe(401);
        const noOrigin = await send(app, {
          method: "POST",
          url: "/api/shop/buy",
          cookie: client.cookie,
          origin: null,
          payload: { requestId: randomUUID(), themeId: COMEDY },
        });
        expect(noOrigin.statusCode).toBe(403);
        const extra = await send(app, {
          method: "POST",
          url: "/api/shop/buy",
          cookie: client.cookie,
          payload: { requestId: randomUUID(), themeId: COMEDY, price: 1 },
        });
        expect(extra.statusCode).toBe(400);
        expect(await balanceOf(app, client.account.id)).toBe(2_750);
      });
    });

    describe("reset-collection's Karma rule (§8.10)", () => {
      it("zeroes the balance with one owner_reset entry by default, and the dry run says so", async () => {
        const client = await earner();
        const preview = await resetCollection(app.db, client.account.login, { confirm: false });
        expect(preview).toMatchObject({ balance: 2_750, keepKarma: false, applied: false });
        expect(await balanceOf(app, client.account.id)).toBe(2_750);
        await resetCollection(app.db, client.account.login, { confirm: true });
        expect(await balanceOf(app, client.account.id)).toBe(0);
        expect(await ledgerOf(app, client.account.id)).toEqual([
          { seq: 1, kind: "recycle_credit", amount: 2_750, balanceAfter: 2_750 },
          { seq: 2, kind: "owner_reset", amount: -2_750, balanceAfter: 0 },
        ]);
        expect(await app.db.select().from(cards).where(eq(cards.accountId, client.account.id))).toEqual([]);
        // The recycle stays as history; its cards went with the reset.
        expect(
          await app.db.select().from(recycles).where(eq(recycles.accountId, client.account.id)),
        ).toHaveLength(1);
      });

      it("keeps the balance and writes no entry with --keep-karma, and writes none for a balance of 0", async () => {
        const client = await earner();
        const kept = await resetCollection(app.db, client.account.login, { confirm: true, keepKarma: true });
        expect(kept).toMatchObject({ balance: 2_750, keepKarma: true, applied: true });
        expect(await balanceOf(app, client.account.id)).toBe(2_750);
        expect(await ledgerOf(app, client.account.id)).toHaveLength(1);
        const empty = await player();
        await resetCollection(app.db, empty.account.login, { confirm: true });
        expect(await ledgerOf(app, empty.account.id)).toEqual([]);
      });
    });

    describe("deleting an account", () => {
      it("takes its ledger, recycles and shop openings with it", async () => {
        const client = await earner();
        expect((await buyPack(app, client.cookie, COMEDY)).statusCode).toBe(201);
        await app.db.delete(accounts).where(eq(accounts.id, client.account.id));
        expect(
          await app.db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, client.account.id)),
        ).toEqual([]);
        expect(await app.db.select().from(recycles).where(eq(recycles.accountId, client.account.id))).toEqual(
          [],
        );
        expect(
          await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, client.account.id)),
        ).toEqual([]);
      });
    });

    describe("concurrency (parallel inject() calls)", () => {
      it("two recycles of an entry's last duplicate: one 201, one 409 not_enough_copies, one credit", async () => {
        const client = await holder(ID.common(12), 2);
        const results = await Promise.all([
          recycle(app, client.cookie, recycleBody(ID.common(12), "common", 1)),
          recycle(app, client.cookie, recycleBody(ID.common(12), "common", 1)),
        ]);
        expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
        expect(results.map((res) => res.statusCode === 409 && errorOf(res).code).filter(Boolean)).toEqual([
          "not_enough_copies",
        ]);
        expect(await ledgerOf(app, client.account.id)).toHaveLength(1);
        expect(await entryOf(app, client.cookie, ID.common(12))).toMatchObject({ count: 1 });
      });

      it("ten parallel recycles of one copy each against five duplicates: exactly five 201 and one copy left", async () => {
        const client = await holder(ID.common(13), 6);
        const results = await Promise.all(
          Array.from({ length: 10 }, () =>
            recycle(app, client.cookie, recycleBody(ID.common(13), "common", 1)),
          ),
        );
        expect(results.filter((res) => res.statusCode === 201)).toHaveLength(5);
        expect(results.filter((res) => res.statusCode === 409)).toHaveLength(5);
        expect(await entryOf(app, client.cookie, ID.common(13))).toMatchObject({ count: 1, recyclable: 0 });
        expect(await balanceOf(app, client.account.id)).toBe(5 * RECYCLE_VALUE.common);
        expect((await ledgerOf(app, client.account.id)).map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
      });

      it("two shop purchases with the balance for one: one 201, one 409 insufficient_funds, the balance never below 0", async () => {
        const client = await holder(ID.common(14), 2);
        forged.push(client.account.id);
        await forgeBalance(app, client.account.id, THEMED_PACK_PRICE);
        const results = await Promise.all([
          buyPack(app, client.cookie, COMEDY),
          buyPack(app, client.cookie, COMEDY),
        ]);
        expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
        const refused = results.find((res) => res.statusCode === 409);
        expect(refused && errorOf(refused)).toMatchObject({ code: "insufficient_funds", balance: 0 });
        expect(await balanceOf(app, client.account.id)).toBe(0);
      });

      it("the same requestId twice in parallel on each POST: one 201 and one 200 with the same receipt", async () => {
        const client = await earner(3);
        const recycleKey = randomUUID();
        const recycled = await Promise.all([
          recycle(app, client.cookie, recycleBody(ID.mythic(1), "mythic", 1, recycleKey)),
          recycle(app, client.cookie, recycleBody(ID.mythic(1), "mythic", 1, recycleKey)),
        ]);
        expect(recycled.map((res) => res.statusCode).sort()).toEqual([200, 201]);
        const [a, b] = recycled.map((res) => res.json<RecycleReceipt>());
        expect(a?.recycleId).toBe(b?.recycleId);
        const shopKey = randomUUID();
        const bought = await Promise.all([
          buyPack(app, client.cookie, COMEDY, shopKey),
          buyPack(app, client.cookie, COMEDY, shopKey),
        ]);
        expect(bought.map((res) => res.statusCode).sort()).toEqual([200, 201]);
        const [c, d] = bought.map((res) => res.json<ShopReceipt>());
        expect(c?.pack.openingId).toBe(d?.pack.openingId);
        expect(c?.pack.cards).toEqual(d?.pack.cards);
        expect(await balanceOf(app, client.account.id)).toBe(2 * 2_750 - THEMED_PACK_PRICE);
      });

      it("a recycle racing the account's timer opening: both succeed and seq stays gapless", async () => {
        const client = await holder(ID.common(15), 3);
        for (let round = 0; round < 2; round += 1) {
          now = new Date(now.getTime() + 10 * MINUTE);
          const [opened, recycled] = await Promise.all([
            openPack(app, client.cookie),
            recycle(app, client.cookie, recycleBody(ID.common(15), "common", 1)),
          ]);
          expect(opened.statusCode).toBe(201);
          expect(recycled.statusCode).toBe(201);
        }
        expect((await ledgerOf(app, client.account.id)).map((row) => row.seq)).toEqual([1, 2]);
      });

      it("a recycle and a shop purchase racing on one account both commit, in one order, with a gapless ledger", async () => {
        const client = await earner(3);
        const [recycled, bought] = await Promise.all([
          recycle(app, client.cookie, recycleBody(ID.mythic(1), "mythic", 1)),
          buyPack(app, client.cookie, COMEDY),
        ]);
        expect([recycled.statusCode, bought.statusCode]).toEqual([201, 201]);
        const ledger = await ledgerOf(app, client.account.id);
        expect(ledger.map((row) => row.seq)).toEqual([1, 2, 3]);
        expect(ledger.at(-1)?.balanceAfter).toBe(2 * 2_750 - THEMED_PACK_PRICE);
      });
    });

    describe("audit-ledger (§13.1)", () => {
      it("passes here, and names the one account whose ledger was tampered with, exiting 1", async () => {
        const out = (chunks: string[]) => ({ write: (text: string) => chunks.push(text) });
        const stdout: string[] = [];
        const stderr: string[] = [];
        // Accounts with a forged balance are the bound tests' own; the audit runs on the rest.
        await app.db.delete(accounts).where(inArray(accounts.id, forged));
        expect(await auditMain([], testDbUrl(), { stdout: out(stdout), stderr: out(stderr) })).toBe(0);
        expect(stdout.join("")).toMatch(/^Ledger consistent: \d+ accounts, \d+ entries\.\n$/);

        const victim = await earner();
        const owner = createDb(migrationsDatabaseUrl());
        try {
          await owner
            .update(ledgerEntries)
            .set({ amount: 2_751 })
            .where(eq(ledgerEntries.accountId, victim.account.id));
        } finally {
          await owner.$client.end();
        }
        const failed: string[] = [];
        expect(await auditMain([], testDbUrl(), { stdout: out([]), stderr: out(failed) })).toBe(1);
        expect(failed).toEqual([
          `Account "${victim.account.login}" (${victim.account.id}): entry 1: balance_after 2750 after 0 and 2751; balance 2750 but the entries sum to 2751; recycle ${
            (
              await app.db
                .select({ id: recycles.id })
                .from(recycles)
                .where(eq(recycles.accountId, victim.account.id))
            )[0]?.id
          } without its credit of 2750.\n`,
        ]);
        await app.db.delete(accounts).where(eq(accounts.id, victim.account.id));
      });

      it("checks each row against the value it recorded, and notes a value other than today's without failing", async () => {
        const client = await earner();
        expect((await buyPack(app, client.cookie, COMEDY)).statusCode).toBe(201);
        const [recycled] = await app.db
          .select({ id: recycles.id })
          .from(recycles)
          .where(eq(recycles.accountId, client.account.id));
        const [opened] = await app.db
          .select({ id: packOpenings.id })
          .from(packOpenings)
          .where(and(eq(packOpenings.accountId, client.account.id), eq(packOpenings.source, "shop")));
        if (recycled === undefined || opened === undefined) throw new Error("a recycle and a shop opening");
        const out = (chunks: string[]) => ({ write: (text: string) => chunks.push(text) });
        // The app role may not rewrite history, so the owner's role plays the older constants.
        const owner = createDb(migrationsDatabaseUrl());
        const recordedAt = async (unitValue: number, price: number) => {
          await owner.update(recycles).set({ unitValue }).where(eq(recycles.id, recycled.id));
          await owner.update(packOpenings).set({ price }).where(eq(packOpenings.id, opened.id));
        };
        try {
          // As if both happened under older constants: a Mythic worth 2 000 and a pack at 450, the ledger to match.
          await recordedAt(2_000, 450);
          for (const [seq, amount, balanceAfter] of [
            [1, 2_000, 2_000],
            [2, -450, 1_550],
          ] as const)
            await owner
              .update(ledgerEntries)
              .set({ amount, balanceAfter })
              .where(and(eq(ledgerEntries.accountId, client.account.id), eq(ledgerEntries.seq, seq)));
          await owner.update(accounts).set({ balance: 1_550 }).where(eq(accounts.id, client.account.id));
          const note = `Note: Account "${client.account.login}" (${client.account.id}): shop opening ${opened.id} sold at 450, today ${THEMED_PACK_PRICE}; recycle ${recycled.id} at 2000 a card, today ${RECYCLE_VALUE.mythic}.\n`;
          const stdout: string[] = [];
          expect(await auditMain([], testDbUrl(), { stdout: out(stdout), stderr: out([]) })).toBe(0);
          expect(stdout.at(-1)).toBe(note);

          // A recorded value its ledger row does not match is a failure, whatever today's constants say.
          await recordedAt(1_999, 449);
        } finally {
          await owner.$client.end();
        }
        const stderr: string[] = [];
        expect(await auditMain([], testDbUrl(), { stdout: out([]), stderr: out(stderr) })).toBe(1);
        expect(stderr).toEqual([
          `Account "${client.account.login}" (${client.account.id}): shop opening ${opened.id} without its debit of 449; recycle ${recycled.id} without its credit of 1999.\n`,
        ]);
        await app.db.delete(accounts).where(eq(accounts.id, client.account.id));
      });

      it("exits 1 with usage for an argument and when DATABASE_URL is not set", async () => {
        const stderr: string[] = [];
        const sink = { write: (text: string) => stderr.push(text) };
        expect(await auditMain(["--fix"], "postgres://x", { stdout: sink, stderr: sink })).toBe(1);
        expect(await auditMain([], undefined, { stdout: sink, stderr: sink })).toBe(1);
        expect(stderr).toEqual(["Usage: node api/dist/cli/audit-ledger.js\n", "DATABASE_URL is not set\n"]);
      });
    });

    it("leaves a timer pack's allowance clock to the timer: PACK_CAP packs after a reset, shop purchases or not", async () => {
      const client = await earner();
      expect((await buyPack(app, client.cookie, COMEDY)).statusCode).toBe(201);
      await resetCollection(app.db, client.account.login, { confirm: true, keepKarma: true });
      expect(
        body<{ allowance: { available: number } }>(await getPacks(app, client.cookie)).allowance.available,
      ).toBe(PACK_CAP);
    });
  });
});

const testDbUrl = () => testConfig().DATABASE_URL;
