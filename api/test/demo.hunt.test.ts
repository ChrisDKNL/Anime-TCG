import type { DemoOpened, DemoResponse, PublishedOdds } from "@anime-tcg/shared/api";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { RARITIES, type Rarity } from "@anime-tcg/shared/rarity";
import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app.js";
import { accounts, sessions } from "../src/db/schema.js";
import { drawPack, planPack, type TierPool } from "../src/domain/packs/roll.js";
import { cryptoRng, type Rng } from "../src/domain/packs/rng.js";
import { tierPool } from "../src/domain/pool/catalog.js";
import { IMAGE_URL_MAX, NAME_MAX, SNAPSHOT_SERIES, TITLE_MAX } from "../src/domain/pool/limits.js";
import { DEMO_RATE_LIMIT, PACK_RATE_LIMIT, AUTH_RATE_LIMIT } from "../src/routes/limits.js";
import { type FixturePool, standardPool } from "./fixtures/pool.js";
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
  PLAN,
} from "./pool-support.js";
import {
  cookieHeader,
  createTestApp,
  nextClientAddress,
  sessionCookieFrom,
  type SignedInClient,
  testConfig,
  WEB_ORIGIN,
} from "./support.js";

/*
 * Tester's hunt on the landing page's public demo (navigation-and-landing.md §3.7, §3.8;
 * collection-packs.md §5.4; docs/05-security.md T3): what demo.test.ts and
 * security/demo.security.test.ts do not reach. Test plan:
 *
 * 1. `sessionless` is the demo's alone: every route in the route table is probed with a forged
 *    session cookie; the session plugin's hook clears it on every route but the demo's two (and
 *    the HEAD Fastify adds for the facts), and the routes whose config carries the flag are those
 *    and no other.
 * 2. A signed-in caller who sends their cookie: demo openings, a Radiant one with a Mythic in it
 *    included, change nothing of theirs (the account row's allowance clock and both counters, the
 *    packs answer, the collection answer, the session row); the answers carry nothing of theirs and
 *    set no cookie.
 * 3. CSRF with odd Origin values: `null`, a trailing slash, a different case, a path, another
 *    scheme or port, padding, a duplicated header, a good Referer behind a bad Origin.
 * 4. DEMO_RATE_LIMIT across the window: twenty spread over the minute, the 21st refused near its
 *    end with a Retry-After that counts what is left, the next window fresh; a 429 sets no cookie
 *    even with one sent. Independent of the auth, packs and global buckets, both ways.
 * 5. Seeded statistics: the demo service deals exactly what the shared `planPack("demo")` and
 *    `drawPack` deal on the same generator, and on a seeded generator 200 000 such packs match the
 *    published tables (per slot, Radiant's chance, perPack and share).
 * 6. Size: with every string the snapshot allows at its longest, an opening's body stays under the
 *    bound the snapshot limits give it, and the facts are a few hundred bytes whatever the pool.
 */

const DEMO = { method: "GET", url: "/api/demo" } as const;
const DEMO_OPEN = { method: "POST", url: "/api/demo/open" } as const;

/** A 32-bit generator (mulberry32) behind the app's `Rng` contract, with rejection so every integer is equally likely. */
function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  return (min, max) => {
    const range = max - min;
    const limit = Math.floor(2 ** 32 / range) * range;
    for (;;) {
      const x = Math.floor(next() * 2 ** 32);
      if (x < limit) return min + (x % range);
    }
  };
}

/** Pearson's statistic over the bins with something expected, and its degrees of freedom. */
function chiSquare(
  observed: readonly number[],
  expected: readonly number[],
): { statistic: number; df: number } {
  let statistic = 0;
  let bins = 0;
  observed.forEach((o, i) => {
    const e = expected[i] ?? 0;
    if (e === 0) {
      if (o !== 0) statistic = Number.POSITIVE_INFINITY;
      return;
    }
    statistic += (o - e) ** 2 / e;
    bins += 1;
  });
  return { statistic, df: Math.max(bins - 1, 0) };
}

/** χ² critical values at α = 0.001. The generator is seeded, so each check is one fixed number, never a flake. */
const CRITICAL: Record<number, number> = { 0: 0, 1: 10.828, 2: 13.816, 3: 16.266, 4: 18.467, 5: 20.515 };
/** Two-sided z at α = 0.001. */
const Z_CRITICAL = 3.291;

const error = (res: LightMyRequestResponse) => res.json<{ error: { code: string } }>().error;

describe("demo, tester's hunt (navigation-and-landing.md §3.8)", () => {
  let app: App;
  /** The app's generator: the real one unless a test swaps in a seeded or scripted one. */
  let current: Rng = cryptoRng;
  const rng: Rng = (min, max) => current(min, max);
  const made: string[] = [];
  const snapshots: number[] = [];
  const clockAt = new Date("2026-10-30T10:00:00.000Z");
  let tiers: TierPool;

  const inject = (
    route: { method: string; url: string },
    options: { headers?: Record<string, string | string[]>; remoteAddress?: string; payload?: string } = {},
  ) =>
    app.inject({
      method: route.method as "GET",
      url: route.url,
      remoteAddress: options.remoteAddress ?? nextClientAddress(),
      headers: { origin: WEB_ORIGIN, ...options.headers },
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    });
  const player = async (): Promise<SignedInClient> => {
    const client = await newPlayer(app, "dh");
    made.push(client.account.id);
    return client;
  };

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng, clock: () => clockAt });
    const existing = await currentSnapshotId(app.db);
    if (existing !== null)
      throw new Error(`snapshot ${existing} is current; a previous test run left it behind`);
    const loaded = await loadSnapshot(app.db, standardPool());
    snapshots.push(loaded.version);
    tiers = await tierPool(app.db, loaded.version);
  });
  beforeEach(() => {
    current = cryptoRng;
  });
  afterAll(async () => {
    vi.useRealTimers();
    await deleteAccounts(app.db, made);
    await deleteSnapshots(snapshots);
    await app.close();
  });

  describe("1. the sessionless flag belongs to the demo's routes only", () => {
    /** Every method and path in the route table, from Fastify's own print of it. */
    function routeTable(): { method: string; url: string }[] {
      const routes: { method: string; url: string }[] = [];
      const stack: string[] = [];
      for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
        const match = /^([│ ]*)[├└]── (\S+)(?: \(([^)]+)\))?$/.exec(line);
        if (match === null) continue;
        const depth = (match[1] ?? "").length / 4;
        const path = `${stack[depth - 1] ?? ""}${match[2] ?? ""}`;
        stack[depth] = path;
        stack.length = depth + 1;
        for (const method of (match[3] ?? "").split(", ").filter(Boolean)) routes.push({ method, url: path });
      }
      return routes;
    }

    it("a forged cookie is cleared by every route but the demo's, and only the demo's carry the flag", async () => {
      const routes = routeTable();
      // The table is the app's real one: every route family the app registers is in it.
      expect(routes.map((r) => `${r.method} ${r.url}`)).toEqual(
        expect.arrayContaining([
          "GET /healthz",
          "GET /api/session",
          "POST /api/session/login",
          "POST /api/accounts/register",
          "PATCH /api/account/login",
          "POST /api/packs/open",
          "GET /api/collection",
          "GET /api/demo",
          "HEAD /api/demo",
          "POST /api/demo/open",
        ]),
      );
      const flagged = new Map<string, boolean>();
      app.addHook("onRequest", async (req) => {
        flagged.set(
          `${req.method} ${req.routeOptions.url ?? ""}`,
          req.routeOptions.config.sessionless === true,
        );
      });
      const kept: string[] = [];
      for (const route of routes) {
        const res = await inject(route, { headers: { cookie: cookieHeader("forged-not-issued-value") } });
        const setCookie = res.headers["set-cookie"];
        const cleared =
          setCookie !== undefined && sessionCookieFrom(setCookie) === undefined && String(setCookie) !== "";
        if (!cleared) kept.push(`${route.method} ${route.url} (${res.statusCode})`);
        if (setCookie !== undefined && !cleared) throw new Error(`${route.method} ${route.url} set a cookie`);
      }
      expect(kept.map((line) => line.replace(/ \(\d+\)$/, ""))).toEqual([
        "GET /api/demo",
        "HEAD /api/demo",
        "POST /api/demo/open",
      ]);
      expect(
        [...flagged.entries()]
          .filter(([, sessionless]) => sessionless)
          .map(([key]) => key)
          .sort(),
      ).toEqual(["GET /api/demo", "HEAD /api/demo", "POST /api/demo/open"]);
      expect(flagged.size).toBe(routes.length);
    });
  });

  describe("2. a signed-in caller's cookie on a demo opening changes nothing of theirs", () => {
    it("the account row, the packs answer, the collection answer and the session row are as before, after a Radiant Mythic deal too", async () => {
      const client = await player();
      // One real pack first, so the allowance clock and both counters are off their defaults.
      expect((await openPack(app, client.cookie)).statusCode).toBe(201);
      const state = async () => {
        const [row] = await app.db.select().from(accounts).where(eq(accounts.id, client.account.id));
        const [session] = await app.db
          .select()
          .from(sessions)
          .where(eq(sessions.accountId, client.account.id));
        return {
          anchor: row?.packsAnchorAt?.toISOString() ?? null,
          packsSinceMythic: row?.packsSinceMythic,
          freePacksOpened: row?.freePacksOpened,
          updatedAt: row?.updatedAt.toISOString(),
          session:
            session === undefined ? null : { ...session, lastSeenAt: session.lastSeenAt.toISOString() },
          packs: (await getPacks(app, client.cookie)).body,
          collection: (await getCollection(app, client.cookie)).body,
        };
      };
      const before = await state();
      expect(before.freePacksOpened).toBe(1);

      const cookie = cookieHeader(client.cookie);
      const answers: LightMyRequestResponse[] = [];
      // A Radiant plan: its last slot is Mythic, which would zero `packsSinceMythic` if it were counted.
      const script = [PLAN.radiant];
      current = (min, max) => script.shift() ?? cryptoRng(min, max);
      answers.push(await inject(DEMO_OPEN, { headers: { cookie } }));
      current = cryptoRng;
      for (let i = 0; i < 4; i += 1) answers.push(await inject(DEMO_OPEN, { headers: { cookie } }));
      answers.push(await inject(DEMO, { headers: { cookie } }));

      expect(answers.map((res) => res.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(body<DemoOpened>(answers[0] as LightMyRequestResponse).cards[PACK_SIZE - 1]?.rarity).toBe(
        "mythic",
      );
      for (const res of answers) {
        expect(res.headers["set-cookie"]).toBeUndefined();
        expect(res.body).not.toContain(client.account.id);
        expect(res.body).not.toContain(client.account.login);
        expect(res.body).not.toMatch(/isNew|available|nextPackInSeconds|openingId|favourites|login/);
      }
      expect(await state()).toEqual(before);
    });
  });

  describe("3. CSRF with odd Origin values", () => {
    const upper = WEB_ORIGIN.toUpperCase();
    it.each<[string, Record<string, string | string[]>]>([
      ["Origin: null (an opaque origin: a sandboxed frame, a file, a redirect)", { origin: "null" }],
      ["Origin: null with the web origin as Referer", { origin: "null", referer: `${WEB_ORIGIN}/` }],
      ["a trailing slash", { origin: `${WEB_ORIGIN}/` }],
      ["the web origin in upper case", { origin: upper }],
      ["the host alone in upper case", { origin: WEB_ORIGIN.replace("localhost", "LOCALHOST") }],
      ["a path after the origin", { origin: `${WEB_ORIGIN}/api/demo/open` }],
      ["https instead of http", { origin: WEB_ORIGIN.replace("http:", "https:") }],
      ["another port", { origin: WEB_ORIGIN.replace(/:\d+$/, ":5174") }],
      ["no port", { origin: WEB_ORIGIN.replace(/:\d+$/, "") }],
      ["127.0.0.1 for localhost", { origin: WEB_ORIGIN.replace("localhost", "127.0.0.1") }],
      ["a leading space", { origin: ` ${WEB_ORIGIN}` }],
      ["userinfo before the host", { origin: WEB_ORIGIN.replace("//", "//user@") }],
      ["the web origin twice", { origin: [WEB_ORIGIN, WEB_ORIGIN] }],
      [
        "a foreign Origin with the web origin as Referer",
        { origin: "http://evil.example", referer: `${WEB_ORIGIN}/` },
      ],
      ["no Origin and a Referer on a look-alike host", { referer: `${WEB_ORIGIN}.evil.example/` }],
      ["no Origin and Referer: null", { referer: "null" }],
      ["no Origin and an empty Referer", { referer: "" }],
    ])("refuses %s with 403 bad_origin and deals nothing", async (_label, headers) => {
      let draws = 0;
      current = (min, max) => {
        draws += 1;
        return cryptoRng(min, max);
      };
      const res = await app.inject({
        method: "POST",
        url: "/api/demo/open",
        remoteAddress: nextClientAddress(),
        headers,
      });
      expect(res.statusCode).toBe(403);
      expect(error(res).code).toBe("bad_origin");
      expect(res.body).not.toMatch(/cards|rarity/);
      expect(draws).toBe(0);
    });

    it("accepts the exact web origin, and a Referer on it when no Origin is sent", async () => {
      expect((await inject(DEMO_OPEN)).statusCode).toBe(200);
      const res = await app.inject({
        method: "POST",
        url: "/api/demo/open",
        remoteAddress: nextClientAddress(),
        headers: { referer: `${WEB_ORIGIN}/` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("4. DEMO_RATE_LIMIT across its window and beside the other buckets", () => {
    it("twenty spread over the minute pass, the 21st near its end waits for what is left, the next window is fresh", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
      try {
        const remoteAddress = "198.51.100.201";
        const start = Date.now();
        const statuses: number[] = [];
        for (let i = 0; i < DEMO_RATE_LIMIT.max; i += 1) {
          vi.setSystemTime(start + i * 2_500);
          statuses.push((await inject(DEMO_OPEN, { remoteAddress })).statusCode);
        }
        expect(statuses).toEqual(Array.from({ length: DEMO_RATE_LIMIT.max }, () => 200));
        vi.setSystemTime(start + DEMO_RATE_LIMIT.timeWindow - 5_000);
        const refused = await inject(DEMO_OPEN, {
          remoteAddress,
          headers: { cookie: cookieHeader("forged-not-issued-value") },
        });
        expect(refused.statusCode).toBe(429);
        expect(refused.headers["set-cookie"]).toBeUndefined();
        expect(Object.keys(refused.json<object>())).toEqual(["error"]);
        const wait = Number(refused.headers["retry-after"]);
        expect(wait).toBeGreaterThanOrEqual(1);
        expect(wait).toBeLessThanOrEqual(5);
        vi.setSystemTime(start + DEMO_RATE_LIMIT.timeWindow + 1);
        const fresh: number[] = [];
        for (let i = 0; i < DEMO_RATE_LIMIT.max; i += 1) {
          fresh.push((await inject(DEMO_OPEN, { remoteAddress })).statusCode);
        }
        expect(fresh).toEqual(Array.from({ length: DEMO_RATE_LIMIT.max }, () => 200));
        expect((await inject(DEMO_OPEN, { remoteAddress })).statusCode).toBe(429);
      } finally {
        vi.useRealTimers();
      }
    });

    it("is not the auth bucket: an exhausted demo leaves the auth routes theirs, and an exhausted auth bucket leaves the demo its twenty", async () => {
      const checkInvite = { method: "POST", url: "/api/accounts/check-invite" };
      const json = { "content-type": "application/json" };

      const a = "198.51.100.202";
      for (let i = 0; i < DEMO_RATE_LIMIT.max; i += 1) await inject(DEMO_OPEN, { remoteAddress: a });
      expect((await inject(DEMO_OPEN, { remoteAddress: a })).statusCode).toBe(429);
      const auth: number[] = [];
      for (let i = 0; i < AUTH_RATE_LIMIT.max; i += 1) {
        auth.push((await inject(checkInvite, { remoteAddress: a, headers: json, payload: "{}" })).statusCode);
      }
      expect(auth).toEqual(Array.from({ length: AUTH_RATE_LIMIT.max }, () => 400));

      const b = "198.51.100.203";
      for (let i = 0; i < AUTH_RATE_LIMIT.max; i += 1) {
        await inject(checkInvite, { remoteAddress: b, headers: json, payload: "{}" });
      }
      expect((await inject(checkInvite, { remoteAddress: b, headers: json, payload: "{}" })).statusCode).toBe(
        429,
      );
      const demo: number[] = [];
      for (let i = 0; i < DEMO_RATE_LIMIT.max; i += 1)
        demo.push((await inject(DEMO_OPEN, { remoteAddress: b })).statusCode);
      expect(demo).toEqual(Array.from({ length: DEMO_RATE_LIMIT.max }, () => 200));
    });

    it("is not the packs bucket: twenty-one pack openings from an address leave its twenty demo packs", async () => {
      const client = await player();
      const remoteAddress = "198.51.100.204";
      const cookie = cookieHeader(client.cookie);
      const packs: number[] = [];
      for (let i = 0; i <= PACK_RATE_LIMIT.max; i += 1) {
        const res = await inject(
          { method: "POST", url: "/api/packs/open" },
          {
            remoteAddress,
            headers: { cookie, "content-type": "application/json" },
            payload: JSON.stringify({ requestId: crypto.randomUUID() }),
          },
        );
        packs.push(res.statusCode);
      }
      expect(packs.at(-1)).toBe(429);
      const demo: number[] = [];
      for (let i = 0; i < DEMO_RATE_LIMIT.max; i += 1)
        demo.push((await inject(DEMO_OPEN, { remoteAddress })).statusCode);
      expect(demo).toEqual(Array.from({ length: DEMO_RATE_LIMIT.max }, () => 200));
    });

    it("is not the global bucket: openings do not spend the facts' quota, and facts that are refused leave the openings", async () => {
      const small = await createTestApp({
        config: testConfig({ RATE_LIMIT_MAX: "5" }),
        rng,
        clock: () => clockAt,
      });
      try {
        const send = (route: { method: string; url: string }, remoteAddress: string) =>
          small.inject({
            method: route.method as "GET",
            url: route.url,
            remoteAddress,
            headers: { origin: WEB_ORIGIN },
          });
        const a = "198.51.100.205";
        const opened: number[] = [];
        for (let i = 0; i < DEMO_RATE_LIMIT.max; i += 1) opened.push((await send(DEMO_OPEN, a)).statusCode);
        expect(opened).toEqual(Array.from({ length: DEMO_RATE_LIMIT.max }, () => 200));
        const facts: number[] = [];
        for (let i = 0; i <= 5; i += 1) facts.push((await send(DEMO, a)).statusCode);
        expect(facts).toEqual([200, 200, 200, 200, 200, 429]);

        const b = "198.51.100.206";
        for (let i = 0; i < 5; i += 1) await send(DEMO, b);
        expect((await send(DEMO, b)).statusCode).toBe(429);
        expect((await send(DEMO_OPEN, b)).statusCode).toBe(200);
      } finally {
        await small.close();
      }
    });
  });

  describe("5. the demo deals the published tables (seeded)", () => {
    const NO_COUNTERS = { packsSinceMythic: 0, freePacksOpened: 0 };

    it("the service deals exactly what planPack('demo') and drawPack deal on the same generator", async () => {
      current = seededRng(20261030);
      const served: string[] = [];
      for (let i = 0; i < 50; i += 1) {
        const pack = await app.demo.open();
        served.push(pack.cards.map((card) => `${card.slot}:${card.character.id}:${card.rarity}`).join(" "));
      }
      const replay = seededRng(20261030);
      const planned = Array.from({ length: 50 }, () =>
        drawPack(tiers, planPack(NO_COUNTERS, "demo", replay), replay)
          .map((card) => `${card.slot}:${card.characterId}:${card.tier}`)
          .join(" "),
      );
      expect(served).toEqual(planned);
    });

    it("200 000 seeded demo packs match the published per-slot tables, Radiant's chance, perPack and share", async () => {
      const odds = body<DemoResponse>(await inject(DEMO)).odds as PublishedOdds;
      const packs = 200_000;
      const generator = seededRng(0x5eed);
      const standardSlots = odds.slots.map(() => RARITIES.map(() => 0));
      const radiantSlots = odds.slots.map(() => RARITIES.map(() => 0));
      const atLeastOne = RARITIES.map(() => 0);
      const perPackCounts: number[][] = RARITIES.map(() => []);
      let radiant = 0;
      let wrongTier = 0;
      let special = 0;
      const members = Object.fromEntries(RARITIES.map((tier) => [tier, new Set(tiers[tier])])) as Record<
        Rarity,
        Set<number>
      >;
      for (let p = 0; p < packs; p += 1) {
        const plan = planPack(NO_COUNTERS, "demo", generator);
        if (plan.kind === "enchanted" || plan.pity) special += 1;
        const dealt = drawPack(tiers, plan, generator);
        const into = plan.kind === "radiant" ? radiantSlots : standardSlots;
        if (plan.kind === "radiant") radiant += 1;
        for (const card of dealt) {
          const row = into[card.slot];
          if (row !== undefined)
            row[RARITIES.indexOf(card.tier)] = (row[RARITIES.indexOf(card.tier)] ?? 0) + 1;
          if (!members[card.tier].has(card.characterId)) wrongTier += 1;
        }
        if (plan.kind !== "radiant") {
          RARITIES.forEach((tier, t) => {
            const n = dealt.filter((card) => card.tier === tier).length;
            if (n > 0) atLeastOne[t] = (atLeastOne[t] ?? 0) + 1;
            perPackCounts[t]?.push(n);
          });
        }
      }
      expect(wrongTier).toBe(0);
      expect(special).toBe(0);
      const standard = packs - radiant;

      // Radiant's chance: one plan roll per pack below `radiant.chance` out of the scale.
      const radiantRate = chiSquare(
        [radiant, standard],
        [
          (packs * odds.radiant.chance) / odds.scale,
          (packs * (odds.scale - odds.radiant.chance)) / odds.scale,
        ],
      );
      expect(radiantRate.statistic).toBeLessThanOrEqual(CRITICAL[radiantRate.df] ?? 0);

      // Each slot of a standard pack against its published table; each of a Radiant pack's first four against
      // `radiant.odds`, its last always `radiant.lastSlot`.
      odds.slots.forEach((slot, s) => {
        const observed = standardSlots[s] ?? [];
        const expected = RARITIES.map((tier) => (standard * slot.odds[tier]) / odds.scale);
        const { statistic, df } = chiSquare(observed, expected);
        expect(statistic, `standard slot ${s}: ${observed.join(", ")}`).toBeLessThanOrEqual(
          CRITICAL[df] ?? 0,
        );
      });
      for (let s = 0; s < PACK_SIZE - 1; s += 1) {
        const observed = radiantSlots[s] ?? [];
        // Legendary and Mythic share a bin: Mythic alone expects too few for the χ² approximation.
        const merge = (row: readonly number[]) => [
          row[RARITIES.indexOf("epic")] ?? 0,
          (row[RARITIES.indexOf("legendary")] ?? 0) + (row[RARITIES.indexOf("mythic")] ?? 0),
          RARITIES.filter((tier) => !["epic", "legendary", "mythic"].includes(tier)).reduce(
            (sum, tier) => sum + (row[RARITIES.indexOf(tier)] ?? 0),
            0,
          ),
        ];
        const expectedRow = RARITIES.map((tier) => (radiant * odds.radiant.odds[tier]) / odds.scale);
        const { statistic, df } = chiSquare(merge(observed), merge(expectedRow));
        expect(statistic, `radiant slot ${s}: ${observed.join(", ")}`).toBeLessThanOrEqual(CRITICAL[df] ?? 0);
      }
      expect(radiantSlots[PACK_SIZE - 1]?.[RARITIES.indexOf(odds.radiant.lastSlot)]).toBe(radiant);

      // The table the landing page shows: a standard pack's chance of at least one, and its share of cards.
      RARITIES.forEach((tier: Rarity, t) => {
        const p = odds.perPack[tier] / odds.scale;
        const hits = atLeastOne[t] ?? 0;
        if (p === 0 || p === 1) expect(hits, `perPack ${tier}`).toBe(p * standard);
        else {
          const z = (hits - standard * p) / Math.sqrt(standard * p * (1 - p));
          expect(Math.abs(z), `perPack ${tier}: ${hits} of ${standard}`).toBeLessThan(Z_CRITICAL);
        }
        const counts = perPackCounts[t] ?? [];
        const mean = counts.reduce((sum, n) => sum + n, 0) / counts.length;
        const variance = counts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (counts.length - 1);
        const share = odds.share[tier] / odds.scale;
        if (variance === 0) expect(mean / PACK_SIZE, `share ${tier}`).toBeCloseTo(share, 5);
        else {
          const z = (mean - PACK_SIZE * share) / Math.sqrt(variance / counts.length);
          expect(Math.abs(z), `share ${tier}: ${mean / PACK_SIZE}`).toBeLessThan(Z_CRITICAL);
        }
      });
    });
  });

  describe("6. the size of an answer is bounded", () => {
    /** A four-byte character: what makes a UTF-8 body longest per counted character. */
    const WIDE = "\u{1D504}";
    const MEMBERSHIPS = 3;
    /** `lead` padded with WIDE to exactly `length` counted characters (code points, as the snapshot counts them). */
    const wide = (lead: string, length: number) => `${lead}${WIDE.repeat(length - [...lead].length)}`;

    function longestPool(): FixturePool {
      const entries = SNAPSHOT_SERIES;
      const characters = 600;
      const entryBase = 960_000;
      const characterBase = 860_000;
      const imageBase = "https://s4.anilist.co/file/anilistcdn/character/large/b";
      return {
        entries: Array.from({ length: entries }, (_, i) => ({
          id: entryBase + i + 1,
          title: wide(`${i}`, TITLE_MAX),
          native: WIDE.repeat(TITLE_MAX),
        })),
        characters: Array.from({ length: characters }, (_, i) => {
          const id = characterBase + i + 1;
          const image = `${imageBase}${id}-`;
          return {
            id,
            name: wide(`${i}`, NAME_MAX),
            native: WIDE.repeat(NAME_MAX),
            image: `${image}${"a".repeat(IMAGE_URL_MAX - image.length - 4)}.png`,
            favourites: (characters - i) * 10,
            in: Array.from({ length: MEMBERSHIPS }, (_, k) => ({
              entry: entryBase + ((i + k * 7) % entries) + 1,
            })),
          };
        }),
      };
    }

    it("an opening with every string at its longest stays under the bound the snapshot limits give it, and the facts stay small", async () => {
      const facts = await inject(DEMO);
      expect(Buffer.byteLength(facts.body)).toBeLessThan(4_096);

      snapshots.push((await loadSnapshot(app.db, longestPool())).version);
      // UTF-8 bytes per counted character, at most 4; a JSON string adds its quotes and key, an id at most 10 digits.
      const cardBound =
        2 * NAME_MAX * 4 + IMAGE_URL_MAX + SNAPSHOT_SERIES * 11 + 256; /* keys, rarity, tier, rank, slot */
      const franchiseBound = 2 * TITLE_MAX * 4 + 128;
      const bound = PACK_SIZE * cardBound + SNAPSHOT_SERIES * franchiseBound + 64;
      let largest = 0;
      for (let i = 0; i < 25; i += 1) {
        const res = await inject(DEMO_OPEN);
        expect(res.statusCode).toBe(200);
        const opened = body<DemoOpened>(res);
        for (const card of opened.cards) {
          expect([...card.character.name]).toHaveLength(NAME_MAX);
          expect(card.character.imageUrl).toHaveLength(IMAGE_URL_MAX);
          expect(card.character.franchiseIds.length).toBeLessThanOrEqual(MEMBERSHIPS);
        }
        expect(opened.franchises.length).toBeLessThanOrEqual(PACK_SIZE * MEMBERSHIPS);
        largest = Math.max(largest, Buffer.byteLength(res.body));
      }
      expect(largest).toBeLessThan(bound);
      // With three franchises a character, the largest a pack can be: five cards and fifteen franchises.
      expect(largest).toBeLessThan(PACK_SIZE * cardBound + PACK_SIZE * MEMBERSHIPS * franchiseBound);
      const factsNow = await inject(DEMO);
      expect(Buffer.byteLength(factsNow.body)).toBeLessThan(4_096);
    });
  });
});
