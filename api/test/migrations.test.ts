import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { migrationsDatabaseUrl, testDatabaseUrl } from "./support.js";

const MIGRATION_FILES = [
  "0000_create_sessions.sql",
  "0001_app_role_grants.sql",
  "0002_accounts_and_throttle.sql",
  "0003_collection_packs.sql",
  "0004_packs_hardening.sql",
];
const MIGRATION_WHEN = ["1793207773838", "1793217582152", "1793220843481", "1793285235582", "1793296711999"];

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

  it("gave accounts both pack counters, not null with a default of 0 and bounded by checks", async () => {
    const columns = await db.execute<{
      column_name: string;
      is_nullable: string;
      column_default: string;
    }>(sql`
      select column_name, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'accounts'
        and column_name in ('packs_since_mythic', 'free_packs_opened')
      order by column_name
    `);
    expect(columns.rows).toEqual([
      { column_name: "free_packs_opened", is_nullable: "NO", column_default: "0" },
      { column_name: "packs_since_mythic", is_nullable: "NO", column_default: "0" },
    ]);
    const checks = await db.execute<{ conname: string; definition: string }>(sql`
      select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid in ('accounts'::regclass, 'pack_openings'::regclass, 'pool_snapshots'::regclass)
        and contype = 'c' and conname <> 'pool_snapshots_source_check'
      order by conname
    `);
    expect(checks.rows).toEqual([
      { conname: "accounts_free_packs_opened_check", definition: "CHECK ((free_packs_opened >= 0))" },
      {
        conname: "accounts_packs_since_mythic_check",
        definition: "CHECK (((packs_since_mythic >= 0) AND (packs_since_mythic <= 299)))",
      },
      {
        conname: "pack_openings_pity_check",
        definition: "CHECK (((NOT pity) OR (kind <> 'radiant'::pack_kind)))",
      },
      { conname: "pool_snapshots_tier_counts_check", definition: "CHECK ((cardinality(tier_counts) = 6))" },
    ]);
  });

  /**
   * A scratch database migrated with the first `applied` migrations only, handed to `before` to plant
   * rows, then migrated to the end the way a start-up would, and handed to `after`; dropped afterwards.
   */
  async function migratedOver(
    applied: number,
    before: (probe: pg.Client) => Promise<void>,
    after: (probe: pg.Client) => Promise<void>,
  ): Promise<void> {
    const name = `anime_migration_probe_${process.pid}`;
    const url = new URL(migrationsDatabaseUrl());
    url.pathname = `/${name}`;
    const folder = await mkdtemp(join(tmpdir(), "anime-migrations-"));
    await db.execute(sql.raw(`drop database if exists ${name}`));
    await db.execute(sql.raw(`create database ${name}`));
    const probe = new pg.Client({ connectionString: url.href });
    try {
      for (const file of MIGRATION_FILES.slice(0, applied)) {
        await copyFile(new URL(`../src/db/migrations/${file}`, import.meta.url), join(folder, file));
      }
      const journal = JSON.parse(
        await readFile(new URL("../src/db/migrations/meta/_journal.json", import.meta.url), "utf8"),
      ) as { entries: unknown[] };
      await mkdir(join(folder, "meta"));
      await writeFile(
        join(folder, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, applied) }),
      );
      await probe.connect();
      await migrate(drizzle(probe), { migrationsFolder: folder });
      await before(probe);
      await runMigrations(url.href);
      await after(probe);
    } finally {
      await probe.end();
      await rm(folder, { recursive: true, force: true });
      await db.execute(sql.raw(`drop database if exists ${name}`));
    }
  }

  const insertOldAccount = (probe: pg.Client) =>
    probe.query(
      "insert into accounts (login, login_normalized, password_hash, invite_code_hash) values ('old', 'old', 'x', 'y')",
    );

  it("leaves every 1b account full and both counters at 0 when 0003 runs over it", async () => {
    await migratedOver(
      3,
      async (probe) => {
        await insertOldAccount(probe);
      },
      async (probe) => {
        const rows = await probe.query(
          "select packs_anchor_at, packs_since_mythic, free_packs_opened from accounts where login = 'old'",
        );
        expect(rows.rows).toEqual([{ packs_anchor_at: null, packs_since_mythic: 0, free_packs_opened: 0 }]);
      },
    );
  });

  it("applies 0004 over a database that ran 0003 and holds a card, keeping the card", async () => {
    await migratedOver(
      4,
      async (probe) => {
        await insertOldAccount(probe);
        await probe.query(`
          with snapshot as (
            insert into pool_snapshots (source, taken_at, activated_at, is_current, series_count,
              franchise_count, character_count, tier_counts)
            values ('file', now(), now(), true, 0, 0, 1, '{0,0,0,0,0,1}') returning id
          ), character as (
            insert into characters (id, name, image_url)
            values (1, 'Old', 'https://s4.anilist.co/file/anilistcdn/character/large/b1.png') returning id
          ), opening as (
            insert into pack_openings (account_id, request_id, snapshot_id, kind, pity, opened_at)
            select a.id, gen_random_uuid(), s.id, 'standard', false, now()
            from accounts a, snapshot s where a.login = 'old' returning id, account_id, snapshot_id
          )
          insert into cards (account_id, opening_id, slot, character_id, rarity, snapshot_id, is_new, pulled_at)
          select o.account_id, o.id, 4, c.id, 'mythic', o.snapshot_id, true, now() from opening o, character c
        `);
      },
      async (probe) => {
        const cards = await probe.query("select slot, rarity from cards");
        expect(cards.rows).toEqual([{ slot: 4, rarity: "mythic" }]);
        const checks = await probe.query(
          "select conname from pg_constraint where conname in ('cards_slot_check', 'characters_image_url_check') order by conname",
        );
        expect(checks.rows).toEqual([
          { conname: "cards_slot_check" },
          { conname: "characters_image_url_check" },
        ]);
      },
    );
  });

  it("checks a card's slot against the pack size and a character's image against IMAGE_HOST (0004)", async () => {
    const checks = await db.execute<{ conname: string; definition: string }>(sql`
      select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid in ('cards'::regclass, 'characters'::regclass) and contype = 'c'
      order by conname
    `);
    expect(checks.rows).toEqual([
      { conname: "cards_slot_check", definition: "CHECK (((slot >= 0) AND (slot <= 4)))" },
      {
        conname: "characters_image_url_check",
        definition: "CHECK ((image_url ~~ 'https://s4.anilist.co/%'::text))",
      },
    ]);
  });

  it("created the six tiers in rank order, the pack kinds, and the reserved enums with one value each", async () => {
    const enums = await db.execute<{ name: string; labels: string }>(sql`
      select t.typname as name, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      group by t.typname order by t.typname
    `);
    expect(enums.rows).toEqual([
      { name: "card_variant", labels: "standard" },
      { name: "character_role", labels: "main,supporting" },
      { name: "item_kind", labels: "card" },
      { name: "pack_kind", labels: "standard,enchanted,radiant" },
      { name: "rarity", labels: "common,uncommon,rare,epic,legendary,mythic" },
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
