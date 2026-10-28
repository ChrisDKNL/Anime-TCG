# 0004 — In-game economy ground rules

2026-10-28 · accepted (parameters open; see docs/design/economy.md once written)

## Context

Blackjack and slots need stakes, and the owner wants cards to be sellable, tradeable and recyclable. The 2026-10-28 brainstorm fixed these rules.

## Decision

1. **Packs are free and time-gated.** A new pack is granted every N minutes, base N = 10. Packs cannot be bought with currency, directly or indirectly through a shop.
2. **Packs can be won.** Games (blackjack, slots) and future rewards may pay out packs as prizes.
3. **One currency**, in-game only, integer-valued, name to be decided. Earned by selling cards to the system and by winning games. Spent on game wagers, recycling and trading fees (if any), and whatever card-level actions the economy spec defines. **Never** purchasable with real money, never convertible to it (see `CLAUDE.md`).
4. **Three card actions**: _sell_ (card → currency, fixed by rarity), _recycle_ (several cards → one upgraded card or reroll; the crafting sink), _trade_ (card ↔ card between profiles; Phase 1 only between local profiles on the same device, real trading waits for ADR 0003 Phase 2).
5. **The loop must not inflate.** Because packs are a free faucet and selling turns them into currency, the system needs caps and sinks: unclaimed packs accumulate only up to a cap; games have a house edge so the expected currency value of a pack won in a game is below the expected currency wagered to win it; recycling and trading destroy or lock value. The economy spec must show the numbers.
6. **Odds are public.** Every game shows its payout table and house edge in the UI. No near-miss manipulation, no streak or timer nags.
7. **Money-like maths lives in `src/lib/economy/`**, pure and unit-tested, including the RNG seams, and gets `security-officer` review on every change.

## Consequences

- Currency, timers and sell/recycle are a prerequisite for both games and must be specced and built first.
- Numbers (sell prices, cap on stored packs, game payouts) are parameters in one file, so they can be tuned without touching logic.
- Trade is not built until real accounts exist (roadmap item 7 after 8).
