import { randomUUID } from "node:crypto";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import {
  accounts,
  authThrottle,
  cards,
  characters,
  packOpenings,
  poolSnapshotCharacters,
  poolSnapshotSeries,
  poolSnapshots,
  series,
  sessions,
} from "../src/db/schema.js";
import { createDb } from "../src/db/client.js";
import { resetCollection } from "../src/domain/collection/reset.js";
import { clearAccountData, createTestApp, insertAccount, migrationsDatabaseUrl } from "./support.js";

/** Postgres `insufficient_privilege`; drizzle wraps the pg error as `cause`. */
const PERMISSION_DENIED = "42501";

/**
 * Spec §4.1: the pool behind every request is `anime_app`, which can read and
 * write rows and nothing else. A bug that reaches the database therefore
 * cannot change the schema, empty a table in one statement or read the
 * migration ledger.
 */
describe("app database role", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  it("runs as anime_app, not the owner", async () => {
    const result = await app.db.execute<{ role: string }>(sql`select current_user as role`);
    expect(result.rows[0]?.role).toBe("anime_app");
  });

  it("cannot create a table", async () => {
    await expect(app.db.execute(sql`create table escalation (id int)`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
  });

  it("cannot truncate, alter or drop the sessions table", async () => {
    await expect(app.db.execute(sql`truncate sessions`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.execute(sql`alter table sessions add column x int`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.execute(sql`drop table sessions`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
  });

  it("cannot read the migration ledger", async () => {
    await expect(
      app.db.execute(sql`select count(*) from drizzle.__drizzle_migrations`),
    ).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
  });

  it("can insert, read, update and delete sessions", async () => {
    const now = new Date();
    await app.db
      .insert(sessions)
      .values({ id: "role-probe", accountId: null, expiresAt: now, lastSeenAt: now, userAgentHash: "x" });
    expect(await app.db.select({ id: sessions.id }).from(sessions)).toEqual([{ id: "role-probe" }]);
    await app.db.update(sessions).set({ userAgentHash: "y" });
    await app.db.delete(sessions);
    expect(await app.db.select().from(sessions)).toEqual([]);
  });

  it("can read and write accounts and auth_throttle, which 0001's default privileges granted before they existed", async () => {
    const id = await insertAccount(app.db, "RoleProbe");
    expect(await app.db.select({ login: accounts.login }).from(accounts)).toEqual([{ login: "RoleProbe" }]);
    await app.db.update(accounts).set({ login: "Renamed" }).where(eq(accounts.id, id));

    await app.db.insert(authThrottle).values({ key: "roleprobe", failures: 1, blockedUntil: null });
    await app.db.update(authThrottle).set({ failures: 2 });
    expect(await app.db.select({ failures: authThrottle.failures }).from(authThrottle)).toEqual([
      { failures: 2 },
    ]);
    await app.db.delete(authThrottle);
    await app.db.delete(accounts);
    expect(await app.db.select().from(accounts)).toEqual([]);
  });

  /** Postgres `check_violation`. */
  const CHECK_VIOLATION = "23514";
  const PROBE_CHARACTER = 999_000_001;
  const PROBE_IMAGE = "https://s4.anilist.co/file/anilistcdn/character/large/b999000001.png";
  const probeSnapshots: number[] = [];

  /** A snapshot, a character and an opening for `accountId`, written as the app role, ready for a card. */
  async function seedOpening(accountId: string): Promise<{ snapshotId: number; openingId: string }> {
    const now = new Date();
    const [snapshot] = await app.db
      .insert(poolSnapshots)
      .values({
        source: "file",
        takenAt: now,
        activatedAt: now,
        isCurrent: false,
        seriesCount: 0,
        franchiseCount: 0,
        characterCount: 0,
        tierCounts: [0, 0, 0, 0, 0, 0],
      })
      .returning({ id: poolSnapshots.id });
    if (snapshot === undefined) throw new Error("snapshot insert returned no row");
    probeSnapshots.push(snapshot.id);
    await app.db
      .insert(characters)
      .values({ id: PROBE_CHARACTER, name: "Probe", imageUrl: PROBE_IMAGE })
      .onConflictDoNothing();
    const [opening] = await app.db
      .insert(packOpenings)
      .values({
        accountId,
        requestId: randomUUID(),
        snapshotId: snapshot.id,
        kind: "standard",
        pity: false,
        openedAt: now,
      })
      .returning({ id: packOpenings.id });
    if (opening === undefined) throw new Error("opening insert returned no row");
    return { snapshotId: snapshot.id, openingId: opening.id };
  }

  const card = (accountId: string, seeded: { snapshotId: number; openingId: string }, slot: number) => ({
    accountId,
    openingId: seeded.openingId,
    slot,
    characterId: PROBE_CHARACTER,
    rarity: "mythic" as const,
    snapshotId: seeded.snapshotId,
    isNew: true,
    pulledAt: new Date(),
  });

  /** The app role may not delete a snapshot or a character (0004), so the probe rows go as the owner. */
  afterAll(async () => {
    const owner = createDb(migrationsDatabaseUrl());
    try {
      await owner.delete(accounts);
      await owner.delete(characters).where(eq(characters.id, PROBE_CHARACTER));
      if (probeSnapshots.length > 0)
        await owner.delete(poolSnapshots).where(inArray(poolSnapshots.id, probeSnapshots));
    } finally {
      await owner.$client.end();
    }
  });

  it("can write the 1c tables down to a card, which 0001's default privileges granted as well", async () => {
    const accountId = await insertAccount(app.db, "CardProbe");
    const seeded = await seedOpening(accountId);
    await app.db.insert(cards).values(card(accountId, seeded, 0));
    expect(
      await app.db.select({ variant: cards.variant }).from(cards).where(eq(cards.accountId, accountId)),
    ).toEqual([{ variant: "standard" }]);
  });

  it("holds exactly the rights 0001 granted less 0004's revokes, table by table", async () => {
    const grants = await app.db.execute<{ table_name: string; rights: string }>(sql`
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as rights
      from information_schema.role_table_grants
      where grantee = 'anime_app' and table_schema = 'public'
      group by table_name order by table_name
    `);
    const all = "DELETE,INSERT,SELECT,UPDATE";
    expect(grants.rows).toEqual([
      { table_name: "accounts", rights: all },
      { table_name: "auth_throttle", rights: all },
      { table_name: "cards", rights: "INSERT,SELECT" },
      { table_name: "characters", rights: "INSERT,SELECT,UPDATE" },
      { table_name: "pack_openings", rights: "DELETE,INSERT,SELECT" },
      { table_name: "pool_fetch_pages", rights: all },
      { table_name: "pool_fetches", rights: all },
      { table_name: "pool_snapshot_characters", rights: "INSERT,SELECT" },
      { table_name: "pool_snapshot_franchises", rights: "INSERT,SELECT" },
      { table_name: "pool_snapshot_memberships", rights: "INSERT,SELECT" },
      { table_name: "pool_snapshot_relations", rights: "INSERT,SELECT" },
      { table_name: "pool_snapshot_series", rights: "INSERT,SELECT" },
      { table_name: "pool_snapshots", rights: "INSERT,SELECT,UPDATE" },
      { table_name: "series", rights: "INSERT,SELECT,UPDATE" },
      { table_name: "sessions", rights: all },
    ]);
  });

  it("cannot rewrite a granted card's rarity, delete a card on its own or change an opening (0004)", async () => {
    const accountId = await insertAccount(app.db, "RarityProbe");
    await app.db.insert(cards).values(card(accountId, await seedOpening(accountId), 0));
    await expect(
      app.db.update(cards).set({ rarity: "common" }).where(eq(cards.accountId, accountId)),
    ).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.delete(cards).where(eq(cards.accountId, accountId))).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.update(packOpenings).set({ pity: true })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
  });

  it("cannot change or delete a snapshot's rows, delete the snapshot, or delete a character or series (0004)", async () => {
    await seedOpening(await insertAccount(app.db, "SnapshotProbe"));
    await expect(
      app.db.delete(poolSnapshotCharacters).where(eq(poolSnapshotCharacters.characterId, PROBE_CHARACTER)),
    ).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.update(poolSnapshotSeries).set({ popularity: 0 })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.delete(poolSnapshots)).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.delete(characters)).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.delete(series)).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
  });

  it("still deletes an account with its openings and cards, by cascade", async () => {
    const accountId = await insertAccount(app.db, "CascadeProbe");
    await app.db.insert(cards).values(card(accountId, await seedOpening(accountId), 0));
    await app.db.delete(accounts).where(eq(accounts.id, accountId));
    expect(await app.db.select().from(cards).where(eq(cards.accountId, accountId))).toEqual([]);
    expect(await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, accountId))).toEqual([]);
  });

  it("still resets a collection: the openings go and their cards by cascade", async () => {
    const accountId = await insertAccount(app.db, "ResetProbe");
    await app.db.insert(cards).values(card(accountId, await seedOpening(accountId), 0));
    const result = await resetCollection(app.db, "ResetProbe", { confirm: true });
    expect(result).toMatchObject({ applied: true, cards: 1, openings: 1 });
    expect(await app.db.select().from(cards).where(eq(cards.accountId, accountId))).toEqual([]);
    expect(await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, accountId))).toEqual([]);
  });

  it("refuses a card slot outside the pack's five (0004)", async () => {
    const accountId = await insertAccount(app.db, "SlotProbe");
    const seeded = await seedOpening(accountId);
    await app.db.insert(cards).values(card(accountId, seeded, PACK_SIZE - 1));
    for (const slot of [-1, PACK_SIZE]) {
      await expect(app.db.insert(cards).values(card(accountId, seeded, slot))).rejects.toMatchObject({
        cause: { code: CHECK_VIOLATION, constraint: "cards_slot_check" },
      });
    }
  });

  it("refuses a character image off https://IMAGE_HOST/ (0004)", async () => {
    for (const imageUrl of [
      "http://s4.anilist.co/file/b1.png",
      "https://s4.anilist.co.evil.example/b1.png",
      "https://evil.example/https://s4.anilist.co/b1.png",
      "javascript:alert(1)",
    ]) {
      await expect(
        app.db.insert(characters).values({ id: PROBE_CHARACTER + 1, name: "Probe", imageUrl }),
      ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION, constraint: "characters_image_url_check" } });
    }
  });

  it("cannot truncate or alter the new tables either", async () => {
    await expect(app.db.execute(sql`truncate accounts`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.execute(sql`alter table auth_throttle add column x int`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
  });

  it("answers /healthz from the app pool", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
  });
});
