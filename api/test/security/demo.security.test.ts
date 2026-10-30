import { Writable } from "node:stream";
import type { DemoOpened, DemoResponse } from "@anime-tcg/shared/api";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { ODDS_SCALE, SLOT_FLOOR } from "@anime-tcg/shared/rarity";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { LightMyRequestResponse } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/app.js";
import type { Db } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { accounts, authThrottle, cards, packOpenings, sessions } from "../../src/db/schema.js";
import type { Rng } from "../../src/domain/packs/rng.js";
import { createLogger } from "../../src/plugins/logging.js";
import { DEMO_RATE_LIMIT } from "../../src/routes/limits.js";
import { standardPool } from "../fixtures/pool.js";
import {
  body,
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  loadSnapshot,
  newPlayer,
  scriptedRng,
} from "../pool-support.js";
import {
  cookieHeader,
  createTestApp,
  FOREIGN_ORIGIN,
  nextClientAddress,
  type SignedInClient,
  testConfig,
  testDatabaseUrl,
  WEB_ORIGIN,
} from "../support.js";

/*
 * T3 adversarial suite for the landing page's public demo
 * (navigation-and-landing.md §3.8, docs/05-security.md T3 row). Test plan:
 *
 * 1. Least privilege and no writes: every statement the two routes send is a
 *    SELECT on the snapshot's tables (no account, session, card, opening or
 *    throttle table, nothing written), the row counts of those tables do not
 *    move, and no answer sets a cookie, without a session, with a live one due
 *    for its sliding touch (left untouched, unlike `GET /api/session`), and
 *    with a forged one (not even cleared).
 * 2. Tampered requests: outcome fields, prototype keys, an oversized body,
 *    other content types and query strings are 4xx, roll nothing and echo
 *    nothing.
 * 3. Forcing: no header, cookie or user agent moves a tier; the outcome is a
 *    function of the server generator only, and a generator that only answers
 *    the top of the scale deals each slot's floor.
 * 4. CSRF: a missing Origin, a foreign one and a foreign Referer are 403
 *    before anything is rolled; the facts are a GET and need none.
 * 5. Brute force against DEMO_RATE_LIMIT: the 21st opening from one address
 *    within the window is 429 with Retry-After, rolls nothing, is not escaped
 *    by a forged X-Forwarded-For, is its own bucket (the facts and pack
 *    openings from that address still answer), and the window resets.
 * 6. Leaks: every body carries declared keys only, no uuid, no `isNew`,
 *    opening id, key, allowance or favourites count.
 * 7. Concurrency: twenty parallel openings all answer and write nothing.
 * 8. Logging: an opening logs the request line only, with no card data.
 */

const ROUTES = [
  { method: "GET", url: "/api/demo" },
  { method: "POST", url: "/api/demo/open" },
] as const;

/** The tables a demo may read: the current snapshot and the display rows it names. */
const SNAPSHOT_TABLES = new Set([
  "pool_snapshots",
  "pool_snapshot_characters",
  "pool_snapshot_memberships",
  "pool_snapshot_series",
  "pool_snapshot_franchises",
  "characters",
  "series",
]);

const DEMO_KEYS = new Set<string>([
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
  "odds",
  "scale",
  "slots",
  "floor",
  "share",
  "perPack",
  "enchanted",
  "every",
  "slot",
  "radiant",
  "chance",
  "lastSlot",
  "pity",
  "packs",
  "freePacksOnly",
  "bandScale",
  "tierBands",
  "tierSizes",
  "snapshot",
  "version",
  "takenAt",
  "characterCount",
  "pool",
  "characters",
  "entries",
  "allowance",
  "intervalSeconds",
  "cap",
  "perVisit",
  "cards",
  "character",
  "id",
  "name",
  "nameNative",
  "imageUrl",
  "franchiseIds",
  "tier",
  "rank",
  "inCurrentSnapshot",
  "rarity",
  "franchises",
  "title",
  "titleNative",
  "startYear",
  "error",
  "code",
  "message",
]);
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, into);
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysOf(child, into);
    }
  }
  return into;
}

/** The tables a statement names after `from`, `join`, `into` or `update`. */
function tablesOf(statement: string): string[] {
  return [...statement.matchAll(/\b(?:from|join|into|update)\s+"(\w+)"/gi)].map((match) => match[1] ?? "");
}

const error = (res: LightMyRequestResponse) => res.json<{ error: { code: string } }>().error;

describe("demo, adversarial (navigation-and-landing.md §3.8)", () => {
  let app: App;
  /** Every SQL statement the app sent, in order. */
  const statements: string[] = [];
  const lines: string[] = [];
  const script = scriptedRng();
  const draws: { min: number; max: number; value: number }[] = [];
  const rng: Rng = (min, max) => {
    const value = script(min, max);
    draws.push({ min, max, value });
    return value;
  };
  const made: string[] = [];
  const snapshots: number[] = [];

  const demo = (
    method: "GET" | "POST",
    url: string,
    options: { headers?: Record<string, string>; payload?: unknown; remoteAddress?: string } = {},
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: options.remoteAddress ?? nextClientAddress(),
      headers: { origin: WEB_ORIGIN, ...options.headers },
      ...(options.payload === undefined ? {} : { payload: options.payload as string }),
    });
  const open = (options?: Parameters<typeof demo>[2]) => demo("POST", "/api/demo/open", options);
  const player = async (): Promise<SignedInClient> => {
    const client = await newPlayer(app, "ds");
    made.push(client.account.id);
    return client;
  };
  const rowCounts = async () => {
    const tally = async (table: typeof accounts | typeof sessions | typeof cards | typeof packOpenings) =>
      (await app.db.select({ n: count() }).from(table))[0]?.n;
    return {
      accounts: await tally(accounts),
      sessions: await tally(sessions),
      cards: await tally(cards),
      openings: await tally(packOpenings),
      throttle: (await app.db.select({ n: count() }).from(authThrottle))[0]?.n,
    };
  };

  beforeAll(async () => {
    const pool = new pg.Pool({ connectionString: testDatabaseUrl() });
    const db: Db = drizzle(pool, {
      schema,
      logger: { logQuery: (query) => void statements.push(query) },
    });
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    app = await createTestApp({
      config: testConfig({ ACCOUNT_CAP: "1000" }),
      db,
      rng,
      logger: createLogger("info", sink),
    });
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    snapshots.push((await loadSnapshot(app.db, standardPool())).version);
  });
  beforeEach(() => {
    script.script.length = 0;
    draws.length = 0;
  });
  afterAll(async () => {
    vi.useRealTimers();
    await deleteAccounts(app.db, made);
    await deleteSnapshots(snapshots);
    await app.close();
  });

  describe("1. least privilege, no writes, no cookie", () => {
    it("sends only SELECTs on the snapshot's tables, with or without a session, and moves no row count", async () => {
      const client = await player();
      const before = await rowCounts();
      const cookies = [undefined, cookieHeader(client.cookie), cookieHeader("forged-not-issued-value")];
      statements.length = 0;
      for (const cookie of cookies) {
        for (const route of ROUTES) {
          const res = await demo(route.method, route.url, {
            headers: cookie === undefined ? {} : { cookie },
          });
          expect(res.statusCode, `${route.method} ${route.url}`).toBe(200);
          expect(res.headers["set-cookie"], `${route.method} ${route.url}`).toBeUndefined();
        }
      }
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(statement.trimStart().toLowerCase().startsWith("select"), statement).toBe(true);
        for (const table of tablesOf(statement)) expect(SNAPSHOT_TABLES, statement).toContain(table);
      }
      expect(await rowCounts()).toEqual(before);
    });

    it("leaves a live session due for its sliding touch untouched, where any other route would slide it", async () => {
      const client = await player();
      const [row] = await app.db.select().from(sessions).where(eq(sessions.accountId, client.account.id));
      if (row === undefined) throw new Error("no session row");
      const stale = new Date(Date.now() - 60 * 60_000);
      await app.db.update(sessions).set({ lastSeenAt: stale }).where(eq(sessions.id, row.id));
      const stored = async () => (await app.db.select().from(sessions).where(eq(sessions.id, row.id)))[0];
      const before = await stored();
      for (const route of ROUTES) {
        const res = await demo(route.method, route.url, { headers: { cookie: cookieHeader(client.cookie) } });
        expect(res.statusCode).toBe(200);
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
      expect(await stored()).toEqual(before);
      // The same cookie on an ordinary route slides the row and re-sends the cookie: the setup is real.
      const session = await demo("GET", "/api/session", { headers: { cookie: cookieHeader(client.cookie) } });
      expect(session.headers["set-cookie"]).toBeDefined();
      expect((await stored())?.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
    });
  });

  describe("2. tampered requests on POST /api/demo/open", () => {
    const outcomes: [string, unknown][] = [
      ["an empty object", {}],
      ["cards", { cards: [{ slot: 0, rarity: "mythic", characterId: 800_001 }] }],
      ["a rarity", { rarity: "mythic" }],
      ["a tier per slot", { tiers: ["mythic", "mythic", "mythic", "mythic", "mythic"] }],
      ["a seed", { seed: 0 }],
      ["odds", { odds: { mythic: ODDS_SCALE } }],
      ["a pack kind", { packKind: "radiant" }],
      ["a snapshot", { snapshotId: 1 }],
      ["a request id", { requestId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }],
      ["an account id", { accountId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }],
      ["a prototype key", JSON.parse('{"__proto__": {"rarity": "mythic"}}')],
      ["a constructor key", { constructor: { prototype: { rarity: "mythic" } } }],
      ["an array", [{ rarity: "mythic" }]],
      ["a number", 400],
      ["true", true],
      ["a string", "mythic"],
    ];

    it.each(outcomes)(
      "refuses %s as a body with 400, rolls nothing and echoes nothing",
      async (_label, payload) => {
        const res = await open({
          payload: JSON.stringify(payload),
          headers: { "content-type": "application/json" },
        });
        expect(res.statusCode).toBe(400);
        expect(error(res).code).toBe("validation_failed");
        expect(res.body).not.toMatch(/mythic|radiant|seed/i);
        expect(draws).toEqual([]);
      },
    );

    it.each([
      ["text/plain", "rarity=mythic", 400],
      ["application/x-www-form-urlencoded", "rarity=mythic", 415],
      ["multipart/form-data; boundary=x", "--x\r\n\r\nmythic\r\n--x--", 415],
    ])("refuses a %s body with %i and rolls nothing", async (contentType, payload, status) => {
      const res = await open({ payload, headers: { "content-type": contentType } });
      expect(res.statusCode).toBe(status);
      expect(draws).toEqual([]);
    });

    it("refuses a body over the body limit with 413 and rolls nothing", async () => {
      const res = await open({
        payload: JSON.stringify({ pad: "x".repeat(70 * 1024) }),
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(413);
      expect(draws).toEqual([]);
    });

    it.each(["?seed=0", "?rarity=mythic", "?tier=mythic&slot=4", "?__proto__=x"])(
      "refuses the query string %s on both routes with 400",
      async (query) => {
        for (const route of ROUTES) {
          const res = await demo(route.method, `${route.url}${query}`);
          expect(res.statusCode, `${route.method} ${route.url}`).toBe(400);
        }
        expect(draws).toEqual([]);
      },
    );
  });

  describe("3. no input forces a tier", () => {
    it.each([
      ["an x-rarity header", { "x-rarity": "mythic" }],
      ["an x-seed header", { "x-seed": "0" }],
      ["an x-odds header", { "x-odds": '{"mythic":1000000}' }],
      ["a user agent asking for Mythic", { "user-agent": "mythic legendary radiant" }],
      ["cookie crumbs", { cookie: "rarity=mythic; seed=0; packKind=radiant" }],
      ["a forwarded address", { "x-forwarded-for": "127.0.0.1" }],
    ])(
      "with %s, a generator rolling the top of the scale deals each slot's floor",
      async (_label, headers) => {
        script.script.push(
          ODDS_SCALE - 1,
          ...SLOT_FLOOR.flatMap((_, slot) => [ODDS_SCALE - 1, slot < 3 ? slot : 0]),
        );
        const res = await open({ headers });
        expect(res.statusCode).toBe(200);
        expect(body<DemoOpened>(res).cards.map((card) => card.rarity)).toEqual([...SLOT_FLOOR]);
        expect(draws.filter((call) => call.max === ODDS_SCALE)).toEqual(
          Array.from({ length: 1 + PACK_SIZE }, () => ({ min: 0, max: ODDS_SCALE, value: ODDS_SCALE - 1 })),
        );
      },
    );
  });

  describe("4. CSRF", () => {
    it.each([
      ["no Origin", { origin: "" }],
      ["a foreign Origin", { origin: FOREIGN_ORIGIN }],
      ["a foreign Referer and no Origin", { origin: "", referer: `${FOREIGN_ORIGIN}/` }],
      ["the web origin as a prefix of another host", { origin: `${WEB_ORIGIN}.evil.example` }],
    ])("refuses an opening with %s as 403 bad_origin, rolling nothing", async (_label, headers) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/demo/open",
        remoteAddress: nextClientAddress(),
        headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== "")),
      });
      expect(res.statusCode).toBe(403);
      expect(error(res).code).toBe("bad_origin");
      expect(draws).toEqual([]);
    });

    it("answers the facts to a GET with no Origin, as any read", async () => {
      const res = await app.inject({ method: "GET", url: "/api/demo", remoteAddress: nextClientAddress() });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("5. brute force against DEMO_RATE_LIMIT", () => {
    it("the 21st opening from one address in a window is 429 with Retry-After, rolls nothing, survives a forged X-Forwarded-For, is its own bucket, and the window resets", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
      try {
        const address = "198.51.100.231";
        const statuses: number[] = [];
        for (let i = 0; i < DEMO_RATE_LIMIT.max; i += 1) {
          statuses.push(
            (await open({ remoteAddress: address, headers: { "x-forwarded-for": `10.30.0.${i}` } }))
              .statusCode,
          );
        }
        expect(statuses).toEqual(Array.from({ length: DEMO_RATE_LIMIT.max }, () => 200));

        draws.length = 0;
        const limited = await open({ remoteAddress: address, headers: { "x-forwarded-for": "10.30.9.9" } });
        expect(limited.statusCode).toBe(429);
        expect(error(limited).code).toBe("rate_limited");
        const retryAfter = Number(limited.headers["retry-after"]);
        expect(Number.isInteger(retryAfter)).toBe(true);
        expect(retryAfter).toBeGreaterThanOrEqual(1);
        expect(retryAfter).toBeLessThanOrEqual(DEMO_RATE_LIMIT.timeWindow / 1000);
        expect(draws).toEqual([]);
        // Limited before the Origin or the body is looked at.
        const hostile = await app.inject({
          method: "POST",
          url: "/api/demo/open",
          remoteAddress: address,
          headers: { origin: FOREIGN_ORIGIN },
          payload: { rarity: "mythic" },
        });
        expect(hostile.statusCode).toBe(429);
        // The override is the opening's own bucket: the facts and a pack opening from the address still answer.
        expect((await demo("GET", "/api/demo", { remoteAddress: address })).statusCode).toBe(200);
        const client = await player();
        const pack = await app.inject({
          method: "POST",
          url: "/api/packs/open",
          remoteAddress: address,
          headers: { origin: WEB_ORIGIN, cookie: cookieHeader(client.cookie) },
          payload: { requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
        });
        expect(pack.statusCode).toBe(201);

        vi.setSystemTime(Date.now() + DEMO_RATE_LIMIT.timeWindow - 1_000);
        expect((await open({ remoteAddress: address })).statusCode).toBe(429);
        vi.setSystemTime(Date.now() + 1_000);
        expect((await open({ remoteAddress: address })).statusCode).toBe(200);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("6. what the answers carry", () => {
    it("every body holds declared keys only and no uuid, no isNew, opening, key, allowance or favourites", async () => {
      const facts = await demo("GET", "/api/demo");
      const opened = await open();
      const refused = await open({ payload: "{}", headers: { "content-type": "application/json" } });
      for (const res of [facts, opened, refused]) {
        expect([...keysOf(res.json())].filter((key) => !DEMO_KEYS.has(key))).toEqual([]);
        expect(res.body).not.toMatch(UUID_PATTERN);
        expect(res.body).not.toMatch(/favourites|isNew|openingId|requestId|nextPackInSeconds|available/);
      }
      expect(Object.keys(body<DemoOpened>(opened))).toEqual(["cards", "franchises"]);
      expect(
        body<DemoOpened>(opened).cards.every((card) => Object.keys(card).join() === "slot,character,rarity"),
      ).toBe(true);
      expect(Object.keys(body<DemoResponse>(facts))).toEqual(["odds", "pool", "allowance", "perVisit"]);
    });
  });

  describe("7. concurrency", () => {
    it("twenty parallel openings all answer five cards and write nothing", async () => {
      const before = await rowCounts();
      const answers = await Promise.all(Array.from({ length: 20 }, () => open()));
      expect(answers.map((res) => res.statusCode)).toEqual(Array.from({ length: 20 }, () => 200));
      for (const res of answers) expect(body<DemoOpened>(res).cards).toHaveLength(PACK_SIZE);
      expect(await rowCounts()).toEqual(before);
    });
  });

  describe("8. logging", () => {
    it("an opening logs the request line and nothing about its cards", async () => {
      lines.length = 0;
      const res = await open();
      expect(res.statusCode).toBe(200);
      const logged = lines.join("");
      const messages = lines.map((line) => (JSON.parse(line) as { msg?: string }).msg);
      expect(messages).toEqual(["incoming request", "request completed"]);
      for (const card of body<DemoOpened>(res).cards) {
        expect(logged).not.toContain(card.character.name);
        expect(logged).not.toContain(String(card.character.id));
      }
      expect(logged).not.toMatch(/rarity|mythic|legendary|common/i);
    });
  });
});
