import { MAX_BALANCE, MAX_ENTRY_AMOUNT, MAX_RECYCLE_COUNT, PACK_SIZE } from "@anime-tcg/shared/economy";
import { PITY_PACKS, RARITIES } from "@anime-tcg/shared/rarity";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
import { IMAGE_HOST } from "../domain/pool/limits.js";

/**
 * Player accounts (docs/design/accounts-api.md §5). `login` is the display
 * name as typed (trimmed); `login_normalized` is its case-folded form and the
 * only uniqueness key, so "Chris" and "chris" are one account. The password
 * is an Argon2id PHC string; the invite hash is an audit trail of which code
 * admitted the account, never used to verify anything.
 */
export const accounts = pgTable(
  "accounts",
  {
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
    /**
     * Free packs opened since the account's last Mythic card (§5.4.5); at
     * `PITY_PACKS - 1` the next free pack is pity-due, so it never reaches
     * `PITY_PACKS`. Read and written only under this row's lock.
     */
    packsSinceMythic: integer("packs_since_mythic").notNull().default(0),
    /** Free packs opened since registration or the last reset; every `ENCHANTED_INTERVAL`th is Enchanted. */
    freePacksOpened: integer("free_packs_opened").notNull().default(0),
    /**
     * Karma (economy.md §7): written only by the ledger function, under this
     * row's lock, in the transaction of the ledger row that proves it.
     */
    balance: integer("balance").notNull().default(0),
    /**
     * When the owner last reset this account's collection (economy.md §7,
     * §8.10), set in the reset's transaction; null if it never was. A recycle
     * without its cards, or a shop debit without its opening, is explained by
     * a reset only if it is no newer than this (§13.1). Migration 0005's
     * trigger `accounts_last_reset_forward` keeps it null on a new account
     * and refuses moving it back, to null, or past the database's
     * statement_timestamp() plus 5 seconds.
     */
    lastResetAt: timestamp("last_reset_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "accounts_packs_since_mythic_check",
      sql`${table.packsSinceMythic} between 0 and ${sql.raw(String(PITY_PACKS - 1))}`,
    ),
    check("accounts_free_packs_opened_check", sql`${table.freePacksOpened} >= 0`),
    check("accounts_balance_check", sql`${table.balance} between 0 and ${sql.raw(String(MAX_BALANCE))}`),
  ],
);

/** Why a balance changed (economy.md §7); items 5 and 6 add `wager` and `payout`. Nothing else may change one. */
export const ledgerKind = pgEnum("ledger_kind", [
  "recycle_credit",
  "shop_purchase",
  "market_purchase",
  "market_sale",
  "market_fee",
  "owner_reset",
]);

/**
 * One row per balance change, never updated or deleted (the app role holds
 * neither right). `seq` runs 1, 2, 3 ... per account under the account lock
 * and `balance_after` chains the rows, so `audit-ledger` sees a missing,
 * extra or altered one. A credit is positive, a debit negative.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: ledgerKind("kind").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("ledger_entries_account_seq_unique").on(table.accountId, table.seq),
    index("ledger_entries_account_kind_created_idx").on(table.accountId, table.kind, table.createdAt),
    check("ledger_entries_seq_check", sql`${table.seq} >= 1`),
    check(
      "ledger_entries_amount_check",
      sql`${table.amount} <> 0 and (abs(${table.amount}) <= ${sql.raw(String(MAX_ENTRY_AMOUNT))} or ${table.kind} = 'owner_reset')`,
    ),
    check(
      "ledger_entries_balance_after_check",
      sql`${table.balanceAfter} between 0 and ${sql.raw(String(MAX_BALANCE))}`,
    ),
  ],
);

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
export const rarity = pgEnum("rarity", RARITIES);
/** Reserved (collection-packs.md §2): `masterwork` arrives as `ALTER TYPE ... ADD VALUE`; existing rows keep `standard`. */
export const cardVariant = pgEnum("card_variant", ["standard"]);
/** Reserved: a Relic arrives as its own table beside `cards` and the value `relic`; no column uses the type yet. */
export const itemKind = pgEnum("item_kind", ["card"]);
export const characterRole = pgEnum("character_role", ["main", "supporting"]);
/** Which rules an opening was dealt under (spec §5.4.3); a replay answers it as stored. */
export const packKind = pgEnum("pack_kind", ["standard", "enchanted", "radiant"]);
/** What paid for an opening (economy.md §7): the allowance or the shop; items 5 and 6 add `prize`. */
export const openingSource = pgEnum("opening_source", ["timer", "shop"]);
/** A market listing's state (economy.md §7); a listing past `expires_at` is expired whatever this says until the purge marks it. */
export const listingStatus = pgEnum("listing_status", ["active", "sold", "cancelled", "expired"]);

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
    /** Characters per tier in rank order: common, uncommon, rare, epic, legendary, mythic. */
    tierCounts: integer("tier_counts").array().notNull(),
  },
  (table) => [
    uniqueIndex("pool_snapshots_current_idx")
      .on(table.isCurrent)
      .where(sql`${table.isCurrent}`),
    check("pool_snapshots_source_check", sql`${table.source} in ('anilist', 'file')`),
    check(
      "pool_snapshots_tier_counts_check",
      sql`cardinality(${table.tierCounts}) = ${sql.raw(String(RARITIES.length))}`,
    ),
  ],
);

/**
 * The latest display data of every anime entry that was ever in a snapshot;
 * never deleted. `search_title` and `search_title_native` are the titles in
 * the search normalisation of `@anime-tcg/shared/search` (economy.md §7,
 * §8.4), written with them by every snapshot.
 */
export const series = pgTable("series", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  titleNative: text("title_native"),
  startYear: smallint("start_year"),
  searchTitle: text("search_title").notNull(),
  searchTitleNative: text("search_title_native"),
});

/**
 * The latest display data of every character that was ever in a snapshot;
 * never deleted. The check repeats the host rule of the snapshot validation
 * (spec §5.1.6) so no write path can store an image URL off the CSP's host.
 * `search_name` and `search_name_native` are the names in the search
 * normalisation, as `series` holds its titles.
 */
export const characters = pgTable(
  "characters",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    nameNative: text("name_native"),
    imageUrl: text("image_url").notNull(),
    searchName: text("search_name").notNull(),
    searchNameNative: text("search_name_native"),
  },
  (table) => [
    check("characters_image_url_check", sql`${table.imageUrl} like ${sql.raw(`'https://${IMAGE_HOST}/%'`)}`),
  ],
);

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
    kind: packKind("kind").notNull(),
    /** The last card's Mythic was forced by pity; a Radiant pack already holds one, so it is never both. */
    pity: boolean("pity").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    source: openingSource("source").notNull().default("timer"),
    /** `genre-<slug>`; set exactly when the shop sold the pack. */
    themeId: text("theme_id"),
    /** The shop price's debit; null for a timer pack. */
    ledgerEntryId: uuid("ledger_entry_id")
      .unique("pack_openings_ledger_entry_unique")
      .references(() => ledgerEntries.id),
    /** The Karma the shop charged, as it was that day, so a later price change leaves the audit exact; null for a timer pack. */
    price: integer("price"),
  },
  (table) => [
    unique("pack_openings_account_request_unique").on(table.accountId, table.requestId),
    check("pack_openings_pity_check", sql`not ${table.pity} or ${table.kind} <> 'radiant'`),
    check(
      "pack_openings_source_check",
      sql`(${table.source} = 'shop') = (${table.themeId} is not null) and (${table.source} = 'shop') = (${table.ledgerEntryId} is not null)`,
    ),
    check(
      "pack_openings_price_check",
      sql`(${table.source} = 'shop') = (${table.price} is not null) and (${table.price} is null or ${table.price} > 0)`,
    ),
  ],
);

/**
 * One row per recycle of duplicates for Karma (economy.md §8.2): the
 * idempotency record and the receipt. `request_hash` is the SHA-256 of the
 * canonical body, so a reused key with another request is told apart.
 */
export const recycles = pgTable(
  "recycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id),
    rarity: rarity("rarity").notNull(),
    count: integer("count").notNull(),
    /** Karma per card at recycle time (`RECYCLE_VALUE[rarity]` that day): the credit is `count × unit_value`. */
    unitValue: integer("unit_value").notNull(),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .unique("recycles_ledger_entry_unique")
      .references(() => ledgerEntries.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("recycles_account_request_unique").on(table.accountId, table.requestId),
    check("recycles_count_check", sql`${table.count} between 1 and ${sql.raw(String(MAX_RECYCLE_COUNT))}`),
    check("recycles_unit_value_check", sql`${table.unitValue} > 0`),
  ],
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
    /** The pack that dealt the card; null for a card a market purchase delivered (`purchase_id`), which has no slot either. */
    openingId: uuid("opening_id").references(() => packOpenings.id, { onDelete: "cascade" }),
    slot: smallint("slot"),
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
    /**
     * Null while held; set when the card is recycled or sold (economy.md §7).
     * The row stays, so the recycle or the sale can be audited, and once set
     * neither this nor `removed_by_recycle` changes again, and
     * `removed_by_purchase` changes only to null (the buyer's account went):
     * the trigger `cards_removed_stays` (0005, extended by 0006) refuses it,
     * the app role included.
     */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByRecycle: uuid("removed_by_recycle").references(() => recycles.id),
    /** The market purchase that sold this card to another account. */
    removedByPurchase: uuid("removed_by_purchase").references((): AnyPgColumn => marketPurchases.id, {
      onDelete: "set null",
    }),
    /** The market purchase that delivered this card: a bought card is a new row of the buyer's (§7). */
    purchaseId: uuid("purchase_id").references((): AnyPgColumn => marketPurchases.id),
    /** Reserved for a game ante (items 5 and 6): always null in item 2, and nothing writes it. */
    escrowId: uuid("escrow_id"),
  },
  (table) => [
    unique("cards_opening_slot_unique").on(table.openingId, table.slot),
    check("cards_slot_check", sql`${table.slot} between 0 and ${sql.raw(String(PACK_SIZE - 1))}`),
    check(
      "cards_removed_check",
      sql`${table.removedAt} is not null or (${table.removedByRecycle} is null and ${table.removedByPurchase} is null)`,
    ),
    check(
      "cards_removed_once_check",
      sql`num_nonnulls(${table.removedByRecycle}, ${table.removedByPurchase}) <= 1`,
    ),
    check("cards_origin_check", sql`num_nonnulls(${table.openingId}, ${table.purchaseId}) = 1`),
    check("cards_slot_origin_check", sql`(${table.openingId} is null) = (${table.slot} is null)`),
    check("cards_escrow_check", sql`${table.removedAt} is null or ${table.escrowId} is null`),
    // A purchase delivers exactly one card.
    uniqueIndex("cards_purchase_idx")
      .on(table.purchaseId)
      .where(sql`${table.purchaseId} is not null`),
    // audit-ledger finds each sale's removed card by this column (economy.md §13.1).
    index("cards_removed_by_purchase_idx")
      .on(table.removedByPurchase)
      .where(sql`${table.removedByPurchase} is not null`),

    index("cards_held_entry_idx")
      .on(table.accountId, table.characterId, table.rarity, table.variant)
      .where(sql`${table.removedAt} is null`),
    // audit-ledger counts each recycle's cards by this column (economy.md §13.1).
    index("cards_removed_by_recycle_idx")
      .on(table.removedByRecycle)
      .where(sql`${table.removedByRecycle} is not null`),
  ],
);

/**
 * One card offered on the player market (economy.md §7, §8.3). `id` is
 * public: the market names listings by it. The rarity and variant are the
 * card's, copied, and the fee is fixed when the card is listed. The app
 * role may change only `status` and `closed_at` (migration 0006); `card_id`
 * goes to null only when an owner reset deletes the card.
 */
export const marketListings = pgTable(
  "market_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    itemKind: itemKind("item_kind").notNull().default("card"),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "set null" }),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id),
    rarity: rarity("rarity").notNull(),
    variant: cardVariant("variant").notNull().default("standard"),
    price: integer("price").notNull(),
    fee: integer("fee").notNull(),
    status: listingStatus("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    unique("market_listings_seller_request_unique").on(table.sellerId, table.requestId),
    // A card is listed at most once at a time.
    uniqueIndex("market_listings_active_card_idx")
      .on(table.cardId)
      .where(sql`${table.status} = 'active'`),
    index("market_listings_active_price_idx")
      .on(table.rarity, table.price, table.id)
      .where(sql`${table.status} = 'active'`),
    index("market_listings_active_character_idx")
      .on(table.characterId)
      .where(sql`${table.status} = 'active'`),
    index("market_listings_seller_status_idx").on(table.sellerId, table.status),
    check(
      "market_listings_price_check",
      sql`${table.price} between 1 and ${sql.raw(String(MAX_ENTRY_AMOUNT))}`,
    ),
    check("market_listings_fee_check", sql`${table.fee} between 1 and ${table.price}`),
    check("market_listings_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check("market_listings_closed_check", sql`(${table.status} = 'active') = (${table.closedAt} is null)`),
  ],
);

/**
 * One row per market purchase (economy.md §7, §8.5): the buyer's receipt
 * and idempotency record, never updated or deleted by the app role. The
 * buyer's debit and the seller's sale and fee are its three ledger rows;
 * deleting the seller's account keeps the buyer's receipt and nulls only
 * the seller's side.
 */
export const marketPurchases = pgTable(
  "market_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    listingId: uuid("listing_id")
      .unique("market_purchases_listing_unique")
      .references(() => marketListings.id, { onDelete: "set null" }),
    sellerId: uuid("seller_id").references(() => accounts.id, { onDelete: "set null" }),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id),
    rarity: rarity("rarity").notNull(),
    variant: cardVariant("variant").notNull(),
    price: integer("price").notNull(),
    fee: integer("fee").notNull(),
    buyerEntryId: uuid("buyer_entry_id")
      .notNull()
      .unique("market_purchases_buyer_entry_unique")
      .references(() => ledgerEntries.id),
    sellerSaleEntryId: uuid("seller_sale_entry_id")
      .unique("market_purchases_sale_entry_unique")
      .references(() => ledgerEntries.id, { onDelete: "set null" }),
    sellerFeeEntryId: uuid("seller_fee_entry_id")
      .unique("market_purchases_fee_entry_unique")
      .references(() => ledgerEntries.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("market_purchases_buyer_request_unique").on(table.buyerId, table.requestId),
    index("market_purchases_seller_created_idx").on(table.sellerId, table.createdAt),
    index("market_purchases_buyer_created_idx").on(table.buyerId, table.createdAt),
    check(
      "market_purchases_price_check",
      sql`${table.price} between 1 and ${sql.raw(String(MAX_ENTRY_AMOUNT))}`,
    ),
    check("market_purchases_fee_check", sql`${table.fee} between 1 and ${table.price}`),
    check(
      "market_purchases_self_trade_check",
      sql`${table.sellerId} is null or ${table.sellerId} <> ${table.buyerId}`,
    ),
  ],
);
