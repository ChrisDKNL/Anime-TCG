-- Collection and packs (docs/design/collection-packs.md §4.1), six tiers. The
-- app role gets its row access on the new tables from 0001's default
-- privileges. `accounts.packs_anchor_at` is added as null, which means a full
-- allowance, so every account from 1b starts with all its packs; both pack
-- counters start at 0, as on registration.
CREATE TYPE "public"."card_variant" AS ENUM('standard');--> statement-breakpoint
CREATE TYPE "public"."character_role" AS ENUM('main', 'supporting');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('card');--> statement-breakpoint
CREATE TYPE "public"."pack_kind" AS ENUM('standard', 'enchanted', 'radiant');--> statement-breakpoint
CREATE TYPE "public"."rarity" AS ENUM('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	"character_id" integer NOT NULL,
	"rarity" "rarity" NOT NULL,
	"variant" "card_variant" DEFAULT 'standard' NOT NULL,
	"snapshot_id" integer NOT NULL,
	"is_new" boolean NOT NULL,
	"pulled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cards_opening_slot_unique" UNIQUE("opening_id","slot")
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_native" text,
	"image_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pack_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"snapshot_id" integer NOT NULL,
	"kind" "pack_kind" NOT NULL,
	"pity" boolean NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pack_openings_account_request_unique" UNIQUE("account_id","request_id"),
	CONSTRAINT "pack_openings_pity_check" CHECK (not "pack_openings"."pity" or "pack_openings"."kind" <> 'radiant')
);
--> statement-breakpoint
CREATE TABLE "pool_fetch_pages" (
	"fetch_id" integer NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"page" smallint NOT NULL,
	"body" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pool_fetch_pages_fetch_id_kind_key_page_pk" PRIMARY KEY("fetch_id","kind","key","page"),
	CONSTRAINT "pool_fetch_pages_kind_check" CHECK ("pool_fetch_pages"."kind" in ('series', 'relations', 'characters'))
);
--> statement-breakpoint
CREATE TABLE "pool_fetches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pool_fetches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_snapshot_characters" (
	"snapshot_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"favourites" integer NOT NULL,
	"favourites_rank" integer NOT NULL,
	"tier" "rarity" NOT NULL,
	"primary_series_id" integer NOT NULL,
	CONSTRAINT "pool_snapshot_characters_snapshot_id_character_id_pk" PRIMARY KEY("snapshot_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "pool_snapshot_franchises" (
	"snapshot_id" integer NOT NULL,
	"franchise_id" integer NOT NULL,
	"popularity_rank" smallint NOT NULL,
	CONSTRAINT "pool_snapshot_franchises_snapshot_id_franchise_id_pk" PRIMARY KEY("snapshot_id","franchise_id")
);
--> statement-breakpoint
CREATE TABLE "pool_snapshot_memberships" (
	"snapshot_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"series_id" integer NOT NULL,
	"role" character_role NOT NULL,
	CONSTRAINT "pool_snapshot_memberships_pk" PRIMARY KEY("snapshot_id","character_id","series_id")
);
--> statement-breakpoint
CREATE TABLE "pool_snapshot_relations" (
	"snapshot_id" integer NOT NULL,
	"from_id" integer NOT NULL,
	"to_id" integer NOT NULL,
	"relation_type" text NOT NULL,
	CONSTRAINT "pool_snapshot_relations_pk" PRIMARY KEY("snapshot_id","from_id","to_id","relation_type")
);
--> statement-breakpoint
CREATE TABLE "pool_snapshot_series" (
	"snapshot_id" integer NOT NULL,
	"series_id" integer NOT NULL,
	"franchise_id" integer NOT NULL,
	"popularity_rank" smallint NOT NULL,
	"popularity" integer NOT NULL,
	"genres" text[] NOT NULL,
	CONSTRAINT "pool_snapshot_series_snapshot_id_series_id_pk" PRIMARY KEY("snapshot_id","series_id")
);
--> statement-breakpoint
CREATE TABLE "pool_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pool_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"is_current" boolean NOT NULL,
	"series_count" integer NOT NULL,
	"franchise_count" integer NOT NULL,
	"character_count" integer NOT NULL,
	"tier_counts" integer[] NOT NULL,
	CONSTRAINT "pool_snapshots_source_check" CHECK ("pool_snapshots"."source" in ('anilist', 'file')),
	CONSTRAINT "pool_snapshots_tier_counts_check" CHECK (cardinality("pool_snapshots"."tier_counts") = 6)
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"title_native" text,
	"start_year" smallint
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "packs_anchor_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "packs_since_mythic" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "free_packs_opened" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_opening_id_pack_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."pack_openings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_snapshot_id_pool_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."pool_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_openings" ADD CONSTRAINT "pack_openings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_openings" ADD CONSTRAINT "pack_openings_snapshot_id_pool_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."pool_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_fetch_pages" ADD CONSTRAINT "pool_fetch_pages_fetch_id_pool_fetches_id_fk" FOREIGN KEY ("fetch_id") REFERENCES "public"."pool_fetches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_characters" ADD CONSTRAINT "pool_snapshot_characters_snapshot_id_pool_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."pool_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_characters" ADD CONSTRAINT "pool_snapshot_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_characters" ADD CONSTRAINT "pool_snapshot_characters_primary_series_id_series_id_fk" FOREIGN KEY ("primary_series_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_franchises" ADD CONSTRAINT "pool_snapshot_franchises_snapshot_id_pool_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."pool_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_franchises" ADD CONSTRAINT "pool_snapshot_franchises_franchise_id_series_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_memberships" ADD CONSTRAINT "pool_snapshot_memberships_character_fk" FOREIGN KEY ("snapshot_id","character_id") REFERENCES "public"."pool_snapshot_characters"("snapshot_id","character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_memberships" ADD CONSTRAINT "pool_snapshot_memberships_series_fk" FOREIGN KEY ("snapshot_id","series_id") REFERENCES "public"."pool_snapshot_series"("snapshot_id","series_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_relations" ADD CONSTRAINT "pool_snapshot_relations_snapshot_id_pool_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."pool_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_series" ADD CONSTRAINT "pool_snapshot_series_snapshot_id_pool_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."pool_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_series" ADD CONSTRAINT "pool_snapshot_series_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_snapshot_series" ADD CONSTRAINT "pool_snapshot_series_franchise_fk" FOREIGN KEY ("snapshot_id","franchise_id") REFERENCES "public"."pool_snapshot_franchises"("snapshot_id","franchise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_account_entry_idx" ON "cards" USING btree ("account_id","character_id","rarity","variant");--> statement-breakpoint
CREATE INDEX "pool_snapshot_characters_tier_idx" ON "pool_snapshot_characters" USING btree ("snapshot_id","tier","character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_snapshots_current_idx" ON "pool_snapshots" USING btree ("is_current") WHERE "pool_snapshots"."is_current";--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_packs_since_mythic_check" CHECK ("accounts"."packs_since_mythic" between 0 and 299);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_free_packs_opened_check" CHECK ("accounts"."free_packs_opened" >= 0);