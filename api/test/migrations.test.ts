import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { testDatabaseUrl } from "./support.js";

const MIGRATION_SQL = new URL("../src/db/migrations/0000_create_sessions.sql", import.meta.url);

/**
 * Spec §5: migrations run at every start-up, so running them against an
 * already-migrated database must be a no-op, and the SQL that ran must be the
 * SQL that is committed. Drizzle records the sha256 of each applied file, which
 * makes the second property checkable without trusting the migrator.
 */
describe("migrations", () => {
  let db: Db;
  beforeAll(() => {
    db = createDb(testDatabaseUrl());
  });
  afterAll(() => db.$client.end());

  async function appliedMigrations(): Promise<{ hash: string; created_at: string }[]> {
    const result = await db.execute<{ hash: string; created_at: string }>(
      sql`select hash, created_at from drizzle.__drizzle_migrations order by id`,
    );
    return result.rows;
  }

  it("is idempotent: a second run applies nothing and changes nothing", async () => {
    await runMigrations(db);
    const before = await appliedMigrations();
    expect(before).toHaveLength(1);

    await runMigrations(db);
    await runMigrations(db);
    expect(await appliedMigrations()).toEqual(before);
  });

  it("applied exactly the committed SQL, byte for byte", async () => {
    const committed = createHash("sha256")
      .update(await readFile(MIGRATION_SQL))
      .digest("hex");
    const [applied] = await appliedMigrations();
    // A mismatch means a committed migration was edited after it ran somewhere; add a new file instead.
    expect(applied?.hash).toBe(committed);
    expect(String(applied?.created_at)).toBe("1793207773838");
  });

  it("produced the sessions table the schema and spec describe", async () => {
    const columns = await db.execute<{ column_name: string; data_type: string; is_nullable: string }>(sql`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'sessions'
      order by ordinal_position
    `);
    expect(columns.rows).toEqual([
      { column_name: "id", data_type: "text", is_nullable: "NO" },
      { column_name: "account_id", data_type: "uuid", is_nullable: "YES" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "expires_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "last_seen_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "user_agent_hash", data_type: "text", is_nullable: "NO" },
    ]);

    const indexes = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public' and tablename = 'sessions' order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "sessions_account_id_idx",
      "sessions_expires_at_idx",
      "sessions_pkey",
    ]);
  });

  it("the purge query can use the expires_at index rather than scanning every session", async () => {
    // Force the planner's hand: on a tiny table it would seq-scan regardless, which says nothing about the index.
    await db.execute(sql`set enable_seqscan = off`);
    try {
      const plan = await db.execute<{ "QUERY PLAN": string }>(
        sql`explain delete from sessions where expires_at <= now()`,
      );
      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("sessions_expires_at_idx");
    } finally {
      await db.execute(sql`reset enable_seqscan`);
    }
  });
});
