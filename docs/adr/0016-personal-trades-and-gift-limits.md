# 0016 — Personal trades and gift limits

2026-10-31 · accepted · amends ADR 0011 §3 (trade between accounts is no longer the market only); ADR 0011 otherwise stands. Numbered after ADR 0014 (PR #64) and ADR 0015 (Karma upgrades).

## Context

Today the market is the only way cards and Karma move between accounts (ADR 0011 §3, `economy.md` §10). Unfair sales are bounded by the price bounds (0.5× to 2.5× a tier's reference value) and by the 7-day window limits (C24). The owner wants player-to-player trades beyond the market, with a tracked amount of gifts: "There will be a tracked amount of gifts from player to player, unfair trades have an upper limit that prevent trading when the limit is reached. This is purely player to player and includes market trades as well as personal trades" (2026-10-31).

Personal trades do not exist yet; the old local-profile trade row is superseded. The owner answered four questions the same day. The recommended option was chosen each time.

## Decision

1. **Personal trades.** Two accounts can trade directly. One proposes an offer of cards and/or Karma for cards and/or Karma, and the other accepts or declines. The server settles the whole trade at once, or not at all.
2. **Gift value.**
   - Every player-to-player transfer has a gift value: the part of the value difference between the two sides that lies **beyond a fair band** around the fair value. Market purchases and personal trades both count.
   - Fair value comes from the tiers' published reference values.
   - A trade inside the band has a gift value of zero, so normal haggling never touches the limits.
   - The spec sets the band (about 25 %) and the exact formula, including how a pure gift counts (something given for nothing).
3. **Two limits, both on gifts received.** The per-receiver limit stops several accounts each gifting a little into one main account.
   - **per pair:** what A gives B;
   - **per receiver:** what B receives from everyone together.
4. **Rolling 30 days.** A gift counts against the limits for 30 days after the transfer.
5. **At a limit, only unfair trades are blocked.** A trade or purchase that would push the pair or the receiver over a limit is refused before anything moves, with a reason the client can show. Fair trades between the same players still go through.
6. **The existing controls stay.**
   - The market's price bounds, fee and 7-day window limits (C24) are unchanged.
   - Karma moved by a personal trade counts against the same 7-day spend and receipt windows as a market purchase, so personal trades never become an uncapped channel.
   - No Karma upgrade raises the gift limits or the market's money limits (ADR 0015 §5: the market upgrade is listing slots only).
7. **Server-authoritative.**
   - Gift values and limit checks are computed only on the server, inside the settling transaction, under the same locking as the market (C24).
   - The client never computes a gift value or a limit.
   - The limits and the band are published.
   - Each settled transfer records its gift value, so it can be audited (`audit-market`).

## Consequences

- `ui-designer` writes `docs/design/personal-trades.md`, covering the trade flow, the gift formula and its numbers, the API, the pages and the test plan. The spec lists its `economy.md` §10 amendments as edits for the register-sync PR; it does not edit `economy.md` directly, because the Karma upgrades spec is amending it at the same time. `mockup-artist` then shows the trade screens.
- The market's buy path gains the gift check. That is a change to a T3 money path and needs a security review. Personal trades are a new T3 feature with their own review.
- Fair value per tier, not per character, is a known simplification. A popular character may sell above its tier's value. The fair band absorbs part of that. The spec states what remains.
