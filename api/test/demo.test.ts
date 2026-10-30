import type { DemoOpened, DemoResponse, PackOpened, PacksResponse } from "@anime-tcg/shared/api";
import { DEMO_PACKS_PER_VISIT, PACK_CAP, PACK_SIZE } from "@anime-tcg/shared/economy";
import { ODDS_SCALE, RARITIES, type Rarity, SLOT_FLOOR } from "@anime-tcg/shared/rarity";
import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { poolSnapshotCharacters } from "../src/db/schema.js";
import type { Rng } from "../src/domain/packs/rng.js";
import { standardPool } from "./fixtures/pool.js";
import {
  body,
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  getPacks,
  loadSnapshot,
  newPlayer,
  openPack,
  scriptedRng,
} from "./pool-support.js";
import { createTestApp, send, testConfig } from "./support.js";

/*
 * Route tests for the landing page's demo (navigation-and-landing.md §3.8).
 * Test plan:
 *
 * 1. Without a snapshot: `GET /api/demo` answers the rules with null odds and
 *    pool; `POST /api/demo/open` is 503 `pool_unavailable`.
 * 2. With one: the facts are the snapshot's (characters, entries) and the odds
 *    are the object `GET /api/packs` publishes; the opening deals five
 *    different characters of the current snapshot in slot order, each card's
 *    rarity its character's tier, at or above its slot's floor, with every
 *    franchise it names; no cookie is set.
 * 3. Contract: a query string, a body (even `{}`) and a missing Origin are refused.
 * 4. Same roll, same odds (§3.8 item 3): one script dealt through the demo and
 *    through a real opening gives the same cards; every threshold edge of the
 *    published standard and Radiant tables lands on the published tier through
 *    the demo route; ten and more demo packs in a row are never Enchanted or
 *    pity-due; and on the real generator every demo pack's rarities and kind
 *    are exactly what its rolls map to in the published tables.
 */

const error = (res: LightMyRequestResponse) => res.json<{ error: { code: string } }>().error;
const rank = (tier: Rarity) => RARITIES.indexOf(tier);
const getDemo = (app: App, url = "/api/demo") => send(app, { method: "GET", url });
const openDemo = (app: App, payload?: unknown, url = "/api/demo/open") =>
  send(app, { method: "POST", url, payload });

/** Rarest first: each threshold of a table's roll is the running sum of the tiers above it (§5.4.4). */
const ROLL_ORDER: readonly Rarity[] = [...RARITIES].reverse();

/** The tier a roll lands on in one published table, read the way §5.4.4 says the server reads it. */
function publishedTier(table: Record<Rarity, number>, r: number): Rarity {
  let threshold = 0;
  for (const tier of ROLL_ORDER) {
    threshold += table[tier];
    if (r < threshold) return tier;
  }
  throw new RangeError(`roll ${r} is past the published scale`);
}

/** The roll values either side of every boundary between the tiers a published table can land on. */
function edgesOf(table: Record<Rarity, number>, scale: number): number[] {
  const edges = [0];
  let threshold = 0;
  for (const tier of ROLL_ORDER) {
    threshold += table[tier];
    if (table[tier] > 0 && threshold < scale) edges.push(threshold - 1, threshold);
  }
  edges.push(scale - 1);
  return edges;
}

describe("demo routes (navigation-and-landing.md §3.8)", () => {
  let app: App;
  const script = scriptedRng();
  /** Every call the server made to its generator, in order, with what it answered. */
  const draws: { min: number; max: number; value: number }[] = [];
  const rng: Rng = (min, max) => {
    const value = script(min, max);
    draws.push({ min, max, value });
    return value;
  };
  const made: string[] = [];
  const snapshots: number[] = [];

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng });
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
  });
  beforeEach(() => {
    script.script.length = 0;
    draws.length = 0;
  });
  afterAll(async () => {
    await deleteAccounts(app.db, made);
    await deleteSnapshots(snapshots);
    await app.close();
  });

  describe("1. without a snapshot", () => {
    it("GET /api/demo answers the timer-pack rules and the per-visit count, with no odds and no pool", async () => {
      const res = await getDemo(app);
      expect(res.statusCode).toBe(200);
      expect(body<DemoResponse>(res)).toEqual({
        odds: null,
        pool: null,
        allowance: { intervalSeconds: 600, cap: PACK_CAP },
        perVisit: DEMO_PACKS_PER_VISIT,
      });
    });

    it("POST /api/demo/open is 503 pool_unavailable and rolls nothing", async () => {
      const res = await openDemo(app);
      expect(res.statusCode).toBe(503);
      expect(error(res).code).toBe("pool_unavailable");
      expect(draws).toEqual([]);
    });
  });

  describe("with a snapshot", () => {
    beforeAll(async () => {
      snapshots.push((await loadSnapshot(app.db, standardPool())).version);
    });

    it("2. GET /api/demo answers the snapshot's facts and exactly the odds GET /api/packs publishes", async () => {
      const client = await newPlayer(app, "dm");
      made.push(client.account.id);
      const packs = body<PacksResponse>(await getPacks(app, client.cookie));
      const res = await getDemo(app);
      expect(res.statusCode).toBe(200);
      expect(res.headers["set-cookie"]).toBeUndefined();
      const demo = body<DemoResponse>(res);
      expect(demo).toEqual({
        odds: packs.odds,
        pool: { characters: 600, entries: 100 },
        allowance: { intervalSeconds: packs.allowance.intervalSeconds, cap: packs.allowance.cap },
        perVisit: DEMO_PACKS_PER_VISIT,
      });
      expect(demo.odds?.snapshot.characterCount).toBe(demo.pool?.characters);
    });

    it("2. POST /api/demo/open deals five different characters of the snapshot in slot order, each at its tier, with their franchises", async () => {
      const rows = await app.db
        .select({ id: poolSnapshotCharacters.characterId, tier: poolSnapshotCharacters.tier })
        .from(poolSnapshotCharacters)
        .where(eq(poolSnapshotCharacters.snapshotId, snapshots[0] ?? 0));
      const tierOf = new Map(rows.map((row) => [row.id, row.tier]));
      for (let i = 0; i < 5; i += 1) {
        const res = await openDemo(app);
        expect(res.statusCode).toBe(200);
        expect(res.headers["set-cookie"]).toBeUndefined();
        const { cards, franchises } = body<DemoOpened>(res);
        expect(cards.map((card) => card.slot)).toEqual([0, 1, 2, 3, 4]);
        expect(new Set(cards.map((card) => card.character.id)).size).toBe(PACK_SIZE);
        for (const card of cards) {
          expect(tierOf.get(card.character.id)).toBe(card.rarity);
          expect(card.character).toMatchObject({ tier: card.rarity, inCurrentSnapshot: true });
          expect(card.character.rank).not.toBeNull();
          expect(rank(card.rarity)).toBeGreaterThanOrEqual(rank(SLOT_FLOOR[card.slot] ?? "common"));
          for (const id of card.character.franchiseIds) {
            expect(franchises.map((franchise) => franchise.id)).toContain(id);
          }
        }
      }
    });

    it("3. refuses a query string, any body and a missing Origin", async () => {
      expect((await getDemo(app, "/api/demo?pool=1")).statusCode).toBe(400);
      expect((await openDemo(app, undefined, "/api/demo/open?seed=0")).statusCode).toBe(400);
      for (const payload of [
        {},
        { rarity: "mythic" },
        [],
        { requestId: "00000000-0000-4000-8000-000000000000" },
      ]) {
        const res = await openDemo(app, payload);
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      }
      // A plain-text body is no JSON at all.
      expect(error(await openDemo(app, "mythic")).code).toBe("unsupported_media_type");
      const anonymous = await send(app, { method: "POST", url: "/api/demo/open", origin: null });
      expect(anonymous.statusCode).toBe(403);
      expect(error(anonymous).code).toBe("bad_origin");
      expect(draws).toEqual([]);
    });

    describe("4. same roll, same odds as a pack", () => {
      it("one script deals the same cards through the demo and through a real opening", async () => {
        const client = await newPlayer(app, "dm");
        made.push(client.account.id);
        const rolls = [ODDS_SCALE - 1, 950_000, 3, 10_000, 0, 50_000, 7, 0, 9, 1_000, 4];
        script.script.push(...rolls);
        const demo = body<DemoOpened>(await openDemo(app));
        script.script.push(...rolls);
        const real = await openPack(app, client.cookie);
        expect(real.statusCode).toBe(201);
        const pack = body<PackOpened>(real);
        expect(pack.packKind).toBe("standard");
        expect(demo.cards.map(({ slot, character, rarity }) => ({ slot, id: character.id, rarity }))).toEqual(
          pack.cards.map(({ slot, character, rarity }) => ({ slot, id: character.id, rarity })),
        );
      });

      it("every threshold edge of the published standard and Radiant tables lands on the published tier through the demo", async () => {
        const odds = body<DemoResponse>(await getDemo(app)).odds;
        if (odds === null) throw new Error("no odds published");
        const last = odds.enchanted.slot;
        const kinds = [
          { radiant: false, tables: odds.slots.map((slot) => slot.odds) },
          { radiant: true, tables: odds.slots.map(() => odds.radiant.odds) },
        ];
        let packs = 0;
        for (const { radiant, tables } of kinds) {
          const edges = tables.map((table) => edgesOf(table, odds.scale));
          const count = Math.max(...edges.map((list) => list.length));
          for (let k = 0; k < count; k += 1) {
            // Not Radiant at the chance itself or the top of the scale; Radiant at 0 or one below the chance.
            const plan = radiant
              ? k % 2 === 0
                ? 0
                : odds.radiant.chance - 1
              : k % 2 === 0
                ? odds.radiant.chance
                : odds.scale - 1;
            const rolls = edges.map((list) => list[k % list.length] ?? 0);
            const tiers = rolls.map((r, slot) =>
              radiant && slot === last
                ? odds.radiant.lastSlot
                : publishedTier(tables[slot] ?? odds.radiant.odds, r),
            );
            // The plan roll, then per slot its tier roll (none for Radiant's forced Mythic) and a pick over the
            // published tier size that takes the first character the tier's shuffle still has.
            const expected = [{ min: 0, max: odds.scale, value: plan }];
            const drawn = new Map<Rarity, number>();
            tiers.forEach((tier, slot) => {
              if (!(radiant && slot === last))
                expected.push({ min: 0, max: odds.scale, value: rolls[slot] ?? 0 });
              const picked = drawn.get(tier) ?? 0;
              drawn.set(tier, picked + 1);
              expected.push({ min: picked, max: odds.tierSizes[tier], value: picked });
            });
            script.script.push(...expected.map((call) => call.value));
            draws.length = 0;
            const res = await openDemo(app);
            expect(res.statusCode).toBe(200);
            expect(body<DemoOpened>(res).cards.map((card) => card.rarity)).toEqual(tiers);
            expect(draws).toEqual(expected);
            packs += 1;
          }
        }
        expect(packs).toBe(8 + 6);
      });

      it("is never Enchanted or pity-due: twelve top-of-scale demo packs in a row each deal every slot's floor", async () => {
        for (let i = 0; i < 12; i += 1) {
          script.script.push(
            ODDS_SCALE - 1,
            ...SLOT_FLOOR.flatMap((_, slot) => [ODDS_SCALE - 1, slot < 3 ? slot : 0]),
          );
          const res = await openDemo(app);
          expect(res.statusCode).toBe(200);
          expect(
            body<DemoOpened>(res).cards.map((card) => card.rarity),
            `demo pack ${i + 1}`,
          ).toEqual([...SLOT_FLOOR]);
        }
      });

      it("on the real generator, demo packs and real packs from one snapshot deal exactly what their rolls map to in the published tables", async () => {
        const client = await newPlayer(app, "dm");
        made.push(client.account.id);
        const odds = body<DemoResponse>(await getDemo(app)).odds;
        if (odds === null) throw new Error("no odds published");
        const check = (rarities: readonly Rarity[], label: string) => {
          const [plan, ...tierRolls] = draws.filter((call) => call.min === 0 && call.max === ODDS_SCALE);
          if (plan === undefined) throw new Error("no plan roll");
          const radiant = plan.value < odds.radiant.chance;
          const tables = radiant
            ? odds.slots.map(() => odds.radiant.odds)
            : odds.slots.map((slot) => slot.odds);
          const expected = tierRolls.map((call, slot) =>
            publishedTier(tables[slot] ?? odds.radiant.odds, call.value),
          );
          expect(rarities, label).toEqual(radiant ? [...expected, odds.radiant.lastSlot] : expected);
          return radiant;
        };
        for (let i = 0; i < 40; i += 1) {
          draws.length = 0;
          const demo = body<DemoOpened>(await openDemo(app));
          check(
            demo.cards.map((card) => card.rarity),
            `demo pack ${i + 1}`,
          );
        }
        for (let i = 0; i < PACK_CAP; i += 1) {
          draws.length = 0;
          const pack = body<PackOpened>(await openPack(app, client.cookie));
          const radiant = check(
            pack.cards.map((card) => card.rarity),
            `real pack ${i + 1}`,
          );
          expect(pack.packKind).toBe(radiant ? "radiant" : "standard");
        }
      });
    });
  });
});
