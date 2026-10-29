import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { migrationsDatabaseUrl, testDatabaseUrl } from "./support.js";

const MIGRATION_FILES = [
  "0000_create_sessions.sql",
  "0001_app_role_grants.sql",
  "0002_accounts_and_throttle.sql",
  "0003_collection_packs.sql",
];
const MIGRATION_WHEN = ["1793207773838", "1793217582152", "1793220843481", "1793272812170"];

/**
 * Spec §5: migrations run at every start-up, so running them against an
 * already-migrated database must be a no-op, and the SQL that ran must be the
 * SQL that is committed. Drizzle records the sha256 of each applied file, which
 * makes the second property checkable without trusting the migrator. The
 * queries here run as the owner: `drizzle.__drizzle_migrations` is never
 * granted to the app role (spec §4.1), which `db-role.test.ts` proves.
 */
describe("migrations", () => {
  let db: Db;
  beforeAll(() => {
    db = createDb(migrationsDatabaseUrl());
  });
  afterAll(() => db.$client.end());

  async function appliedMigrations(): Promise<{ hash: string; created_at: string }[]> {
    const result = await db.execute<{ hash: string; created_at: string }>(
      sql`select hash, created_at from drizzle.__drizzle_migrations order by id`,
    );
    return result.rows;
  }

  it("is idempotent: a second run applies nothing and changes nothing", async () => {
    await runMigrations(migrationsDatabaseUrl());
    const before = await appliedMigrations();
    expect(before).toHaveLength(MIGRATION_FILES.length);

    await runMigrations(migrationsDatabaseUrl());
    await runMigrations(migrationsDatabaseUrl());
    expect(await appliedMigrations()).toEqual(before);
  });

  it("refuses to run as the app role, which cannot touch the migrations table", async () => {
    await expect(runMigrations(testDatabaseUrl())).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("applied exactly the committed SQL, byte for byte", async () => {
    const applied = await appliedMigrations();
    for (const [index, file] of MIGRATION_FILES.entries()) {
      const committed = createHash("sha256")
        .update(await readFile(new URL(`../src/db/migrations/${file}`, import.meta.url)))
        .digest("hex");
      // A mismatch means a committed migration was edited after it ran somewhere; add a new file instead.
      expect(applied[index]?.hash, file).toBe(committed);
      expect(String(applied[index]?.created_at), file).toBe(MIGRATION_WHEN[index]);
    }
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

  it("produced every table of 1b and 1c, and nothing else", async () => {
    const tables = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "accounts",
      "auth_throttle",
      "cards",
      "characters",
      "pack_openings",
      "pool_fetch_pages",
      "pool_fetches",
      "pool_snapshot_characters",
      "pool_snapshot_franchises",
      "pool_snapshot_memberships",
      "pool_snapshot_relations",
      "pool_snapshot_series",
      "pool_snapshots",
      "series",
      "sessions",
    ]);
  });

  it("produced the accounts and auth_throttle tables, with sessions cascading from accounts", async () => {
    const unique = await db.execute<{ constraint_name: string }>(sql`
      select constraint_name from information_schema.table_constraints
      where table_schema = 'public' and table_name = 'accounts' and constraint_type = 'UNIQUE'
    `);
    expect(unique.rows.map((row) => row.constraint_name)).toEqual(["accounts_login_normalized_unique"]);

    const cascade = await db.execute<{ delete_rule: string }>(sql`
      select rc.delete_rule from information_schema.referential_constraints rc
      join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
      where tc.table_schema = 'public' and tc.table_name = 'sessions'
    `);
    expect(cascade.rows).toEqual([{ delete_rule: "CASCADE" }]);
  });

  it("gave accounts a nullable allowance clock with no default, so every 1b account reads as full", async () => {
    const column = await db.execute<{
      is_nullable: string;
      column_default: string | null;
      data_type: string;
    }>(sql`
      select is_nullable, column_default, data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'accounts' and column_name = 'packs_anchor_at'
    `);
    expect(column.rows).toEqual([
      { is_nullable: "YES", column_default: null, data_type: "timestamp with time zone" },
    ]);
  });

  it("created the five tiers in rank order and the reserved enums with one value each", async () => {
    const enums = await db.execute<{ name: string; labels: string }>(sql`
      select t.typname as name, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      group by t.typname order by t.typname
    `);
    expect(enums.rows).toEqual([
      { name: "card_variant", labels: "standard" },
      { name: "character_role", labels: "main,supporting" },
      { name: "item_kind", labels: "card" },
      { name: "rarity", labels: "common,rare,epic,legendary,mythic" },
    ]);
  });

  it("cascades an account's openings and cards and nothing that is shared reference data", async () => {
    const rules = await db.execute<{ table_name: string; constraint_name: string; delete_rule: string }>(sql`
      select tc.table_name, tc.constraint_name, rc.delete_rule from information_schema.referential_constraints rc
      join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
      where tc.table_schema = 'public' and tc.table_name in ('cards', 'pack_openings', 'pool_fetch_pages')
      order by tc.constraint_name
    `);
    expect(rules.rows).toEqual([
      { table_name: "cards", constraint_name: "cards_account_id_accounts_id_fk", delete_rule: "CASCADE" },
      {
        table_name: "cards",
        constraint_name: "cards_character_id_characters_id_fk",
        delete_rule: "NO ACTION",
      },
      {
        table_name: "cards",
        constraint_name: "cards_opening_id_pack_openings_id_fk",
        delete_rule: "CASCADE",
      },
      {
        table_name: "cards",
        constraint_name: "cards_snapshot_id_pool_snapshots_id_fk",
        delete_rule: "NO ACTION",
      },
      {
        table_name: "pack_openings",
        constraint_name: "pack_openings_account_id_accounts_id_fk",
        delete_rule: "CASCADE",
      },
      {
        table_name: "pack_openings",
        constraint_name: "pack_openings_snapshot_id_pool_snapshots_id_fk",
        delete_rule: "NO ACTION",
      },
      {
        table_name: "pool_fetch_pages",
        constraint_name: "pool_fetch_pages_fetch_id_pool_fetches_id_fk",
        delete_rule: "CASCADE",
      },
    ]);
  });

  it("allows at most one current snapshot", async () => {
    const indexes = await db.execute<{ indexdef: string }>(sql`
      select indexdef from pg_indexes where schemaname = 'public' and indexname = 'pool_snapshots_current_idx'
    `);
    expect(indexes.rows[0]?.indexdef).toMatch(/^CREATE UNIQUE INDEX .* \(is_current\) WHERE is_current$/);
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
