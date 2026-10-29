import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Player accounts (docs/design/accounts-api.md §5). `login` is the display
 * name as typed (trimmed); `login_normalized` is its case-folded form and the
 * only uniqueness key, so "Chris" and "chris" are one account. The password
 * is an Argon2id PHC string; the invite hash is an audit trail of which code
 * admitted the account, never used to verify anything.
 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  login: text("login").notNull(),
  loginNormalized: text("login_normalized").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  inviteCodeHash: text("invite_code_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * The pack allowance clock (docs/design/collection-packs.md §5.2), read and
   * written only under this row's lock. Null means full, which is how new
   * accounts and every account from before 1c start.
   */
  packsAnchorAt: timestamp("packs_anchor_at", { withTimezone: true }),
});

/**
 * Server sessions (ADR 0008 §4). `id` is the HMAC of the cookie value, so a
 * copy of this table yields no usable cookie. `account_id` stays nullable for
 * a pre-auth session; deleting an account takes its sessions with it.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    userAgentHash: text("user_agent_hash").notNull(),
  },
  (table) => [
    index("sessions_expires_at_idx").on(table.expiresAt),
    index("sessions_account_id_idx").on(table.accountId),
  ],
);

/**
 * The sign-in breather (spec §6.3), keyed on the normalised login so a
 * reload or a second tab cannot reset it. A row is written on a failed
 * password check and deleted on success; the hourly purge removes stale ones.
 */
export const authThrottle = pgTable("auth_throttle", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** In rank order: Postgres orders enum values by declaration, so `order by rarity desc` puts Mythic first. */
export const rarity = pgEnum("rarity", ["common", "rare", "epic", "legendary", "mythic"]);
/** Reserved (collection-packs.md §2): `masterwork` arrives as `ALTER TYPE ... ADD VALUE`; existing rows keep `standard`. */
export const cardVariant = pgEnum("card_variant", ["standard"]);
/** Reserved: a Relic arrives as its own table beside `cards` and the value `relic`; no column uses the type yet. */
export const itemKind = pgEnum("item_kind", ["card"]);
export const characterRole = pgEnum("character_role", ["main", "supporting"]);

/**
 * One row per snapshot of the AniList pool (collection-packs.md §4.1), never
 * deleted: cards name the snapshot that granted them. `id` is the version
 * players see; at most one row is current.
 */
export const poolSnapshots = pgTable(
  "pool_snapshots",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    source: text("source", { enum: ["anilist", "file"] }).notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull(),
    isCurrent: boolean("is_current").notNull(),
    seriesCount: integer("series_count").notNull(),
    franchiseCount: integer("franchise_count").notNull(),
    characterCount: integer("character_count").notNull(),
    /** Characters per tier in rank order: common, rare, epic, legendary, mythic. */
    tierCounts: integer("tier_counts").array().notNull(),
  },
  (table) => [
    uniqueIndex("pool_snapshots_current_idx")
      .on(table.isCurrent)
      .where(sql`${table.isCurrent}`),
    check("pool_snapshots_source_check", sql`${table.source} in ('anilist', 'file')`),
    check("pool_snapshots_tier_counts_check", sql`cardinality(${table.tierCounts}) = 5`),
  ],
);

/** The latest display data of every anime entry that was ever in a snapshot; never deleted. */
export const series = pgTable("series", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  titleNative: text("title_native"),
  startYear: smallint("start_year"),
});

/** The latest display data of every character that was ever in a snapshot; never deleted. */
export const characters = pgTable("characters", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  nameNative: text("name_native"),
  imageUrl: text("image_url").notNull(),
});

/** A snapshot's franchises; `franchise_id` is the smallest AniList id among its entries (spec §5.1.2). */
export const poolSnapshotFranchises = pgTable(
  "pool_snapshot_franchises",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => poolSnapshots.id),
    franchiseId: integer("franchise_id")
      .notNull()
      .references(() => series.id),
    popularityRank: smallint("popularity_rank").notNull(),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.franchiseId] })],
);

/** The anime entries of a snapshot, in AniList's popularity order. */
export const poolSnapshotSeries = pgTable(
  "pool_snapshot_series",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => poolSnapshots.id),
    seriesId: integer("series_id")
      .notNull()
      .references(() => series.id),
    franchiseId: integer("franchise_id").notNull(),
    popularityRank: smallint("popularity_rank").notNull(),
    popularity: integer("popularity").notNull(),
    genres: text("genres").array().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.seriesId] }),
    foreignKey({
      name: "pool_snapshot_series_franchise_fk",
      columns: [table.snapshotId, table.franchiseId],
      foreignColumns: [poolSnapshotFranchises.snapshotId, poolSnapshotFranchises.franchiseId],
    }),
  ],
);

/** The merging relation edges a snapshot's franchises were built from, kept for audit and `--export`. */
export const poolSnapshotRelations = pgTable(
  "pool_snapshot_relations",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => poolSnapshots.id),
    fromId: integer("from_id").notNull(),
    toId: integer("to_id").notNull(),
    relationType: text("relation_type").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pool_snapshot_relations_pk",
      columns: [table.snapshotId, table.fromId, table.toId, table.relationType],
    }),
  ],
);

/** A snapshot's pool: one row per character, with the tier it is dealt as while this snapshot is current. */
export const poolSnapshotCharacters = pgTable(
  "pool_snapshot_characters",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => poolSnapshots.id),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id),
    favourites: integer("favourites").notNull(),
    favouritesRank: integer("favourites_rank").notNull(),
    tier: rarity("tier").notNull(),
    primarySeriesId: integer("primary_series_id")
      .notNull()
      .references(() => series.id),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.characterId] }),
    index("pool_snapshot_characters_tier_idx").on(table.snapshotId, table.tier, table.characterId),
  ],
);

/** The snapshot entries a character is MAIN or SUPPORTING in. */
export const poolSnapshotMemberships = pgTable(
  "pool_snapshot_memberships",
  {
    snapshotId: integer("snapshot_id").notNull(),
    characterId: integer("character_id").notNull(),
    seriesId: integer("series_id").notNull(),
    role: characterRole("role").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pool_snapshot_memberships_pk",
      columns: [table.snapshotId, table.characterId, table.seriesId],
    }),
    foreignKey({
      name: "pool_snapshot_memberships_character_fk",
      columns: [table.snapshotId, table.characterId],
      foreignColumns: [poolSnapshotCharacters.snapshotId, poolSnapshotCharacters.characterId],
    }),
    foreignKey({
      name: "pool_snapshot_memberships_series_fk",
      columns: [table.snapshotId, table.seriesId],
      foreignColumns: [poolSnapshotSeries.snapshotId, poolSnapshotSeries.seriesId],
    }),
  ],
);

/** Staging for a resumable AniList fetch (spec §5.1.5); deleted, pages and all, once a snapshot is built from it. */
export const poolFetches = pgTable("pool_fetches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
});

export const poolFetchPages = pgTable(
  "pool_fetch_pages",
  {
    fetchId: integer("fetch_id")
      .notNull()
      .references(() => poolFetches.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["series", "relations", "characters"] }).notNull(),
    key: text("key").notNull(),
    page: smallint("page").notNull(),
    /** Only the declared fields of AniList's answer, after the schema parse; never a whole body. */
    body: jsonb("body").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fetchId, table.kind, table.key, table.page] }),
    check("pool_fetch_pages_kind_check", sql`${table.kind} in ('series', 'relations', 'characters')`),
  ],
);

/** One row per opened pack; `request_id` is the client's idempotency key, scoped to the account. */
export const packOpenings = pgTable(
  "pack_openings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => poolSnapshots.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique("pack_openings_account_request_unique").on(table.accountId, table.requestId)],
);

/**
 * One row per card, duplicates included (spec §4.1). `rarity` is the card's
 * as granted and no snapshot rewrites it; `id` never leaves the server.
 */
export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    openingId: uuid("opening_id")
      .notNull()
      .references(() => packOpenings.id, { onDelete: "cascade" }),
    slot: smallint("slot").notNull(),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id),
    rarity: rarity("rarity").notNull(),
    variant: cardVariant("variant").notNull().default("standard"),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => poolSnapshots.id),
    isNew: boolean("is_new").notNull(),
    pulledAt: timestamp("pulled_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("cards_opening_slot_unique").on(table.openingId, table.slot),
    index("cards_account_entry_idx").on(table.accountId, table.characterId, table.rarity, table.variant),
  ],
);
