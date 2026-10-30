# Economy (roadmap item 2, server side)

Manager-written technical spec: the rules, the numbers and the API for Karma, recycling duplicate cards for Karma, the player market and the Karma pack shop. §12 lists what the UI needs; its layout is `ui-designer`'s (`collection-overview.md`, `market-and-shop.md`). Implements ADR 0004 (economy ground rules) as amended by ADR 0008 §6 (the maths lives in the API's domain layer) and ADR 0011 (the owner's 2026-10-29 decisions) as amended by ADR 0013 (six tiers, no franchise packs), on the data model of `collection-packs.md` (1c, six tiers, merged in #28). Security tier **T3** (currency, ledger, trades between accounts). `security-officer` review and an adversarial test pass are required before each PR opens; a T3 change never merges on the day it is opened unless the owner says so.

Written 2026-10-29; revised three times the same day for the owner's decisions, and a fourth time the same day for the six tiers 1c shipped and the owner's answer on franchise packs (§16, ADR 0013).

## 1. Goal

Players earn **Karma**, the one in-game currency, by **recycling duplicate cards** for a set Karma value per tier, never the last copy of a character at a rarity. They spend it on themed packs in the Karma shop and on other players' cards. Any card, the last copy included, can be listed on a **player market** at a price its owner sets within published bounds; another player buys it with Karma. There is no tier recycling: a card never turns into a better card in item 2, and upgrades come only from the mini-games later (items 5 and 6). The server decides every value, bound, fee and outcome; every Karma change is a ledger row written in the same transaction as the cards it pays for (C11). The model (§9) shows the faucet, the sinks and the bound on growth, and §10 the controls against one person farming Karma across several accounts. The ledger is the one blackjack and slots will write to. No real money anywhere, ever.

## 2. Out of scope

- The free pack timer: shipped by 1c (`collection-packs.md` §5.2) and unchanged here. Opening a free pack grants no Karma (round 3: the earlier per-pack grant is removed).
- **Tier recycling and every other upgrade.** Five copies no longer become a card of the next tier (round 3, decision 2, superseding round 1, decision 1). Upgrades happen only through the mini-games (round 3, decision 4): the owner's example is an ante of five Legendary cards that becomes a Mythic if the game is won. Items 5 and 6 specify them; §7 and §8.11 reserve what the ledger and the cards need for an ante held in escrow, and build none of it.
- Blackjack and slots (items 5, 6) and the packs they pay out (§8.11).
- Card-for-card trades (roadmap item 7). The market is cards for Karma.
- Any sale to the game other than recycling a duplicate. Recycling a duplicate **is** a sale to the game at a fixed price per tier, the owner's chosen faucet (§6); there is no other price at which the game takes a card, and it never takes the last copy.
- **Masterwork cards and Relics** (reserved by the owner, `collection-packs.md` §2). Neither is designed: no value, recycle value or market rule exists for them. This spec reserves only what lets them join later without a breaking migration (`item_kind` and `variant` on listings, `kind` and `variant` in the contract); every rule below applies to `kind: "card"`, `variant: "standard"` and to nothing else until a spec says otherwise.
- The collection overview's screen (item 3); the profile and a player-facing Karma history (item 4).
- Prices that change at runtime. Reference values, recycle values, bounds, fees and shop prices change by a deploy that changes §5 and this spec. Market prices are the players'.
- Anything bought with real money (ADR 0004 §3, `CLAUDE.md`).

## 3. Delivery

The collection overview (roadmap item 3, `collection-overview.md`) is built **right after 1c**, with a card dialog that shows details only (round 3, decision 12). Then four pull requests, in order, each through the full gate, **all T3**:

1. **`feat/economy`** (server): the ledger and the balance, recycling duplicates for Karma, the Karma shop with its themes, `GET /api/wallet`, the collection answer's additions, the reset's Karma rule, the owner command `audit-ledger`; migration, `api/src/domain/economy/`, routes under `api/src/routes/wallet/`, `api/src/routes/shop/` and `api/src/routes/collection/`, shared schemas and parameters, tests, docs. T3: currency, ledger, pack grants, RNG.
2. **`feat/economy-ui`**: the Karma balance in the header, the Shop tab, and the **Recycle for Karma** section of the overview's card dialog, after `ui-designer`'s UI specs. T3: it drives Karma-changing actions and their idempotency keys, on top of T1 for third-party strings.
3. **`feat/market`** (server): listings, buying, cancel, expiry, the anti-farming limits, `audit-market`, and the reset's listing rule. T3: Karma and cards move between accounts, which is a new trust boundary.
4. **`feat/market-ui`**: the Market tab (browse, filter, buy, my listings, cancel) and the **List on the market** section of the card dialog. T3, as PR 2.

Why this order: the ledger, the faucet and the main sink must exist before Karma can move between accounts, and PRs 1 and 2 already give a playable economy (recycle duplicates, spend in the shop). The market adds the riskiest part, the trust boundary between accounts, in a review of its own. Each server PR is followed by its UI, so the owner can accept what was built, and each UI PR adds its own section to the dialog the overview already has.

## 4. Ground rules

ADR 0004 as amended by ADR 0008 §6 and ADR 0011, rule by rule, and what holds each one here.

| Rule                                                                                                               | How this spec holds it                                                                                                                                                                          | Proven by                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| No real money, anywhere, ever (ADR 0004 §3, `CLAUDE.md`)                                                           | No payment provider or SDK, no route that takes or quotes real money, no premium currency, no cash-out. Karma is never converted to anything outside the game or exported                       | `security-officer` manifest check on every PR; the route inventory test (§14)              |
| The free pack is time-gated (ADR 0004 §1); packs may also be bought with Karma, never with money (ADR 0011 §1)     | `packs_anchor_at` is written only by the timer opening path; the shop's packs never touch it; the only route that debits Karma and deals a pack is `POST /api/shop/buy`                         | Adversarial: a shop purchase leaves the allowance unchanged; an empty balance buys nothing |
| One currency, integer-valued, named Karma (ADR 0004 §3, ADR 0011 §2)                                               | `integer` columns, bounded amounts (§5), no float anywhere in `domain/economy/`; the name is one line of copy                                                                                   | Unit and overflow tests                                                                    |
| Earned by recycling duplicates (later also by winning); spent in the shop, on the market and its fee (ADR 0011 §2) | Credits: `recycle_credit`, `market_sale`. Debits: `shop_purchase`, `market_purchase`, `market_fee`, `owner_reset`. Items 5 and 6 add `wager` and `payout`. Nothing else exists in `ledger_kind` | Schema; route inventory                                                                    |
| Cards for Karma between server accounts on a player market; any card, the last copy included (ADR 0011 §3)         | §8.3 to §8.5                                                                                                                                                                                    | Route and concurrency tests                                                                |
| Recycle: cards for Karma, duplicates only; no upgrade by recycling (ADR 0011 §4, §5)                               | §8.2; the last copy of a character at a rarity is never recycled                                                                                                                                | Route and concurrency tests                                                                |
| The loop must not inflate (ADR 0004 §5)                                                                            | §9                                                                                                                                                                                              | A unit test recomputes §9 from the parameters                                              |
| Odds are public (ADR 0004 §6)                                                                                      | Shop packs publish their per-slot and per-pack odds and tier sizes; recycle values, fees, bounds and limits are in `GET /api/wallet`                                                            | Route test; e2e                                                                            |
| Money-like maths in the API's domain layer, reviewed on every change (ADR 0004 §7 as amended by ADR 0008 §6)       | `api/src/domain/economy/` and `api/src/domain/market/`, pure functions, unit-tested; the web app only displays                                                                                  | Gate step 5 on every economy PR                                                            |

The first draft's rule "currency never moves between accounts" is reversed by the owner (round 1, decision 6, ADR 0011 §3). What replaces its protection is §10.

## 5. Parameters (`shared/src/economy.ts`)

All tunable numbers, in the one file ADR 0004 asks for; 1c put the pack numbers there. They are rebalanced once the games exist.

| Name                      | Value                                                                     | Why                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REFERENCE_VALUE`         | common 10, uncommon 23, rare 35, epic 160, legendary 1 000, mythic 11 000 | inversely proportional to each tier's share of the cards 1c's slot tables deal, Common 10, two significant figures (§5.1; manager default, 2026-10-29, owner may revise); the yardstick for everything below |
| `RECYCLE_VALUE`           | common 2, uncommon 5, rare 8, epic 40, legendary 250, mythic 2 750        | Karma per recycled duplicate: 25 % of the reference value ("half the market floor"), rounded down to a whole number, at least 1 (§6)                                                                         |
| `MAX_RECYCLE_COUNT`       | 100                                                                       | duplicates of one entry recycled in one request                                                                                                                                                              |
| `THEMED_PACK_PRICE`       | 400                                                                       | about 2.3 times the expected reference value of a shop pack's cards (170.79 × 2.3 = 393, rounded to the nearest 100 as before: 400; 2.34 times, §9.1)                                                        |
| `MARKET_PRICE_MIN`        | common 5, uncommon 12, rare 18, epic 80, legendary 500, mythic 5 500      | half the reference value, rounded up                                                                                                                                                                         |
| `MARKET_PRICE_MAX`        | common 25, uncommon 57, rare 87, epic 400, legendary 2 500, mythic 27 500 | two and a half times the reference value, rounded down                                                                                                                                                       |
| `MARKET_FEE_BPS`          | 500                                                                       | 5 % of the price, paid by the seller and destroyed                                                                                                                                                           |
| `MARKET_FEE_MIN`          | 1                                                                         | the fee is `max(MARKET_FEE_MIN, ceil(price × MARKET_FEE_BPS / 10 000))`: rounded up, at least 1                                                                                                              |
| `MARKET_LISTING_TTL`      | 7 days                                                                    | an unsold listing expires and its card is available again                                                                                                                                                    |
| `MARKET_MAX_LISTINGS`     | 50                                                                        | active listings per account                                                                                                                                                                                  |
| `MARKET_WINDOW`           | 7 days, rolling                                                           | the window of the four limits below                                                                                                                                                                          |
| `MARKET_WINDOW_PURCHASES` | 100                                                                       | purchases per buyer per window                                                                                                                                                                               |
| `MARKET_WINDOW_SPEND`     | 55 000                                                                    | Karma a buyer spends on the market per window (2.2 times the owner's figure, a manager default, §5)                                                                                                          |
| `MARKET_WINDOW_PROCEEDS`  | 55 000                                                                    | Karma (gross) a seller receives from the market per window (2.2 times the owner's figure, a manager default, §5)                                                                                             |
| `MARKET_WINDOW_PAIR`      | 27 500                                                                    | Karma one buyer pays one seller per window: one Mythic at the upper bound (2.2 times the owner's figure, a manager default, §5)                                                                              |
| `MARKET_PAGE_SIZE`        | 50                                                                        | listings per browse page                                                                                                                                                                                     |
| `MAX_ENTRY_AMOUNT`        | 1 000 000                                                                 | the largest single ledger amount, credit or debit, games included (`owner_reset` excepted, §7)                                                                                                               |
| `MAX_BALANCE`             | 1 000 000 000                                                             | keeps every sum inside a Postgres `integer` (2 147 483 647)                                                                                                                                                  |
| `HOUSE_EDGE`              | 300 to 500 per 10 000                                                     | the owner's 3–5 %; the range items 5 and 6 must land in                                                                                                                                                      |
| `PRIZE_PACK_VALUE`        | 400                                                                       | a prize pack's value in the games' house-edge check: what the shop charges for one                                                                                                                           |

**The market limits, re-checked** (round 3, decision 8). The owner chose the moderate set: 100 purchases and 25 000 Karma spent per buyer, 25 000 received per seller, 12 500 per pair, per rolling 7 days, and asked to re-check that one Mythic at the upper bound fits and to adjust the Karma figures proportionally if not. With five tiers a Mythic at the cap cost 25 000, above the pair limit, and the Karma figures were doubled (50 000, 50 000, 25 000). With six tiers it costs 27 500 (§5.2), above the doubled pair limit too, so the owner's rule is applied again with the smallest factor that fits, 2.2 times the owner's set: **55 000 spent, 55 000 received, 27 500 per pair**; the purchase count stays 100. A Mythic at the cap fits every limit, the pair limit exactly, and the buyer's spend leaves room for a second one in the same week from another seller. The factor is a manager default, 2026-10-29, owner may revise (§16).

Invariants, each a unit test over the file and 1c's tables in `shared/src/rarity.ts`: every value is a positive safe integer; `REFERENCE_VALUE` and `RECYCLE_VALUE` rise with the tier; `RECYCLE_VALUE[r] ≤ REFERENCE_VALUE[r] / 4`; `RECYCLE_VALUE[r] < MARKET_PRICE_MIN[r] − fee(MARKET_PRICE_MIN[r])`, so buying at the floor to recycle always loses and listing at the floor always pays more than recycling; `MARKET_PRICE_MIN[r] ≤ REFERENCE_VALUE[r] ≤ MARKET_PRICE_MAX[r]`; a shop pack's expected recycle value is below `THEMED_PACK_PRICE / 9` (the shop-and-recycle loop contracts, §9.4); `MARKET_PRICE_MAX.mythic ≤ MARKET_WINDOW_PAIR ≤ MARKET_WINDOW_PROCEEDS` and `MARKET_PRICE_MAX.mythic ≤ MARKET_WINDOW_SPEND`; `MAX_RECYCLE_COUNT × RECYCLE_VALUE.mythic ≤ MAX_ENTRY_AMOUNT`; `MAX_BALANCE + MAX_ENTRY_AMOUNT ≤ 2^31 − 1`. `CURRENCY_NAME = "Karma"` is not here: the API never sends the name (§12).

### 5.1 Reference values for six tiers

The reference value of a tier is **inversely proportional to how often its cards are pulled, with Common at 10** (round 3, decision 11), rounded to two significant figures.

- **The rate.** With five tiers every slot rolled the same table, so a tier's per-slot rate was also its share of the cards. 1c ships a different table for each of the five slots (`collection-packs.md` §5.4.1), so there is no single per-slot rate. The rate used here is the per-slot rate averaged over the five slots, which is the tier's share of a standard pack's cards, exact from `SLOT_ODDS`: **Common 56 %, Uncommon 24 %, Rare 16 %, Epic 3.4 %, Legendary 0.55 %, Mythic 0.05 %**. Averaging is what lets the rule reach Uncommon: slot by slot, Uncommon fills slot 4 every time (100 %) and slots 1–3 one time in 15 (6.67 %), and inverting either rate alone would put Uncommon below Common or far above Rare. The special rules are left out because they differ by pack source: Enchanted and pity apply to free packs only, Radiant to every pack (`collection-packs.md` §5.4.7). Reading round 3, decision 11 this way is a manager default, 2026-10-29, owner may revise (§16).
- **The values.** `10 × share_common / share_tier` gives 10, 23.33, 35, 164.71, 1 018.18 and 11 200, which two significant figures round to **10, 23, 35, 160, 1 000 and 11 000**. Two significant figures is the rounding that gave the five-tier values (24.8, 179.6, 1 691.7 and 10 319, from that version's per-slot odds of Rare 27.522 %, Epic 3.7977 %, Legendary 0.4032 % and Mythic 0.0661 % against Common 68.211 %, became 25, 180, 1 700 and 10 000), so it is kept.
- **The result.** Every tier carries about the same share of a standard pack's value (27.2 to 28.0 Karma of reference per pack, 5.4 to 5.6 per card), as before, and the order of values matches the order of rarity.

### 5.2 The numbers per tier

| Tier      | Share of pool | Characters (N = 2 983) | Share of cards (standard pack) | At least one per standard pack | Per character per card | Reference value | Recycle value | Market min | Market max |
| --------- | ------------- | ---------------------- | ------------------------------ | ------------------------------ | ---------------------- | --------------- | ------------- | ---------- | ---------- |
| Common    | 35 %          | 1 044                  | 56 %                           | 99.97 %                        | 1.600 / N              | 10              | 2             | 5          | 25         |
| Uncommon  | 25 %          | 746                    | 24 %                           | 100 %                          | 0.960 / N              | 23              | 5             | 12         | 57         |
| Rare      | 20 %          | 596                    | 16 %                           | 80 %                           | 0.800 / N              | 35              | 8             | 18         | 87         |
| Epic      | 12 %          | 358                    | 3.4 %                          | 17 %                           | 0.283 / N              | 160             | 40            | 80         | 400        |
| Legendary | 6 %           | 179                    | 0.55 %                         | 2.75 %                         | 0.0917 / N             | 1 000           | 250           | 500        | 2 500      |
| Mythic    | 2 %           | 60                     | 0.05 %                         | 0.25 %                         | 0.0250 / N             | 11 000          | 2 750         | 5 500      | 27 500     |

`N` is the pool's character count. The first six columns are 1c's (`collection-packs.md` §5.1.4, §5.1.10, §5.4.1, §5.4.2). The shares are a standard pack's; over the long run of one account's free packs, with Enchanted, pity and Radiant, they are 55.98 / 23.99 / 14.38 / 4.77 / 0.772 / 0.113 % (§5.4.6), which §9 uses for the faucet.

## 6. Sources of Karma (the faucet)

**Karma enters the game only by recycling duplicate cards** (round 3, decision 3, superseding the per-free-pack grant of the earlier drafts), and later by winning games. Recycling a duplicate is a **sale to the game at a fixed price**: the owner chose the player market for every card a player wants to sell at a price of their own (round 1, decision 6), and this fixed-price sale of duplicates as the game's one faucet (round 3). A duplicate is any copy beyond the last one of a character at a rarity: recycling never takes the last copy, so it never removes a character from a collection or lowers completion.

- **The value** is `RECYCLE_VALUE[rarity]`, a quarter of the reference value and half the market floor, so a card someone would buy is always worth more on the market than in the recycler, and the recycler is the floor for cards nobody wants.
- **Rounding**: a quarter of the reference value, **rounded down to a whole number, and at least 1**. Common's 2.5 becomes 2, Uncommon's 5.75 becomes 5 and Rare's 8.75 becomes 8; Epic, Legendary and Mythic divide exactly (40, 250, 2 750). Down, because the recycle value must stay below half the market floor in every tier (otherwise buying at the floor to recycle could pay, §9.4); at least 1, so every duplicate is worth something whatever a later reference value is. Rounding half up would make Common 3, above a quarter of its value, for the most common card of all, the one the faucet turns on most.
- **The value at answer time counts.** A recycle request names the entry and the count, never an amount; the server credits the value in force when it runs, and the receipt's `credited` is the amount that counts (manager decision). Values change only by a deploy (§2), so a confirmation and its answer can differ only across one.

Why this is a bounded faucet: Karma can only come from cards, and cards come from packs, which 1c bounds per account (at most 144 timer packs a day). An account's Karma income is at most the recycle value of the cards it receives, whatever its balance, and a new account's income starts near zero (most of its first cards are new) and rises as its collection fills, Commons first. Cards bought on the market or from the shop can be recycled too, but always for much less than they cost (§9.4).

## 7. Data model

```
accounts (1b, 1c) gains
  balance             integer not null default 0     -- check (balance between 0 and MAX_BALANCE)

ledger_entries                                       -- one row per balance change; never updated or deleted
  id                  uuid pk default gen_random_uuid()
  account_id          uuid not null references accounts(id) on delete cascade
  seq                 integer not null               -- 1, 2, 3 ... per account, assigned under the account lock
  kind                ledger_kind not null           -- enum: recycle_credit, shop_purchase, market_purchase, market_sale,
                                                     --       market_fee, owner_reset (items 5, 6 add wager, payout)
  amount              integer not null               -- signed: a credit > 0, a debit < 0
                                                     -- check (amount <> 0 and (abs(amount) <= MAX_ENTRY_AMOUNT or kind = 'owner_reset'))
  balance_after       integer not null               -- check (balance_after between 0 and MAX_BALANCE)
  created_at          timestamptz not null
  unique (account_id, seq)
  index (account_id, kind, created_at)               -- the rolling-window limits (§10)

pack_openings (1c) gains
  source              opening_source not null default 'timer'   -- enum: timer, shop (items 5, 6 add prize)
  theme_id            text null                      -- 'genre-<slug>'; set exactly when source = 'shop'
  ledger_entry_id     uuid null unique references ledger_entries(id)  -- the shop price; null for a timer pack
  price               integer null                   -- the Karma charged, at that day's THEMED_PACK_PRICE; null for a timer pack
  check ((source = 'shop') = (theme_id is not null) and (source = 'shop') = (ledger_entry_id is not null))
  check ((source = 'shop') = (price is not null) and (price is null or price > 0))

recycles                                             -- one row per recycle: the idempotency record and the receipt
  id                  uuid pk default gen_random_uuid()
  account_id          uuid not null references accounts(id) on delete cascade
  request_id          uuid not null
  request_hash        text not null                  -- SHA-256 of the canonical body (§8.8)
  character_id        integer not null references characters(id)
  rarity              rarity not null
  count               integer not null               -- 1 .. MAX_RECYCLE_COUNT
  unit_value          integer not null               -- Karma per card at recycle time (that day's RECYCLE_VALUE[rarity]); check (unit_value > 0)
  ledger_entry_id     uuid not null unique references ledger_entries(id)   -- the credit
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
  purchase_id         uuid null references market_purchases(id)  -- set on the card a purchase delivered
  escrow_id           uuid null                      -- reserved for a game ante (items 5, 6): always null in item 2;
                                                     -- the games spec adds its foreign key to its round table
  -- opening_id and slot become nullable: a bought card has neither
  check (num_nonnulls(opening_id, purchase_id) = 1)  -- items 5, 6 add their own origin column to this check
  check ((opening_id is null) = (slot is null))
  check (removed_at is not null or (removed_by_purchase is null and removed_by_recycle is null))
  check (removed_at is null or escrow_id is null)
  index (account_id, character_id, rarity, variant) where removed_at is null    -- replaces 1c's index

characters (1c) gains
  search_name         text not null                  -- the overview's normalisation (§8.4) of name, written by snapshot-pool
  search_name_native  text null                      -- the same of name_native

series (1c) gains
  search_title        text not null                  -- the same of title
  search_title_native text null                      -- the same of title_native
```

Rules:

- **The balance is a column; the ledger is its proof.** Reading a balance is one row, the row that is locked anyway; the ledger is the history and the audit. Invariants: `balance` = Σ `amount` = the newest `balance_after`; `seq` runs 1, 2, 3 … with no gap; every shop opening, recycle and purchase has its entries, each of the right account, sign and amount (a recycle's credit is `count × unit_value` and a shop opening's debit is its `price`, the values the row recorded, so a later change of `RECYCLE_VALUE` or `THEMED_PACK_PRICE` leaves old rows correct (manager decision, 2026-10-30); a recycle removed exactly `count` cards); a sold listing has exactly one purchase, and its buyer's debit, the seller's credit and the seller's fee equal its price and fee. `balance_after` and the gapless `seq` make a missing, extra or altered row visible to `audit-ledger` (§13.1).
- **Append-only, enforced by the database too.** The migration revokes `UPDATE` and `DELETE` on `ledger_entries`, `recycles` and `market_purchases` from `anime_app`. Postgres runs referential actions with the table owner's rights, so deleting an account still cascades and still sets the other side's references to null; a route test proves both halves. `market_listings` keeps `UPDATE` for its status.
- **Checks are a backstop.** The domain checks every bound first and answers with a typed error; a database check that fires means a bug, and it fails the transaction instead of writing a negative balance.
- **Held** means `removed_at is null`. **Available** means held, not the card of an active listing, and not in escrow (`escrow_id is null`). **Recyclable** for an entry means `min(held − 1, available)` copies (manager decision): never the last held copy, and never a listed or escrowed one, but a duplicate may be recycled while another copy of the same entry is listed. One copy is always held after a recycle; if the only one left is listed and then sells, that is the player's own sale (any card can be sold, the last copy included). 1c's collection queries, `AccountPublic.cards`, an opening's `isNew` and completion count held cards, listed and escrowed ones included. Listing takes available cards; recycling takes recyclable ones, from the available cards. Removed cards stay as rows, so the sale or recycle that took them can be audited and a replayed opening still returns what it dealt.
- **A bought card is a new row.** The seller's card is marked removed and the buyer gets a new card with the same character, the same granted rarity, the same variant and the same `snapshot_id`, pointing at the buyer's purchase. Rows never change owner, so deleting the seller's account (which cascades through the seller's openings) can never delete a card a buyer holds.
- **Reserved, not built**: `item_kind` and `variant` on listings and purchases are always `card` and `standard` in item 2; `cards.escrow_id` is always null, and nothing in item 2 writes it. Items 5 and 6 will set it on the cards of an ante for the length of a round (escrowed cards are held but not available, so they cannot be listed, recycled or anted twice), then either remove them (lost, or consumed by an upgrade) or clear it (returned), and add their round as a third card origin for an upgrade's result.
- **Deleting an account** removes its ledger, listings, recycles and purchases with it (cascade); the other party's purchase rows keep their own entries and lose only the reference.
- Migration: the next file after 1c's. The four search columns are backfilled for existing rows by the migration, with the same normalisation function (in `shared/`, used by the overview's search too) that `snapshot-pool` uses from then on.

## 8. Behaviour

### 8.1 Balance and ledger

Every balance change runs the same steps inside the transaction of the thing it pays for, after the account row is locked: compute the new balance; refuse with a typed error if it would leave `0 .. MAX_BALANCE`; insert the ledger row with `seq` = previous + 1 and `balance_after`; update `accounts.balance`. One function in `domain/economy/` does this, and it is the only code that writes `accounts.balance` or `ledger_entries`. New accounts start at 0.

### 8.2 Recycling duplicates for Karma

`POST /api/collection/recycle` with a `requestId`, a character, a rarity and a `count`, and no Karma amount (round 3, decisions 2 and 3):

1. The schema bounds the body (`count` 1 to `MAX_RECYCLE_COUNT`); a body with an amount, a value or a credit is an unknown field (400).
2. Lock the account row; handle a replay (§8.8).
3. Lock the held `standard` cards of that (character, rarity) `FOR UPDATE` and compute `recyclable = min(held − 1, available)`. If `count` is more than `recyclable` → 409 `not_enough_copies`; nothing is recycled. **The last held copy is never recycled**, and a group the account does not hold has no cards, so naming another account's cards fails the same way.
4. Credit = `count × RECYCLE_VALUE[rarity]`, at the value in force now (§6). If the balance plus the credit would exceed `MAX_BALANCE` → 409 `balance_limit`.
5. Write the `recycle_credit` entry (+ credit) and the `recycles` row with its `unit_value`, the `RECYCLE_VALUE[rarity]` used (manager decision, 2026-10-30), mark the newest `count` available copies removed by it, update the balance, answer 201 with the receipt: what was recycled, the Karma `credited` and the new `balance`. No card is produced, so the receipt carries none.

Newest first, so the copy that stays is the first one pulled. Every tier can be recycled, Mythic included (a duplicate Mythic recycles for 2 750). A recycle cannot fail for lack of Karma (it costs none) or for want of a pool (it draws nothing): its only refusals are `not_enough_copies`, `balance_limit` (the credit would pass `MAX_BALANCE`) and `request_id_reused`.

### 8.3 Listing a card

`POST /api/market/listings` with a character, a rarity and a price:

1. The schema bounds the body (§11.2); the domain checks `MARKET_PRICE_MIN[rarity] ≤ price ≤ MARKET_PRICE_MAX[rarity]` → else 400 `price_out_of_bounds`.
2. Lock the account row; handle a replay (§8.8).
3. Active listings ≥ `MARKET_MAX_LISTINGS` → 409 `listing_limit`.
4. Select the account's available `standard` cards of that (character, rarity), newest first, `FOR UPDATE`, and take the first. None → 409 `not_enough_copies`.
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

Two buyers of one listing serialise on the seller's account row (and then on the listing): the second finds it `sold` and gets 409 `listing_unavailable`. `unique (listing_id)` on purchases is the backstop.

**Cancel and expiry**

- `POST /api/market/listings/{listingId}/cancel` (empty body): lock the caller's account, then the listing. Another account's listing, or none → 404 `listing_not_found` (an existing listing of someone else is not revealed as such). Already cancelled or expired → 200 with its state (cancel is idempotent). Sold → 409 `listing_unavailable`. Otherwise status `cancelled`, `closed_at` = now, answer 200. The card is available again at once.
- **Expiry** is a property of time: every query treats `expires_at ≤ now` as expired, so a listing can never be bought one second late. The hourly purge the accounts plugin already runs also marks those rows `expired` (one `UPDATE` on listing rows only; it takes no account lock, so it cannot deadlock with a purchase, which takes accounts first).
- **A listed card cannot be recycled** (it is not available) and cannot be listed again until its listing closes.

### 8.6 The Karma shop

Themed packs, bought with Karma (round 1, decision 7), on their own Shop tab (round 3, decision 13), beside the free timer pack, which does not change.

- **Themes**: **every eligible genre, automatically**, as `genre-<slug>` (every character with a membership in a current entry whose `genres` contain the genre), so every themed pack draws across franchises. There are **no franchise packs** (owner, 2026-10-29, superseding round 3, decision 10's franchise packs: "Cut franchise packs, only have themed packs that contain cards from all franchises."). A theme of any other kind needs its own spec and must also draw from all franchises.
- **Eligible** means each of the six tiers of the theme's set holds at least `PACK_SIZE` characters, so the pack draws exactly like the free pack (a Radiant pack can deal five Mythics, `collection-packs.md` §5.1.4). With Mythic at 2 % of the pool, a theme needs about 250 characters spread like the pool to have five Mythics. On the real snapshot (`collection-packs.md` §5.1.10: 2 983 characters) **13 of its 17 genres are eligible**: Action, Adventure, Comedy, Drama, Fantasy, Horror, Mystery, Psychological, Romance, Sci-Fi, Slice of Life, Supernatural and Thriller. Ecchi (2 Mythics), Mecha (4 Mythics), Music (11 characters, no Common) and Sports (1 Mythic) are not. A genre theme is offered while it is eligible; a snapshot update that makes it ineligible takes it out of the shop at once (and `snapshot-pool` lists it).
- **Odds**: the same `SLOT_ODDS` and slot floors as the free pack, so the same per-pack figures (at least once in a standard pack: Common 99.97 %, Uncommon 100 %, Rare 80 %, Epic 17 %, Legendary 2.75 %, Mythic 0.25 %); the character is drawn uniformly within the tier from the theme's set, no repeats in a pack. The special rules apply as `collection-packs.md` §5.4.7 fixes them: a shop pack is **Radiant** with the same 1 in 2 500 as any pack (slots 1–4 from `RADIANT_SLOT_ODDS`, slot 5 Mythic, from the theme's own characters), and it is **never Enchanted or pity-due** and advances neither `free_packs_opened` nor `packs_since_mythic`, though a Mythic from it resets `packs_since_mythic`. Published per theme: `cards` (`PACK_SIZE`), `perSlot` (the five slot tables with their floors), `perPack`, `radiant` (the chance and the slot table), the theme's `tierSizes`, and `franchiseIds`, the franchises its set draws from, computed against the current snapshot (every franchise with a character in the set, possibly 40 or more), in franchise popularity order. A themed pack changes which characters come, not how rare they are.
- **Price**: `THEMED_PACK_PRICE` (400) for every theme (round 3, decision 9).
- **Purchase**, `POST /api/shop/buy` with a `requestId` and a `themeId`, one transaction: lock the account; replay (§8.8); no snapshot → 503 `pool_unavailable`; the theme offered by that snapshot → else 404 `theme_unavailable` (the snapshot first, since the themes are the snapshot's, manager decision, 2026-10-30); balance below the price → 409 `insufficient_funds` with the `balance`; debit the price (`shop_purchase`); run 1c's `dealPack` with the theme's set, writing the opening (`source = 'shop'`, the theme, the entry, the `price` charged); commit; answer 201 with the opened pack and the balance. The allowance is not read or written. The same code deals the free pack and the themed pack.

### 8.7 No tier recycling; upgrades only through the games

There is no route, and no rule, by which cards become a card of a higher tier in item 2 (round 3, decision 2). Upgrades belong to the mini-games (round 3, decision 4, §8.11).

### 8.8 Idempotency

Every state-changing request carries a client `requestId` (uuid), scoped to the account and to its table: shop purchases share 1c's opening keys (`pack_openings`), recycles, listings and purchases each have their own.

- The same `requestId` with the same request: 200 with the original receipt (what was dealt, recycled, listed or bought; the credit or price; the card delivered) and the current balance. Nothing is written.
- The same `requestId` with a different request: 409 `request_id_reused`, nothing written. "Same" is, for a recycle, the SHA-256 of the canonical body (character, rarity, count); for a shop purchase, the theme (a timer opening and a shop purchase never match); for a listing, character, rarity and price; for a purchase, the listing id.
- A request refused with any error leaves no record, so its key can succeed later.

### 8.9 Concurrency and bounds

- **One lock order**: account rows first, in ascending id order when there are two; then listing rows; then card rows; then the ledger. Every path keeps it: a timer or shop opening (account, cards), a recycle (account, cards), a listing (account, cards), a cancel (account, listing), a purchase (both accounts, listing, card), the reset (account, listings, cards). Two purchases in opposite directions (A buys from B while B buys from A) both lock the lower id first, so they cannot deadlock; a test proves it.
- **Double recycle**: two parallel recycles of an entry's last duplicate → one 201, one 409 `not_enough_copies`; credited once.
- **Double buy**: two buyers of one listing → one 201, one 409 `listing_unavailable`; the seller is credited once.
- **Buy versus cancel**: one wins; a cancelled listing cannot be bought, a sold one cannot be cancelled.
- **Double spend**: two parallel spends (shop and shop, shop and purchase) with the balance for one → one 201, one 409 `insufficient_funds`.
- **Listing versus recycle** for the same copies: both lock the entry's cards, so whichever runs second sees the other's result; a recycle never takes a listed card and never leaves zero held copies.
- **No negative balance**: a debit is written only after the domain has seen, under the lock, a balance that covers it; the check constraint is the backstop.
- **No overflow**: the schema caps every price, count and id; the parameters cap every amount and balance so every intermediate sum stays inside `integer` (§5); the ledger function asserts `Number.isSafeInteger` on every value it writes. JSON edge cases are schema rejections, never arithmetic: `1e400` (Infinity), `9007199254740993`, `1.5`, `-0`, `"5"` and `null` → 400.
- **Server time only**: `created_at`, `expires_at`, `removed_at` and the limit windows come from the server clock.

### 8.10 Reset

1c's `reset-collection` (`collection-packs.md` §5.6) gains, in the same transaction after the account lock: every active listing of the account is cancelled (nobody can buy a cancelled listing); all the account's cards are deleted, whatever their origin (listings keep their history with `card_id` set to null); and the Karma rule (round 3, decision 5, superseding this spec's earlier recommendation of always zero): **the owner chooses per reset**. By default the balance goes to 0 with one `owner_reset` entry of `− balance` (none when it is already 0), so the ledger stays gapless and auditable; with `--keep-karma` the balance stays and no entry is written. The dry run prints the balance and which of the two will happen. The account's past purchases and sales stay in the ledger and in the other parties' receipts. The account's recycles stay with their credits while the cards they removed are deleted with the rest, so after a reset a recycle holds no removed card; before one it holds exactly `count` (manager decision, 2026-10-30).

### 8.11 What items 5 and 6 add

The ledger and the cards serve blackjack and slots without a change to their tables beyond adding values and a foreign key:

- `ledger_kind` gains `wager` (debit) and `payout` (credit). Each game's round table points at its ledger rows, as `recycles` does; the ledger knows nothing about games.
- **Card antes and upgrades** (round 3, decision 4). The games are the only way to upgrade: the owner's example is an ante of five Legendary cards that results in a Mythic if the game is won. A round that takes cards as an ante sets `cards.escrow_id` to the round on each of them under the account lock, in the round's own transaction, so they stay in the collection but cannot be listed, recycled or anted again; the outcome then removes them (lost, or consumed by the upgrade) or clears `escrow_id` (returned), and a won upgrade inserts the new card with the round as its origin. A round that ends unresolved (a crash) is resolved by the games spec's rule, never by leaving cards in escrow forever. The games spec sets the ante rules, the odds and their published tables.
- The same account lock and order, the same §8.1 function, the same `MAX_ENTRY_AMOUNT` for a wager or a payout, the same `requestId` pattern.
- Table limits are fixed numbers in `shared/src/economy.ts`, never a share of the balance.
- A game's house edge, computed exactly in integers from its published paytable, lies within `HOUSE_EDGE`, with every prize pack counted at `PRIZE_PACK_VALUE` (the shop's price) and every card at stake counted at its reference value.
- Prize packs are a separate, capped counter consumed by 1c's `dealPack` with `source = 'prize'`.

### 8.12 Rate limits and logging

`CARD_ACTION_RATE_LIMIT` (30/min per client address) on recycle, the shop purchase, listing, buying and cancel, each replacing the global bucket for its route; the GET routes use the global bucket. At `info`, with the request id: recycled (account, character, rarity, count, credit, balance after); shop pack bought (account, theme, price, balance after); listed, cancelled, expired (listing, seller, character, rarity, price); bought (listing, buyer, seller, price, fee, both balances after); each with whether it was a replay. At `warn`: a purchase refused by `market_limit`, with the limit hit. Never a whole request body.

## 9. The model: faucet, sinks and the bound on growth

### 9.1 Values per pack

With §5.1's reference values and §6's recycle values, per pack kind. A pack's expected cards of a tier are the sum of its five slot tables for that tier (`collection-packs.md` §5.4.1, §5.4.3):

| Pack                                                                                    | Expected cards, Common / Uncommon / Rare / Epic / Legendary / Mythic | Reference value | Recycle value, were every card a duplicate |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------- | ------------------------------------------ |
| Standard                                                                                | 2.8 / 1.2 / 0.8 / 0.17 / 0.0275 / 0.0025                             | 165.80          | 38.55                                      |
| Enchanted (every 10th free pack)                                                        | 2.8 / 1.2 / 0 / 0.85 / 0.1375 / 0.0125                               | 466.60          | 114.35                                     |
| Pity (slot 5 Mythic)                                                                    | 2.8 / 1.2 / 0 / 0 / 0 / 1                                            | 11 055.60       | 2 761.60                                   |
| Radiant (1 in 2 500)                                                                    | 0 / 0 / 0 / 3.4 / 0.55 / 1.05                                        | 12 644.00       | 3 161.00                                   |
| **Shop pack**: standard or Radiant, never Enchanted or pity (§8.6)                      | 2.79888 / 1.19952 / 0.79968 / 0.171292 / 0.027709 / 0.002919         | **170.79**      | **39.80**                                  |
| **Free pack**, over the long run with every rule (`collection-packs.md` §5.4.6's chain) | 2.79888 / 1.19952 / 0.718775 / 0.238568 / 0.038592 / 0.005665        | **219.81**      | **52.11**                                  |

A standard pack is 2.8 × 10 + 1.2 × 23 + 0.8 × 35 + 0.17 × 160 + 0.0275 × 1 000 + 0.0025 × 11 000 = 28.0 + 27.6 + 28.0 + 27.2 + 27.5 + 27.5 = **165.80** at reference, and 2.8 × 2 + 1.2 × 5 + 0.8 × 8 + 0.17 × 40 + 0.0275 × 250 + 0.0025 × 2 750 = 5.60 + 6.00 + 6.40 + 6.80 + 6.875 + 6.875 = **38.55** recycled (a little under a quarter of 165.80, because the values round down). A shop pack is Radiant with chance 0.0004 and standard otherwise: 0.9996 × 165.80 + 0.0004 × 12 644 = **170.79** at reference, 0.9996 × 38.55 + 0.0004 × 3 161 = **39.80** recycled. A themed pack costs 400, 2.34 times its cards' reference value (round 3, decision 9: about 2.3; 170.79 × 2.3 = 393, rounded to the nearest 100 as the five-tier 391 was) and about ten times (10.05) what its cards return in the recycler. A free pack is worth more than a shop pack, because every 10th is Enchanted and pity guarantees a Mythic within 300; it costs nothing, so its value is the faucet's term (§9.2), not the shop's.

### 9.2 Faucet

Karma has one source until the games: recycling duplicates. Cards come from packs, which 1c bounds per account (at most 144 timer packs a day). The figures below are upper bounds that assume every card is a duplicate, at a free pack's long-run 52.11 per pack; a new account earns far less, because most of its first cards are new, and approaches them as its collection fills (§9.2.1).

| Player                                                                                          | Timer packs a day | Karma a day, at most | Themed packs it pays for |
| ----------------------------------------------------------------------------------------------- | ----------------- | -------------------- | ------------------------ |
| Casual: three visits a day, `PACK_CAP` packs each                                               | 9                 | 469                  | 1.2                      |
| Active: opens each pack as it arrives for 16 waking hours, plus the `PACK_CAP` stored overnight | 99                | 5 159                | 12.9                     |
| Ceiling: every pack, 24 hours a day; a script does no better, because the timer is the limit    | 144               | 7 505                | 18.8                     |

The ceiling is a hard bound per account and does not depend on the balance. Market income is not a faucet: it is other players' Karma.

#### 9.2.1 How fast duplicates come, on the real pool

An account that keeps one copy of everything holds a given character of tier `t` after `n` free packs with chance `1 − (1 − c_t / size_t)^n`, where `c_t` is a free pack's long-run expected cards of tier `t` (§9.1) and `size_t` the tier's characters on the real snapshot (1 044 / 746 / 596 / 358 / 179 / 60, `collection-packs.md` §5.1.10). The next pack's expected duplicates are `Σ c_t × that chance`, and its expected recycle value is the same sum weighted by `RECYCLE_VALUE[t]`. This averages the Enchanted cadence and treats packs as independent; recycling never takes the last copy, so a character once held stays held.

| Free packs opened so far | Duplicates in the next pack (of 5) | Karma they recycle for | Share of the 52.11 bound |
| ------------------------ | ---------------------------------- | ---------------------- | ------------------------ |
| 9 (one casual day)       | 0.09                               | 0.37                   | 0.7 %                    |
| 99 (one active day)      | 0.93                               | 3.80                   | 7.3 %                    |
| 300                      | 2.27                               | 9.91                   | 19 %                     |
| 1 000                    | 4.20                               | 21.96                  | 42 %                     |
| 3 000                    | 4.91                               | 33.83                  | 65 %                     |
| 10 000                   | 4.99                               | 44.93                  | 86 %                     |
| 30 000                   | 5.00                               | 51.18                  | 98 %                     |

Commons repeat first (half of them are held after about 260 free packs) and Mythics last (half after about 7 300), so the count of duplicates nears five per pack long before their Karma nears the bound. Summed: a casual player can recycle about 1 300 Karma in the first 30 days and 81 000 in the first year (about 220 a day against the bound's 469); an active one about 70 500 and 1 654 000 (4 530 a day against 5 159); one at the ceiling about 118 700 and 2 506 000 (6 860 a day against 7 505).

### 9.3 Sinks

- **The shop**, the main sink: 400 Karma destroyed per themed pack, of which 39.80 on average can come back through recycling its cards.
- **The market fee**: 5 % of every sale's price destroyed (at least 1).
- **Owner resets**, when the owner does not keep the Karma.
- **Games** (items 5, 6) keep `HOUSE_EDGE` of every wager.
- Recycling, a fixed-price sale of duplicates to the game, is the faucet in Karma and a sink in cards: every recycle destroys the cards it credits.

### 9.4 Why it does not inflate

Let `C` be the Karma credited by recycling in a day, `S` spent in the shop and `F` market fees, summed over accounts. The total Karma in the game changes by `C − S − F` a day; market trades cancel out apart from `F`.

1. **Karma grows at most linearly**, by at most `N × 7 505` a day for `N` accounts (75 050 at the ten-account cap), and by less with every pack bought or fee paid. It does not depend on balances.
2. **The shop-and-recycle loop contracts.** A themed pack costs 400 and its cards recycle for 39.80 on average, so every shop pack destroys 360.20 Karma net on average, and spending all Karma on packs and recycling their cards converges: an account at the ceiling can fund at most `7 505 / 360.20 ≈ 20.8` themed packs a day, about 14 % more packs than its free ones.
3. **The market cannot be used to mint.** A card bought at the floor recycles for less than half of what it cost (`RECYCLE_VALUE < MARKET_PRICE_MIN`), and a card sold at the floor nets more than it would recycle for, so there is no buy-to-recycle arbitrage and no reason to recycle a card someone wants.
4. **Cards grow at most linearly.** Per account: 720 a day from timer packs, at most 104 from themed packs, about 14 bought; recycling only removes cards. No recycling upgrade exists, so the upper tiers come only from packs (later also from games), at the pull rates of §5.2 and §9.1.
5. **Prices cannot run away.** Market prices are the players', but bounded per tier between half and two and a half times the reference value; a growing pile of idle Karma can push prices to the cap and no further. At the cap a Mythic costs 27 500, 68.75 themed packs. Shop prices, recycle values and fees are fixed numbers, not shares of a balance.
6. **Accounts pooling Karma** is bounded by §10, not by this model.

### 9.5 What grows without bound

- **A balance that is never spent**, linearly: at most 7 505 a day from its own duplicates plus at most 52 250 net per seven days from the market (§10), about 15 000 a day in all. `MAX_BALANCE` is about 183 years away at that rate; it keeps the arithmetic in range, and `balance_limit` is the answer if it is ever reached.
- **Cards that are never listed or recycled**, linearly: at most about 840 a day per account.
- **Ledger rows**: one per action, at most a few hundred a day for a busy account.

Nothing grows faster than linearly, and nothing grows because a balance is large. A unit test recomputes §5.1, §5.2 and §9.1 to §9.5 from `shared/src/economy.ts` and `shared/src/rarity.ts` (the free pack's long-run figures by 1c's exact chain over the two counters), so a parameter change that moves these numbers fails until this section is updated; §9.2.1 depends on the real snapshot's tier sizes and is an illustration, not a parameter check.

## 10. Anti-farming

This is an invite-only game in which one person could hold several accounts (one invite code is reusable, `accounts-api.md` §6.2), and the market makes Karma and cards movable between accounts. The attack: open free packs on alternate accounts, sell their duplicates to the game through the recycler (the one fixed-price sale the game makes, §6), and move the Karma or the best cards to one main account, for example by listing a worthless card on the main at the cap and buying it from each alternate. Each alternate's recycling is bounded like any account's (at most 7 505 a day, from its own packs), and moving duplicates to the main to recycle there instead gains nothing, because the main pays at least the market floor for a card that recycles for at most half of it. The limits run over a rolling seven days rather than one day because a single Mythic near the cap (up to 27 500) is several days of anyone's Karma. The controls:

| Control                   | Rule                                                                                                                                                                                                                                                                          | What it bounds                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fee                       | 5 % of every sale destroyed (round 3, decision 6)                                                                                                                                                                                                                             | every Karma moved between accounts loses a twentieth                                                                                                     |
| Price bounds per tier     | 0.5 × to 2.5 × the reference value (round 3, decision 7); the tier is the card's granted rarity, which the seller cannot choose                                                                                                                                               | junk cannot carry large sums: a Common at most 25, an Uncommon 57, a Rare 87, an Epic 400; only Legendaries (2 500) and Mythics (27 500) carry thousands |
| Window limits per account | per rolling 7 days: a buyer makes at most 100 purchases and spends at most 55 000; a seller receives at most 55 000 gross (round 3, decision 8, Karma figures scaled 2.2 times, §5, a manager default)                                                                        | a main account receives at most 52 250 net per 7 days (about 7 460 a day) from **all** other accounts together, however many there are                   |
| Pair limit                | one buyer pays one seller at most 27 500 per 7 days                                                                                                                                                                                                                           | one alternate account alone can feed at most 26 125 net per 7 days                                                                                       |
| No self-trade             | buying one's own listing → 409 `own_listing`                                                                                                                                                                                                                                  | the trivial case; it cannot detect two accounts of one person                                                                                            |
| Audit (`audit-market`)    | the owner's report (§13.3): net Karma flow per pair over 7 and 30 days; pairs where one side makes more than half of the other's market volume; sales at the bounds; listings bought within 60 s of being listed; buyers and sellers who registered with the same invite code | detection after the fact                                                                                                                                 |
| Owner remedies            | `reset-collection` (cards to zero, Karma to zero unless `--keep-karma`, §8.10), deleting an account, rotating `INVITE_CODES`                                                                                                                                                  | what the owner does with a finding                                                                                                                       |

**Residual risk, plainly.** The server cannot tell two people from one person with two accounts. One person with several accounts can move up to 52 250 Karma net per seven days into one account (the seller-side window cap less the fee), about 7 460 a day, against that account's own ceiling of 7 505 a day from recycling: multi-accounting can roughly double one account's Karma income (1.99 times), never more, whatever the number of accounts. Scaling the owner's Karma limits (§5) so that one Mythic fits the pair limit scaled this ceiling too. Cards move the other way under the buyer's limits: at most 100 cards and 55 000 Karma per seven days, for example 10 Mythics or 100 Legendaries at the floor price. Detection is after the fact and heuristic, and the remedy is the owner's. The roster is capped (`ACCOUNT_CAP`, 10) and every account comes from an invite the owner hands out, which is the real control.

## 11. Contract (`shared/src/api.ts`, `shared/src/errors.ts`)

### 11.1 Error codes

New: `not_enough_copies` (409), `balance_limit` (409), `insufficient_funds` (409), `request_id_reused` (409), `price_out_of_bounds` (400), `listing_limit` (409), `listing_not_found` (404), `listing_unavailable` (409), `own_listing` (409), `market_limit` (409) and `theme_unavailable` (404). `pool_unavailable` (503) is 1c's.

`ErrorEnvelope.error` gains two optional fields, each present only on its code: `balance: integer ≥ 0` on `insufficient_funds` (the acting account's balance under the lock, so the UI can say what it has without another request), and `limit: "buyer_purchases" | "buyer_spend" | "seller_proceeds" | "pair"` on `market_limit` (which limit was hit, so a buyer refused by the seller's proceeds or the pair limit is not told to wait for room it already has). `market_limit` also carries `retryAfterSeconds` and `Retry-After`; that field's comment in `errors.ts` widens to it.

### 11.2 Schemas

```
KarmaRules        { referenceValues: PerRarity, recycleValues: PerRarity, priceMin: PerRarity, priceMax: PerRarity,
                    feeBps: integer, feeMin: integer,                -- fee(price) = max(feeMin, ceil(price × feeBps / 10 000)): rounded up, at least feeMin (1)
                    listingTtlSeconds: integer, maxListings: integer, maxRecycleCount: integer, themedPackPrice: integer,
                    window: { seconds: integer, purchases: integer, spend: integer, proceeds: integer, pair: integer } }
Wallet            { balance: integer ≥ 0, activeListings: integer ≥ 0, rules: KarmaRules }
ThemeOffer        { id: string, title: string, cards: integer,          -- id genre-<slug>; cards = PACK_SIZE
                    franchiseIds: integer[],                         -- the computed set, in franchise popularity order (§8.6)
                    price: integer,
                    odds: { scale: integer, perSlot: SlotOdds[PACK_SIZE],     -- 1c's: the five slot tables with their floors
                            perPack: PerRarity, tierSizes: PerRarity,
                            radiant: { chance: integer, odds: PerRarity, lastSlot: Rarity } } }   -- 1c's PublishedOdds.radiant; shop packs can be Radiant (§8.6)
ShopResponse      { themes: ThemeOffer[], franchises: FranchiseRef[], snapshot: SnapshotInfo | null }
ShopBuyBody       { requestId: uuid, themeId: string(1..64) }
ShopReceipt       { pack: PackOpened, themeId: string, price: integer, balance: integer ≥ 0 }
RecycleBody       { requestId: uuid, characterId: integer ≥ 1, rarity: Rarity, count: integer 1..MAX_RECYCLE_COUNT }   -- no Karma amount
RecycleReceipt    { recycleId: uuid, recycledAt: date-time,
                    recycled: { characterId: integer, rarity: Rarity, count: integer ≥ 1 },
                    credited: integer ≥ 1, balance: integer ≥ 0 }   -- no card: nothing is produced
ReceivedCard      { kind: "card", character: CharacterPublic, rarity: Rarity, variant: CardVariant, isNew: boolean }
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
CollectionEntry   (1c) gains listed: integer ≥ 0, available: integer ≥ 0, recyclable: integer ≥ 0
                                                                     -- available = count − listed − escrowed; recyclable = min(count − 1, available)
```

`PerRarity` (six tiers), `SlotOdds`, `Rarity`, `CardVariant`, `CharacterPublic`, `FranchiseRef` (a franchise's title is that of its anchor entry, the smallest AniList id among its top-100 entries, `collection-packs.md` §5.1.2), `SnapshotInfo` and `PackOpened` are 1c's. `PackOpened` gains nothing: a free pack grants no Karma. Every number the UI shows per tier comes from `Wallet.rules`: the reference value, the recycle value, the market minimum and maximum, and the fee rule (`feeBps`, `feeMin`). `Wallet.activeListings` is 0 until PR 3 adds the market, then the caller's active, unexpired listings, so the UI can show the listing cap before a request. `kind` and `variant` are the reserved slots for Relics and Masterworks; in item 2 they can only be `"card"` and `"standard"`, and a request never carries either. No request carries an amount, a balance, an account id or a card id; the only price a request carries is the seller's asking price in `ListBody`, which the server bounds. A body naming anything else fails as an unknown field.

### 11.3 Routes

| Method, path                                   | Body          | Success                                                     | Errors (status, code)                                                                                                                                                      | Limit  |
| ---------------------------------------------- | ------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `GET /api/wallet`                              | —             | 200 `Wallet`                                                | 401 `unauthenticated`                                                                                                                                                      | global |
| `GET /api/shop`                                | —             | 200 `ShopResponse`                                          | 401 `unauthenticated`                                                                                                                                                      | global |
| `POST /api/shop/buy`                           | `ShopBuyBody` | 201 `ShopReceipt`; 200 on a replay                          | 400 `validation_failed`, 401, 404 `theme_unavailable`, 409 `insufficient_funds`, 409 `request_id_reused`, 503 `pool_unavailable`                                           | 30/min |
| `POST /api/collection/recycle`                 | `RecycleBody` | 201 `RecycleReceipt`; 200 on a replay                       | 400 `validation_failed`, 401, 409 `not_enough_copies`, 409 `balance_limit`, 409 `request_id_reused`                                                                        | 30/min |
| `GET /api/market/listings`                     | — (query)     | 200 `ListingsPage`                                          | 400 `validation_failed`, 401                                                                                                                                               | global |
| `GET /api/market/mine`                         | —             | 200 `MarketMine`                                            | 401                                                                                                                                                                        | global |
| `POST /api/market/listings`                    | `ListBody`    | 201 `Listing`; 200 on a replay                              | 400 `validation_failed`, 400 `price_out_of_bounds`, 401, 409 `not_enough_copies`, 409 `listing_limit`, 409 `request_id_reused`                                             | 30/min |
| `POST /api/market/listings/{listingId}/buy`    | `BuyBody`     | 201 `PurchaseReceipt`; 200 on a replay                      | 400 `validation_failed`, 401, 404 `listing_not_found`, 409 `listing_unavailable`, 409 `own_listing`, 409 `market_limit`, 409 `insufficient_funds`, 409 `request_id_reused` | 30/min |
| `POST /api/market/listings/{listingId}/cancel` | `{}`          | 200 `Listing`                                               | 400 `validation_failed`, 401, 404 `listing_not_found`, 409 `listing_unavailable`                                                                                           | 30/min |
| `GET /api/collection`                          | —             | 1c's, with `listed`, `available` and `recyclable` per entry | as 1c                                                                                                                                                                      | global |

`listingId` in a path is a uuid (anything else → 400). `GET /api/wallet`, `/api/shop`, `/api/market/mine` and `/api/collection` take `NoQuery`; `GET /api/market/listings` takes `ListingsQuery`, `additionalProperties: false`, no coercion beyond the declared integers. The POSTs are behind the CSRF check, and their response schemas also declare 403 `bad_origin` and 429 `rate_limited`. The 30/min is `CARD_ACTION_RATE_LIMIT`.

## 12. What the UI needs (PRs 2 and 4)

`ui-designer` designs the screens (`collection-overview.md`, `market-and-shop.md`); this lists what they need back and the rules they keep. The owner's UI decisions (round 3, decision 13): **no Karma icon**; amounts read `<n> Karma`; the list-price field starts empty with the bounds shown; the shop is its own **Shop** tab. The name is one line in `web/src/lib/copy.ts`; code says `balance` and `amount`, never the name. Numbers are whole, through `Intl.NumberFormat`, with no symbol that suggests real money. Six tiers everywhere a rarity appears.

- **Wallet**: `balance` from `GET /api/wallet`, then from each receipt. The UI never computes a balance. `rules` is shown next to the actions it governs (ADR 0004 §6); none of it is a constant in `web/` (1c's lint rule forbids importing `@anime-tcg/shared/economy`).
- **Recycle for Karma** (the card dialog's section, PR 2): offered when the entry's `recyclable` is at least 1 (the server's number, `min(copies − 1, unlisted copies)`, so the last copy and listed copies are never offered). It shows the value per copy (`rules.recycleValues` for the entry's rarity), that the last copy is always kept, and a count from 1 to `recyclable` (at most `maxRecycleCount`); the total it shows before confirming is count × value. The request carries only the count; the answer carries the Karma `credited` and the new `balance`, and if `credited` differs from the total shown (a value changed by a deploy in between), the UI shows the server's amount. The UI then refetches the collection. Recycling never produces a card, so there is no reveal, and it never answers `insufficient_funds` or `pool_unavailable`.
- **Shop** (the Shop tab, PR 2): the themes from `GET /api/shop`, each with its title, franchises, `cards`, price and published odds (`perPack` as the headline, `perSlot`, `radiant` and `tierSizes` on request); a buy sends one `ShopBuyBody`, keeping its `requestId` only when no answer arrived, as 1c's pack does; the receipt's pack is revealed like a timer pack; `insufficient_funds` shows the price and the error's `balance`; `theme_unavailable` refetches the shop. The free timer pack keeps its own control on the `/packs` page (`navigation-and-landing.md`).
- **Market, browse and filter** (PR 4): `GET /api/market/listings` with rarity, franchise, character, search text and sort as query parameters, `filterFranchiseIds` for the franchise options and `nextCursor` for more; each listing with its character, rarity, price and expiry; `mine` listings cannot be bought from the UI (the server refuses too).
- **Market, buy**: one request with the listing id and a `requestId`, no price; the confirmation shows the listing's price and the balance; `listing_unavailable` and `listing_not_found` say the listing is gone and refetch; `market_limit` names the limit from the error's `limit` and shows the wait from `retryAfterSeconds`; `insufficient_funds` the price and the error's `balance`.
- **Market, list** (the card dialog's section, PR 4): from a collection entry with `available ≥ 1`, while `activeListings` is below `maxListings`: a price field, **empty at first, with the bounds `priceMin` and `priceMax` for the entry's rarity shown**, then the fee and the net (`price − fee`, computed as `max(feeMin, ceil(price × feeBps / 10 000))` from the wallet's rules, labelled as an estimate the receipt confirms); the confirmation says when the card is the last copy (any card can be listed, the last copy included) and that it stays in the collection until it sells.
- **Market, mine and cancel**: `GET /api/market/mine` for active listings (with cancel), closed ones with `closedAt` and proceeds, purchases and `left` for the window limits.
- **Errors**: `not_enough_copies` and `request_id_reused` → the collection changed: refetch and say so; `balance_limit` → a plain refusal; `pool_unavailable` → 1c's cards-unavailable state; `unauthenticated` → session ended; a network failure → the unreachable banner.
- **No nags** (ADR 0004 §6): no "sell now", "recycle now" or "buy now" prompts, no celebration of a growing balance or of a Mythic, no countdowns tied to Karma, no scarcity wording on listings.

## 13. Owner-side commands

Each runs inside the api container, is unit-tested through its exported function, and is documented in `docs/04-deployment.md` under "Operations".

### 13.1 `audit-ledger` (PR 1, extended in PR 3)

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/audit-ledger.js
```

Read-only. Checks every account against §7's invariants (balance, sums, gapless `seq`, every shop opening, recycle and purchase with its entries of the right sign and amount, every recycle with exactly `count` removed cards (or none, after a reset, §8.10), every sold listing with exactly one purchase whose three entries match its price and fee, every bought card with its purchase, no card in escrow) and prints `Ledger consistent: 10 accounts, 1234 entries.`, or one line per failing account and exit 1. Run it before a release and after any restore (C16). The route suites run it once at the end against the test database. Shop openings are checked from the opening to its debit only, since a reset deletes the openings and keeps their `shop_purchase` entries (manager decision, 2026-10-30). A recycle's credit is checked against `count × unit_value` and a shop debit against the opening's `price`, never against today's constants; a row whose `unit_value` or `price` differs from today's `RECYCLE_VALUE` or `THEMED_PACK_PRICE` is printed as a `Note:` line on stdout, information that never changes the exit code (manager decision, 2026-10-30).

### 13.2 Themes need no command

The shop needs no owner command: every eligible genre is offered automatically (§8.6), and there are no franchise packs (§16). The `pack-themes` command of the earlier drafts is removed with them.

### 13.3 `audit-market` (PR 3)

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/audit-market.js [--days 30]
```

Read-only. Prints the §10 report: net Karma per account pair over 7 and 30 days, largest first; pairs where one side makes more than half of the other's market volume; counts of sales at the price bounds per seller; listings bought within 60 seconds of being listed, with buyer and seller; accounts that registered with the same invite code and traded with each other. Prints `No findings.` when there is nothing; exit 0 either way (findings are for the owner to judge, not failures).

### 13.4 `reset-collection` (1c, extended in PR 1 and PR 3)

```bash
docker compose ... exec -T api-production node api/dist/cli/reset-collection.js <login> [--keep-karma] [--confirm]
```

1c's command (`collection-packs.md` §7.2) with §8.10's additions; `--keep-karma` keeps the balance, without it the balance goes to 0. The dry run (no `--confirm`) prints the cards, listings and balance it would remove or keep.

## 14. Tests required (minimum, T3)

**Unit** (`api/src/domain/economy/*.test.ts`, `api/src/domain/market/*.test.ts`, `shared/`): §5's invariants; §5.1's reference values recomputed from `SLOT_ODDS` and §5.2's table; the recycle values (a quarter of the reference value, rounded down); §9 recomputed from the parameters; the fee function (rounding up, minimum 1, at every bound of all six tiers); recycle rules (`recyclable = min(held − 1, available)`, listed and escrowed copies never taken, newest first, credit, every tier including Mythic); genre theme sets and eligibility across six tiers; a shop pack's plan is Radiant at `RADIANT_ODDS`, never Enchanted or pity-due, and leaves both counters unchanged, while a Mythic from it resets `packs_since_mythic`; the rolling-window limits and their `retryAfterSeconds`; the ledger function (`seq`, `balance_after`, every bound refusal, `Number.isSafeInteger`); canonical request matching for every replay kind; the market search's escaping of `%`, `_` and `\`.

**Route** (`api/test/economy.test.ts`, `api/test/market.test.ts`): every row of §11.3, the happy path and each declared error; an extra field → 400; a query string on a `NoQuery` GET → 400; an unknown query parameter on the listings GET → 400; a missing Origin → 403; signed out → 401; a timer opening credits no Karma; recycling `count` duplicates credits exactly `count × RECYCLE_VALUE` and removes that many copies, newest first; recycling the last copy → 409, and with two copies both listed → 409; `recyclable` = `min(held − 1, available)`, so with three copies and one listed two can be recycled, and with two copies and one listed the unlisted one can; a recycle at `MAX_BALANCE − 1` → 409 `balance_limit`, nothing written; a shop purchase debits 400, deals `PACK_SIZE` cards only from the theme's set and leaves the allowance unchanged; every eligible genre is on offer without a command, and an ineligible genre, an unknown theme id and a `franchise-` id → 404 `theme_unavailable`; listing the last copy succeeds and the entry shows `listed: 1, available: 0, recyclable: 0`; a listed card cannot be recycled or listed again; a purchase moves exactly the price and the 5 % fee, removes the seller's card and gives the buyer a new card with the same character, rarity, variant and snapshot; an expired listing is not returned and cannot be bought, sits under `mine.closed` as `expired` before and after the purge marks it, and never under `mine.active`; cancel is idempotent and a closed listing carries `closedAt`; `insufficient_funds` carries the balance and `market_limit` the limit that was hit, for each of the four limits; one Mythic at 27 500 can be bought from one seller in an empty window; the first browse page lists every franchise with an active listing and later pages `null`; a search for a native name and for a native franchise title finds the listing; `Wallet.activeListings` follows listing, cancel, sale and expiry; deleting a seller's account leaves the buyer's card and receipt intact; the reset cancels listings and deletes every card, and zeroes the balance with one `owner_reset` entry, or with `--keep-karma` leaves it untouched with no entry; the app role can neither update nor delete a ledger, recycle or purchase row; `audit-ledger` passes on the database each suite leaves behind.

**Concurrency** (parallel `inject()` calls):

- Two recycles of an entry's last duplicate → one 201, one 409 `not_enough_copies`; one credit.
- Ten parallel recycles of one copy each against five duplicates (six copies) → exactly five 201 and one copy left.
- Two buyers of one listing → exactly one 201 and one 409 `listing_unavailable`; one purchase row; the seller credited once.
- A buy and a cancel of one listing → exactly one succeeds.
- A buys B's listing while B buys A's, 50 times in parallel pairs → every request finishes (no deadlock, no lock timeout) and the ledgers balance.
- Two spends with the balance for one (shop and shop, shop and purchase) → one 201, one 409 `insufficient_funds`, balance ≥ 0.
- A listing and a recycle racing for an entry's copies → the recycle never takes the listed card and never leaves zero held copies.
- A recycle racing the account's timer opening → both succeed and `seq` stays gapless.
- The same `requestId` twice in parallel on each POST → one 201 and one 200 with the same receipt.
- 101 parallel purchases by one buyer within a window → 100 at most succeed; purchases pushing a seller past `MARKET_WINDOW_PROCEEDS` → refused with `market_limit` exactly at the bound.

**Adversarial** (`api/test/security/economy.security.test.ts`, `market.security.test.ts`):

- **Double buy** of one listing by two buyers → exactly one success (as above, also through two separate app instances on one database).
- **Buying your own listing** → 409 `own_listing`, nothing written.
- **Price tampering** is impossible because the server holds the price: a buy body with `price`, `amount`, `fee`, `characterId` or `sellerId` → 400; a recycle body with `value`, `credit` or `amount` → 400; a listing whose price is outside the bounds for its rarity, or a listing claiming a rarity the card does not have → 400 or 409 `not_enough_copies`; after a listing, no request can change its price (there is no route).
- **Listing or recycling a card you do not own**: a character only another account holds, a character that does not exist, a rarity you do not hold it at → 409 `not_enough_copies`, and the other account's cards are unchanged; a body with `cardId` (another account's real card uuid), `kind`, `variant` or `escrowId` → 400.
- Cancelling another account's listing → 404, its state unchanged; buying a listing id that does not exist or is not a uuid → 404 or 400.
- Negative, zero, fractional, string, `null`, `1e400`, `9007199254740993` and over-maximum prices, quantities and ids → 400, nothing written.
- Overflow: a seller at `MAX_BALANCE − 1` whose listing is bought → refused, nothing written; a buyer one below the price → 409 `insufficient_funds`; 100 Mythic duplicates recycled in one request stay inside `MAX_ENTRY_AMOUNT`.
- Replay: the same key and request → one action; the same key with another request → 409 `request_id_reused`; account B sending A's key → B's own outcome.
- No path from nothing to Karma: an account with no duplicates calls every route; its balance is unchanged. No path from Karma to the timer: a shop purchase never changes `packs_anchor_at`. No upgrade path: no route turns cards into a card of a higher tier (route inventory).
- Mint loops: buying a card at the floor and recycling it loses Karma for every tier; buying a themed pack and recycling every card it deals loses at least 360 Karma in expectation.
- Farming: two accounts trading a Common back and forth at the cap → each round loses the fee; the window and pair limits stop the flow at their bounds; `audit-market` reports the pair.
- Hostile strings: a genre name with `<script>` and an RTL override (through a fixture snapshot), and a search `q` of `%`, `_`, `'; drop table`, an RTL override and 100 combining marks → stored or matched as text, never as SQL or markup.
- Forged, flipped and expired session cookies → 401; the request after `CARD_ACTION_RATE_LIMIT` is used up → 429.
- Route inventory: the full route list of `buildApp` equals the documented one, so a new route that writes the ledger cannot appear without a spec change.
- After every test above, `audit-ledger`'s invariants hold for every account.

**Statistical** (unit project, the real `crypto.randomInt`, α = 0.001 each, the same failure rule and design as `collection-packs.md` §9): **themed packs**: the tier draw of 400 000 themed packs (2 000 000 cards, Mythic expected 1 000; Radiant ones set apart, as in 1c's test 1) against the standard pack's six-tier `share`, chi-square with 5 degrees of freedom (critical value 20.52, the power of 1c §9's test 3), on a fixture theme whose set is a subset of the fixture snapshot with 10 / 30 / 60 / 100 / 125 / 175 characters per tier, Mythic to Common (the band rule at N = 500); the pick within each tier with the tier forced, 2 000 draws per character, chi-square with 9, 29, 59, 99, 124 and 174 degrees of freedom (27.88, 58.30, 98.32, 148.23, 178.41, 237.39); deterministically, no card outside the theme's set. Recycling for Karma involves no randomness and needs no statistical test.

**Web (PRs 2 and 4)**: unit tests for each control's states and the error mapping; the T1 hostile-name test wherever a receipt, a listing or a theme shows a name or a title; e2e on the stack: recycle duplicates and the balance rises by count × value and survives a reload, and the last copy cannot be recycled; buy a themed pack and the balance falls by its price and five cards of its set are revealed; list a card from one account and buy it from a second, and both balances, both collections and `audit-ledger` agree after a reload; nothing in `localStorage`.

## 15. Acceptance criteria

1. All routes in §11.3 exist, are validated, carry their limits and pass §14; `api/src` coverage stays ≥ 85 %.
2. Every balance change is a ledger row in the transaction of what it pays for; `audit-ledger` is clean on the test database and on the acceptance stack after the owner's checks.
3. No route turns Karma into a timer pack, and none turns cards into a higher-tier card; the shop's packs come only through `POST /api/shop/buy`; the route inventory test pins the list.
4. `shared/src/economy.ts` holds every number of §5 with its invariant tests, and a test recomputes §5.1, §5.2 and §9.
5. `docs/05-security.md`: C11 live; a T3 row per PR; the threat model gains double spend, double buy, double recycle, overflow, replayed actions, mint loops, the market as a trust boundary between accounts, and multi-account farming with §10's controls and residual risk. `docs/04-deployment.md`: `audit-ledger`, `audit-market`, and `reset-collection --keep-karma`.
6. On the acceptance stack, the owner recycles duplicates and sees the credit, buys a genre pack, lists a card on one account and buys it on another, and the balances, the collections, `audit-ledger` and `audit-market` agree.

## 16. Decision record

The owner's answers, as far as they concern the economy. ADR 0011 records the reversals of ADR 0004.

**Round 1**:

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                                                                                                          | Where             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Recycle: five copies become one card of the next rarity with a random character. Superseded by round 3, decision 2.                                                                                                                                                                                                                                   | —                 |
| 5   | Currency name: "Karma".                                                                                                                                                                                                                                                                                                                               | §1, §12           |
| 6   | Selling: all cards can be sold, including the last copy (no duplicates-only rule), and they are sold on a player-to-player market, not to the game. This reverses "currency never moves between accounts" and ADR 0004's limit of trade to local profiles. Round 3, decision 3 adds one fixed-price sale to the game: recycling duplicates for Karma. | §8.3 to §8.5, §10 |
| 7   | Pack shop: keep the free pack every 10 minutes (up to 3 stored) and add themed packs bought with Karma, each drawing from its own character set ("different packs that have different collections of characters", e.g. one per anime or genre). No real money anywhere, ever. This reverses ADR 0004's "packs are never bought with currency".        | §8.6, §9          |

**Round 2** (the tiers, recorded in full in `collection-packs.md` §11): five tiers, Common, Rare, Epic, Legendary, Mythic; the split 60 / 25 / 10 / 4 / 1 % by favourites rank; the per-pack odds; franchises for completion; Masterwork and Relics reserved, not built. The tiers, split and odds are **superseded** by rounds 4 and 5 there (six tiers; see the six-tier revision below).

**Round 3**:

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                                         | Where                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 1   | Rare odds lowered so a given Rare character is rarer than a given Common one: Rare about 80 % at least once per pack (1c's). The odds are **superseded** by `collection-packs.md` round 4; the principle (each tier's characters rarer than the tier below's) is kept there, §5.4.2. | §5.2                                                                       |
| 2   | No tier recycling at all; cards can only be recycled for Karma. Supersedes round 1, decision 1 ("five copies become a random character of the next tier").                                                                                                                           | §8.2, §8.7                                                                 |
| 3   | The Karma source is recycling duplicate cards (never the last copy of a character at a rarity) for a set Karma value, 25 % of the tier's reference value ("half the market floor"). Replaces the 20-Karma-per-free-pack grant, which is removed.                                     | §5, §6, §8.2, §9                                                           |
| 4   | Upgrades happen only through the mini-games (items 5 and 6); the owner's example is an ante of five Legendary cards that results in a Mythic upgrade if the game is won. Out of scope for item 2.                                                                                    | §2, §7, §8.11                                                              |
| 5   | Owner reset: choose per reset with a `--keep-karma` flag, default 0. Supersedes this spec's recommendation (always 0).                                                                                                                                                               | §8.10, §13.4                                                               |
| 6   | Market fee 5 % (minimum 1, rounded up).                                                                                                                                                                                                                                              | §5, §10                                                                    |
| 7   | Price bounds 0.5 × to 2.5 × the reference value.                                                                                                                                                                                                                                     | §5, §5.2                                                                   |
| 8   | Market limits, the moderate set: 100 purchases and 25 000 Karma spent per buyer, 25 000 received per seller, 12 500 per pair, rolling 7 days; re-check that one Mythic at the upper bound fits, and adjust the Karma figures proportionally if not.                                  | §5 (doubled; 2.2 times for six tiers, a manager default), §10              |
| 9   | Themed pack price about 2.3 times the expected value of its cards at reference.                                                                                                                                                                                                      | §5, §8.6, §9.1                                                             |
| 10  | Themes: every eligible genre automatically, plus franchise packs the owner picks with `pack-themes`. The franchise packs are **superseded** by the owner's decision of the six-tier revision (below).                                                                                | §8.6                                                                       |
| 11  | Reference values inverse to the per-slot pull rate, Common 10.                                                                                                                                                                                                                       | §5.1 (six tiers: the rate averaged over the five slots, a manager default) |
| 12  | Delivery order: the collection overview (item 3) right after 1c with a details-only card dialog; each economy UI PR then adds its section (Recycle for Karma in `feat/economy-ui`, List on the market in `feat/market-ui`).                                                          | §3, §12                                                                    |
| 13  | UI: no Karma icon, amounts read "<n> Karma"; the list-price field starts empty with the bounds shown; the shop is its own Shop tab.                                                                                                                                                  | §12                                                                        |

Round 1 decisions 2, 3, 4, 8 and 9 and round 2 are `collection-packs.md`'s; this spec adds the reset's Karma and listing rules (§8.10).

**Revised for six tiers** (manager, 2026-10-29; the derivation changes no owner decision; the owner's one new decision and the manager's two defaults follow it). The owner's rounds 4 and 5, recorded in `collection-packs.md` §11, replaced round 2's tiers: six tiers (Common, Uncommon, Rare, Epic, Legendary, Mythic, by favourites rank 35 / 25 / 20 / 12 / 6 / 2 %), slot floors, a standard pack's shares of 56 / 24 / 16 / 3.4 / 0.55 / 0.05 %, the Enchanted, Radiant and pity rules, and the cap of 60 characters per franchise; `collection-packs.md` §5.4.7 fixed how the special rules treat shop packs. This revision re-derives every per-tier number from them by this spec's rules: round 3, decisions 3, 7, 9 and 11 give the recycle values, the price bounds, the themed pack's price basis and the reference values (§5, §5.1, §5.2, §9.1); decision 8's re-check fails again, at a Mythic of 27 500, and its rule is applied again (§5); §8.6's eligibility is checked and §9's model recomputed on the real snapshot (§9.2.1); `ThemeOffer.odds` carries the five slot tables and the Radiant rule (§11.2). It raised three questions: the owner answered the one on franchise packs, and the manager set defaults for the other two. ADR 0013 records all three.

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                                                                                                               | Where                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | "Cut franchise packs, only have themed packs that contain cards from all franchises." Franchise themes are removed: the shop's themed packs are cross-franchise themes only, today the genre themes, with the eligibility rule unchanged (5 characters per tier, 13 of 17 genres on the real snapshot). Supersedes round 3, decision 10's franchise packs. | §7, §8.6, §11.2, §13.2, §14, §15 |

Manager defaults (manager default, 2026-10-29, owner may revise; the owner did not answer):

| #   | Default                                                                                                                                                                                                                                                                                                                                      | Where              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| D1  | Reference values invert a tier's share of a standard pack's cards (the per-slot rate averaged over the five slots), giving 10 / 23 / 35 / 160 / 1 000 / 11 000. Not chosen: a free pack's long-run share (10 / 23 / 39 / 120 / 730 / 4 900, which would make the price basis 300) and a shop pack's share (Mythic 9 600).                    | §5, §5.1, §5.2, §9 |
| D2  | The window limits are the owner's moderate set scaled 2.2 times, the smallest factor at which a Mythic at the cap (27 500) fits the pair limit: 55 000 spent, 55 000 received, 27 500 per pair, 100 purchases. Not chosen: 3 times (inflow 71 250 per 7 days) and keeping 50 000 / 50 000 / 25 000 (a Mythic above 25 000 could never sell). | §5, §10            |

## 17. Open questions

None. Every question of the three rounds and of the six-tier revision is answered by the owner or settled by a manager default the owner may revise (§16, ADR 0013).
