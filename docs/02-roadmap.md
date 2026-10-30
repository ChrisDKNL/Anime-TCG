# Roadmap

Status of every feature. The manager updates this; it is the single source of truth for "where are we". Since 2026-10-30 feature PRs do not edit the status columns: the manager updates them after each merge in the register-sync docs PR (`docs/security-log/README.md`), so feature PRs never conflict on this table. Brainstorm notes go at the bottom until they become a row.

Statuses: `idea` → `specced` → `building` → `testing` → `qc` → `security` → `pr` → `shipped`.

## Work points

Points estimate how much work and risk a row carries compared with the others; they are not hours. The scale is Fibonacci so that large items stand out and get split before anyone builds them.

| Points | Means                                                                                        | Example                      |
| ------ | -------------------------------------------------------------------------------------------- | ---------------------------- |
| 1      | A docs or config change in one place; CI is the only review                                  | A release note               |
| 2      | A small change in one area, with its tests                                                   | Collection download endpoint |
| 3      | One focused PR, one or two gate rounds                                                       | Landing demo pack            |
| 5      | A feature PR in the UI or the API with the normal test set                                   | Profile                      |
| 8      | A large single PR, or a change with an adversarial suite and a full security review          | Accounts UI (#25)            |
| 13     | Multi-part or T3 server work with concurrency or statistical tests and several review rounds | Accounts API (#23)           |
| 21     | Too big: split into rows of 13 or less before building                                       | —                            |

Points are set when a row is specced and revised when its spec changes. Shipped rows keep their estimate, not the effort they actually took. On 2026-10-29: 68 points shipped, 102 open (superseded and unsized rows not counted).

| #      | Feature                                                                     | Pts | Tier | Status     | Branch / PR                         | Spec                                                                                                | Notes                                                                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------- | --- | ---- | ---------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | Booster packs + local collection                                            | 3   | —    | shipped    | `claude/anime-card-game-dapaop`     | —                                                                                                   | Browser-side proof of concept; pre-dates the gates                                                                                                                                                         |
| 0.1    | Team, gates, CI, ruleset                                                    | 5   | T2   | shipped    | #8                                  | `docs/00`, `docs/01`                                                                                | Five required checks                                                                                                                                                                                       |
| 0.2    | Deployment files (Dockerfile, compose, deploy doc)                          | 5   | T3   | shipped    | #9, #24                             | ADR 0010, `docs/04-deployment.md`                                                                   | #24 pinned every network subnet after the LAN overlap incident                                                                                                                                             |
| 1a     | Backend foundation (Fastify api, sessions, rate limit, CSRF, compose stack) | 13  | T3   | shipped    | #13, #20                            | `docs/design/backend-foundation.md`                                                                 | Accepted by the owner at eda4968 (release 0002)                                                                                                                                                            |
| 1b     | Accounts API                                                                | 13  | T3   | shipped    | #23                                 | `docs/design/accounts-api.md`                                                                       | Merged 2026-10-29                                                                                                                                                                                          |
| 1b-ui  | Accounts UI                                                                 | 8   | T2   | shipped    | #25                                 | `docs/design/accounts.md`                                                                           | Merged 2026-10-29; acceptance ok f032f33 (release 0003)                                                                                                                                                    |
| N      | Navigation, page addresses and landing page                                 | 8   | T3   | shipped    | #30                                 | `docs/design/navigation-and-landing.md`, ADR 0012                                                   | Merged 2026-10-29; demo pack is row D                                                                                                                                                                      |
| 1c     | Server-side collection and packs                                            | 13  | T3   | shipped    | #28                                 | `docs/design/collection-packs.md`, `docs/design/card-and-rarity.md`                                 | Merged 2026-10-29: six tiers, slot floors, pity, Enchanted and Radiant packs, the 60-per-franchise cap; AniList snapshot 2026-10-29, 2,983 characters. QC and security follow-ups on `fix/packs-hardening` |
| 1c-web | Pack page and reveal from the server                                        | 8   | T3   | shipped    | #38                                 | `docs/design/packs-page.md`, `docs/design/collection-packs.md` §8, `docs/design/card-and-rarity.md` | New rarity frames, pity counter, CSP `connect-src` narrows; first production release follows                                                                                                               |
| D      | Landing page demo pack                                                      | 3   | T3   | shipped    | #42                                 | `docs/design/navigation-and-landing.md` §3.7                                                        | Public, rate-limited, stores nothing; after 1c                                                                                                                                                             |
| P      | First production release (Sprint 1)                                         | 3   | T3   | idea       |                                     | `docs/03-release-process.md`                                                                        | Tag, deploy on `PRODUCTION_PORT=8190`, switch the Caddy block                                                                                                                                              |
| 3      | Collection overview                                                         | 8   | T1   | shipped    | #41                                 | `docs/design/collection-overview.md`, `docs/design/card-and-rarity.md`                              | Card dialog details-only; recycle and market sections come with the economy UI PRs                                                                                                                         |
| 2      | Economy: Karma ledger, duplicate recycling, pack shop                       | 13  | T3   | building   | #40 (server), #51 (UI); market next | `docs/design/economy.md`, ADR 0011, ADR 0013                                                        | Server (#40) and UI (#51) shipped: ledger, recycling, genre shop, wallet; market (PR 3 server, PR 4 UI) remains                                                                                            |
| 2-ui   | Economy UI: wallet, Recycle for Karma, Shop page                            | 5   | T2   | specced    |                                     | `docs/design/market-and-shop.md`                                                                    |                                                                                                                                                                                                            |
| M      | Player market                                                               | 13  | T3   | specced    |                                     | `docs/design/economy.md`, `docs/design/market-and-shop.md`                                          | Anti-farming limits per 7 days                                                                                                                                                                             |
| M-ui   | Market UI                                                                   | 8   | T2   | specced    |                                     | `docs/design/market-and-shop.md`                                                                    |                                                                                                                                                                                                            |
| 4      | Profile                                                                     | 5   | T1   | idea       |                                     |                                                                                                     | Linked from the Account menu once it ships                                                                                                                                                                 |
| 5      | Blackjack                                                                   | 13  | T3   | idea       |                                     |                                                                                                     | Card antes can win tier upgrades (ADR 0011); statistical odds tests                                                                                                                                        |
| 6      | Slots                                                                       | 8   | T3   | idea       |                                     |                                                                                                     | Published paytable                                                                                                                                                                                         |
| 8      | Third-party sign-in (Google/Discord)                                        | 13  | T3   | idea       |                                     | ADR 0003 Phase 2                                                                                    | Needs its own ADR                                                                                                                                                                                          |
| 9      | Collection download (read-only endpoint)                                    | 2   | T2   | idea       |                                     |                                                                                                     | Owner: later                                                                                                                                                                                               |
| R      | Masterwork card variants and Relics                                         | ?   | —    | idea       |                                     | ADR 0011                                                                                            | Reserved in the data model; not sized until designed                                                                                                                                                       |
| 7      | Trade between local profiles                                                | —   | —    | superseded |                                     |                                                                                                     | Replaced by the player market (row M, ADR 0011)                                                                                                                                                            |

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

### Sprint 1 (replanned 2026-10-28, same day)

Original plan (local accounts PoC) superseded by ADR 0008: the owner wants all state server-side and protected from client manipulation. Sprint 1 is now **1a backend foundation → 1b server-side accounts → 1c server-side collection and packs**. The game is playable end to end again only at the end of 1c. Release per `docs/03-release-process.md` when all three are merged. Stack confirmed by the owner (ADR 0009 accepted).
