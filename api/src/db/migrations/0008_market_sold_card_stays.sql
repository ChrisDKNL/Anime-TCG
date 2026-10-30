-- Market hardening after the tester's hunt on #53 (docs/design/economy.md §7,
-- manager decision, 2026-10-30): cards_removed_stays lets a removed card's
-- removed_by_purchase go from a purchase to null only once that purchase
-- row no longer exists, which is the foreign key's set null when the buyer's
-- account is deleted. An update that nulls it while the purchase still
-- exists, the app role's or the owner's, is refused like any other change
-- to a removed card, so a sale cannot be hidden from audit-ledger that way.
-- The purchase lookup is qualified, so a temporary table cannot stand in.
CREATE OR REPLACE FUNCTION "cards_keep_removed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."removed_at" IS NOT NULL AND (NEW."removed_at" IS DISTINCT FROM OLD."removed_at"
      OR NEW."removed_by_recycle" IS DISTINCT FROM OLD."removed_by_recycle"
      OR (NEW."removed_by_purchase" IS DISTINCT FROM OLD."removed_by_purchase"
          AND (NEW."removed_by_purchase" IS NOT NULL
               OR EXISTS (SELECT 1 FROM public."market_purchases" p WHERE p."id" = OLD."removed_by_purchase")))) THEN
    RAISE EXCEPTION 'card % was removed at %: a removed card stays removed', OLD."id", OLD."removed_at"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
