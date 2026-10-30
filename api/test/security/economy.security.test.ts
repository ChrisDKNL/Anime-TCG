import { randomUUID } from "node:crypto";
import type {
  CollectionResponse,
  PackOpened,
  RecycleReceipt,
  ShopReceipt,
  ShopResponse,
} from "@anime-tcg/shared/api";
import { MAX_RECYCLE_COUNT, RECYCLE_VALUE, THEMED_PACK_PRICE } from "@anime-tcg/shared/economy";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { accounts, cards, ledgerEntries, recycles, sessions } from "../../src/db/schema.js";
import { hashSessionId, newSessionId } from "../../src/domain/session/ids.js";
import { CARD_ACTION_RATE_LIMIT } from "../../src/routes/limits.js";
import {
  balanceOf,
  buyPack,
  economyPool,
  entryOf,
  errorOf,
  expectLedgerConsistent,
  getShop,
  getWallet,
  ID,
  ledgerOf,
  recycle,
  recycleBody,
} from "../economy-support.js";
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
} from "../pool-support.js";
import {
  cookieHeader,
  createTestApp,
  type SignedInClient,
  send,
  TEST_SESSION_SECRET,
  testConfig,
  WEB_ORIGIN,
} from "../support.js";

const MINUTE = 60_000;
/** A genre name built to break markup and the reading order; it is still eligible, so it is a theme. */
const HOSTILE_GENRE = "<script>alert(1)</script>‮";
const HOSTILE_THEME = "genre-script-alert-1-script";

/**
 * The adversarial suite of economy.md §14 for PR 1 (T3, docs/05-security.md):
 * forged sessions, tampered and overflowing bodies, replays across accounts,
 * races through two app instances, the mint paths, hostile strings, the rate
 * limit and the route inventory. After every test the ledger audits clean.
 */
describe("economy, adversarial (economy.md §14)", () => {
  let app: App;
  let twin: App;
  let now = new Date("2026-10-30T15:00:00.000Z");
  const rng = scriptedRng();
  const made: string[] = [];
  const snapshots: number[] = [];
  let snapshotId = 0;

  const player = async () => {
    const client = await newPlayer(app, "es");
    made.push(client.account.id);
    return client;
  };

  async function deal(client: SignedInClient, ids: readonly number[]): Promise<PackOpened> {
    now = new Date(now.getTime() + 10 * MINUTE);
    await forceNextPack(app.db, rng, snapshotId, ids);
    const res = await openPack(app, client.cookie);
    expect(res.statusCode, res.body).toBe(201);
    return body<PackOpened>(res);
  }

  /** `copies` copies of a Common in slot 1, or of a Rare-or-better in slot 5, with fillers that vary per pack. */
  async function holder(card: number, copies: number, slot: "first" | "last" = "first") {
    const client = await player();
    for (let i = 0; i < copies; i += 1) {
      const filler = [ID.common(210 - (i % 100)), ID.common(110 - (i % 100)), ID.uncommon(150 - (i % 100))];
      const [a = 0, b = 0, u = 0] = filler;
      await deal(client, slot === "first" ? [card, a, b, u, ID.rare(120)] : [a, b, ID.uncommon(1), u, card]);
    }
    return client;
  }

  async function earner(): Promise<SignedInClient> {
    const client = await holder(ID.mythic(3), 2, "last");
    expect((await recycle(app, client.cookie, recycleBody(ID.mythic(3), "mythic", 1))).statusCode).toBe(201);
    return client;
  }

  beforeAll(async () => {
    const config = testConfig({ ACCOUNT_CAP: "1000" });
    app = await createTestApp({ config, rng, clock: () => now });
    twin = await createTestApp({ config, rng, clock: () => now });
    const current = await currentSnapshotId(app.db);
    if (current !== null) throw new Error(`snapshot ${current} is current; a previous run left it behind`);
    snapshotId = (await loadSnapshot(app.db, economyPool({ genre: HOSTILE_GENRE }), now)).version;
    snapshots.push(snapshotId);
  });
  afterAll(async () => {
    await expectLedgerConsistent(app);
    await deleteAccounts(app.db, made);
    await deleteSnapshots(snapshots);
    await twin.close();
    await app.close();
  });

  describe("1. session cookies", () => {
    const routes = [
      ["GET", "/api/wallet", undefined],
      ["GET", "/api/shop", undefined],
      ["POST", "/api/collection/recycle", "recycle"],
      ["POST", "/api/shop/buy", "buy"],
    ] as const;

    it("answers forged, flipped, expired and never-issued cookies 401 on every economy route, and moves nothing", async () => {
      const victim = await earner();
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
      for (const cookie of forgeries) {
        for (const [method, url, kind] of routes) {
          const payload =
            kind === "recycle"
              ? recycleBody(ID.mythic(3), "mythic", 1)
              : kind === "buy"
                ? { requestId: randomUUID(), themeId: HOSTILE_THEME }
                : undefined;
          const res = await send(app, { method, url, cookie, payload });
          expect(res.statusCode, `${method} ${url}`).toBe(401);
          expect(errorOf(res).code).toBe("unauthenticated");
        }
      }
      expect(await balanceOf(app, victim.account.id)).toBe(RECYCLE_VALUE.mythic);
      expect(await ledgerOf(app, victim.account.id)).toHaveLength(1);
    });
  });

  describe("2. tampered bodies: the server holds every amount", () => {
    it.each([
      ["value", { value: 1_000_000 }],
      ["credit", { credit: 1_000_000 }],
      ["amount", { amount: 1_000_000 }],
      ["balance", { balance: 1_000_000 }],
      ["kind", { kind: "card" }],
      ["variant", { variant: "standard" }],
      ["escrowId", { escrowId: randomUUID() }],
      ["accountId", { accountId: randomUUID() }],
    ])("a recycle body with %s is 400 and moves nothing", async (_field, extra) => {
      const client = await holder(ID.common(1), 2);
      const res = await recycle(app, client.cookie, { ...recycleBody(ID.common(1), "common", 1), ...extra });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe("validation_failed");
      expect(await ledgerOf(app, client.account.id)).toEqual([]);
    });

    it("a recycle body naming another account's real card id is 400, and that card is untouched", async () => {
      const victim = await holder(ID.common(2), 2);
      const [card] = await app.db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.accountId, victim.account.id));
      const attacker = await holder(ID.common(2), 2);
      const res = await recycle(app, attacker.cookie, {
        ...recycleBody(ID.common(2), "common", 1),
        cardId: card?.id,
      });
      expect(res.statusCode).toBe(400);
      expect(await entryOf(app, victim.cookie, ID.common(2))).toMatchObject({ count: 2 });
    });

    it.each([
      ["price", { price: 1 }],
      ["amount", { amount: 0 }],
      ["fee", { fee: 0 }],
      ["characterId", { characterId: ID.mythic(1) }],
      ["rarity", { rarity: "mythic" }],
      ["sellerId", { sellerId: randomUUID() }],
    ])("a shop purchase body with %s is 400 and moves nothing", async (_field, extra) => {
      const client = await earner();
      const res = await send(app, {
        method: "POST",
        url: "/api/shop/buy",
        cookie: client.cookie,
        payload: { requestId: randomUUID(), themeId: HOSTILE_THEME, ...extra },
      });
      expect(res.statusCode).toBe(400);
      expect(await balanceOf(app, client.account.id)).toBe(RECYCLE_VALUE.mythic);
    });

    const raw = (requestId: string, characterId: string, count: string) =>
      `{"requestId":"${requestId}","characterId":${characterId},"rarity":"common","count":${count}}`;
    it.each([
      ["a negative count", "1", "-1"],
      ["a zero count", "1", "0"],
      ["a fractional count", "1", "1.5"],
      ["a string count", "1", '"1"'],
      ["a null count", "1", "null"],
      ["an infinite count (1e400)", "1", "1e400"],
      ["an unsafe count (9007199254740993)", "1", "9007199254740993"],
      ["negative zero", "1", "-0"],
      ["a count over MAX_RECYCLE_COUNT", "1", String(MAX_RECYCLE_COUNT + 1)],
      ["a character id of 0", "0", "1"],
      ["a negative character id", "-5", "1"],
      ["a character id past integer (2147483648)", "2147483648", "1"],
      ["an unsafe character id", "9007199254740993", "1"],
      ["a fractional character id", "1.5", "1"],
      ["a string character id", '"1"', "1"],
      ["an infinite character id", "1e400", "1"],
    ])("a recycle with %s is 400 and moves nothing", async (_label, characterId, count) => {
      const client = await holder(ID.common(3), 3);
      const res = await send(app, {
        method: "POST",
        url: "/api/collection/recycle",
        cookie: client.cookie,
        headers: { "content-type": "application/json" },
        // "1" stands for the held Common, so only the field under test is wrong.
        payload: raw(randomUUID(), characterId === "1" ? String(ID.common(3)) : characterId, count),
      });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe("validation_failed");
      expect(await ledgerOf(app, client.account.id)).toEqual([]);
      expect(await entryOf(app, client.cookie, ID.common(3))).toMatchObject({ count: 3 });
    });

    it.each([
      ["an empty theme id", { themeId: "" }],
      ["a theme id of 65 characters", { themeId: `genre-${"a".repeat(59)}` }],
      ["a numeric theme id", { themeId: 1 }],
      ["a request id that is not a uuid", { requestId: "not-a-uuid" }],
      ["no request id", { requestId: undefined }],
    ])("a shop purchase with %s is 400", async (_label, change) => {
      const client = await earner();
      const res = await send(app, {
        method: "POST",
        url: "/api/shop/buy",
        cookie: client.cookie,
        payload: { requestId: randomUUID(), themeId: HOSTILE_THEME, ...change },
      });
      expect(res.statusCode).toBe(400);
      expect(await balanceOf(app, client.account.id)).toBe(RECYCLE_VALUE.mythic);
    });
  });

  describe("3. replay", () => {
    it("account B sending A's recycle key gets B's own outcome; A's receipt never leaks", async () => {
      const a = await holder(ID.common(4), 3);
      const b = await holder(ID.common(5), 3);
      const key = randomUUID();
      const first = await recycle(app, a.cookie, recycleBody(ID.common(4), "common", 1, key));
      expect(first.statusCode).toBe(201);
      const asB = await recycle(app, b.cookie, recycleBody(ID.common(4), "common", 1, key));
      expect(asB.statusCode).toBe(409);
      expect(errorOf(asB).code).toBe("not_enough_copies");
      const own = await recycle(app, b.cookie, recycleBody(ID.common(5), "common", 1, key));
      expect(own.statusCode).toBe(201);
      expect(own.json<RecycleReceipt>().recycleId).not.toBe(first.json<RecycleReceipt>().recycleId);
    });

    it("scopes a key to its table: one key serves a recycle and a shop purchase, each once", async () => {
      const client = await earner();
      await deal(client, [ID.common(6), ID.common(209), ID.common(208), ID.uncommon(140), ID.rare(100)]);
      await deal(client, [ID.common(6), ID.common(207), ID.common(206), ID.uncommon(139), ID.rare(99)]);
      const key = randomUUID();
      expect(
        (await recycle(app, client.cookie, recycleBody(ID.common(6), "common", 1, key))).statusCode,
      ).toBe(201);
      expect((await buyPack(app, client.cookie, HOSTILE_THEME, key)).statusCode).toBe(201);
      expect((await buyPack(app, client.cookie, HOSTILE_THEME, key)).statusCode).toBe(200);
      expect(await balanceOf(app, client.account.id)).toBe(
        RECYCLE_VALUE.mythic + RECYCLE_VALUE.common - THEMED_PACK_PRICE,
      );
    });
  });

  describe("4. races", () => {
    it("a double recycle of the last duplicate through two app instances on one database: exactly one success", async () => {
      const client = await holder(ID.common(7), 2);
      const results = await Promise.all([
        recycle(app, client.cookie, recycleBody(ID.common(7), "common", 1)),
        recycle(twin, client.cookie, recycleBody(ID.common(7), "common", 1)),
      ]);
      expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
      expect(await balanceOf(app, client.account.id)).toBe(RECYCLE_VALUE.common);
    });

    it("a double spend through two app instances with the balance for one: one pack, never a negative balance", async () => {
      const client = await holder(ID.mythic(4), 2, "last");
      await deal(client, [ID.common(205), ID.common(204), ID.uncommon(2), ID.uncommon(138), ID.legendary(1)]);
      expect((await recycle(app, client.cookie, recycleBody(ID.mythic(4), "mythic", 1))).statusCode).toBe(
        201,
      );
      // 2 750 buys six packs; seven parallel purchases across both instances leave exactly the seventh refused.
      const results = await Promise.all(
        Array.from({ length: 7 }, (_, i) => buyPack(i % 2 === 0 ? app : twin, client.cookie, HOSTILE_THEME)),
      );
      expect(results.filter((res) => res.statusCode === 201)).toHaveLength(6);
      const refused = results.filter((res) => res.statusCode === 409);
      expect(refused.map((res) => errorOf(res))).toEqual([
        expect.objectContaining({
          code: "insufficient_funds",
          balance: RECYCLE_VALUE.mythic - 6 * THEMED_PACK_PRICE,
        }),
      ]);
      expect(await balanceOf(app, client.account.id)).toBe(RECYCLE_VALUE.mythic - 6 * THEMED_PACK_PRICE);
    });
  });

  describe("5. no path from nothing to Karma, from Karma to the timer, or from cards to a better card", () => {
    it("an account with no duplicates calls every economy route and its balance stays 0", async () => {
      const client = await player();
      await deal(client, [ID.common(150), ID.common(151), ID.common(152), ID.uncommon(100), ID.mythic(5)]);
      const calls = [
        getWallet(app, client.cookie),
        getShop(app, client.cookie),
        getCollection(app, client.cookie),
        recycle(app, client.cookie, recycleBody(ID.mythic(5), "mythic", 1)),
        recycle(app, client.cookie, recycleBody(ID.common(150), "common", MAX_RECYCLE_COUNT)),
        buyPack(app, client.cookie, HOSTILE_THEME),
      ];
      const statuses = (await Promise.all(calls)).map((res) => res.statusCode);
      expect(statuses).toEqual([200, 200, 200, 409, 409, 409]);
      expect(await balanceOf(app, client.account.id)).toBe(0);
      expect(await ledgerOf(app, client.account.id)).toEqual([]);
    });

    it("a shop purchase never touches packs_anchor_at or the free-pack counter", async () => {
      const client = await earner();
      const read = async () =>
        (
          await app.db
            .select({ anchor: accounts.packsAnchorAt, opened: accounts.freePacksOpened })
            .from(accounts)
            .where(eq(accounts.id, client.account.id))
        )[0];
      const before = await read();
      expect(before?.anchor).not.toBeNull();
      for (let i = 0; i < 3; i += 1) {
        now = new Date(now.getTime() + 7 * MINUTE);
        expect((await buyPack(app, client.cookie, HOSTILE_THEME)).statusCode).toBe(201);
      }
      expect(await read()).toEqual(before);
      const packs = body<{ allowance: { available: number } }>(await getPacks(app, client.cookie));
      expect(packs.allowance.available).toBeGreaterThanOrEqual(0);
    });

    it("pins the route list: no route turns Karma into a timer pack or cards into a higher tier", async () => {
      await app.ready();
      expect(app.printRoutes({ commonPrefix: false })).toBe(
        [
          "├── /healthz (GET, HEAD)",
          "├── /api/session (GET, HEAD)",
          "│   ├── /login (POST)",
          "│   └── /logout (POST)",
          "├── /api/shop (GET, HEAD)",
          "│   └── /buy (POST)",
          "├── /api/accounts/check-invite (POST)",
          "├── /api/accounts/register (POST)",
          "├── /api/account/login (PATCH)",
          "├── /api/account/change-password (POST)",
          "├── /api/account/delete (POST)",
          "├── /api/packs (GET, HEAD)",
          "│   └── /open (POST)",
          "├── /api/collection (GET, HEAD)",
          "│   └── /recycle (POST)",
          "├── /api/demo (GET, HEAD)",
          "│   └── /open (POST)",
          "└── /api/wallet (GET, HEAD)",
          "",
        ].join("\n"),
      );
    });
  });

  describe("6. overflow and mint loops", () => {
    /** 101 openings: seconds on an idle machine, so the bound only catches a hang. */
    it("100 Mythic duplicates recycled in one request credit 275 000, inside MAX_ENTRY_AMOUNT", async () => {
      const client = await player();
      for (let i = 0; i <= MAX_RECYCLE_COUNT; i += 1) {
        await deal(client, [
          ID.common(1 + (i % 200)),
          ID.common(2 + (i % 200)),
          ID.uncommon(1 + (i % 140)),
          ID.uncommon(141),
          ID.mythic(6),
        ]);
      }
      const res = await recycle(app, client.cookie, recycleBody(ID.mythic(6), "mythic", MAX_RECYCLE_COUNT));
      expect(res.statusCode).toBe(201);
      expect(res.json<RecycleReceipt>()).toMatchObject({ credited: 275_000, balance: 275_000 });
      expect(await entryOf(app, client.cookie, ID.mythic(6))).toMatchObject({ count: 1 });
    }, 300_000);

    it("buying a themed pack and recycling every duplicate it deals loses Karma", async () => {
      const client = await earner();
      const before = await balanceOf(app, client.account.id);
      const receipt = (await buyPack(app, client.cookie, HOSTILE_THEME)).json<ShopReceipt>();
      const collection = body<CollectionResponse>(await getCollection(app, client.cookie));
      for (const entry of collection.entries) {
        if (entry.recyclable === 0) continue;
        const res = await recycle(
          app,
          client.cookie,
          recycleBody(entry.character.id, entry.rarity, entry.recyclable),
        );
        expect(res.statusCode).toBe(201);
      }
      expect(receipt.pack.cards).toHaveLength(5);
      expect(await balanceOf(app, client.account.id)).toBeLessThan(before);
    });
  });

  describe("7. hostile strings", () => {
    it("serves a hostile genre as the theme's title, as text, under an id of ASCII only", async () => {
      const client = await player();
      const shop = body<ShopResponse>(await getShop(app, client.cookie));
      expect(shop.themes.map((theme) => [theme.id, theme.title])).toEqual([
        ["genre-comedy", "Comedy"],
        [HOSTILE_THEME, HOSTILE_GENRE],
      ]);
      const res = await getShop(app, client.cookie);
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("refuses a theme id that is the hostile genre itself, or carries SQL or a bidi override", async () => {
      const client = await earner();
      for (const themeId of [HOSTILE_GENRE, "genre-'; drop table ledger_entries; --", "genre-comedy‮"]) {
        const res = await buyPack(app, client.cookie, themeId);
        expect(res.statusCode).toBe(404);
        expect(errorOf(res).code).toBe("theme_unavailable");
      }
      expect(await ledgerOf(app, client.account.id)).toHaveLength(1);
    });
  });

  describe("8. brute force against CARD_ACTION_RATE_LIMIT", () => {
    it("the 31st recycle or purchase from one address in a window is 429 and moves nothing", async () => {
      const client = await holder(ID.common(8), 3);
      const address = "198.51.100.77";
      const call = (url: string, payload: unknown) =>
        app.inject({
          method: "POST",
          url,
          remoteAddress: address,
          headers: { origin: WEB_ORIGIN, cookie: cookieHeader(client.cookie) },
          payload: payload as Record<string, unknown>,
        });
      for (const [url, payload] of [
        ["/api/collection/recycle", () => recycleBody(ID.common(8), "common", 3)],
        ["/api/shop/buy", () => ({ requestId: randomUUID(), themeId: HOSTILE_THEME })],
      ] as const) {
        const statuses: number[] = [];
        for (let i = 0; i < CARD_ACTION_RATE_LIMIT.max; i += 1)
          statuses.push((await call(url, payload())).statusCode);
        expect(
          statuses.every((status) => status === 409),
          url,
        ).toBe(true);
        const limited = await call(url, payload());
        expect(limited.statusCode, url).toBe(429);
        expect(errorOf(limited).code).toBe("rate_limited");
      }
      expect(await ledgerOf(app, client.account.id)).toEqual([]);
      expect(await app.db.select().from(recycles).where(eq(recycles.accountId, client.account.id))).toEqual(
        [],
      );
      expect(
        await app.db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, client.account.id)),
      ).toEqual([]);
    });
  });
});
