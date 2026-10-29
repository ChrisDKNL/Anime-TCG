-- Hardening of 1c after its security review (docs/design/collection-packs.md
-- §4.1): a card's slot is one of the pack's five, and a character's image is
-- on the one host the CSP allows. Every row the api has written satisfies
-- both: the snapshot validation and the opening already enforce them.
ALTER TABLE "cards" ADD CONSTRAINT "cards_slot_check" CHECK ("cards"."slot" between 0 and 4);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_image_url_check" CHECK ("characters"."image_url" like 'https://s4.anilist.co/%');