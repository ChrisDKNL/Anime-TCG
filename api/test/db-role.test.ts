import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import {
  accounts,
  authThrottle,
  cards,
  characters,
  packOpenings,
  poolSnapshots,
  sessions,
} from "../src/db/schema.js";
import { clearAccountData, createTestApp, insertAccount } from "./support.js";

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

  it("can write the 1c tables down to a card, which 0001's default privileges granted as well", async () => {
    const accountId = await insertAccount(app.db, "CardProbe");
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
    const characterId = 999_000_001;
    await app.db
      .insert(characters)
      .values({ id: characterId, name: "Probe", imageUrl: "https://s4.anilist.co/probe.png" });
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
    await app.db.insert(cards).values({
      accountId,
      openingId: opening.id,
      slot: 0,
      characterId,
      rarity: "mythic",
      snapshotId: snapshot.id,
      isNew: true,
      pulledAt: now,
    });
    expect(
      await app.db.select({ variant: cards.variant }).from(cards).where(eq(cards.accountId, accountId)),
    ).toEqual([{ variant: "standard" }]);

    await app.db.delete(accounts).where(eq(accounts.id, accountId));
    expect(await app.db.select().from(cards).where(eq(cards.accountId, accountId))).toEqual([]);
    await app.db.delete(characters).where(eq(characters.id, characterId));
    await app.db.delete(poolSnapshots).where(eq(poolSnapshots.id, snapshot.id));
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
