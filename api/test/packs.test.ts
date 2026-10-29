import { randomUUID } from "node:crypto";
import type { PackOpened, PacksResponse, SessionResponse } from "@anime-tcg/shared/api";
import { PACK_CAP, PACK_SIZE } from "@anime-tcg/shared/economy";
import { ODDS_SCALE, SLOT_ODDS } from "@anime-tcg/shared/rarity";
import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { accounts, cards, characters, packOpenings, poolSnapshots, series } from "../src/db/schema.js";
import { tierCounts } from "../src/domain/pool/tiers.js";
import { standardPool } from "./fixtures/pool.js";
import {
  body,
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  getCollection,
  getPacks,
  loadSnapshot,
  newPlayer,
  openPack,
  ROLL,
  scriptedRng,
} from "./pool-support.js";
import { cookieHeader, createTestApp, insertAccount, send, testConfig, WEB_ORIGIN } from "./support.js";

const MINUTE = 60_000;
const BASE = 800_000;
const error = (res: LightMyRequestResponse) =>
  res.json<{ error: { code: string; message: string; retryAfterSeconds?: number } }>().error;

describe("pack routes (collection-packs.md §6.3)", () => {
  let app: App;
  let now = new Date("2026-10-29T12:00:00.000Z");
  const rng = scriptedRng();
  const made: string[] = [];
  const snapshots: number[] = [];
  const player = async () => {
    const client = await newPlayer(app, "pk");
    made.push(client.account.id);
    return client;
  };

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng, clock: () => now });
  });
  afterAll(async () => {
    await deleteAccounts(app.db, made);
    await deleteSnapshots(app.db, snapshots);
    await app.close();
  });

  describe("before the owner has taken a snapshot", () => {
    beforeAll(async () => {
      const current = await currentSnapshotId(app.db);
      if (current !== null)
        throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    });

    it("GET /api/packs answers a full allowance and odds: null", async () => {
      const { cookie } = await player();
      const res = await getPacks(app, cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        allowance: { available: PACK_CAP, cap: PACK_CAP, intervalSeconds: 600, nextPackInSeconds: null },
        odds: null,
      });
    });

    it("an opening is 503 pool_unavailable, writes nothing and leaves the allowance untouched", async () => {
      const { cookie, account } = await player();
      const res = await openPack(app, cookie);
      expect(res.statusCode).toBe(503);
      expect(error(res)).toEqual({ code: "pool_unavailable", message: "Cards are not available right now" });
      expect(await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, account.id))).toEqual(
        [],
      );
      const [row] = await app.db
        .select({ anchor: accounts.packsAnchorAt })
        .from(accounts)
        .where(eq(accounts.id, account.id));
      expect(row?.anchor).toBeNull();
      expect(body<PacksResponse>(await getPacks(app, cookie)).allowance.available).toBe(PACK_CAP);
    });
  });

  describe("with a snapshot of 600 characters", () => {
    let version: number;
    beforeAll(async () => {
      const summary = await loadSnapshot(app.db, standardPool());
      version = summary.version;
      snapshots.push(version);
    });

    it("GET /api/packs publishes the applied odds, the tier sizes and the snapshot for a new account", async () => {
      const { cookie } = await player();
      const res = await getPacks(app, cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        allowance: { available: PACK_CAP, cap: PACK_CAP, intervalSeconds: 600, nextPackInSeconds: null },
        odds: {
          scale: ODDS_SCALE,
          perSlot: SLOT_ODDS,
          perPack: { common: 996_754, rare: 800_000, epic: 176_000, legendary: 19_998, mythic: 3_301 },
          tierSizes: tierCounts(600),
          snapshot: { version, takenAt: "2026-10-29T09:00:00.000Z" },
        },
      });
    });

    it("opens a pack: 201, five different characters in slots 0..4, each at its tier, standard, new", async () => {
      const { cookie, account } = await player();
      const res = await openPack(app, cookie);
      expect(res.statusCode).toBe(201);
      const opened = body<PackOpened>(res);
      expect(opened.cards.map((card) => card.slot)).toEqual([0, 1, 2, 3, 4]);
      expect(new Set(opened.cards.map((card) => card.character.id)).size).toBe(PACK_SIZE);
      for (const card of opened.cards) {
        expect(card).toMatchObject({ kind: "card", variant: "standard", isNew: true });
        expect(card.rarity).toBe(card.character.tier);
        expect(card.character.inCurrentSnapshot).toBe(true);
        for (const id of card.character.franchiseIds) {
          expect(opened.franchises.map((franchise) => franchise.id)).toContain(id);
        }
      }
      expect(opened.allowance).toEqual({
        available: PACK_CAP - 1,
        cap: PACK_CAP,
        intervalSeconds: 600,
        nextPackInSeconds: 600,
      });
      expect(opened.openedAt).toBe(now.toISOString());

      const stored = await app.db.select().from(cards).where(eq(cards.accountId, account.id));
      expect(stored).toHaveLength(PACK_SIZE);
      expect(stored.every((card) => card.variant === "standard" && card.snapshotId === version)).toBe(true);
      // Card ids stay inside the server.
      for (const card of stored) expect(res.body).not.toContain(card.id);

      const session = body<SessionResponse>(await send(app, { method: "GET", url: "/api/session", cookie }));
      expect(session).toMatchObject({ signedIn: true, account: { cards: PACK_SIZE } });
      const collection = body<{ totals: { cards: number }; entries: unknown[] }>(
        await getCollection(app, cookie),
      );
      expect(collection.totals.cards).toBe(PACK_SIZE);
      expect(collection.entries).toHaveLength(PACK_SIZE);
    });

    it("deals what the generator rolls: five Mythic slots draw five different Mythics", async () => {
      const { cookie } = await player();
      rng.script.push(ROLL.mythic, 0, ROLL.mythic, 1, ROLL.mythic, 2, ROLL.mythic, 3, ROLL.mythic, 4);
      const first = body<PackOpened>(await openPack(app, cookie));
      expect(first.cards.map((card) => [card.character.id, card.rarity, card.isNew])).toEqual([
        [BASE + 1, "mythic", true],
        [BASE + 2, "mythic", true],
        [BASE + 3, "mythic", true],
        [BASE + 4, "mythic", true],
        [BASE + 5, "mythic", true],
      ]);
      // Mythic 1 and 6 again: one already owned, one new to the account.
      rng.script.push(ROLL.mythic, 0, ROLL.mythic, 5, ROLL.common, 0, ROLL.common, 1, ROLL.common, 2);
      const second = body<PackOpened>(await openPack(app, cookie));
      expect(second.cards.map((card) => [card.character.id, card.isNew])).toEqual([
        [BASE + 1, false],
        [BASE + 6, true],
        [BASE + 241, true],
        [BASE + 242, true],
        [BASE + 243, true],
      ]);
      expect(second.cards[2]?.character).toEqual({
        id: BASE + 241,
        name: `Character ${BASE + 241}`,
        nameNative: null,
        imageUrl: `https://s4.anilist.co/file/anilistcdn/character/large/b${BASE + 241}.png`,
        franchiseIds: [900_041],
        tier: "common",
        inCurrentSnapshot: true,
      });
      expect(second.franchises).toContainEqual({
        id: 900_041,
        title: "Series 41",
        titleNative: null,
        startYear: 2013,
      });
    });

    it("answers 409 no_pack_available with the wait after the last pack, and opens again an interval later", async () => {
      const { cookie } = await player();
      for (let i = 0; i < PACK_CAP; i += 1) expect((await openPack(app, cookie)).statusCode).toBe(201);
      const empty = await openPack(app, cookie);
      expect(empty.statusCode).toBe(409);
      expect(error(empty)).toEqual({
        code: "no_pack_available",
        message: "No pack is ready yet",
        retryAfterSeconds: 600,
      });
      expect(empty.headers["retry-after"]).toBe("600");
      expect(body<PacksResponse>(await getPacks(app, cookie)).allowance).toMatchObject({
        available: 0,
        nextPackInSeconds: 600,
      });

      const start = now;
      try {
        now = new Date(start.getTime() + 4 * MINUTE);
        expect(error(await openPack(app, cookie)).retryAfterSeconds).toBe(360);
        now = new Date(start.getTime() + 10 * MINUTE);
        const again = await openPack(app, cookie);
        expect(again.statusCode).toBe(201);
        expect(body<PackOpened>(again).allowance).toMatchObject({ available: 0, nextPackInSeconds: 600 });
      } finally {
        now = start;
      }
    });

    it("replays a requestId: 200 with the same opening, cards and isNew, and the allowance spent once", async () => {
      const { cookie, account } = await player();
      const requestId = randomUUID();
      const first = await openPack(app, cookie, requestId);
      expect(first.statusCode).toBe(201);
      const replay = await openPack(app, cookie, requestId);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
      expect(await app.db.select().from(cards).where(eq(cards.accountId, account.id))).toHaveLength(
        PACK_SIZE,
      );
      expect(body<PacksResponse>(await getPacks(app, cookie)).allowance.available).toBe(PACK_CAP - 1);
    });

    it("scopes a requestId to its account: B sending A's key gets B's own opening", async () => {
      const a = await player();
      const b = await player();
      const requestId = randomUUID();
      const forA = body<PackOpened>(await openPack(app, a.cookie, requestId));
      const forB = await openPack(app, b.cookie, requestId);
      expect(forB.statusCode).toBe(201);
      expect(body<PackOpened>(forB).openingId).not.toBe(forA.openingId);
      const aCollection = body<{ totals: { cards: number } }>(await getCollection(app, a.cookie));
      expect(aCollection.totals.cards).toBe(PACK_SIZE);
    });

    it("leaves no record for a 409, so its key can succeed once a pack is there", async () => {
      const { cookie } = await player();
      for (let i = 0; i < PACK_CAP; i += 1) await openPack(app, cookie);
      const requestId = randomUUID();
      expect((await openPack(app, cookie, requestId)).statusCode).toBe(409);
      const start = now;
      try {
        now = new Date(start.getTime() + 10 * MINUTE);
        expect((await openPack(app, cookie, requestId)).statusCode).toBe(201);
      } finally {
        now = start;
      }
    });

    it("deleting the account removes its openings and cards and leaves snapshots, characters and series", async () => {
      const client = await newPlayer(app, "pkdel");
      await openPack(app, client.cookie);
      const deleted = await send(app, {
        method: "POST",
        url: "/api/account/delete",
        cookie: client.cookie,
        payload: { password: "correct horse battery" },
      });
      expect(deleted.statusCode).toBe(204);
      expect(await app.db.select().from(cards).where(eq(cards.accountId, client.account.id))).toEqual([]);
      expect(
        await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, client.account.id)),
      ).toEqual([]);
      expect(await app.db.select().from(poolSnapshots).where(eq(poolSnapshots.id, version))).toHaveLength(1);
      expect(
        await app.db
          .select()
          .from(characters)
          .where(eq(characters.id, BASE + 1)),
      ).toHaveLength(1);
      expect(await app.db.select().from(series).where(eq(series.id, 900_001))).toHaveLength(1);
    });

    it("reads an account from before 1c (no allowance clock) as full", async () => {
      const accountId = await insertAccount(app.db, `pk-legacy-${randomUUID().slice(0, 8)}`);
      made.push(accountId);
      const { cookieValue } = await app.sessions.create(accountId, "test", new Date());
      const res = await getPacks(app, cookieValue);
      expect(body<PacksResponse>(res).allowance).toEqual({
        available: PACK_CAP,
        cap: PACK_CAP,
        intervalSeconds: 600,
        nextPackInSeconds: null,
      });
    });

    describe("refusals", () => {
      it.each([
        ["an extra field", { requestId: randomUUID(), cards: [] }],
        ["a requestId that is not a uuid", { requestId: "not-a-uuid" }],
        ["an empty requestId", { requestId: "" }],
        ["a numeric requestId", { requestId: 42 }],
        ["no requestId", {}],
      ])("answers 400 validation_failed to %s and writes nothing", async (_label, payload) => {
        const { cookie, account } = await player();
        const res = await send(app, { method: "POST", url: "/api/packs/open", cookie, payload });
        expect(res.statusCode).toBe(400);
        expect(error(res).code).toBe("validation_failed");
        expect(
          await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, account.id)),
        ).toEqual([]);
      });

      it.each(["/api/packs?x=1", "/api/collection?x=1"])(
        "answers 400 to a query string on GET %s",
        async (url) => {
          const { cookie } = await player();
          const res = await send(app, { method: "GET", url, cookie });
          expect(res.statusCode).toBe(400);
          expect(error(res).code).toBe("validation_failed");
        },
      );

      it("answers 400 to a query string on the POST", async () => {
        const { cookie } = await player();
        const res = await send(app, {
          method: "POST",
          url: "/api/packs/open?requestId=x",
          cookie,
          payload: { requestId: randomUUID() },
        });
        expect(res.statusCode).toBe(400);
      });

      it("answers 403 bad_origin to an opening without Origin, and writes nothing", async () => {
        const { cookie, account } = await player();
        const res = await send(app, {
          method: "POST",
          url: "/api/packs/open",
          cookie,
          origin: null,
          payload: { requestId: randomUUID() },
        });
        expect(res.statusCode).toBe(403);
        expect(error(res).code).toBe("bad_origin");
        expect(
          await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, account.id)),
        ).toEqual([]);
      });

      it.each([
        ["GET", "/api/packs"],
        ["POST", "/api/packs/open"],
        ["GET", "/api/collection"],
      ] as const)("answers 401 unauthenticated to %s %s when signed out", async (method, url) => {
        const res = await send(app, {
          method,
          url,
          ...(method === "POST" ? { payload: { requestId: randomUUID() } } : {}),
        });
        expect(res.statusCode).toBe(401);
        expect(error(res).code).toBe("unauthenticated");
      });

      it("limits openings to PACK_RATE_LIMIT per client address, answering 429 with Retry-After", async () => {
        const { cookie } = await player();
        const remoteAddress = "198.51.100.77";
        const open = () =>
          app.inject({
            method: "POST",
            url: "/api/packs/open",
            remoteAddress,
            headers: { origin: WEB_ORIGIN, cookie: cookieHeader(cookie) },
            payload: { requestId: randomUUID() },
          });
        const statuses: number[] = [];
        for (let i = 0; i < 20; i += 1) statuses.push((await open()).statusCode);
        expect(statuses.filter((status) => status === 429)).toEqual([]);
        const limited = await open();
        expect(limited.statusCode).toBe(429);
        expect(error(limited).code).toBe("rate_limited");
        expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      });
    });

    describe("concurrency: the account row lock", () => {
      /** A player with exactly `left` packs, at the fixed clock. */
      async function playerWith(left: number) {
        const client = await player();
        for (let i = 0; i < PACK_CAP - left; i += 1)
          expect((await openPack(app, client.cookie)).statusCode).toBe(201);
        return client;
      }
      const cardCount = async (accountId: string) =>
        (await app.db.select().from(cards).where(eq(cards.accountId, accountId))).length;

      it("one pack and two different requestIds in parallel: one 201, one 409", async () => {
        const { cookie, account } = await playerWith(1);
        const results = await Promise.all([openPack(app, cookie), openPack(app, cookie)]);
        expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
        expect(await cardCount(account.id)).toBe((PACK_CAP - 1 + 1) * PACK_SIZE);
      });

      it("C packs and C + 1 parallel openings: C x 201 and one 409", async () => {
        const { cookie, account } = await playerWith(PACK_CAP);
        const results = await Promise.all(Array.from({ length: PACK_CAP + 1 }, () => openPack(app, cookie)));
        expect(results.map((res) => res.statusCode).sort()).toEqual([
          ...Array<number>(PACK_CAP).fill(201),
          409,
        ]);
        expect(await cardCount(account.id)).toBe(PACK_CAP * PACK_SIZE);
      });

      it("one pack and the same requestId twice in parallel: one 201 and one 200 with the same opening", async () => {
        const { cookie, account } = await playerWith(1);
        const requestId = randomUUID();
        const results = await Promise.all([
          openPack(app, cookie, requestId),
          openPack(app, cookie, requestId),
        ]);
        expect(results.map((res) => res.statusCode).sort()).toEqual([200, 201]);
        const [a, b] = results.map((res) => body<PackOpened>(res));
        expect(a?.openingId).toBe(b?.openingId);
        expect(a?.cards).toEqual(b?.cards);
        expect(await cardCount(account.id)).toBe(PACK_CAP * PACK_SIZE);
      });
    });
  });
});
