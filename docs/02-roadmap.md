# Roadmap

Status of every feature. The manager updates this; it is the single source of truth for "where are we". Brainstorm notes go at the bottom until they become a row.

Statuses: `idea` → `specced` → `building` → `testing` → `qc` → `security` → `pr` → `shipped`.

| #   | Feature                                     | Status  | Branch / PR                     | Spec                                 | Notes                                                               |
| --- | ------------------------------------------- | ------- | ------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| 0   | Booster packs + local collection            | shipped | `claude/anime-card-game-dapaop` | —                                    | Pre-dates the workflow; no spec                                     |
| 0.1 | Team, gates, CI, ruleset                    | pr      | `claude/anime-card-game-dapaop` | `docs/00`, `docs/01`                 | Needs the one-time admin setup in `docs/01`                         |
| 1   | Local profiles (invite code)                | idea    |                                 | ADR 0003 → `docs/design/accounts.md` | StorageAdapter boundary is the real deliverable                     |
| 2   | Economy: currency, pack timer, sell/recycle | idea    |                                 | ADR 0004 → `docs/design/economy.md`  | Prerequisite for 5 and 6; numbers must be shown not to inflate      |
| 3   | Collection overview                         | idea    |                                 |                                      | Grid, filters, sort, search, completion stats; sell/recycle actions |
| 4   | Profile                                     | idea    |                                 |                                      | Avatar from a card, stats, showcase, balance, next-pack timer       |
| 5   | Blackjack                                   | idea    |                                 |                                      | Wager currency; packs as prize tier; pure engine in `src/lib/`      |
| 6   | Slots                                       | idea    |                                 |                                      | Reel symbols = card art; published paytable                         |
| 7   | Trade between local profiles                | idea    |                                 |                                      | Flow placeholder only; real trading needs ADR 0003 Phase 2          |
| 8   | Third-party sign-in (Google/Discord)        | idea    |                                 | ADR 0003 Phase 2                     | Needs a BaaS decision (new ADR); import of local profiles           |

## Brainstorm seed (2026-10-28)

Questions the first priorities raise, for the session with the owner. Each becomes an ADR or a spec once answered.

### Accounts: the one decision everything else hangs on

The app is 100 % static today: no server, no database, state in `localStorage`. "User accounts" can mean three very different things:

| Option                                      | Cost / effort | Gives you                                                  | Costs you                                                         |
| ------------------------------------------- | ------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| A. Local profiles (no auth)                 | ~1 day        | Multiple named profiles on one device, export/import JSON  | No cross-device sync, no leaderboards, nothing is trustworthy     |
| B. Backend-as-a-service (Supabase/Firebase) | ~1 week       | Real login, sync, server-side truth for currency/ownership | Free-tier limits, a dependency to maintain, GDPR responsibilities |
| C. Own backend                              | weeks         | Full control                                               | Everything                                                        |

Recommendation to argue about: **A now, designed so B is a drop-in later** (a `StorageAdapter` interface with a `localStorage` implementation; the hooks never touch storage directly). Reason: B's main benefit is _trust_ (a balance the client cannot edit), and trust only matters once there is more than one player. For a solo game, B adds an auth flow, a privacy policy and an outage mode for zero gameplay benefit.

### Currency: the hidden prerequisite

Blackjack and slots need something to wager, and packs should probably cost that something, or the games have no stakes. That is a small economy: earn rate (per pack? daily login? selling duplicates?), pack price, table minimums, house edge. It needs its own spec _before_ either game, and the security officer will want integer-only maths and a published payout table.

### Blackjack and slots: what kind of games?

- Pure game logic as a state machine in `src/lib/blackjack.ts` / `src/lib/slots.ts`, unit-tested against the rules, UI on top. Dealer rules (hit soft 17?), split/double/surrender, deck count, and slot paytable are design decisions.
- Tie-in to the collection: card art as slot symbols; a "dealer" chosen from your Legendaries; win a pack instead of coins at some threshold.
- Odds are shown in the UI, no manipulation (no fake near-misses), no timers or streak nags. This is a hobby game, not a slot machine.

### Collection overview and profile: mostly design work

Both are already possible with local state. Open questions: completion tracking (percentage of the 100-character pool? of all AniList? per anime?), sorting/filter model, what a profile shows when there is one user, whether "favourite card" is a thing.

## Decisions from the 2026-10-28 brainstorm

Recorded in ADR 0003 (accounts) and ADR 0004 (economy). In one line each:

- Local profiles first, as a proof of concept; invite code at creation as a flow placeholder.
- Third-party sign-in (Google/Discord, provider-side 2FA) later, behind a storage boundary built now.
- Packs are free, one every 10 minutes (base), never bought with currency; winnable as game prizes.
- Cards can be sold (to the system), recycled (crafting sink) and traded (local profiles only for now).

Owner's answers (same day): starting parameters accepted provisionally (sell 10/50/300, 3 stored packs, 5-to-1 recycle, 3–5 % house edge), to be rebalanced once all mechanics exist; trade deferred until real accounts (item 8); build order **approved**: 1 → 2 → 3 + 4 → 5 → 6, then 7 after 8.
