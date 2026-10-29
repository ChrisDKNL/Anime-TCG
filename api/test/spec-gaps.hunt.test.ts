import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import type { CollectionResponse, PackOpened, PacksResponse } from "@anime-tcg/shared/api";
import { PITY_PACKS } from "@anime-tcg/shared/rarity";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { accounts } from "../src/db/schema.js";
import { createLogger } from "../src/plugins/logging.js";
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
  scriptedRng,
} from "./pool-support.js";
import { createTestApp, testConfig } from "./support.js";

/*
 * Tester's hunt on PR #28: spec statements no other test checks.
 *  - §5.8: the `pack opened` log line at info, with the request id, the
 *    account, opening and snapshot ids, kind, pity, the count per rarity,
 *    packs_since_mythic after, and whether it was a replay.
 *  - §5.5: entries of one rarity sort by name, then by character id.
 *  - §5.4.8 / §6.2: GET /api/packs publishes the tier sizes and character
 *    count of the current snapshot, so after a snapshot update it moves.
 */

const BASE = 800_000;

describe("spec statements without a test (PR #28 hunt)", () => {
  const chunks: string[] = [];
  let app: App;
  const rng = scriptedRng();
  const made: string[] = [];
  const snapshots: number[] = [];
  let version: number;
  const packLines = () =>
    chunks
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.msg === "pack opened");
  const player = async () => {
    const client = await newPlayer(app, "gap");
    made.push(client.account.id);
    return client;
  };

  beforeAll(async () => {
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk.toString());
        done();
      },
    });
    app = await createTestApp({
      config: testConfig({ ACCOUNT_CAP: "1000" }),
      rng,
      logger: createLogger("info", sink),
    });
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    // Two Commons with the same name: the collection must order them by id.
    const pool = standardPool();
    pool.characters = pool.characters.map((character) =>
      character.id === BASE + 391 || character.id === BASE + 392
        ? { ...character, name: "Same Name" }
        : character,
    );
    version = (await loadSnapshot(app.db, pool)).version;
    snapshots.push(version);
  });
  beforeEach(() => {
    chunks.length = 0;
  });
  afterAll(async () => {
    await deleteAccounts(app.db, made);
    await deleteSnapshots(app.db, snapshots);
    await app.close();
  });

  it("logs `pack opened` with every field of §5.8 for a pity pack, and again with replayed: true", async () => {
    const { cookie, account } = await player();
    await app.db
      .update(accounts)
      .set({ packsSinceMythic: PITY_PACKS - 1 })
      .where(eq(accounts.id, account.id));
    const key = randomUUID();
    await forceNextPack(app.db, rng, version, [BASE + 391, BASE + 392, BASE + 393, BASE + 241, BASE + 1], {
      pity: true,
    });
    const opened = body<PackOpened>(await openPack(app, cookie, key));
    expect(opened.pityMythic).toBe(true);
    expect((await openPack(app, cookie, key)).statusCode).toBe(200);

    const [first, replay] = packLines();
    expect(packLines()).toHaveLength(2);
    expect(first).toMatchObject({
      level: 30,
      accountId: account.id,
      openingId: opened.openingId,
      snapshotId: version,
      kind: "standard",
      pity: true,
      rarities: { common: 3, uncommon: 1, rare: 0, epic: 0, legendary: 0, mythic: 1 },
      packsSinceMythic: 0,
      replayed: false,
    });
    expect(typeof first?.reqId).toBe("string");
    expect(replay).toMatchObject({ openingId: opened.openingId, replayed: true, packsSinceMythic: 0 });
    expect(replay?.reqId).not.toBe(first?.reqId);
    // The log carries no card id, favourites count or name.
    expect(JSON.stringify(first)).not.toMatch(/favourites|Character 8|cardId/);
  });

  it("orders collection entries of one rarity by name, then by character id", async () => {
    const { cookie } = await player();
    await forceNextPack(app.db, rng, version, [BASE + 392, BASE + 391, BASE + 393, BASE + 241, BASE + 121]);
    expect((await openPack(app, cookie)).statusCode).toBe(201);
    const collection = body<CollectionResponse>(await getCollection(app, cookie));
    const commons = collection.entries.filter((entry) => entry.rarity === "common");
    expect(commons.map((entry) => [entry.character.name, entry.character.id])).toEqual([
      [`Character ${BASE + 393}`, BASE + 393],
      ["Same Name", BASE + 391],
      ["Same Name", BASE + 392],
    ]);
  });

  it("publishes the current snapshot's tier sizes and character count, which follow a snapshot update", async () => {
    const { cookie } = await player();
    const before = body<PacksResponse>(await getPacks(app, cookie)).odds;
    expect(before?.snapshot).toMatchObject({ version, characterCount: 600 });
    const second = (await loadSnapshot(app.db, standardPool({ characters: 1_000 }))).version;
    snapshots.push(second);
    const after = body<PacksResponse>(await getPacks(app, cookie)).odds;
    expect(after?.snapshot).toMatchObject({ version: second, characterCount: 1_000 });
    expect(after?.tierSizes).toEqual({
      common: 350,
      uncommon: 250,
      rare: 200,
      epic: 120,
      legendary: 60,
      mythic: 20,
    });
  });
});
