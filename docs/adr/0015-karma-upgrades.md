# 0015 — Karma upgrades

2026-10-31 · accepted · amends ADR 0011 §1 (the free pack's fixed interval and stock become per-account levels); ADR 0011 otherwise stands. Numbered after ADR 0014 (PR #64).

## Context

The economy has two Karma sinks: themed packs in the shop and the market fee (`economy.md` §9). The owner wants a third, of a different kind: "paid upgrades that can be bought with Karma that give certain QoL benefits like more offline cards, faster refill, bigger trade budget. But they should be costly and you will need to grind for it" (2026-10-31).

Before deciding, the owner was told three things:

- A faster refill or a bigger stock gives its buyer more packs, and so more duplicates and more Karma, so a permanent upgrade slowly pays for itself.
- An active player earns about 4 500 Karma a day and a casual one about 220 (`economy.md` §9.2).
- The 7-day market limits are a security control against funnelling Karma from extra accounts into a main one (`economy.md` §10, C24).

The owner then chose (2026-10-31): **permanent levels**, the **first level about two weeks of active play**, and the trade budget **capped**.

On the spec's open questions the owner then narrowed the trade budget: "It should only raise the amount of cards that can be put up for sale at once". So the 7-day market limits are not upgradable at all. The owner also chose to price pack storage against the normal player types, and the page `/shop/upgrades` (2026-10-31).

## Decision

1. **Upgrades are permanent levels bought with Karma.** Each upgrade has a few levels, and each level costs much more than the one before. A bought level is never lost or refunded. Karma is never bought with money and never converted to it (`CLAUDE.md`, unchanged).
2. **The first upgrades** (the spec may propose others under the same rules):
   - **Pack stock:** more timer packs stored while away; today `PACK_CAP` is 3.
   - **Refill:** a shorter pack interval; today `PACK_INTERVAL_MINUTES` is 10.
   - **Listing slots:** more cards on the market at once; today `MARKET_MAX_LISTINGS` is 50 active listings per account.
3. **They cost a grind.** The first level of an upgrade costs about two weeks of an active player's Karma, about 60 000 at today's numbers. Later levels cost roughly twice the level before. The spec derives the exact prices from `economy.md` §9.
4. **Every level stays a sink.** The spec prices each pack-rate level (stock and refill) so it costs more than the extra Karma it can earn its buyer within a year, even at the ceiling player's rate. The economy model in `economy.md` §9 is extended to show the faucet still grows at most linearly, with the bound restated for a fully upgraded account.
5. **Listing slots only; the market's money limits are fixed.**
   - The upgrade raises only the number of active listings.
   - The 7-day window limits (purchases, spending, proceeds), the per-pair limit, the price bounds and the fee are never raised by any upgrade.
   - The multi-account residual of `economy.md` §10 is therefore unchanged at 1.99 times.
6. **Server-authoritative, like every Karma action.**
   - A purchase is one ledger entry through `postEntry`, with a requestId under the existing key rule.
   - The level is stored on the account and read by the pack timer and the market's listing cap.
   - The client never computes a level, an interval, a cap or a limit.
   - The prices and levels are published, like the odds (ADR 0004 §6).

## Consequences

- `ui-designer` writes `docs/design/karma-upgrades.md`, covering the numbers, the API and the page, and amends `economy.md` §5, §9 and §10 where the new levels change them. `mockup-artist` shows the page in variants for the owner to choose from.
- The build is T3, with a security review: a new Karma sink, new per-account limits, and the timer and market reading per-account values.
- Accounts made before this change start at level 0 of every upgrade, which is today's behaviour.
- The future games (blackjack, slots) may offer upgrades too, under the same rules.
