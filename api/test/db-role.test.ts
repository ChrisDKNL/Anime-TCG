import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { sessions } from "../src/db/schema.js";
import { clearSessions, createTestApp } from "./support.js";

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
  beforeEach(() => clearSessions(app.db));
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

  it("answers /healthz from the app pool", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
  });
});
