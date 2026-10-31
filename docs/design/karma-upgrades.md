# Karma upgrades

Roadmap row U · owner decisions [ADR 0015](../adr/0015-karma-upgrades.md) (2026-10-31; amends ADR 0011 §1) · server: `economy.md` §5, §7, §8, §9, §10, §11, §13 · timer: `collection-packs.md` §5.2 · page patterns: `market-and-shop.md` §3.3 and `collection-overview.md` §3.5, §8 · visual identity: `visual-identity.md` (PR #64, not yet on `main`; cited by section, and this spec follows it whether or not it merges first) · written 2026-10-31 · security tier **T3**

> **What the owner asked for, 2026-10-31.** "Paid upgrades that can be bought with Karma that give certain QoL benefits like more offline cards, faster refill, bigger trade budget. But they should be costly and you will need to grind for it." The owner then chose permanent levels, a first level of about two weeks of active play, and a capped trade budget (ADR 0015). This spec turns that into numbers, a server contract and one page. Every number below is derived in the open from `economy.md` §9, so a reviewer can redo it.

## 1. Goal

A player who has saved Karma can spend it on **permanent levels** of three upgrades: **Pack storage** (more timer packs stored while away), **Pack refill** (a shorter wait per timer pack) and **Trade budget** (higher 7-day market limits). Each level costs a long grind: the first about two weeks of an active player's Karma, each later one twice the one before. Each pack-rate level costs more Karma than its extra packs can return within a year, so every level stays a sink (ADR 0015 §4). The server holds every level, price and effect (ADR 0008), and publishes them all, as it publishes the odds (ADR 0004 §6). Upgrades are a third Karma sink beside the shop and the market fee (`economy.md` §9.3), and they never touch real money.

## 2. Out of scope

- **Refunds, resale, downgrades, gifting a level, or a level that expires.** A bought level is permanent and stays with the account (ADR 0015 §1). No route lowers a level.
- **Upgrades for the games** (items 5, 6). ADR 0015 allows them later under the same rules, each in its own spec.
- **Any other upgrade** (a bigger listing cap, a longer listing TTL, more recycle per request). ADR 0015 §2 lets a spec propose one; this one does not, to keep the first build small.
- **Changing the pair limit or the price bounds.** Both stay as they are at every level (ADR 0015 §5).
- **Changing the odds, the pity rule or the Enchanted cadence.** An upgrade changes how many free packs arrive, never what is in them.
- **Showing upgrades on the landing page, the demo or `/packs`.** The landing keeps stating the level 0 rules (`navigation-and-landing.md` §3.8), which are what a new account gets.
- **Prices that change at runtime.** As every economy number, a price or effect changes only by a deploy that changes this spec and `shared/src/economy.ts` (`economy.md` §2).

## 3. Ground rules

| ADR 0015                                                    | How this spec holds it                                                                                                                                                                                           | Proven by                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| §1 Permanent levels; never lost or refunded; no real money  | Levels are columns on `accounts` that only rise, by one, with a purchase row (§6.1 trigger); no route lowers one; a reset keeps them (§6.6)                                                                      | Trigger tests; route inventory; reset test               |
| §2 Storage, refill, trade budget                            | §4.2, §4.3, §4.4                                                                                                                                                                                                 | Unit tests over the tables                               |
| §3 First level about two weeks of active play, then doubled | 64 000, 128 000, 256 000, 512 000 for every upgrade (§4.1)                                                                                                                                                       | Invariant test                                           |
| §4 Every pack-rate level is a sink within a year            | Each level's price is above the most Karma its extra packs can return in 365 days, for the casual, active and ceiling player (§4.5); the bound stays linear (§5.1)                                               | A unit test recomputes §4.5 from the tables              |
| §5 Trade budget at most +50 %; pair and bounds unchanged    | Four steps of +12.5 % to +50 % on purchases, spend and proceeds; `MARKET_WINDOW_PAIR` and the price bounds are unchanged (§4.4); residual restated (§5.2)                                                        | Invariant test; route tests at every level               |
| §6 Server-authoritative, one `postEntry`, published         | One `upgrade_purchase` ledger entry per purchase, under the account lock, with a `requestId`; the client names only the upgrade and the level it saw (§6.3); `GET /api/upgrades` publishes every level and price | Route, concurrency and adversarial tests; `audit-ledger` |

## 4. Numbers

Every figure here uses `economy.md` §9: the free pack's long-run recycle value of **52.11 Karma**, which assumes every card is a duplicate (§9.1), and the three players of §9.2: **casual** (three visits a day, a full stock each time), **active** (opens each pack as it arrives for 16 waking hours, plus the stock that filled overnight) and **ceiling** (every pack, 24 hours a day). A year is 365 days.

### 4.1 Prices

| Level | Price, every upgrade | Why                                                                                                    |
| ----- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| 1     | 64 000               | Two weeks of an active player: 14 × 4 530 (§9.2.1's first-year average) = 63 420, rounded up to 64 000 |
| 2     | 128 000              | twice level 1                                                                                          |
| 3     | 256 000              | twice level 2                                                                                          |
| 4     | 512 000              | twice level 3                                                                                          |

- **Four levels, because one entry is the limit.** A fifth level would cost 1 024 000, above `MAX_ENTRY_AMOUNT` (1 000 000). Every price is one ledger entry; no price is split across entries (splitting would let a purchase half-commit in the audit's eyes, and a level is one thing bought once).
- **The grind, plainly.** One upgrade to level 4 costs 960 000; all three cost 2 880 000. At §9.2.1's first-year averages, level 1 of one upgrade takes an active player about 14 days, a ceiling player about 9 and a casual player about 287 (220 a day); every level of all three takes an active player about 636 days and a ceiling player about 420.
- The ADR's "about 60 000" becomes 64 000 so the ladder doubles in round numbers and every pack-rate level clears §4.5 with room; a manager default the owner may revise.

### 4.2 Pack storage (the ADR's "pack stock")

| Level | `cap` (packs stored) | Away time it covers, at the account's refill |
| ----- | -------------------- | -------------------------------------------- |
| 0     | 3 (today)            | 30 minutes at 10 minutes a pack              |
| 1     | 4                    | 40 minutes                                   |
| 2     | 5                    | 50 minutes                                   |
| 3     | 7                    | 70 minutes                                   |
| 4     | 10                   | 100 minutes (80 at refill level 4)           |

Storage never raises how many packs an account can get in a day: at most one per interval, whatever the cap (`collection-packs.md` §5.2). It lets a player who is away longer come back to more of them.

### 4.3 Pack refill

| Level | Interval (whole seconds) | Shown as             | Packs a day at most (86 400 / interval) |
| ----- | ------------------------ | -------------------- | --------------------------------------- |
| 0     | 600 (today)              | 10 minutes           | 144                                     |
| 1     | 590                      | 9 minutes 50 seconds | 146.44                                  |
| 2     | 570                      | 9 minutes 30 seconds | 151.58                                  |
| 3     | 540                      | 9 minutes            | 160                                     |
| 4     | 480                      | 8 minutes            | 180                                     |

The steps are small at first because the ceiling player gains the most from refill and §4.5 prices every level against it: level 1 may add at most 64 000 / (52.11 × 365) = 3.37 packs a day, and 590 seconds adds 2.44. 585 seconds would add 3.69, too many.

### 4.4 Trade budget

The three limits of one account rise together by the same factor; the pair limit does not move.

| Level | Factor (basis points)  | Purchases per 7 days | Spend per 7 days | Proceeds per 7 days (gross) | Pair per 7 days |
| ----- | ---------------------- | -------------------- | ---------------- | --------------------------- | --------------- |
| 0     | 10 000 (today)         | 100                  | 55 000           | 55 000                      | 27 500          |
| 1     | 11 250                 | 112                  | 61 875           | 61 875                      | 27 500          |
| 2     | 12 500                 | 125                  | 68 750           | 68 750                      | 27 500          |
| 3     | 13 750                 | 137                  | 75 625           | 75 625                      | 27 500          |
| 4     | 15 000 (the +50 % cap) | 150                  | 82 500           | 82 500                      | 27 500          |

- Each value is `floor(base × factor / 10 000)`: the Karma figures divide exactly, the purchase count rounds down (112.5 → 112, 137.5 → 137).
- **Which account's level counts:** a buyer's purchases and spend use the buyer's level, a seller's proceeds the seller's level (§6.4). The price bounds, the fee, the listing cap and the TTL are the same at every level.
- Every existing invariant still holds at every level: `MARKET_PRICE_MAX.mythic ≤ MARKET_WINDOW_PAIR ≤ proceeds` and `MARKET_PRICE_MAX.mythic ≤ spend`.
- Trade budget is not a pack-rate level, so §4.5 does not apply to it: it creates no Karma, it only lets Karma that exists move faster. Its bound is §5.2.

### 4.5 Payback: every pack-rate level is a sink within a year

**The argument.** A free pack's expected duplicates depend only on how many free packs the account opened before it, never on when (§9.2.1's model: the chance to hold a character after `n` packs). So in any year, a level's extra Karma is the recycle value of the extra packs it brings, and each of those yields at most 52.11. A level's extra Karma in a year is therefore at most `extra packs a day × 52.11 × 365` = `extra packs a day × 19 020`. A veteran account approaches that bound (98 % of it after 30 000 packs); a newer one earns less.

**Extra packs a day per level**, each against the level before it:

- **Refill** at interval `I` seconds: ceiling 86 400 / `I`; active 57 600 / `I` (16 hours) plus the stock; casual 0, because three visits eight hours apart always find the stock full (even 10 packs × 10 minutes is 100 minutes, far less than eight hours).
- **Storage** at cap `C`: casual 3 × `ΔC` (one `ΔC` per visit); active `ΔC` (the overnight stock); ceiling 0 (it never waits for the stock to fill).

The two upgrades do not interact for these players: the casual and the overnight gaps are longer than any cap × interval of the tables, so each level's gain is the same whatever the other upgrade's level.

**Pack storage**, extra packs a day · extra Karma a year at the bound · years to pay back the price:

| Level | Change | Price   | Casual                 | Active             | Ceiling |
| ----- | ------ | ------- | ---------------------- | ------------------ | ------- |
| 1     | 3 → 4  | 64 000  | +3 · 57 060 · **1.12** | +1 · 19 020 · 3.36 | never   |
| 2     | 4 → 5  | 128 000 | +3 · 57 060 · 2.24     | +1 · 19 020 · 6.73 | never   |
| 3     | 5 → 7  | 256 000 | +6 · 114 121 · 2.24    | +2 · 38 040 · 6.73 | never   |
| 4     | 7 → 10 | 512 000 | +9 · 171 181 · 2.99    | +3 · 57 060 · 8.97 | never   |

**Pack refill**, the same columns:

| Level | Change    | Price   | Casual | Active                  | Ceiling                   |
| ----- | --------- | ------- | ------ | ----------------------- | ------------------------- |
| 1     | 600 → 590 | 64 000  | never  | +1.63 · 30 948 · 2.07   | +2.44 · 46 422 · 1.38     |
| 2     | 590 → 570 | 128 000 | never  | +3.43 · 65 154 · 1.96   | +5.14 · 97 731 · **1.31** |
| 3     | 570 → 540 | 256 000 | never  | +5.61 · 106 780 · 2.40  | +8.42 · 160 170 · 1.60    |
| 4     | 540 → 480 | 512 000 | never  | +13.33 · 253 602 · 2.02 | +20.00 · 380 403 · 1.35   |

**The worst case is storage level 1 for a casual player: 1.12 years**, 57 060 of its 64 000 back in the first year. Every other level takes longer. No level pays for itself within a year for any of the three players, even with every extra card a duplicate.

A player who returns exactly when a bigger stock fills, around the clock, gains more from storage than the casual player: up to `packs a day × ΔC / C` (36 a day at level 1). That player could get the same packs at level 0 by returning every 30 minutes; storage never raises the ceiling, so it cannot move §5.1's bound. Pricing storage against §9.2's three players rather than every visit pattern is owner decision 1 (§12).

### 4.6 The collection-fill curve

The curve of §9.2.1 is a function of free packs opened, so the levels do not change its shape: an account with more packs a day walks the same curve faster. Duplicates, Enchanted packs (every 10th free pack) and the pity guarantee (within 300 free packs) all come per free pack, so they come proportionally sooner and are already inside the 52.11 bound.

| Player, all levels from day one (an upper illustration: nobody starts with them) | Free packs a day | Karma in the first year | A day, on average | At level 0 |
| -------------------------------------------------------------------------------- | ---------------- | ----------------------- | ----------------- | ---------- |
| Casual, storage 4                                                                | 30               | 398 910                 | 1 093             | 223        |
| Active, storage 4, refill 4                                                      | 130              | 2 240 073               | 6 137             | 4 531      |
| Ceiling, refill 4                                                                | 180              | 3 189 635               | 8 739             | 6 865      |

- The ceiling player reaches 30 000 packs (98 % of the bound) in 167 days instead of 208.
- Completing every Mythic (about 49 600 free packs, `collection-packs.md` §5.4.6) takes 276 days at 180 a day instead of 345, and a casual player with storage 4 about 4.5 years instead of 15. The market and recycling remain how players close the gap.

### 4.7 The timer with levels: integers and boundaries

The allowance keeps `collection-packs.md` §5.2's one timestamp and its formulas; `C` and `I` become the account's own, read from its row under the lock.

```
C, I              = PACK_CAP_BY_LEVEL[storage_level], PACK_INTERVAL_SECONDS_BY_LEVEL[refill_level] × 1 000   -- I in ms
anchor            = packs_anchor_at, or now − C·I when it is null (full)
available         = clamp(floor((now − anchor) / I), 0, C)
nextPackInSeconds = null when available = C, else ceil((anchor + (available + 1)·I − now) / 1 000), at least 1
on an opening:      packs_anchor_at ← max(anchor, now − C·I) + I
```

- **Whole seconds, so nothing fractional.** Today the code multiplies `PACK_INTERVAL_MINUTES` by 60 000. 590 and 570 seconds are not whole minutes, so the constant becomes `PACK_INTERVAL_SECONDS_BY_LEVEL` and the code multiplies seconds by 1 000. Every interval is a whole number of seconds, so `I` is a whole number of milliseconds, `PackAllowance.intervalSeconds` stays an integer, and the `floor` and `ceil` above are the only rounding, as today. An interval that is not whole seconds is refused by the invariant test; it would need `intervalSeconds` to change unit in the contract.
- **Server time, millisecond integers.** Anchors are written from the server's `Date` (milliseconds) and read back exactly; every product is below 2^53 (an anchor near 1.8 × 10^12 plus at most 10 × 600 000).

**On a purchase of storage or refill** the anchor is rewritten in the same transaction, so that the purchase **neither creates nor removes a pack** and **never banks time the old cap threw away**. With the old rules `C, I`, the new rules `C', I'` (only one of the two changes) and `t` the server time under the lock:

```
a = available at t under the old rules
if a = C:                                  -- full under the old rules
  packs_anchor_at ← null                   if C' = C   (refill: still full)
  packs_anchor_at ← t − C·I'               if C' > C   (storage: C packs now, the new room starts filling at t)
else:                                      -- not full: the anchor is not null
  d = anchor + (a + 1)·I − t               -- ms to the next pack under the old rules; d ≥ 1
  packs_anchor_at ← t + min(d, I') − (a + 1)·I'
```

What that gives, each a unit test (§8):

1. **The count is unchanged at `t`**: `available` under the new rules is `a`. (In the else branch `t − anchor' = (a + 1)·I' − min(d, I')`, which lies in `[a·I', (a + 1)·I')`.)
2. **The next pack never moves later**: it comes at `t + min(d, I')`. A storage purchase leaves the anchor exactly as it was (`I' = I`, so `min(d, I) = d`); a refill purchase keeps the countdown the player sees, unless it was longer than the new interval, when it becomes the new interval.
3. **Time is never banked.** An account full under the old cap gets no packs for the time it sat full: a bigger stock starts filling at `t`. This keeps 1c's rule that an account away for a week comes back to its cap, not to more.
4. **A clock set back** (an anchor in the future) gives `a = 0` and a `d` above `I`; `min(d, I')` shortens that wait to one new interval at most, and grants nothing beyond the new rate.
5. A reset sets the anchor to `null`, full at the account's own cap (§6.6).

### 4.8 Constants for `shared/src/economy.ts`

Each `_BY_LEVEL` table is indexed by level, 0 to `UPGRADE_MAX_LEVEL`; index 0 is today's value, so a level 0 account behaves exactly as today.

```ts
/** The upgrades, in the order the page and `GET /api/upgrades` list them (karma-upgrades.md §4). */
export const UPGRADES = ["storage", "refill", "trade"] as const;
/** Levels above 0 per upgrade; a fifth would cost more than MAX_ENTRY_AMOUNT (§4.1). */
export const UPGRADE_MAX_LEVEL = 4;
/** Karma per level, index level − 1; each twice the one before (§4.1). */
export const UPGRADE_PRICE = {
  storage: [64_000, 128_000, 256_000, 512_000],
  refill: [64_000, 128_000, 256_000, 512_000],
  trade: [64_000, 128_000, 256_000, 512_000],
} as const;

/** Timer packs stored at most, by storage level (§4.2). */
export const PACK_CAP_BY_LEVEL = [3, 4, 5, 7, 10] as const;
export const PACK_CAP = PACK_CAP_BY_LEVEL[0];
/** The largest cap any account can have; bounds `PackAllowance.available`. */
export const PACK_CAP_MAX = 10;
/** Seconds per timer pack, by refill level; whole seconds (§4.3, §4.7). Replaces PACK_INTERVAL_MINUTES. */
export const PACK_INTERVAL_SECONDS_BY_LEVEL = [600, 590, 570, 540, 480] as const;
export const PACK_INTERVAL_SECONDS = PACK_INTERVAL_SECONDS_BY_LEVEL[0];

/** The trade budget's factor on the three own-account window limits, in basis points, by trade level (§4.4). */
export const TRADE_BUDGET_BPS = [10_000, 11_250, 12_500, 13_750, 15_000] as const;
/** ADR 0015 §5: all levels together raise the limits by at most 50 %. */
export const TRADE_BUDGET_MAX_BPS = 15_000;
export const MARKET_WINDOW_PURCHASES_BY_LEVEL = [100, 112, 125, 137, 150] as const;
export const MARKET_WINDOW_SPEND_BY_LEVEL = [55_000, 61_875, 68_750, 75_625, 82_500] as const;
export const MARKET_WINDOW_PROCEEDS_BY_LEVEL = [55_000, 61_875, 68_750, 75_625, 82_500] as const;
// MARKET_WINDOW_PURCHASES, _SPEND and _PROCEEDS become the [0] of these; MARKET_WINDOW_PAIR is unchanged.

/** The horizon every pack-rate level must not pay back within (ADR 0015 §4). */
export const UPGRADE_PAYBACK_DAYS = 365;
```

**Invariants**, each a unit test over the file: every table has `UPGRADE_MAX_LEVEL + 1` entries and its `[0]` equals today's value; `PACK_CAP_BY_LEVEL` strictly rises and its last is `PACK_CAP_MAX`; `PACK_CAP_MAX ≤ PACK_RATE_LIMIT.max` (20 a minute, so a full stock can be opened in a minute; an api test, since the limit lives in `api/`); `PACK_INTERVAL_SECONDS_BY_LEVEL` strictly falls and holds positive safe integers; `TRADE_BUDGET_BPS` strictly rises from 10 000 to at most `TRADE_BUDGET_MAX_BPS`; each `MARKET_WINDOW_*_BY_LEVEL[k]` is `floor(base × TRADE_BUDGET_BPS[k] / BPS_SCALE)`; at every level `MARKET_PRICE_MAX.mythic ≤ MARKET_WINDOW_PAIR ≤ proceeds` and `MARKET_PRICE_MAX.mythic ≤ spend`; every price is a positive safe integer, each twice the one before, and `≤ MAX_ENTRY_AMOUNT`; and §4.5 recomputed: for each pack-rate level, `price > UPGRADE_PAYBACK_DAYS × 52.11 × extra packs a day` for the casual, active and ceiling player, with 52.11 from 1c's chain as §9's test already computes it. `MAX_BALANCE + MAX_ENTRY_AMOUNT ≤ 2^31 − 1` is unchanged and covers every purchase.

## 5. The model update (`economy.md` §9, §10)

### 5.1 The faucet still grows at most linearly

- **Per account**, the most free packs a day is `86 400 / PACK_INTERVAL_SECONDS_BY_LEVEL[refill_level]`: 144 at level 0, **180 at refill level 4**. Storage does not raise it (§4.2). Trade budget mints nothing. So a fully upgraded account recycles at most **180 × 52.11 = 9 380 Karma a day** (today 7 505, 1.25 times), whatever its balance.
- **All accounts**: at most `N × 9 380` a day, **93 800 at the ten-account cap** (today 75 050). Still a constant times the number of accounts, never a share of a balance.
- **The shop loop still contracts**: an account at 9 380 a day can fund at most 9 380 / 360.20 ≈ 26.0 themed packs a day.
- **Cards**: at most 900 a day from timer packs (180 × 5), 130 from themed packs and about 21 bought (150 purchases a week), about 1 050 in all.
- **Upgrades are a sink with a ceiling**: at most 2 880 000 Karma per account, once, and every level destroys more than its packs return in a year (§4.5). Over many years a pack-rate level does pay for itself; the faucet's bound above is what holds regardless.
- **A balance that is never spent** (§9.5): at most 9 380 a day from duplicates plus 11 196 a day net from the market at trade level 4 (§5.2), about 20 600 a day. `MAX_BALANCE` is about 133 years away.

### 5.2 The multi-account residual at the trade cap

The attack of `economy.md` §10: alternate accounts pay a main account through the market. What bounds it is the **main's own proceeds limit**, now the main's trade level:

| Main's trade level | Gross proceeds per 7 days | Net after the 5 % fee | A day  | Against the main's own 7 505 a day | Total, as a multiple of one account |
| ------------------ | ------------------------- | --------------------- | ------ | ---------------------------------- | ----------------------------------- |
| 0 (today)          | 55 000                    | 52 250                | 7 464  | 0.99                               | 1.99 ×                              |
| 4 (the cap)        | 82 500                    | **78 375**            | 11 196 | **1.49**                           | **2.49 ×**                          |

- At the cap, multi-accounting can raise one account's Karma income to about **2.5 times** its own (2.49), never more, whatever the number of accounts. Against a main that also has refill level 4 (9 380 a day of its own) the ratio is 1.19, 2.19 times in all.
- **What it costs the farmer**: the main must buy trade level 4 (960 000 Karma, destroyed), and since the pair limit stays 27 500, it needs **at least three** alternates to fill 82 500 a week (today two). Only the receiving account's level counts; the alternates need none.
- **Cards the other way**: a main at trade level 4 buys at most 150 cards and 82 500 Karma per 7 days, for example 15 Mythics at the floor (5 500) or 150 Legendaries (75 000).
- The real control is unchanged: an invite-only roster capped at ten. `audit-market` gains each account's trade level next to its pair figures (§6.6), so the owner sees which accounts raised their limits. The security officer restates this residual in the register (§9).

## 6. Server

### 6.1 Data and migration

```
accounts gains
  storage_level   smallint not null default 0   -- check (storage_level between 0 and UPGRADE_MAX_LEVEL)
  refill_level    smallint not null default 0   -- check (refill_level between 0 and UPGRADE_MAX_LEVEL)
  trade_level     smallint not null default 0   -- check (trade_level between 0 and UPGRADE_MAX_LEVEL)
  trigger accounts_upgrade_level_step before update of storage_level, refill_level, trade_level
                  -- each level stays, or rises by exactly 1 when an upgrade_purchases row for (account, upgrade, new level) exists;
                  -- anything else raises integrity_constraint_violation, whoever runs it, the app role included

upgrade_id        enum: storage, refill, trade
ledger_kind       gains upgrade_purchase           -- a debit

upgrade_purchases                                  -- one row per level bought: the idempotency record and the receipt
  id              uuid pk default gen_random_uuid()
  account_id      uuid not null references accounts(id) on delete cascade
  request_id      uuid not null
  upgrade         upgrade_id not null
  level           smallint not null                -- check (level between 1 and UPGRADE_MAX_LEVEL): the level bought
  price           integer not null                 -- check (price between 1 and MAX_ENTRY_AMOUNT): that day's UPGRADE_PRICE
  ledger_entry_id uuid not null unique references ledger_entries(id)
  created_at      timestamptz not null
  unique (account_id, request_id)
  unique (account_id, upgrade, level)              -- a level is bought once: the backstop of §6.5
```

- **Migration `0009_karma_upgrades.sql`**, the next after 0008. The three columns are added with `default 0`, so **every existing account starts at level 0 of every upgrade**, which is today's behaviour (ADR 0015, Consequences). `ALTER TYPE ledger_kind ADD VALUE 'upgrade_purchase'`: Postgres does not let a transaction use an enum value it added, so nothing in 0009 refers to the new value (no check or default names it).
- **Rights**, pinned in `db-role.test.ts` after 0005's and 0006's pattern: `upgrade_purchases` gets `SELECT` and `INSERT` only (append-only, like `recycles` and `market_purchases`); `accounts` keeps its `UPDATE`, and the trigger is what stops a write of a level without a purchase.
- **The trigger is a backstop**, as every check in `economy.md` §7: the domain refuses first with a typed error. A level that fires it means a bug or a forged write, and `audit-ledger` reports what it could not stop (an owner-role write, §6.6).
- Deleting an account removes its purchases with it (cascade).

### 6.2 Contract (`shared/src/api.ts`, `shared/src/errors.ts`)

```
UpgradeId          "storage" | "refill" | "trade"                     -- from UPGRADES
StorageEffect      { cap: integer 1..PACK_CAP_MAX }
RefillEffect       { intervalSeconds: integer ≥ 1 }
TradeEffect        { purchases: integer ≥ 1, spend: integer ≥ 1, proceeds: integer ≥ 1,
                     pair: integer ≥ 1 }                              -- pair is the same at every level, published so the page can say so
UpgradeLevel<E>    { level: integer 0..UPGRADE_MAX_LEVEL,
                     price: integer 1..MAX_ENTRY_AMOUNT | null,       -- null for level 0
                     effect: E }
Upgrade            { id: "storage", level: integer 0..max, maxLevel: integer, levels: UpgradeLevel<StorageEffect>[max + 1] }
                 | { id: "refill",  level, maxLevel, levels: UpgradeLevel<RefillEffect>[max + 1] }
                 | { id: "trade",   level, maxLevel, levels: UpgradeLevel<TradeEffect>[max + 1] }
                                                                      -- levels[level].effect is in force; levels[level + 1] is next
UpgradesResponse   { balance: integer ≥ 0, upgrades: Upgrade[3] }     -- in UPGRADES order
UpgradeBuyBody     { requestId: uuid }                                -- nothing else
UpgradeReceipt     { purchaseId: uuid, boughtAt: date-time, upgradeId: UpgradeId,
                     level: integer 1..UPGRADE_MAX_LEVEL, price: integer ≥ 1,
                     upgrade: Upgrade,                                -- that upgrade after the purchase (current, on a replay)
                     balance: integer ≥ 0 }
PackAllowance      (1c) available: integer 0..PACK_CAP_MAX            -- was 0..PACK_CAP; cap and intervalSeconds are the account's
KarmaRules.window  (economy.md §11.2) carries the caller's own limits at its trade level; pair unchanged
```

**Error codes**, new: `upgrade_at_max` (409: the upgrade is at its highest level) and `upgrade_level_stale` (409: the level named is not the account's next level). Neither carries an extra field; the UI refetches `GET /api/upgrades`. `insufficient_funds` (409, with `balance`) and `request_id_reused` (409) are `economy.md`'s.

| Method, path                                    | Body             | Success                               | Errors (status, code)                                                                                                                                                  | Limit  |
| ----------------------------------------------- | ---------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `GET /api/upgrades`                             | —                | 200 `UpgradesResponse`                | 401 `unauthenticated`                                                                                                                                                  | global |
| `POST /api/upgrades/{upgradeId}/levels/{level}` | `UpgradeBuyBody` | 201 `UpgradeReceipt`; 200 on a replay | 400 `validation_failed`, 401, 403 `bad_origin`, 409 `insufficient_funds`, 409 `upgrade_at_max`, 409 `upgrade_level_stale`, 409 `request_id_reused`, 429 `rate_limited` | 30/min |

- `GET /api/upgrades` takes `NoQuery`. `upgradeId` in the path is one of `UPGRADES`; `level` is a digit string (no sign, leading zero, exponent or whitespace, `economy.md` §16 M2) from 1 to `UPGRADE_MAX_LEVEL`; anything else is 400. The body is `additionalProperties: false`: a `price`, `amount`, `cap`, `intervalSeconds`, `limit` or `level` in it is an unknown field (400).
- **Why the level is in the path.** The player confirms one level at one price. If the account's level moved since (a second tab, a replayed click), buying "the next level" would charge a price the player never saw, twice the one shown. Naming the level lets the server refuse instead of charging a different amount.
- The POST is behind the CSRF check; `CARD_ACTION_RATE_LIMIT` (30 a minute per client address) replaces the global bucket for it, as for every Karma action (`economy.md` §8.12). Response schemas declare every status above.
- The route inventory (`economy.md` §14) gains exactly these two routes.

### 6.3 Buying a level

`POST /api/upgrades/{upgradeId}/levels/{level}` with `{ requestId }`, one transaction:

1. The schema checks the path and the body (§6.2).
2. Lock the account row (`SELECT balance, storage_level, refill_level, trade_level, packs_anchor_at ... FOR UPDATE`). No row → 401.
3. **Replay**: a purchase of this account with this `requestId` and the same (upgrade, level) → 200 with its receipt (its level, price and time as stored; the upgrade's and the balance's current state). The same key with another (upgrade, level) → 409 `request_id_reused`. Nothing is written.
4. `current` = the account's level of that upgrade. `current = UPGRADE_MAX_LEVEL` → 409 `upgrade_at_max`.
5. `level ≠ current + 1` → 409 `upgrade_level_stale`.
6. `price = UPGRADE_PRICE[upgradeId][level − 1]`, the value in force now. Balance below the price → 409 `insufficient_funds` with the `balance`.
7. Read the server clock once, under the lock. Write, in this order: the `upgrade_purchase` entry of `− price` through `economy.md` §8.1's one function (`postEntry`), which also writes the balance; the `upgrade_purchases` row with that `price` and entry; for storage or refill, the new `packs_anchor_at` of §4.7; the level column to `level` (the trigger finds the row just written). Commit; answer 201.

A refused request leaves no record, so its key can succeed later (`economy.md` §8.8). The price on the receipt is the amount that counts; prices change only by a deploy, so a confirmation and its answer can differ only across one.

### 6.4 How the timer and the market read a level

Every read takes the level from the account row the request already reads; the client sends none, and nothing in a request can name a cap, an interval or a limit.

- **The timer**: `allowanceAt(anchor, now, rules)` and `anchorAfterOpening(anchor, now, rules)` take `rules = { cap, intervalSeconds }` built from the row's `storage_level` and `refill_level`. `POST /api/packs/open` already locks that row and reads it in step 1 (`collection-packs.md` §5.3); it adds the two columns. `GET /api/packs`, `PackOpened.allowance` and `ShopReceipt.pack.allowance` answer the account's own `cap` and `intervalSeconds`. The landing and demo facts (`GET /api/demo`) keep answering level 0's, renamed `BASE_ALLOWANCE_RULES`.
- **The market**: a purchase already locks both accounts in ascending id order (`economy.md` §8.5 step 3); step 6 reads the buyer's `trade_level` for `buyer_purchases` and `buyer_spend`, and the seller's for `seller_proceeds`; `pair` is `MARKET_WINDOW_PAIR` for everyone. `firstLimitHit` and `windowLeft` take the limits as a parameter, so `retryAfterSeconds` is computed against the limit that refused. `GET /api/market/mine`'s `left` and `GET /api/wallet`'s `rules.window` use the caller's level.
- A raised trade level applies to the window's existing history at once: the same purchases count against a higher limit. A level never falls, so a limit never drops under a window already used.

### 6.5 Concurrency

All of it follows `economy.md` §8.9's one lock order: account rows first, then listings, cards, the ledger. A purchase locks one account row and then writes the ledger, so it adds no new order.

- **Two purchases of one upgrade racing** (two tabs, both showing level 1): both lock the account row, so they run one after the other. The first buys level 1; the second names level 1 against a current level of 1 → 409 `upgrade_level_stale`. One debit; nobody is charged for a level they did not confirm. `unique (account_id, upgrade, level)` is the backstop.
- **The same `requestId` twice in parallel** → one 201 and one 200 with the same receipt.
- **Two different upgrades with the balance for one** → one 201, one 409 `insufficient_funds`; the balance never goes negative.
- **A purchase racing a pack opening**: both lock the account row. If the purchase commits first, the opening reads the new levels and the rewritten anchor; if the opening commits first, the purchase rewrites the anchor the opening left. Either order, §4.7's rules 1 to 3 hold at each step: no pack appears or disappears at the purchase, and the opening is refused or dealt exactly as the allowance at its turn says.
- **A purchase racing a market purchase** of which the account is the buyer or the seller: they serialise on that account row. The market purchase uses the trade level it reads under its lock, before or after the upgrade; a spend on each side with the balance for one gives one 201 and one 409 `insufficient_funds`. No deadlock: the upgrade takes one account row and nothing that the market purchase locks before it.
- **A purchase racing a shop purchase, a recycle or a reset**: they serialise on the account row; the reset keeps the level either way (§6.6).

### 6.6 Ledger, audit, reset and logging

- **Ledger kind** `upgrade_purchase`, a debit; `economy.md` §4's list of kinds gains it. It is the only kind a purchase writes.
- **`audit-ledger`** (`economy.md` §13.1) gains, per account: every `upgrade_purchase` entry is named by exactly one `upgrade_purchases` row of the same account, whose `price` is the entry's `− amount`, and every row names an entry of that kind; for each upgrade, the rows' levels are exactly 1 to `L` with none missing or repeated, and `L` is the account's level column (`refill level 2 with purchases for levels 1`); a row whose `price` differs from today's `UPGRADE_PRICE` is a `Note:` line that never changes the exit code, as recycles' `unit_value` is. This catches a level written by a role that can bypass the trigger.
- **`audit-market`** (`economy.md` §13.3) prints each account's trade level beside its pair figures.
- **Reset** (`reset-collection`, `economy.md` §8.10): the levels stay, as ADR 0015 §1 says a level is never lost, and no `upgrade_purchases` row is deleted. The anchor goes to `null`, full at the account's own cap. The dry run adds `upgrades kept: storage 2, refill 0, trade 1` when any level is above 0. The owner's remedy for an abused account stays deleting it, which removes its levels with it.
- **Logging** at `info`, with the request id: upgrade bought (account, upgrade, level, price, balance after, replay or not). Never a whole body.

## 7. Web

### 7.1 Where it lives: a page under the Shop

Three options, as a page decision (owner decision 3, §12):

| Option                                                            | For                                                                                                                                                                                                         | Against                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `/shop/upgrades`, a page in the Shop section** (recommended) | Karma is spent in one section; the page has its own address, title and `h1`, survives a reload and works with Back; no new header link; the phone tab bar (`visual-identity.md` §10.3) keeps its five slots | The Shop gains a two-link switch, `Packs` · `Upgrades`                                                                                                                                                                                        |
| B. A section on `/shop`                                           | No new route                                                                                                                                                                                                | Thirteen genre packs come first, so three rare, permanent purchases sit at the end of a long list or push the repeat purchase down; a pack bought daily and a level bought every few months share one confirmation pattern and one page title |
| C. `/upgrades`, a top-level page                                  | Most visible                                                                                                                                                                                                | Needs a sixth header link and has no slot in the five-slot tab bar, so on a phone it would hide in the Account menu; a page bought from a few times a year does not earn a place beside Packs and Collection                                  |

**Recommendation: A.** Its routing follows the opening pages' precedent (`navigation-and-landing.md` §3.13 step 6): the header's `Shop` link keeps the current fill with `aria-current="true"` on `/shop/upgrades`, and so does the tab bar's `Shop` slot. Unlike an opening page, `/shop/upgrades` is a full account page: the guard sends a signed-out visitor to `/login` with it as the return path, so the return-path list (`navigation-and-landing.md` §3.3) gains `/shop/upgrades`. `mockup-artist` shows the page in variants for the owner (ADR 0015, Consequences).

### 7.2 Flow

1. **`/shop` gains a section switch** under its page header (`visual-identity.md` §10.1): two links, `Packs` (`/shop`) and `Upgrades` (`/shop/upgrades`), in a `<nav aria-label="Shop">`, the current one with `aria-current="page"`. It looks like the market's view switch (`market-and-shop.md` §3.4 step 1), but these are links with addresses, not view buttons. `/shop/open` does not show it.
2. **Arriving** at `/shop/upgrades` (by the switch, Back, Forward or the address) sets the title `Upgrades · Anime TCG` and moves focus to the `h1` `Upgrades`, as every page (`navigation-and-landing.md` §3.6). It fetches `GET /api/upgrades` and the wallet. First load: the 300 ms rule and skeleton of `collection-overview.md` §3.1; held data shows at once and refetches silently.
3. **Three upgrades, in the server's order** (storage, refill, trade), each an article with:
   - its name (`h2`) and `Level <L> of <max>`;
   - what is in force now, from `levels[L].effect`;
   - below the maximum: the next level's effect from `levels[L + 1].effect` and its price; the balance against the price (a bar and a line, §7.5, §7.7); and `Buy level <L + 1>…`;
   - at the maximum: `Highest level.` and nothing to buy;
   - a disclosure `All levels` (a native `<details>`): a table of every level with its effect and price, the current row marked. This is the published table ADR 0015 §6 asks for, as the odds are.
   - for the trade budget, the line that the per-seller limit stays the same at every level.
4. `Buy level <n>…` is **disabled, with the reason under it, when the balance is below the price** (`Costs <price> Karma. You have <B>.`), as the shop's `Buy…` (`market-and-shop.md` §3.3 step 3). Not authoritative; the server checks again. The bar and line keep showing the balance against the price; nothing else changes when the balance reaches it: no colour, motion, badge or new wording.
5. **The confirmation** (a native `<dialog>` in the Manage account shell, as the shop's): heading `Buy <Upgrade> level <n>?`; body: the level's effect, the price, the balance before and after (`You have <B> Karma. After this you'll have <B − price> Karma.`) and that a level is permanent, with no undo and no refund. `Buy for <price> Karma` and `Cancel`. The after figure is display only, from the held balance and the published price.
6. The confirm button sends `POST /api/upgrades/<upgradeId>/levels/<n>` with `{ requestId }`. The key follows the shop's rule (`useKeyedAction`, `market-and-shop.md` §3.8): kept on no answer and on a 429, discarded on every other answer, on `Cancel`, on close and on unmount. In flight: `Buying…`, with the button, `Cancel` and Escape disabled; nothing closes the confirmation while the request is in flight.
7. **Answers**:
   - **201, or 200 on a replay**: the dialog closes; the article takes `receipt.upgrade`; the header's Karma takes `receipt.balance`; the article's status line reads `Bought <Upgrade> level <n>. You have <B> Karma.` and takes focus. After storage or refill, the signed-in layout sends one `GET /api/packs` (newest-request-wins, `visual-identity.md` §10.2), so the Packs ready chip and `/packs` show the new cap and interval. After the trade budget, the Market page drops a held buyer-side `market_limit` (`market-and-shop.md` §3.8: the buyer's own limits) and marks `mine` and the wallet stale, so the next showing reads the new limits.
   - **`insufficient_funds`**: the confirmation stays; the red line `This level costs <price> Karma. You have <B> Karma.` (B from the error's `balance`, which also replaces the header's); confirm disabled.
   - **`upgrade_level_stale`**: the dialog closes, the page refetches `GET /api/upgrades`, and the article shows the neutral notice `This upgrade changed since the page loaded. Nothing was bought.` (`tabindex="-1"`, focused).
   - **`upgrade_at_max`**: as stale, with `This upgrade is already at its highest level. Nothing was bought.`
   - **`request_id_reused`**: never expected (keys are fresh); shown as the server failure.
   - **Rate limited, any other answer, no answer, `unauthenticated`**: as `collection-overview.md` §3.5 step 9, with the shop's settled rules (`market-and-shop.md` §3.8): the 429 wait lives on the page and survives `Cancel`; `Try again` resends the same `requestId`, so a lost answer shows the level that was bought instead of buying another (a second level would be refused as stale anyway); `Cancel` after no answer discards the key and refetches the upgrades and the wallet.
8. **Nothing outside this page mentions upgrades.** `/packs`, its countdown, the pack sheet, the header chips and the market never suggest a faster refill, a bigger stock or a bigger budget, and no badge appears on `Shop` when a level becomes affordable (ADR 0004 §6; `packs-page.md` §2's "no badge"). The countdown on `/packs` shows the account's own interval, from the server, as today.

### 7.3 States

| View         | State                     | User sees                                                                                                         | User can do            |
| ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Page         | loading (after 300 ms)    | The header and the switch; three skeleton articles (static `night-800` bars); visually hidden `Loading upgrades…` | Wait                   |
| Page         | error, nothing held       | `Couldn't load the upgrades.` and `Try again`                                                                     | Try again              |
| Page         | loaded                    | Three articles                                                                                                    | Buy, open `All levels` |
| Page         | stale (a refetch failing) | The held articles; every `Buy level <n>…` disabled, reason `Buying waits until the game server answers.`          | Open `All levels`      |
| Article      | affordable                | Next level, price, full bar, `You have <B> Karma. This level costs <price> Karma.`, the button enabled            | Buy level <n>…         |
| Article      | not affordable            | Next level, price, partial bar, `You have <B> of <price> Karma.`, the button disabled with the reason             | Open `All levels`      |
| Article      | at the highest level      | `Level 4 of 4`, the effect in force, `Highest level.`; no bar, no button                                          | Open `All levels`      |
| Article      | changed elsewhere         | The refetched article and the neutral notice                                                                      | Continue               |
| Confirmation | confirm, buying, failures | As `collection-overview.md` §4.6, with this spec's copy                                                           | Confirm, cancel        |
| Article      | bought                    | The article at its new level; the status line, focused                                                            | Continue               |
| Page         | signed out                | Sent to `/login`, return path `/shop/upgrades`                                                                    | Log in                 |

Session ended and unreachable: `accounts.md` §4.8, as everywhere. A balance of 0 is not a state of its own: it is "not affordable" with an empty bar.

### 7.4 Layout

- **Page**: the page header of `visual-identity.md` §10.1 (eyebrow, `h1`), then the section switch (`mt-6`), then one column, `max-w-3xl`, as the shop (`market-and-shop.md` §5.2). Gutter 16 px on a phone, 24 px from `sm` (`visual-identity.md` §6.1).
- **Article**: `border-b` in `night-700`, `py-6`. Row 1: the `h2` on the left, `Level <L> of <max>` on the right (below 640 px, under the `h2`). Then the in-force line, then the next block: the `Next` label, the next-level line, and on its right from 640 px the price and the button; below 640 px the price, then the bar and its line, then the button full width (48 px tall, `visual-identity.md` §10.4). From 640 px the bar sits under the next-level line, full width of the text column, with the button to the right.
- **At 320 px** (288 px of content): `Pack storage` and `Trade budget` in the `section` size (24 px display, 85 % width) fit on one line; the trade budget's next-level line wraps to three lines; `You have 1,000,000,000 of 512,000 Karma.` wraps once; the `All levels` table has three columns (`Level`, `Effect`, `Price`), the effect cell wraps, and the table never scrolls sideways. No horizontal scroll anywhere.
- **Confirmation**: the shop's dialog layout (`collection-overview.md` §5.4).

### 7.5 Visual treatment

All tokens are `visual-identity.md` §12's; nothing new is needed.

- **Page header** (§10.1 there): eyebrow `Permanent levels` (mono, `ink-400`, uppercase by CSS), title `Upgrades` in `title`. No stat line: the balance is in the header's Karma chip (§10.2 there).
- **Section switch**: the links in `small` sans 500; current `ink-100` with a 2 px `volt` underline (the tab bar's current marker, §10.3 there), others `ink-400`, hover `ink-100`. No fill, no box.
- **Article**: `h2` in `section` (display, `ink-100`); `Level <L> of <max>` in `eyebrow` (mono, `ink-400`); beside it a level track of `max` segments, each 16 × 4 px, `radius 2px`, 4 px apart, filled `ink-300` up to the level and `night-700` above it, `aria-hidden`. The track is not the Orbit: the Orbit's sockets mean tiers and nothing else (§3 principle 6 there). The in-force line `small` `ink-300`; the `Next` label `eyebrow`; the next-level line `body` `ink-100`; numbers in running text `tabular-nums` (§4.2 there).
- **Price**: `<price> Karma`, the number in `num` `ink-200`, the word `xs` `ink-400`, as the shop's price (§11.4 there).
- **Balance against the price**: a bar 6 px tall, full width, `radius 3px`, track `night-800`, fill `ion` (the Karma colour, §5.2 there) at `min(B, price) / price` of the width, at least 2 px when B > 0. Static: it does not animate when the balance changes, does not pulse and does not change colour when full. The line under it in `small` `ink-300`, the balance number in `num` `ion`, the price in `num` `ink-200`.
- **Buttons**: `Buy level <n>…` is `BUTTON.primary` (`volt`), as the shop's `Buy…` (`market-and-shop.md` §6); disabled as §10.4 there. The reason under it `xs` `ink-400`. Nothing is larger or louder than the shop's button.
- **`All levels` table**: `small`; header row `eyebrow`; numbers `num`; the current row `ink-100` with the word `current`, the others `ink-300`; hairlines `night-700`.
- **Errors** in `danger` with `role="alert"`; the neutral notices and status lines `small` `ink-200`.
- Nothing glows, shines or moves: no motion beyond `page-enter` and the dialog's `pop-in` (§9.1 there).

### 7.6 Accessibility

- **Landmarks and headings**: `<main>` starts with the `h1` `Upgrades` (`tabindex="-1"`, the focus target on navigation and of `Skip to content`); the eyebrow is `<p aria-hidden="true">`. The section switch is `<nav aria-label="Shop">` with real links. Each upgrade is an `<article aria-labelledby>` on its `h2`.
- **Header**: on `/shop/upgrades` the `Shop` link (and the tab bar's `Shop`) carries `aria-current="true"`; on `/shop` it carries `aria-current="page"` as today.
- **Text carries everything**: the level track and the bar are `aria-hidden`; `Level <L> of <max>` and the balance line say the same in words. Nothing is told by colour alone.
- **Buttons**: the visible name `Buy level <n>…` is the accessible name's start; `aria-describedby` points at the article's `h2`, the next-level line, the price and, when disabled, the reason. Disabled buttons use `aria-disabled="true"` and stay focusable, so the reason is reachable by keyboard, as the shop's.
- **Confirmation**: as `collection-overview.md` §7 (native `<dialog>`, heading focus, `aria-describedby` on the body, the in-flight rules). `Cancel` and Escape return focus to the button that opened it.
- **After a purchase**: focus goes to the article's status line (`role="status"`, `tabindex="-1"`), which reads `Bought <Upgrade> level <n>. You have <B> Karma.` once. After a stale or at-max answer, focus goes to the notice. The page's other text is not live.
- **`All levels`**: a `<table>` with a `<caption>` (`All levels of <Upgrade>`) and `<th scope="col">`; the current row's level cell reads `<n>, current`.
- **Touch targets** 44 px (48 px for the primary on a phone); focus ring 2 px `volt` with a 2 px offset (`visual-identity.md` §5.4). Contrast: every text pair above is in `visual-identity.md` §5.4's table at 4.5:1 or more; `ion` on `night-800` (the bar, non-text) is 9.22:1.
- **Reduced motion**: nothing on the page moves besides `page-enter` and `pop-in`, which `prefers-reduced-motion` turns off.

### 7.7 Copy

The rules of `collection-overview.md` §8 and `market-and-shop.md` §8 apply, with `visual-identity.md` §11.5's voice: short sentences, verb first, numbers as numbers, no hype. Karma only after a number, plus the exception the market's limits line already has (`spend up to <spend> Karma`). No exclamation marks, no urgency or scarcity, no "unlock", "boost", "power up", "level up", "only", "just", "almost", "so close", "you're nearly there", no "free" outside "free pack(s)", no comment on what a level is worth to the player, no countdowns, streaks or timers (ADR 0004 §6).

Placeholders: `<L>` the current level; `<n>` the next level; `<max>` `maxLevel`; `<Upgrade>` the upgrade's name below; `<cap>`; `<interval>` `intervalSeconds` as `navigation-and-landing.md` §8's `<interval>` (`10 minutes`, `9 minutes`), extended to `<m> minutes <s> seconds` when it is not a whole minute (`9 minutes 50 seconds`); `<window>` the market window in days (`7 days`); `<purchases>`, `<spend>`, `<proceeds>`, `<pair>` the trade effect's figures; `<price>`, `<B>` (the balance), `<B − price>`, all through `Intl.NumberFormat("en-GB")`.

| Element                       | Copy                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title                         | `Upgrades · Anime TCG`                                                                                                                                                                                                 |
| Eyebrow · page heading        | `Permanent levels` · `Upgrades`                                                                                                                                                                                        |
| Section switch                | `Packs` · `Upgrades`                                                                                                                                                                                                   |
| Names (`h2`)                  | `Pack storage` · `Pack refill` · `Trade budget`                                                                                                                                                                        |
| Level line                    | `Level <L> of <max>`                                                                                                                                                                                                   |
| Storage, in force · next      | `Stores up to <cap> timer packs while you're away.` · `Level <n>: stores up to <cap> timer packs.`                                                                                                                     |
| Refill, in force · next       | `A new timer pack every <interval>.` · `Level <n>: a new timer pack every <interval>.`                                                                                                                                 |
| Trade, in force · next        | `Every <window>: buy up to <purchases> cards, spend up to <spend> Karma and receive up to <proceeds> Karma.` · `Level <n>: buy up to <purchases> cards, spend up to <spend> Karma and receive up to <proceeds> Karma.` |
| Trade, per seller             | `What you pay one seller stays at most <pair> Karma, at every level.`                                                                                                                                                  |
| Next label                    | `Next`                                                                                                                                                                                                                 |
| Price                         | `<price> Karma`                                                                                                                                                                                                        |
| Balance line, below the price | `You have <B> of <price> Karma.`                                                                                                                                                                                       |
| Balance line, at or above     | `You have <B> Karma. This level costs <price> Karma.`                                                                                                                                                                  |
| Button                        | `Buy level <n>…`                                                                                                                                                                                                       |
| Reason · stale reason         | `Costs <price> Karma. You have <B>.` · `Buying waits until the game server answers.`                                                                                                                                   |
| At the highest level          | `Highest level.`                                                                                                                                                                                                       |
| Disclosure                    | `All levels` · caption `All levels of <Upgrade>` · columns `Level` · `Effect` · `Price` · level 0's price `—` · marker `current`                                                                                       |
| Confirmation heading          | `Buy <Upgrade> level <n>?`                                                                                                                                                                                             |
| Confirmation body             | `<next-level line> <price> Karma. You have <B> Karma. After this you'll have <B − price> Karma. Levels are permanent: there is no undo and no refund.`                                                                 |
| Confirm button                | `Buy for <price> Karma` / in flight `Buying…` · `Cancel`                                                                                                                                                               |
| Bought (status)               | `Bought <Upgrade> level <n>. You have <B> Karma.`                                                                                                                                                                      |
| Not enough Karma (red)        | `This level costs <price> Karma. You have <B> Karma.`                                                                                                                                                                  |
| Changed (neutral)             | `This upgrade changed since the page loaded. Nothing was bought.`                                                                                                                                                      |
| At max (neutral)              | `This upgrade is already at its highest level. Nothing was bought.`                                                                                                                                                    |
| Loading (visually hidden)     | `Loading upgrades…`                                                                                                                                                                                                    |
| Error                         | `Couldn't load the upgrades.` · `Try again`                                                                                                                                                                            |

Failures not listed here use `collection-overview.md` §8's "Failures" strings. In the confirmation body, `<next-level line>` is the upgrade's next line without its `Level <n>: ` prefix, starting with a capital (`Stores up to 4 timer packs.`).

## 8. Test plan (T3)

**Unit** (`shared/`, `api/src/domain/upgrades/*.test.ts`, `api/src/domain/packs/allowance.test.ts`, `api/src/domain/market/limits.test.ts`):

- §4.8's invariants, and §4.5 recomputed from the tables: every price above 365 × 52.11 × the level's extra packs a day for the casual, active and ceiling player; the printed tables of §4.2 to §4.5 to the digits shown.
- The allowance at every (storage, refill) pair of levels: 1c's existing cases (`collection-packs.md` §9: new account full, `C` openings leave 0, one interval later 1, a week later `C`, a clock set back or forward, a fraction of a second rounds up) run at each pair; `intervalSeconds` and `cap` come from the levels; at level 0 every answer equals today's.
- **Re-anchoring, exactly** (§4.7 rules 1 to 5): full and refill bought → still full; full and storage bought → `C` available, next pack in one interval; not full → the same `available`, next pack at `t + min(d, I')`; a storage purchase while not full leaves the anchor unchanged; an anchor in the future; all arithmetic in safe integers.
- **Re-anchoring, as properties** (10 000 cases from a seeded generator, no new dependency): random levels, anchors from a week before to an hour after `t`, random `t`, and random schedules of openings before and after the purchase. For every case: `available` at `t` is unchanged; the next pack is no later; between `t` and any later `u` the account opens at most `available(t) + floor((u − t) / I') + 1` packs and never holds more than `C'`; under the same schedule it never opens fewer packs by any time than without the purchase.
- **Timing, scripted**: a ceiling script that opens every pack the moment it arrives, for 30 days at each refill level, opens exactly `C + floor(30 × 86 400 / I)` packs; a casual script (three visits eight hours apart) opens exactly `3 × C` a day at each storage level. With refill at level 4, 1c's 30 000-pack run still has no 300 packs without a Mythic, every 10th pack Enchanted unless Radiant, and counters equal to their recomputation. Nothing random changes, so the statistical tests of 1c and `economy.md` §14 stand unchanged.
- The market limits at every trade level: each of the four limits refuses exactly at its bound with the right `retryAfterSeconds`; the buyer's level governs `buyer_purchases` and `buyer_spend`, the seller's `seller_proceeds`; `pair` is 27 500 at every level; `windowLeft` at each level.
- The purchase domain: replay matching, the order of refusals (at max before stale), the price from the table, the debit through `postEntry`.

**Route** (`api/test/upgrades.test.ts`): every row of §6.2, the happy path and each declared error; `GET /api/upgrades` at level 0 publishes every level and price and a balance; a purchase debits exactly the price, writes one `upgrade_purchase` entry and one purchase row, raises the level by one and answers the new `upgrade` and `balance` (balances seeded with `forgeBalance`, `api/test/economy-support.ts`); level 1 to 4 in order on each upgrade; level 5, level 0, `01`, `+1`, `1e0` and an unknown upgrade id → 400; a body with `price`, `amount`, `level`, `cap`, `intervalSeconds` or `limit` → 400; buying level 2 at level 0 → 409 `upgrade_level_stale`; at level 4 → 409 `upgrade_at_max`; a balance one below the price → 409 `insufficient_funds` with the balance, nothing written; the same key replayed → 200 with the same receipt; the same key on another upgrade → 409 `request_id_reused`; a missing Origin → 403; signed out → 401; the 31st POST in a minute → 429. After a storage purchase, `GET /api/packs` shows the new `cap` and the same `available`; after a refill purchase, the new `intervalSeconds` and a `nextPackInSeconds` no longer than before; after a trade purchase, `GET /api/wallet`'s `rules.window` and `GET /api/market/mine`'s `left` show the new limits, and a purchase that the old limit refused succeeds. The demo's facts stay at level 0. A reset keeps every level, sets the allowance full at the account's cap, and its dry run prints the levels. `db-role.test.ts`: the app role can insert and select `upgrade_purchases` and cannot update or delete them; the migration test starts every existing account at level 0. **`audit-ledger` passes on the database every suite leaves behind.**

**Concurrency** (parallel `inject()` calls): two purchases of the same level with different keys → one 201, one 409 `upgrade_level_stale`, one debit; ten parallel purchases of level 1 → exactly one 201; the same key twice in parallel → one 201 and one 200; two upgrades with the balance for one → one 201, one 409 `insufficient_funds`, balance ≥ 0; a storage or refill purchase racing pack openings (50 times, both orders) → every request finishes, no pack is minted (the openings never exceed what §4.7's rules allow over the run), `seq` stays gapless; a trade purchase racing a market purchase by the same buyer, and by the seller of the listing → both finish without deadlock and the limit used is the level read under the lock; a purchase racing a reset → the level survives.

**Adversarial** (`api/test/security/upgrades.security.test.ts`): no request can carry a level, a price, a cap, an interval or a limit (each → 400); no route lowers a level or refunds one (route inventory); the trigger refuses, for the app role and for the owner role, a level that falls, skips a step, or rises without its purchase row; `audit-ledger` reports a level forged past the trigger by the owner role, a purchase row without its entry, and an entry without its row; account B sending A's key gets B's own outcome; hostile numbers (`1e400`, `9007199254740993`, `-0`, `null`, `"1"`) in the path or body → 400; a forged, flipped or expired session → 401; a purchase cannot move Karma to another account (it writes one entry, on the caller); after every test, `audit-ledger`'s invariants hold.

**Web** (`feat/upgrades-ui`): unit tests for every state of §7.3 and every answer of §7.2 step 7; the key rule (kept on no answer and on a 429, discarded otherwise); the before-and-after figures in the confirmation; the interval formatting (`10 minutes`, `9 minutes 50 seconds`); the copy test scans §7.7 for the forbidden words. E2e on the fake API (`web/e2e/support/fake-api.ts`): buy a level and see the article, the header's Karma, the Packs ready chip's cap and `/packs`' countdown follow the server; a stale level and at-max answer refetch and say so; a lost answer retried with the same key shows one purchase; the section switch, the title and focus, Back and Forward, and the guard's return path; 320 px with no horizontal scroll; keyboard only; reduced motion; nothing in Web Storage beyond the allowed scroll key. On the CI stack: `GET /api/upgrades` renders, and a purchase with too little Karma shows `insufficient_funds` with the server's balance.

## 9. Security notes for the officer

- **C1 (all game state server-side)**: three new pieces of state, the levels, live on the account row; the cap, the interval and the market limits are derived from them on the server only. A request carries a `requestId` and, in the path, the upgrade and the level the player saw, which only lets the server refuse a stale purchase; it never sets a value. The web app shows what `GET /api/upgrades` answers and may not import `@anime-tcg/shared/economy` (the existing lint rule).
- **C11 (ledger)**: one new kind, `upgrade_purchase`, one debit per purchase, through `postEntry` under the account lock in the purchase's transaction; `upgrade_purchases` is append-only for the app role; `audit-ledger` checks every entry against its row and every level against its rows (§6.6). The price fits one entry (`≤ MAX_ENTRY_AMOUNT`), so no purchase is split.
- **C20 (pack grants)**: the allowance's `C` and `I` become per account, read under the same lock. The new risk is the purchase moment; §4.7 rewrites the anchor so a purchase neither creates nor removes a pack and never banks time beyond the old cap, proven exactly and as properties (§8). The per-account ceiling rises from 144 to 180 free packs a day; pity and Enchanted still count free packs only. `PackAllowance.available`'s schema maximum becomes `PACK_CAP_MAX`, so the serialiser still bounds it.
- **C24 (market trust boundary)**: the buyer's and the seller's limits now come from their own trade levels, read under both locks; the pair limit, the price bounds, the fee and no-self-trade are unchanged. **Residual at the cap: 78 375 Karma net per 7 days into one account, 1.49 times its own level 0 ceiling, 2.49 times its income in all** (today 52 250, 1.99 times), needing at least three alternates and 960 000 Karma spent on the main's levels (§5.2). Cards the other way: 150 per 7 days. `audit-market` shows the trade levels.
- **Also**: no refund route, so a level cannot become a way to store or move Karma; a level bought on an account that is deleted is gone with it; a reset keeps levels (ADR 0015 §1), so the owner's remedy for an abused account is deletion.

## 10. Build split

Each PR goes through the full gate and is shippable on `main` by itself.

| #   | Branch                | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Tier | Shippable because                                                                       |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------- |
| 1   | `feat/upgrade-levels` | §4.8's constants and invariants; migration 0009 (the three level columns, the trigger, `upgrade_id`, `upgrade_purchases`, the ledger kind) and the rights; the allowance and the market limits read the account's levels (§6.4), `PACK_INTERVAL_MINUTES` → seconds, `BASE_ALLOWANCE_RULES`; `PackAllowance.available` up to `PACK_CAP_MAX`; `rules.window` per account; the re-anchoring function with its exact and property tests; `audit-ledger`'s level checks | T3   | Every account is at level 0 and no route can raise a level, so every answer is as today |
| 2   | `feat/upgrades-api`   | `GET /api/upgrades`, `POST /api/upgrades/{upgradeId}/levels/{level}`, the two error codes, the purchase domain (§6.3), the reset's dry-run line, `audit-market`'s trade levels; route, concurrency and adversarial tests; `docs/05-security.md` rows and the residual (C24); `docs/04-deployment.md` notes                                                                                                                                                         | T3   | Levels can be bought through the API; the web app does not link to them yet             |
| 3   | `feat/upgrades-ui`    | `/shop/upgrades` and the Shop's section switch (§7), the route and return-path entry, the refetches after a purchase, unit and e2e tests; edits `market-and-shop.md` §3.3, §5.2 and `navigation-and-landing.md` §3.1, §3.3 as §11 lists                                                                                                                                                                                                                            | T3   | The page uses only PR 2's routes                                                        |

PR 3 drives a Karma-changing action and its idempotency key, so it is T3 as `feat/economy-ui` was (`economy.md` §3). It follows `visual-identity.md` if PR #64's build PRs have landed and today's tokens otherwise; the copy and the structure are the same either way.

## 11. What this changes in other specs

| Spec and passage                                                                              | Change                                                                    | When        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------- |
| `economy.md` §5, §9, §10                                                                      | Amended in this PR: pointers to §4, §5 here                               | now         |
| `economy.md` §4 (ledger kinds), §7 (`ledger_kind`), §11.2 (`KarmaRules.window`), §13.1, §13.3 | `upgrade_purchase`; the window per account; the audits' additions         | PRs 1 and 2 |
| `collection-packs.md` §4.2 (`PACK_INTERVAL_MINUTES`, `PACK_CAP`), §5.2, §6.2                  | The interval in seconds and per account; `available` up to `PACK_CAP_MAX` | PR 1        |
| `market-and-shop.md` §3.3, §5.2, §8                                                           | The Shop's section switch                                                 | PR 3        |
| `navigation-and-landing.md` §3.1 (route list), §3.3 (return paths)                            | `/shop/upgrades`, an account page in the Shop section                     | PR 3        |
| `visual-identity.md` §10.1 (page header table)                                                | Row `/shop/upgrades`: eyebrow `Permanent levels`, title `Upgrades`        | PR 3        |

## 12. Owner decisions

1. **What storage is priced against.** Storage never raises an account's daily ceiling, but it can give more packs a day to a player who comes back exactly when the bigger stock fills, up to 36 extra a day at level 1 for one who does so around the clock. **A** (recommended): price it against §9.2's three players, as §4.5 does: the worst is the casual player at 1.12 years for level 1. Such a player could get the same packs at level 0 by coming back every 30 minutes, so storage buys convenience, not a higher ceiling, and §5.1's bound is untouched. **B**: price it against every visit pattern; level 1 would have to cost about 685 000 (36 × 19 020), above the first-level grind the owner chose, and the upgrade would effectively not exist.
2. **Which market limits the trade budget raises.** **A** (recommended): purchases, spend and proceeds, by the same factor up to +50 %, pair unchanged (§4.4). A heavy trader is often both buyer and seller, and a budget that lets you buy more but not sell more is half a budget. Residual at the cap: 78 375 net per 7 days, 2.49 times one account's income (§5.2). **B**: the buyer's limits only (purchases and spend); proceeds stay 55 000, so the multi-account residual stays at today's 1.99 times, and a seller gains nothing from the upgrade.
3. **Where the page lives.** **A** (recommended): `/shop/upgrades`, a page in the Shop section with its own address, reached by a `Packs` · `Upgrades` switch on the Shop (§7.1). **B**: a section at the end of `/shop`. **C**: a top-level `/upgrades` page, which has no slot in the phone tab bar.

Settled here and not asked, with the reason where it is made: four levels per upgrade (§4.1: one entry is the limit); 64 000 for level 1 (§4.1, a manager default the owner may revise); a reset keeps the levels (§6.6, ADR 0015 §1); the level is named in the path (§6.2).
