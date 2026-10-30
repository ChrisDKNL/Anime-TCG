-- Economy, server side, PR 3: the player market (docs/design/economy.md §3
-- item 3, §7, §8.3 to §8.5). Listings and purchases; a sold card leaves the
-- seller as a removed row (removed_by_purchase) and reaches the buyer as a
-- new row (purchase_id) with no opening and no slot, so every card has
-- exactly one origin and a purchase delivers exactly one card. A card is
-- removed by at most one recycle or one purchase.
-- The market's search columns: every character name and series title in
-- the normalisation of @anime-tcg/shared/search (collection-overview.md
-- §3.3), backfilled here for the rows that exist and written by every
-- snapshot from now on (economy.md §7). The backfill spells the same steps
-- in SQL: NFKC, lower case, NFD, the accents U+0300..U+036F removed, NFC,
-- trim, whitespace runs to one space. lower() follows the database's
-- collation, so a few special cases the collation folds differently from
-- JavaScript (a final sigma, a dotted capital I) stay as SQL wrote them
-- until the next snapshot rewrites the row.
-- Then the app role's rights (after 0004's and 0005's pattern): listings may
-- change only their state and closing time, purchases are append-only, and
-- of a card the app may also mark it sold. It still may not delete a card:
-- the owner reset deletes every card of an account whatever its origin
-- (§8.10), and a bought card has no opening to go with by cascade, so the
-- reset deletes an account's bought cards through delete_bought_cards, a
-- function that runs with the owner's rights, deletes nothing else, and
-- only the app role may call. A cascade from an account, a listing or a
-- purchase runs with the owner's rights as well.
-- Last, cards_removed_stays is extended narrowly: once a card is removed,
-- removed_by_purchase also never changes, except to null when the buyer's
-- account is deleted and its purchase goes (the foreign key's set null).
CREATE TYPE "public"."listing_status" AS ENUM('active', 'sold', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "market_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"item_kind" "item_kind" DEFAULT 'card' NOT NULL,
	"card_id" uuid,
	"character_id" integer NOT NULL,
	"rarity" "rarity" NOT NULL,
	"variant" "card_variant" DEFAULT 'standard' NOT NULL,
	"price" integer NOT NULL,
	"fee" integer NOT NULL,
	"status" "listing_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "market_listings_seller_request_unique" UNIQUE("seller_id","request_id"),
	CONSTRAINT "market_listings_price_check" CHECK ("market_listings"."price" between 1 and 1000000),
	CONSTRAINT "market_listings_fee_check" CHECK ("market_listings"."fee" between 1 and "market_listings"."price"),
	CONSTRAINT "market_listings_expiry_check" CHECK ("market_listings"."expires_at" > "market_listings"."created_at"),
	CONSTRAINT "market_listings_closed_check" CHECK (("market_listings"."status" = 'active') = ("market_listings"."closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "market_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"listing_id" uuid,
	"seller_id" uuid,
	"character_id" integer NOT NULL,
	"rarity" "rarity" NOT NULL,
	"variant" "card_variant" NOT NULL,
	"price" integer NOT NULL,
	"fee" integer NOT NULL,
	"buyer_entry_id" uuid NOT NULL,
	"seller_sale_entry_id" uuid,
	"seller_fee_entry_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_purchases_listing_unique" UNIQUE("listing_id"),
	CONSTRAINT "market_purchases_buyer_entry_unique" UNIQUE("buyer_entry_id"),
	CONSTRAINT "market_purchases_sale_entry_unique" UNIQUE("seller_sale_entry_id"),
	CONSTRAINT "market_purchases_fee_entry_unique" UNIQUE("seller_fee_entry_id"),
	CONSTRAINT "market_purchases_buyer_request_unique" UNIQUE("buyer_id","request_id"),
	CONSTRAINT "market_purchases_price_check" CHECK ("market_purchases"."price" between 1 and 1000000),
	CONSTRAINT "market_purchases_fee_check" CHECK ("market_purchases"."fee" between 1 and "market_purchases"."price"),
	CONSTRAINT "market_purchases_self_trade_check" CHECK ("market_purchases"."seller_id" is null or "market_purchases"."seller_id" <> "market_purchases"."buyer_id")
);
--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_removed_check";--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "opening_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "slot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "removed_by_purchase" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "search_name" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "search_name_native" text;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "search_title" text;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "search_title_native" text;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchases" ADD CONSTRAINT "market_purchases_buyer_id_accounts_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchases" ADD CONSTRAINT "market_purchases_listing_id_market_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."market_listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchases" ADD CONSTRAINT "market_purchases_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchases" ADD CONSTRAINT "market_purchases_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchases" ADD CONSTRAINT "market_purchases_buyer_entry_id_ledger_entries_id_fk" FOREIGN KEY ("buyer_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchases" ADD CONSTRAINT "market_purchases_seller_sale_entry_id_ledger_entries_id_fk" FOREIGN KEY ("seller_sale_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchases" ADD CONSTRAINT "market_purchases_seller_fee_entry_id_ledger_entries_id_fk" FOREIGN KEY ("seller_fee_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_listings_active_card_idx" ON "market_listings" USING btree ("card_id") WHERE "market_listings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "market_listings_active_price_idx" ON "market_listings" USING btree ("rarity","price","id") WHERE "market_listings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "market_listings_active_character_idx" ON "market_listings" USING btree ("character_id") WHERE "market_listings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "market_listings_seller_status_idx" ON "market_listings" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "market_purchases_seller_created_idx" ON "market_purchases" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "market_purchases_buyer_created_idx" ON "market_purchases" USING btree ("buyer_id","created_at");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_removed_by_purchase_market_purchases_id_fk" FOREIGN KEY ("removed_by_purchase") REFERENCES "public"."market_purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_purchase_id_market_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."market_purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_purchase_idx" ON "cards" USING btree ("purchase_id") WHERE "cards"."purchase_id" is not null;--> statement-breakpoint
CREATE INDEX "cards_removed_by_purchase_idx" ON "cards" USING btree ("removed_by_purchase") WHERE "cards"."removed_by_purchase" is not null;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_removed_once_check" CHECK (num_nonnulls("cards"."removed_by_recycle", "cards"."removed_by_purchase") <= 1);--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_origin_check" CHECK (num_nonnulls("cards"."opening_id", "cards"."purchase_id") = 1);--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_slot_origin_check" CHECK (("cards"."opening_id" is null) = ("cards"."slot" is null));--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_removed_check" CHECK ("cards"."removed_at" is not null or ("cards"."removed_by_recycle" is null and "cards"."removed_by_purchase" is null));--> statement-breakpoint
CREATE FUNCTION pg_temp."search_text"("value" text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    regexp_replace(
      normalize(regexp_replace(normalize(lower(normalize("value", NFKC)), NFD), '[\u0300-\u036f]', '', 'g'), NFC),
      '^[\s\u1680\u2028\u2029\ufeff]+|[\s\u1680\u2028\u2029\ufeff]+$', '', 'g'),
    '[\s\u1680\u2028\u2029\ufeff]+', ' ', 'g')
$$;--> statement-breakpoint
UPDATE "characters" SET "search_name" = pg_temp."search_text"("name"),
  "search_name_native" = pg_temp."search_text"("name_native");--> statement-breakpoint
UPDATE "series" SET "search_title" = pg_temp."search_text"("title"),
  "search_title_native" = pg_temp."search_text"("title_native");--> statement-breakpoint
DROP FUNCTION pg_temp."search_text"(text);--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "search_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ALTER COLUMN "search_title" SET NOT NULL;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "market_listings", "market_purchases" FROM "anime_app";--> statement-breakpoint
GRANT UPDATE ("status", "closed_at") ON "market_listings" TO "anime_app";--> statement-breakpoint
GRANT UPDATE ("removed_by_purchase") ON "cards" TO "anime_app";--> statement-breakpoint
CREATE FUNCTION "delete_bought_cards"("account" uuid) RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH deleted AS (
    DELETE FROM public."cards" WHERE "account_id" = "account" AND "purchase_id" IS NOT NULL RETURNING 1
  )
  SELECT count(*)::integer FROM deleted
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "delete_bought_cards"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "delete_bought_cards"(uuid) TO "anime_app";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "cards_keep_removed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."removed_at" IS NOT NULL AND (NEW."removed_at" IS DISTINCT FROM OLD."removed_at"
      OR NEW."removed_by_recycle" IS DISTINCT FROM OLD."removed_by_recycle"
      OR (NEW."removed_by_purchase" IS DISTINCT FROM OLD."removed_by_purchase"
          AND NEW."removed_by_purchase" IS NOT NULL)) THEN
    RAISE EXCEPTION 'card % was removed at %: a removed card stays removed', OLD."id", OLD."removed_at"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;