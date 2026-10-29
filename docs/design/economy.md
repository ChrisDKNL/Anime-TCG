# Economy (roadmap item 2, server side)

Manager-written technical spec: the rules, the numbers and the API for Karma, the player market, the Karma pack shop and recycling. §12 lists what the UI needs; its visual design is `ui-designer`'s. Implements ADR 0004 (economy ground rules) as amended by ADR 0008 §6 (the maths lives in the API's domain layer) and ADR 0011 (the owner's 2026-10-29 decisions), on the data model of `collection-packs.md` (1c, five tiers), which must be merged first. Security tier **T3** (currency, ledger, trades between accounts). `security-officer` review and an adversarial test pass are required before each PR opens; a T3 change never merges on the day it is opened unless the owner says so.

Written 2026-10-29; revised twice the same day for the owner's decisions (§16), the second time for five tiers.

## 1. Goal

Players earn **Karma**, the one in-game currency, by opening their free packs, and spend it on themed packs in the Karma shop, on recycle fees, and on other players' cards. Any card, the last copy included, can be listed on a **player market** at a price its owner sets within published bounds; another player buys it with Karma. Five copies of one character recycle into one random character of the next tier, up to Mythic. The server decides every price bound, fee and outcome; every Karma change is a ledger row written in the same transaction as the cards it pays for (C11). The model (§9) shows the faucet, the sinks and the bound on growth for the five tiers, and §10 the controls against one person farming Karma across several accounts. The ledger is the one blackjack and slots will write to. No real money anywhere, ever.

## 2. Out of scope

- The free pack timer: shipped by 1c (`collection-packs.md` §5.2) and unchanged here, except that each timer pack now also grants Karma (§6, §8.2).
- Blackjack and slots (items 5, 6) and the packs they pay out. §8.11 says what they add.
- Card-for-card trades (roadmap item 7). The market is cards for Karma.
- Selling to the game. The owner chose the player market (round 1, decision 6); there is no buyback at any price (§6 explains why it is not the faucet either).
- **Masterwork cards and Relics** (reserved by the owner, `collection-packs.md` §2). Neither is designed: no value, fee, recycle rule or market rule exists for them. This spec reserves only what lets them join the market later without a breaking migration (`item_kind` and `variant` on listings, `kind` and `variant` in the contract); every rule below applies to `kind: "card"`, `variant: "standard"` and to nothing else until a spec says otherwise.
- The collection overview's screen (item 3); the profile and a player-facing Karma history (item 4).
- Prices that change at runtime. Reference values, bounds, fees and shop prices change by a deploy that changes §5 and this spec. Market prices are the players'.
- Anything bought with real money (ADR 0004 §3, `CLAUDE.md`).

## 3. Delivery

Four pull requests, after both 1c PRs, in order, each through the full gate, **all T3**:

1. **`feat/economy`** (server): the ledger and the balance, the Karma grant on timer packs, the Karma shop with its themes, recycle, `GET /api/wallet`, the collection answer's additions, the reset's Karma rule, the owner commands `audit-ledger` and `pack-themes`; migration, `api/src/domain/economy/`, routes under `api/src/routes/wallet/`, `api/src/routes/shop/` and `api/src/routes/collection/`, shared schemas and parameters, tests, docs. T3: currency, ledger, pack grants, RNG.
2. **`feat/economy-ui`**: the balance, the shop and recycle in the web app, after `ui-designer`'s UI spec (gate step 1). T3: it drives currency-spending actions and their idempotency keys, on top of T1 for third-party strings.
3. **`feat/market`** (server): listings, buying, cancel, expiry, the anti-farming limits, `audit-market`, and the reset's listing rule. T3: Karma and cards move between accounts, which is a new trust boundary.
4. **`feat/market-ui`**: browse, filter, list, buy, cancel, after `ui-designer`'s UI spec. T3, as PR 2.

Why this order: the ledger, the faucet and the main sink must exist before Karma can move between accounts, and PRs 1 and 2 already give a playable economy (earn, spend in the shop, recycle). The market adds the riskiest part, the trust boundary between accounts, in a review of its own. An economy nobody can use cannot be accepted by the owner, so each server PR is followed by its UI.

**Where the card dialog comes from** (open question 11). Recycling (PR 2) and listing (PR 4) start from a collection entry's card dialog, which `collection-overview.md` (roadmap item 3) designs, while the roadmap puts item 2 before item 3. Built as recommended: the overview is built right after 1c with the dialog showing details only, and each economy UI PR adds its own section (Recycle in PR 2, List on the market in PR 4). The UI layout of the balance, the shop and the market is `market-and-shop.md`.

## 4. Ground rules

ADR 0004 as amended by ADR 0008 §6 and ADR 0011, rule by rule, and what holds each one here.

| Rule                                                                                                                    | How this spec holds it                                                                                                                                                                                     | Proven by                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| No real money, anywhere, ever (ADR 0004 §3, `CLAUDE.md`)                                                                | No payment provider or SDK, no route that takes or quotes real money, no premium currency, no cash-out. Karma is never converted to anything outside the game or exported                                  | `security-officer` manifest check on every PR; the route inventory test (§14)              |
| The free pack is time-gated (ADR 0004 §1); packs may also be bought with Karma, never with money (ADR 0011 §1)          | `packs_anchor_at` is written only by the timer opening path; the shop's packs never touch it; the only route that debits Karma and deals a pack is `POST /api/shop/buy`                                    | Adversarial: a shop purchase leaves the allowance unchanged; an empty balance buys nothing |
| One currency, integer-valued, named Karma (ADR 0004 §3, ADR 0011 §2)                                                    | `integer` columns, bounded amounts (§5), no float anywhere in `domain/economy/`; the name is one line of copy                                                                                              | Unit and overflow tests                                                                    |
| Earned by opening free packs (and later by winning); spent in the shop, on fees, on the market, on wagers (ADR 0011 §2) | Credits: `pack_grant`, `market_sale`. Debits: `shop_purchase`, `market_purchase`, `market_fee`, `recycle_fee`, `owner_reset`. Items 5 and 6 add `wager` and `payout`. Nothing else exists in `ledger_kind` | Schema; route inventory                                                                    |
| Cards for Karma between server accounts on a player market; any card, the last copy included (ADR 0011 §3)              | §8.3 to §8.5                                                                                                                                                                                               | Route and concurrency tests                                                                |
| Recycle: several cards into one upgraded card (ADR 0004 §4)                                                             | Five copies of one character into one random character of the next tier, with a fee, for each of the four steps (§8.7)                                                                                     | Route and statistical tests                                                                |
| The loop must not inflate (ADR 0004 §5)                                                                                 | §9                                                                                                                                                                                                         | A unit test recomputes §9 from the parameters                                              |
| Odds are public (ADR 0004 §6)                                                                                           | Shop packs publish their per-slot and per-pack odds and tier sizes, recycle its output tier sizes; fees, bounds and limits are in `GET /api/wallet`                                                        | Route test; e2e                                                                            |
| Money-like maths in the API's domain layer, reviewed on every change (ADR 0004 §7 as amended by ADR 0008 §6)            | `api/src/domain/economy/` and `api/src/domain/market/`, pure functions, unit-tested; the web app only displays                                                                                             | Gate step 5 on every economy PR                                                            |

The first draft's rule "currency never moves between accounts" is reversed by the owner (round 1, decision 6, ADR 0011 §3). What replaces its protection is §10.

## 5. Parameters (`shared/src/economy.ts`)

All tunable numbers, in the one file ADR 0004 asks for; 1c put the pack numbers there. They are rebalanced once all mechanics exist.

| Name                      | Value                                                        | Why                                                                                                                                |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `REFERENCE_VALUE`         | common 10, rare 12, epic 140, legendary 1 300, mythic 8 000  | inversely proportional to how often the tier fills a slot, anchored at Common 10 (§5.1); the yardstick for bounds, fees, the model |
| `PACK_KARMA_GRANT`        | 20                                                           | Karma per free timer pack opened (§6): about a seventh of a pack's reference value                                                 |
| `THEMED_PACK_PRICE`       | 200                                                          | one themed pack: ten free packs' grants, about 1.5 times its cards' reference value (131.42, §9.1)                                 |
| `MARKET_PRICE_MIN`        | common 5, rare 6, epic 70, legendary 650, mythic 4 000       | half the reference value                                                                                                           |
| `MARKET_PRICE_MAX`        | common 25, rare 30, epic 350, legendary 3 250, mythic 20 000 | two and a half times the reference value                                                                                           |
| `MARKET_FEE_BPS`          | 1 000                                                        | 10 % of the price, rounded up, at least 1, paid by the seller and destroyed                                                        |
| `MARKET_LISTING_TTL`      | 7 days                                                       | an unsold listing expires and its card is available again                                                                          |
| `MARKET_MAX_LISTINGS`     | 50                                                           | active listings per account                                                                                                        |
| `MARKET_WINDOW`           | 7 days, rolling                                              | the window of the four limits below; a day is too short to buy one Mythic near the cap (§10)                                       |
| `MARKET_WINDOW_PURCHASES` | 100                                                          | purchases per buyer per window                                                                                                     |
| `MARKET_WINDOW_SPEND`     | 25 000                                                       | Karma a buyer spends on the market per window; at least one Mythic at the cap                                                      |
| `MARKET_WINDOW_PROCEEDS`  | 25 000                                                       | Karma (gross) a seller receives from the market per window                                                                         |
| `MARKET_WINDOW_PAIR`      | 12 500                                                       | Karma one buyer pays one seller per window                                                                                         |
| `MARKET_PAGE_SIZE`        | 50                                                           | listings per browse page                                                                                                           |
| `RECYCLE_INPUT`           | 5                                                            | the owner's 5-to-1                                                                                                                 |
| `RECYCLE_FEE`             | common 10, rare 110, epic 1 000, legendary 6 100             | the fee to recycle five copies of that tier into the next (§8.7); Mythic has no tier above and cannot be recycled                  |
| `MAX_ENTRY_AMOUNT`        | 1 000 000                                                    | the largest single ledger amount, credit or debit, games included (`owner_reset` excepted, §7)                                     |
| `MAX_BALANCE`             | 1 000 000 000                                                | keeps every sum inside a Postgres `integer` (2 147 483 647)                                                                        |
| `HOUSE_EDGE`              | 300 to 500 per 10 000                                        | the owner's 3–5 %; the range items 5 and 6 must land in                                                                            |
| `PRIZE_PACK_VALUE`        | 200                                                          | a prize pack's value in the games' house-edge check: what the shop charges for one                                                 |

Invariants, each a unit test over the file and 1c's `SLOT_ODDS`: every value is a positive safe integer; `REFERENCE_VALUE` and `RECYCLE_FEE` rise with the tier; `MARKET_PRICE_MIN[r] ≤ REFERENCE_VALUE[r] ≤ MARKET_PRICE_MAX[r]`; for each recyclable `r`, the three fee rules of §8.7 (`5 × REFERENCE_VALUE[r] + RECYCLE_FEE[r] ≥ 1.2 × REFERENCE_VALUE[next(r)]`, `RECYCLE_FEE[r] ≥ PACK_KARMA_GRANT × ODDS_SCALE / (PACK_SIZE × SLOT_ODDS[next(r)])`, `5 × MARKET_PRICE_MIN[r] + RECYCLE_FEE[r] > MARKET_PRICE_MIN[next(r)]`); `fee(MARKET_PRICE_MIN.common) ≥ 1`; `THEMED_PACK_PRICE ≥` a pack's expected reference value; `MARKET_PRICE_MAX.mythic ≤ MARKET_WINDOW_SPEND`; `MARKET_WINDOW_PAIR ≤ MARKET_WINDOW_PROCEEDS`; `MAX_BALANCE + MAX_ENTRY_AMOUNT ≤ 2^31 − 1`. `CURRENCY_NAME = "Karma"` is not here: the API never sends the name (§12).

### 5.1 Reference values for five tiers

The owner's provisional values (Common 10, Rare 50, Legendary 300) were set for the old odds (70 / 25 / 5 % per slot). With the five-tier odds of `collection-packs.md` §5.4 (Common 52.51 %, Rare 43.22 %, Epic 3.80 %, Legendary 0.403 %, Mythic 0.0661 % per slot) the arithmetic no longer supports two of them:

- **Rare at 50** would value a card that fills 43 % of slots (two in every pack) five times a Common that fills 53 %. The market floor at half the reference (25) would sit above anything abundant Rares can fetch, so Rares could not be sold at all, and five Rares (250) would be worth more than the Epic they recycle into.
- **Legendary at 300** would value a card that appears once in 50 packs at the Karma of 15 free packs, and five Epics would again be worth more than the Legendary they make.

So the reference value of a tier is **inversely proportional to how often it fills a slot, anchored at Common 10** (`10 × p_common / p_tier`: 10, 12.1, 138, 1 302, 7 944), rounded to 10, 12, 140, 1 300 and 8 000. Every tier then contributes about the same to a pack's value (5.25 to 5.32 per slot), Epic sits between Rare and Legendary, and Mythic is about six times a Legendary, as its odds are. Open question 8 offers the owner's anchors kept instead.

## 6. Sources of Karma (the faucet)

With no buyback, a market sale only moves Karma from one player to another, minus the fee. Until blackjack and slots exist, nothing would create Karma, and the shop could never be used. The economy needs one faucet. Options:

| Option                                          | What it is                                                                      | Against it                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Starting grant                               | e.g. 500 Karma at registration                                                  | One-off: once spent, the shop is dead again for everyone. Every invite becomes a bag of Karma to funnel to a main account (§10). Karma with no play behind it                                                          |
| **B. Grant per free pack opened (recommended)** | `PACK_KARMA_GRANT` = 20 Karma credited in the transaction of each timer opening | A small, steady income only                                                                                                                                                                                            |
| C. Game buyback floor                           | the game buys any card at 40 % of its reference value, below market prices      | Reverses the owner's choice of a player market over selling to the game (round 1, decision 6); every pack becomes guaranteed Karma, the first draft's faucet; sets an effective price floor the market must stay above |
| D. Daily grant                                  | e.g. 200 Karma on the first visit of each day                                   | A login reward is the "come back" nag ADR 0004 §6 rules out, and it rewards visiting, not playing                                                                                                                      |

**B is built.** It ties Karma to the one thing already bounded per account, the pack timer: at most 144 timer packs a day, so at most 2 880 Karma a day per account, whatever the account holds. It adds no new reason to come back (the timer already is one), a new account earns from its first three packs, and an account farmed for Karma earns exactly what it would earn playing. Only timer packs grant: a shop pack or a prize pack granting Karma would hand back part of its price and add a second, balance-dependent faucet. Open question 1.

## 7. Data model

```
accounts (1b, 1c) gains
  balance             integer not null default 0     -- check (balance between 0 and MAX_BALANCE)

ledger_entries                                       -- one row per balance change; never updated or deleted
  id                  uuid pk default gen_random_uuid()
  account_id          uuid not null references accounts(id) on delete cascade
  seq                 integer not null               -- 1, 2, 3 ... per account, assigned under the account lock
  kind                ledger_kind not null           -- enum: pack_grant, shop_purchase, recycle_fee, market_purchase,
                                                     --       market_sale, market_fee, owner_reset (items 5, 6 add theirs)
  amount              integer not null               -- signed: a credit > 0, a debit < 0
                                                     -- check (amount <> 0 and (abs(amount) <= MAX_ENTRY_AMOUNT or kind = 'owner_reset'))
  balance_after       integer not null               -- check (balance_after between 0 and MAX_BALANCE)
  created_at          timestamptz not null
  unique (account_id, seq)
  index (account_id, kind, created_at)               -- the rolling-window limits (§10)

pack_themes                                          -- the shop's packs; managed by the owner (§13.2)
  id                  text pk                        -- a slug: 'genre-action', 'franchise-attack-on-titan'
  title               text not null                  -- the owner's, 1 to 60 characters
  kind                text not null                  -- 'genre' or 'franchise'
  genre               text null                      -- kind 'genre': an AniList genre
  anchor_series_id    integer null                   -- kind 'franchise': any AniList entry of the franchise
  enabled             boolean not null
  created_at          timestamptz not null

pack_openings (1c) gains
  source              opening_source not null default 'timer'   -- enum: timer, shop (items 5, 6 add prize)
  theme_id            text null references pack_themes(id)
  ledger_entry_id     uuid null unique references ledger_entries(id)  -- the grant (timer) or the price (shop)
  check ((source = 'shop') = (theme_id is not null))
  check (source <> 'shop' or ledger_entry_id is not null)

recycles                                             -- one row per recycle: the idempotency record and the receipt
  id                  uuid pk default gen_random_uuid()
  account_id          uuid not null references accounts(id) on delete cascade
  request_id          uuid not null
  request_hash        text not null                  -- SHA-256 of the canonical body (§8.8)
  character_id        integer not null references characters(id)   -- the input character
  from_rarity         rarity not null                -- common .. legendary
  ledger_entry_id     uuid not null unique references ledger_entries(id)   -- the fee
  created_at          timestamptz not null
  unique (account_id, request_id)

market_listings
  id                  uuid pk default gen_random_uuid()   -- public: the market names listings by it
  seller_id           uuid not null references accounts(id) on delete cascade
  request_id          uuid not null
  item_kind           item_kind not null default 'card'  -- reserved: 'relic' later, with its own nullable reference
  card_id             uuid null references cards(id) on delete set null   -- the listed card; null only after an owner reset
  character_id        integer not null references characters(id)
  rarity              rarity not null                -- the card's granted rarity, copied
  variant             card_variant not null default 'standard'   -- the card's, copied; reserved for Masterwork
  price               integer not null               -- check (price between 1 and MAX_ENTRY_AMOUNT); bounds per rarity in the domain
  fee                 integer not null               -- fee(price), fixed at listing time
  status              listing_status not null        -- enum: active, sold, cancelled, expired
  created_at          timestamptz not null
  expires_at          timestamptz not null           -- created_at + MARKET_LISTING_TTL
  closed_at           timestamptz null
  unique (seller_id, request_id)
  unique index (card_id) where status = 'active'     -- a card is listed at most once
  index (rarity, price, id) where status = 'active'; index (character_id) where status = 'active'; index (seller_id, status)

market_purchases                                     -- one row per purchase: the buyer's receipt and idempotency record
  id                  uuid pk default gen_random_uuid()
  buyer_id            uuid not null references accounts(id) on delete cascade
  request_id          uuid not null
  listing_id          uuid null unique references market_listings(id) on delete set null   -- sold once
  seller_id           uuid null references accounts(id) on delete set null
  character_id        integer not null references characters(id)
  rarity              rarity not null
  variant             card_variant not null
  price               integer not null
  fee                 integer not null
  buyer_entry_id      uuid not null unique references ledger_entries(id)
  seller_sale_entry_id uuid null references ledger_entries(id) on delete set null
  seller_fee_entry_id uuid null references ledger_entries(id) on delete set null
  created_at          timestamptz not null
  unique (buyer_id, request_id)
  index (seller_id, created_at); index (buyer_id, created_at)

cards (1c) gains
  removed_at          timestamptz null               -- null while held; set when sold or recycled
  removed_by_purchase uuid null references market_purchases(id) on delete set null
  removed_by_recycle  uuid null references recycles(id)
  recycle_id          uuid null references recycles(id)          -- set on the card a recycle produced
  purchase_id         uuid null references market_purchases(id)  -- set on the card a purchase delivered
  -- opening_id and slot become nullable: a recycled or bought card has neither
  check (num_nonnulls(opening_id, recycle_id, purchase_id) = 1)
  check ((opening_id is null) = (slot is null))
  check (removed_at is not null or (removed_by_purchase is null and removed_by_recycle is null))
  index (account_id, character_id, rarity, variant) where removed_at is null    -- replaces 1c's index

characters (1c) gains
  search_name         text not null                  -- the overview's normalisation (§8.4) of name, written by snapshot-pool
  search_name_native  text null                      -- the same of name_native

series (1c) gains
  search_title        text not null                  -- the same of title
  search_title_native text null                      -- the same of title_native
```

Rules:

- **The balance is a column; the ledger is its proof.** Reading a balance is one row, the row that is locked anyway; the ledger is the history and the audit. Invariants: `balance` = Σ `amount` = the newest `balance_after`; `seq` runs 1, 2, 3 … with no gap; every shop opening, recycle and purchase has its entries, each of the right account and sign; a sold listing has exactly one purchase, and its buyer's debit, the seller's credit and the seller's fee equal its price and fee. `balance_after` and the gapless `seq` make a missing, extra or altered row visible to `audit-ledger` (§13.1).
- **Append-only, enforced by the database too.** The migration revokes `UPDATE` and `DELETE` on `ledger_entries`, `recycles` and `market_purchases` from `anime_app`. Postgres runs referential actions with the table owner's rights, so deleting an account still cascades and still sets the other side's references to null; a route test proves both halves. `market_listings` keeps `UPDATE` for its status.
- **Checks are a backstop.** The domain checks every bound first and answers with a typed error; a database check that fires means a bug, and it fails the transaction instead of writing a negative balance.
- **Held** means `removed_at is null`; **available** means held and not the card of an active listing. 1c's collection queries, `AccountPublic.cards`, an opening's `isNew` and completion count held cards, listed ones included (a listed card is still owned until it is sold). Listing and recycling take available cards only. Removed cards stay as rows, so the sale or recycle that took them can be audited and a replayed opening still returns what it dealt.
- **A bought card is a new row.** The seller's card is marked removed and the buyer gets a new card with the same character, the same granted rarity, the same variant and the same `snapshot_id`, pointing at the buyer's purchase. Rows never change owner, so deleting the seller's account (which cascades through the seller's openings) can never delete a card a buyer holds.
- **Reserved, not built**: `item_kind` and `variant` on listings and purchases are always `card` and `standard` in item 2; every route refuses anything else by schema (§11.2).
- **Deleting an account** removes its ledger, listings, recycles and purchases with it (cascade); the other party's purchase rows keep their own entries and lose only the reference.
- Migration: the next file after 1c's. The four search columns are backfilled for existing rows by the migration, with the same normalisation function (in `shared/`, used by the overview's search too) that `snapshot-pool` uses from then on.

## 8. Behaviour

### 8.1 Balance and ledger

Every balance change runs the same steps inside the transaction of the thing it pays for, after the account row is locked: compute the new balance; refuse with a typed error if it would leave `0 .. MAX_BALANCE`; insert the ledger row with `seq` = previous + 1 and `balance_after`; update `accounts.balance`. One function in `domain/economy/` does this, and it is the only code that writes `accounts.balance` or `ledger_entries`. New accounts start at 0.

### 8.2 Karma grant on a timer pack

1c's opening (`collection-packs.md` §5.3) gains one step before the commit: credit `min(PACK_KARMA_GRANT, MAX_BALANCE − balance)` as a `pack_grant` entry and store its id on the opening. At the balance limit the grant is 0, no row is written and the opening still succeeds: the pack is the player's, the Karma is the extra. A replayed opening returns the grant it recorded and writes nothing. Shop packs and (later) prize packs grant nothing.

### 8.3 Listing a card

`POST /api/market/listings` with a character, a rarity and a price:

1. The schema bounds the body (§11.2); the domain checks `MARKET_PRICE_MIN[rarity] ≤ price ≤ MARKET_PRICE_MAX[rarity]` → else 400 `price_out_of_bounds`.
2. Lock the account row; handle a replay (§8.8).
3. Active listings ≥ `MARKET_MAX_LISTINGS` → 409 `listing_limit`.
4. Select the account's available `standard` cards of that (character, rarity), newest first, `FOR UPDATE`, and take the first. None → 409 `not_enough_copies`. A group the account does not hold has no cards, so naming another account's cards fails the same way.
5. Insert the listing (`fee` = `fee(price)`, `expires_at` = now + `MARKET_LISTING_TTL`), answer 201 with it.

No Karma moves at listing time. **Any card can be listed, the last copy included** (round 1, decision 6): the confirmation in the UI says so, the server does not hold one back. One listing is one card; listing several copies is several listings. The partial unique index on `card_id` is the backstop against listing one card twice.

### 8.4 Browsing the market

`GET /api/market/listings` returns active, unexpired listings of every account, the caller's own marked `mine: true`. Query parameters, each optional and schema-checked (unknown ones → 400): `rarity`; `franchiseId` (characters with a membership in that franchise, current or last snapshot); `characterId`; `q` (1 to 100 characters: every space-separated term, normalised as `collection-overview.md` §3.3 normalises, must be a substring of at least one of the character's name, its native name, and the title or native title of any entry of its franchises, so a native-script query such as `進撃` finds the same cards here as in the collection; terms are matched as escaped `LIKE` patterns, never as SQL); `sort` = `price_asc` (default), `price_desc` or `newest`; `cursor` (opaque, from the previous page). Keyset pagination on (sort key, id), `MARKET_PAGE_SIZE` per page. A listing past `expires_at` is never returned, whether or not the hourly purge has marked it yet.

The first page (no `cursor`) also carries `filterFranchiseIds`: every franchise with at least one active, unexpired listing, whatever the other parameters, in franchise popularity order, with their lookups in `franchises`, so the franchise filter offers what the market holds, not only what one page shows. Later pages carry `null`.

`GET /api/market/mine` returns the caller's active listings (unexpired only, as browsing; a listing past `expires_at` appears under `closed` as `expired`, purged or not), its listings closed in the last 30 days (sold, cancelled, expired, with the net proceeds of a sale and `closedAt`, which for an unpurged expired listing is its `expires_at`), its purchases of the last 30 days, and what its window limits have left (§10).

### 8.5 Buying, cancelling and expiry

`POST /api/market/listings/{listingId}/buy` with a `requestId` and nothing else. The price is the listing's, held by the server; a body carrying a price, an amount or a character is an unknown field (400). All or nothing, one transaction:

1. Replay: if the buyer already has a purchase with this `requestId`, answer 200 with its receipt (receipts never change). If that purchase was of another listing → 409 `request_id_reused`.
2. Read the listing's `seller_id` (unlocked; it never changes). No such listing → 404 `listing_not_found`. Seller = buyer → 409 `own_listing`.
3. **Lock both account rows in ascending id order** (`SELECT ... FROM accounts WHERE id IN (buyer, seller) ORDER BY id FOR UPDATE`). No buyer row → 401. Re-check the replay of step 1 (a parallel request with the same key may have committed while this one waited).
4. Lock the listing row. Not `active`, or `expires_at ≤ now` → 409 `listing_unavailable`.
5. Lock the listed card row; it must still be held by the seller (a backstop; a bug otherwise, 500 and rollback).
6. Limits (§10): the buyer's purchases and spend, the seller's proceeds and the pair's total over the last `MARKET_WINDOW`, each including this purchase → 409 `market_limit` with `limit` (the first one hit, checked in the order `buyer_purchases`, `buyer_spend`, `seller_proceeds`, `pair`) and `retryAfterSeconds` (when enough of that limit's oldest counted entries leave the window for this purchase to fit).
7. The buyer's balance below the price → 409 `insufficient_funds` with the buyer's `balance`. The seller's balance + price − fee above `MAX_BALANCE` → 409 `listing_unavailable` (the buyer cannot resolve it; the seller sees it in `mine`).
8. Write: the buyer's `market_purchase` (− price); the seller's `market_sale` (+ price) and `market_fee` (− fee); the purchase row; the seller's card removed by the purchase; the buyer's new card (same character, granted rarity, variant and snapshot, `purchase_id`, `pulled_at` = now, `isNew` for the buyer); the listing `sold`. Commit, answer 201 with the receipt, the new card and the buyer's balance.

The lock order is the one of §8.9. Two buyers of one listing serialise on the seller's account row (and then on the listing): the second finds it `sold` and gets 409 `listing_unavailable`. `unique (listing_id)` on purchases is the backstop.

**Cancel and expiry**

- `POST /api/market/listings/{listingId}/cancel` (empty body): lock the caller's account, then the listing. Another account's listing, or none → 404 `listing_not_found` (an existing listing of someone else is not revealed as such). Already cancelled or expired → 200 with its state (cancel is idempotent). Sold → 409 `listing_unavailable`. Otherwise status `cancelled`, `closed_at` = now, answer 200. The card is available again at once.
- **Expiry** is a property of time: every query treats `expires_at ≤ now` as expired, so a listing can never be bought one second late. The hourly purge the accounts plugin already runs also marks those rows `expired` (one `UPDATE` on listing rows only; it takes no account lock, so it cannot deadlock with a purchase, which takes accounts first).
- **A listed card cannot be recycled** (it is not available) and cannot be listed again until its listing closes.

### 8.6 The Karma shop

Themed packs, bought with Karma (round 1, decision 7), beside the free timer pack, which does not change.

- **Themes** are rows of `pack_themes`, managed by the owner with `pack-themes` (§13.2). A theme's character set is computed against the current snapshot: kind `genre`, every character with a membership in a current entry whose `genres` contain the genre; kind `franchise`, every character of the franchise that contains `anchor_series_id` (`collection-packs.md` §5.1.2). So "a pack per anime or per genre" is the owner's choice of rows.
- **Eligible** means each of the five tiers of the theme's set holds at least `PACK_SIZE` characters, so the pack draws exactly like the free pack. With Mythic at 1 % of the pool, a theme needs about 500 characters spread like the pool to have five Mythics: every large genre qualifies, and only the biggest franchises do (open question 7). A theme is **offered** when it is enabled and eligible against the current snapshot; `pack-themes` refuses to enable an ineligible theme, and a snapshot update that makes a theme ineligible takes it out of the shop at once (and `snapshot-pool` lists it).
- **Odds**: the same `SLOT_ODDS` per slot as the free pack, so the same per-pack figures (Rare 94.1 %, Epic 17.6 %, Legendary 2 %, Mythic 0.33 % at least once); the character is drawn uniformly within the tier from the theme's set, no repeats in a pack. Published per theme: `cards` (`PACK_SIZE`), `perSlot`, `perPack`, the theme's `tierSizes`, and `franchiseIds`, the franchises its set draws from, computed against the current snapshot for both kinds (one for a franchise theme; every franchise with a character in the set for a genre theme, possibly 40 or more), in franchise popularity order. A themed pack changes which characters come, not how rare they are.
- **Price**: `THEMED_PACK_PRICE` for every theme, a fixed number (open question 6).
- **Purchase**, `POST /api/shop/buy` with a `requestId` and a `themeId`, one transaction: lock the account; replay (§8.8); the theme offered → else 404 `theme_unavailable`; no snapshot → 503 `pool_unavailable`; balance below the price → 409 `insufficient_funds`; debit the price (`shop_purchase`); run 1c's `dealPack` with the theme's set, writing the opening (`source = 'shop'`, the theme, the entry); commit; answer 201 with the opened pack and the balance. The allowance is not read or written. The same code deals the free pack and the themed pack.
- Players may buy as many themed packs as their Karma pays for: the faucet bounds them (§9).

### 8.7 Recycle

`POST /api/collection/recycle` with a character and a rarity (`common`, `rare`, `epic` or `legendary`): **five copies of that character at that granted rarity become one random character of the next tier** (round 1, decision 1). The four steps are Common → Rare, Rare → Epic, Epic → Legendary and Legendary → Mythic (open question 9 asks about the last); Mythic cannot be recycled.

1. The schema bounds the body; `mythic` → 400 `validation_failed`.
2. Lock the account row; handle a replay (§8.8).
3. Select `RECYCLE_INPUT` available `standard` cards of the (character, rarity), newest first, `FOR UPDATE`. Fewer → 409 `not_enough_copies`. All copies may be used, including the last five: the same rule as selling (round 1, decision 6).
4. Fee = `RECYCLE_FEE[rarity]`. A balance below the fee → 409 `insufficient_funds`.
5. Read the current snapshot's characters of the next tier; no snapshot → 503 `pool_unavailable`. Nothing is consumed.
6. Draw the output with `randomInt(0, n)` over that tier's characters ordered by id (C10, through 1c's `Rng`): **uniform within the tier**, each with chance `1 / tierSizes[next]`, published in `GET /api/wallet`. The output can be any character of the tier, including one already held. `isNew` as for an opening.
7. Write the `recycle_fee` entry (− fee) and the `recycles` row, mark the five inputs removed by it, insert the new card (`recycle_id`, rarity = the next tier, `standard`, the current snapshot), answer 201 with the receipt and the card.

**The fees, derived for five tiers.** Karma-wise a recycle creates nothing: its output is a card, never Karma, and its fee is destroyed, so system-wide every recycle is a sink of exactly its fee and of four cards. The fee for each step is the larger of two rules, rounded up to two significant figures, and then checked against a third:

1. **Reference rule**: what goes in is worth at least 1.2 times what comes out, `fee ≥ 1.2 × V(next) − 5 × V(this)`, so recycling is never a cheaper way to the next tier than its reference value.
2. **Supply rule**: the fee is at least the Karma a player earns from the free packs it takes to pull one card of the next tier, `fee ≥ PACK_KARMA_GRANT / (PACK_SIZE × p_next)`. Since the faucet is 20 Karma a pack, a player who spends every Karma it earns on one step can make at most as many cards of the next tier by recycling as its packs give it by pulling, so recycling can at most double a tier's supply.
3. **Floor check**: five inputs bought at the market minimum plus the fee cost more than the output at its minimum.

| Step               | Reference rule        | Supply rule         | Fee       | In + fee at reference vs out | Floor check           |
| ------------------ | --------------------- | ------------------- | --------- | ---------------------------- | --------------------- |
| Common → Rare      | 14.4 − 50 < 0         | 20 / 2.161 = 9.3    | **10**    | 60 vs 12 (5.0 ×)             | 25 + 10 = 35 > 6      |
| Rare → Epic        | 168 − 60 = 108        | 20 / 0.190 = 105.3  | **110**   | 170 vs 140 (1.21 ×)          | 30 + 110 = 140 > 70   |
| Epic → Legendary   | 1 560 − 700 = 860     | 20 / 0.0202 = 992   | **1 000** | 1 700 vs 1 300 (1.31 ×)      | 350 + 1 000 > 650     |
| Legendary → Mythic | 9 600 − 6 500 = 3 100 | 20 / 0.0033 = 6 051 | **6 100** | 12 600 vs 8 000 (1.58 ×)     | 3 250 + 6 100 > 4 000 |

Between players a recycle can still pay: five Rares bought at the floor (30) plus the fee (110) is 140, and an Epic sold at the cap (350) nets 315 after its 35 fee. That profit is paid by a buyer who chose to pay 350; it is a trade, not Karma created, and system Karma falls by 5 + 110 + 35 = 150 on that path. Common → Rare stays possible but is a poor trade (Rares are nearly as common as Commons); it exists so that every tier below Mythic has a step.

### 8.8 Idempotency

Every state-changing request carries a client `requestId` (uuid), scoped to the account and to its table: shop purchases share 1c's opening keys (`pack_openings`), recycles, listings and purchases each have their own.

- The same `requestId` with the same request: 200 with the original receipt (what was dealt, consumed, listed or bought; the fee or price; the card produced) and the current balance. Nothing is written.
- The same `requestId` with a different request: 409 `request_id_reused`, nothing written. "Same" is, for a recycle, the SHA-256 of the canonical body (character, rarity); for a shop purchase, the theme (a timer opening and a shop purchase never match); for a listing, character, rarity and price; for a purchase, the listing id.
- A request refused with any error leaves no record, so its key can succeed later.

### 8.9 Concurrency and bounds

- **One lock order**: account rows first, in ascending id order when there are two; then listing rows; then card rows; then the ledger. Every path keeps it: a timer or shop opening (account, cards), a recycle (account, cards), a listing (account, cards), a cancel (account, listing), a purchase (both accounts, listing, card), the reset (account, listings, cards). Two purchases in opposite directions (A buys from B while B buys from A) both lock the lower id first, so they cannot deadlock; a test proves it.
- **Double buy**: two buyers of one listing → one 201, one 409 `listing_unavailable`; the seller is credited once.
- **Buy versus cancel**: one wins; a cancelled listing cannot be bought, a sold one cannot be cancelled.
- **Double spend**: two parallel spends (shop, recycle, purchase) with the balance for one → one 201, one 409 `insufficient_funds`.
- **Listing versus recycle** for the last available copies: one wins; the other gets 409 `not_enough_copies`.
- **No negative balance**: a debit is written only after the domain has seen, under the lock, a balance that covers it; the check constraint is the backstop.
- **No overflow**: the schema caps every price and id; the parameters cap every amount and balance so every intermediate sum stays inside `integer` (§5); the ledger function asserts `Number.isSafeInteger` on every value it writes. JSON edge cases are schema rejections, never arithmetic: `1e400` (Infinity), `9007199254740993`, `1.5`, `-0`, `"5"` and `null` → 400.
- **Server time only**: `created_at`, `expires_at`, `removed_at` and the limit windows come from the server clock.

### 8.10 Reset

1c's `reset-collection` (`collection-packs.md` §5.6) gains, in the same transaction after the account lock: every active listing of the account is cancelled (nobody can buy a cancelled listing); all the account's cards are deleted, whatever their origin (listings keep their history with `card_id` set to null); and the Karma rule. **Recommended and built: the balance goes to 0** with one `owner_reset` entry of `− balance` (none when it is already 0), so the ledger stays gapless and auditable. A reset is the owner's remedy for a fresh start and for farming (§10); keeping the Karma would let a farmed balance survive it. The account's past purchases and sales stay in the ledger and in the other parties' receipts. Open question 2.

### 8.11 What items 5 and 6 add

The ledger serves blackjack and slots without a change to its table:

- `ledger_kind` gains `wager` (debit) and `payout` (credit). Each game's round table points at its ledger rows, as `recycles` does; the ledger knows nothing about games.
- The same account lock and order, the same §8.1 function, the same `MAX_ENTRY_AMOUNT` for a wager or a payout, the same `requestId` pattern.
- Table limits are fixed numbers in `shared/src/economy.ts`, never a share of the balance.
- A game's house edge, computed exactly in integers from its published paytable, lies within `HOUSE_EDGE`, with every prize pack counted at `PRIZE_PACK_VALUE` (the shop's price).
- Prize packs are a separate, capped counter consumed by 1c's `dealPack` with `source = 'prize'`; they grant no Karma.

### 8.12 Rate limits and logging

`CARD_ACTION_RATE_LIMIT` (30/min per client address) on recycle, the shop purchase, listing, buying and cancel, each replacing the global bucket for its route; the GET routes use the global bucket. At `info`, with the request id: Karma granted (account, opening, amount, balance after); shop pack bought (account, theme, price, balance after); recycled (account, input character and rarity, fee, output character and rarity, balance after); listed, cancelled, expired (listing, seller, character, rarity, price); bought (listing, buyer, seller, price, fee, both balances after); each with whether it was a replay. At `warn`: a purchase refused by `market_limit`, with the limit hit. Never a whole request body.

## 9. The model: faucet, sinks and the bound on growth

### 9.1 Values per pack

With 1c's `SLOT_ODDS` and §5.1's reference values, the expected reference value of one card is 0.525097 × 10 + 0.432233 × 12 + 0.037977 × 140 + 0.004032 × 1 300 + 0.000661 × 8 000 = 5.25 + 5.19 + 5.32 + 5.24 + 5.29 = **26.28**, so of one pack **131.42**. A themed pack costs 200, about 1.5 times that: buying a pack to sell its cards at reference value is a loss, and the premium pays for choosing the set. The grant of 20 is about a seventh of a free pack's value; ten free packs pay for one themed pack.

### 9.2 Faucet

Karma has one source until the games: `PACK_KARMA_GRANT` per timer pack. Timer packs are bounded per account by 1c (at most 144 a day, `PACK_CAP` stored).

| Player                                                                                          | Timer packs a day | Karma a day | Themed packs it pays for |
| ----------------------------------------------------------------------------------------------- | ----------------- | ----------- | ------------------------ |
| Casual: three visits a day, `PACK_CAP` packs each                                               | 9                 | 180         | 0.9                      |
| Active: opens each pack as it arrives for 16 waking hours, plus the `PACK_CAP` stored overnight | 99                | 1 980       | 9.9                      |
| Ceiling: every pack, 24 hours a day; a script does no better, because the timer is the limit    | 144               | 2 880       | 14.4                     |

The ceiling is a hard bound per account and does not depend on the balance. Market income is not a faucet: it is other players' Karma.

### 9.3 Sinks

- **The shop**, the main sink: 200 Karma destroyed per themed pack.
- **The market fee**: 10 % of every sale's price destroyed (at least 1).
- **Recycle fees**: 10, 110, 1 000 or 6 100 per recycle.
- **Owner resets**: the balance of a reset account.
- **Games** (items 5, 6) keep `HOUSE_EDGE` of every wager.

### 9.4 Why it does not inflate

Let `G` be the Karma granted in a day, `S` spent in the shop, `F` market fees and `R` recycle fees, all summed over accounts. The total Karma in the game changes by `G − S − F − R` a day, and market trades cancel out apart from `F`.

1. **Karma grows at most linearly, by at most `N × 2 880` a day** for `N` accounts (28 800 at the ten-account cap), and by less with every pack bought, fee paid or recycle made. Nothing Karma buys creates Karma: a shop pack yields cards, cards sell only for other players' Karma, a recycle yields a card. No path turns Karma into more Karma for the game as a whole; there is no compounding loop. Games keep a house edge with every prize pack counted at the shop's price.
2. **Cards grow at most linearly too.** Per account: 720 a day from timer packs, plus at most 72 from themed packs paid by its own grants (14.4 packs); the market moves cards between accounts and creates none, and recycling turns five into one. Game-wide, themed packs are bounded by `G / 200`, so the shop raises the pack ceiling by at most a tenth (`PACK_KARMA_GRANT / THEMED_PACK_PRICE`).
3. **The upper tiers stay scarce.** A player who spends every Karma it earns on one recycle step makes at most `20 / fee` cards of the next tier per pack: 0.18 Epic (packs deal 0.190), 0.020 Legendary (0.0202) or 0.0033 Mythic (0.0033). Recycling can at most double the supply of a tier from Epic up, and only for a player who spends nothing else; the inputs bound it too (five Legendaries per Mythic, 0.0040 a pack).
4. **Prices cannot run away.** Market prices are the players', but bounded per tier between half and two and a half times the reference value; a growing pile of idle Karma can push prices to the cap and no further. At the cap a Mythic costs 20 000, a hundred themed packs. Shop prices and fees are fixed numbers, not shares of a balance.
5. **Accounts pooling Karma** is bounded by §10, not by this model.

### 9.5 What grows without bound

- **A balance that is never spent**, linearly: at most 2 880 a day from its own packs plus at most 22 500 net per seven days from the market (§10), about 6 100 a day in all. `MAX_BALANCE` is about 450 years away at that rate; it keeps the arithmetic in range, and the grant clips at it.
- **Cards that are never listed or recycled**, linearly: at most about 807 a day per account (720 from timer packs, 72 from themed packs, about 15 bought).
- **Ledger rows**: one per timer pack and per action, at most a few hundred a day for an account at the ceiling.

Nothing grows faster than linearly, and nothing grows because a balance is large. A unit test recomputes §5.1, §8.7's fee table and §9.1 to §9.5 from `shared/src/economy.ts` and `shared/src/rarity.ts`, so a parameter change that moves these numbers fails until this section is updated.

## 10. Anti-farming

This is an invite-only game in which one person could hold several accounts (one invite code is reusable, `accounts-api.md` §6.2), and the market makes Karma and cards movable between accounts. The attack: open free packs on alternate accounts and move their Karma or their best cards to one main account, for example by listing a worthless card on the main at the cap and buying it from each alternate. The limits run over a rolling seven days rather than one day because a single Mythic near the cap (up to 20 000) is several days of anyone's Karma; a daily limit low enough to matter would make Mythics unbuyable. The controls:

| Control                   | Rule                                                                                                                                                                                                                                                                          | What it bounds                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Fee                       | 10 % of every sale destroyed                                                                                                                                                                                                                                                  | every Karma moved between accounts loses a tenth                                                                                       |
| Price bounds per tier     | 0.5 × to 2.5 × the reference value; the tier is the card's granted rarity, which the seller cannot choose                                                                                                                                                                     | junk cannot carry large sums: a Common at most 25, a Rare 30, an Epic 350; only Legendaries and Mythics carry thousands                |
| Window limits per account | per rolling 7 days: a buyer makes at most 100 purchases and spends at most 25 000; a seller receives at most 25 000 gross                                                                                                                                                     | a main account receives at most 22 500 net per 7 days (about 3 200 a day) from **all** other accounts together, however many there are |
| Pair limit                | one buyer pays one seller at most 12 500 per 7 days                                                                                                                                                                                                                           | one alternate account alone can feed at most 11 250 net per 7 days                                                                     |
| No self-trade             | buying one's own listing → 409 `own_listing`                                                                                                                                                                                                                                  | the trivial case; it cannot detect two accounts of one person                                                                          |
| Audit (`audit-market`)    | the owner's report (§13.3): net Karma flow per pair over 7 and 30 days; pairs where one side makes more than half of the other's market volume; sales at the bounds; listings bought within 60 s of being listed; buyers and sellers who registered with the same invite code | detection after the fact                                                                                                               |
| Owner remedies            | `reset-collection` (cards and Karma to zero, §8.10), deleting an account, rotating `INVITE_CODES`                                                                                                                                                                             | what the owner does with a finding                                                                                                     |

**Residual risk, plainly.** The server cannot tell two people from one person with two accounts. One person with several accounts can move up to 22 500 Karma net per seven days into one account (the seller-side window cap less the fee), about 3 200 a day, against that account's own ceiling of 2 880 a day from its packs: multi-accounting can roughly double one account's Karma income, never more, whatever the number of accounts. Cards move the other way under the buyer's limits: at most 100 cards and 25 000 Karma per seven days, for example 6 Mythics or 38 Legendaries at the floor price. Detection is after the fact and heuristic, and the remedy is the owner's. The roster is capped (`ACCOUNT_CAP`, 10) and every account comes from an invite the owner hands out, which is the real control; the limits make the gain small and slow enough that the audit sees it first.

## 11. Contract (`shared/src/api.ts`, `shared/src/errors.ts`)

### 11.1 Error codes

New: `not_enough_copies` (409), `insufficient_funds` (409), `request_id_reused` (409), `price_out_of_bounds` (400), `listing_limit` (409), `listing_not_found` (404), `listing_unavailable` (409), `own_listing` (409), `market_limit` (409) and `theme_unavailable` (404). `pool_unavailable` (503) is 1c's.

`ErrorEnvelope.error` gains two optional fields, each present only on its code: `balance: integer ≥ 0` on `insufficient_funds` (the acting account's balance under the lock, so the UI can say what it has without another request), and `limit: "buyer_purchases" | "buyer_spend" | "seller_proceeds" | "pair"` on `market_limit` (which limit was hit, so a buyer refused by the seller's proceeds or the pair limit is not told to wait for room it already has). `market_limit` also carries `retryAfterSeconds` and `Retry-After`; that field's comment in `errors.ts` widens to it.

### 11.2 Schemas

```
RecyclableRarity  "common" | "rare" | "epic" | "legendary"
KarmaRules        { referenceValues: PerRarity, priceMin: PerRarity, priceMax: PerRarity,
                    feeBps: integer, feeMin: integer,                -- fee(price) = max(feeMin, ceil(price × feeBps / 10 000)): rounded up, at least feeMin (1)
                    listingTtlSeconds: integer, maxListings: integer, packGrant: integer, themedPackPrice: integer,
                    window: { seconds: integer, purchases: integer, spend: integer, proceeds: integer, pair: integer } }
RecycleRule       { from: RecyclableRarity, into: Rarity, cards: integer, fee: integer, outputTierSize: integer }
Wallet            { balance: integer ≥ 0, activeListings: integer ≥ 0, rules: KarmaRules,
                    recycle: RecycleRule[4] }                        -- one per step, Common to Legendary; none from Mythic
ThemeOffer        { id: string, title: string, kind: "genre" | "franchise", cards: integer,   -- cards = PACK_SIZE
                    franchiseIds: integer[],                         -- the computed set, in franchise popularity order (§8.6)
                    price: integer,
                    odds: { scale: integer, perSlot: PerRarity, perPack: PerRarity, tierSizes: PerRarity } }
ShopResponse      { themes: ThemeOffer[], franchises: FranchiseRef[], snapshot: SnapshotInfo | null }
ShopBuyBody       { requestId: uuid, themeId: string(1..64) }
ShopReceipt       { pack: PackOpened, themeId: string, price: integer, balance: integer ≥ 0 }
RecycleBody       { requestId: uuid, characterId: integer ≥ 1, rarity: RecyclableRarity }
ReceivedCard      { kind: "card", character: CharacterPublic, rarity: Rarity, variant: CardVariant, isNew: boolean }
RecycleReceipt    { recycleId: uuid, recycledAt: date-time, consumed: { characterId: integer, rarity: RecyclableRarity, count: integer },
                    fee: integer ≥ 1, card: ReceivedCard, franchises: FranchiseRef[], balance: integer ≥ 0 }
ListBody          { requestId: uuid, characterId: integer ≥ 1, rarity: Rarity, price: integer 1..MAX_ENTRY_AMOUNT }
Listing           { listingId: uuid, kind: "card", character: CharacterPublic, rarity: Rarity, variant: CardVariant,
                    price: integer, fee: integer, listedAt: date-time, expiresAt: date-time,
                    closedAt: date-time | null,                      -- when it sold, was cancelled or expired; null while active
                    status: "active" | "sold" | "cancelled" | "expired", mine: boolean }
ListingsQuery     { rarity?: Rarity, franchiseId?: integer ≥ 1, characterId?: integer ≥ 1, q?: string(1..100),
                    sort?: "price_asc" | "price_desc" | "newest", cursor?: string(1..200) }
ListingsPage      { listings: Listing[0..MARKET_PAGE_SIZE],
                    filterFranchiseIds: integer[] | null,            -- first page only: every franchise with an active listing (§8.4)
                    franchises: FranchiseRef[],                      -- covers the listings and filterFranchiseIds
                    nextCursor: string | null }
BuyBody           { requestId: uuid }
PurchaseReceipt   { purchaseId: uuid, boughtAt: date-time, listingId: uuid, price: integer, card: ReceivedCard,
                    franchises: FranchiseRef[], balance: integer ≥ 0 }
WindowLeft        { purchases: integer ≥ 0, spend: integer ≥ 0, proceeds: integer ≥ 0 }
MarketMine        { active: Listing[], closed: (Listing & { proceeds: integer | null })[], purchases: PurchaseReceipt[],
                    left: WindowLeft, franchises: FranchiseRef[] }
CollectionEntry   (1c) gains listed: integer ≥ 0, available: integer ≥ 0    -- available = count − listed: the server's rule
PackOpened        (1c) gains karma: { granted: integer ≥ 0, balance: integer ≥ 0 } | null   -- null on shop packs
```

`PerRarity` (five tiers), `Rarity`, `CardVariant`, `CharacterPublic`, `FranchiseRef` (a franchise's title is that of its anchor entry, the smallest AniList id among its top-100 entries, `collection-packs.md` §5.1.2), `SnapshotInfo` and `PackOpened` are 1c's. Every number the UI shows per tier comes from `Wallet`: the reference value, the market minimum and maximum, the fee rule (`feeBps`, `feeMin`), and for each recyclable tier the input count, the fee and the output tier's size; Mythic has no `RecycleRule`. `Wallet.activeListings` is 0 until PR 3 adds the market, then the caller's active, unexpired listings, so the UI can show the listing cap before a request. `kind` and `variant` are the reserved slots for Relics and Masterworks; in item 2 they can only be `"card"` and `"standard"`, and a request never carries either (a listing or a recycle names a `standard` card by character and rarity). No request carries an amount, a balance, an account id or a card id; the only price a request carries is the seller's asking price in `ListBody`, which the server bounds. A body naming anything else fails as an unknown field.

### 11.3 Routes

| Method, path                                   | Body          | Success                                       | Errors (status, code)                                                                                                                                                      | Limit  |
| ---------------------------------------------- | ------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `GET /api/wallet`                              | —             | 200 `Wallet`                                  | 401 `unauthenticated`                                                                                                                                                      | global |
| `GET /api/shop`                                | —             | 200 `ShopResponse`                            | 401 `unauthenticated`                                                                                                                                                      | global |
| `POST /api/shop/buy`                           | `ShopBuyBody` | 201 `ShopReceipt`; 200 on a replay            | 400 `validation_failed`, 401, 404 `theme_unavailable`, 409 `insufficient_funds`, 409 `request_id_reused`, 503 `pool_unavailable`                                           | 30/min |
| `POST /api/collection/recycle`                 | `RecycleBody` | 201 `RecycleReceipt`; 200 on a replay         | 400 `validation_failed`, 401, 409 `not_enough_copies`, 409 `insufficient_funds`, 409 `request_id_reused`, 503 `pool_unavailable`                                           | 30/min |
| `GET /api/market/listings`                     | — (query)     | 200 `ListingsPage`                            | 400 `validation_failed`, 401                                                                                                                                               | global |
| `GET /api/market/mine`                         | —             | 200 `MarketMine`                              | 401                                                                                                                                                                        | global |
| `POST /api/market/listings`                    | `ListBody`    | 201 `Listing`; 200 on a replay                | 400 `validation_failed`, 400 `price_out_of_bounds`, 401, 409 `not_enough_copies`, 409 `listing_limit`, 409 `request_id_reused`                                             | 30/min |
| `POST /api/market/listings/{listingId}/buy`    | `BuyBody`     | 201 `PurchaseReceipt`; 200 on a replay        | 400 `validation_failed`, 401, 404 `listing_not_found`, 409 `listing_unavailable`, 409 `own_listing`, 409 `market_limit`, 409 `insufficient_funds`, 409 `request_id_reused` | 30/min |
| `POST /api/market/listings/{listingId}/cancel` | `{}`          | 200 `Listing`                                 | 400 `validation_failed`, 401, 404 `listing_not_found`, 409 `listing_unavailable`                                                                                           | 30/min |
| `GET /api/collection`                          | —             | 1c's, with `listed` and `available` per entry | as 1c                                                                                                                                                                      | global |
| `POST /api/packs/open`                         | as 1c         | 1c's, with `karma`                            | as 1c                                                                                                                                                                      | as 1c  |

`listingId` in a path is a uuid (anything else → 400). `GET /api/wallet`, `/api/shop`, `/api/market/mine` and `/api/collection` take `NoQuery`; `GET /api/market/listings` takes `ListingsQuery`, `additionalProperties: false`, no coercion beyond the declared integers. The POSTs are behind the CSRF check, and their response schemas also declare 403 `bad_origin` and 429 `rate_limited`. The 30/min is `CARD_ACTION_RATE_LIMIT`.

## 12. What the UI needs (PRs 2 and 4)

`ui-designer` designs the screens; this lists what they need back and the rules they keep. The name is **Karma**, one line in `web/src/lib/copy.ts`; code says `balance` and `amount`, never the name. Numbers are whole, through `Intl.NumberFormat`, with no symbol that suggests real money. Five tiers everywhere a rarity appears.

- **Wallet**: `balance` from `GET /api/wallet`, then from each receipt and from `PackOpened.karma`. The UI never computes a balance. `rules` and `recycle` are shown next to the actions they govern (ADR 0004 §6); none is a constant in `web/` (1c's lint rule forbids importing `@anime-tcg/shared/economy`).
- **Shop**: the themes from `GET /api/shop`, each with its title, franchises, price and published odds (`perPack` as the headline, `perSlot` and `tierSizes` on request); a buy sends one `ShopBuyBody`, keeping its `requestId` only when no answer arrived, as 1c's pack does; the receipt's pack is revealed like a timer pack; `insufficient_funds` shows the price and the balance; `theme_unavailable` refetches the shop. The free timer pack keeps its own control.
- **Market, browse and filter**: `GET /api/market/listings` with rarity, franchise, character, search text and sort as query parameters, and `nextCursor` for more; each listing with its character, rarity, price and expiry; `mine` listings cannot be bought from the UI (the server refuses too).
- **Market, buy**: one request with the listing id and a `requestId`, no price; the confirmation shows the listing's price and the balance; `listing_unavailable` and `listing_not_found` say the listing is gone and refetch; `market_limit` names the limit from the error's `limit` and shows the wait from `retryAfterSeconds`; `insufficient_funds` the price and the error's `balance`.
- **Market, list**: from a collection entry with `available ≥ 1`, while `activeListings` is below `maxListings`: a price field bounded by `priceMin` and `priceMax` for the entry's rarity, the fee and the net (`price − fee`, the one sum the UI may show before the server answers, computed as `max(feeMin, ceil(price × feeBps / 10 000))` from the wallet's rules, labelled as an estimate the receipt confirms); the confirmation says when the card is the last copy (any card can be listed, the last copy included) and that it stays in the collection until it sells.
- **Market, mine and cancel**: `GET /api/market/mine` for active listings (with cancel), closed ones with proceeds, purchases and `left` for the window limits.
- **Recycle**: from a collection entry with `available ≥ RECYCLE_INPUT` and a recyclable rarity: the rule (five copies become one random character of the next tier, uniform over `outputTierSize` characters), the fee, and the balance; the receipt's `card` is revealed like a pack card, with `isNew`. The output is random, so this is a reveal, not a deterministic upgrade.
- **Errors**: `not_enough_copies` and `request_id_reused` → the collection changed: refetch and say so; `pool_unavailable` → 1c's cards-unavailable state; `unauthenticated` → session ended; a network failure → the unreachable banner.
- **No nags** (ADR 0004 §6): no "sell now" or "buy now" prompts, no celebration of a growing balance or of a Mythic, no countdowns tied to Karma, no scarcity wording on listings.

## 13. Owner-side commands

Each runs inside the api container, is unit-tested through its exported function, and is documented in `docs/04-deployment.md` under "Operations".

### 13.1 `audit-ledger` (PR 1, extended in PR 3)

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/audit-ledger.js
```

Read-only. Checks every account against §7's invariants (balance, sums, gapless `seq`, every opening, recycle and purchase with its entries of the right sign and amount, every sold listing with exactly one purchase whose three entries match its price and fee, every bought card with its purchase) and prints `Ledger consistent: 10 accounts, 1234 entries.`, or one line per failing account and exit 1. Run it before a release and after any restore (C16). The route suites run it once at the end against the test database.

### 13.2 `pack-themes` (PR 1)

```bash
docker compose ... exec -T api-production node api/dist/cli/pack-themes.js list
docker compose ... exec -T api-production node api/dist/cli/pack-themes.js candidates
docker compose ... exec -T api-production node api/dist/cli/pack-themes.js add genre-action --genre Action --title "Action"
docker compose ... exec -T api-production node api/dist/cli/pack-themes.js add franchise-aot --franchise 16498 --title "Attack on Titan"
docker compose ... exec -T api-production node api/dist/cli/pack-themes.js enable genre-action
docker compose ... exec -T api-production node api/dist/cli/pack-themes.js disable genre-action
```

`list` shows every theme with its state and its five tier counts against the current snapshot; `candidates` lists every genre and every franchise of the current snapshot with its tier counts and whether it is eligible; `add` validates the slug (`[a-z0-9-]{1,64}`), the title (1 to 60 characters, no NUL) and that the genre or the franchise's entry exists in the current snapshot; `enable` refuses an ineligible theme. Owner input is still validated: titles are rendered as text.

### 13.3 `audit-market` (PR 3)

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/audit-market.js [--days 30]
```

Read-only. Prints the §10 report: net Karma per account pair over 7 and 30 days, largest first; pairs where one side makes more than half of the other's market volume; counts of sales at the price bounds per seller; listings bought within 60 seconds of being listed, with buyer and seller; accounts that registered with the same invite code and traded with each other. Prints `No findings.` when there is nothing; exit 0 either way (findings are for the owner to judge, not failures).

## 14. Tests required (minimum, T3)

**Unit** (`api/src/domain/economy/*.test.ts`, `api/src/domain/market/*.test.ts`, `shared/`): §5's invariants; §5.1's reference values recomputed from `SLOT_ODDS`; §8.7's fee table (both rules and the floor check for each of the four steps); §9 recomputed from the parameters; the fee function (rounding up, minimum 1, at every bound of all five tiers); the grant clipped at `MAX_BALANCE`; recycle rules (input count, available `standard` copies only, newest first, fee, next tier, Mythic refused); theme sets and eligibility across five tiers for genre and franchise themes; the rolling-window limits and their `retryAfterSeconds`; the ledger function (`seq`, `balance_after`, every bound refusal, `Number.isSafeInteger`); canonical request matching for every replay kind; the market search's escaping of `%`, `_` and `\`.

**Route** (`api/test/economy.test.ts`, `api/test/market.test.ts`): every row of §11.3, the happy path and each declared error; an extra field → 400; a query string on a `NoQuery` GET → 400; an unknown query parameter on the listings GET → 400; a missing Origin → 403; signed out → 401; a timer opening credits `PACK_KARMA_GRANT` and a replay does not; a shop purchase debits the price, deals `PACK_SIZE` cards only from the theme's set and leaves the allowance unchanged; a disabled or ineligible theme → 404; a recycle at each of the four steps debits its fee, removes five copies and adds one card of the next tier; recycling a Mythic → 400; listing the last copy succeeds and the entry shows `listed: 1, available: 0`; a listed card cannot be recycled or listed again; a purchase moves exactly the price and the fee, removes the seller's card and gives the buyer a new card with the same character, rarity, variant and snapshot; an expired listing is not returned and cannot be bought, sits under `mine.closed` as `expired` before and after the purge marks it, and never under `mine.active`; cancel is idempotent and a closed listing carries `closedAt`; `insufficient_funds` carries the balance and `market_limit` the limit that was hit, for each of the four limits; the first browse page lists every franchise with an active listing and later pages `null`; a search for a native name and for a native franchise title finds the listing; `Wallet.activeListings` follows listing, cancel, sale and expiry; deleting a seller's account leaves the buyer's card and receipt intact; the reset cancels listings, deletes every card and zeroes the balance with one `owner_reset` entry; the app role can neither update nor delete a ledger, recycle or purchase row; `audit-ledger` passes on the database each suite leaves behind.

**Concurrency** (parallel `inject()` calls):

- Two buyers of one listing → exactly one 201 and one 409 `listing_unavailable`; one purchase row; the seller credited once.
- A buy and a cancel of one listing → exactly one succeeds.
- A buys B's listing while B buys A's, 50 times in parallel pairs → every request finishes (no deadlock, no lock timeout) and the ledgers balance.
- Two spends with the balance for one (shop and shop, shop and recycle, shop and purchase) → one 201, one 409 `insufficient_funds`, balance ≥ 0.
- A listing and a recycle racing for the last available copies → one wins.
- A purchase racing the seller's timer opening → both succeed and both `seq`s stay gapless.
- The same `requestId` twice in parallel on each POST → one 201 and one 200 with the same receipt.
- 101 parallel purchases by one buyer within a window → 100 at most succeed; purchases pushing a seller past `MARKET_WINDOW_PROCEEDS` → refused with `market_limit` exactly at the bound.

**Adversarial** (`api/test/security/economy.security.test.ts`, `market.security.test.ts`):

- **Double buy** of one listing by two buyers → exactly one success (as above, also through two separate app instances on one database).
- **Buying your own listing** → 409 `own_listing`, nothing written.
- **Price tampering** is impossible because the server holds the price: a buy body with `price`, `amount`, `fee`, `characterId` or `sellerId` → 400; a listing whose price is outside the bounds for its rarity, or a listing claiming a rarity the card does not have → 400 or 409 `not_enough_copies`; after a listing, no request can change its price (there is no route).
- **Listing a card you do not own**: a character only another account holds, a character that does not exist, a rarity you do not hold it at → 409 `not_enough_copies`, and the other account's cards are unchanged; a body with `cardId` (another account's real card uuid), `kind` or `variant` → 400.
- Cancelling another account's listing → 404, its state unchanged; buying a listing id that does not exist or is not a uuid → 404 or 400.
- Negative, zero, fractional, string, `null`, `1e400`, `9007199254740993` and over-maximum prices and ids → 400, nothing written.
- Overflow: a seller at `MAX_BALANCE − 1` whose listing is bought → refused, nothing written; a buyer one below the price → 409 `insufficient_funds`; a grant at `MAX_BALANCE` → no entry, the opening succeeds; a Mythic at the cap bought with the window spend at 25 000 − 19 999 → `market_limit`.
- Replay: the same key and request → one action; the same key with another request → 409 `request_id_reused`; account B sending A's key → B's own outcome.
- No path from nothing to Karma: an account with no cards and no packs calls every route; its balance is unchanged. No path from Karma to the timer: a shop purchase never changes `packs_anchor_at`.
- Farming: two accounts trading a Common back and forth at the cap → each round loses the fee; the window and pair limits stop the flow at their bounds; `audit-market` reports the pair.
- Hostile strings: a theme title with `<script>` and an RTL override (through `pack-themes`), and a search `q` of `%`, `_`, `'; drop table`, an RTL override and 100 combining marks → stored or matched as text, never as SQL or markup.
- Forged, flipped and expired session cookies → 401; the request after `CARD_ACTION_RATE_LIMIT` is used up → 429.
- Route inventory: the full route list of `buildApp` equals the documented one, so a new route that writes the ledger cannot appear without a spec change.
- After every test above, `audit-ledger`'s invariants hold for every account.

**Statistical** (unit project, the real `crypto.randomInt`, α = 0.001 each, the same failure rule and design as `collection-packs.md` §9):

- **Themed pack**: the tier draw of 200 000 themed packs (1 000 000 slots) against `SLOT_ODDS`, chi-square with 4 degrees of freedom (critical value 18.47, the power of 1c §9), on a fixture theme whose set is a subset of the fixture snapshot with 10 / 40 / 100 / 250 / 600 characters per tier; the pick within each tier with the tier forced, 2 000 draws per character, chi-square with 9, 39, 99, 249 and 599 degrees of freedom (27.88, 72.05, 148.23, 323.69, 711.68); deterministically, no card outside the theme's set.
- **Recycle output**: for each of the four steps, 2 000 draws per character of the output tier of the same fixture (Rare 250 characters, 500 000 draws; Epic 100, 200 000; Legendary 40, 80 000; Mythic 10, 20 000), the count per character against an equal share, chi-square with 249, 99, 39 and 9 degrees of freedom (323.69, 148.23, 72.05, 27.88). Power: one character drawn 1.3 times as often as the others is caught with probability at least 0.99 in every output tier.

**Web (PRs 2 and 4)**: unit tests for each control's states and the error mapping; the T1 hostile-name test wherever a receipt, a listing or a theme shows a name or a title; e2e on the stack: open a timer pack and the balance rises by the grant; buy a themed pack and the balance falls by its price and five cards of its set are revealed; recycle five copies and a card of the next tier is revealed; list a card from one account and buy it from a second, and both balances, both collections and `audit-ledger` agree after a reload; nothing in `localStorage`.

## 15. Acceptance criteria

1. All routes in §11.3 exist, are validated, carry their limits and pass §14; `api/src` coverage stays ≥ 85 %.
2. Every balance change is a ledger row in the transaction of what it pays for; `audit-ledger` is clean on the test database and on the acceptance stack after the owner's checks.
3. No route turns Karma into a timer pack; the shop's packs come only through `POST /api/shop/buy`; the route inventory test pins the list.
4. `shared/src/economy.ts` holds every number of §5 with its invariant tests, and a test recomputes §5.1, §8.7 and §9.
5. `docs/05-security.md`: C11 live; a T3 row per PR; the threat model gains double spend, double buy, overflow, replayed actions, the market as a trust boundary between accounts, and multi-account farming with §10's controls and residual risk. `docs/04-deployment.md`: `audit-ledger`, `pack-themes`, `audit-market`, and the reset's Karma rule.
6. On the acceptance stack, the owner opens timer packs and sees the grant, enables a theme and buys its pack, recycles five copies, lists a card on one account and buys it on another, and the balances, the collections, `audit-ledger` and `audit-market` agree.

## 16. Decision record

The owner's answers, as far as they concern the economy. ADR 0011 records the reversals of ADR 0004.

**Round 1**:

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                                                                                                   | Where             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Recycle: five copies become one card of the next rarity with a random character (this spec's original rule).                                                                                                                                                                                                                                   | §8.7              |
| 5   | Currency name: "Karma".                                                                                                                                                                                                                                                                                                                        | §1, §12           |
| 6   | Selling: all cards can be sold, including the last copy (no duplicates-only rule), and they are sold on a player-to-player market, not to the game. This reverses "currency never moves between accounts" and ADR 0004's limit of trade to local profiles.                                                                                     | §8.3 to §8.5, §10 |
| 7   | Pack shop: keep the free pack every 10 minutes (up to 3 stored) and add themed packs bought with Karma, each drawing from its own character set ("different packs that have different collections of characters", e.g. one per anime or genre). No real money anywhere, ever. This reverses ADR 0004's "packs are never bought with currency". | §8.6, §9          |

**Round 2** (the tiers, recorded in full in `collection-packs.md` §11): five tiers, Common, Rare, Epic, Legendary, Mythic (Owner, 2026-10-29); the split 60 / 25 / 10 / 4 / 1 % by favourites rank; the per-pack odds Rare 94.1 %, Epic 17.6 %, Legendary 2 %, Mythic 0.33 %; franchises for completion; Masterwork and Relics reserved, not built. This spec re-derives every economy number for them: reference values (§5.1), recycle fees for four steps (§8.7), price bounds, the themed pack price and the model (§9), and moves the market limits to a seven-day window (§10).

Round 1 decisions 2, 3, 4, 8 and 9 (completion, fixed tiers, the owner reset, the AniList snapshot, the reveal's frames) are `collection-packs.md`'s; this spec adds the reset's Karma and listing rules (§8.10).

## 17. Open questions

For the owner; each is a choice of three, and this spec builds the recommended one.

1. **Where Karma comes from until the games exist** (§6).
   - A: a starting grant of 500 Karma at registration, and nothing after. Once spent, the shop is unusable again, and every invite becomes Karma to funnel to one account.
   - **B (recommended)**: 20 Karma for every free timer pack opened. Steady and bounded by the pack timer (at most 2 880 a day); ten free packs pay for one themed pack.
   - C: the game buys any card at 40 % of its reference value (Common 4, Rare 5, Epic 56, Legendary 520, Mythic 3 200). A guaranteed floor for every card, but it brings back selling to the game, which you turned down for the market.
2. **Karma on an owner reset** (§8.10).
   - A: keep the balance; only cards and listings go.
   - **B (recommended)**: set the balance to 0 with a ledger entry; listings are cancelled and cards deleted. A reset is a real fresh start and works as a remedy for farming.
   - C: you choose per reset (`--keep-karma`), defaulting to 0.
3. **Market fee** (destroyed on every sale, paid by the seller).
   - A: 5 %. Cheaper trading; moving Karma between accounts costs little.
   - **B (recommended)**: 10 %. A noticeable sink and a real cost on every transfer between accounts.
   - C: 15 %. A strong sink; sellers keep noticeably less, and a Mythic sold at 20 000 loses 3 000.
4. **Market price bounds** per tier, relative to the reference value (10 / 12 / 140 / 1 300 / 8 000).
   - A: 0.5 × to 2 ×: a Legendary 650 to 2 600, a Mythic 4 000 to 16 000. Prices stay close to reference.
   - **B (recommended)**: 0.5 × to 2.5 ×: a Legendary 650 to 3 250, a Mythic 4 000 to 20 000. Room for the most popular characters to cost more, while one Mythic still fits in a week's spend limit.
   - C: 0.2 × to 5 ×: a Legendary 260 to 6 500, a Mythic 1 600 to 40 000. Free pricing, but a Mythic near the cap no longer fits the weekly limits, which would have to double.
5. **Market limits per account** (rolling 7 days).
   - A: none beyond the fee and the price bounds. Simplest; a farmer is limited only by the fee.
   - **B (recommended)**: at most 100 purchases and 25 000 Karma spent per buyer, 25 000 received per seller, 12 500 between one pair, per 7 days. A main account gains at most 22 500 a week from all other accounts together (about 3 200 a day, close to its own 2 880 from packs), and one Mythic at the cap still fits.
   - C: tighter, 40 purchases and 10 000 Karma per 7 days, 5 000 per pair. Farming nearly pointless, but a Mythic listed above 10 000 can never be bought.
6. **Themed pack price** (a pack's cards are worth 131 at reference value).
   - A: 140 Karma (seven free packs pay for one). About its cards' reference value; the shop adds up to a seventh to anyone's packs.
   - **B (recommended)**: 200 Karma (ten free packs pay for one). A premium for choosing the set; the shop adds at most a tenth to anyone's packs.
   - C: 300 Karma (fifteen free packs). A rare treat; Karma piles up and market prices drift to the cap.
7. **Which themed packs the shop offers** (a theme needs five characters in every tier, Mythic included).
   - A: genre packs only (Action, Romance, Comedy, ...), every eligible genre, automatically.
   - **B (recommended)**: genre packs plus the franchise packs you pick with `pack-themes` among those with five Mythics. Only the biggest franchises qualify, so the shop is a dozen or so curated packs.
   - C: every eligible franchise, automatically, and franchises without five Mythics get a pack whose Mythic slots draw from the whole pool's Mythics. More franchise packs, but their top cards are not from the franchise.
8. **Reference values per tier** (§5.1: the yardstick for price bounds, recycle fees and the model).
   - A: keep your anchors, Common 10, Rare 50, Legendary 300, with Epic 120 and Mythic 1 500. Familiar numbers, but a Rare (in 94 % of packs) is valued five times a Common, Rares cannot be sold above their floor, and five Rares or five Epics are worth more than the card they recycle into.
   - **B (recommended)**: values inversely proportional to how often the tier turns up, Common 10, Rare 12, Epic 140, Legendary 1 300, Mythic 8 000. Every tier carries about the same share of a pack's value, and every number in this spec follows from it.
   - C: a ×5 ladder that matches the 5-to-1 recycle, Common 10, Rare 50, Epic 250, Legendary 1 250, Mythic 6 250. Keeps your Common and Rare, but still values Rares five times Commons although they are nearly as frequent.
9. **Mythic recycle: can five Legendaries make a Mythic?**
   - **A (recommended)**: yes, five Legendary copies of one character and 6 100 Karma make one random Mythic. Legendaries gain a use, and the fee keeps recycled Mythics at most as many as pulled ones.
   - B: no; Mythics come only from packs (and the market). Recycling stops at Legendary, and a fifth Legendary copy has no use but selling.
   - C: yes, but ten Legendary copies and 3 000 Karma. Cheaper in Karma, dearer in cards; with Legendaries at one in 50 packs, ten copies of one character is out of reach for most players.
10. **How recycle fees are set** (§8.7).
    - **A (recommended)**: the larger of the reference rule and the supply rule: 10, 110, 1 000 and 6 100. Recycling is a sink at reference value and can at most double the supply of any upper tier.
    - B: the reference rule only: 10, 110, 860 and 3 100. Cheaper upper steps, but recycling could then more than triple the supply of Mythics for a player who saves for it.
    - C: a flat fifth of the output's reference value: 3, 28, 260 and 1 600. Cheap and simple, but Epic, Legendary and Mythic recycles become a much cheaper route than pulling, and the upper tiers lose their scarcity.
11. **Which PR builds the card dialog** (§3; `collection-overview.md` §3.9 M1). Recycling and listing start from a collection entry's dialog, which belongs to the collection overview (item 3), but the economy PRs come first on the roadmap.
    - **A (recommended)**: build the collection overview (with a dialog that shows details only) right after 1c, and let each economy UI PR add its own section to the dialog: Recycle in `feat/economy-ui`, List on the market in `feat/market-ui`. Each PR stays small and each section arrives with its route.
    - B: `feat/economy-ui` builds only the card dialog (on today's collection grid) and the overview's grid, search and filters follow later as item 3. The economy is usable sooner, but the dialog is built against a grid that is then replaced.
    - C: fold the whole collection overview into `feat/economy-ui`. One coherent screen, but one large T3 pull request that mixes Karma spending with search, filters and pages.
