# Economy (roadmap item 2, server side)

Manager-written technical spec: the rules, the numbers and the API. §10 lists what the UI needs; its visual design is `ui-designer`'s. Implements ADR 0004 (economy ground rules) as amended by ADR 0008 §6 (the maths lives in the API's domain layer), on the data model of `collection-packs.md` (1c), which must be merged first. Security tier **T3** (currency, ledger). `security-officer` review and an adversarial test pass are required before each PR opens; a T3 change never merges on the day it is opened unless the owner says so.

Written 2026-10-29.

## 1. Goal

A player sells duplicate cards to the system for the in-game currency, and recycles five duplicates of one rarity, plus a fee, into one card of the next rarity. The server decides every price and outcome, and every balance change is a ledger row written in the same transaction as the cards it pays for (C11). The numbers are shown not to inflate (§8), and the ledger is the one blackjack and slots will write to.

## 2. Out of scope

- The pack timer: shipped by 1c (`collection-packs.md` §5.2) and used here unchanged.
- Blackjack and slots (items 5, 6) and the packs they pay out. §7.6 says what they add; nothing here changes for them.
- Trade and any trade fee (item 7).
- Collection overview (item 3); the profile, its balance and a player-facing history (item 4).
- Any other faucet: no daily bonus, streak reward or starting balance. A source of currency not tied to the pack timer breaks §8.
- Moving currency between accounts, ever (§4).
- Prices that change at runtime. A number changes by a deploy that changes §5 and this spec.

## 3. Delivery

Two pull requests, after both 1c PRs, in order, each through the full gate:

1. **`feat/economy`** (this spec, everything except §10): the migration, `api/src/domain/economy/`, routes under `api/src/routes/collection/` and `api/src/routes/wallet/` with `CARD_ACTION_RATE_LIMIT` in `routes/limits.ts`, the owner command, shared schemas and parameters, tests, docs.
2. **`feat/economy-ui`** (§10): sell, recycle and the balance on the existing collection view, after `ui-designer`'s short UI spec (gate step 1). Item 3 later restyles these controls rather than inventing them. An economy nobody can use cannot be accepted by the owner, and its numbers cannot be felt before the rebalance.

## 4. Ground rules

ADR 0004, rule by rule, and what holds each one here.

| Rule (ADR 0004)                                                                                     | How this spec holds it                                                                                                                                          | Proven by                                                                                                             |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| No real money, anywhere, ever (§3, `CLAUDE.md`)                                                     | No payment provider or SDK, no route that takes or quotes real money, no premium currency, no cash-out. Currency is never converted, exported or transferred    | `security-officer` manifest check on every PR; the route inventory test (§12)                                         |
| Packs are free and time-gated, never bought with currency, directly or indirectly (§1)              | No route debits currency and grants a pack. `packs_anchor_at` is written only by the opening path. Recycling needs five cards and yields one card, never a pack | Adversarial: an account at `MAX_BALANCE − 1` with no pack available calls every route, and its allowance is unchanged |
| One currency, integer-valued (§3)                                                                   | `integer` columns, bounded amounts (§5), no float anywhere in `domain/economy/`                                                                                 | Unit and overflow tests                                                                                               |
| Earned by selling and by winning; spent on wagers, recycling and fees (§3)                          | Credits: `sale` (items 5, 6 add `payout`). Debits: `recycle_fee` (items 5, 6 add `wager`). Nothing else exists in `ledger_kind`                                 | Schema; route inventory                                                                                               |
| Sell is fixed by rarity; recycle turns several cards into one upgraded card (§4)                    | `SELL_VALUE` per rarity; `RECYCLE_INPUT` cards of one rarity into one of the next (§7.2, §7.3)                                                                  | Route tests                                                                                                           |
| The loop must not inflate (§5)                                                                      | §8                                                                                                                                                              | A unit test recomputes §8 from the parameters                                                                         |
| Odds are public (§6)                                                                                | Sale values, the recycle ratio and the fees are in `GET /api/wallet` and shown next to the actions; pack odds come from 1c                                      | Route test; e2e                                                                                                       |
| Money-like maths in the API's domain layer, reviewed on every change (§7 as amended by ADR 0008 §6) | `api/src/domain/economy/`, pure functions, unit-tested; the web app only displays                                                                               | Gate step 5 on every economy PR                                                                                       |

One rule is added, because the faucet is per account: **currency never moves between accounts** (no gift, no transfer, no shared pot). Ten invited accounts are ten bounded faucets, never one large one.

## 5. Parameters (`shared/src/economy.ts`)

All tunable numbers, in the one file ADR 0004 asks for; 1c put the pack numbers there. The owner's provisional numbers are rebalanced once all mechanics exist.

| Name                 | Value                             | Why                                                                                                    |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `SELL_VALUE`         | common 10, rare 50, legendary 300 | the owner's provisional numbers                                                                        |
| `RECYCLE_INPUT`      | 5                                 | the owner's provisional 5-to-1                                                                         |
| `RECYCLE_FEE`        | common 10, rare 110               | what goes in is worth 1.2 × what comes out (below); legendary has no tier above and cannot be recycled |
| `MAX_CARDS_PER_SALE` | 500                               | keeps one sale's credit far below `MAX_ENTRY_AMOUNT`                                                   |
| `MAX_SALE_ITEMS`     | 100                               | groups in one sale                                                                                     |
| `MAX_ENTRY_AMOUNT`   | 1 000 000                         | the largest single ledger amount, credit or debit, games included                                      |
| `MAX_BALANCE`        | 1 000 000 000                     | keeps every sum inside a Postgres `integer` (2 147 483 647)                                            |
| `HOUSE_EDGE`         | 300 to 500 per 10 000             | the owner's 3–5 %; the range items 5 and 6 must land in                                                |
| `PRIZE_PACK_VALUE`   | 272                               | a prize pack's value in the games' house-edge check (§8.3)                                             |

Invariants, each a unit test over the file: every value is a positive safe integer; `RECYCLE_INPUT × SELL_VALUE[r] + RECYCLE_FEE[r] > SELL_VALUE[next(r)]` for each recyclable `r`, so recycling never creates value; `MAX_CARDS_PER_SALE × SELL_VALUE.legendary ≤ MAX_ENTRY_AMOUNT`; `MAX_BALANCE + MAX_ENTRY_AMOUNT ≤ 2^31 − 1`.

**Recycle yields one card of the next rarity**, its character drawn uniformly from the pool (common to rare, rare to legendary). Why this yield:

- It is ADR 0004 §4's "one upgraded card", and the only yield whose value can be priced against its inputs. A pack, or a reroll into a pack, would be worth a whole pack, and with a currency fee it would be a pack bought with currency, which ADR 0004 §1 forbids.
- The character is drawn, not chosen. A chosen character would let commons buy the most popular legendaries on demand, flattening the popularity tilt and making packs secondary.

**The fee makes recycling a sink.** At sale value, five rares are worth 250 and a legendary 300: without a fee, every rare recycle would create 50, a faucet ADR 0004 §5 rules out. The fees are set so that what goes in is worth 1.2 times what comes out: 5 × 10 + 10 = 60 for a rare worth 50, and 5 × 50 + 110 = 360 for a legendary worth 300. Every recycle destroys a sixth of its input value. The fee is the recycling spend ADR 0004 §3 foresees.

**Duplicates only.** Sell and recycle take only copies beyond the first of a (character, rarity) group; the last copy is never offered. The collection is the game: a misclick cannot remove a character from it, and its `unique` count and item 3's completion never go down by the player's own action. What it holds back is bounded (one card per group, §8.1), so it delays earnings and does not change the long-run rates.

## 6. Data model

```
accounts (1b, 1c) gains
  balance           integer not null default 0        -- check (balance between 0 and MAX_BALANCE)

ledger_entries                                         -- one row per balance change; never updated or deleted
  id                uuid pk default gen_random_uuid()
  account_id        uuid not null references accounts(id) on delete cascade
  seq               integer not null                   -- 1, 2, 3 ... per account, assigned under the account lock
  kind              ledger_kind not null               -- enum: sale, recycle_fee (items 5, 6 add theirs)
  amount            integer not null                   -- signed: a credit > 0, a debit < 0
                                                       -- check (amount <> 0 and abs(amount) <= MAX_ENTRY_AMOUNT)
  balance_after     integer not null                   -- check (balance_after between 0 and MAX_BALANCE)
  created_at        timestamptz not null
  unique (account_id, seq)

card_actions                                           -- one row per sale or recycle: the idempotency record and the receipt
  id                uuid pk default gen_random_uuid()
  account_id        uuid not null references accounts(id) on delete cascade
  request_id        uuid not null                      -- the client's idempotency key
  request_hash      text not null                      -- SHA-256 of the canonical body (§7.4)
  kind              card_action_kind not null          -- enum: sale, recycle
  ledger_entry_id   uuid not null unique references ledger_entries(id)   -- the sale's credit or the recycle's fee
  created_at        timestamptz not null
  unique (account_id, request_id)

cards (1c) gains
  removed_at        timestamptz null                   -- null while held; set when sold or recycled
  removed_by        uuid null references card_actions(id)
  recycle_id        uuid null references card_actions(id)   -- set on the card a recycle produced
  -- opening_id, slot, odds_rare and odds_legendary become nullable: a recycled card has no opening, slot or roll
  check (num_nonnulls(opening_id, recycle_id) = 1)
  check ((opening_id is null) = (slot is null) and (opening_id is null) = (odds_rare is null)
         and (odds_rare is null) = (odds_legendary is null))
  check ((removed_at is null) = (removed_by is null))
  index (account_id, character_id, rarity) where removed_at is null    -- replaces 1c's index
```

Rules:

- **The balance is a column; the ledger is its proof.** Reading a balance is one row, the row that is locked anyway; the ledger is the history and the audit. Invariants: `balance` = Σ `amount` = the newest `balance_after`; `seq` runs 1, 2, 3 … with no gap; each `card_actions` row has exactly one entry, of its own account. `balance_after` and the gapless `seq` make a missing, extra or altered row visible to §11's audit.
- **Append-only, enforced by the database too.** The migration revokes `UPDATE` and `DELETE` on `ledger_entries` and `card_actions` from `anime_app` (0001's default privileges granted them). Postgres runs referential actions with the table owner's rights, so deleting an account still cascades; a route test proves both halves.
- **Checks are a backstop.** The domain checks every bound first and answers with a typed error; a database check that fires means a bug, and it fails the transaction instead of writing a negative balance.
- **Held means `removed_at is null`.** 1c's collection queries, `AccountPublic.cards`, an opening's `isNew` and the choice of what to sell all count held cards only. Removed cards stay as rows: the sale that took them can be audited, and a replayed opening still returns the cards it dealt. With duplicates only, a group never empties.
- **Deleting an account** removes its ledger and actions with it (cascade): delete means delete (`accounts.md`).
- Migration: the next file after 1c's.

## 7. Behaviour

### 7.1 Balance and ledger

Every balance change runs the same steps inside the transaction of the thing it pays for, after the account row is locked: compute the new balance; refuse with a typed error if it would leave `0 .. MAX_BALANCE`; insert the ledger row with `seq` = previous + 1 and `balance_after`; update `accounts.balance`. One function in `domain/economy/` does this, and it is the only code that writes `accounts.balance` or `ledger_entries`. New accounts start at 0: a starting grant would be currency with no card behind it.

### 7.2 Sell

`POST /api/collection/sell` with `items`, each a character, a rarity and a quantity:

1. The schema bounds each item and the list (§9.2); the domain refuses a repeated (character, rarity) pair and a total over `MAX_CARDS_PER_SALE` with 400 `validation_failed`.
2. Lock the account row; handle a replay (§7.4).
3. For each item, select the held copies of that group, newest first, `FOR UPDATE`. If `quantity` is more than copies − 1 → 409 `not_enough_copies` for the whole sale; nothing is sold. A group the account never held has no copies, so naming another account's cards fails the same way.
4. Credit = Σ `quantity × SELL_VALUE[rarity]`. If the balance plus the credit would exceed `MAX_BALANCE` → 409 `balance_limit`.
5. Write the ledger entry (`sale`, + credit) and the `card_actions` row, mark the newest `quantity` copies of each group removed by it, update the balance, answer 201 with the receipt.

Newest first, so the copy that stays is the first one pulled, the one that was new.

### 7.3 Recycle

`POST /api/collection/recycle` with an input `rarity` (common or rare) and `items`, each a character and a quantity, totalling `RECYCLE_INPUT`:

1. The schema bounds the body; the domain refuses a repeated character and a total other than `RECYCLE_INPUT` with 400 `validation_failed`.
2. Lock the account row; handle a replay.
3. Check the copies per item as a sale does → 409 `not_enough_copies`.
4. Fee = `RECYCLE_FEE[rarity]`. A balance below the fee → 409 `insufficient_funds`.
5. Read the in-pool characters; none → 503 `pool_unavailable`. Nothing is consumed.
6. Draw the output character with `crypto.randomInt(0, n)` over the in-pool rows ordered by id (C10, through 1c's `Rng` seam); its rarity is the next one up; `isNew` = the account holds no card of that character.
7. Write the ledger entry (`recycle_fee`, − fee) and the `card_actions` row, mark the inputs removed, insert the new card with `recycle_id`, update the balance, answer 201 with the receipt and the card.

### 7.4 Idempotency

As with 1c's openings, every sale and recycle carries a client `requestId` (uuid), scoped to the account.

- The same `requestId` with the same body: 200 with the original receipt (what was sold or consumed, the credit or the fee, the card produced) and the current balance. Nothing is written.
- The same `requestId` with a different body: 409 `request_id_reused`. Nothing is written. "Same" is the SHA-256 of the canonical body: the validated fields without `requestId`, items sorted by character id, then rarity.
- A request refused with any error leaves no record, so its key can succeed later.
- Openings and card actions keep separate key spaces: an opening's key reused for a sale is a new sale, not a replay.

### 7.5 Concurrency and bounds

- **One lock order.** Every path with stakes (opening, sell, recycle, and the games later) locks the account row first, then the card rows, then writes the ledger. Actions of one account run one after the other and cannot deadlock against each other.
- **Double sell.** Two parallel sales of a group's last duplicate: the second runs after the first, finds no duplicate and gets 409 `not_enough_copies`. The balance is credited once.
- **Double spend.** Two parallel recycles with the balance for one fee: one 201, one 409 `insufficient_funds`.
- **No negative balance.** A debit is written only after the domain has seen, under the lock, a balance that covers it; the check constraint is the backstop.
- **No overflow.** The schema caps every quantity; the parameters cap every amount and balance so every intermediate sum stays inside `integer` (§5); the ledger function asserts `Number.isSafeInteger` on every value it writes. JSON edge cases are schema rejections, never arithmetic: `1e400` (Infinity), `9007199254740993`, `1.5`, `-0`, `"5"` and `null` → 400.
- **Server time only.** `created_at` and `removed_at` come from the server clock.

### 7.6 What items 5 and 6 add

The ledger serves blackjack and slots without a change to its table:

- `ledger_kind` gains `wager` (debit) and `payout` (credit). Each game's round table points at its ledger rows (`wager_entry_id`, `payout_entry_id`), as `card_actions` does; the ledger knows nothing about games.
- The same account lock, the same §7.1 function, the same `MAX_ENTRY_AMOUNT` for a wager or a payout, the same `requestId` pattern.
- Table limits are fixed numbers in `shared/src/economy.ts`, never a share of the balance.
- A game's house edge, computed exactly in integers from its published paytable, lies within `HOUSE_EDGE`, with every prize pack counted at `PRIZE_PACK_VALUE`.
- Prize packs are a separate, capped counter that 1c's opening path consumes; the game's spec sets the cap and the order. 1c's allowance does not change.

### 7.7 Rate limits and logging

Sell and recycle: `CARD_ACTION_RATE_LIMIT` per client address each, replacing the global bucket for the route; `GET /api/wallet` uses the global bucket. At `info`, with the request id: cards sold (account id, action id, card count, credit, balance after); cards recycled (account id, action id, input rarity, fee, output character id and rarity, balance after); each with whether it was a replay. Never a whole request body.

## 8. The model: earn rates and sinks

### 8.1 Faucet

Currency has one source: selling cards. Cards have two: packs, which the 1c timer bounds, and recycles, which consume five for one. So the currency an account can create in a day is at most the sale value of the cards in the packs it can open that day.

Sale value per card, if every card is sold:

- at `BASE_ODDS` (70 / 25 / 5 %): 0.70 × 10 + 0.25 × 50 + 0.05 × 300 = **34.5**
- at the highest odds a character can have (58 / 31 / 11 %, `BASE_ODDS` plus the full `POPULARITY_BEND_MAX`): 0.58 × 10 + 0.31 × 50 + 0.11 × 300 = **54.3**

The real figure sits between the two and moves with the pool; 1c publishes it as the average odds. Per pack of `PACK_SIZE` cards: 172.5 to 271.5.

| Player                                                                                          | Packs a day | Currency a day, base odds | Currency a day, highest odds |
| ----------------------------------------------------------------------------------------------- | ----------- | ------------------------- | ---------------------------- |
| Casual: three visits a day, `PACK_CAP` packs each                                               | 9           | 1 553                     | 2 444                        |
| Active: opens each pack as it arrives for 16 waking hours, plus the `PACK_CAP` stored overnight | 99          | 17 078                    | 26 879                       |
| Ceiling: every pack, 24 hours a day; a script does no better, because the timer is the limit    | 144         | 24 840                    | 39 096                       |

Figures are rounded up. The ceiling is a hard bound per account: 24 hours of `PACK_INTERVAL_MINUTES` is 144 packs, and the cap stores only `PACK_CAP`, so an absence is never banked.

Duplicates only holds back one copy per group: three groups per character, at most 100 × (10 + 50 + 300) = 36 000 of sale value with today's pool, once per account. It delays the rates above; it does not change them.

### 8.2 Sinks

- **Recycling** destroys a sixth of its input value: 10 per common recycle (60 in, 50 out), 60 per rare recycle (360 in, 300 out). It is optional, so §8.1's bound assumes none.
- **Games** (items 5, 6) keep `HOUSE_EDGE` of every wager.
- **Trade fees** (item 7), if there are any.

In item 2 alone, recycling is the only sink.

### 8.3 Why it does not inflate

1. **The faucet is linear in time and does not depend on the balance.** An account creates at most the ceiling per day, whatever it holds. Nothing currency can buy raises that: packs cannot be bought, a recycle loses a sixth, and a game keeps `HOUSE_EDGE` of each wager in expectation, with a prize pack counted at `PRIZE_PACK_VALUE` (the ceiling's 271.5 per pack, rounded up), so even a prize pack sold at the best odds cannot make a game profitable. No path turns currency into more currency in expectation; there is no compounding loop.
2. **Prices do not follow balances.** Sale values, fees and (items 5, 6) table limits are fixed numbers, not shares of a balance or of the total in circulation, and there is no market between players. A large balance buys nothing a small one cannot, so a growing total makes nothing cheaper or scarcer.
3. **Accounts cannot pool** (§4).

### 8.4 What grows without bound

- **A balance that is never spent**, linearly: at most the ceiling's 39 096 a day. `MAX_BALANCE` is 25 578 days (70 years) away at that rate; it exists to keep the arithmetic in range, and `balance_limit` is the answer if it is ever reached.
- **Cards that are never sold**, linearly: at most 144 × `PACK_SIZE` = 720 a day.
- **Ledger rows**: one per sale or recycle, a few dozen a day for an active account.

Nothing grows faster than linearly, and nothing grows because a balance is large. A unit test recomputes the §8.1 table and the `MAX_BALANCE` horizon from `shared/src/economy.ts` and `shared/src/rarity.ts`, so a parameter change that moves these numbers fails until this section is updated.

## 9. Contract (`shared/src/api.ts`, `shared/src/errors.ts`)

### 9.1 Error codes

New: `not_enough_copies` (409), `insufficient_funds` (409), `balance_limit` (409) and `request_id_reused` (409). `pool_unavailable` (503) is 1c's.

### 9.2 Schemas

```
RecycleRule       { from: "common" | "rare", into: Rarity, cards: integer, fee: integer }
Wallet            { balance: integer ≥ 0, sellValues: PerRarity, recycle: RecycleRule[], maxCardsPerSale: integer }
CardCount         { characterId: integer ≥ 1, rarity: Rarity, quantity: integer 1..MAX_CARDS_PER_SALE }
SellBody          { requestId: uuid, items: CardCount[1..MAX_SALE_ITEMS] }
SaleReceipt       { saleId: uuid, soldAt: date-time, sold: CardCount[], credited: integer ≥ 1, balance: integer ≥ 0 }
RecycleInput      { characterId: integer ≥ 1, quantity: integer 1..RECYCLE_INPUT }
RecycleBody       { requestId: uuid, rarity: "common" | "rare", items: RecycleInput[1..RECYCLE_INPUT] }
RecycledCard      { character: CharacterPublic, rarity: Rarity, isNew: boolean }
RecycleReceipt    { recycleId: uuid, recycledAt: date-time, consumed: CardCount[], fee: integer ≥ 1, card: RecycledCard, balance: integer ≥ 0 }
CollectionGroup   (1c) gains sellable: integer ≥ 0      -- copies − 1: the server's rule, not the UI's arithmetic
```

`PerRarity`, `Rarity` and `CharacterPublic` are 1c's. No request carries a price, an amount, a balance or a card id: the server prices everything, and a body that names any of them fails as an unknown field.

### 9.3 Routes

| Method, path                   | Body          | Success                                                       | Errors (status, code)                                                                                                                              | Limit  |
| ------------------------------ | ------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `GET /api/wallet`              | —             | 200 `Wallet`                                                  | 401 `unauthenticated`                                                                                                                              | global |
| `POST /api/collection/sell`    | `SellBody`    | 201 `SaleReceipt`; 200 on a replay                            | 400 `validation_failed`, 401 `unauthenticated`, 409 `not_enough_copies`, 409 `balance_limit`, 409 `request_id_reused`                              | 30/min |
| `POST /api/collection/recycle` | `RecycleBody` | 201 `RecycleReceipt`; 200 on a replay                         | 400 `validation_failed`, 401 `unauthenticated`, 409 `not_enough_copies`, 409 `insufficient_funds`, 409 `request_id_reused`, 503 `pool_unavailable` | 30/min |
| `GET /api/collection`          | —             | 1c's, with `sellable` per group and counts of held cards only | as 1c                                                                                                                                              | global |

GET routes take `NoQuery`. The POSTs are behind the CSRF check, and their response schemas also declare 403 `bad_origin` and 429 `rate_limited`. The 30/min is `CARD_ACTION_RATE_LIMIT`: room for a player clearing duplicates group by group, too little for a script to make lock contention matter.

## 10. What the UI needs (second PR)

`ui-designer` designs the controls; this lists what they need back and the rules they keep.

- **Balance**: `balance` from `GET /api/wallet`, then from each receipt. The UI never computes one (no `balance + credited`).
- **Prices and rules**: `sellValues`, `recycle` and `maxCardsPerSale` from `GET /api/wallet`, shown next to the actions (ADR 0004 §6). None is a constant in `web/`; 1c's lint rule already forbids importing `@anime-tcg/shared/economy` there.
- **What can go**: `sellable` per collection group. Sell and recycle are offered only where it is at least 1; the server checks again.
- **Sell**: a `requestId` per action, kept and resent only when an answer never arrived, as with 1c's pack. On success the UI writes the balance and refetches the collection.
- **Recycle**: the player picks `RECYCLE_INPUT` sellable cards of one rarity (how is the designer's call) and sees the fee before confirming; the receipt's `card` is revealed like a pack card, with `isNew`.
- **Errors**: `not_enough_copies` and `request_id_reused` → the collection changed: refetch and say so; `insufficient_funds` → show the fee and the balance; `balance_limit` → a plain refusal; `pool_unavailable` → 1c's cards-unavailable state; `unauthenticated` → session ended; a network failure → the unreachable banner.
- **Name**: the currency's display name is one line in `web/src/lib/copy.ts`, placeholder "coins" (§14). Code says `balance` and `amount`, never the name.
- **Format**: whole numbers through `Intl.NumberFormat`, no decimals, and no symbol that suggests real money.
- **No nags** (ADR 0004 §6): no "sell now" prompts, no celebration of a growing balance, no countdowns tied to currency.

## 11. Owner-side command

`api/src/cli/audit-ledger.ts`, read-only, run inside the api container:

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/audit-ledger.js
```

Checks every account against §6's invariants and prints `Ledger consistent: 10 accounts, 1234 entries.`, or one line per failing account and exit 1. Run it before a release and after any restore (C16). Unit-tested through its exported function; the route suite runs it once at the end against the test database. Documented in `docs/04-deployment.md` under "Operations".

## 12. Tests required (minimum, T3)

**Unit** (`api/src/domain/economy/*.test.ts`, `shared/`): §5's invariants; §8's table and horizon recomputed from the parameters; sale pricing per rarity and for a mixed sale; duplicates-only selection (copies − 1, the newest removed first); the recycle rules (input rarity, total, fee, next rarity, legendary refused); the ledger function (`seq` increments, `balance_after`, every bound refusal, `Number.isSafeInteger`); canonical body hashing (item order does not change the hash, any field does).

**Route** (`api/test/economy.test.ts`): every row of §9.3, the happy path and each declared error; an extra field → 400; a query string on a GET → 400; a missing Origin → 403; signed out → 401; a sale credits exactly Σ quantity × sale value and removes that many copies, newest first; selling the last copy → 409; a recycle debits the fee, removes the inputs and adds one card of the next rarity; recycling legendaries → 400; `sellable` = copies − 1; an opening's `isNew` ignores removed cards; deleting an account removes its ledger; the app role can neither update nor delete a ledger row; `audit-ledger` passes on the database the suite leaves behind.

**Concurrency** (parallel `inject()` calls): two sales of a group's last duplicate → one 201, one 409, one ledger row; ten parallel sales of one copy each against five duplicates → exactly five 201; two recycles with the balance for one fee → one 201, one 409, balance ≥ 0; a sale and a recycle racing for the same duplicates → one wins; a sale racing a pack opening → both succeed and `seq` stays gapless; the same `requestId` twice in parallel → one 201 and one 200 with the same receipt.

**Adversarial** (`api/test/security/economy.security.test.ts`):

- Negative, zero, fractional, string, `null`, `1e400`, `9007199254740993` and over-maximum quantities → 400, nothing written.
- Overflow: a balance seeded at `MAX_BALANCE − 1` and a sale of one common → 409 `balance_limit`, nothing written; a recycle against a balance one below its fee → 409 `insufficient_funds`.
- Double spend and double sell as above, plus a burst of 20 parallel mixed actions on one account → the invariants hold.
- Replay: the same key and body → one action; the same key with another body → 409 `request_id_reused`; account B sending A's key → B's own outcome.
- Tampered card ids and other accounts' cards: a body with `cardIds` (another account's real card uuids), `price`, `amount`, `credit`, `balance` or `accountId` → 400; an item naming a group only another account holds, or a character id that does not exist → 409 `not_enough_copies`, and the other account's cards and balance are unchanged.
- No path from currency to packs or cards: an account at `MAX_BALANCE − 1` with no duplicates and no pack calls every route; its allowance, cards and balance are unchanged.
- Forged, flipped and expired session cookies → 401; the request after `CARD_ACTION_RATE_LIMIT` is used up → 429.
- Route inventory: the full route list of `buildApp` equals the documented one, so a new route that writes the ledger cannot appear without a spec change.
- After every test above, `audit-ledger`'s invariants hold for every account.

**Statistical**: the recycle draw with the real `crypto.randomInt` over a fixture pool of 100 characters, 200 000 draws, the count per character against an equal share, chi-square with 99 degrees of freedom at α = 0.001 (critical value 148.23), under the same failure rule as 1c §9. The output rarity is deterministic and covered by the unit tests.

**Web (PR 2)**: unit tests for the controls' states and the error mapping; the T1 hostile-name test wherever a receipt shows a name; e2e on the stack: sell a duplicate, and the balance rises by its sale value and survives a reload; recycle five commons, the fee is debited and a rare is revealed; nothing in `localStorage`.

## 13. Acceptance criteria

1. All routes in §9.3 exist, are validated, carry their limits and pass §12; `api/src` coverage stays ≥ 85 %.
2. Every balance change is a ledger row in the transaction of what it pays for; `audit-ledger` is clean on the test database and on the acceptance stack after the owner's checks.
3. No route turns currency into a pack, and none turns currency alone into a card; the route inventory test pins the list.
4. `shared/src/economy.ts` holds every number of §5 with its invariant tests, and a test recomputes §8.
5. `docs/05-security.md`: C11 live; a T3 row per PR; the threat model gains double spend, overflow, replayed actions and multi-account farming. `docs/04-deployment.md`: the audit command.
6. On the acceptance stack, the owner sells a duplicate and recycles five commons, and the balance, the collection and `audit-ledger` agree.

## 14. Open questions

For the owner; each is a choice, with the default this spec builds.

1. **Currency name.** Keep the placeholder "coins", or pick a themed name? Recommendation: keep "coins" until you choose; renaming is one copy line.
2. **Recycle output.** A random character at the next rarity (built), or one the player chooses? Recommendation: random, so packs stay the way to chase a particular character.
3. **Selling the last copy.** Duplicates only (built), or any card? Recommendation: duplicates only.
4. **Idle balances.** Until the games exist, a balance only grows (§8.4). Accept that, or add a sink now? Recommendation: accept it; the games are the sink, and a sink with nothing to buy would be a tax.

ADR notes for the manager: ADR 0004 §7 is amended by ADR 0008 §6, but ADR 0004 carries no pointer to it, and its status line still says "see docs/design/economy.md once written"; both should name ADR 0008 and this spec. ADR 0004 §4 limits trade to "local profiles on the same device", which ADR 0008 removed; that sentence needs amending to trade between server accounts when item 7 is specced. No ADR change blocks this spec.
