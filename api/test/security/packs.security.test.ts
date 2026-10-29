import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import type { CollectionResponse, PackOpened, PacksResponse } from "@anime-tcg/shared/api";
import { PACK_CAP, PACK_SIZE } from "@anime-tcg/shared/economy";
import {
  ENCHANTED_INTERVAL,
  ENCHANTED_SLOT_ODDS,
  ODDS_SCALE,
  PITY_PACKS,
  RADIANT_ODDS,
  RADIANT_SLOT_ODDS,
  RARITIES,
  type Rarity,
  SLOT_FLOOR,
  SLOT_ODDS,
} from "@anime-tcg/shared/rarity";
import { eq, inArray } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/app.js";
import { main as snapshotPool } from "../../src/cli/snapshot-pool.js";
import {
  accounts,
  cards,
  characters,
  packOpenings,
  poolSnapshotCharacters,
  poolSnapshots,
  series,
  sessions,
} from "../../src/db/schema.js";
import { dealPack } from "../../src/domain/packs/service.js";
import { cryptoRng, type Rng } from "../../src/domain/packs/rng.js";
import { buildSnapshot } from "../../src/domain/pool/build.js";
import { tierPool } from "../../src/domain/pool/catalog.js";
import { readSnapshotFile } from "../../src/domain/pool/file.js";
import { IMAGE_HOST, SNAPSHOT_CHARACTERS_MAX, SNAPSHOT_FILE_MAX } from "../../src/domain/pool/limits.js";
import { validate } from "../../src/domain/pool/validate.js";
import { hashSessionId, newSessionId } from "../../src/domain/session/ids.js";
import { SESSION_ABSOLUTE_LIFETIME_MS } from "../../src/domain/session/policy.js";
import { PACK_RATE_LIMIT } from "../../src/routes/limits.js";
import {
  type FixtureCharacter,
  type FixturePool,
  imageUrl,
  snapshotText,
  standardPool,
} from "../fixtures/pool.js";
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
  loginAccount,
  type SignedInClient,
  send,
  TEST_SESSION_SECRET,
  testConfig,
  testDatabaseUrl,
  WEB_ORIGIN,
} from "../support.js";

/*
 * T3 adversarial suite for packs and the collection (collection-packs.md §9
 * "Adversarial", docs/05-security.md T3 row). Test plan:
 *
 * 1. Sessions: forged, flipped, truncated, extended, never-issued, garbage,
 *    the stored hash itself, expired, past the absolute lifetime, anonymous,
 *    a deleted account's and a logged-out one → 401 on all three routes,
 *    nothing written, no card of the victim's in the answer.
 * 2. Tampered bodies: every outcome field the client might try (cards,
 *    rarity, tier, variant, kind, characterIds, slot, seed, odds, snapshotId,
 *    accountId, available, ...), negative and overflowing numbers, prototype
 *    keys, every malformed requestId (10 000 characters among them), other
 *    content types and an oversized body → 4xx, nothing written, no echo.
 * 3. Allowance: a client Date header, client clock headers, query strings and
 *    cookie crumbs change nothing; the server clock set back a year or
 *    forward a century never goes below 0 or above the cap.
 * 4. Replay: one key sequentially and in parallel (one session and two)
 *    opens once; B sending A's key gets B's own outcome, never A's cards,
 *    and a 409 when B has no pack; the key is case-insensitive like the uuid.
 * 5. Double-open race: one pack and ten parallel openings → one 201; three
 *    packs and ten → three; two sessions of one account share the lock; the
 *    unique (account_id, request_id) backstop holds when the lock is bypassed.
 * 6. Isolation: the collection only ever holds the caller's cards; ids in a
 *    query, body or path → 400/404.
 * 7. Leaks: every JSON body carries only declared keys and no uuid besides
 *    its own openingId (no card id, account id, session hash, other openings).
 * 8. Odds: the published integers are the ones the roll applies (every
 *    threshold edge of every slot, Enchanted and Radiant table, and both
 *    sides of the Radiant chance, through the real route) and the published
 *    tier sizes are the ranges the pick draws from.
 * 9. Forcing: no header, cookie, user agent or requestId value moves a tier;
 *    the outcome is a function of the server generator only.
 * 10. Brute force: the 21st opening from one address within the window is
 *    429 rate_limited with Retry-After, spends nothing, is not escaped by a
 *    forged X-Forwarded-For or by switching accounts, and the window resets.
 * 11. No player reset: reset, snapshot, pool and AniList routes do not exist.
 * 12. Hostile snapshot files through `snapshot-pool --stdin`: markup, RTL
 *    overrides, zero-width characters and BOMs stored and served as text
 *    (trim only); a name or native name with no visible character skipped;
 *    NUL skipped; image URLs that leave s4.anilist.co, or spell it in a form
 *    the URL parser has to repair, skipped; cycles and self-relations finite;
 *    10 000 edges read as 200; 6 001 characters capped to a pool of 6 000;
 *    10 000 nesting levels and a file over SNAPSHOT_FILE_MAX refused without
 *    reading the rest; two runs at once leave exactly one current snapshot.
 */

const BASE = 800_000;
const MINUTE = 60_000;
const YEAR = 365 * 24 * 60 * MINUTE;
const PASSWORD = "correct horse battery";
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Rarest first: each threshold of a table's roll is the running sum of the tiers above it (§5.4.4). */
const ROLL_ORDER: readonly Rarity[] = [...RARITIES].reverse();

/** Every key a declared response of the three routes (or the error envelope) may carry. */
const DECLARED_KEYS = new Set<string>([
  ...RARITIES,
  "allowance",
  "available",
  "cap",
  "intervalSeconds",
  "nextPackInSeconds",
  "odds",
  "scale",
  "slots",
  "floor",
  "share",
  "perPack",
  "enchanted",
  "every",
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
  "packsUntilGuarantee",
  "openingId",
  "openedAt",
  "packKind",
  "pityMythic",
  "cards",
  "kind",
  "slot",
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
  "variant",
  "isNew",
  "franchises",
  "title",
  "titleNative",
  "startYear",
  "totals",
  "duplicates",
  "byRarity",
  "completion",
  "pool",
  "owned",
  "total",
  "franchiseId",
  "entries",
  "count",
  // economy.md §11.2: the collection answer's additions ("available" is the allowance's key too).
  "listed",
  "recyclable",
  "firstObtainedAt",
  "lastObtainedAt",
  "error",
  "code",
  "message",
  "retryAfterSeconds",
]);

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

const error = (res: LightMyRequestResponse) =>
  res.json<{ error: { code: string; message: string; retryAfterSeconds?: number } }>().error;

/** The Postgres error code anywhere in a driver error's cause chain. */
function pgCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

describe("packs and collection, adversarial (collection-packs.md §9)", () => {
  let app: App;
  let now = new Date("2026-10-29T12:00:00.000Z");
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
  let s1 = 0;

  const player = async (): Promise<SignedInClient> => {
    const client = await newPlayer(app, "ps");
    made.push(client.account.id);
    return client;
  };
  const openingsOf = async (accountId: string) =>
    (
      await app.db
        .select({ id: packOpenings.id })
        .from(packOpenings)
        .where(eq(packOpenings.accountId, accountId))
    ).length;
  const cardsOf = (accountId: string) => app.db.select().from(cards).where(eq(cards.accountId, accountId));
  const anchorOf = async (accountId: string) =>
    (
      await app.db.select({ anchor: accounts.packsAnchorAt }).from(accounts).where(eq(accounts.id, accountId))
    )[0]?.anchor;
  /** A player with exactly `left` packs at the fixed clock. */
  async function playerWith(left: number): Promise<SignedInClient> {
    const client = await player();
    for (let i = 0; i < PACK_CAP - left; i += 1)
      expect((await openPack(app, client.cookie)).statusCode).toBe(201);
    return client;
  }
  /**
   * Scripts one opening: the plan roll (§5.4.4 step 1), then per slot its tier roll (none for a slot the
   * plan forces) and a pick that takes the first character the tier's shuffle still has.
   */
  function scriptPack(planRoll: number, slots: readonly { roll: number | null; tier: Rarity }[]): void {
    script.script.push(planRoll);
    const drawn = new Map<Rarity, number>();
    for (const { roll, tier } of slots) {
      const k = drawn.get(tier) ?? 0;
      drawn.set(tier, k + 1);
      if (roll !== null) script.script.push(roll);
      script.script.push(k);
    }
  }
  /** The tier a roll lands on in one published table, read the way §5.4.4 says the server reads it. */
  const publishedTier = (table: Record<Rarity, number>) => (r: number) => {
    let threshold = 0;
    for (const tier of ROLL_ORDER) {
      threshold += table[tier];
      if (r < threshold) return tier;
    }
    throw new RangeError(`roll ${r} is past the published scale`);
  };
  /** The roll values either side of every boundary between the tiers a published table can land on. */
  const edgesOf = (table: Record<Rarity, number>, scale: number) => {
    const edges = [0];
    let threshold = 0;
    for (const tier of ROLL_ORDER) {
      threshold += table[tier];
      if (table[tier] > 0 && threshold < scale) edges.push(threshold - 1, threshold);
    }
    edges.push(scale - 1);
    return edges;
  };

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng, clock: () => now });
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    s1 = (await loadSnapshot(app.db, standardPool())).version;
    snapshots.push(s1);
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

  describe("1. session cookies", () => {
    let victim: SignedInClient;
    let victimRequestId: string;
    const routes = [
      ["GET", "/api/packs"],
      ["POST", "/api/packs/open"],
      ["GET", "/api/collection"],
    ] as const;

    /** A second live session of the victim, then changed in the table the way `change` says. */
    async function plantedSession(change: (id: string) => Promise<unknown>): Promise<string> {
      const { cookieValue } = await app.sessions.create(victim.account.id, "test", new Date());
      await change(hashSessionId(TEST_SESSION_SECRET, cookieValue));
      return cookieValue;
    }

    const forgeries: [string, () => Promise<string>][] = [
      [
        "a flipped last character",
        async () => `${victim.cookie.slice(0, -1)}${victim.cookie.endsWith("A") ? "B" : "A"}`,
      ],
      [
        "a flipped middle character",
        async () =>
          `${victim.cookie.slice(0, 20)}${victim.cookie[20] === "x" ? "y" : "x"}${victim.cookie.slice(21)}`,
      ],
      ["a truncated cookie", async () => victim.cookie.slice(0, 42)],
      ["an extended cookie", async () => `${victim.cookie}A`],
      ["a well-formed value never issued", async () => newSessionId()],
      ["garbage outside base64url", async () => "!".repeat(43)],
      ["a 4 000-character value", async () => "A".repeat(4_000)],
      [
        "the stored HMAC instead of the cookie (a database leak)",
        async () => hashSessionId(TEST_SESSION_SECRET, victim.cookie),
      ],
      [
        "an expired session",
        () =>
          plantedSession((id) =>
            app.db
              .update(sessions)
              .set({ expiresAt: new Date(Date.now() - MINUTE) })
              .where(eq(sessions.id, id)),
          ),
      ],
      [
        "a session past the absolute lifetime",
        () =>
          plantedSession((id) =>
            app.db
              .update(sessions)
              .set({ createdAt: new Date(Date.now() - SESSION_ABSOLUTE_LIFETIME_MS - MINUTE) })
              .where(eq(sessions.id, id)),
          ),
      ],
      ["an anonymous session", async () => (await app.sessions.create(null, "test", new Date())).cookieValue],
      [
        "a deleted account's session",
        async () => {
          const doomed = await player();
          const res = await send(app, {
            method: "POST",
            url: "/api/account/delete",
            cookie: doomed.cookie,
            payload: { password: PASSWORD },
          });
          expect(res.statusCode).toBe(204);
          return doomed.cookie;
        },
      ],
      [
        "a logged-out session",
        async () => {
          const second = await loginAccount(app, { login: victim.account.login, password: PASSWORD });
          const res = await send(app, { method: "POST", url: "/api/session/logout", cookie: second.cookie });
          expect(res.statusCode).toBeLessThan(300);
          return second.cookie;
        },
      ],
    ];

    beforeAll(async () => {
      victim = await player();
      victimRequestId = randomUUID();
      expect((await openPack(app, victim.cookie, victimRequestId)).statusCode).toBe(201);
    });

    it.each(forgeries)("answers 401 to %s on every route and writes nothing", async (_label, forge) => {
      const cookie = await forge();
      const victimCards = (await cardsOf(victim.account.id)).map((card) => card.characterId);
      const anchor = await anchorOf(victim.account.id);
      for (const [method, url] of routes) {
        // The POST replays the victim's own key: a 200 here would hand over the victim's cards.
        const res = await send(app, {
          method,
          url,
          cookie,
          ...(method === "POST" ? { payload: { requestId: victimRequestId } } : {}),
        });
        expect(res.statusCode, `${method} ${url}`).toBe(401);
        expect(error(res).code).toBe("unauthenticated");
        expect(res.body).not.toContain("character");
      }
      // A fresh key from the forged cookie does not open anything either.
      expect((await openPack(app, cookie)).statusCode).toBe(401);
      expect(await openingsOf(victim.account.id)).toBe(1);
      expect((await cardsOf(victim.account.id)).map((card) => card.characterId)).toEqual(victimCards);
      expect(await anchorOf(victim.account.id)).toEqual(anchor);
    });

    it("the victim's own cookie still works afterwards (the forgeries did not end it)", async () => {
      expect((await getPacks(app, victim.cookie)).statusCode).toBe(200);
    });
  });

  describe("2. tampered bodies on POST /api/packs/open", () => {
    const outcomeFields: [string, Record<string, unknown>][] = [
      ["cards", { cards: [{ slot: 0, character: { id: BASE + 1 }, rarity: "mythic" }] }],
      ["rarity", { rarity: "mythic" }],
      ["tier", { tier: "mythic" }],
      ["variant", { variant: "masterwork" }],
      ["kind", { kind: "relic" }],
      ["characterIds", { characterIds: [BASE + 1, BASE + 2, BASE + 3, BASE + 4, BASE + 5] }],
      ["slot", { slot: 0 }],
      ["seed", { seed: 0 }],
      ["odds", { odds: { mythic: ODDS_SCALE } }],
      ["snapshotId", { snapshotId: 1 }],
      ["accountId", { accountId: randomUUID() }],
      ["available", { available: 99 }],
      ["openingId", { openingId: randomUUID() }],
      ["count (negative)", { count: -1 }],
      ["count (overflowing)", { count: Number.MAX_SAFE_INTEGER + 2 }],
      ["now", { now: "2099-01-01T00:00:00.000Z" }],
      ["openedAt", { openedAt: "2099-01-01T00:00:00.000Z" }],
      ["packs", { packs: -5 }],
      ["packKind", { packKind: "radiant" }],
      ["pity", { pity: true }],
      ["pityMythic", { pityMythic: true }],
      ["enchanted", { enchanted: true }],
      ["radiant", { radiant: true }],
      ["packsUntilGuarantee", { packsUntilGuarantee: 1 }],
      ["packsSinceMythic", { packsSinceMythic: 299 }],
      ["freePacksOpened", { freePacksOpened: 9 }],
    ];

    it.each(outcomeFields)(
      "answers 400 to a body with %s beside a valid requestId and writes nothing",
      async (_label, extra) => {
        const { cookie, account } = await player();
        const res = await send(app, {
          method: "POST",
          url: "/api/packs/open",
          cookie,
          payload: { requestId: randomUUID(), ...extra },
        });
        expect(res.statusCode).toBe(400);
        expect(error(res).code).toBe("validation_failed");
        expect(await openingsOf(account.id)).toBe(0);
        expect(await anchorOf(account.id)).toBeNull();
        expect(draws).toEqual([]);
      },
    );

    const uuid = "6f1c2a4e-3b5d-4c7e-9f80-1a2b3c4d5e6f";
    const badRequestIds: [string, unknown][] = [
      ["not a uuid", "not-a-uuid"],
      ["empty", ""],
      ["10 000 characters", "a".repeat(10_000)],
      ["10 000 characters that start with a uuid", `${uuid}${"0".repeat(10_000 - 36)}`],
      ["one character too long", `${uuid}0`],
      ["a uuid with a leading space", ` ${uuid}`.slice(0, 36)],
      ["a uuid with a trailing newline", `${uuid.slice(0, 35)}\n`],
      ["a urn:uuid: prefix", `urn:uuid:${uuid}`],
      ["braces", `{${uuid.slice(1, 35)}}`],
      ["a non-hex digit", `${uuid.slice(0, 35)}g`],
      ["a NUL", `${uuid.slice(0, 35)}\u0000`],
      ["no dashes", uuid.replaceAll("-", "")],
      ["a number", 42],
      ["a negative number", -1],
      ["null", null],
      ["true", true],
      ["an array", [uuid]],
      ["an object", { id: uuid }],
    ];

    it.each(badRequestIds)(
      "answers 400 to a requestId that is %s, without echoing it",
      async (_label, requestId) => {
        const { cookie, account } = await player();
        const res = await send(app, {
          method: "POST",
          url: "/api/packs/open",
          cookie,
          payload: { requestId },
        });
        expect(res.statusCode).toBe(400);
        expect(error(res).code).toBe("validation_failed");
        expect(res.body.length).toBeLessThan(300);
        expect(await openingsOf(account.id)).toBe(0);
      },
    );

    const rawBodies: [string, string][] = [
      ["an overflowing number literal", `{"requestId":"${uuid}","count":1e309}`],
      ["a __proto__ key", `{"requestId":"${uuid}","__proto__":{"available":99}}`],
      ["a constructor.prototype key", `{"requestId":"${uuid}","constructor":{"prototype":{"available":99}}}`],
      ["a duplicate key whose last value is not a uuid", `{"requestId":"${uuid}","requestId":"x"}`],
      ["a top-level array", `[{"requestId":"${uuid}"}]`],
      ["null", "null"],
      ["an empty body", ""],
      ["truncated JSON", `{"requestId":"${uuid}"`],
    ];

    it.each(rawBodies)(
      "answers 400 to a JSON body that is %s and writes nothing",
      async (_label, payload) => {
        const { cookie, account } = await player();
        const res = await send(app, {
          method: "POST",
          url: "/api/packs/open",
          cookie,
          payload,
          headers: { "content-type": "application/json" },
        });
        expect(res.statusCode).toBe(400);
        expect(await openingsOf(account.id)).toBe(0);
        // A refused prototype key must not have reached any object the server shares.
        expect(({} as Record<string, unknown>).available).toBeUndefined();
      },
    );

    it.each([
      ["text/plain", `{"requestId":"${uuid}"}`],
      ["application/x-www-form-urlencoded", `requestId=${uuid}`],
      [
        "multipart/form-data; boundary=x",
        `--x\r\nContent-Disposition: form-data; name="requestId"\r\n\r\n${uuid}\r\n--x--`,
      ],
    ])("refuses a %s body with a 4xx envelope and writes nothing", async (contentType, payload) => {
      const { cookie, account } = await player();
      const res = await send(app, {
        method: "POST",
        url: "/api/packs/open",
        cookie,
        payload,
        headers: { "content-type": contentType },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(typeof error(res).code).toBe("string");
      expect(await openingsOf(account.id)).toBe(0);
    });

    it("refuses a body over the body limit with 413 and writes nothing", async () => {
      const { cookie, account } = await player();
      const res = await send(app, {
        method: "POST",
        url: "/api/packs/open",
        cookie,
        payload: { requestId: randomUUID(), padding: "x".repeat(70 * 1024) },
      });
      expect(res.statusCode).toBe(413);
      expect(await openingsOf(account.id)).toBe(0);
    });

    it("refuses an opening from a foreign Origin with 403 and writes nothing", async () => {
      const { cookie, account } = await player();
      const res = await send(app, {
        method: "POST",
        url: "/api/packs/open",
        cookie,
        origin: "http://evil.example",
        payload: { requestId: randomUUID() },
      });
      expect(res.statusCode).toBe(403);
      expect(error(res).code).toBe("bad_origin");
      expect(await openingsOf(account.id)).toBe(0);
    });
  });

  describe("3. the allowance clock is the server's", () => {
    const clientClocks: Record<string, string>[] = [
      { date: new Date(now.getTime() + YEAR).toUTCString() },
      { date: new Date(now.getTime() - YEAR).toUTCString() },
      { date: "not a date" },
      { "x-client-time": "2099-01-01T00:00:00.000Z" },
      { "if-modified-since": new Date(now.getTime() + YEAR).toUTCString() },
      { "x-forwarded-for": "198.51.100.9", forwarded: "for=198.51.100.9" },
    ];

    it("a client Date header or clock header changes nothing about the allowance or an opening", async () => {
      const { cookie, account } = await playerWith(0);
      const plain = await getPacks(app, cookie);
      const plainEmpty = await openPack(app, cookie);
      expect(plainEmpty.statusCode).toBe(409);
      for (const headers of clientClocks) {
        const res = await send(app, { method: "GET", url: "/api/packs", cookie, headers });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(plain.json());
        const opened = await send(app, {
          method: "POST",
          url: "/api/packs/open",
          cookie,
          headers,
          payload: { requestId: randomUUID() },
        });
        expect(opened.statusCode).toBe(409);
        expect(error(opened)).toEqual(error(plainEmpty));
        expect(opened.headers["retry-after"]).toBe(plainEmpty.headers["retry-after"]);
      }
      expect(await openingsOf(account.id)).toBe(PACK_CAP);
    });

    it("cookie crumbs beside the session change nothing", async () => {
      const { cookie, account } = await playerWith(0);
      const before = await getPacks(app, cookie);
      const res = await app.inject({
        method: "POST",
        url: "/api/packs/open",
        headers: {
          origin: WEB_ORIGIN,
          cookie: `available=99; packs_anchor_at=0; ${cookieHeader(cookie)}; cap=99; rarity=mythic`,
        },
        payload: { requestId: randomUUID() },
      });
      expect(res.statusCode).toBe(409);
      expect((await getPacks(app, cookie)).json()).toEqual(before.json());
      expect(await openingsOf(account.id)).toBe(PACK_CAP);
    });

    it.each([
      "/api/packs/open?available=3",
      "/api/packs/open?now=2099-01-01T00:00:00Z",
      "/api/packs/open?requestId=6f1c2a4e-3b5d-4c7e-9f80-1a2b3c4d5e6f",
    ])("answers 400 to POST %s and writes nothing", async (url) => {
      const { cookie, account } = await player();
      const res = await send(app, { method: "POST", url, cookie, payload: { requestId: randomUUID() } });
      expect(res.statusCode).toBe(400);
      expect(await openingsOf(account.id)).toBe(0);
    });

    it.each(["/api/packs?now=2099-01-01", "/api/packs?available=3", "/api/collection?accountId=x"])(
      "answers 400 to GET %s",
      async (url) => {
        const { cookie } = await player();
        const res = await send(app, { method: "GET", url, cookie });
        expect(res.statusCode).toBe(400);
        expect(error(res).code).toBe("validation_failed");
      },
    );

    it("a server clock set back a year never makes the allowance negative or opens a pack", async () => {
      const { cookie, account } = await playerWith(1);
      const start = now;
      try {
        now = new Date(start.getTime() - YEAR);
        const status = body<PacksResponse>(await getPacks(app, cookie)).allowance;
        expect(status.available).toBe(0);
        expect(Number.isSafeInteger(status.nextPackInSeconds)).toBe(true);
        expect(status.nextPackInSeconds).toBeGreaterThanOrEqual(1);
        const res = await openPack(app, cookie);
        expect(res.statusCode).toBe(409);
        expect(error(res).retryAfterSeconds).toBe(status.nextPackInSeconds);
        expect(res.headers["retry-after"]).toBe(String(status.nextPackInSeconds));
        expect(await openingsOf(account.id)).toBe(PACK_CAP - 1);
      } finally {
        now = start;
      }
    });

    it("a server clock set forward a century grants the cap, not a century of packs", async () => {
      const { cookie, account } = await playerWith(0);
      const start = now;
      try {
        now = new Date(start.getTime() + 100 * YEAR);
        expect(body<PacksResponse>(await getPacks(app, cookie)).allowance).toMatchObject({
          available: PACK_CAP,
          nextPackInSeconds: null,
        });
        const results = await Promise.all(Array.from({ length: PACK_CAP + 3 }, () => openPack(app, cookie)));
        expect(results.filter((res) => res.statusCode === 201)).toHaveLength(PACK_CAP);
        expect(results.filter((res) => res.statusCode === 409)).toHaveLength(3);
        expect(await openingsOf(account.id)).toBe(2 * PACK_CAP);
      } finally {
        now = start;
      }
    });
  });

  describe("4. replay", () => {
    it("one key sent five times in a row opens once: one 201, four identical 200s, the allowance spent once", async () => {
      const { cookie, account } = await player();
      const requestId = randomUUID();
      const first = await openPack(app, cookie, requestId);
      expect(first.statusCode).toBe(201);
      for (let i = 0; i < 4; i += 1) {
        const again = await openPack(app, cookie, requestId);
        expect(again.statusCode).toBe(200);
        expect(again.json()).toEqual(first.json());
      }
      expect(await openingsOf(account.id)).toBe(1);
      expect(await cardsOf(account.id)).toHaveLength(PACK_SIZE);
      expect(body<PacksResponse>(await getPacks(app, cookie)).allowance.available).toBe(PACK_CAP - 1);
    });

    it("one key sent eight times in parallel opens once, and every answer names that opening and its cards", async () => {
      const { cookie, account } = await playerWith(1);
      const requestId = randomUUID();
      const results = await Promise.all(Array.from({ length: 8 }, () => openPack(app, cookie, requestId)));
      expect(results.map((res) => res.statusCode).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
      const answers = results.map((res) => body<PackOpened>(res));
      expect(new Set(answers.map((answer) => answer.openingId)).size).toBe(1);
      for (const answer of answers) expect(answer.cards).toEqual(answers[0]?.cards);
      expect(await openingsOf(account.id)).toBe(PACK_CAP);
      expect(body<PacksResponse>(await getPacks(app, cookie)).allowance.available).toBe(0);
    });

    it("one key sent from two sessions of one account in parallel opens once", async () => {
      const first = await playerWith(1);
      const second = await loginAccount(app, { login: first.account.login, password: PASSWORD });
      const requestId = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          openPack(app, i % 2 === 0 ? first.cookie : second.cookie, requestId),
        ),
      );
      expect(results.filter((res) => res.statusCode === 201)).toHaveLength(1);
      expect(results.filter((res) => res.statusCode === 200)).toHaveLength(5);
      expect(new Set(results.map((res) => body<PackOpened>(res).openingId)).size).toBe(1);
      expect(await openingsOf(first.account.id)).toBe(PACK_CAP);
    });

    it("the key is a uuid, not a string: its upper-case spelling replays the same opening and spends nothing", async () => {
      const { cookie, account } = await player();
      const requestId = randomUUID();
      const first = await openPack(app, cookie, requestId);
      expect(first.statusCode).toBe(201);
      const upper = await openPack(app, cookie, requestId.toUpperCase());
      expect(upper.statusCode).toBe(200);
      expect(upper.json()).toEqual(first.json());
      expect(await openingsOf(account.id)).toBe(1);
    });

    it("a replay with no pack left still answers the stored cards and moves nothing", async () => {
      const { cookie, account } = await player();
      const requestId = randomUUID();
      const first = body<PackOpened>(await openPack(app, cookie, requestId));
      for (let i = 1; i < PACK_CAP; i += 1) await openPack(app, cookie);
      const anchor = await anchorOf(account.id);
      const replay = await openPack(app, cookie, requestId);
      expect(replay.statusCode).toBe(200);
      expect(body<PackOpened>(replay).cards).toEqual(first.cards);
      expect(body<PackOpened>(replay).allowance.available).toBe(0);
      expect(await anchorOf(account.id)).toEqual(anchor);
      expect(await openingsOf(account.id)).toBe(PACK_CAP);
    });

    it("B sending A's key gets B's own opening, never A's cards or A's opening id", async () => {
      const a = await player();
      const b = await player();
      const requestId = randomUUID();
      await forceNextPack(app.db, script, s1, [BASE + 1, BASE + 2, BASE + 3, BASE + 4, BASE + 5]);
      const forA = body<PackOpened>(await openPack(app, a.cookie, requestId));
      // Six tiers and slot floors (spec round 4): B's pack is three Commons, an Uncommon and a Rare.
      await forceNextPack(app.db, script, s1, [BASE + 591, BASE + 592, BASE + 593, BASE + 241, BASE + 121]);
      const resB = await openPack(app, b.cookie, requestId);
      expect(resB.statusCode).toBe(201);
      const forB = body<PackOpened>(resB);
      expect(forB.openingId).not.toBe(forA.openingId);
      expect(resB.body).not.toContain(forA.openingId);
      expect(forB.cards.map((card) => card.character.id)).toEqual([
        BASE + 591,
        BASE + 592,
        BASE + 593,
        BASE + 241,
        BASE + 121,
      ]);
      expect(forB.packKind).toBe("standard");
      expect(forA.packKind).toBe("radiant");
      expect((await cardsOf(b.account.id)).map((card) => card.characterId).sort()).toEqual(
        forB.cards.map((card) => card.character.id).sort(),
      );
      expect(await cardsOf(a.account.id)).toHaveLength(PACK_SIZE);
    });

    it("B with no pack left sending A's key gets 409, not A's cards", async () => {
      const a = await player();
      const b = await playerWith(0);
      const requestId = randomUUID();
      const forA = body<PackOpened>(await openPack(app, a.cookie, requestId));
      const resB = await openPack(app, b.cookie, requestId);
      expect(resB.statusCode).toBe(409);
      expect(error(resB).code).toBe("no_pack_available");
      expect(resB.body).not.toContain(forA.openingId);
      expect(resB.body).not.toContain("character");
    });
  });

  describe("5. double-open races and the backstop", () => {
    it("one pack and ten parallel openings: exactly one 201 and nine 409, never below zero", async () => {
      const { cookie, account } = await playerWith(1);
      const results = await Promise.all(Array.from({ length: 10 }, () => openPack(app, cookie)));
      expect(results.filter((res) => res.statusCode === 201)).toHaveLength(1);
      expect(results.filter((res) => res.statusCode === 409)).toHaveLength(9);
      for (const res of results.filter((r) => r.statusCode === 409)) {
        expect(error(res).retryAfterSeconds).toBeGreaterThanOrEqual(1);
      }
      expect(await openingsOf(account.id)).toBe(PACK_CAP);
      expect(await cardsOf(account.id)).toHaveLength(PACK_CAP * PACK_SIZE);
      const allowance = body<PacksResponse>(await getPacks(app, cookie)).allowance;
      expect(allowance.available).toBe(0);
      expect(allowance.nextPackInSeconds).toBeGreaterThanOrEqual(1);
    });

    it("three packs and ten parallel openings: exactly three openings", async () => {
      const { cookie, account } = await player();
      const results = await Promise.all(Array.from({ length: 10 }, () => openPack(app, cookie)));
      expect(results.filter((res) => res.statusCode === 201)).toHaveLength(PACK_CAP);
      expect(results.filter((res) => res.statusCode === 409)).toHaveLength(10 - PACK_CAP);
      expect(await openingsOf(account.id)).toBe(PACK_CAP);
      expect(await cardsOf(account.id)).toHaveLength(PACK_CAP * PACK_SIZE);
    });

    it("two sessions of one account share the account lock: three packs, eight parallel openings, three 201", async () => {
      const first = await player();
      const second = await loginAccount(app, { login: first.account.login, password: PASSWORD });
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => openPack(app, i % 2 === 0 ? first.cookie : second.cookie)),
      );
      expect(results.filter((res) => res.statusCode === 201)).toHaveLength(PACK_CAP);
      expect(await openingsOf(first.account.id)).toBe(PACK_CAP);
    });

    it("the unique (account_id, request_id) backstop: deals that bypass the lock commit one opening per key", async () => {
      const { cookie, account } = await player();
      const pool = { snapshotId: s1, tiers: await tierPool(app.db, s1) };
      const requestId = randomUUID();
      const locked = { id: account.id, packsAnchorAt: null, packsSinceMythic: 0, freePacksOpened: 0 };
      const deal = () =>
        app.db.transaction((tx) =>
          dealPack(tx, { account: locked, requestId, openedAt: now }, cryptoRng, pool, "free"),
        );
      const results = await Promise.allSettled([deal(), deal()]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((result) => result.status === "rejected");
      expect(pgCode(refused?.status === "rejected" ? refused.reason : undefined)).toBe("23505");
      await expect(deal()).rejects.toSatisfy((err) => pgCode(err) === "23505");
      expect(await openingsOf(account.id)).toBe(1);
      expect(await cardsOf(account.id)).toHaveLength(PACK_SIZE);
      // The route sees that opening as the key's: a replay, not a second deal.
      const replay = await openPack(app, cookie, requestId);
      expect(replay.statusCode).toBe(200);
      expect(await openingsOf(account.id)).toBe(1);
    });
  });

  describe("6. another account's data", () => {
    it("the collection holds only the caller's cards; a stranger's is empty", async () => {
      const a = await player();
      const c = await player();
      const stranger = await player();
      const aIds = [BASE + 1, BASE + 2, BASE + 3, BASE + 4, BASE + 5];
      // Six tiers and slot floors (spec round 4): C's pack is three Commons, an Uncommon and a Rare.
      const cIds = [BASE + 596, BASE + 597, BASE + 598, BASE + 242, BASE + 122];
      await forceNextPack(app.db, script, s1, aIds);
      const opened = body<PackOpened>(await openPack(app, a.cookie));
      await forceNextPack(app.db, script, s1, cIds);
      await openPack(app, c.cookie);

      const ofC = body<CollectionResponse>(await getCollection(app, c.cookie));
      expect(ofC.entries.map((entry) => entry.character.id).sort()).toEqual([...cIds].sort());
      expect(ofC.totals.cards).toBe(PACK_SIZE);
      const ofStranger = await getCollection(app, stranger.cookie);
      expect(body<CollectionResponse>(ofStranger).entries).toEqual([]);
      expect(body<CollectionResponse>(ofStranger).totals.cards).toBe(0);
      expect(body<CollectionResponse>(ofStranger).completion.pool.owned).toBe(0);
      expect(ofStranger.body).not.toContain(opened.openingId);
      expect(ofStranger.body).not.toContain(a.account.id);
    });

    it.each([
      ["GET", "/api/collection/{a}"],
      ["GET", "/api/packs/{a}"],
      ["GET", "/api/accounts/{a}/collection"],
      ["POST", "/api/packs/open/{a}"],
    ] as const)("answers 404 to %s with another account's id in the path", async (method, path) => {
      const a = await player();
      const b = await player();
      const res = await send(app, {
        method,
        url: path.replace("{a}", a.account.id),
        cookie: b.cookie,
        ...(method === "POST" ? { payload: { requestId: randomUUID() } } : {}),
      });
      expect(res.statusCode).toBe(404);
      expect(await openingsOf(a.account.id)).toBe(0);
      expect(await openingsOf(b.account.id)).toBe(0);
    });
  });

  describe("7. what the answers carry", () => {
    it("every body of the three routes holds declared keys only and no uuid besides its own openingId", async () => {
      const a = await player();
      const b = await player();
      const firstKey = randomUUID();
      const bodies: { res: LightMyRequestResponse; openingId?: string }[] = [];
      bodies.push({ res: await getPacks(app, a.cookie) });
      for (let i = 0; i < PACK_CAP; i += 1) {
        const res = await openPack(app, a.cookie, i === 0 ? firstKey : randomUUID());
        bodies.push({ res, openingId: body<PackOpened>(res).openingId });
      }
      const replay = await openPack(app, a.cookie, firstKey);
      bodies.push({ res: replay, openingId: body<PackOpened>(replay).openingId });
      bodies.push({ res: await openPack(app, a.cookie) }); // 409
      bodies.push({ res: await getPacks(app, a.cookie) });
      bodies.push({ res: await getCollection(app, a.cookie) });
      await openPack(app, b.cookie);
      bodies.push({ res: await getCollection(app, b.cookie) });

      const secrets = [
        a.account.id,
        b.account.id,
        ...(
          await app.db
            .select({ id: cards.id })
            .from(cards)
            .where(inArray(cards.accountId, [a.account.id, b.account.id]))
        ).map((row) => row.id),
        hashSessionId(TEST_SESSION_SECRET, a.cookie),
        a.cookie,
      ];
      for (const { res, openingId } of bodies) {
        expect(res.headers["content-type"]).toMatch(/^application\/json/);
        const json: unknown = res.json();
        expect([...keysOf(json)].filter((key) => !DECLARED_KEYS.has(key))).toEqual([]);
        expect((res.body.match(UUID_PATTERN) ?? []).filter((id) => id !== openingId)).toEqual([]);
        for (const secret of secrets) expect(res.body).not.toContain(secret);
      }
      // A's opening ids never reach B's collection.
      const ofB = bodies.at(-1)?.res.body ?? "";
      for (const { openingId } of bodies) if (openingId !== undefined) expect(ofB).not.toContain(openingId);
    });
  });

  describe("8. the published odds are the applied odds", () => {
    // Six tiers (spec round 4): the published odds are five slot tables with floors, the Enchanted and
    // Radiant tables and chance, the pity count, the shares, the per-pack figures and the tier bands.
    it("GET /api/packs publishes the applied tables and rules out of ODDS_SCALE, share and perPack as recomputed from them, and the snapshot's real tier sizes", async () => {
      const { cookie } = await player();
      const odds = body<PacksResponse>(await getPacks(app, cookie)).odds;
      expect(odds).not.toBeNull();
      if (odds === null) return;
      const asRecord = (table: Record<Rarity, number>) =>
        Object.fromEntries(RARITIES.map((t) => [t, table[t]]));
      expect(odds.scale).toBe(ODDS_SCALE);
      expect(odds.slots).toHaveLength(PACK_SIZE);
      expect(odds.slots.map((slot) => slot.odds)).toEqual(SLOT_ODDS.map(asRecord));
      expect(odds.slots.map((slot) => slot.floor)).toEqual([...SLOT_FLOOR]);
      for (const [index, slot] of odds.slots.entries()) {
        expect(
          RARITIES.reduce((sum, tier) => sum + slot.odds[tier], 0),
          `slot ${index}`,
        ).toBe(odds.scale);
        for (const tier of RARITIES.slice(0, RARITIES.indexOf(slot.floor))) expect(slot.odds[tier]).toBe(0);
      }
      expect(odds.enchanted).toEqual({
        every: ENCHANTED_INTERVAL,
        slot: PACK_SIZE - 1,
        floor: "epic",
        odds: asRecord(ENCHANTED_SLOT_ODDS),
      });
      expect(odds.radiant).toEqual({
        chance: RADIANT_ODDS,
        odds: asRecord(RADIANT_SLOT_ODDS),
        lastSlot: "mythic",
      });
      expect(odds.pity).toEqual({ packs: PITY_PACKS, freePacksOnly: true });
      const scale = BigInt(odds.scale);
      for (const tier of RARITIES) {
        const all = scale ** BigInt(PACK_SIZE);
        const none = odds.slots.reduce((product, slot) => product * (scale - BigInt(slot.odds[tier])), 1n);
        const ppm = (2n * (all - none) * 1_000_000n + all) / (2n * all);
        expect(odds.perPack[tier], tier).toBe(Number(ppm));
        const sum = odds.slots.reduce((total, slot) => total + slot.odds[tier], 0);
        expect(odds.share[tier], tier).toBe(Math.round((sum * 1_000_000) / (PACK_SIZE * odds.scale)));
      }
      const rows = await app.db
        .select({ tier: poolSnapshotCharacters.tier })
        .from(poolSnapshotCharacters)
        .where(eq(poolSnapshotCharacters.snapshotId, s1));
      for (const tier of RARITIES) {
        expect(odds.tierSizes[tier], tier).toBe(rows.filter((row) => row.tier === tier).length);
      }
      expect(odds.snapshot.characterCount).toBe(rows.length);
    });

    it("every threshold edge of every published table, and both sides of the Radiant chance, land on the published tier through the real route, and each pick draws from the published tier size", async () => {
      const { cookie, account } = await player();
      const odds = body<PacksResponse>(await getPacks(app, cookie)).odds;
      if (odds === null) throw new Error("no odds published");
      type Rule = Record<Rarity, number> | Rarity;
      const last = odds.enchanted.slot;
      const standard: Rule[] = odds.slots.map((slot) => slot.odds);
      const enchanted: Rule[] = standard.map((rule, slot) => (slot === last ? odds.enchanted.odds : rule));
      const radiant: Rule[] = standard.map((_, slot) =>
        slot === last ? odds.radiant.lastSlot : odds.radiant.odds,
      );
      /** Packs that between them put every edge of every slot's table into that slot. */
      const edgePacks = (rules: Rule[]) => {
        const edges = rules.map((rule) => (typeof rule === "string" ? [null] : edgesOf(rule, odds.scale)));
        const count = Math.max(...edges.map((list) => list.length));
        return Array.from({ length: count }, (_, k) => edges.map((list) => list[k % list.length] ?? null));
      };
      const packs = [
        // Not Radiant: the plan roll at the Radiant chance itself, or the top of the scale.
        ...edgePacks(standard).map((rolls, k) => ({
          kind: "standard",
          plan: k % 2 === 0 ? odds.radiant.chance : odds.scale - 1,
          opened: 0,
          rules: standard,
          rolls,
        })),
        ...edgePacks(enchanted).map((rolls) => ({
          kind: "enchanted",
          plan: odds.scale - 1,
          opened: odds.enchanted.every - 1,
          rules: enchanted,
          rolls,
        })),
        // Radiant: the plan roll at 0 or one below the chance.
        ...edgePacks(radiant).map((rolls, k) => ({
          kind: "radiant",
          plan: k % 2 === 0 ? 0 : odds.radiant.chance - 1,
          opened: 0,
          rules: radiant,
          rolls,
        })),
      ];
      expect(packs.length).toBe(8 + 6 + 6);
      for (const pack of packs) {
        await app.db
          .update(accounts)
          .set({ packsAnchorAt: null, packsSinceMythic: 0, freePacksOpened: pack.opened })
          .where(eq(accounts.id, account.id));
        const tiers = pack.rules.map((rule, slot) => {
          const r = pack.rolls[slot];
          if (typeof rule === "string") return rule;
          if (r === undefined || r === null) throw new Error("a rolled slot needs a roll");
          return publishedTier(rule)(r);
        });
        draws.length = 0;
        scriptPack(
          pack.plan,
          tiers.map((tier, slot) => ({ roll: pack.rolls[slot] ?? null, tier })),
        );
        const res = await openPack(app, cookie);
        expect(res.statusCode).toBe(201);
        const opened = body<PackOpened>(res);
        expect(opened.packKind).toBe(pack.kind);
        expect(opened.cards.map((card) => card.rarity)).toEqual(tiers);
        for (const card of opened.cards) expect(card.character.tier).toBe(card.rarity);
        // The generator is asked for (0, scale) for the plan and per rolled slot, and (k, tierSizes[tier]) per pick.
        const expected: { min: number; max: number; value: number }[] = [
          { min: 0, max: odds.scale, value: pack.plan },
        ];
        const drawn = new Map<Rarity, number>();
        tiers.forEach((tier, slot) => {
          const r = pack.rolls[slot];
          if (r !== undefined && r !== null) expected.push({ min: 0, max: odds.scale, value: r });
          const k = drawn.get(tier) ?? 0;
          drawn.set(tier, k + 1);
          expected.push({ min: k, max: odds.tierSizes[tier], value: k });
        });
        expect(draws).toEqual(expected);
      }
    });
  });

  describe("9. no input forces a tier", () => {
    const uuid = () => randomUUID();
    const attempts: [string, Record<string, string>, () => string][] = [
      ["an x-rarity header", { "x-rarity": "mythic" }, uuid],
      ["an x-seed header", { "x-seed": "0" }, uuid],
      ["an x-odds header", { "x-odds": '{"mythic":1000000}' }, uuid],
      ["a user agent asking for Mythic", { "user-agent": "mythic legendary" }, uuid],
      ["cookie crumbs", { cookie: "rarity=mythic; seed=0" }, uuid],
      ["the nil uuid as key", {}, () => "00000000-0000-0000-0000-000000000000"],
      ["the max uuid as key", {}, () => "ffffffff-ffff-ffff-ffff-ffffffffffff"],
      ["a key spelling mythic in hex", {}, () => "deadbeef-0000-4000-8000-00000000000a"],
    ];

    // Six tiers and slot floors (spec round 4): the top of the scale is each slot's floor, so a generator
    // that only ever answers it deals three Commons, an Uncommon and a Rare, in a standard pack.
    it.each(attempts)(
      "with %s, a generator rolling the top of the scale deals each slot's floor",
      async (_label, headers, key) => {
        const { cookie } = await player();
        scriptPack(
          ODDS_SCALE - 1,
          SLOT_ODDS.map((table) => ({ roll: ODDS_SCALE - 1, tier: publishedTier(table)(ODDS_SCALE - 1) })),
        );
        const { cookie: crumbs, ...rest } = headers;
        const res = await app.inject({
          method: "POST",
          url: "/api/packs/open",
          remoteAddress: "198.51.100.150",
          headers: {
            ...rest,
            origin: WEB_ORIGIN,
            cookie: crumbs === undefined ? cookieHeader(cookie) : `${crumbs}; ${cookieHeader(cookie)}`,
          },
          payload: { requestId: key() },
        });
        expect(res.statusCode).toBe(201);
        expect(body<PackOpened>(res)).toMatchObject({ packKind: "standard", pityMythic: false });
        expect(body<PackOpened>(res).cards.map((card) => card.rarity)).toEqual([...SLOT_FLOOR]);
        // The plan roll and the five tier rolls, every one of them the generator's.
        expect(draws.filter((call) => call.max === ODDS_SCALE)).toEqual(
          Array.from({ length: 1 + PACK_SIZE }, () => ({ min: 0, max: ODDS_SCALE, value: ODDS_SCALE - 1 })),
        );
      },
    );

    it("on the real generator the dealt rarities and pack kind are exactly what its plan and tier rolls map to", async () => {
      const { cookie } = await player();
      for (let i = 0; i < PACK_CAP; i += 1) {
        draws.length = 0;
        const opened = body<PackOpened>(await openPack(app, cookie));
        const [plan, ...tierRolls] = draws.filter((call) => call.min === 0 && call.max === ODDS_SCALE);
        if (plan === undefined) throw new Error("no plan roll");
        const radiant = plan.value < RADIANT_ODDS;
        expect(opened.packKind).toBe(radiant ? "radiant" : "standard");
        const expected = radiant
          ? [...tierRolls.map((call) => publishedTier(RADIANT_SLOT_ODDS)(call.value)), "mythic"]
          : tierRolls.map((call, slot) => publishedTier(SLOT_ODDS[slot] ?? SLOT_ODDS[0])(call.value));
        expect(tierRolls).toHaveLength(radiant ? PACK_SIZE - 1 : PACK_SIZE);
        expect(opened.cards.map((card) => card.rarity)).toEqual(expected);
      }
    });
  });

  describe("10. brute force against PACK_RATE_LIMIT", () => {
    it("the 21st opening from one address in a window is 429 with Retry-After, spends nothing, survives forged X-Forwarded-For and account switching, and the window resets", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
      try {
        const a = await player();
        const b = await player();
        const c = await player();
        const address = "198.51.100.201";
        const open = (client: SignedInClient, forwardedFor: string) =>
          app.inject({
            method: "POST",
            url: "/api/packs/open",
            remoteAddress: address,
            headers: {
              origin: WEB_ORIGIN,
              cookie: cookieHeader(client.cookie),
              "x-forwarded-for": forwardedFor,
            },
            payload: { requestId: randomUUID() },
          });
        const statuses: number[] = [];
        for (let i = 0; i < PACK_RATE_LIMIT.max; i += 1) {
          statuses.push((await open(i % 2 === 0 ? a : b, `10.20.0.${i}`)).statusCode);
        }
        expect(statuses.filter((status) => status === 429)).toEqual([]);
        expect(statuses.filter((status) => status === 201)).toHaveLength(2 * PACK_CAP);

        const limited = await open(c, "10.20.9.9");
        expect(limited.statusCode).toBe(429);
        expect(error(limited).code).toBe("rate_limited");
        const retryAfter = Number(limited.headers["retry-after"]);
        expect(Number.isInteger(retryAfter)).toBe(true);
        expect(retryAfter).toBeGreaterThanOrEqual(1);
        expect(retryAfter).toBeLessThanOrEqual(PACK_RATE_LIMIT.timeWindow / 1000);
        expect(await openingsOf(c.account.id)).toBe(0);
        // Limited before the session or the body is looked at.
        const anonymous = await app.inject({
          method: "POST",
          url: "/api/packs/open",
          remoteAddress: address,
          headers: { origin: WEB_ORIGIN },
          payload: { requestId: "x" },
        });
        expect(anonymous.statusCode).toBe(429);
        // The override replaces the global bucket for its route only.
        const status = await app.inject({
          method: "GET",
          url: "/api/packs",
          remoteAddress: address,
          headers: { cookie: cookieHeader(c.cookie) },
        });
        expect(status.statusCode).toBe(200);

        vi.setSystemTime(Date.now() + PACK_RATE_LIMIT.timeWindow - 1_000);
        expect((await open(c, "10.20.9.10")).statusCode).toBe(429);
        vi.setSystemTime(Date.now() + 1_000);
        expect((await open(c, "10.20.9.11")).statusCode).toBe(201);
        expect(await openingsOf(c.account.id)).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("11. no player reset, no snapshot or AniList route", () => {
    it.each([
      ["POST", "/api/collection/reset"],
      ["DELETE", "/api/collection"],
      ["POST", "/api/collection"],
      ["PATCH", "/api/collection"],
      ["POST", "/api/packs"],
      ["POST", "/api/packs/reset"],
      ["GET", "/api/packs/open"],
      ["POST", "/api/pool/snapshot"],
      ["GET", "/api/pool"],
      ["POST", "/api/snapshot"],
      ["GET", "/api/anilist"],
      ["POST", "/api/admin/reset-collection"],
    ] as const)("%s %s is 404 for a signed-in player and changes nothing", async (method, url) => {
      const { cookie, account } = await player();
      await openPack(app, cookie);
      const res = await send(app, { method, url, cookie, ...(method === "GET" ? {} : { payload: {} }) });
      expect(res.statusCode).toBe(404);
      expect(await openingsOf(account.id)).toBe(1);
      expect(await cardsOf(account.id)).toHaveLength(PACK_SIZE);
    });

    it("the route table holds no reset, snapshot, pool or AniList route", async () => {
      await app.ready();
      const table = app.printRoutes({ commonPrefix: false });
      expect(table).toContain("packs");
      expect(table).not.toMatch(/reset|snapshot|pool|anilist|admin/i);
    });
  });

  describe("12. hostile snapshot files through snapshot-pool --stdin", () => {
    const H_ENTRY = 600_000;
    const H_CHAR = 700_000;
    const quiet = new Writable({ write: (_chunk, _encoding, done) => done() });
    const sink = () => {
      const chunks: string[] = [];
      return { text: () => chunks.join(""), write: (chunk: string) => chunks.push(chunk) };
    };
    async function run(stdin: AsyncIterable<Buffer | string>, argv: string[] = ["--stdin"]) {
      const stdout = sink();
      const stderr = sink();
      const code = await snapshotPool(argv, testDatabaseUrl(), {
        stdin,
        stdout,
        stderr,
        logDestination: quiet,
      });
      const version = Number(/^Snapshot (\d+) active: /.exec(stdout.text())?.[1]);
      if (Number.isInteger(version)) snapshots.push(version);
      return { code, stdout: stdout.text(), stderr: stderr.text(), version };
    }
    const hostilePool = (): FixturePool => standardPool({ entryBase: H_ENTRY, characterBase: H_CHAR });
    const plan = (pool: FixturePool) => buildSnapshot(readSnapshotFile(snapshotText(pool)).input);
    function withCharacter(pool: FixturePool, index: number, change: Partial<FixtureCharacter>): FixturePool {
      const current = pool.characters[index];
      if (current === undefined) throw new Error(`no character ${index}`);
      pool.characters[index] = { ...current, ...change };
      return pool;
    }

    /** Character index → name and native name, stored and served exactly (trim only). */
    const hostileNames: [string, string | null][] = [
      ['<script>alert("x")</script>', "<img src=x onerror=alert(1)>"],
      ["<img src=x onerror=alert(1)>", '"><svg onload=alert(1)>'],
      ["‮gnp.exe", "‮אב RTL"],
      ["Ka​to‌‍⁠ri", "​"],
      ["&lt;b&gt; &amp; &#x3C;", "&#0;"],
      [`"double" 'single' \\ \`back\` \${x}`, null],
      ["\u{1F47E}".repeat(200), "\u{1F47E}"],
      ["Z̷̢͎a̸l̴g̷o", "⁧isolate⁩ ‏mark"],
      ["﻿ Leading and trailing BOM ﻿", " ﻿ native ﻿ "],
      ["​", null],
    ];
    const hostileTitles: [string, string | null][] = [
      ["<script>alert(1)</script>", "‮evil"],
      ["Season​ 2 ⁦x⁩", "<b>bold</b>"],
    ];

    let hostile = 0;
    beforeAll(async () => {
      const pool = hostilePool();
      hostileNames.forEach(([name, native], index) => withCharacter(pool, index, { name, native }));
      hostileTitles.forEach(([title, native], index) => {
        const entry = pool.entries[index];
        if (entry !== undefined) pool.entries[index] = { ...entry, title, native };
      });
      const result = await run(Readable.from([snapshotText(pool)]));
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      hostile = result.version;
    });

    it("stores markup, RTL overrides, zero-width characters and BOMs as text, trimmed only, and serves them byte for byte", async () => {
      const ids = hostileNames.map((_, index) => H_CHAR + index + 1);
      const stored = await app.db.select().from(characters).where(inArray(characters.id, ids));
      // The visible-name rule (spec round 4, decision 7): a name, or a native name, of only whitespace and
      // format characters skips its character. Two of the hostile pairs are that (a lone zero-width space).
      const visible = (text: string) => text.replace(/[\s\p{Cf}]/gu, "") !== "";
      const acceptable = ([name, native]: [string, string | null]) =>
        visible(name.trim()) && (native === null || native.trim() === "" || visible(native.trim()));
      expect(hostileNames.filter((pair) => !acceptable(pair))).toEqual([
        ["Ka​to‌‍⁠ri", "​"],
        ["​", null],
      ]);
      const inPool = new Set(
        (
          await app.db
            .select({ id: poolSnapshotCharacters.characterId })
            .from(poolSnapshotCharacters)
            .where(eq(poolSnapshotCharacters.snapshotId, hostile))
        ).map((row) => row.id),
      );
      const accepted: number[] = [];
      for (const [index, pair] of hostileNames.entries()) {
        const id = H_CHAR + index + 1;
        const row = stored.find((character) => character.id === id);
        if (!acceptable(pair)) {
          expect(row, `invisible ${index}`).toBeUndefined();
          expect(inPool.has(id), `invisible ${index}`).toBe(false);
          continue;
        }
        const [name, native] = pair;
        accepted.push(id);
        expect(row?.name, `name ${index}`).toBe(name.trim());
        expect(row?.nameNative, `native ${index}`).toBe(
          native === null || native.trim() === "" ? null : native.trim(),
        );
      }
      // Two packs of five: the eight accepted hostile characters and the next two, all Mythic (a Radiant pack).
      const dealt = [...accepted, H_CHAR + 11, H_CHAR + 12];
      const titles = await app.db
        .select()
        .from(series)
        .where(inArray(series.id, [H_ENTRY + 1, H_ENTRY + 2]));
      for (const [index, [title, native]] of hostileTitles.entries()) {
        const row = titles.find((entry) => entry.id === H_ENTRY + index + 1);
        expect(row).toMatchObject({ title: title.trim(), titleNative: native });
      }

      const { cookie } = await player();
      await forceNextPack(app.db, script, hostile, dealt.slice(0, PACK_SIZE));
      const first = await openPack(app, cookie);
      await forceNextPack(app.db, script, hostile, dealt.slice(PACK_SIZE));
      const second = await openPack(app, cookie);
      const served = [...body<PackOpened>(first).cards, ...body<PackOpened>(second).cards];
      expect(served.map((card) => card.character.id)).toEqual(dealt);
      const servedRows = await app.db.select().from(characters).where(inArray(characters.id, dealt));
      for (const card of served) {
        const row = servedRows.find((character) => character.id === card.character.id);
        expect(card.character.name).toBe(row?.name);
        expect(card.character.nameNative).toBe(row?.nameNative);
      }
      const collection = body<CollectionResponse>(await getCollection(app, cookie));
      for (const entry of collection.entries) {
        expect(entry.character.name).toBe(servedRows.find((row) => row.id === entry.character.id)?.name);
      }
      for (const [index, [title, native]] of hostileTitles.entries()) {
        expect(collection.franchises.find((franchise) => franchise.id === H_ENTRY + index + 1)).toMatchObject(
          {
            title: title.trim(),
            titleNative: native,
          },
        );
      }
    });

    it.each([
      ["the name", { name: "Ere\u0000n" }],
      ["the native name", { native: "\u0000" }],
      ["the image URL", { image: `${imageUrl(H_CHAR + 1)}\u0000` }],
      ["a name of only a BOM (empty once trimmed)", { name: "﻿" }],
    ])("skips a character with a NUL or nothing in %s", (_label, change) => {
      const built = plan(withCharacter(hostilePool(), 0, change));
      expect(built.characters.map((character) => character.id)).not.toContain(H_CHAR + 1);
      expect(built.skipped.items).toBe(1);
    });

    it.each([
      ["the title", { title: "Ti\u0000tle" }],
      ["the native title", { native: "\u0000" }],
      ["a genre", { genres: ["Act\u0000ion"] }],
    ])("skips an entry with a NUL in %s", (_label, change) => {
      const pool = hostilePool();
      const entry = pool.entries[0];
      if (entry === undefined) throw new Error("no entry");
      pool.entries[0] = { ...entry, ...change };
      const built = plan(pool);
      expect(built.entries.map((planned) => planned.id)).not.toContain(H_ENTRY + 1);
    });

    it("a lone surrogate in a name never breaks the snapshot, and what is served is what is stored", async () => {
      const pool = withCharacter(hostilePool(), 0, { name: "a\uD800b" });
      const result = await run(Readable.from([snapshotText(pool)]));
      expect(result.code).toBe(0);
      const [row] = await app.db
        .select()
        .from(characters)
        .where(eq(characters.id, H_CHAR + 1));
      const { cookie } = await player();
      await forceNextPack(app.db, script, result.version, [
        H_CHAR + 1,
        H_CHAR + 2,
        H_CHAR + 3,
        H_CHAR + 4,
        H_CHAR + 5,
      ]);
      const res = await openPack(app, cookie);
      expect(res.statusCode).toBe(201);
      expect(body<PackOpened>(res).cards[0]?.character.name).toBe(row?.name);
    });

    /** Each resolves somewhere other than https://s4.anilist.co, or carries what the rule forbids. */
    const leavesTheHost: string[] = [
      "http://s4.anilist.co/file/a.png",
      "https://s4.anilist.co.evil.example/a.png",
      "https://user@s4.anilist.co/a.png",
      "https://s4.anilist.co@evil.example/a.png",
      "https://s4.anilist.co:8443/a.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "blob:https://s4.anilist.co/6f1c2a4e-3b5d-4c7e-9f80-1a2b3c4d5e6f",
      "//s4.anilist.co/a.png",
      "/file/a.png",
      "https://s4.anilist.co./a.png",
      "https://anilist.co/a.png",
      "https://s4-anilist.co/a.png",
      "https://127.0.0.1/a.png",
      "https://[::1]/a.png",
      "https://ѕ4.anilist.co/a.png",
      "https://evil.example\\@s4.anilist.co/a.png",
      "https://s4.anilist.co%2F@evil.example/a.png",
      "https://s4.anilist.co%00.evil.example/a.png",
      "https://s4.anili\tst.co/a.png",
      "https://s4.anilist.co\n.evil.example/a.png",
      "https://s4.anilist.co/a.png\r\nX-Injected: 1",
    ];

    it.each(leavesTheHost)("skips the image URL %j", (url) => {
      const built = plan(withCharacter(hostilePool(), 0, { image: url }));
      expect(built.characters.map((character) => character.id)).not.toContain(H_CHAR + 1);
      expect(built.skipped.byReason()).toEqual({ "character:image": 1 });
    });

    /**
     * Each is s4.anilist.co only after the URL parser repairs it (case,
     * percent-encoding, backslashes, missing slashes, IDNA mapping, invisible
     * characters, an explicit port). The rule takes an image URL only when
     * nothing has to be repaired, so the string served is the URL loaded.
     */
    const repairedIntoTheHost: string[] = [
      "https://S4.ANILIST.CO/file/a.png",
      "https://s4%2Eanilist.co/file/a.png",
      "https://%73%34.anilist.co/file/a.png",
      "https:\\\\s4.anilist.co\\file\\a.png",
      "https://s4.anilist.co\\@evil.example/a.png",
      "https:s4.anilist.co/file/a.png",
      "https:/s4.anilist.co/file/a.png",
      "https://ｓ4.anilist.co/a.png",
      "https://s4。anilist.co/a.png",
      "https://s4.anilist.co​/a.png",
      "https://s4.ani­list.co/a.png",
      "https://s4.anilist.co:443/a.png",
    ];

    it.each(repairedIntoTheHost)(
      "skips the image URL %j, which only the parser's repair puts on the image host",
      (url) => {
        expect(new URL(url).hostname).toBe(IMAGE_HOST);
        const built = plan(withCharacter(hostilePool(), 0, { image: url }));
        expect(built.characters.map((character) => character.id)).not.toContain(H_CHAR + 1);
        expect(built.skipped.byReason()).toEqual({ "character:image": 1 });
      },
    );

    it("every image URL a hostile file got accepted is served exactly as the browser will load it", async () => {
      const rows = await app.db
        .select({ url: characters.imageUrl })
        .from(characters)
        .innerJoin(poolSnapshotCharacters, eq(poolSnapshotCharacters.characterId, characters.id))
        .where(eq(poolSnapshotCharacters.snapshotId, hostile));
      for (const { url } of rows) {
        const parsed = new URL(url);
        expect(parsed.href).toBe(url);
        expect(parsed.origin).toBe(`https://${IMAGE_HOST}`);
      }
    });

    it("a relation cycle and a relation from an entry to itself build finite franchises", () => {
      const pool = hostilePool();
      const [e1, e2, e3, e4] = pool.entries;
      if (e1 === undefined || e2 === undefined || e3 === undefined || e4 === undefined)
        throw new Error("entries");
      pool.entries[0] = { ...e1, relations: [{ type: "SEQUEL", to: e2.id }] };
      pool.entries[1] = { ...e2, relations: [{ type: "SEQUEL", to: e3.id }] };
      pool.entries[2] = { ...e3, relations: [{ type: "SEQUEL", to: e1.id }] };
      pool.entries[3] = {
        ...e4,
        relations: [
          { type: "PREQUEL", to: e4.id },
          { type: "SEQUEL", to: e4.id },
        ],
      };
      const built = plan(pool);
      const cycle = built.franchises.find((franchise) => franchise.entryIds.includes(e1.id));
      expect(cycle?.id).toBe(e1.id);
      expect([...(cycle?.entryIds ?? [])].sort()).toEqual([e1.id, e2.id, e3.id]);
      expect(built.franchises.find((franchise) => franchise.entryIds.includes(e4.id))?.entryIds).toEqual([
        e4.id,
      ]);
      expect(built.franchises.reduce((sum, franchise) => sum + franchise.entryIds.length, 0)).toBe(
        built.entries.length,
      );
    });

    it("10 000 relation edges on one entry are read as 200", () => {
      const pool = hostilePool();
      const entry = pool.entries[0];
      if (entry === undefined) throw new Error("no entry");
      pool.entries[0] = {
        ...entry,
        relations: Array.from({ length: 10_000 }, (_, i) => ({ type: "SEQUEL", to: 1 + i })),
      };
      const { input } = readSnapshotFile(snapshotText(pool));
      expect(validate(input).edges.filter((edge) => edge.fromId === entry.id)).toHaveLength(200);
    });

    // The franchise cap (spec round 5, decision 2) bounds the pool by construction: at most 100 entries, so
    // at most 100 franchises of at most 60. A file of 6 001 valid characters can no longer reach the
    // refusal of a pool above SNAPSHOT_CHARACTERS_MAX (build.test.ts proves that refusal with the cap off);
    // what it must still never do is put more than SNAPSHOT_CHARACTERS_MAX characters into the pool.
    it("never builds a pool above SNAPSHOT_CHARACTERS_MAX from a file of SNAPSHOT_CHARACTERS_MAX + 1 valid characters: the cap keeps 6 000", async () => {
      const pool = standardPool({
        entryBase: H_ENTRY,
        characterBase: H_CHAR,
        characters: SNAPSHOT_CHARACTERS_MAX + 1,
      });
      const result = await run(Readable.from([snapshotText(pool)]));
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/, 6000 characters .*; 1 capped in 1 franchises; /);
      const rows = await app.db
        .select({ id: poolSnapshotCharacters.characterId })
        .from(poolSnapshotCharacters)
        .where(eq(poolSnapshotCharacters.snapshotId, result.version));
      expect(rows).toHaveLength(SNAPSHOT_CHARACTERS_MAX);
    });

    it("refuses a file nested 10 000 levels deep", async () => {
      const text = `{"format":${"[".repeat(10_000)}${"]".repeat(10_000)}}`;
      const result = await run(Readable.from([text]));
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/nests deeper/);
    });

    it("refuses a file over SNAPSHOT_FILE_MAX without reading the rest of the stream", async () => {
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      let pulled = 0;
      async function* endless() {
        for (;;) {
          pulled += 1;
          yield chunk;
        }
      }
      const result = await run(endless());
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/larger than/);
      expect(pulled).toBe(SNAPSHOT_FILE_MAX / chunk.length + 1);
    });

    it("two snapshot-pool runs at once both activate, one after the other, leaving exactly one current snapshot", async () => {
      const file = (takenAt: string) =>
        snapshotText({
          ...standardPool({ entryBase: H_ENTRY + 1_000, characterBase: H_CHAR + 10_000 }),
          takenAt,
        });
      const [first, second] = await Promise.all([
        run(Readable.from([file("2026-10-29T10:00:00.000Z")])),
        run(Readable.from([file("2026-10-29T11:00:00.000Z")])),
      ]);
      expect([first?.code, second?.code]).toEqual([0, 0]);
      const versions = [first?.version ?? 0, second?.version ?? 0];
      expect(new Set(versions).size).toBe(2);
      const current = await app.db
        .select({ id: poolSnapshots.id })
        .from(poolSnapshots)
        .where(eq(poolSnapshots.isCurrent, true));
      expect(current).toEqual([{ id: Math.max(...versions) }]);
      for (const version of versions) {
        const rows = await app.db
          .select({ id: poolSnapshotCharacters.characterId })
          .from(poolSnapshotCharacters)
          .where(eq(poolSnapshotCharacters.snapshotId, version));
        expect(rows).toHaveLength(600);
      }
    });
  });
});
