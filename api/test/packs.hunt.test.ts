import { randomInt, randomUUID } from "node:crypto";
import type { CollectionResponse, PackOpened, PacksResponse } from "@anime-tcg/shared/api";
import { PACK_CAP, PACK_SIZE } from "@anime-tcg/shared/economy";
import { ODDS_SCALE, PITY_PACKS, RARITIES, type Rarity } from "@anime-tcg/shared/rarity";
import { and, asc, eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { accounts, cards, packOpenings, poolSnapshots } from "../src/db/schema.js";
import { resetCollection } from "../src/domain/collection/reset.js";
import type { Rng } from "../src/domain/packs/rng.js";
import { tierPool } from "../src/domain/pool/catalog.js";
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
  scriptFor,
} from "./pool-support.js";
import { createTestApp, testConfig } from "./support.js";

/*
 * Tester's hunt on PR #28 (T3): what the engineer's route tests do not reach.
 *
 * Plan
 *  - Lead 5, concurrency: real parallel `inject()` calls against Postgres while
 *    pity and/or Enchanted is due, on one account and on many: no double pity,
 *    no lost counter increment, no second guarantee, `isNew` true once.
 *  - Boundary counters at the route: pity at 298 / 299 / 300, Enchanted at
 *    8 / 9 / 10 and 18 / 19, a Radiant 10th that must not shift the cadence,
 *    and both rules due on one pack.
 *  - Lead 3: a pity-due opening under every plan (standard, Enchanted,
 *    Radiant, Radiant on a 10th), with no pack left, and after a replay:
 *    always a controlled status, never a 500, the counter always in 0..299.
 *  - Lead 4: replaying an idempotency key after `reset-collection`: a new
 *    opening, never the old cards and never both; a reset racing the replay.
 *  - Lead 6: replays and the collection after the current snapshot drops a
 *    character, and after a later snapshot brings it back: the rank is the
 *    current snapshot's or null, never a stale one.
 *
 * The generator: `huntRng` answers from a script while it lasts. Otherwise a
 * call over the whole odds scale (the plan roll and every tier roll) is drawn
 * from [30 000, ODDS_SCALE): never Radiant (< 400), never a natural Mythic or
 * Legendary in a standard fifth slot (< 30 000) and never a Mythic in an
 * Enchanted one (< 12 500). So every Mythic in these tests is a pity Mythic or
 * a scripted one, and the counters are exact, not probable. Picks stay on
 * `crypto.randomInt`.
 */

const MINUTE = 60_000;
const BASE = 800_000;
const SAFE_FLOOR = 30_000;
const rank = (tier: Rarity) => RARITIES.indexOf(tier);

function huntRng(): Rng & { script: number[] } {
  const script: number[] = [];
  const rng = (min: number, max: number) => {
    const next = script.shift();
    if (next !== undefined) {
      if (next < min || next >= max) throw new Error(`scripted ${next} is outside [${min}, ${max})`);
      return next;
    }
    if (min === 0 && max === ODDS_SCALE) return randomInt(SAFE_FLOOR, ODDS_SCALE);
    return randomInt(min, max);
  };
  return Object.assign(rng, { script });
}

const error = (res: LightMyRequestResponse) =>
  res.json<{ error: { code: string; retryAfterSeconds?: number } }>().error;

/** The Postgres error code under a driver or ORM wrapper. */
function pgCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

describe("pack hunt: concurrency, boundaries, replays and dropped characters (PR #28)", () => {
  let app: App;
  let now = new Date("2026-10-29T12:00:00.000Z");
  const rng = huntRng();
  const made: string[] = [];
  const snapshots: number[] = [];
  let version: number;

  const player = async () => {
    const client = await newPlayer(app, "hunt");
    made.push(client.account.id);
    return client;
  };
  const setCounters = (
    accountId: string,
    counters: { packsSinceMythic?: number; freePacksOpened?: number },
  ) => app.db.update(accounts).set(counters).where(eq(accounts.id, accountId));
  const countersOf = async (accountId: string) => {
    const [row] = await app.db
      .select({ packsSinceMythic: accounts.packsSinceMythic, freePacksOpened: accounts.freePacksOpened })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (row === undefined) throw new Error(`no account ${accountId}`);
    return row;
  };
  const openingsOf = (accountId: string) =>
    app.db
      .select({
        id: packOpenings.id,
        requestId: packOpenings.requestId,
        kind: packOpenings.kind,
        pity: packOpenings.pity,
      })
      .from(packOpenings)
      .where(eq(packOpenings.accountId, accountId));
  const cardsOf = (accountId: string) =>
    app.db
      .select({ openingId: cards.openingId, characterId: cards.characterId, rarity: cards.rarity })
      .from(cards)
      .where(eq(cards.accountId, accountId));
  async function later<T>(minutes: number, step: () => Promise<T>): Promise<T> {
    const start = now;
    now = new Date(start.getTime() + minutes * MINUTE);
    try {
      return await step();
    } finally {
      now = start;
    }
  }
  /** Opens one pack at the clock moved `minutes` on (keeping it there), so the allowance never runs dry. */
  async function openAt(minutes: number, cookie: string, requestId: string = randomUUID()) {
    now = new Date(now.getTime() + minutes * MINUTE);
    return openPack(app, cookie, requestId);
  }

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng, clock: () => now });
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    version = (await loadSnapshot(app.db, standardPool())).version;
    snapshots.push(version);
  });
  afterAll(async () => {
    await deleteAccounts(app.db, made);
    await deleteSnapshots(snapshots);
    await app.close();
  });

  describe("lead 5: parallel openings while pity or Enchanted is due", () => {
    it("both due, three packs, three parallel keys: one pity Mythic, in the one Enchanted pack; no lost increment", async () => {
      const { cookie, account } = await player();
      await setCounters(account.id, { packsSinceMythic: PITY_PACKS - 1, freePacksOpened: 9 });
      const results = await Promise.all(Array.from({ length: PACK_CAP }, () => openPack(app, cookie)));
      expect(results.map((res) => res.statusCode)).toEqual([201, 201, 201]);
      const opened = results.map((res) => body<PackOpened>(res));

      const pity = opened.filter((pack) => pack.pityMythic);
      expect(pity).toHaveLength(1);
      expect(pity[0]).toMatchObject({ packKind: "enchanted", packsUntilGuarantee: PITY_PACKS });
      expect(pity[0]?.cards[4]).toMatchObject({ slot: 4, rarity: "mythic" });
      const others = opened.filter((pack) => !pack.pityMythic);
      expect(others.map((pack) => pack.packKind)).toEqual(["standard", "standard"]);
      for (const pack of others) expect(pack.cards.some((card) => card.rarity === "mythic")).toBe(false);
      expect(opened.map((pack) => pack.packsUntilGuarantee).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
        PITY_PACKS - 2,
        PITY_PACKS - 1,
        PITY_PACKS,
      ]);

      expect(await countersOf(account.id)).toEqual({ packsSinceMythic: 2, freePacksOpened: 12 });
      const stored = await openingsOf(account.id);
      expect(stored.filter((row) => row.pity)).toHaveLength(1);
      expect(stored.filter((row) => row.kind === "enchanted")).toHaveLength(1);
      expect((await cardsOf(account.id)).filter((card) => card.rarity === "mythic")).toHaveLength(1);
      expect(body<PacksResponse>(await getPacks(app, cookie)).packsUntilGuarantee).toBe(PITY_PACKS - 2);
    });

    it("pity due, three packs and four parallel keys: 3 x 201 and one 409, one pity pack, counters + 3", async () => {
      const { cookie, account } = await player();
      await setCounters(account.id, { packsSinceMythic: PITY_PACKS - 1 });
      const results = await Promise.all(Array.from({ length: PACK_CAP + 1 }, () => openPack(app, cookie)));
      expect(results.map((res) => res.statusCode).sort()).toEqual([201, 201, 201, 409]);
      const opened = results.filter((res) => res.statusCode === 201).map((res) => body<PackOpened>(res));
      expect(opened.filter((pack) => pack.pityMythic)).toHaveLength(1);
      expect(opened.every((pack) => pack.packKind === "standard")).toBe(true);
      expect(await countersOf(account.id)).toEqual({ packsSinceMythic: 2, freePacksOpened: 3 });
      expect(await cardsOf(account.id)).toHaveLength(PACK_CAP * PACK_SIZE);
    });

    it("Enchanted due (19 opened), three parallel keys: exactly one Enchanted pack, and the 30th is the next", async () => {
      const { cookie, account } = await player();
      await setCounters(account.id, { freePacksOpened: 19 });
      const results = await Promise.all(Array.from({ length: PACK_CAP }, () => openPack(app, cookie)));
      expect(results.map((res) => res.statusCode)).toEqual([201, 201, 201]);
      const kinds = results.map((res) => body<PackOpened>(res).packKind).sort();
      expect(kinds).toEqual(["enchanted", "standard", "standard"]);
      expect(await countersOf(account.id)).toEqual({ packsSinceMythic: 3, freePacksOpened: 22 });
      // Packs 23 to 29 are standard, the 30th Enchanted: three parallel openings did not shift the cadence.
      const next: string[] = [];
      for (let n = 23; n <= 30; n += 1) next.push(body<PackOpened>(await openAt(10, cookie)).packKind);
      expect(next).toEqual([...Array<string>(7).fill("standard"), "enchanted"]);
    });

    it("pity due, one key three times and a second key, in parallel: two openings, one pity, replays identical", async () => {
      const { cookie, account } = await player();
      await setCounters(account.id, { packsSinceMythic: PITY_PACKS - 1 });
      const key = randomUUID();
      const results = await Promise.all([
        openPack(app, cookie, key),
        openPack(app, cookie, key),
        openPack(app, cookie),
        openPack(app, cookie, key),
      ]);
      expect(results.map((res) => res.statusCode).sort()).toEqual([200, 200, 201, 201]);
      const sameKey = [0, 1, 3].map((index) => {
        const res = results[index];
        if (res === undefined) throw new Error(`no answer ${index}`);
        return body<PackOpened>(res);
      });
      expect(new Set(sameKey.map((pack) => pack.openingId)).size).toBe(1);
      expect(sameKey[1]?.cards).toEqual(sameKey[0]?.cards);
      expect(sameKey[2]?.cards).toEqual(sameKey[0]?.cards);
      expect(sameKey[1]?.pityMythic).toBe(sameKey[0]?.pityMythic);
      const stored = await openingsOf(account.id);
      expect(stored).toHaveLength(2);
      expect(stored.filter((row) => row.pity)).toHaveLength(1);
      expect(await countersOf(account.id)).toEqual({ packsSinceMythic: 1, freePacksOpened: 2 });
    });

    it("eight pity-due accounts opening three packs each, all 24 in parallel: one pity pack per account", async () => {
      const clients = await Promise.all(Array.from({ length: 8 }, () => player()));
      for (const { account } of clients) await setCounters(account.id, { packsSinceMythic: PITY_PACKS - 1 });
      const results = await Promise.all(
        clients.flatMap(({ cookie }) => Array.from({ length: PACK_CAP }, () => openPack(app, cookie))),
      );
      expect(results.every((res) => res.statusCode === 201)).toBe(true);
      for (const { account } of clients) {
        const stored = await openingsOf(account.id);
        expect(stored).toHaveLength(PACK_CAP);
        expect(stored.filter((row) => row.pity)).toHaveLength(1);
        expect(await countersOf(account.id)).toEqual({ packsSinceMythic: 2, freePacksOpened: 3 });
      }
    });

    it("two parallel openings dealt the same five characters: isNew is true in exactly one of them", async () => {
      const { cookie, account } = await player();
      const ids = [BASE + 391, BASE + 392, BASE + 393, BASE + 241, BASE + 121];
      const pool = await tierPool(app.db, version);
      rng.script.push(...scriptFor(pool, ids), ...scriptFor(pool, ids));
      const results = await Promise.all([openPack(app, cookie), openPack(app, cookie)]);
      expect(results.map((res) => res.statusCode)).toEqual([201, 201]);
      const flags = results.map((res) => body<PackOpened>(res).cards.map((card) => card.isNew));
      expect(flags.map((pack) => pack.every(Boolean)).sort()).toEqual([false, true]);
      expect(flags.map((pack) => pack.some(Boolean)).sort()).toEqual([false, true]);
      const collection = body<CollectionResponse>(await getCollection(app, cookie));
      expect(collection.entries.map((entry) => entry.count)).toEqual([2, 2, 2, 2, 2]);
      expect(collection.totals).toMatchObject({ cards: 10, duplicates: 5 });
      expect((await countersOf(account.id)).freePacksOpened).toBe(2);
    });
  });

  describe("the counters at their boundaries, through the route", () => {
    it("pity at 298, 299 and after: 2 to go, then 1, then the pity Mythic and 300, then 299", async () => {
      const { cookie, account } = await player();
      await setCounters(account.id, { packsSinceMythic: PITY_PACKS - 2 });
      expect(body<PacksResponse>(await getPacks(app, cookie)).packsUntilGuarantee).toBe(2);

      const before = body<PackOpened>(await openAt(10, cookie));
      expect(before).toMatchObject({ packKind: "standard", pityMythic: false, packsUntilGuarantee: 1 });
      expect(before.cards.some((card) => card.rarity === "mythic")).toBe(false);
      expect((await countersOf(account.id)).packsSinceMythic).toBe(PITY_PACKS - 1);

      const at = body<PackOpened>(await openAt(10, cookie));
      expect(at).toMatchObject({ packKind: "standard", pityMythic: true, packsUntilGuarantee: PITY_PACKS });
      expect(at.cards.map((card) => card.rarity === "mythic")).toEqual([false, false, false, false, true]);
      expect((await countersOf(account.id)).packsSinceMythic).toBe(0);

      const after = body<PackOpened>(await openAt(10, cookie));
      expect(after).toMatchObject({ pityMythic: false, packsUntilGuarantee: PITY_PACKS - 1 });
    });

    it("cannot store the counter outside 0..299: the database refuses 300 (threshold + 1) and -1", async () => {
      const { account } = await player();
      for (const value of [PITY_PACKS, -1]) {
        let caught: unknown;
        try {
          await setCounters(account.id, { packsSinceMythic: value });
        } catch (err) {
          caught = err;
        }
        expect(pgCode(caught), `packs_since_mythic = ${value}`).toBe("23514");
      }
      expect((await countersOf(account.id)).packsSinceMythic).toBe(0);
    });

    it("Enchanted at 8, 9 and 10 opened, and at 18 and 19: only the 10th and the 20th pack", async () => {
      const kindAt = async (freePacksOpened: number) => {
        const { cookie, account } = await player();
        await setCounters(account.id, { freePacksOpened });
        const opened = body<PackOpened>(await openPack(app, cookie));
        expect((await countersOf(account.id)).freePacksOpened).toBe(freePacksOpened + 1);
        if (opened.packKind === "enchanted")
          expect(rank(opened.cards[4]?.rarity ?? "common")).toBeGreaterThanOrEqual(rank("epic"));
        return opened.packKind;
      };
      expect([
        await kindAt(8),
        await kindAt(9),
        await kindAt(10),
        await kindAt(18),
        await kindAt(19),
      ]).toEqual(["standard", "enchanted", "standard", "standard", "enchanted"]);
    });

    it("a Radiant pack on the 10th still counts it: the 11th to 19th are standard and the 20th Enchanted", async () => {
      const { cookie, account } = await player();
      await setCounters(account.id, { freePacksOpened: 9 });
      rng.script.push(
        ...scriptFor(await tierPool(app.db, version), [BASE + 49, BASE + 50, BASE + 13, BASE + 14, BASE + 1]),
      );
      const radiant = body<PackOpened>(await openAt(10, cookie));
      expect(radiant).toMatchObject({ packKind: "radiant", pityMythic: false });
      expect(await countersOf(account.id)).toEqual({ packsSinceMythic: 0, freePacksOpened: 10 });
      const kinds: string[] = [];
      for (let n = 11; n <= 20; n += 1) kinds.push(body<PackOpened>(await openAt(10, cookie)).packKind);
      expect(kinds).toEqual([...Array<string>(9).fill("standard"), "enchanted"]);
    });

    it("both due on one pack, opened alone: enchanted, pity Mythic fifth, both counters right", async () => {
      const { cookie, account } = await player();
      await setCounters(account.id, { packsSinceMythic: PITY_PACKS - 1, freePacksOpened: 29 });
      const opened = body<PackOpened>(await openPack(app, cookie));
      expect(opened).toMatchObject({
        packKind: "enchanted",
        pityMythic: true,
        packsUntilGuarantee: PITY_PACKS,
      });
      expect(opened.cards[4]?.rarity).toBe("mythic");
      expect(opened.cards.filter((card) => card.rarity === "mythic")).toHaveLength(1);
      expect(await countersOf(account.id)).toEqual({ packsSinceMythic: 0, freePacksOpened: 30 });
      expect(await openingsOf(account.id)).toMatchObject([{ kind: "enchanted", pity: true }]);
    });
  });

  describe("lead 3: a pity-due opening is always a controlled outcome, never a 500", () => {
    it.each([
      ["standard", 0, false],
      ["Enchanted", 9, false],
      ["Radiant", 0, true],
      ["Radiant on a 10th", 9, true],
    ] as const)(
      "pity due under a %s plan: 201, a Mythic fifth card, the counter back to 0",
      async (_label, opened, radiant) => {
        const { cookie, account } = await player();
        await setCounters(account.id, { packsSinceMythic: PITY_PACKS - 1, freePacksOpened: opened });
        if (radiant)
          rng.script.push(
            ...scriptFor(await tierPool(app.db, version), [
              BASE + 49,
              BASE + 50,
              BASE + 51,
              BASE + 52,
              BASE + 2,
            ]),
          );
        const res = await openPack(app, cookie);
        expect(res.statusCode, res.body).toBe(201);
        const pack = body<PackOpened>(res);
        expect(pack.cards[4]?.rarity).toBe("mythic");
        expect(pack.pityMythic).toBe(!radiant);
        expect(pack.packKind).toBe(radiant ? "radiant" : opened === 9 ? "enchanted" : "standard");
        expect(await countersOf(account.id)).toEqual({ packsSinceMythic: 0, freePacksOpened: opened + 1 });
      },
    );

    it("pity due with no pack left: 409 with the wait, the counter stays at 299, and the pity comes with the next pack", async () => {
      const { cookie, account } = await player();
      for (let i = 0; i < PACK_CAP; i += 1) expect((await openPack(app, cookie)).statusCode).toBe(201);
      await setCounters(account.id, { packsSinceMythic: PITY_PACKS - 1 });
      const empty = await openPack(app, cookie);
      expect(empty.statusCode).toBe(409);
      expect(error(empty)).toMatchObject({ code: "no_pack_available", retryAfterSeconds: 600 });
      expect((await countersOf(account.id)).packsSinceMythic).toBe(PITY_PACKS - 1);
      const next = await later(10, () => openPack(app, cookie));
      expect(next.statusCode).toBe(201);
      expect(body<PackOpened>(next).pityMythic).toBe(true);
    });

    it("a replay while pity is due moves nothing and keeps the guarantee for the next new key", async () => {
      const { cookie, account } = await player();
      await setCounters(account.id, { packsSinceMythic: PITY_PACKS - 2 });
      const key = randomUUID();
      expect((await openPack(app, cookie, key)).statusCode).toBe(201);
      const replay = await openPack(app, cookie, key);
      expect(replay.statusCode).toBe(200);
      expect(body<PackOpened>(replay)).toMatchObject({ pityMythic: false, packsUntilGuarantee: 1 });
      expect((await countersOf(account.id)).packsSinceMythic).toBe(PITY_PACKS - 1);
      const next = body<PackOpened>(await openPack(app, cookie));
      expect(next).toMatchObject({ pityMythic: true, packsUntilGuarantee: PITY_PACKS });
      // Replaying the pity pack later answers its stored flag with the current count.
      expect(body<PackOpened>(await openPack(app, cookie, key)).packsUntilGuarantee).toBe(PITY_PACKS);
    });
  });

  describe("replay before the allowance (§5.3 step 2 before step 3)", () => {
    it("replays a key with no pack left: 200 with the stored opening, not 409", async () => {
      const { cookie, account } = await player();
      const key = randomUUID();
      const first = body<PackOpened>(await openPack(app, cookie, key));
      for (let i = 1; i < PACK_CAP; i += 1) expect((await openPack(app, cookie)).statusCode).toBe(201);
      expect((await openPack(app, cookie)).statusCode).toBe(409);
      const replay = await openPack(app, cookie, key);
      expect(replay.statusCode).toBe(200);
      expect(body<PackOpened>(replay)).toMatchObject({
        openingId: first.openingId,
        allowance: { available: 0 },
      });
      expect((await countersOf(account.id)).freePacksOpened).toBe(PACK_CAP);
    });
  });

  describe("lead 4: an idempotency key replayed after reset-collection", () => {
    it("opens a new pack (201, a new opening): never the old cards, never both, the counters at one pack", async () => {
      const { cookie, account } = await player();
      const key = randomUUID();
      const first = body<PackOpened>(await openPack(app, cookie, key));
      await openPack(app, cookie);
      await resetCollection(app.db, account.login, { confirm: true });

      const again = await openPack(app, cookie, key);
      expect(again.statusCode).toBe(201);
      const reopened = body<PackOpened>(again);
      expect(reopened.openingId).not.toBe(first.openingId);
      expect(reopened.allowance.available).toBe(PACK_CAP - 1);
      expect(reopened.packsUntilGuarantee).toBe(PITY_PACKS - 1);
      expect(reopened.cards.every((card) => card.isNew)).toBe(true);
      const held = await cardsOf(account.id);
      expect(held).toHaveLength(PACK_SIZE);
      expect(new Set(held.map((card) => card.openingId))).toEqual(new Set([reopened.openingId]));
      expect(await openingsOf(account.id)).toMatchObject([{ id: reopened.openingId, requestId: key }]);
      expect(await countersOf(account.id)).toEqual({ packsSinceMythic: 1, freePacksOpened: 1 });

      // From then on the key replays the new opening.
      const replay = await openPack(app, cookie, key);
      expect(replay.statusCode).toBe(200);
      expect(body<PackOpened>(replay).openingId).toBe(reopened.openingId);
    });

    it("after a reset, the old key twice in parallel: one 201 and one 200 with the same new opening", async () => {
      const { cookie, account } = await player();
      const key = randomUUID();
      await openPack(app, cookie, key);
      await resetCollection(app.db, account.login, { confirm: true });
      const results = await Promise.all([openPack(app, cookie, key), openPack(app, cookie, key)]);
      expect(results.map((res) => res.statusCode).sort()).toEqual([200, 201]);
      const [a, b] = results.map((res) => body<PackOpened>(res).openingId);
      expect(a).toBe(b);
      expect(await cardsOf(account.id)).toHaveLength(PACK_SIZE);
      expect((await countersOf(account.id)).freePacksOpened).toBe(1);
    });

    it("a reset racing a replay of the same key: 0 or 5 cards, never 10, and the counters match what survived", async () => {
      for (let round = 0; round < 6; round += 1) {
        const { cookie, account } = await player();
        const key = randomUUID();
        const first = body<PackOpened>(await openPack(app, cookie, key));
        const [res] = await Promise.all([
          openPack(app, cookie, key),
          resetCollection(app.db, account.login, { confirm: true }),
        ]);
        const held = await cardsOf(account.id);
        const counters = await countersOf(account.id);
        if (res.statusCode === 200) {
          // The replay ran first and answered the old opening; the reset then removed it.
          expect(body<PackOpened>(res).openingId).toBe(first.openingId);
          expect(held).toEqual([]);
          expect(counters).toEqual({ packsSinceMythic: 0, freePacksOpened: 0 });
        } else {
          // The reset ran first; the key then opened a new pack on the emptied account.
          expect(res.statusCode).toBe(201);
          expect(body<PackOpened>(res).openingId).not.toBe(first.openingId);
          expect(held).toHaveLength(PACK_SIZE);
          expect(counters.freePacksOpened).toBe(1);
        }
      }
    });

    it("a reset clears a due pity: the guarantee is back at 300 and the next pack is not a pity pack", async () => {
      const { cookie, account } = await player();
      await setCounters(account.id, { packsSinceMythic: PITY_PACKS - 1, freePacksOpened: 9 });
      await resetCollection(app.db, account.login, { confirm: true });
      expect(body<PacksResponse>(await getPacks(app, cookie)).packsUntilGuarantee).toBe(PITY_PACKS);
      const next = body<PackOpened>(await openPack(app, cookie));
      expect(next).toMatchObject({
        packKind: "standard",
        pityMythic: false,
        packsUntilGuarantee: PITY_PACKS - 1,
      });
    });
  });

  describe("lead 6: ranks of a character the current snapshot dropped", () => {
    // Snapshot 1 is the standard pool. Snapshot 2 drops BASE + 2 (Mythic, rank 2), so everyone after it
    // moves up one rank. Snapshot 3 brings it back with a Common's favourites.
    const DROPPED = BASE + 2;
    const KEPT = BASE + 3;
    let cookie: string;
    let key: string;
    let firstOpening: PackOpened;
    let firstOpeningAccount: string;

    beforeAll(async () => {
      const client = await player();
      cookie = client.cookie;
      firstOpeningAccount = client.account.id;
      key = randomUUID();
      // A Radiant pack of Mythics 2 and 3, Legendaries 13 and 14, and Mythic 1 last.
      rng.script.push(
        ...scriptFor(await tierPool(app.db, version), [DROPPED, KEPT, BASE + 13, BASE + 14, BASE + 1]),
      );
      firstOpening = body<PackOpened>(await openPack(app, cookie, key));
      const pool = standardPool();
      pool.characters = pool.characters.filter((character) => character.id !== DROPPED);
      snapshots.push((await loadSnapshot(app.db, pool)).version);
    });

    it("the opening named ranks 2 and 3 while snapshot 1 was current", () => {
      expect(firstOpening.cards.slice(0, 2).map((card) => [card.character.id, card.character.rank])).toEqual([
        [DROPPED, 2],
        [KEPT, 3],
      ]);
    });

    it("a replay shows the dropped card with its granted rarity, tier and rank null, its snapshot-1 franchise, and the others' new ranks", async () => {
      const replay = await openPack(app, cookie, key);
      expect(replay.statusCode).toBe(200);
      const pack = body<PackOpened>(replay);
      expect(pack.openingId).toBe(firstOpening.openingId);
      expect(pack.cards.map((card) => card.rarity)).toEqual(firstOpening.cards.map((card) => card.rarity));
      expect(pack.cards[0]?.character).toMatchObject({
        id: DROPPED,
        tier: null,
        rank: null,
        inCurrentSnapshot: false,
        franchiseIds: [900_002],
      });
      expect(pack.franchises.map((franchise) => franchise.id)).toContain(900_002);
      // Snapshot 2 has 599 characters: KEPT is now rank 2, Mythic 1 still rank 1.
      expect(pack.cards[1]?.character).toMatchObject({ id: KEPT, rank: 2, inCurrentSnapshot: true });
      expect(pack.cards[4]?.character).toMatchObject({ id: BASE + 1, rank: 1, inCurrentSnapshot: true });
    });

    it("the collection agrees: rank null for the dropped character, current ranks for the rest, in no completion", async () => {
      const collection = body<CollectionResponse>(await getCollection(app, cookie));
      const byId = new Map(collection.entries.map((entry) => [entry.character.id, entry.character]));
      expect(byId.get(DROPPED)).toMatchObject({ tier: null, rank: null, inCurrentSnapshot: false });
      expect(byId.get(KEPT)?.rank).toBe(2);
      expect(collection.snapshot?.characterCount).toBe(599);
      expect(collection.completion.pool).toEqual({ owned: 4, total: 599 });
      expect(collection.totals.cards).toBe(PACK_SIZE);
      const ranks = collection.entries.flatMap((entry) =>
        entry.character.rank === null ? [] : [entry.character.rank],
      );
      for (const value of ranks) expect(value).toBeLessThanOrEqual(599);
    });

    it("a later snapshot that brings the character back shows that snapshot's rank and tier, not snapshot 1's", async () => {
      const pool = standardPool();
      const back = pool.characters.find((character) => character.id === DROPPED);
      if (back === undefined) throw new Error("fixture changed");
      back.favourites = 1;
      snapshots.push((await loadSnapshot(app.db, pool)).version);
      const pack = body<PackOpened>(await openPack(app, cookie, key));
      expect(pack.cards[0]?.character).toMatchObject({
        id: DROPPED,
        tier: "common",
        rank: 600,
        inCurrentSnapshot: true,
      });
      expect(pack.cards[0]?.rarity).toBe("mythic");
      const collection = body<CollectionResponse>(await getCollection(app, cookie));
      const entry = collection.entries.find((candidate) => candidate.character.id === DROPPED);
      expect(entry).toMatchObject({ rarity: "mythic", character: { tier: "common", rank: 600 } });
      expect(collection.completion.pool).toEqual({ owned: PACK_SIZE, total: 600 });
    });

    it("packs never deal a character while it is dropped: snapshot 2's pool has no row for it", async () => {
      const [, second] = snapshots;
      if (second === undefined) throw new Error("no second snapshot");
      const pool = await tierPool(app.db, second);
      expect(RARITIES.some((tier) => pool[tier].includes(DROPPED))).toBe(false);
      const rows = await app.db
        .select({ id: cards.characterId })
        .from(cards)
        .where(and(eq(cards.snapshotId, second), eq(cards.characterId, DROPPED)))
        .orderBy(asc(cards.characterId));
      expect(rows).toEqual([]);
    });

    it("with no current snapshot at all, a replay still answers 200: every rank and tier null, packsUntilGuarantee null", async () => {
      const latest = snapshots.at(-1);
      if (latest === undefined) throw new Error("no snapshot");
      await app.db.update(poolSnapshots).set({ isCurrent: false }).where(eq(poolSnapshots.id, latest));
      try {
        const replay = await openPack(app, cookie, key);
        expect(replay.statusCode, replay.body).toBe(200);
        const pack = body<PackOpened>(replay);
        expect(pack.openingId).toBe(firstOpening.openingId);
        expect(pack.packsUntilGuarantee).toBeNull();
        for (const card of pack.cards) {
          expect(card.character).toMatchObject({ tier: null, rank: null, inCurrentSnapshot: false });
          expect(card.character.franchiseIds.length).toBeGreaterThan(0);
        }
        expect(pack.cards.map((card) => card.rarity)).toEqual(firstOpening.cards.map((card) => card.rarity));
        // A new key has nothing to deal from: 503, and nothing moves.
        const before = await countersOf(firstOpeningAccount);
        const fresh = await openPack(app, cookie);
        expect(fresh.statusCode).toBe(503);
        expect(await countersOf(firstOpeningAccount)).toEqual(before);
      } finally {
        await app.db.update(poolSnapshots).set({ isCurrent: true }).where(eq(poolSnapshots.id, latest));
      }
    });
  });
});
