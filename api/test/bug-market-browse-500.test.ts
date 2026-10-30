import type { ListingsPage } from "@anime-tcg/shared/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { encodeCursor } from "../src/domain/market/cursor.js";
import { expectClockBehindDatabase, ID, pastClockStart } from "./economy-support.js";
import { browse, grantCards, listed, marketErrorOf, marketPool, patientDb } from "./market-support.js";
import {
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  loadSnapshot,
  newPlayer,
} from "./pool-support.js";
import { createTestApp, testConfig } from "./support.js";

/**
 * Tester's regression file (economy.md §8.4, §11.2, M2): `GET /api/market/listings`
 * must answer a client's bad input with 400 `validation_failed`, never 500.
 *
 * Bug 1, the cursor. `decodeCursor` accepts a price key that is any safe
 * integer >= 1 and a `newest` key that is any date JavaScript can represent,
 * then binds it straight into `(l.price, l.id) > ($1, $2::uuid)` or
 * `(l.created_at, l.id) < ($1, ...)`. Postgres infers `integer` (or
 * `timestamptz`) for `$1` and refuses a value outside that type's range, so a
 * hand-made cursor such as base64url(`["price_asc",2147483648,"<uuid>"]`) is a
 * 500 instead of the 400 M2 promises ("anything else is 400").
 *
 * Bug 2, the search text. `q` is a 1..100 character string with no character
 * class, so `q=%00` reaches Postgres as a text parameter holding U+0000,
 * which Postgres cannot store or compare (22021), and the route answers 500.
 *
 * Reproduce: `npm run test:routes -w api -- bug-market-browse-500`.
 */
describe("GET /api/market/listings: client input outside Postgres's ranges is 400, not 500", () => {
  let app: App;
  const now = pastClockStart();
  const made: string[] = [];
  const snapshots: number[] = [];
  let cookie = "";

  beforeAll(async () => {
    app = await createTestApp({
      config: testConfig({ ACCOUNT_CAP: "1000" }),
      db: patientDb(),
      clock: () => now,
    });
    const current = await currentSnapshotId(app.db);
    if (current !== null) throw new Error(`snapshot ${current} is current; a previous run left it behind`);
    const snapshotId = (await loadSnapshot(app.db, marketPool(), now)).version;
    snapshots.push(snapshotId);
    const seller = await newPlayer(app, "bc");
    made.push(seller.account.id);
    cookie = seller.cookie;
    await grantCards(app, seller.account.id, snapshotId, [ID.common(7)], now);
    await listed(app, seller, ID.common(7), 5);
  });
  afterAll(async () => {
    try {
      expectClockBehindDatabase(now);
    } finally {
      await deleteAccounts(app.db, made);
      await deleteSnapshots(snapshots);
      await app.close();
    }
  });

  const forged = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const ID0 = "00000000-0000-4000-8000-000000000000";

  it("control: a well-formed cursor at the edge of every range pages normally", async () => {
    for (const [sort, cursor] of [
      ["price_asc", encodeCursor({ sort: "price_asc", price: 1, id: ID0 })],
      ["price_desc", encodeCursor({ sort: "price_desc", price: 2_147_483_647, id: ID0 })],
      ["newest", encodeCursor({ sort: "newest", listedAt: new Date("9999-12-31T23:59:59.999Z"), id: ID0 })],
    ] as const) {
      const query = `sort=${sort}&cursor=${cursor}`;
      const res = await browse(app, cookie, query);
      expect(res.statusCode, query).toBe(200);
      expect(res.json<ListingsPage>().filterFranchiseIds).toBeNull();
    }
  });

  it("refuses a price key beyond a Postgres integer with 400 validation_failed", async () => {
    for (const [sort, price] of [
      ["price_asc", 2_147_483_648],
      ["price_desc", 2_147_483_648],
      ["price_asc", Number.MAX_SAFE_INTEGER],
    ] as const) {
      const res = await browse(app, cookie, `sort=${sort}&cursor=${forged([sort, price, ID0])}`);
      expect(res.statusCode, `${sort} ${price}: ${res.body}`).toBe(400);
      expect(marketErrorOf(res).code).toBe("validation_failed");
    }
  });

  it("refuses a newest key outside Postgres's timestamp range with 400 validation_failed", async () => {
    for (const key of [new Date(-8.64e15).toISOString(), new Date(-2e14).toISOString()]) {
      const res = await browse(app, cookie, `sort=newest&cursor=${forged(["newest", key, ID0])}`);
      expect(res.statusCode, `${key}: ${res.body}`).toBe(400);
      expect(marketErrorOf(res).code).toBe("validation_failed");
    }
  });

  it("refuses or ignores a search text holding U+0000, never a 500", async () => {
    for (const q of ["%00", "a%00b"]) {
      const res = await browse(app, cookie, `q=${q}`);
      expect([200, 400], `q=${q}: ${res.statusCode} ${res.body}`).toContain(res.statusCode);
    }
  });
});
