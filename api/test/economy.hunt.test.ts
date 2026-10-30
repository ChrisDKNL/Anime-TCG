import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import type {
  PackOpened,
  PacksResponse,
  RecycleReceipt,
  ShopReceipt,
  ShopResponse,
  Wallet,
} from "@anime-tcg/shared/api";
import { MAX_BALANCE, RECYCLE_VALUE, THEMED_PACK_PRICE } from "@anime-tcg/shared/economy";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { main as resetMain } from "../src/cli/reset-collection.js";
import { createDb } from "../src/db/client.js";
import { accounts, cards, ledgerEntries, packOpenings, poolSnapshots, recycles } from "../src/db/schema.js";
import { resetCollection } from "../src/domain/collection/reset.js";
import { auditLedger } from "../src/domain/economy/audit.js";
import { snapshotThemes } from "../src/domain/economy/themes.js";
import { CARD_ACTION_RATE_LIMIT } from "../src/routes/limits.js";
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
  scriptFor,
} from "./pool-support.js";
import {
  cookieHeader,
  createTestApp,
  migrationsDatabaseUrl,
  send,
  type SignedInClient,
  testConfig,
  testDatabaseUrl,
  WEB_ORIGIN,
} from "./support.js";

/*
 * Tester's hunt on PR #40 (T3: currency and ledger), economy.md §7, §8, §14:
 * what the engineer's route, concurrency and adversarial suites do not reach.
 *
 * Plan:
 * 1. Double credit and double spend: overlapping recycle counts racing for one
 *    entry's copies through two app instances; the same requestId ten times
 *    in parallel; the same requestId in parallel with different bodies (409
 *    request_id_reused, one action); one key racing a timer opening and a shop
 *    purchase; sixteen parallel purchases against real Karma for exactly fifteen.
 * 2. The ledger invariant under load: a burst of mixed operations from four
 *    accounts on two instances, with audit-ledger running during the burst
 *    (repeatable read must not see a torn ledger) and after it.
 * 3. Recycle rules the routes did not exercise: an escrowed copy (written by
 *    the owner, as items 5 and 6 will) is never taken, newest or not; a
 *    character id at the integer bound is a 409, not a 500; a rarity outside
 *    the six is a 400.
 * 4. Balance edges: a credit landing exactly on MAX_BALANCE succeeds and the
 *    next is refused with nothing written; one under the price is refused with
 *    the balance; a refused purchase leaves its key free; a replay at 0 Karma
 *    still answers 200.
 * 5. The shop: a pity-due and Enchanted-due account gets neither from the
 *    shop, its counters stay; a Radiant shop pack from the theme's own cards,
 *    whose Mythic resets packs_since_mythic; another account's purchase key.
 * 6. Reset racing a recycle; an account that keeps its Karma and plays on; the
 *    command's --keep-karma end to end (dry run, confirmed, then the default):
 *    the audit stays clean (a recycle with 0 cards after a reset).
 * 7. Least privilege, column by column, plus TRUNCATE.
 * 8. Data exposure: no balance of another account in any answer, the word
 *    "Karma" in no answer at all.
 * 9. Rate limits: replays count, the GETs keep the global bucket, the limit is
 *    per address.
 * 10. Snapshot changes (last, it moves the current snapshot): a replay
 *    survives no snapshot and a snapshot without the theme; new purchases get
 *    503 and then 404.
 */

const MINUTE = 60_000;
const COMEDY = "genre-comedy";
/** Postgres `insufficient_privilege`; drizzle wraps the pg error as `cause`. */
const PERMISSION_DENIED = "42501";
/** The heavier tests deal many packs; a loaded host makes each one slow, so the bound only catches a hang. */
const SLOW = 180_000;
/** Every other test registers and deals a few packs: seconds on an idle machine, far more on a loaded one. */
const TEST_TIMEOUT = 90_000;

describe("economy, tester's hunt (economy.md §14)", { timeout: TEST_TIMEOUT }, () => {
  let app: App;
  let twin: App;
  let now = new Date("2026-10-31T09:00:00.000Z");
  const rng = scriptedRng();
  const made: string[] = [];
  const forged: string[] = [];
  const snapshots: number[] = [];
  let snapshotId = 0;
  let fillerTurn = 0;

  const player = async () => {
    const client = await newPlayer(app, "eh");
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

  /**
   * Four fillers that change from pack to pack: Commons 104 to 200 and
   * Uncommons, all even (outside the Comedy theme, so a shop pack never adds
   * a copy), and never a Common the tests recycle (all at most 102).
   */
  function fillers(): [number, number, number, number] {
    fillerTurn = (fillerTurn % 48) + 1;
    const n = 2 * fillerTurn;
    return [ID.common(202 - n), ID.common(200 - n), ID.uncommon(140 - n), ID.uncommon(138 - n)];
  }

  /** A pack of `slot1` (or a filler), three fillers and `slot5` (or an even Rare); slot 3 is an Uncommon. */
  function pack(slot1: number | undefined, slot5: number | undefined, i: number): number[] {
    const [a, b, u, v] = fillers();
    return [slot1 ?? a, b, v, u, slot5 ?? ID.rare(2 + 2 * (i % 50))];
  }

  /** `copies` packs: each with `common` in slot 1 (if given) and `top` in slot 5 (if given). */
  async function holder(copies: number, common?: number, top?: number): Promise<SignedInClient> {
    const client = await player();
    for (let i = 0; i < copies; i += 1) await deal(client, pack(common, top, i));
    return client;
  }

  /** Recycles and expects a 201; answers the receipt. */
  async function recycled(
    client: SignedInClient,
    characterId: number,
    rarity: Parameters<typeof recycleBody>[1],
    count: number,
  ) {
    const res = await recycle(app, client.cookie, recycleBody(characterId, rarity, count));
    expect(res.statusCode, res.body).toBe(201);
    return res.json<RecycleReceipt>();
  }

  const owner = () => createDb(migrationsDatabaseUrl());

  async function expectInvariants(accountId: string): Promise<void> {
    const ledger = await ledgerOf(app, accountId);
    expect(ledger.map((row) => row.seq)).toEqual(ledger.map((_, index) => index + 1));
    let running = 0;
    for (const row of ledger) {
      running += row.amount;
      expect(row.balanceAfter, `seq ${row.seq}`).toBe(running);
    }
    expect(await balanceOf(app, accountId)).toBe(running);
  }

  async function auditFailuresOf(ids: readonly string[]) {
    const result = await auditLedger(app.db);
    return result.failures.filter((failure) => ids.includes(failure.id));
  }

  beforeAll(async () => {
    const config = testConfig({ ACCOUNT_CAP: "1000" });
    app = await createTestApp({ config, rng, clock: () => now });
    twin = await createTestApp({ config, rng, clock: () => now });
    const current = await currentSnapshotId(app.db);
    if (current !== null) throw new Error(`snapshot ${current} is current; a previous run left it behind`);
    snapshotId = (await loadSnapshot(app.db, economyPool(), now)).version;
    snapshots.push(snapshotId);
  }, TEST_TIMEOUT);
  afterAll(async () => {
    await expectLedgerConsistent(app, forged);
    await deleteAccounts(app.db, made);
    await deleteSnapshots(snapshots);
    await twin.close();
    await app.close();
  }, TEST_TIMEOUT);

  describe("1. double credit and double spend", () => {
    it(
      "overlapping recycle counts racing for one entry's copies through two instances never take more than its duplicates",
      async () => {
        const client = await holder(5, ID.common(2));
        const counts = [3, 2, 2, 1, 4, 1];
        const results = await Promise.all(
          counts.map((count, i) =>
            recycle(i % 2 === 0 ? app : twin, client.cookie, recycleBody(ID.common(2), "common", count)),
          ),
        );
        const won = counts.filter((_, i) => results[i]?.statusCode === 201);
        for (const res of results) {
          if (res.statusCode !== 201) expect(errorOf(res).code).toBe("not_enough_copies");
        }
        const taken = won.reduce((sum, count) => sum + count, 0);
        expect(taken).toBeGreaterThan(0);
        expect(taken).toBeLessThanOrEqual(4);
        // Greedy in lock order: whatever won, no refused request would still have fitted.
        for (let i = 0; i < counts.length; i += 1) {
          if (results[i]?.statusCode === 409) expect(counts[i] ?? 0).toBeGreaterThan(4 - taken);
        }
        expect(await entryOf(app, client.cookie, ID.common(2))).toMatchObject({ count: 5 - taken });
        expect(await balanceOf(app, client.account.id)).toBe(taken * RECYCLE_VALUE.common);
        const balances = results
          .filter((res) => res.statusCode === 201)
          .map((res) => res.json<RecycleReceipt>().balance)
          .sort((a, b) => a - b);
        expect(new Set(balances).size).toBe(balances.length);
        expect(await ledgerOf(app, client.account.id)).toHaveLength(won.length);
        await expectInvariants(client.account.id);
      },
      SLOW,
    );

    it("the same requestId ten times in parallel through two instances: one 201, nine 200, one credit", async () => {
      const client = await holder(3, ID.common(4));
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          recycle(i % 2 === 0 ? app : twin, client.cookie, recycleBody(ID.common(4), "common", 1, key)),
        ),
      );
      expect(results.map((res) => res.statusCode).sort()).toEqual([
        200, 200, 200, 200, 200, 200, 200, 200, 200, 201,
      ]);
      expect(new Set(results.map((res) => res.json<RecycleReceipt>().recycleId)).size).toBe(1);
      expect(await ledgerOf(app, client.account.id)).toHaveLength(1);
      expect(await entryOf(app, client.cookie, ID.common(4))).toMatchObject({ count: 2 });
    });

    it("the same requestId in parallel with two different recycle bodies: one 201, one 409 request_id_reused", async () => {
      const client = await holder(4, ID.common(6));
      const key = randomUUID();
      const results = await Promise.all([
        recycle(app, client.cookie, recycleBody(ID.common(6), "common", 1, key)),
        recycle(twin, client.cookie, recycleBody(ID.common(6), "common", 2, key)),
      ]);
      expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
      const refused = results.find((res) => res.statusCode === 409);
      expect(refused && errorOf(refused).code).toBe("request_id_reused");
      const winner = results.find((res) => res.statusCode === 201)?.json<RecycleReceipt>();
      expect(await ledgerOf(app, client.account.id)).toHaveLength(1);
      expect(await entryOf(app, client.cookie, ID.common(6))).toMatchObject({
        count: 4 - (winner?.recycled.count ?? 0),
      });
      expect(
        await app.db.select().from(recycles).where(eq(recycles.accountId, client.account.id)),
      ).toHaveLength(1);
    });

    it("the same requestId in parallel for two themes: one 201, one 409 request_id_reused, one debit", async () => {
      const client = await holder(2, undefined, ID.mythic(2));
      await recycled(client, ID.mythic(2), "mythic", 1);
      const key = randomUUID();
      const results = await Promise.all([
        buyPack(app, client.cookie, COMEDY, key),
        buyPack(twin, client.cookie, "genre-action", key),
      ]);
      expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
      const refused = results.find((res) => res.statusCode === 409);
      expect(refused && errorOf(refused).code).toBe("request_id_reused");
      expect(await balanceOf(app, client.account.id)).toBe(RECYCLE_VALUE.mythic - THEMED_PACK_PRICE);
      expect(
        await app.db
          .select()
          .from(packOpenings)
          .where(and(eq(packOpenings.accountId, client.account.id), eq(packOpenings.source, "shop"))),
      ).toHaveLength(1);
    });

    it("one requestId racing a timer opening and a shop purchase: exactly one of them happens", async () => {
      const client = await holder(2, undefined, ID.mythic(4));
      await recycled(client, ID.mythic(4), "mythic", 1);
      now = new Date(now.getTime() + 30 * MINUTE);
      const openingsBefore = await app.db
        .select()
        .from(packOpenings)
        .where(eq(packOpenings.accountId, client.account.id));
      const key = randomUUID();
      const [timer, shop] = await Promise.all([
        openPack(app, client.cookie, key),
        buyPack(twin, client.cookie, COMEDY, key),
      ]);
      expect([timer?.statusCode, shop?.statusCode].sort()).toEqual([201, 409]);
      const refused = timer?.statusCode === 409 ? timer : shop;
      expect(refused && errorOf(refused).code).toBe("request_id_reused");
      const openings = await app.db
        .select()
        .from(packOpenings)
        .where(eq(packOpenings.accountId, client.account.id));
      expect(openings).toHaveLength(openingsBefore.length + 1);
      expect(await balanceOf(app, client.account.id)).toBe(
        shop?.statusCode === 201 ? RECYCLE_VALUE.mythic - THEMED_PACK_PRICE : RECYCLE_VALUE.mythic,
      );
      await expectInvariants(client.account.id);
    });

    it(
      "sixteen parallel purchases through two instances against earned Karma for exactly fifteen: fifteen packs, one 409 at 0",
      async () => {
        // 2 Mythic and 2 Legendary duplicates recycle for 5 500 + 500 = 6 000 = 15 × 400.
        const client = await holder(3, undefined, ID.mythic(6));
        for (let i = 0; i < 3; i += 1) await deal(client, pack(undefined, ID.legendary(2), i));
        await recycled(client, ID.mythic(6), "mythic", 2);
        await recycled(client, ID.legendary(2), "legendary", 2);
        expect(await balanceOf(app, client.account.id)).toBe(15 * THEMED_PACK_PRICE);
        const results = await Promise.all(
          Array.from({ length: 16 }, (_, i) => buyPack(i % 2 === 0 ? app : twin, client.cookie, COMEDY)),
        );
        expect(results.filter((res) => res.statusCode === 201)).toHaveLength(15);
        const refused = results.filter((res) => res.statusCode !== 201);
        expect(refused.map((res) => [res.statusCode, errorOf(res)])).toEqual([
          [409, expect.objectContaining({ code: "insufficient_funds", balance: 0 })],
        ]);
        expect(await balanceOf(app, client.account.id)).toBe(0);
        const balances = results
          .filter((res) => res.statusCode === 201)
          .map((res) => res.json<ShopReceipt>().balance)
          .sort((a, b) => a - b);
        expect(balances).toEqual(Array.from({ length: 15 }, (_, i) => i * THEMED_PACK_PRICE));
        await expectInvariants(client.account.id);
      },
      SLOW,
    );
  });

  describe("2. the ledger invariant under a burst of mixed operations", () => {
    it(
      "four accounts, two instances, recycles, purchases, openings, replays and duplicate keys at once; audit-ledger during and after",
      async () => {
        interface Burster {
          client: SignedInClient;
          common: number;
          mythic: number;
          replayKey: ReturnType<typeof randomUUID>;
          replayId: string;
        }
        const bursters: Burster[] = [];
        for (let k = 0; k < 4; k += 1) {
          const common = ID.common(20 + 2 * k);
          const mythic = ID.mythic(8 + (k % 2) * 2);
          const client = await player();
          for (let i = 0; i < 3; i += 1) await deal(client, pack(common, mythic, i));
          const replayKey = randomUUID();
          const first = await recycle(app, client.cookie, recycleBody(mythic, "mythic", 1, replayKey));
          expect(first.statusCode, first.body).toBe(201);
          bursters.push({
            client,
            common,
            mythic,
            replayKey,
            replayId: first.json<RecycleReceipt>().recycleId,
          });
        }
        now = new Date(now.getTime() + 30 * MINUTE);
        const balancesBefore = await Promise.all(bursters.map((b) => balanceOf(app, b.client.account.id)));

        type Tagged = { who: number; what: string; res: LightMyRequestResponse };
        const calls: Promise<Tagged>[] = [];
        bursters.forEach((b, who) => {
          const on = (i: number) => ((who + i) % 2 === 0 ? app : twin);
          const tag = (what: string, call: Promise<LightMyRequestResponse>) =>
            calls.push(call.then((res) => ({ who, what, res })));
          const dupKey = randomUUID();
          for (let i = 0; i < 3; i += 1)
            tag("recycle-common", recycle(on(i), b.client.cookie, recycleBody(b.common, "common", 1)));
          tag("recycle-mythic", recycle(on(3), b.client.cookie, recycleBody(b.mythic, "mythic", 1)));
          tag("replay", recycle(on(4), b.client.cookie, recycleBody(b.mythic, "mythic", 1, b.replayKey)));
          for (let i = 0; i < 3; i += 1) tag("buy", buyPack(on(5 + i), b.client.cookie, COMEDY));
          tag("buy-dup", buyPack(on(8), b.client.cookie, COMEDY, dupKey));
          tag("buy-dup", buyPack(on(9), b.client.cookie, COMEDY, dupKey));
          tag("open", openPack(on(10), b.client.cookie));
        });
        const ids = bursters.map((b) => b.client.account.id);
        const audits = [auditFailuresOf(ids), auditFailuresOf(ids), auditFailuresOf(ids)];
        const done = await Promise.all(calls);
        expect(await Promise.all(audits)).toEqual([[], [], []]);

        for (const [who, b] of bursters.entries()) {
          const mine = done.filter((call) => call.who === who);
          const of = (what: string) => mine.filter((call) => call.what === what).map((call) => call.res);
          const opened = of("open")[0];
          expect(opened?.statusCode, opened?.body).toBe(201);
          const dealt =
            opened === undefined ? [] : body<PackOpened>(opened).cards.map((card) => card.character.id);
          const extraCommon = dealt.filter((id) => id === b.common).length;

          // 3 copies of the Common (2 duplicates), and 2 Mythic copies left (1 duplicate), plus what the timer pack dealt.
          const commonWins = of("recycle-common").filter((res) => res.statusCode === 201).length;
          expect(commonWins).toBeGreaterThanOrEqual(2);
          expect(commonWins).toBeLessThanOrEqual(2 + extraCommon);
          const mythicWins = of("recycle-mythic").filter((res) => res.statusCode === 201).length;
          // The one duplicate is there before the burst, so the one Mythic recycle always wins.
          expect(mythicWins).toBe(1);
          for (const res of [...of("recycle-common"), ...of("recycle-mythic")]) {
            if (res.statusCode !== 201) expect(errorOf(res).code).toBe("not_enough_copies");
          }
          const replay = of("replay")[0];
          expect(replay?.statusCode).toBe(200);
          expect(replay?.json<RecycleReceipt>().recycleId).toBe(b.replayId);
          expect(of("buy").map((res) => res.statusCode)).toEqual([201, 201, 201]);
          expect(
            of("buy-dup")
              .map((res) => res.statusCode)
              .sort(),
          ).toEqual([200, 201]);

          const credited = [...of("recycle-common"), ...of("recycle-mythic")]
            .filter((res) => res.statusCode === 201)
            .reduce((sum, res) => sum + res.json<RecycleReceipt>().credited, 0);
          expect(await balanceOf(app, b.client.account.id)).toBe(
            (balancesBefore[who] ?? 0) + credited - 4 * THEMED_PACK_PRICE,
          );
          expect(await ledgerOf(app, b.client.account.id)).toHaveLength(1 + commonWins + mythicWins + 4);
          expect((await entryOf(app, b.client.cookie, b.common))?.count).toBe(3 + extraCommon - commonWins);
          await expectInvariants(b.client.account.id);
        }
        expect(await auditFailuresOf(ids)).toEqual([]);
      },
      SLOW,
    );
  });

  describe("3. recycle rules", () => {
    it("never takes an escrowed copy, even the newest, and counts it held but not available", async () => {
      const client = await holder(3, ID.common(30));
      const copies = await app.db
        .select({ id: cards.id, pulledAt: cards.pulledAt })
        .from(cards)
        .where(and(eq(cards.accountId, client.account.id), eq(cards.characterId, ID.common(30))));
      const newest = [...copies].sort((a, b) => b.pulledAt.getTime() - a.pulledAt.getTime())[0];
      if (newest === undefined) throw new Error("three copies");
      // Items 5 and 6 will write escrow_id; the app role may not, so the owner plays the game round.
      const db = owner();
      try {
        await db.update(cards).set({ escrowId: randomUUID() }).where(eq(cards.id, newest.id));
        expect(await entryOf(app, client.cookie, ID.common(30))).toMatchObject({
          count: 3,
          listed: 0,
          available: 2,
          recyclable: 2,
        });
        const over = await recycle(app, client.cookie, recycleBody(ID.common(30), "common", 3));
        expect(errorOf(over).code).toBe("not_enough_copies");
        await recycled(client, ID.common(30), "common", 2);
        const held = await app.db
          .select({ id: cards.id })
          .from(cards)
          .where(
            and(
              eq(cards.accountId, client.account.id),
              eq(cards.characterId, ID.common(30)),
              isNull(cards.removedAt),
            ),
          );
        expect(held).toEqual([{ id: newest.id }]);
        const last = await recycle(app, client.cookie, recycleBody(ID.common(30), "common", 1));
        expect(errorOf(last).code).toBe("not_enough_copies");
        expect(await entryOf(app, client.cookie, ID.common(30))).toMatchObject({
          count: 1,
          available: 0,
          recyclable: 0,
        });
      } finally {
        // audit-ledger rightly reports a card in escrow in item 2; the round ends and returns it.
        await db.update(cards).set({ escrowId: null }).where(eq(cards.id, newest.id));
        await db.$client.end();
      }
      expect(await auditFailuresOf([client.account.id])).toEqual([]);
    });

    it("with two copies both in escrow, recycles nothing", async () => {
      const client = await holder(2, ID.common(32));
      const db = owner();
      try {
        await db
          .update(cards)
          .set({ escrowId: randomUUID() })
          .where(and(eq(cards.accountId, client.account.id), eq(cards.characterId, ID.common(32))));
        expect(await entryOf(app, client.cookie, ID.common(32))).toMatchObject({
          available: 0,
          recyclable: 0,
        });
        const res = await recycle(app, client.cookie, recycleBody(ID.common(32), "common", 1));
        expect(res.statusCode).toBe(409);
        expect(errorOf(res).code).toBe("not_enough_copies");
      } finally {
        await db.update(cards).set({ escrowId: null }).where(eq(cards.accountId, client.account.id));
        await db.$client.end();
      }
      expect(await ledgerOf(app, client.account.id)).toEqual([]);
    });

    it("answers a character id at the integer bound 409 not_enough_copies, never a 500", async () => {
      const client = await holder(1);
      const res = await recycle(app, client.cookie, recycleBody(2_147_483_647, "common", 1));
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).code).toBe("not_enough_copies");
    });

    it.each([["Mythic"], ["masterwork"], ["relic"], [""], [" common"]])(
      "refuses the rarity %j with 400 and moves nothing",
      async (rarity) => {
        const client = await holder(2, ID.common(34));
        const res = await recycle(app, client.cookie, { ...recycleBody(ID.common(34), "common", 1), rarity });
        expect(res.statusCode).toBe(400);
        expect(errorOf(res).code).toBe("validation_failed");
        expect(await ledgerOf(app, client.account.id)).toEqual([]);
      },
    );

    it.each([
      ["a count of 2^31", "2147483648"],
      ["a count of 2^32 + 1", "4294967297"],
      ["a count of 2^53", "9007199254740992"],
      ["a count in exponent form past the bound", "1e3"],
      ["a count of -2^31", "-2147483648"],
    ])("refuses %s with 400 and moves nothing", async (_label, count) => {
      const client = await holder(2, ID.common(36));
      const res = await send(app, {
        method: "POST",
        url: "/api/collection/recycle",
        cookie: client.cookie,
        headers: { "content-type": "application/json" },
        payload: `{"requestId":"${randomUUID()}","characterId":${ID.common(36)},"rarity":"common","count":${count}}`,
      });
      expect(res.statusCode).toBe(400);
      expect(await ledgerOf(app, client.account.id)).toEqual([]);
      expect(await entryOf(app, client.cookie, ID.common(36))).toMatchObject({ count: 2 });
    });
  });

  describe("4. balance edges", () => {
    it("a credit landing exactly on MAX_BALANCE succeeds; the next is refused and writes nothing; spending still works", async () => {
      const client = await holder(3, ID.common(38));
      forged.push(client.account.id);
      await forgeBalance(app, client.account.id, MAX_BALANCE - RECYCLE_VALUE.common);
      const exact = await recycled(client, ID.common(38), "common", 1);
      expect(exact.balance).toBe(MAX_BALANCE);
      const before = await ledgerOf(app, client.account.id);
      const over = await recycle(app, client.cookie, recycleBody(ID.common(38), "common", 1));
      expect(over.statusCode).toBe(409);
      expect(errorOf(over)).toEqual({ code: "balance_limit", message: expect.any(String) as string });
      expect(over.body).not.toMatch(/karma/i);
      expect(await ledgerOf(app, client.account.id)).toEqual(before);
      expect(
        await app.db.select().from(recycles).where(eq(recycles.accountId, client.account.id)),
      ).toHaveLength(1);
      expect(await entryOf(app, client.cookie, ID.common(38))).toMatchObject({ count: 2 });
      const bought = await buyPack(app, client.cookie, COMEDY);
      expect(bought.statusCode).toBe(201);
      expect(bought.json<ShopReceipt>().balance).toBe(MAX_BALANCE - THEMED_PACK_PRICE);
      await expectInvariants(client.account.id);
    });

    it("one under the price is 409 insufficient_funds with that balance; the key stays free for a later purchase", async () => {
      const client = await holder(1);
      forged.push(client.account.id);
      await forgeBalance(app, client.account.id, THEMED_PACK_PRICE - 1);
      const key = randomUUID();
      const res = await buyPack(app, client.cookie, COMEDY, key);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toMatchObject({ code: "insufficient_funds", balance: THEMED_PACK_PRICE - 1 });
      expect(
        await app.db
          .select()
          .from(packOpenings)
          .where(and(eq(packOpenings.accountId, client.account.id), eq(packOpenings.source, "shop"))),
      ).toEqual([]);
      await forgeBalance(app, client.account.id, THEMED_PACK_PRICE);
      const later = await buyPack(app, client.cookie, COMEDY, key);
      expect(later.statusCode).toBe(201);
      expect(later.json<ShopReceipt>().balance).toBe(0);
      const replay = await buyPack(app, client.cookie, COMEDY, key);
      expect(replay.statusCode).toBe(200);
      expect(replay.json<ShopReceipt>()).toMatchObject({ price: THEMED_PACK_PRICE, balance: 0 });
    });
  });

  describe("5. the shop", () => {
    async function comedyTiers() {
      const theme = (await snapshotThemes(app.db, snapshotId)).find((candidate) => candidate.id === COMEDY);
      if (theme === undefined) throw new Error("Comedy is a theme");
      return theme.tiers;
    }

    async function counters(accountId: string) {
      const [row] = await app.db
        .select({
          sinceMythic: accounts.packsSinceMythic,
          freeOpened: accounts.freePacksOpened,
          anchor: accounts.packsAnchorAt,
        })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      return row;
    }

    it("a pity-due, Enchanted-due account gets neither from the shop, and both counters stay", async () => {
      const client = await holder(2, undefined, ID.mythic(12));
      await recycled(client, ID.mythic(12), "mythic", 1);
      await app.db
        .update(accounts)
        .set({ packsSinceMythic: 299, freePacksOpened: 9 })
        .where(eq(accounts.id, client.account.id));
      const before = await counters(client.account.id);
      rng.script.push(
        ...scriptFor(await comedyTiers(), [
          ID.common(1),
          ID.common(3),
          ID.common(5),
          ID.uncommon(1),
          ID.rare(1),
        ]),
      );
      const scripted = await buyPack(app, client.cookie, COMEDY);
      expect(scripted.statusCode, scripted.body).toBe(201);
      expect(scripted.json<ShopReceipt>().pack).toMatchObject({ packKind: "standard", pityMythic: false });
      expect(scripted.json<ShopReceipt>().pack.cards.map((card) => card.rarity)).not.toContain("mythic");
      expect(await counters(client.account.id)).toEqual(before);
      expect(body<PacksResponse>(await getPacks(app, client.cookie)).packsUntilGuarantee).toBe(1);

      for (let i = 0; i < 4; i += 1) {
        const res = await buyPack(app, client.cookie, COMEDY);
        expect(res.statusCode, res.body).toBe(201);
        const pack = res.json<ShopReceipt>().pack;
        expect(pack.packKind).not.toBe("enchanted");
        expect(pack.pityMythic).toBe(false);
        for (const card of pack.cards) expect(inComedy(card.character.id)).toBe(true);
        expect((await counters(client.account.id))?.freeOpened).toBe(9);
      }
    });

    it("can be Radiant, dealt from the theme's own cards, and its Mythic resets packs_since_mythic only", async () => {
      const client = await holder(2, undefined, ID.mythic(12));
      await recycled(client, ID.mythic(12), "mythic", 1);
      await app.db
        .update(accounts)
        .set({ packsSinceMythic: 150, freePacksOpened: 9 })
        .where(eq(accounts.id, client.account.id));
      const before = await counters(client.account.id);
      const ids = [ID.epic(1), ID.epic(3), ID.legendary(1), ID.mythic(1), ID.mythic(3)];
      rng.script.push(...scriptFor(await comedyTiers(), ids));
      const res = await buyPack(app, client.cookie, COMEDY);
      expect(res.statusCode, res.body).toBe(201);
      const pack = res.json<ShopReceipt>().pack;
      expect(pack).toMatchObject({ packKind: "radiant", pityMythic: false });
      expect(pack.cards.map((card) => card.character.id)).toEqual(ids);
      expect(pack.cards.at(-1)?.rarity).toBe("mythic");
      expect(await counters(client.account.id)).toEqual({ ...before, sinceMythic: 0 });
      expect(res.json<ShopReceipt>()).toMatchObject({ price: THEMED_PACK_PRICE });
      const [opening] = await app.db
        .select({ price: packOpenings.price, kind: packOpenings.kind, entry: ledgerEntries.amount })
        .from(packOpenings)
        .innerJoin(ledgerEntries, eq(ledgerEntries.id, packOpenings.ledgerEntryId))
        .where(eq(packOpenings.id, pack.openingId));
      expect(opening).toEqual({ price: THEMED_PACK_PRICE, kind: "radiant", entry: -THEMED_PACK_PRICE });
    });

    it("another account sending a buyer's key with the same theme gets its own purchase, never the buyer's pack", async () => {
      const a = await holder(2, undefined, ID.mythic(12));
      await recycled(a, ID.mythic(12), "mythic", 1);
      const b = await holder(2, undefined, ID.mythic(12));
      await recycled(b, ID.mythic(12), "mythic", 1);
      const key = randomUUID();
      const first = await buyPack(app, a.cookie, COMEDY, key);
      expect(first.statusCode).toBe(201);
      const asB = await buyPack(app, b.cookie, COMEDY, key);
      expect(asB.statusCode).toBe(201);
      expect(asB.json<ShopReceipt>().pack.openingId).not.toBe(first.json<ShopReceipt>().pack.openingId);
      expect(await balanceOf(app, a.account.id)).toBe(RECYCLE_VALUE.mythic - THEMED_PACK_PRICE);
      expect(await balanceOf(app, b.account.id)).toBe(RECYCLE_VALUE.mythic - THEMED_PACK_PRICE);
      // B without the Karma: B's own refusal with B's own balance, not A's receipt.
      const poor = await player();
      const asPoor = await buyPack(app, poor.cookie, COMEDY, key);
      expect(asPoor.statusCode).toBe(409);
      expect(errorOf(asPoor)).toMatchObject({ code: "insufficient_funds", balance: 0 });
    });
  });

  describe("6. reset", () => {
    it(
      "racing a recycle: whichever runs first, the balance ends at 0 and the audit is clean",
      async () => {
        for (let round = 0; round < 3; round += 1) {
          const client = await holder(3, undefined, ID.mythic(10));
          await recycled(client, ID.mythic(10), "mythic", 1);
          const [, res] = await Promise.all([
            resetCollection(app.db, client.account.login, { confirm: true, clock: () => now }),
            recycle(twin, client.cookie, recycleBody(ID.mythic(10), "mythic", 1)),
          ]);
          expect([201, 409]).toContain(res.statusCode);
          if (res.statusCode === 409) expect(errorOf(res).code).toBe("not_enough_copies");
          expect(await balanceOf(app, client.account.id)).toBe(0);
          expect((await ledgerOf(app, client.account.id)).at(-1)).toMatchObject({
            kind: "owner_reset",
            balanceAfter: 0,
          });
          expect(await app.db.select().from(cards).where(eq(cards.accountId, client.account.id))).toEqual([]);
          await expectInvariants(client.account.id);
          expect(await auditFailuresOf([client.account.id])).toEqual([]);
        }
      },
      SLOW,
    );

    it("--keep-karma, then playing on: seq continues, old recycles hold 0 cards, the shop debit without its opening, audit clean", async () => {
      const client = await holder(2, undefined, ID.mythic(12));
      await recycled(client, ID.mythic(12), "mythic", 1);
      expect((await buyPack(app, client.cookie, COMEDY)).statusCode).toBe(201);
      await resetCollection(app.db, client.account.login, {
        confirm: true,
        keepKarma: true,
        clock: () => now,
      });
      expect(await balanceOf(app, client.account.id)).toBe(RECYCLE_VALUE.mythic - THEMED_PACK_PRICE);
      expect(await auditFailuresOf([client.account.id])).toEqual([]);
      for (let i = 0; i < 2; i += 1) await deal(client, pack(undefined, ID.mythic(12), i));
      const again = await recycled(client, ID.mythic(12), "mythic", 1);
      expect(again.balance).toBe(2 * RECYCLE_VALUE.mythic - THEMED_PACK_PRICE);
      expect((await buyPack(app, client.cookie, COMEDY)).statusCode).toBe(201);
      expect((await ledgerOf(app, client.account.id)).map((row) => [row.seq, row.kind])).toEqual([
        [1, "recycle_credit"],
        [2, "shop_purchase"],
        [3, "recycle_credit"],
        [4, "shop_purchase"],
      ]);
      // Then the default reset: one owner_reset of the whole balance.
      await resetCollection(app.db, client.account.login, { confirm: true, clock: () => now });
      expect((await ledgerOf(app, client.account.id)).at(-1)).toEqual({
        seq: 5,
        kind: "owner_reset",
        amount: -(2 * RECYCLE_VALUE.mythic - 2 * THEMED_PACK_PRICE),
        balanceAfter: 0,
      });
      await expectInvariants(client.account.id);
      expect(await auditFailuresOf([client.account.id])).toEqual([]);
    });
    it("the command's --keep-karma, dry run and confirmed, then the default: what it prints and what it writes", async () => {
      const client = await holder(2, undefined, ID.mythic(12));
      await recycled(client, ID.mythic(12), "mythic", 1);
      const quiet = new Writable({ write: (_chunk, _encoding, done) => done() });
      const run = async (argv: string[]) => {
        const out: string[] = [];
        const err: string[] = [];
        const code = await resetMain(argv, testDatabaseUrl(), {
          stdout: { write: (text: string) => out.push(text) },
          stderr: { write: (text: string) => err.push(text) },
          logDestination: quiet,
          clock: () => now,
        });
        return { code, stdout: out.join(""), stderr: err.join("") };
      };
      const login = client.account.login;
      const balance = RECYCLE_VALUE.mythic;

      const preview = await run([login, "--keep-karma"]);
      expect(preview).toMatchObject({ code: 0, stderr: "" });
      expect(preview.stdout).toMatch(/^Would reset /);
      expect(preview.stdout).toContain(`; balance ${balance} kept (--keep-karma).\n`);
      expect(await app.db.select().from(cards).where(eq(cards.accountId, client.account.id))).toHaveLength(
        10,
      );

      const kept = await run([login, "--confirm", "--keep-karma"]);
      expect(kept).toMatchObject({ code: 0, stderr: "" });
      expect(kept.stdout).toContain(`; balance ${balance} kept.\n`);
      expect(await balanceOf(app, client.account.id)).toBe(balance);
      expect(await ledgerOf(app, client.account.id)).toHaveLength(1);
      expect(await app.db.select().from(cards).where(eq(cards.accountId, client.account.id))).toEqual([]);

      const zeroed = await run([login, "--confirm"]);
      expect(zeroed.stdout).toContain(`; balance ${balance} set to 0.\n`);
      expect((await ledgerOf(app, client.account.id)).at(-1)).toEqual({
        seq: 2,
        kind: "owner_reset",
        amount: -balance,
        balanceAfter: 0,
      });
      expect((await run([login, "--confirm"])).stdout).toContain("; balance 0 set to 0.\n");
      expect(await ledgerOf(app, client.account.id)).toHaveLength(2);
      expect(await auditFailuresOf([client.account.id])).toEqual([]);
    });
  });

  describe("7. least privilege (0005)", () => {
    const denied = (statement: string) =>
      expect(app.db.execute(sql.raw(statement))).rejects.toMatchObject({
        cause: { code: PERMISSION_DENIED },
      });

    it.each([
      "id",
      "account_id",
      "opening_id",
      "slot",
      "character_id",
      "rarity",
      "variant",
      "snapshot_id",
      "is_new",
      "pulled_at",
      "escrow_id",
    ])("the app role may not update cards.%s", async (column) => {
      await denied(`update cards set "${column}" = "${column}" where false`);
    });

    it("may update exactly removed_at and removed_by_recycle", async () => {
      await app.db.execute(sql.raw(`update cards set removed_at = removed_at where false`));
      await app.db.execute(sql.raw(`update cards set removed_by_recycle = removed_by_recycle where false`));
    });

    it.each(["id", "account_id", "seq", "kind", "amount", "balance_after", "created_at"])(
      "may not update ledger_entries.%s",
      async (column) => {
        await denied(`update ledger_entries set "${column}" = "${column}" where false`);
      },
    );

    it.each(["request_hash", "count", "unit_value", "ledger_entry_id", "character_id", "rarity"])(
      "may not update recycles.%s",
      async (column) => {
        await denied(`update recycles set "${column}" = "${column}" where false`);
      },
    );

    it.each(["price", "theme_id", "ledger_entry_id", "source"])(
      "may not rewrite a shop opening's pack_openings.%s",
      async (column) => {
        await denied(`update pack_openings set "${column}" = "${column}" where false`);
      },
    );

    it("may neither delete nor truncate a ledger row, a recycle or a card", async () => {
      for (const table of ["ledger_entries", "recycles", "cards"]) {
        await denied(`delete from ${table} where false`);
        await denied(`truncate ${table}`);
      }
    });
  });

  describe("8. data exposure", () => {
    it("each wallet answers its own balance; no parameter names another account; refusals carry only the caller's balance", async () => {
      const rich = await holder(2, undefined, ID.mythic(12));
      await recycled(rich, ID.mythic(12), "mythic", 1);
      const poor = await holder(1, ID.common(40));
      expect(body<Wallet>(await getWallet(app, rich.cookie)).balance).toBe(RECYCLE_VALUE.mythic);
      expect(body<Wallet>(await getWallet(app, poor.cookie)).balance).toBe(0);
      for (const query of [`accountId=${rich.account.id}`, `login=${rich.account.login}`, "account=1"]) {
        const res = await send(app, { method: "GET", url: `/api/wallet?${query}`, cookie: poor.cookie });
        expect(res.statusCode).toBe(400);
        expect(res.body).not.toContain(String(RECYCLE_VALUE.mythic));
      }
      const res = await recycle(app, poor.cookie, recycleBody(ID.mythic(12), "mythic", 1));
      expect(errorOf(res)).toEqual({ code: "not_enough_copies", message: expect.any(String) as string });
      const buy = await buyPack(app, poor.cookie, COMEDY);
      expect(errorOf(buy)).toMatchObject({ code: "insufficient_funds", balance: 0 });
      for (const url of [
        "/api/ledger",
        "/api/wallet/ledger",
        `/api/wallet/${rich.account.id}`,
        "/api/recycles",
      ]) {
        expect((await send(app, { method: "GET", url, cookie: poor.cookie })).statusCode, url).toBe(404);
      }
    });

    it("no economy answer, success or refusal, names the currency", async () => {
      const client = await holder(3, ID.common(42), ID.mythic(12));
      const bodies: string[] = [];
      const keep = (res: LightMyRequestResponse) => {
        bodies.push(res.body);
        return res;
      };
      keep(await getWallet(app, client.cookie));
      keep(await getShop(app, client.cookie));
      keep(await getCollection(app, client.cookie));
      keep(await recycle(app, client.cookie, recycleBody(ID.common(42), "common", 1)));
      const key = randomUUID();
      keep(await recycle(app, client.cookie, recycleBody(ID.mythic(12), "mythic", 1, key)));
      keep(await recycle(app, client.cookie, recycleBody(ID.mythic(12), "mythic", 1, key)));
      keep(await recycle(app, client.cookie, recycleBody(ID.mythic(12), "mythic", 2, key)));
      keep(await recycle(app, client.cookie, recycleBody(ID.common(42), "common", 5)));
      keep(await recycle(app, client.cookie, { ...recycleBody(ID.common(42), "common", 1), amount: 5 }));
      keep(await recycle(app, client.cookie, { ...recycleBody(ID.common(42), "common", 0) }));
      keep(await recycle(app, undefined, recycleBody(ID.common(42), "common", 1)));
      keep(
        await send(app, {
          method: "POST",
          url: "/api/collection/recycle",
          cookie: client.cookie,
          origin: null,
          payload: recycleBody(ID.common(42), "common", 1),
        }),
      );
      keep(await buyPack(app, client.cookie, COMEDY));
      keep(await buyPack(app, client.cookie, "genre-sports"));
      keep(await buyPack(app, client.cookie, "franchise-900001"));
      for (let i = 0; i < 7; i += 1) keep(await buyPack(app, client.cookie, COMEDY));
      const statuses = new Set(
        bodies.map((text) => (JSON.parse(text) as { error?: { code: string } }).error?.code),
      );
      expect(statuses).toEqual(
        new Set([
          undefined,
          "not_enough_copies",
          "request_id_reused",
          "validation_failed",
          "unauthenticated",
          "bad_origin",
          "theme_unavailable",
          "insufficient_funds",
        ]),
      );
      for (const text of bodies) expect(text).not.toMatch(/karma/i);
    });
  });

  describe("9. rate limits on the two POSTs", () => {
    it("replays count against the limit; the GETs keep the global bucket; another address is not limited", async () => {
      const client = await holder(3, ID.common(44));
      const address = "198.51.100.91";
      const call = (method: "GET" | "POST", url: string, payload?: unknown, from = address) =>
        app.inject({
          method,
          url,
          remoteAddress: from,
          headers: { origin: WEB_ORIGIN, cookie: cookieHeader(client.cookie) },
          ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
        });
      const key = randomUUID();
      const statuses: number[] = [];
      for (let i = 0; i < CARD_ACTION_RATE_LIMIT.max; i += 1)
        statuses.push(
          (await call("POST", "/api/collection/recycle", recycleBody(ID.common(44), "common", 1, key)))
            .statusCode,
        );
      expect(statuses[0]).toBe(201);
      expect(statuses.slice(1).every((status) => status === 200)).toBe(true);
      const limited = await call("POST", "/api/collection/recycle", recycleBody(ID.common(44), "common", 1));
      expect(limited.statusCode).toBe(429);
      expect(errorOf(limited).code).toBe("rate_limited");
      expect(limited.body).not.toMatch(/karma/i);
      expect(limited.headers["retry-after"]).toBeDefined();
      expect(await ledgerOf(app, client.account.id)).toHaveLength(1);
      expect((await call("GET", "/api/wallet")).statusCode).toBe(200);
      expect((await call("GET", "/api/collection")).statusCode).toBe(200);
      const other = await call(
        "POST",
        "/api/collection/recycle",
        recycleBody(ID.common(44), "common", 1),
        "198.51.100.92",
      );
      expect(other.statusCode).toBe(201);
      expect(await ledgerOf(app, client.account.id)).toHaveLength(2);
    });
  });

  describe("10. snapshot changes (last: moves the current snapshot)", () => {
    it(
      "a replay survives no snapshot and a snapshot without its theme; new purchases get 503, then 404",
      async () => {
        const client = await holder(2, undefined, ID.mythic(12));
        await recycled(client, ID.mythic(12), "mythic", 1);
        const key = randomUUID();
        const first = await buyPack(app, client.cookie, COMEDY, key);
        expect(first.statusCode).toBe(201);
        const original = first.json<ShopReceipt>();
        const balance = RECYCLE_VALUE.mythic - THEMED_PACK_PRICE;

        const db = owner();
        try {
          await db.update(poolSnapshots).set({ isCurrent: false }).where(eq(poolSnapshots.id, snapshotId));
          const replay = await buyPack(app, client.cookie, COMEDY, key);
          expect(replay.statusCode, replay.body).toBe(200);
          expect(replay.json<ShopReceipt>()).toMatchObject({
            themeId: COMEDY,
            price: THEMED_PACK_PRICE,
            balance,
            pack: { openingId: original.pack.openingId },
          });
          for (const themeId of [COMEDY, "genre-nothing", "franchise-900001"]) {
            const res = await buyPack(app, client.cookie, themeId);
            expect(res.statusCode).toBe(503);
            expect(errorOf(res).code).toBe("pool_unavailable");
            expect(res.body).not.toMatch(/karma/i);
          }
          const reused = await buyPack(app, client.cookie, "genre-action", key);
          expect(errorOf(reused).code).toBe("request_id_reused");
          expect(await balanceOf(app, client.account.id)).toBe(balance);
        } finally {
          await db.update(poolSnapshots).set({ isCurrent: true }).where(eq(poolSnapshots.id, snapshotId));
          await db.$client.end();
        }

        const actionOnly = economyPool();
        actionOnly.entries = actionOnly.entries.map((entry) => ({ ...entry, genres: ["Action"] }));
        const next = (await loadSnapshot(app.db, actionOnly, now)).version;
        snapshots.push(next);
        expect(body<ShopResponse>(await getShop(app, client.cookie)).themes.map((theme) => theme.id)).toEqual(
          ["genre-action"],
        );
        const gone = await buyPack(app, client.cookie, COMEDY);
        expect(gone.statusCode).toBe(404);
        expect(errorOf(gone).code).toBe("theme_unavailable");
        expect(await balanceOf(app, client.account.id)).toBe(balance);
        const replay = await buyPack(app, client.cookie, COMEDY, key);
        expect(replay.statusCode).toBe(200);
        expect(replay.json<ShopReceipt>().pack.cards.map((card) => card.character.id)).toEqual(
          original.pack.cards.map((card) => card.character.id),
        );
        expect((await buyPack(app, client.cookie, "genre-action")).statusCode).toBe(201);
        expect(
          await app.db
            .select({ id: packOpenings.id })
            .from(packOpenings)
            .where(and(eq(packOpenings.accountId, client.account.id), eq(packOpenings.source, "shop"))),
        ).toHaveLength(2);
        await expectInvariants(client.account.id);
      },
      SLOW,
    );
  });
});
