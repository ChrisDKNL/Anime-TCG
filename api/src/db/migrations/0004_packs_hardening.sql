-- Hardening of 1c after its security review (docs/design/collection-packs.md
-- §4.1): a card's slot is one of the pack's five, and a character's image is
-- on the one host the CSP allows. Every row the api has written satisfies
-- both: the snapshot validation and the opening already enforce them.
-- Then the app role gives back the rights on 0003's tables that no request
-- and no owner command uses, so a bug cannot rewrite a granted card, an
-- opening or a snapshot, or delete shared reference data. Staged pages are
-- only ever inserted and read. Cards still go with their account or opening,
-- and staged pages with their fetch: a cascade runs with the table owner's
-- rights.
ALTER TABLE "cards" ADD CONSTRAINT "cards_slot_check" CHECK ("cards"."slot" between 0 and 4);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_image_url_check" CHECK ("characters"."image_url" like 'https://s4.anilist.co/%');--> statement-breakpoint
REVOKE UPDATE, DELETE ON "cards" FROM "anime_app";--> statement-breakpoint
REVOKE UPDATE ON "pack_openings" FROM "anime_app";--> statement-breakpoint
REVOKE DELETE ON "characters", "series", "pool_snapshots" FROM "anime_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "pool_snapshot_characters", "pool_snapshot_series", "pool_snapshot_franchises", "pool_snapshot_relations", "pool_snapshot_memberships" FROM "anime_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "pool_fetch_pages" FROM "anime_app";--> statement-breakpoint
REVOKE UPDATE ON "pool_fetches" FROM "anime_app";