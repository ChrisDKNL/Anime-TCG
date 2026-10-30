-- Economy, server side, PR 1 (docs/design/economy.md §3 item 1, §7): Karma as
-- a balance on the account row with the ledger as its proof, recycles of
-- duplicates, shop openings and the card columns a recycle needs. Every 1c
-- account starts at 0 Karma, every 1c opening is a timer opening, and every
-- 1c card is held. The market's tables and columns arrive with PR 3.
-- Each recycle keeps its Karma per card and each shop opening its price, so
-- audit-ledger checks a row against the value of its own day. Each account
-- keeps the time of its last collection reset, so the audit can tell a
-- recycle whose cards a reset deleted from one whose cards were never
-- removed or were put back (manager decision, 2026-10-30).
-- Then the app role's rights (C11, after 0004's pattern): the ledger and the
-- recycles are append-only for requests, so no UPDATE or DELETE on either;
-- of a card it may change only the two columns a recycle writes. A cascade
-- from an account still removes its rows: it runs with the owner's rights.
-- Last, a trigger keeps a removed card removed: once removed_at is set,
-- neither it nor removed_by_recycle changes again, whoever runs the update
-- (manager decision, 2026-10-30). A reset deletes the cards, so it is not
-- affected. A second trigger keeps an account's last reset honest: it never
-- moves back or to null, never lies more than 5 seconds past the database's
-- now(), and a new account starts with none (manager decision, 2026-10-30).
CREATE TYPE "public"."ledger_kind" AS ENUM('recycle_credit', 'shop_purchase', 'market_purchase', 'market_sale', 'market_fee', 'owner_reset');--> statement-breakpoint
CREATE TYPE "public"."opening_source" AS ENUM('timer', 'shop');--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_entries_account_seq_unique" UNIQUE("account_id","seq"),
	CONSTRAINT "ledger_entries_seq_check" CHECK ("ledger_entries"."seq" >= 1),
	CONSTRAINT "ledger_entries_amount_check" CHECK ("ledger_entries"."amount" <> 0 and (abs("ledger_entries"."amount") <= 1000000 or "ledger_entries"."kind" = 'owner_reset')),
	CONSTRAINT "ledger_entries_balance_after_check" CHECK ("ledger_entries"."balance_after" between 0 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE "recycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"character_id" integer NOT NULL,
	"rarity" "rarity" NOT NULL,
	"count" integer NOT NULL,
	"unit_value" integer NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recycles_ledger_entry_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "recycles_account_request_unique" UNIQUE("account_id","request_id"),
	CONSTRAINT "recycles_count_check" CHECK ("recycles"."count" between 1 and 100),
	CONSTRAINT "recycles_unit_value_check" CHECK ("recycles"."unit_value" > 0)
);
--> statement-breakpoint
DROP INDEX "cards_account_entry_idx";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "removed_by_recycle" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "escrow_id" uuid;--> statement-breakpoint
ALTER TABLE "pack_openings" ADD COLUMN "source" "opening_source" DEFAULT 'timer' NOT NULL;--> statement-breakpoint
ALTER TABLE "pack_openings" ADD COLUMN "theme_id" text;--> statement-breakpoint
ALTER TABLE "pack_openings" ADD COLUMN "ledger_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "pack_openings" ADD COLUMN "price" integer;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recycles" ADD CONSTRAINT "recycles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recycles" ADD CONSTRAINT "recycles_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recycles" ADD CONSTRAINT "recycles_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_account_kind_created_idx" ON "ledger_entries" USING btree ("account_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_removed_by_recycle_recycles_id_fk" FOREIGN KEY ("removed_by_recycle") REFERENCES "public"."recycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_openings" ADD CONSTRAINT "pack_openings_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_held_entry_idx" ON "cards" USING btree ("account_id","character_id","rarity","variant") WHERE "cards"."removed_at" is null;--> statement-breakpoint
ALTER TABLE "pack_openings" ADD CONSTRAINT "pack_openings_ledger_entry_unique" UNIQUE("ledger_entry_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_balance_check" CHECK ("accounts"."balance" between 0 and 1000000000);--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_removed_check" CHECK ("cards"."removed_at" is not null or "cards"."removed_by_recycle" is null);--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_escrow_check" CHECK ("cards"."removed_at" is null or "cards"."escrow_id" is null);--> statement-breakpoint
ALTER TABLE "pack_openings" ADD CONSTRAINT "pack_openings_source_check" CHECK (("pack_openings"."source" = 'shop') = ("pack_openings"."theme_id" is not null) and ("pack_openings"."source" = 'shop') = ("pack_openings"."ledger_entry_id" is not null));--> statement-breakpoint
ALTER TABLE "pack_openings" ADD CONSTRAINT "pack_openings_price_check" CHECK (("pack_openings"."source" = 'shop') = ("pack_openings"."price" is not null) and ("pack_openings"."price" is null or "pack_openings"."price" > 0));--> statement-breakpoint
REVOKE UPDATE, DELETE ON "ledger_entries", "recycles" FROM "anime_app";--> statement-breakpoint
GRANT UPDATE ("removed_at", "removed_by_recycle") ON "cards" TO "anime_app";--> statement-breakpoint
CREATE FUNCTION "cards_keep_removed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."removed_at" IS NOT NULL AND (NEW."removed_at" IS DISTINCT FROM OLD."removed_at"
      OR NEW."removed_by_recycle" IS DISTINCT FROM OLD."removed_by_recycle") THEN
    RAISE EXCEPTION 'card % was removed at %: a removed card stays removed', OLD."id", OLD."removed_at"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "cards_removed_stays" BEFORE UPDATE ON "cards"
  FOR EACH ROW EXECUTE FUNCTION "cards_keep_removed"();--> statement-breakpoint
CREATE FUNCTION "accounts_keep_last_reset"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."last_reset_at" IS NOT NULL THEN
      RAISE EXCEPTION 'a new account has no last reset' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF OLD."last_reset_at" IS NOT NULL
      AND (NEW."last_reset_at" IS NULL OR NEW."last_reset_at" < OLD."last_reset_at") THEN
    RAISE EXCEPTION 'account %: the last reset at % never moves back', OLD."id", OLD."last_reset_at"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."last_reset_at" > now() + interval '5 seconds' THEN
    RAISE EXCEPTION 'account %: a last reset at % is in the future', NEW."id", NEW."last_reset_at"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "accounts_last_reset_forward" BEFORE INSERT OR UPDATE OF "last_reset_at" ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION "accounts_keep_last_reset"();
