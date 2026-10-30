-- Market hardening after the tester's hunt on #53 (docs/design/economy.md §7,
-- manager decision, 2026-10-30): delete_bought_cards refuses while the
-- account still has an active listing, so it can never leave a listing live
-- with no card. The owner reset cancels the account's listings first, in the
-- same transaction, so the reset still deletes every bought card. The body
-- moves from SQL to PL/pgSQL for the refusal; it still runs with the owner's
-- rights, with a fixed search_path, deletes only the account's cards that
-- carry a purchase_id, and only the app role may call it: CREATE OR REPLACE
-- keeps 0006's grants.
CREATE OR REPLACE FUNCTION "delete_bought_cards"("account" uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  "deleted" integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public."market_listings" l WHERE l."seller_id" = "account" AND l."status" = 'active') THEN
    RAISE EXCEPTION 'account %: cancel its active listings before deleting its bought cards', "account"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  DELETE FROM public."cards" c WHERE c."account_id" = "account" AND c."purchase_id" IS NOT NULL;
  GET DIAGNOSTICS "deleted" = ROW_COUNT;
  RETURN "deleted";
END
$$;
