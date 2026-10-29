import { randomUUID } from "node:crypto";
import type { PackOpened, PacksResponse, SessionResponse } from "@anime-tcg/shared/api";
import { PACK_CAP, PACK_SIZE } from "@anime-tcg/shared/economy";
import {
  ENCHANTED_SLOT_ODDS,
  ODDS_SCALE,
  PITY_PACKS,
  RADIANT_SLOT_ODDS,
  RARITIES,
  type Rarity,
  SLOT_FLOOR,
  SLOT_ODDS,
  TIER_BAND,
} from "@anime-tcg/shared/rarity";
import { and, eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import {
  accounts,
  cards,
  characters,
  packOpenings,
  poolSnapshotCharacters,
  poolSnapshots,
  series,
} from "../src/db/schema.js";
import { tierCounts } from "../src/domain/pool/tiers.js";
import { standardPool } from "./fixtures/pool.js";
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
  PLAN,
  scriptedRng,
} from "./pool-support.js";
import { cookieHeader, createTestApp, insertAccount, send, testConfig, WEB_ORIGIN } from "./support.js";

const MINUTE = 60_000;
const BASE = 800_000;
const error = (res: LightMyRequestResponse) =>
  res.json<{ error: { code: string; message: string; retryAfterSeconds?: number } }>().error;
const rank = (tier: Rarity) => RARITIES.indexOf(tier);
const atLeastEpic = (tier: Rarity) => rank(tier) >= rank("epic");

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
  const countersOf = async (accountId: string) => {
    const [row] = await app.db
      .select({
        anchor: accounts.packsAnchorAt,
        packsSinceMythic: accounts.packsSinceMythic,
        freePacksOpened: accounts.freePacksOpened,
      })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (row === undefined) throw new Error(`no account ${accountId}`);
    return row;
  };
  /** Runs `step` at the clock moved forward by `minutes`, putting it back afterwards. */
  async function later<T>(minutes: number, step: () => Promise<T>): Promise<T> {
    const start = now;
    now = new Date(start.getTime() + minutes * MINUTE);
    try {
      return await step();
    } finally {
      now = start;
    }
  }

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng, clock: () => now });
  });
  afterAll(async () => {
    await deleteAccounts(app.db, made);
    await deleteSnapshots(snapshots);
    await app.close();
  });

  describe("before the owner has taken a snapshot", () => {
    beforeAll(async () => {
      const current = await currentSnapshotId(app.db);
      if (current !== null)
        throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    });

    it("GET /api/packs answers a full allowance, odds: null and packsUntilGuarantee: null", async () => {
      const { cookie } = await player();
      const res = await getPacks(app, cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        allowance: { available: PACK_CAP, cap: PACK_CAP, intervalSeconds: 600, nextPackInSeconds: null },
        odds: null,
        packsUntilGuarantee: null,
      });
    });

    it("an opening is 503 pool_unavailable, writes nothing and leaves the allowance and counters untouched", async () => {
      const { cookie, account } = await player();
      const res = await openPack(app, cookie);
      expect(res.statusCode).toBe(503);
      expect(error(res)).toEqual({ code: "pool_unavailable", message: "Cards are not available right now" });
      expect(await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, account.id))).toEqual(
        [],
      );
      expect(await countersOf(account.id)).toEqual({ anchor: null, packsSinceMythic: 0, freePacksOpened: 0 });
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

    it("GET /api/packs publishes the applied tables and rules, the tier sizes and the snapshot for a new account", async () => {
      const { cookie } = await player();
      const res = await getPacks(app, cookie);
      expect(res.statusCode).toBe(200);
      const perTier = (table: Record<Rarity, number>) =>
        Object.fromEntries(RARITIES.map((t) => [t, table[t]]));
      expect(res.json()).toEqual({
        allowance: { available: PACK_CAP, cap: PACK_CAP, intervalSeconds: 600, nextPackInSeconds: null },
        odds: {
          scale: ODDS_SCALE,
          slots: SLOT_ODDS.map((table, slot) => ({ floor: SLOT_FLOOR[slot], odds: perTier(table) })),
          share: {
            common: 560_000,
            uncommon: 240_000,
            rare: 160_000,
            epic: 34_000,
            legendary: 5_500,
            mythic: 500,
          },
          perPack: {
            common: 999_704,
            uncommon: 1_000_000,
            rare: 800_000,
            epic: 170_000,
            legendary: 27_500,
            mythic: 2_500,
          },
          enchanted: { every: 10, slot: 4, floor: "epic", odds: perTier(ENCHANTED_SLOT_ODDS) },
          radiant: { chance: 400, odds: perTier(RADIANT_SLOT_ODDS), lastSlot: "mythic" },
          pity: { packs: PITY_PACKS, freePacksOnly: true },
          bandScale: 10_000,
          tierBands: perTier(TIER_BAND),
          tierSizes: tierCounts(600),
          snapshot: { version, takenAt: "2026-10-29T09:00:00.000Z", characterCount: 600 },
        },
        packsUntilGuarantee: PITY_PACKS,
      });
    });

    it("opens a standard pack: 201, five different characters at their tiers and slot floors, ranks, kind, counters", async () => {
      const { cookie, account } = await player();
      // Three Commons, an Uncommon and a Rare: no Mythic, so the guarantee comes one pack closer.
      await forceNextPack(app.db, rng, version, [BASE + 391, BASE + 600, BASE + 500, BASE + 241, BASE + 121]);
      const res = await openPack(app, cookie);
      expect(res.statusCode).toBe(201);
      const opened = body<PackOpened>(res);
      expect(opened).toMatchObject({
        packKind: "standard",
        pityMythic: false,
        packsUntilGuarantee: PITY_PACKS - 1,
      });
      expect(opened.cards.map((card) => card.slot)).toEqual([0, 1, 2, 3, 4]);
      expect(opened.cards.map((card) => card.rarity)).toEqual([
        "common",
        "common",
        "common",
        "uncommon",
        "rare",
      ]);
      expect(new Set(opened.cards.map((card) => card.character.id)).size).toBe(PACK_SIZE);
      const ranks = await app.db
        .select({ id: poolSnapshotCharacters.characterId, rank: poolSnapshotCharacters.favouritesRank })
        .from(poolSnapshotCharacters)
        .where(eq(poolSnapshotCharacters.snapshotId, version));
      const rankOf = new Map(ranks.map((row) => [row.id, row.rank]));
      for (const card of opened.cards) {
        expect(card).toMatchObject({ kind: "card", variant: "standard", isNew: true });
        expect(card.rarity).toBe(card.character.tier);
        expect(rank(card.rarity)).toBeGreaterThanOrEqual(rank(SLOT_FLOOR[card.slot] ?? "mythic"));
        expect(card.character.rank).toBe(rankOf.get(card.character.id));
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
      expect(await countersOf(account.id)).toMatchObject({ packsSinceMythic: 1, freePacksOpened: 1 });
      expect(body<PacksResponse>(await getPacks(app, cookie)).packsUntilGuarantee).toBe(PITY_PACKS - 1);

      const stored = await app.db.select().from(cards).where(eq(cards.accountId, account.id));
      expect(stored).toHaveLength(PACK_SIZE);
      expect(stored.every((card) => card.variant === "standard" && card.snapshotId === version)).toBe(true);
      // Card ids stay inside the server.
      for (const card of stored) expect(res.body).not.toContain(card.id);
      const [opening] = await app.db
        .select()
        .from(packOpenings)
        .where(eq(packOpenings.accountId, account.id));
      expect(opening).toMatchObject({ kind: "standard", pity: false });

      const session = body<SessionResponse>(await send(app, { method: "GET", url: "/api/session", cookie }));
      expect(session).toMatchObject({ signedIn: true, account: { cards: PACK_SIZE } });
      const collection = body<{ totals: { cards: number }; entries: unknown[] }>(
        await getCollection(app, cookie),
      );
      expect(collection.totals.cards).toBe(PACK_SIZE);
      expect(collection.entries).toHaveLength(PACK_SIZE);
    });

    it("deals what the generator rolls: a Radiant pack draws five different Epic-or-better cards, Mythic last, and resets the guarantee", async () => {
      const { cookie, account } = await player();
      await forceNextPack(app.db, rng, version, [BASE + 1, BASE + 2, BASE + 3, BASE + 4, BASE + 5]);
      const first = body<PackOpened>(await openPack(app, cookie));
      expect(first).toMatchObject({
        packKind: "radiant",
        pityMythic: false,
        packsUntilGuarantee: PITY_PACKS,
      });
      expect(first.cards.map((card) => [card.character.id, card.rarity, card.isNew])).toEqual([
        [BASE + 1, "mythic", true],
        [BASE + 2, "mythic", true],
        [BASE + 3, "mythic", true],
        [BASE + 4, "mythic", true],
        [BASE + 5, "mythic", true],
      ]);
      // Mythic 1 and 6 again among an Epic and a Legendary: one already owned, the rest new to the account.
      await forceNextPack(app.db, rng, version, [BASE + 1, BASE + 6, BASE + 49, BASE + 13, BASE + 7]);
      const second = body<PackOpened>(await openPack(app, cookie));
      expect(second.packKind).toBe("radiant");
      expect(second.cards.map((card) => [card.character.id, card.rarity, card.isNew])).toEqual([
        [BASE + 1, "mythic", false],
        [BASE + 6, "mythic", true],
        [BASE + 49, "epic", true],
        [BASE + 13, "legendary", true],
        [BASE + 7, "mythic", true],
      ]);
      expect(second.cards.every((card) => atLeastEpic(card.rarity))).toBe(true);
      await forceNextPack(app.db, rng, version, [BASE + 391, BASE + 392, BASE + 393, BASE + 241, BASE + 121]);
      const third = body<PackOpened>(await openPack(app, cookie));
      expect(third.cards[0]?.character).toEqual({
        id: BASE + 391,
        name: `Character ${BASE + 391}`,
        nameNative: null,
        imageUrl: `https://s4.anilist.co/file/anilistcdn/character/large/b${BASE + 391}.png`,
        franchiseIds: [900_091],
        tier: "common",
        rank: 391,
        inCurrentSnapshot: true,
      });
      expect(third.franchises).toContainEqual({
        id: 900_091,
        title: "Series 91",
        titleNative: null,
        startYear: 2013,
      });
      expect(third.packsUntilGuarantee).toBe(PITY_PACKS - 1);
      expect(await countersOf(account.id)).toMatchObject({ packsSinceMythic: 1, freePacksOpened: 3 });
      const kinds = await app.db
        .select({ kind: packOpenings.kind, pity: packOpenings.pity })
        .from(packOpenings)
        .where(eq(packOpenings.accountId, account.id));
      expect(kinds.map((row) => row.kind).sort()).toEqual(["radiant", "radiant", "standard"]);
      expect(kinds.every((row) => !row.pity)).toBe(true);
    });

    it("makes the 10th opening of a fresh account Enchanted, with an Epic-or-better fifth card, and the counters audit against the openings", async () => {
      const { cookie, account } = await player();
      const opened: PackOpened[] = [];
      for (let n = 1; n <= 10; n += 1) {
        rng.script.push(PLAN.standard);
        const res = await later(10 * n, () => openPack(app, cookie));
        expect(res.statusCode, `opening ${n}`).toBe(201);
        opened.push(body<PackOpened>(res));
      }
      expect(opened.map((pack) => pack.packKind)).toEqual([
        ...Array<string>(9).fill("standard"),
        "enchanted",
      ]);
      expect(atLeastEpic(opened[9]?.cards[4]?.rarity ?? "common")).toBe(true);
      expect(opened[9]?.cards[4]?.slot).toBe(4);
      for (const pack of opened.slice(0, 9)) expect(pack.cards[4]?.rarity).not.toBe("common");

      // free_packs_opened is the count of free openings; packs_since_mythic the openings after the last with a Mythic.
      const rows = await app.db
        .select({ openingId: packOpenings.id, openedAt: packOpenings.openedAt, rarity: cards.rarity })
        .from(packOpenings)
        .innerJoin(cards, eq(cards.openingId, packOpenings.id))
        .where(eq(packOpenings.accountId, account.id));
      const byOpening = new Map<string, { at: number; mythic: boolean }>();
      for (const row of rows) {
        const entry = byOpening.get(row.openingId) ?? { at: row.openedAt.getTime(), mythic: false };
        entry.mythic ||= row.rarity === "mythic";
        byOpening.set(row.openingId, entry);
      }
      const ordered = [...byOpening.values()].sort((a, b) => a.at - b.at);
      const lastMythic = ordered.findLastIndex((opening) => opening.mythic);
      expect(await countersOf(account.id)).toMatchObject({
        freePacksOpened: ordered.length,
        packsSinceMythic: ordered.length - 1 - lastMythic,
      });
      expect(opened[9]?.packsUntilGuarantee).toBe(PITY_PACKS - (ordered.length - 1 - lastMythic));
    });

    it("forces a Mythic fifth card by pity after 299 free packs without one: pityMythic true, the guarantee back at 300", async () => {
      const { cookie, account } = await player();
      await app.db
        .update(accounts)
        .set({ packsSinceMythic: PITY_PACKS - 1 })
        .where(eq(accounts.id, account.id));
      expect(body<PacksResponse>(await getPacks(app, cookie)).packsUntilGuarantee).toBe(1);
      rng.script.push(PLAN.standard);
      const res = await openPack(app, cookie);
      expect(res.statusCode).toBe(201);
      const opened = body<PackOpened>(res);
      expect(opened).toMatchObject({
        packKind: "standard",
        pityMythic: true,
        packsUntilGuarantee: PITY_PACKS,
      });
      expect(opened.cards[4]).toMatchObject({ slot: 4, rarity: "mythic" });
      expect(opened.cards.slice(0, 4).every((card) => card.rarity !== "mythic")).toBe(true);
      expect(await countersOf(account.id)).toMatchObject({ packsSinceMythic: 0, freePacksOpened: 1 });
      const [opening] = await app.db
        .select()
        .from(packOpenings)
        .where(eq(packOpenings.accountId, account.id));
      expect(opening).toMatchObject({ kind: "standard", pity: true });
    });

    it("gives a Radiant pack that falls on a pity-due pack no pity flag: it holds its Mythic already", async () => {
      const { cookie, account } = await player();
      await app.db
        .update(accounts)
        .set({ packsSinceMythic: PITY_PACKS - 1 })
        .where(eq(accounts.id, account.id));
      await forceNextPack(app.db, rng, version, [BASE + 49, BASE + 50, BASE + 51, BASE + 52, BASE + 8]);
      const opened = body<PackOpened>(await openPack(app, cookie));
      expect(opened).toMatchObject({
        packKind: "radiant",
        pityMythic: false,
        packsUntilGuarantee: PITY_PACKS,
      });
      expect(opened.cards.map((card) => card.rarity)).toEqual(["epic", "epic", "epic", "epic", "mythic"]);
    });

    it("replays a requestId: 200 with the stored kind, pity flag and cards, the allowance spent once, no counter moved", async () => {
      const { cookie, account } = await player();
      await app.db
        .update(accounts)
        .set({ packsSinceMythic: PITY_PACKS - 1 })
        .where(eq(accounts.id, account.id));
      const requestId = randomUUID();
      rng.script.push(PLAN.standard);
      const first = await openPack(app, cookie, requestId);
      expect(first.statusCode).toBe(201);
      expect(body<PackOpened>(first)).toMatchObject({ packKind: "standard", pityMythic: true });
      const before = await countersOf(account.id);
      const replay = await openPack(app, cookie, requestId);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
      expect(await countersOf(account.id)).toEqual(before);
      expect(await app.db.select().from(cards).where(eq(cards.accountId, account.id))).toHaveLength(
        PACK_SIZE,
      );
      expect(body<PacksResponse>(await getPacks(app, cookie)).allowance.available).toBe(PACK_CAP - 1);
    });

    it("answers a replay with the current packsUntilGuarantee, not the one stored with the opening", async () => {
      const { cookie } = await player();
      const requestId = randomUUID();
      await forceNextPack(app.db, rng, version, [BASE + 391, BASE + 392, BASE + 393, BASE + 241, BASE + 121]);
      expect(body<PackOpened>(await openPack(app, cookie, requestId)).packsUntilGuarantee).toBe(
        PITY_PACKS - 1,
      );
      await forceNextPack(app.db, rng, version, [BASE + 394, BASE + 395, BASE + 396, BASE + 242, BASE + 122]);
      await openPack(app, cookie);
      expect(body<PackOpened>(await openPack(app, cookie, requestId)).packsUntilGuarantee).toBe(
        PITY_PACKS - 2,
      );
    });

    it("answers 409 no_pack_available with the wait after the last pack, counters unchanged, and opens again an interval later", async () => {
      const { cookie, account } = await player();
      for (let i = 0; i < PACK_CAP; i += 1) expect((await openPack(app, cookie)).statusCode).toBe(201);
      const before = await countersOf(account.id);
      const empty = await openPack(app, cookie);
      expect(empty.statusCode).toBe(409);
      expect(error(empty)).toEqual({
        code: "no_pack_available",
        message: "No pack is ready yet",
        retryAfterSeconds: 600,
      });
      expect(empty.headers["retry-after"]).toBe("600");
      expect(await countersOf(account.id)).toEqual(before);
      expect(body<PacksResponse>(await getPacks(app, cookie)).allowance).toMatchObject({
        available: 0,
        nextPackInSeconds: 600,
      });

      expect(error(await later(4, () => openPack(app, cookie))).retryAfterSeconds).toBe(360);
      const again = await later(10, () => openPack(app, cookie));
      expect(again.statusCode).toBe(201);
      expect(body<PackOpened>(again).allowance).toMatchObject({ available: 0, nextPackInSeconds: 600 });
      expect((await countersOf(account.id)).freePacksOpened).toBe(PACK_CAP + 1);
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
      expect((await later(10, () => openPack(app, cookie, requestId))).statusCode).toBe(201);
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

    it("reads an account from before 1c (no allowance clock, counters at their defaults) as full and 300 from the guarantee", async () => {
      const accountId = await insertAccount(app.db, `pk-legacy-${randomUUID().slice(0, 8)}`);
      made.push(accountId);
      const { cookieValue } = await app.sessions.create(accountId, "test", new Date());
      const res = body<PacksResponse>(await getPacks(app, cookieValue));
      expect(res.allowance).toEqual({
        available: PACK_CAP,
        cap: PACK_CAP,
        intervalSeconds: 600,
        nextPackInSeconds: null,
      });
      expect(res.packsUntilGuarantee).toBe(PITY_PACKS);
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

      it("one pack and two different requestIds in parallel: one 201, one 409, free_packs_opened + 1", async () => {
        const { cookie, account } = await playerWith(1);
        const before = (await countersOf(account.id)).freePacksOpened;
        const results = await Promise.all([openPack(app, cookie), openPack(app, cookie)]);
        expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
        expect(await cardCount(account.id)).toBe((PACK_CAP - 1 + 1) * PACK_SIZE);
        expect((await countersOf(account.id)).freePacksOpened).toBe(before + 1);
      });

      it("C packs and C + 1 parallel openings: C x 201 and one 409, free_packs_opened + C", async () => {
        const { cookie, account } = await playerWith(PACK_CAP);
        const results = await Promise.all(Array.from({ length: PACK_CAP + 1 }, () => openPack(app, cookie)));
        expect(results.map((res) => res.statusCode).sort()).toEqual([
          ...Array<number>(PACK_CAP).fill(201),
          409,
        ]);
        expect(await cardCount(account.id)).toBe(PACK_CAP * PACK_SIZE);
        expect((await countersOf(account.id)).freePacksOpened).toBe(PACK_CAP);
      });

      it("one pack and the same requestId twice in parallel: one 201 and one 200 with the same opening, counters moved once", async () => {
        const { cookie, account } = await playerWith(1);
        const before = await countersOf(account.id);
        const requestId = randomUUID();
        const results = await Promise.all([
          openPack(app, cookie, requestId),
          openPack(app, cookie, requestId),
        ]);
        expect(results.map((res) => res.statusCode).sort()).toEqual([200, 201]);
        const [a, b] = results.map((res) => body<PackOpened>(res));
        expect(a?.openingId).toBe(b?.openingId);
        expect(a?.packKind).toBe(b?.packKind);
        expect(a?.cards).toEqual(b?.cards);
        expect(await cardCount(account.id)).toBe(PACK_CAP * PACK_SIZE);
        expect((await countersOf(account.id)).freePacksOpened).toBe(before.freePacksOpened + 1);
        const openings = await app.db
          .select()
          .from(packOpenings)
          .where(and(eq(packOpenings.accountId, account.id), eq(packOpenings.requestId, requestId)));
        expect(openings).toHaveLength(1);
      });
    });
  });
});
