# Market, server side (item 2, PR 3) (#53)

- **Date:** 2026-10-30
- **Tier:** T3 (Karma and cards move between two accounts in one transaction; new tables, grants, a SECURITY DEFINER function and a trigger)
- **Verdict:** PASS WITH FINDINGS (none blocking), reviewed at head d815474; the QC should-fix items and finding 1 were fixed before merge in 3ddeccd (search terms), 60a56ae and 1f33d6a (tests)
- **Owner informed:** through the PR's sign-offs

## Change

Economy PR 3, api and shared only (`docs/design/economy.md` §7, §8.3–§8.5, §8.9, §8.12, §10, §11, §13, §14; the implementation deltas are §16's M1–M10). No web, dependency, CI or CSP change.

- **Routes** (`api/src/routes/market/index.ts`), all behind `requireAccount`:
  - `GET /api/market/listings`:
    - live listings of every account, filtered by rarity, franchise, character and `q`;
    - sorted `price_asc` (default), `price_desc` or `newest`, keyset-paged;
    - the caller's own listings marked `mine`.
  - `GET /api/market/mine`: the caller's live listings, recent closed ones and purchases, and the window limits left.
  - `POST /api/market/listings`: the entry and the asking price only. The server bounds the price to the card's granted rarity, picks the copy, and fixes the fee and the expiry.
  - `POST /api/market/listings/{listingId}/buy`: a `requestId` alone.
  - `POST /api/market/listings/{listingId}/cancel`: an empty body.
- **Migrations:**
  - `0006_market.sql`:
    - the tables `market_listings` and `market_purchases`;
    - on `cards`: `removed_by_purchase` and `purchase_id`, with checks for exactly one origin and at most one remover;
    - the search columns, backfilled in SQL;
    - the app role's rights;
    - `delete_bought_cards`;
    - the extended `cards_removed_stays`.
  - `0007`: `delete_bought_cards` raises while the account still has an active listing.
  - `0008`: a removed card's `removed_by_purchase` may go to null only once its purchase row no longer exists.
- **Rules** (`api/src/domain/market/`, pure and unit-tested): the per-tier price bounds, the 5 % fee (rounded up, at least 1, fixed at listing time), the rolling 7-day limits and their `retryAfterSeconds`, the cursor, the search patterns (at most 10 terms), expiry plus the hourly sweep, and the reset's listing rule.
- **Grants:**
  - `market_listings`: INSERT and SELECT, plus UPDATE of `status` and `closed_at`.
  - `market_purchases`: INSERT and SELECT only.
  - `cards`: UPDATE of `removed_by_purchase`; still no DELETE.
  - The reset deletes bought cards through `delete_bought_cards(account)`: `SECURITY DEFINER`, `search_path = pg_catalog, public`, schema-qualified, `REVOKE ALL FROM PUBLIC`, `EXECUTE` to `anime_app` alone.
- **Audits:** `audit-ledger` gains the market checks; `audit-market` is new.

## Review notes

- **Dependencies:** none changed. `npm run audit` finds 0 high; `npm audit signatures` reports 488 verified, 166 attestations.
- **CI and local gate:**
  - CI on d815474 is green.
  - The api coverage run had 1689 passed at 94.45 % statements; a fresh clone is clean; `db:generate` shows no drift.
  - One earlier routes run failed under machine load, with no assertion failure.
- **Lock order:** `EXPLAIN` gives `LockRows → Sort (id) → Seq Scan`, so both account rows are locked in ascending id order. The three-way cycle and 50 A↔B pairs finish with balanced ledgers.
- **No double sale or credit:**
  - The listing is re-read `FOR UPDATE`, and the replay is re-checked after the locks.
  - The backstops are `unique (listing_id)` and `unique (buyer_id, request_id)`.
  - Five buyers of one listing give one 201.
- **C11:** `postEntry` stays the only writer. The buyer's debit, the seller's sale and fee, the purchase row and both cards are one transaction.
- **Limits (§10):**
  - The seller's cap counts every sale in the window, and the pair cap is per direction.
  - Every counted row is under a lock: 101 parallel purchases give exactly 100.
- **Least privilege:**
  - `db-role.test.ts` pins the rights, the column grants and the function's `prosecdef`/`proconfig`.
  - A temp table named `cards` does not redirect the function.
  - 0007 and 0008 refuse what they should, and the cascades still work.
- **Browse:**
  - The cursor is re-checked: sort, uuid, price in 1..`MAX_ENTRY_AMOUNT`, time from the epoch to year 9999.
  - `q` is 1..100 characters with no control characters.
  - Terms are bound, escaped `LIKE` patterns.
  - No other account's login or id is exposed.
- **Rate limit and sweep:** the 31st POST is 429 and moves nothing. The sweep takes no account lock and logs its failures.

## Findings

1. **Low:** the normalised search terms were unbounded; NFKC can expand 100 characters to 301 terms. Fixed before merge: at most 10 terms.
2. **Low:** nothing audits a price against its tier. A row written by SQL as the request role could carry a price its tier never allows. Open item.
3. **Info:** the api pool's 3 s connection wait under a purchase burst can turn unrelated requests into 500s. Bounded by the 30/min limit. Open item.
4. **Info:** the pair limit's history resets when one side's account is deleted (an owner action). Accepted.
5. **Info:** the hourly sweep and the per-seller expire UPDATE could in principle deadlock with each other, never with a purchase. Postgres aborts one. Accepted.
6. **Info:** a `delete_bought_cards` call outside a reset can delete a resold bought card; `audit-ledger` reports it. Accepted (manager decision, 2026-10-30).
7. **Info:** deleting a buyer's account removes purchase evidence, the same class as the #40 S1 reset-log residual. Accepted.

## Register edits

- **Threat model, append:** From #53 the market is a trust boundary between two accounts: a purchase moves Karma and one card in a single transaction that locks both account rows in ascending id order, then the listing, then the card, so a listing sells once, credits its seller once and debits its buyer once, and purchases in opposite directions cannot deadlock (C11, C24); the browse route takes only enumerated filters, digit-string ids, a control-character-free search text of at most 10 terms matched as escaped `LIKE` patterns and its own re-checked cursor, and publishes no other account's login or id; and one person with several accounts is bounded, not detected, by the destroyed fee, the per-tier price bounds and the rolling 7-day window and pair limits, with `audit-market` as after-the-fact detection (C24, economy.md §10).
- **C1, append:** #53: no market request carries an amount, a balance, a fee, a card id, an account id or a seller; the only price a request carries is the seller's asking price, which the server bounds to the card's granted rarity; a buy carries a `requestId` alone and a cancel an empty body.
- **C3, append:** #53: the five market routes call `requireAccount` and take the account from the session; a listing is named only by its public uuid, another account's listing is 404 on cancel and one's own is 409 `own_listing` on buy, with `market_purchases_self_trade_check` behind it; no market answer names another account's login or id.
- **C6, append:** #53: `CARD_ACTION_RATE_LIMIT` (30/min per address) also replaces the global bucket on the three market POSTs, replays included; the market GETs keep the global bucket.
- **C11, append:** #53: a purchase writes the buyer's `market_purchase` and the seller's `market_sale` and `market_fee` through `postEntry` in the transaction that moves the card, after locking both account rows in ascending id order; `market_purchases` is append-only, keyed `unique (buyer_id, request_id)` and `unique (listing_id)`, with checks bounding every price and fee and forbidding a self-trade.
- **C20, append:** #53 (`0006`–`0008`): a card's origin is exactly one of its opening or its purchase, and it is removed by at most one recycle or purchase; the request role still holds no DELETE on `cards`; the reset deletes bought cards through `delete_bought_cards(account)` (`SECURITY DEFINER`, fixed search_path, schema-qualified, EXECUTE to `anime_app` alone), which raises while the account has an active listing; `cards_removed_stays` keeps `removed_by_purchase` too, which may go to null only once its purchase row is gone.
- **C22, append:** #53: `audit-ledger` checks every purchase against its three ledger rows, its listing and one card each way, plus orphan market rows and live listings whose card is not the seller's; `audit-market` (`--days 1..3650`) is the owner's read-only §10 report: net Karma per pair, lopsided pairs, sales at the floor and cap, listings bought within 60 s, and pairs sharing an invite code.
- **New control C24:** Market trust boundary between accounts.
  - **What it is:** the 5 % fee destroyed on every sale, the per-tier price bounds, the rolling 7-day window limits and no self-trade. A purchase is one transaction under both account rows in ascending id order.
  - **Where:** API / DB.
  - **Status:** live (#53).
    - `domain/market/rules.ts` bounds the asking price to the card's granted rarity.
    - `domain/economy/fee.ts` fixes the fee at listing time.
    - `domain/market/limits.ts` refuses a purchase that would pass any of: 100 purchases, 55 000 spent, 55 000 received, or 27 500 per pair and direction over 7 days (409 `market_limit` with `limit` and `retryAfterSeconds`).
    - The counts are read under both account locks, so no limit can be raced.
    - Detection of multi-accounting is after the fact (`audit-market`, C22). The residual is at most 52 250 Karma net per 7 days into one account (economy.md §10).
  - **Proven by:** `market/limits.test.ts`, `market/rules.test.ts`, `market.test.ts`, `market.hunt.test.ts` and `security/market.security.test.ts` §5–§6.
- **Open item, add:** Price band audit (#53 S2, low): the database bounds a listing's and purchase's price only to 1..`MAX_ENTRY_AMOUNT`; have `audit-ledger` fail or `Note:` a price outside its rarity's `MARKET_PRICE_MIN..MARKET_PRICE_MAX`, and a fee that is no deployed `fee(price)`.
- **Open item, add:** Pool wait (#53 S3, info): the api pool holds 10 connections and abandons a connection request after 3 s, so a purchase burst serialising on one account can make unrelated requests answer 500; size the pool and the wait together, or answer a purchase whose wait expires with 503.
- **Open item, rewrite** the existing "Market (item M)" entry: each account accrues its own pack allowance and the market now moves Karma and cards between accounts; `ACCOUNT_CAP` (10) and the invite codes remain the real control, with C24 bounding the flow and `audit-market` reporting it (at most 52 250 Karma net per 7 days into one account).
- **Roadmap:** row M (Player market): server side shipped (#53), UI (PR 4) remains; row 2: only the market UI is left.
