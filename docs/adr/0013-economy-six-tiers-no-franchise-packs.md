# 0013 — Economy for six tiers; no franchise packs

2026-10-29 · accepted · amends ADR 0011 (§1's themed packs and three of its consequences); ADR 0011 otherwise stands

## Context

`docs/design/economy.md` was written for ADR 0011's first, five-tier version. 1c shipped six tiers, slot floors and the Enchanted, Radiant and pity rules (`collection-packs.md` §5.4), so the economy's numbers were re-derived by the spec's own rules (`economy.md` §5, §9). The re-derivation raised three questions. The owner answered the one on franchise packs ("Owner, 2026-10-29"). The other two went unanswered, so the manager set the recommended options as defaults, which the owner may revise.

## Decision

1. **Six-tier economy numbers, by a standard pack's share of cards** (manager default, 2026-10-29, owner may revise). A tier's reference value is inverse to its share of a standard pack's cards (the per-slot rate averaged over the five slots), with Common at 10, rounded to two significant figures: Common 10, Uncommon 23, Rare 35, Epic 160, Legendary 1 000, Mythic 11 000. Every number derived from the reference values follows by the rules ADR 0011 and `economy.md` §16 already fix: recycle values 2 / 5 / 8 / 40 / 250 / 2 750, market bounds 0.5× to 2.5×, and the themed pack at 400 (2.34 times a shop pack's 170.79).
2. **Market window limits at 2.2 times the owner's moderate set** (manager default, 2026-10-29, owner may revise): 55 000 spent per buyer, 55 000 received per seller and 27 500 per pair per rolling 7 days, with 100 purchases. 2.2 is the smallest factor at which one Mythic at the upper bound (27 500) fits the pair limit.
3. **No franchise packs** (Owner, 2026-10-29): "Cut franchise packs, only have themed packs that contain cards from all franchises." The Karma shop's themed packs are cross-franchise themes only, today every eligible genre. The eligibility rule is unchanged: each tier holds at least `PACK_SIZE` characters, which gives 13 of 17 genres on the real snapshot. This narrows ADR 0011 §1's themed packs and supersedes `economy.md` round 3, decision 10's franchise packs.

## Consequences

- This ADR supersedes three of ADR 0011's consequences. Six tiers, not five, set every economy number. The market limits are still sized so that one Mythic at the upper bound can be bought, now at 27 500 with the pair limit at 27 500. And `economy.md` again has no open questions: its §17 lists none, and its §16 records the owner's decision and the two manager defaults.
- `pack_themes`, the `pack-themes` command, `ThemeOffer.kind` and every franchise-theme test leave `economy.md`. `market-and-shop.md` and `collection-overview.md` still describe franchise packs and follow in their own revision.
- With 2.2 times the limits, multi-accounting can at most about double one account's Karma income (52 250 net per 7 days against its own 7 505 a day), as `economy.md` §10 states.
