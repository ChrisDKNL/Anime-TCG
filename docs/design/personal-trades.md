# Personal trades and gift limits

Roadmap row T (§17) · [ADR 0016](../adr/0016-personal-trades-and-gift-limits.md) (owner, 2026-10-31) · amends `economy.md` §2, §4, §5, §7, §8.5, §8.9, §9.3, §10, §11, §13 and §16 through the register-sync PR (§17), not directly, because the Karma upgrades spec (ADR 0015) amends the same file at the same time · pages `/trades` and `/trades/new`, beside `/market` · server: new `api/src/domain/trades/`, a change to `api/src/domain/market/service.ts` · security tier **T3** (Karma and cards between accounts; a change to a T3 money path) · written 2026-10-31

> **What this spec decides and what the owner decided.** The owner decided (ADR 0016): personal trades; every player-to-player transfer has a gift value, market purchases included; a fair band of about 25 %; two limits on gifts received, per pair and per receiver; a rolling 30 days; at a limit only unfair trades are blocked; the market's controls stay; personal-trade Karma counts in the 7-day windows; the gift limits are not raised by the Karma upgrades. This spec sets the formula, the numbers, the trade flow, the API, the pages and the tests. Three choices are left to the owner (§16), each with a recommendation the spec is written against.
>
> Written against `main` at a2d1dc5: `economy.md` as shipped with #53 and #60, `shared/src/economy.ts`, `shared/src/api.ts`, `api/src/domain/market/` and `market-and-shop.md`. The visual tokens are those of `visual-identity.md` (PR #64, not merged when this was written); §9 says what to use if it has not landed when the trades web PR is built.

## 1. Goal

Two players who know each other trade directly: one proposes an offer of cards and/or Karma for cards and/or Karma, the other accepts or declines, and the server settles the whole trade in one transaction or not at all. Every transfer between players, market purchases included, gets a **gift**: the part of the difference between the two sides that lies beyond a fair band. Gifts are capped per pair and per receiver over a rolling 30 days, so friends can help each other a little, haggling never touches the limits, and one person with several accounts cannot pour Karma or cards into a main account. The server computes every value, gift, limit and outcome (ADR 0008); the web app shows what the server sends and asks it to act. No real money anywhere, ever.

## 2. Out of scope

- **Counter-offers.** Declining and sending a new offer is the counter-offer. There is no edit route: cancel and send again.
- **Offers to anyone.** An offer goes to one trade partner. Open offers to the whole game are what the market is.
- **A player directory, profiles or search by login.** §3.4 says why. Profiles are roadmap item 4.
- **Push notifications, e-mail, server-sent events or WebSockets.** §3.5.
- **Escrow** of offered cards or Karma. §3.3 compares it and recommends checking at acceptance instead.
- **Gift limits that a Karma upgrade raises** (ADR 0016 decision 6; ADR 0015 raises only the 7-day windows).
- **Masterwork cards and Relics.** Every rule applies to `kind: "card"`, `variant: "standard"`; the item rows carry `variant` so a later spec can add them.
- **Trades inside the mini-games** (items 5, 6), and card antes.
- **Changes to the market's price bounds, fee or window numbers.** They stay as `economy.md` §5 has them, apart from what ADR 0015 changes.

## 3. The rules

### 3.1 What an offer holds

An offer has two sides. **You give** is what the proposer gives; **you get** is what the proposer asks of the recipient. Each side holds:

- **Cards**: entries named by character and rarity, each with a count of copies, as the collection names cards (`collection-packs.md`, `CollectionEntry`): never a card id. At most `TRADE_MAX_CARDS` (10) cards per side, copies counted, so one side is at most 10 entries of one copy or one entry of 10.
- **Karma**: a whole number from 0 to `MAX_ENTRY_AMOUNT`. **Karma goes one way per offer**: at most one side carries Karma, because Karma on both sides only nets out.

Rules on the shape, each a 400 `offer_invalid`: both sides empty; Karma on both sides; one entry twice on one side (the counts are merged by the client, never by the server); the same character at the same rarity on both sides; more than `TRADE_MAX_CARDS` cards on a side. One side may be empty: that is a **pure gift** (§3.6), either given ("you give 500 Karma, you get nothing") or asked for ("you give nothing, you get one Rare").

**The last copy can be traded**, as on the market (`economy.md` §8.3, owner round 1, decision 6). A trade is the player's own choice, as a listing is; the confirmation names a last copy (§3.2 step 8), the server does not hold one back. **Only available copies can be traded**: held, not on the market, not in escrow (`economy.md` §7's _available_). A listed card must be taken off the market first.

### 3.2 Lifecycle

States: `open`, `accepted`, `declined`, `cancelled`, `expired`, `void`. Only `open` moves; every other state is final.

1. **Find a partner** (§3.4): enter their trade code once; from then on both of you are each other's trade partners.
2. **Build** an offer on `/trades/new` (§4.2): pick from your collection, pick from theirs, add Karma on one side. The server quotes the gift and whether the offer fits the limits after each change (§5.6, `POST /api/trades/quote`).
3. **Propose**: `POST /api/trades/offers`. The server checks the shape, that the partner is still a partner, the open-offer caps, that both sides hold what the offer names right now, the proposer's Karma, the 7-day windows and the gift limits, and stores the offer as `open` for `TRADE_OFFER_TTL` (3 days). Nothing moves and nothing is held (§3.3).
4. **View**: both parties see the offer on `/trades`, with a quote computed when they look: the gift, whether it fits now, and if not, why and until when (`blocked`, §5.6).
5. **Accept** (recipient only): `POST /api/trades/offers/{offerId}/accept` with a `requestId`. The server re-checks everything under both account locks and settles: cards move, Karma moves with its fee, the gift is recorded (§5.4). All or nothing.
6. **Decline** (recipient only) or **cancel** (proposer only): the offer closes. Both are idempotent and carry no key.
7. **Expire**: an open offer past `expires_at` is expired, whether or not the sweep has marked it (as listings, `economy.md` §8.5).
8. **Void**: an open offer becomes `void` when the two stop being partners (one removes the other), when either account is deleted, or when the owner resets either collection. The reason is kept (`partner_removed`, `account_deleted`, `owner_reset`).

An offer that can no longer settle because one side no longer holds what it names stays `open`: the quote says so (`blocked: "their_cards"` and so on), accepting it is refused (`offer_changed` or `not_enough_copies`), and the parties decline, cancel or let it expire. A refusal writes nothing (`economy.md` §8.8), so a failed accept never changes an offer.

### 3.3 What the offered items are held as: checked at acceptance (recommended), not escrowed

|                                        | **Check at acceptance** (recommended)                                                                                                         | Escrow (locked like a listing)                                                                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What is locked while open              | Nothing                                                                                                                                       | The proposer's cards and Karma only. The recipient's side cannot be locked: the recipient has agreed to nothing                                                                                  |
| Can an accept still fail on stale data | Yes, either side                                                                                                                              | Yes, the recipient's side. Escrow removes only half of the staleness                                                                                                                             |
| New ledger kinds                       | `trade_debit`, `trade_credit`, `trade_fee`                                                                                                    | The same plus a hold and a release, so a decline, cancel, expiry, deletion and reset each move Karma back                                                                                        |
| Cards                                  | No new card state                                                                                                                             | A second escrow next to `cards.escrow_id`, which the games reserve for antes (`economy.md` §8.11), or sharing it with them                                                                       |
| Side effects of an open offer          | None: the cards can still be listed, recycled or traded elsewhere                                                                             | The cards cannot be listed or recycled; 20 open offers could hold 200 cards and a balance for 3 days; every closing path must release, and the hourly sweep then moves value                     |
| Over-commitment                        | Possible: one card can be in several open offers. The first accepted wins; the others show `blocked: "their_cards"`, and accepting is refused | Impossible                                                                                                                                                                                       |
| Risk                                   | Smaller T3 surface: the only path that moves value is the accept                                                                              | Five more paths that move value (hold, and release on decline, cancel, expiry, void), each a place for a double release or a lost hold; the sweep would take account locks and can then deadlock |

**Recommendation: check at acceptance.** A listing is a standing offer to everyone that a buyer takes at once, so its card must be reserved; an offer is addressed to one player and waits for them, and escrow would still leave the recipient's half unchecked. With the check, every value moves only in the accept transaction, which already locks both accounts, and every closing path (decline, cancel, expire, void) only changes the offer's status.

### 3.4 Finding a partner: trade codes (recommended)

The market never names a player: a `Listing` carries no seller (`market-and-shop.md` §2), and no response names another account. The login is the sign-in name and the key of the sign-in breather (C17), so a list of logins would be half of every account's credentials. Options:

| Option                                                                                                     | Exposes                                                   | Spam control                              |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| A directory of every player's login                                                                        | every login to every player                               | none: anyone can offer anyone             |
| Type the other player's login                                                                              | which logins exist (enumeration)                          | none                                      |
| A share link (`/trades/with/<code>`)                                                                       | the code in browser history, proxy logs and chat previews | as trade codes                            |
| **Trade codes** (recommended): each player may make a code and gives it to whoever they want to trade with | a login only to someone its owner gave the code to        | opt-in; remove a partner; make a new code |

**Recommendation: trade codes, typed in, no link.** The app never reads a query string or a hash (`navigation-and-landing.md` §3.1 rule 2), and a code in a path would sit in the history and the proxy's logs; a code typed into a field does neither.

- **The code.** 12 characters of Crockford base32 (`0-9`, `A-Z` without `I`, `L`, `O`, `U`), 60 bits from `crypto.randomInt`, shown as `XXXX-XXXX-XXXX`. Input ignores case, spaces and hyphens and reads `I` and `L` as `1` and `O` as `0`. Stored normalised and unique on `accounts.trade_code`. An account has **no code until its player makes one**, so nobody can be reached who did not opt in.
- **Redeeming a code** (`POST /api/trades/partners`) makes the two accounts each other's **trade partners**, both directions at once, and shows each the other's login. The player who gave out a code has chosen to be reached by whoever holds it; the one who typed it has chosen the other. A partner is named in requests by a `partnerId`, the id of the caller's own partner row, never an account id (`economy.md` §11.2: no request carries an account id).
- **Making a new code** replaces the old one, which stops working at once. Partners stay.
- **Removing a partner** removes both directions and voids the open offers between the two (`partner_removed`). To trade again, one of them needs the other's code. Removing and making a new code together cut someone off completely.
- **Guessing.** 2^60 codes against `CARD_ACTION_RATE_LIMIT` (30 a minute per address) is not a search anyone finishes; the roster holds at most `ACCOUNT_CAP` (10) codes.

### 3.5 Notifications: a count on navigation, never a poll

Nothing tells a player about anything today, and the API is a guest of nothing here, but the rule "never poll" (`CLAUDE.md`) is the game's.

- `GET /api/wallet` gains `incomingOffers`: the open, unexpired offers addressed to the caller (§5.6). The signed-in layout already reads the wallet at sign-in and when the Shop, Market or Collection page is shown (`market-and-shop.md` §3.1); it also reads it when `/trades` is shown and when the tab becomes visible again (`visibilitychange` to `visible`) if the last read is more than 60 seconds old. There is no timer.
- The count shows on the Market link and in the Market section's `Trades` link (§4.1). It is a count, never a nudge: no colour of its own, no pulse, no title or favicon change, no sound, not a live region (`visual-identity.md` §10.2's rules for the packs count).
- **Not built**: server-sent events or WebSockets. They need a long-lived connection through the proxy and the tunnel and a publish path in the api, for a roster of ten that learns of an offer at its next page change.

### 3.6 Gift value

**Fair value of a side** = Σ over its cards `REFERENCE_VALUE[rarity] × count` + its Karma. The reference values are the published per-tier figures (`economy.md` §5.1); a market purchase has two sides too: the buyer's side is the price, the seller's side is one card.

With `L` the larger side, `S` the smaller side, and `GIFT_BAND_BPS` = 2 500:

```
band = floor(S × GIFT_BAND_BPS / 10 000)        -- 25 % of the smaller side, rounded down
gift = max(0, L − S − band)                      -- the part of the difference beyond the band
```

- **The receiver** is the side with the smaller fair value; **the giver** the side with the larger. A gift of 0 has no direction.
- **Fair** means `L ≤ S + band`: the larger side is at most a quarter more than the smaller. For a market sale of a card worth `R` that is a price from about 0.8 R to 1.25 R (exactly: `fairPriceMin[r]` to `fairPriceMax[r]`, §3.6.2).
- **A pure gift** (`S = 0`) has no band and counts in full: 500 Karma for nothing is a gift of 500.
- **Market purchases** use the price as listed. The fee is the seller's cost and the game's sink, not part of what the buyer gives, so it is not deducted; this counts a sale above the band slightly high, never low.
- **Personal trades** use the Karma as offered, gross of the fee (§3.8).
- **Why 25 % of the smaller side**, not of the larger. Both are "about 25 %" (ADR 0016 decision 2). Of the larger, a pure gift would count only 75 % (its band would be a quarter of itself), and the fair range for a sale would be 0.75 R to 1.33 R, wider on the high side. Of the smaller, a pure gift counts in full and the range is symmetric as a ratio (0.8 = 1 / 1.25).

**Integer maths.** Every value is an integer: reference values, counts and Karma are integers, and `band` rounds down, so the gift rounds up (by less than 1). The largest side is 10 Mythics and `MAX_ENTRY_AMOUNT`, 1 110 000; the largest product, `1 110 000 × 2 500`, is 2 775 000 000, a safe integer in TypeScript and a `bigint` in the database's check (§5.2). The function is pure, in `api/src/domain/trades/gift.ts`, and the market and the trades both call it.

#### 3.6.1 Worked examples

| Trade                                    | You give (fair)  | You get (fair)      | L, S           | band  | gift      | to          |
| ---------------------------------------- | ---------------- | ------------------- | -------------- | ----- | --------- | ----------- |
| A Legendary for four Epics and 200 Karma | 1 000            | 4 × 160 + 200 = 840 | 1 000, 840     | 210   | **0**     | —           |
| A Mythic for a Legendary                 | 11 000           | 1 000               | 11 000, 1 000  | 250   | **9 750** | the partner |
| A Mythic for 13 750 Karma                | 11 000           | 13 750              | 13 750, 11 000 | 2 750 | **0**     | —           |
| A Mythic for 13 751 Karma                | 11 000           | 13 751              | 13 751, 11 000 | 2 750 | **1**     | you         |
| A Mythic for 8 800 Karma                 | 11 000           | 8 800               | 11 000, 8 800  | 2 200 | **0**     | —           |
| A Mythic for 8 799 Karma                 | 11 000           | 8 799               | 11 000, 8 799  | 2 199 | **2**     | the partner |
| 3 000 Karma for nothing (a pure gift)    | 3 000            | 0                   | 3 000, 0       | 0     | **3 000** | the partner |
| Nothing for two Rares (a gift asked for) | 0                | 70                  | 70, 0          | 0     | **70**    | you         |
| Five Commons and an Uncommon for a Rare  | 5 × 10 + 23 = 73 | 35                  | 73, 35         | 8     | **30**    | the partner |

#### 3.6.2 Market purchases, per tier

A sale's gift goes to the **buyer** when the price is below the fair range and to the **seller** when it is above. The fair range is published per tier (`KarmaRules.fairPriceMin`, `fairPriceMax`, §5.6) so the UI can say where a gift starts without computing one:

- `fairPriceMax[r]` = `R + floor(R × GIFT_BAND_BPS / 10 000)`, the highest price with no gift;
- `fairPriceMin[r]` = the smallest `P` with `P + floor(P × GIFT_BAND_BPS / 10 000) ≥ R`, the lowest.

| Tier      | Reference R | Market floor (0.5 R) | Gift at the floor, to the buyer    | Fair from | Fair to | Market cap (2.5 R) | Gift at the cap, to the seller       |
| --------- | ----------- | -------------------- | ---------------------------------- | --------- | ------- | ------------------ | ------------------------------------ |
| Common    | 10          | 5                    | 10 − 5 − 1 = **4**                 | 8         | 12      | 25                 | 25 − 10 − 2 = **13**                 |
| Uncommon  | 23          | 12                   | 23 − 12 − 3 = **8**                | 19        | 28      | 57                 | 57 − 23 − 5 = **29**                 |
| Rare      | 35          | 18                   | 35 − 18 − 4 = **13**               | 28        | 43      | 87                 | 87 − 35 − 8 = **44**                 |
| Epic      | 160         | 80                   | 160 − 80 − 20 = **60**             | 128       | 200     | 400                | 400 − 160 − 40 = **200**             |
| Legendary | 1 000       | 500                  | 1 000 − 500 − 125 = **375**        | 800       | 1 250   | 2 500              | 2 500 − 1 000 − 250 = **1 250**      |
| Mythic    | 11 000      | 5 500                | 11 000 − 5 500 − 1 375 = **4 125** | 8 800     | 13 750  | 27 500             | 27 500 − 11 000 − 2 750 = **13 750** |

At the floor the band is a quarter of the price (the smaller side); at the cap it is a quarter of the reference value. A Mythic sold at the cap is a gift of 13 750 to its seller, exactly the pair limit (§3.7), so it sells whenever its buyer has given that seller no gift in 30 days and the seller has 13 750 of receiver room left. A Mythic at the floor is a gift of 4 125 to its buyer: one buyer can take three such Mythics from one seller in 30 days and six from all sellers together.

### 3.7 The limits and their numbers

Both limits count gifts **received**, over a rolling `GIFT_WINDOW` of 30 days, market and trades together. A gift made at `at` counts while `now < at + 30 days` (the market windows' rule, `api/src/domain/market/limits.ts`).

| Name                  | Value      | Counts                                                 | Why this number                                                                                                                                                                                      |
| --------------------- | ---------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GIFT_LIMIT_PAIR`     | **13 750** | gifts from one account to one other account            | the gift of one Mythic sold at the cap (§3.6.2): the owner's rule for the market limits, "one Mythic at the upper bound fits" (round 3, decision 8), applied to gifts, so the price bounds stay live |
| `GIFT_LIMIT_RECEIVER` | **27 500** | gifts to one account from every other account together | twice the pair limit, so a player can take a generous trade from two friends in a month; and equal to one Mythic's market cap, the largest sum one sale can move                                     |

**Against income** (`economy.md` §9.2, §9.2.1). 27 500 per 30 days is about 920 Karma a day: about 4 times a casual player's long-run income (220 a day, 6 600 a month), a fifth of an active player's (4 530 a day, about 136 000 a month), and an eighth of the ceiling (7 505 a day, about 225 000 a month). A friend can make a new player's month with gifts; nobody can double an active account with them.

**Room** for a limit is the limit less the gifts it counts in the window. A transfer whose gift would take the pair or the receiver past its limit is refused with `gift_limit` (§5.6), naming the first one hit (pair, then receiver) and when enough of that limit's oldest gifts leave the window for this gift to fit, computed as the market's `secondsUntilRoom` over the 30-day window. A gift larger than the limit itself can never fit: `retryAfterSeconds` is then absent. **A transfer with a gift of 0 is never refused by a gift limit**, whatever the room (ADR 0016 decision 5).

#### 3.7.1 The multi-account funnel at these numbers

`economy.md` §10's attack: one person opens packs on alternate accounts and moves what they earn into a main account. Two measures, today against with gift limits. The 30-day figures take the 7-day windows `30 / 7` times, the steady rate; the market windows are `MARKET_WINDOW_SPEND` = `MARKET_WINDOW_PROCEEDS` = 55 000.

| Measure                                                                                              | Today (`economy.md` §10)                                                                                              | With gift limits                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §10's own measure: **Karma** drawn into the main by selling cheap cards at the cap to the alternates | 52 250 net per **7** days (about 7 460 a day, 1.99 × the main's own ceiling)                                          | **52 250 per 30 days** (about 1 740 a day, +23 % of the ceiling). Each sale at the cap carries a gift of at least `(P − fee) / 1.9` (Epic and up; Commons 1.77), so the receiver limit allows 1.9 × 27 500 of such Karma |
| **Net fair value** (Karma, plus cards at reference) the main draws, any strategy, per 30 days        | about **365 400** (85 250 per 7 days: sales at the cap gain 0.55 × proceeds, purchases at the floor gain 1.0 × spend) | about **121 800**: gifts ≤ 27 500; sales inside the band gain at most 0.15 × proceeds (35 400); purchases inside the band at most 0.25 × spend (58 900)                                                                  |
| Through one alternate account alone, as gifts                                                        | no gift measure; the pair window lets 27 500 Karma per 7 days through                                                 | ≤ 13 750 per 30 days                                                                                                                                                                                                     |
| Cards moved by repeated card-for-card trades inside the band                                         | not possible (no personal trades)                                                                                     | **not bounded by the gift limits**: owner decision 3 (§16)                                                                                                                                                               |

How the band term is bounded. In a transfer where the main receives the larger side, its gain is `gift + band` at most, and the band is a quarter of what the main gives. When the main gives cards for Karma, what it gives is at least 0.8 of the Karma it receives, and the fee takes 0.05: the gain is at most 0.15 of the receipts. When it gives Karma for cards, its gain is at most 0.25 of the spend. Receipts and spend are the 7-day windows', which personal-trade Karma now counts in (§3.8). So the band term is bounded by the windows, and the gift term by the receiver limit, however many accounts take part. No Karma upgrade raises the windows or the gift limits (ADR 0015 §5: the market upgrade is listing slots only), so this bound holds for every account.

**What the band cannot bound: card-for-card cycling.** Two accounts can trade cards back and forth, each trade inside the band and with no Karma: the main gives four Mythics and gets five; next it gives three Mythics and three Legendaries and gets four Mythics; and so on. Each trade moves a fifth of the larger side to the main with a gift of 0, and in about twenty trades the alternate's cards are the main's. No window counts it, because no Karma moves. What bounds it is what the alternates own, which their own packs bound (`economy.md` §9.2: at most 144 packs a day each), and the per-account offer limits (§5.8) only slow it. Cards turn into Karma only by recycling (a quarter of the reference value) or by selling them, and both are bounded as above, so the **Karma** bound holds; the **collection** is what can be pooled. `audit-market` reports it (§5.7, "one-way trading inside the band"). The owner chooses whether that is enough (§16, decision 3).

### 3.8 The fee and the 7-day windows on trades

- **The fee** (owner decision 2, §16, recommended A): Karma in a personal trade pays the market's fee, `max(MARKET_FEE_MIN, ceil(K × MARKET_FEE_BPS / 10 000))`, 5 % rounded up and at least 1, **paid by whoever receives the Karma** and destroyed, as a seller pays it on a sale. A trade without Karma pays nothing. This keeps `economy.md` §10's rule "every Karma moved between accounts loses a twentieth" true, and makes a round trip through personal trades cost what it costs through the market, so personal trades do not become the cheaper channel. The gift counts the Karma gross (§3.6).
- **The windows** (ADR 0016 decision 6). Karma `K` paid in a trade counts in the payer's `buyer_spend` (`MARKET_WINDOW_SPEND`), the receiver's gross `seller_proceeds` (`MARKET_WINDOW_PROCEEDS`) and the payer→receiver `pair` (`MARKET_WINDOW_PAIR`), exactly as a purchase at price `K` would. A trade is not a purchase: `buyer_purchases` (the count) does not count trades. No Karma upgrade raises these windows or the gift limits (ADR 0015 §5).
- The order of the limits at acceptance is the market's (`economy.md` §8.5 step 6) and then the gift limits: `buyer_spend`, `seller_proceeds`, `pair`, then `gift_pair`, `gift_receiver`.

## 4. Flow (web)

### 4.1 Pages and where they live

The Market is the place for player trades (its eyebrow is already `Player trades`, `visual-identity.md` §10.1). Trades live beside it, not in a sixth header link or tab:

| Path          | Page                    | `h1`            | Eyebrow         | Reached from                                                                  |
| ------------- | ----------------------- | --------------- | --------------- | ----------------------------------------------------------------------------- |
| `/trades`     | Offers, partners, gifts | `Trades`        | `Player trades` | the Market section's `Trades` link; the header's Market link is the section's |
| `/trades/new` | The offer builder       | `Make an offer` | `Player trades` | `Make an offer` on `/trades`, or on a partner's row                           |

1. **The Market section's links.** `/market` and `/trades` both show, under the page header, a `<nav aria-label="Market sections">` with two links: `Listings` (`/market`) and `Trades` (`/trades`, `Trades (<N>)` while `incomingOffers` is at least 1). The current page's link carries `aria-current="page"`. `/market`'s own views, `Browse` and `My listings`, are unchanged under it.
2. **The header and the phone bar.** The header's `Market` link (and the phone bar's `Market` item) stays the one item for the section: on `/market` it carries `aria-current="page"`; on `/trades` and `/trades/new` it shows the current marker and carries `aria-current="true"` (the current item of a set, not the page). While `incomingOffers` is at least 1 it shows the count as the Packs centre item does (`visual-identity.md` §10.3): an 18 px `night-950` chip with the number in `num` `ink-100`, no colour, no pulse; its accessible name becomes `Market, <N> trade offers`.
3. **Routes.** `/trades` joins the account pages of `web/src/lib/routes.ts` (title `Trades · Anime TCG`, guard line `Log in to see your trades.`). `/trades/new` is a section page like `/shop/open` (`section: "/trades"`): never a return path, and its guard returns to `/trades`. A load or reload of `/trades/new` shows step 1 (choose a partner), since the draft lives only in the signed-in layout's state (`navigation-and-landing.md` §3.10).
4. **Titles and focus** as every account page (`navigation-and-landing.md` §3.6): `Trades · Anime TCG`, `Make an offer · Anime TCG`; focus on the `h1` after a navigation. The offer details are a dialog on `/trades`, not a page: dialogs are not history entries (`market-and-shop.md` §3.2 rule 6).

### 4.2 `/trades`

Showing the page reads `GET /api/trades` and the wallet; held data shows at once and refetches silently (`collection-overview.md` §3.1's 300 ms rule and skeleton). Sections, top to bottom, each an `h2`:

1. **Offers for you** (`incoming`): one row per open offer: the partner's login; the summary `You give <cards> · You get <cards> and <K> Karma` (only the parts that are there; `<cards>` is `1 card` / `<N> cards`); the gift line (§4.4); `Open until <D Mon>, <HH:MM>`; the blocked line when the quote says the offer cannot settle now; `View`. Newest first. Empty: `No offers for you.`
2. **Offers you sent** (`sent`): the same rows. Empty: `No offers sent.`
3. **Trade partners**:
   - **Your trade code**: no code yet: the line `Give your code to a player you want to trade with. Anyone who has it can send you offers.` and `Make a trade code`. With a code: the code in `num` (`XXXX-XXXX-XXXX`), `Copy code` (`navigator.clipboard.writeText`; status `Code copied.`; if the browser refuses, `Couldn't copy. Select the code and copy it.`) and `New code…`, which confirms (`Make a new code? Your current code stops working. Your partners stay.`, buttons `Make a new code` / `Cancel`).
   - **Add a partner**: the field `Their trade code` and `Add partner`.
   - **Partners**: one row per partner: the login, `Partner since <D Mon YYYY>`, `Make an offer` (pushes `/trades/new` with this partner chosen) and `Remove…`, which confirms (`Remove <login> as a trade partner? Open offers between you are withdrawn. To trade again, one of you needs the other's code.`, buttons `Remove` / `Cancel`). Empty: `No trade partners yet.`
4. **Gifts, last 30 days**: `You received <r> Karma of <receiverLimit> Karma in gifts.` (all sources, the market included); then per partner with any gift either way: `<login>: gave you <a> of <pairLimit> Karma · you gave <b> of <pairLimit> Karma`. Gifts with market counterparts are in the total and in no row, because the market names nobody. A line under it: `A trade or a market sale counts as a gift when one side is more than a quarter larger than the other, at the reference prices. Gifts are limited. A trade without a gift never counts toward the limit.`
5. **Closed in the last 30 days**: one row per offer: partner, summary, status (`Accepted`, `Declined`, `Cancelled`, `Expired`, `Withdrawn`), the gift it carried when accepted, and `<D Mon YYYY>` from `closedAt`. Empty: `Nothing in the last 30 days.`

**Offer dialog** (`View`): the card dialog's shell (`collection-overview.md` §3.4). Heading `Offer from <login>` or `Your offer to <login>`; two lists, `You give` and `You get`, each row a 48 × 67 thumbnail (`card-and-rarity.md` §3.2), the name, the tier word with its stars, `×<N>`, and a `Karma` row when the side has Karma; the gift line; `Open until <D Mon>, <HH:MM>`; the blocked line; then for an incoming offer `Accept…` (primary) and `Decline`, for a sent one `Cancel offer`. Opening the dialog reads `GET /api/trades/offers/{offerId}` for a fresh quote; while it loads, the held quote shows and `Accept…` is disabled with `Checking the offer…`.

**Accept confirmation** (replaces the dialog body): heading `Accept this trade?`; body: `You give` and `You get` as one line each; the Karma line with its fee from the quote (`<K> Karma goes from you to <login>.` or `You get <K> Karma, less a fee of <fee> Karma.`); the last-copy sentence, at most one, from the held collection (the `collection-overview.md` §3.5 step 6 rules, for the first such card: `This is your only <name>. Once traded, it stops counting toward completion.` or `This trades every copy of <name> at <Rarity>.`); the gift sentence; `There is no undo.` Buttons `Accept trade` (in flight `Accepting…`) and `Cancel`.

Answers to the accept:

- **201, or 200 on a replay**: the body becomes the result: heading `Trade done`; `You got` with each card at reveal size in the collection tile's grid, `New` where `isNew`; the Karma line (`<K> Karma, less a <fee> Karma fee.`); `You have <B> Karma.`; `Close`. The header takes `receipt.balance`; the collection is marked stale; `/trades` refetches.
- **`gift_limit`**, **`market_limit`**, **`insufficient_funds`**, **`balance_limit`**: the confirmation stays with the red line of §11, and the confirm button is disabled (until the time named, for the limits; held as `market-and-shop.md` §3.8's market limit is held, per offer).
- **`not_enough_copies`** (your own side changed): `Your collection changed, so this trade can't go through as it is.`; the collection and the offer are read again; back to the details.
- **`offer_changed`** (the proposer's side changed): `<login> no longer has everything in this offer.`; back to the details, with `Decline` the one action.
- **`offer_unavailable`** or **`offer_not_found`**: `This offer is no longer open.` and `Close`; `/trades` refetches.
- **Rate limited, any other answer, no answer, `unauthenticated`**: as `collection-overview.md` §3.5 step 9; `Try again` resends the same `requestId` (the key rule, `market-and-shop.md` §3.8 "Keys": kept on no answer and on a 429, discarded on every other answer, on `Cancel`, on close and on unmount).

**Decline** and **Cancel offer** need no confirmation: nothing has moved, and nothing moves. The button reads `Declining…` / `Cancelling…`. 200: the dialog closes, the status line reads `Offer declined.` / `Offer cancelled.`, `/trades` refetches. Already closed: `That offer had already closed.` No answer: `Try again` resends (both are idempotent). Other failures: the server failure banner.

**Partner actions.** `Add partner` sends `POST /api/trades/partners` with the code as typed: 201: `<login> is now a trade partner.`, the field clears; 200: `<login> is already a trade partner.`; `trade_code_invalid`: the field error `No player has that code.`; `own_trade_code`: `That's your own code.`; 429: the countdown. `Make a trade code` and `Make a new code` send `POST /api/trades/code`; the new code replaces the shown one, status `Your trade code is <code>.`. `Remove` sends `POST /api/trades/partners/{partnerId}/remove`: status `<login> is no longer a trade partner.`

### 4.3 `/trades/new`: the offer builder

**Step 1, choose a partner.** The partner list as radio rows (login, `Partner since <D Mon YYYY>`), and the add-a-partner field under it. With no partners, only the field and the line `Add a partner with their trade code to make an offer.` Choosing one goes to step 2 (from `Make an offer` on a row, step 1 is skipped). A reload, a load or an address typed lands here.

**Step 2, build.** Top to bottom: `Offer to <login>` (`h2`) with `Change` (back to step 1, the draft dropped after `Drop this offer?` / `Drop it` / `Keep it` when it has anything in it); then two panels:

- **You give**: the chosen cards as rows (thumbnail, name, tier word and stars, a count stepper `−` `<n>` `+` from 1 to the entry's `available`, `Remove`), `Add cards` and the Karma field `Karma you add`. `Add cards` opens the **card picker** on your collection (`GET /api/collection`, entries with `available` ≥ 1).
- **You get**: the same, from the partner's tradeable cards (`GET /api/trades/partners/{partnerId}/cards`), and the Karma field `Karma you ask for`.
- **Karma goes one way**: while one Karma field holds a number, the other is disabled with the reason `Karma goes one way in an offer.`
- **Card count**: while a side holds `TRADE_MAX_CARDS` cards, its `+` buttons and `Add cards` are disabled with `At most <maxCards> cards a side.` (`rules.maxCards`).

**The card picker** is a dialog: the collection grid (`collection-overview.md` §5.1) with a search field and a rarity select (filtering in the browser, as the collection does), each tile showing `×<available>` instead of the copies, the tiles already chosen marked `Chosen`. Activating a tile adds one copy and keeps the picker open; `Done` closes it. Your picker reads your held collection answer; the partner's reads their tradeable cards once per partner and holds them until the builder is left. Empty: `No cards to trade.` (yours) / `<login> has no cards to trade.`

**The gift panel** (`<section aria-labelledby>`, `h2` `Gift`) under the panels. 300 ms after the draft last changed, the builder sends `POST /api/trades/quote` with the draft; an answer for an older draft is discarded (aborted). It shows exactly what the answer says (§4.4): the gift line, the room line, the blocked line; nothing in it is computed in the browser. A disclosure `How the gift is worked out` shows `At reference prices you give <youGive> Karma and get <youGet> Karma. Up to a quarter more on one side, <band> Karma here, is no gift.` from the quote's `youGive`, `youGet` and `band`.

**Send.** `Send offer…` (primary) is enabled when the draft is valid in shape and the newest quote answered with `blocked` null; otherwise it is disabled with the reason: an empty draft `Add cards or Karma to either side.`; a quote in flight or failed `Sending waits until the game server answers.`; a blocked quote, the blocked line's sentence. It opens the **send confirmation**: heading `Send this offer to <login>?`; `You give …` / `You get …`; the last-copy sentence for your side; the gift sentence; `Nothing leaves your collection until <login> accepts. The offer stays open for <days>, and you can cancel it until then.` (`<days>` from `rules.offerTtlSeconds`); buttons `Send offer` (`Sending…`) and `Cancel`.

Answers to the send:

- **201, or 200 on a replay**: the app pushes `/trades`; the status line reads `Offer sent to <login>.`; the draft is dropped.
- **`not_enough_copies`**: `Something changed in your cards or theirs. The lists are up to date now.`; both lists are read again, chosen entries clamp to what is available (and go when nothing is), back to step 2.
- **`gift_limit`**, **`market_limit`**, **`insufficient_funds`**, **`offer_limit`**: the confirmation stays with the red line of §11; the confirm button is disabled.
- **`partner_not_found`**: back to step 1 with the notice `<login> is no longer a trade partner.`; the partners are read again.
- **`offer_invalid`**, **`request_id_reused`**: never expected from this UI; shown as the server failure.
- **Rate limited, any other answer, no answer, `unauthenticated`**: as the accept, under the key rule.

### 4.4 The gift line, the room line, the blocked line

Always the server's numbers (`TradeQuote`, `Offer.quote`, `Listing.gift`), never the browser's:

| Quote says                               | Gift line                                             |
| ---------------------------------------- | ----------------------------------------------------- |
| `gift` null                              | `No gift. This trade is within a quarter either way.` |
| `gift.to` = `partner` (the viewer gives) | `Counts as a gift of <g> Karma from you to <login>.`  |
| `gift.to` = `you`                        | `Counts as a gift of <g> Karma from <login> to you.`  |

**Room line**, only when the quote has a gift: gift to the partner: `You can give <login> <toPartner> more Karma in gifts in the next 30 days.`; gift to you: `You can receive <received> more Karma in gifts in the next 30 days, up to <fromPartner> Karma of it from <login>.` (`room`). The partner's own receiver room is never shown (§13.3).

**Blocked line**, when `blocked` is not null, in `danger`, with the date from now + `retryAfterSeconds` where there is one:

| `blocked`                                      | Line                                                                                                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `your_cards`                                   | `You no longer have every card on your side.`                                                                                                                                                                          |
| `their_cards`                                  | `<login> no longer has every card on their side.`                                                                                                                                                                      |
| `your_karma`                                   | `You have <B> Karma, less than this offer needs.` (B from the quote's `balance`)                                                                                                                                       |
| `their_karma`                                  | `<login> doesn't have <K> Karma right now.`                                                                                                                                                                            |
| `gift_pair`, you give                          | `You've given <login> as much in gifts as the game allows for 30 days. This gift fits on <D Mon> at <HH:MM>.`                                                                                                          |
| `gift_pair`, you receive                       | `<login> has given you as much in gifts as the game allows for 30 days. This gift fits on <D Mon> at <HH:MM>.`                                                                                                         |
| `gift_receiver`, you receive                   | `You've received as much in gifts as the game allows for 30 days. This gift fits on <D Mon> at <HH:MM>.`                                                                                                               |
| `gift_receiver`, you give                      | `<login> has received as much in gifts as the game allows for now. This gift fits on <D Mon> at <HH:MM>.`                                                                                                              |
| a gift limit, no `retryAfterSeconds`           | `This gift of <g> Karma is more than the <pairLimit> Karma allowed between two players in 30 days.` (pair) / `This gift of <g> Karma is more than the <receiverLimit> Karma anyone can receive in 30 days.` (receiver) |
| `buyer_spend`, the payer is you                | `Your trade and market limit for the last <window> is used up. It frees up on <D Mon> at <HH:MM>.`                                                                                                                     |
| `buyer_spend`, the payer is the partner        | `<login> can't send more in trades and on the market right now. Try again on <D Mon> at <HH:MM>.`                                                                                                                      |
| `seller_proceeds`, the receiver is you         | `You can't take more from trades and sales right now. Try again on <D Mon> at <HH:MM>.`                                                                                                                                |
| `seller_proceeds`, the receiver is the partner | `<login> can't take more from trades and sales right now. Try again on <D Mon> at <HH:MM>.`                                                                                                                            |
| `pair`, the payer is you                       | `You've sent <login> as much as the game allows for now. Try again on <D Mon> at <HH:MM>.`                                                                                                                             |
| `pair`, the payer is the partner               | `<login> has sent you as much as the game allows for now. Try again on <D Mon> at <HH:MM>.`                                                                                                                            |
| `balance_limit`                                | `That would take one of you past the most Karma anyone can hold.`                                                                                                                                                      |

After every gift-limit line: `Trades without a gift still go through.`

## 5. Server

### 5.1 Parameters (`shared/src/economy.ts`)

| Name                         | Value        | Why                                                                                                   |
| ---------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `GIFT_BAND_BPS`              | 2 500        | the fair band: 25 % of the smaller side (ADR 0016 decision 2, §3.6)                                   |
| `GIFT_WINDOW_SECONDS`        | 30 days      | rolling (ADR 0016 decision 4)                                                                         |
| `GIFT_LIMIT_PAIR`            | 13 750       | the gift of one Mythic at the market cap (§3.7)                                                       |
| `GIFT_LIMIT_RECEIVER`        | 27 500       | twice the pair limit; one Mythic's market cap (§3.7)                                                  |
| `TRADE_MAX_CARDS`            | 10           | cards per side of an offer, copies counted                                                            |
| `TRADE_OFFER_TTL_SECONDS`    | 3 days       | an offer is addressed to one player; three days keeps the list current, and sending again is one step |
| `TRADE_MAX_OPEN_OFFERS`      | 20           | open offers one account has sent                                                                      |
| `TRADE_MAX_OPEN_PER_PARTNER` | 3            | open offers one account has sent to one partner                                                       |
| `TRADE_OFFERS_PER_DAY`       | 50           | offers one account sends per rolling 24 hours, so a send-and-cancel loop cannot flood a partner       |
| `TRADE_CODE_LENGTH`          | 12           | Crockford base32 characters, 60 bits                                                                  |
| `TRADE_QUOTE_RATE_LIMIT`     | 120 a minute | per client address on `POST /api/trades/quote`; the builder quotes 300 ms after each change           |

The fee on trade Karma reuses `MARKET_FEE_BPS` and `MARKET_FEE_MIN` (§3.8). Derived, published in `KarmaRules`, never stored: `fairPriceMin` and `fairPriceMax` per tier (§3.6.2).

**Invariants**, unit tests over the file: every value a positive safe integer; `gift(MARKET_PRICE_MAX.mythic, REFERENCE_VALUE.mythic) ≤ GIFT_LIMIT_PAIR ≤ GIFT_LIMIT_RECEIVER` (a Mythic at the cap fits an empty pair window); `GIFT_WINDOW_SECONDS ≥ MARKET_WINDOW_SECONDS`; `MARKET_PRICE_MIN[r] ≤ fairPriceMin[r] ≤ REFERENCE_VALUE[r] ≤ fairPriceMax[r] ≤ MARKET_PRICE_MAX[r]` for every tier; `TRADE_MAX_CARDS × REFERENCE_VALUE.mythic + MAX_ENTRY_AMOUNT` times `GIFT_BAND_BPS` is a safe integer and the side total fits a Postgres `integer`; `TRADE_MAX_OPEN_PER_PARTNER ≤ TRADE_MAX_OPEN_OFFERS ≤ TRADE_OFFERS_PER_DAY`. A test recomputes §3.6.2's table and §3.7.1's figures from the file.

### 5.2 Data model and migrations

Two migrations, the next free numbers after whatever is on `main` (ADR 0015's may land first): **PR T.1** (`<n>_gift_limits.sql`) and **PR T.2** (`<n+1>_personal_trades.sql`).

```
-- PR T.1
transfer_gifts                                      -- one row per settled transfer: the gift record; never updated or deleted
  id                 uuid pk default gen_random_uuid()
  kind               transfer_kind not null         -- enum: market, trade
  purchase_id        uuid null unique references market_purchases(id) on delete set null
  offer_id           uuid null unique               -- PR T.2 adds its foreign key to trade_offers(id) on delete set null
  from_id            uuid null references accounts(id) on delete set null   -- the larger side's account
  to_id              uuid null references accounts(id) on delete set null   -- the smaller side's account: the receiver
  from_value         integer not null               -- fair value of the larger side; check (from_value >= to_value and to_value >= 0)
  to_value           integer not null
  band_bps           integer not null               -- GIFT_BAND_BPS at settlement
  band               integer not null               -- check (band = (to_value::bigint * band_bps / 10000))
  gift               integer not null               -- check (gift = greatest(0, from_value - to_value - band))
  backfilled         boolean not null default false -- true only for the purchases the migration backfills
  created_at         timestamptz not null           -- the purchase's or the acceptance's time
  check (num_nonnulls(purchase_id, offer_id) <= 1)  -- both null only once a referenced row is gone
  check (kind = 'trade' or offer_id is null)        -- a market row never names an offer
  check (kind = 'market' or purchase_id is null)    -- a trade row never names a purchase
  check (not backfilled or kind = 'market')
  index (to_id, created_at) where gift > 0          -- the receiver limit
  index (from_id, to_id, created_at) where gift > 0 -- the pair limit
```

Rules:

1. **Direction.** `from` is the side whose fair value is larger: for a purchase the buyer when the price is above the reference value, else the seller; for a trade the proposer or the recipient. On a tie (`from_value = to_value`) `from` is the buyer, or the proposer. A row with `gift = 0` still has a direction, so the audit can recompute it. The two `kind` checks hold after either reference is set to null by a deletion.
2. **Append-only.** The migration revokes `UPDATE` and `DELETE` on `transfer_gifts` from `anime_app`. Referential `set null` runs with the owner's rights, as for `market_purchases` (`economy.md` §7).
3. **Backfill.** The migration inserts one row per existing `market_purchases` row, with the formula at the migration's constants (`backfilled = true`, `created_at` = the purchase's), so `audit-ledger` can require exactly one gift row per purchase. Backfilled gifts count against the limits for the rest of their 30 days, as real gifts do; no backfilled sum is checked against a limit (§5.7).
4. **Deleting an account** nulls `from_id` or `to_id`; the other party's gifts keep counting against their limits. A giver deleting their account therefore never frees the receiver's room.

```
-- PR T.2
accounts gains
  trade_code         text null unique               -- normalised Crockford base32, TRADE_CODE_LENGTH; null until the player makes one
                                                    -- check (trade_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$')

trade_partners                                      -- both directions are written together and removed together
  id                 uuid pk default gen_random_uuid()   -- the partnerId the account's requests name
  account_id         uuid not null references accounts(id) on delete cascade
  partner_id         uuid not null references accounts(id) on delete cascade
  created_at         timestamptz not null
  unique (account_id, partner_id); check (account_id <> partner_id)

trade_offers
  id                 uuid pk default gen_random_uuid()
  proposer_id        uuid null references accounts(id) on delete set null
  recipient_id       uuid null references accounts(id) on delete set null
  request_id         uuid not null                  -- the proposer's key
  request_hash       text not null                  -- SHA-256 of the canonical body (§5.3)
  give_karma         integer not null default 0     -- proposer → recipient; check (give_karma between 0 and MAX_ENTRY_AMOUNT)
  take_karma         integer not null default 0     -- recipient → proposer; same check
  check (give_karma = 0 or take_karma = 0)
  status             offer_status not null          -- enum: open, accepted, declined, cancelled, expired, void
  void_reason        offer_void_reason null         -- enum: partner_removed, account_deleted, owner_reset; set exactly when status = 'void'
  created_at         timestamptz not null
  expires_at         timestamptz not null           -- created_at + TRADE_OFFER_TTL
  closed_at          timestamptz null               -- check ((status = 'open') = (closed_at is null))
  accept_request_id  uuid null                      -- the recipient's key; set exactly when status = 'accepted'
  fee                integer null                   -- the fee on the trade's Karma; set when accepted with Karma
  debit_entry_id     uuid null unique references ledger_entries(id) on delete set null   -- the payer's trade_debit
  credit_entry_id    uuid null unique references ledger_entries(id) on delete set null   -- the receiver's trade_credit
  fee_entry_id       uuid null unique references ledger_entries(id) on delete set null   -- the receiver's trade_fee
  unique (proposer_id, request_id); unique (recipient_id, accept_request_id)
  check (proposer_id is null or recipient_id is null or proposer_id <> recipient_id)
  index (recipient_id, status, expires_at); index (proposer_id, status, created_at); index (expires_at) where status = 'open'

trade_offer_items
  offer_id           uuid not null references trade_offers(id)
  side               trade_side not null            -- enum: give (the proposer's cards), take (the recipient's)
  character_id       integer not null references characters(id)
  rarity             rarity not null
  variant            card_variant not null default 'standard'
  count              integer not null               -- check (count between 1 and TRADE_MAX_CARDS)
  primary key (offer_id, side, character_id, rarity, variant)

cards gains
  trade_offer_id     uuid null references trade_offers(id)                      -- origin: delivered by this trade
  removed_by_trade   uuid null references trade_offers(id)                      -- removal: given away in this trade
  -- cards_origin_check becomes num_nonnulls(opening_id, purchase_id, trade_offer_id) = 1
  -- cards_removed_once_check becomes num_nonnulls(removed_by_recycle, removed_by_purchase, removed_by_trade) <= 1
  -- cards_removed_check gains removed_by_trade
  index (trade_offer_id) where trade_offer_id is not null; index (removed_by_trade) where removed_by_trade is not null

ledger_kind gains trade_debit (debit), trade_credit (credit), trade_fee (debit)
transfer_gifts.offer_id gains its foreign key to trade_offers(id) on delete set null
```

Rules:

1. **Rights**, pinned in `db-role.test.ts` as before: `trade_offers` `SELECT`, `INSERT`, and `UPDATE` of `status`, `void_reason`, `closed_at`, `accept_request_id`, `fee` and the three entry ids only; `trade_offer_items` `SELECT` and `INSERT`; `trade_partners` `SELECT`, `INSERT`, `DELETE`; `accounts` `UPDATE` of `trade_code`; `cards` `UPDATE` of `removed_by_trade`. Offers and items are never deleted, so the cards that point at them stay valid.
2. **`cards_removed_stays`** gains `removed_by_trade`: once a card is removed it never changes (offers are never deleted, so no `set null` exception is needed).
3. **The reset** (`economy.md` §8.10) gains, after cancelling listings: every open offer the account sent or received becomes `void` (`owner_reset`). Its cards are deleted as today; the SECURITY DEFINER function that deletes bought cards (`delete_bought_cards`, migration 0007) is widened to cards with a `purchase_id` **or** a `trade_offer_id`, under the same refusal while an active listing remains.
4. **Deleting an account** nulls `proposer_id` or `recipient_id`; an open offer with a null party is `void` (`account_deleted`) by every read at once, and the sweep marks it (§5.3). Its partner rows go by cascade.

### 5.3 Behaviour

Every state-changing route runs in one transaction and locks account rows first (§5.4). Times come from the server clock, read once the account rows are locked (`economy.md` §8.9).

**Quote** `POST /api/trades/quote` (`QuoteBody`, no key, writes nothing): resolve `partnerId` to a partner of the caller (else 404 `partner_not_found`); check the shape (400 `offer_invalid`); compute both sides' fair values, the band, the gift and its direction, the fee, and `blocked` by the same checks as the accept, in its order, against holdings and sums read now without locks; answer `TradeQuote`. It is advice: the accept decides.

**Propose** `POST /api/trades/offers` (`OfferBody`):

1. Schema; shape (400 `offer_invalid`).
2. Lock the proposer's account. Replay: the same `requestId` with the same canonical body → 200 with the stored offer; a different body → 409 `request_id_reused`. The canonical body is `partnerId`, then each side's cards sorted by (character id, rarity) and its Karma.
3. The partner row must be the proposer's and the partner's account must exist → else 404 `partner_not_found`.
4. Caps: open sent offers ≥ `TRADE_MAX_OPEN_OFFERS`, open sent offers to this partner ≥ `TRADE_MAX_OPEN_PER_PARTNER`, or offers sent in the last 24 hours ≥ `TRADE_OFFERS_PER_DAY` → 409 `offer_limit` with `limit` (`offers_open`, `offers_partner`, `offers_day`; the last with `retryAfterSeconds`).
5. Holdings now: the proposer's give cards available (under its lock) and the recipient's take cards available (read without the recipient's lock) → else 409 `not_enough_copies`. The proposer's balance ≥ `give_karma` → else 409 `insufficient_funds` with `balance`. The recipient's balance is not checked: that is the recipient's to fix before accepting.
6. The windows and the gift limits as at acceptance (§3.8), on the sums now → 409 `market_limit` or `gift_limit`. An offer that could not settle now is not stored.
7. Insert the offer (`open`, `expires_at` = now + TTL) and its items; answer 201 `Offer`.

**Accept** `POST /api/trades/offers/{offerId}/accept` (`AcceptBody { requestId }`):

1. Replay: an accepted offer whose `accept_request_id` is this key and whose recipient is the caller → 200 with its receipt; the key on another offer → 409 `request_id_reused`.
2. Read the offer's two parties (unlocked; they change only to null). No offer, or the caller is not its recipient → 404 `offer_not_found` (the proposer cannot accept their own offer, and nobody learns that an offer exists).
3. **Lock both account rows in ascending id order** (as `economy.md` §8.5 step 3). The caller's row missing → 401. The proposer's row missing → 409 `offer_unavailable`. Re-check the replay.
4. Lock the offer row. Not `open`, past `expires_at`, or a party null → 409 `offer_unavailable`.
5. The two must still be partners → else 409 `offer_unavailable` (removal voids offers in its own transaction, so this is a backstop).
6. Lock the cards: for each item, the holder's available `standard` cards of that (character, rarity), `FOR UPDATE`, newest first, in ascending card id order overall. The recipient short → 409 `not_enough_copies`; the proposer short → 409 `offer_changed`.
7. Karma: the payer's balance below the Karma → 409 `insufficient_funds` with the recipient's `balance` if the recipient pays, else 409 `offer_changed`.
8. The windows for the Karma (§3.8) → 409 `market_limit` with `limit` and `retryAfterSeconds`.
9. The gift (§3.6), the pair and receiver sums over `transfer_gifts` (§3.7) → 409 `gift_limit` with `limit` and `retryAfterSeconds` (absent when it can never fit) and `gift`.
10. The receiver's balance + Karma − fee above `MAX_BALANCE` → 409 `balance_limit`.
11. Write: the payer's `trade_debit` (− K), the receiver's `trade_credit` (+ K) and `trade_fee` (− fee), ordered as `postSale` orders a sale and its fee; each given card `removed_at` = now, `removed_by_trade` = the offer; a new card for the other side per given card (same character, granted rarity, variant and `snapshot_id`, `trade_offer_id`, `pulled_at` = now, `is_new` when the receiver held no card of that character before this trade, once per character); the offer `accepted`, `closed_at`, `accept_request_id`, `fee` and the entry ids; one `transfer_gifts` row (`kind = 'trade'`). Commit; answer 201 `TradeReceipt`.

**Decline** (recipient) and **cancel** (proposer), `POST /api/trades/offers/{offerId}/decline|cancel` with `{}`: lock the caller's account, then the offer row. Not the caller's in that role → 404 `offer_not_found`. Already declined, cancelled, expired or void → 200 with its state. Accepted → 409 `offer_unavailable`. Lapsed and still `open` → closed as `expired` at its expiry (the market's M4 rule). Otherwise `declined` / `cancelled`, `closed_at` = now, 200 `Offer`.

**Read** `GET /api/trades` (the caller's code, partners, open offers both ways with fresh quotes, offers closed in the last 30 days, the gift summary, the rules); `GET /api/trades/offers/{offerId}` (one offer, the caller a party, with a fresh quote). A lapsed open offer reads as `expired`; one with a null party as `void` (`account_deleted`).

**Partners.** `POST /api/trades/partners` (`{ code }`): lock the caller's account; normalise the code; none with it → 404 `trade_code_invalid`; the caller's own → 409 `own_trade_code`; already partners → 200 `Partner`; else insert both rows and answer 201. `POST /api/trades/partners/{partnerId}/remove` (`{}`): lock the caller's account; the partner row must be the caller's → else 404 `partner_not_found`; lock the open offers between the two (either direction) and mark them `void` (`partner_removed`); delete both partner rows; 200. Removal takes only the caller's account lock: an accept between the same two takes both account locks, so the two serialise on the caller's row.

**Code.** `POST /api/trades/code` (`{}`): lock the caller's account; write a new code (retry on the unique constraint, at most three times, then 500); answer `{ code }`. No key: making a code twice only makes a newer code.

**Expiry and void sweep**: the market plugin's hourly sweep (`economy.md` §16, M10) also marks open offers past `expires_at` `expired` (`closed_at` = `expires_at`) and open offers with a null party `void` (`account_deleted`). Offer rows only, no account lock, so it cannot deadlock with an accept.

### 5.4 One locking order

`economy.md` §8.9's order gains offer rows and gift rows: **account rows (ascending id) → listing rows → offer rows → card rows (ascending id) → ledger rows → gift rows (insert only).**

| Path             | Locks, in order                                                     |
| ---------------- | ------------------------------------------------------------------- |
| Market purchase  | buyer and seller accounts → listing → card → ledger → gift row      |
| Listing, recycle | account → cards                                                     |
| Market cancel    | account → listing                                                   |
| Trade propose    | proposer account → (reads) → offer insert                           |
| Trade accept     | proposer and recipient accounts → offer → cards → ledger → gift row |
| Decline, cancel  | caller account → offer                                              |
| Partner remove   | caller account → open offers between the two                        |
| Reset            | account → listings → offers → cards                                 |
| Hourly sweeps    | listing rows; offer rows (no account lock)                          |

Why it cannot deadlock: every path that touches two accounts locks both first in one ascending order, and every later lock (a listing, an offer, a card) belongs to an account the transaction already holds, or is a row only the sweep touches without holding any account. A market purchase of C's card by B and a trade between A and B both lock B in the same total order. **The limits are consistent under concurrency for the same reason**: every transfer into an account holds that account's lock, so two gifts to one receiver from different givers serialise on the receiver's row, and the second sees the first's gift row; likewise for the pair. A test proves both (§12).

### 5.5 The 7-day windows with trades

`api/src/domain/market/limits.ts` keeps its four limits and its pure function; what it reads widens (`economy.md` §16, M3):

- `bought` (the buyer's spend): the account's `market_purchase` **and `trade_debit`** ledger rows in the window; `buyer_purchases` still counts only `market_purchase` rows.
- `sold` (the seller's proceeds): `market_sale` **and `trade_credit`** rows.
- `pair`: the buyer's purchases from the seller, as now, **plus** accepted offers in which the payer paid the receiver Karma (from `trade_offers` and the payer's `trade_debit`).
- `WindowLeft` in `GET /api/market/mine` therefore counts trades too; its line on the market page (`market-and-shop.md` §3.6) is unchanged in wording, which already says what it counts.

A trade's Karma is checked with the payer as `buyer` and the receiver as `seller`. The gift limits live in a new pure module, `api/src/domain/trades/gift-limits.ts`, with the same shape: `firstGiftLimitHit(history, gift, now)` → `{ limit: "gift_pair" | "gift_receiver", retryAfterSeconds | null } | null`.

### 5.6 Contract (`shared/src/api.ts`, `shared/src/errors.ts`)

**Error codes.** New: `gift_limit` (409), `offer_limit` (409), `offer_invalid` (400), `offer_not_found` (404), `offer_unavailable` (409), `offer_changed` (409), `partner_not_found` (404), `trade_code_invalid` (404), `own_trade_code` (409). `ErrorEnvelope.error.limit` widens from `MARKET_LIMITS` to `MARKET_LIMITS ∪ GIFT_LIMITS ∪ OFFER_LIMITS` (`gift_pair`, `gift_receiver`; `offers_open`, `offers_partner`, `offers_day`), each present only on its code; `retryAfterSeconds` (and `Retry-After`) is present on `gift_limit` when the gift can fit later, absent when it never can, and on `offer_limit` for `offers_day`; a new optional `gift: integer ≥ 1`, only on `gift_limit`, the gift the refused transfer carries. `insufficient_funds` carries `balance` as today.

**Schemas.**

```
GiftRules       { bandBps: integer, pairLimit: integer, receiverLimit: integer, windowSeconds: integer }
KarmaRules      gains gift: GiftRules, fairPriceMin: PerRarity, fairPriceMax: PerRarity     -- §3.6.2
Wallet          gains incomingOffers: integer ≥ 0                                          -- open, unexpired offers to the caller
ListingGift     { amount: integer ≥ 1, to: "buyer" | "seller" }
Listing         gains gift: ListingGift | null                                             -- what a sale at its price would carry, at today's rules

TradeCard       { characterId: integer ≥ 1, rarity: Rarity, count: integer 1..TRADE_MAX_CARDS }
TradeSide       { cards: TradeCard[0..TRADE_MAX_CARDS], karma: integer 0..MAX_ENTRY_AMOUNT }
QuoteBody       { partnerId: uuid, give: TradeSide, take: TradeSide }
OfferBody       { requestId: uuid, partnerId: uuid, give: TradeSide, take: TradeSide }
AcceptBody      { requestId: uuid }
CodeBody        {}                                   -- POST /api/trades/code
PartnerBody     { code: string(1..32) }              -- normalised by the api
RemoveBody      {}

Partner         { partnerId: uuid, login: string, since: date-time }
OfferCard       { character: CharacterPublic, rarity: Rarity, variant: CardVariant, count: integer ≥ 1 }
OfferSide       { cards: OfferCard[], karma: integer ≥ 0 }
OfferBlock      "your_cards" | "their_cards" | "your_karma" | "their_karma"
                | "buyer_spend" | "seller_proceeds" | "pair" | "gift_pair" | "gift_receiver" | "balance_limit"
TradeQuote      { youGive: integer ≥ 0, youGet: integer ≥ 0, band: integer ≥ 0,              -- fair values at reference
                  gift: { amount: integer ≥ 1, to: "you" | "partner" } | null,
                  fee: { amount: integer ≥ 1, payer: "you" | "partner" } | null,
                  blocked: OfferBlock | null, retryAfterSeconds: integer ≥ 1 | null,         -- null with a gift limit: never fits
                  balance: integer ≥ 0,                                                       -- the caller's, for "your_karma"
                  room: { toPartner: integer ≥ 0, fromPartner: integer ≥ 0, received: integer ≥ 0 } }
Offer           { offerId: uuid, role: "proposer" | "recipient",                              -- the caller's role
                  partner: Partner | null,                                                    -- null once the other account is deleted
                  youGive: OfferSide, youGet: OfferSide,
                  status: "open" | "accepted" | "declined" | "cancelled" | "expired" | "void",
                  voidReason: "partner_removed" | "account_deleted" | "owner_reset" | null,
                  createdAt: date-time, expiresAt: date-time, closedAt: date-time | null,
                  quote: TradeQuote | null,                                                   -- open offers only, computed at read time
                  gift: { amount: integer ≥ 0, to: "you" | "partner" | null } | null }        -- accepted offers: the recorded gift
TradeableEntry  { character: CharacterPublic, rarity: Rarity, variant: CardVariant, available: integer ≥ 1 }
PartnerCards    { partner: Partner, entries: TradeableEntry[], franchises: FranchiseRef[], snapshot: SnapshotInfo | null }
GiftSummary     { received: integer ≥ 0,                                                      -- to the caller, 30 days, all sources
                  partners: { partnerId: uuid, gave: integer ≥ 0, got: integer ≥ 0 }[] }     -- per partner: they gave you, you gave them
TradeRules      { maxCards, offerTtlSeconds, maxOpenOffers, maxOpenPerPartner, offersPerDay: integer ≥ 1 }
TradesHome      { code: string | null, partners: Partner[], incoming: Offer[], sent: Offer[], closed: Offer[],
                  gifts: GiftSummary, rules: TradeRules, franchises: FranchiseRef[] }
TradeReceipt    { offerId: uuid, acceptedAt: date-time, youGave: OfferSide,
                  youGot: { cards: (OfferCard & { isNew: boolean })[], karma: integer ≥ 0, fee: integer ≥ 0 },
                  gift: { amount: integer ≥ 0, to: "you" | "partner" | null },
                  franchises: FranchiseRef[], balance: integer ≥ 0 }
```

No request carries an account id, a card id, a value, a gift, a fee or a band; a body naming any is an unknown field (400). The only numbers a request carries are counts and the offered Karma, both bounded by the schema and checked by the domain.

**Routes.**

| Method, path                                   | Body          | Success                             | Errors (status, code)                                                                                                                                                                                                | Limit   |
| ---------------------------------------------- | ------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `GET /api/trades`                              | —             | 200 `TradesHome`                    | 401                                                                                                                                                                                                                  | global  |
| `POST /api/trades/code`                        | `CodeBody`    | 200 `{ code: string }`              | 400, 401                                                                                                                                                                                                             | 30/min  |
| `POST /api/trades/partners`                    | `PartnerBody` | 201 `Partner`; 200 if already       | 400, 401, 404 `trade_code_invalid`, 409 `own_trade_code`                                                                                                                                                             | 30/min  |
| `POST /api/trades/partners/{partnerId}/remove` | `RemoveBody`  | 200 `{}`                            | 400, 401, 404 `partner_not_found`                                                                                                                                                                                    | 30/min  |
| `GET /api/trades/partners/{partnerId}/cards`   | —             | 200 `PartnerCards`                  | 400, 401, 404 `partner_not_found`                                                                                                                                                                                    | global  |
| `POST /api/trades/quote`                       | `QuoteBody`   | 200 `TradeQuote`                    | 400 `validation_failed`, 400 `offer_invalid`, 401, 404 `partner_not_found`                                                                                                                                           | 120/min |
| `POST /api/trades/offers`                      | `OfferBody`   | 201 `Offer`; 200 on a replay        | 400 `validation_failed`, 400 `offer_invalid`, 401, 404 `partner_not_found`, 409 `offer_limit`, 409 `not_enough_copies`, 409 `insufficient_funds`, 409 `market_limit`, 409 `gift_limit`, 409 `request_id_reused`      | 30/min  |
| `GET /api/trades/offers/{offerId}`             | —             | 200 `Offer`                         | 400, 401, 404 `offer_not_found`                                                                                                                                                                                      | global  |
| `POST /api/trades/offers/{offerId}/accept`     | `AcceptBody`  | 201 `TradeReceipt`; 200 on a replay | 400, 401, 404 `offer_not_found`, 409 `offer_unavailable`, 409 `offer_changed`, 409 `not_enough_copies`, 409 `insufficient_funds`, 409 `market_limit`, 409 `gift_limit`, 409 `balance_limit`, 409 `request_id_reused` | 30/min  |
| `POST /api/trades/offers/{offerId}/decline`    | `RemoveBody`  | 200 `Offer`                         | 400, 401, 404 `offer_not_found`, 409 `offer_unavailable`                                                                                                                                                             | 30/min  |
| `POST /api/trades/offers/{offerId}/cancel`     | `RemoveBody`  | 200 `Offer`                         | 400, 401, 404 `offer_not_found`, 409 `offer_unavailable`                                                                                                                                                             | 30/min  |
| `POST /api/market/listings/{listingId}/buy`    | `BuyBody`     | as today                            | as today, plus 409 `gift_limit`                                                                                                                                                                                      | 30/min  |

Path ids are uuids (else 400). The GETs take `NoQuery`. The POSTs are behind the CSRF check, and their response schemas also declare 403 `bad_origin` and 429 `rate_limited`. 30/min is `CARD_ACTION_RATE_LIMIT`, each replacing the global bucket for its route. The route inventory test gains these rows.

### 5.7 Audits

**`audit-ledger`** (C22) gains, for every account and offer:

- every accepted offer with Karma has exactly its three entries, of the right accounts, signs and amounts (`trade_debit` − K of the payer, `trade_credit` + K and `trade_fee` − `fee` of the receiver), and `fee` = `fee(K)` at the rules of its day (a differing fee is a `Note:` line, as the listing fee is); an accepted offer without Karma has none; no other offer has any;
- every accepted offer removed exactly `count` cards of each item from the giver (`removed_by_trade`) and delivered exactly `count` cards of the same character, rarity and variant to the other side (`trade_offer_id`), unless a reset of that account after the trade explains the missing ones (the recycle rule of `economy.md` §13.1); no card is removed by, or delivered by, an offer that is not accepted;
- every market purchase and every accepted offer has exactly one `transfer_gifts` row; its `band` and `gift` match the formula on its stored values; its values equal the purchase's price and `REFERENCE_VALUE` of its rarity, or the offer's items at `REFERENCE_VALUE` plus its Karma (a difference, which a deploy that changes a reference value causes, is a `Note:` line); its `from` and `to` are the right parties;
- **no limit was ever exceeded**: for every gift row that is not `backfilled`, the gifts to its `to_id` in the 30 days up to and including it sum to at most `GIFT_LIMIT_RECEIVER`, and those from its `from_id` to its `to_id` to at most `GIFT_LIMIT_PAIR`. A failure names the row (`gift <id>: the receiver's 30 days reach <sum>, above <limit>`). Checked against the limits in force; a deploy that lowers a limit says in its spec how older rows are treated.

**`audit-market`** (`economy.md` §13.3) reads personal trades too: a trade's Karma joins the net Karma per pair and the volume figures, and its partners join the same-invite-code section. New sections:

- **Net fair value per pair, last 30 days**: Σ `from_value − to_value` from `transfer_gifts`, directed, largest first, with the number of transfers and how many were gift-free;
- **One-way trading inside the band**: pairs with at least 5 transfers in 30 days in which one side received the larger side in at least 80 % of them with a gift of 0, and the fair value that moved: the card-cycling residual of §3.7.1;
- **Gifts near the limits**: pairs and receivers at 80 % or more of a gift limit in the last 30 days;
- **Pure gifts**: transfers in which one side was empty, per pair;
- **Offers accepted within 60 seconds of being made**, with both accounts.

Each is a finding for the owner, never a failure; `No findings.` and exit 0 as today.

### 5.8 Abuse cases

| Case                                                                             | What stops it                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An offer to oneself                                                              | `own_trade_code`; `trade_partners` check `account_id <> partner_id`; `trade_offers` check proposer ≠ recipient                                                                                                     |
| Offer spam                                                                       | partners only (opt-in by code); `TRADE_MAX_OPEN_OFFERS`, `TRADE_MAX_OPEN_PER_PARTNER`, `TRADE_OFFERS_PER_DAY`; `CARD_ACTION_RATE_LIMIT`; the recipient removes the partner and makes a new code                    |
| Guessing trade codes                                                             | 60 bits; 30 attempts a minute per address; no partial match; the answer for an unknown code is the same 404 whatever the code                                                                                      |
| Learning logins                                                                  | a login is in an answer only to a partner, and a partner exists only by a code its owner gave out; no route lists accounts                                                                                         |
| Seeing a non-partner's cards or offers                                           | `partnerId` is the caller's own partner row; an offer is readable only by its two parties; both 404 otherwise                                                                                                      |
| A deleted account                                                                | its open offers read as `void` at once and are swept; its partner rows cascade; its gifts keep counting for the other party (`set null`); an accept that waited on its row finds it gone (409 `offer_unavailable`) |
| Items that changed since the offer                                               | checked at acceptance under both account locks (§3.3); a card that is now listed, recycled, traded, bought or reset is not available; `offer_changed` / `not_enough_copies`                                        |
| Accept against cancel, two accepts, accept against a market buy of the same card | serialised on the account rows, then the offer row (§5.4, §12)                                                                                                                                                     |
| A forged value, gift, fee or card id in a body                                   | unknown field, 400 (C2); the server derives every value from the items and its constants                                                                                                                           |
| Replay                                                                           | the propose key per proposer, the accept key per recipient; same key and body → the stored answer; a different body → `request_id_reused`                                                                          |
| Funnelling through the market at the cap                                         | the gift at the cap counts (§3.6.2), so the receiver limit binds before the windows (§3.7.1)                                                                                                                       |
| Funnelling through many small fair trades                                        | Karma: the windows (§3.7.1); cards by cycling: owner decision 3 (§16), and `audit-market`'s one-way section                                                                                                        |
| Hostile logins in offers                                                         | rendered as text with `dir="auto"` (C9); the T1 hostile-name test on every place a login appears                                                                                                                   |

### 5.9 Rate limits and logging

Rate limits as §5.6's table. At `info`, with the request id: offer sent (offer, proposer, recipient, items count per side, Karma, gift, replayed); accepted (offer, both accounts, gift and its direction, Karma, fee, both balances after, replayed); declined, cancelled, expired, voided (offer, reason); partner added and removed (both accounts); code made (account, never the code). At `warn`: a transfer refused by `gift_limit` (which limit, the gift), and by `offer_limit`. Never a whole request body, never a trade code.

## 6. Market change

The buy path (`MarketService.buy`, `economy.md` §8.5) gains one step and one row; nothing else in the market changes.

1. **Step 6a, after the window limits (step 6) and before the balance check (step 7):** compute the gift of (`listing.price`, `REFERENCE_VALUE[listing.rarity]`) with the shared function; if it is above 0, read the pair sum (giver → receiver) and the receiver sum from `transfer_gifts` over 30 days, under the two account locks the purchase already holds, and refuse with 409 `gift_limit` (`limit`, `retryAfterSeconds` or none, `gift`) when the gift does not fit. The giver is the buyer when the price is above `fairPriceMax`, else the seller. Logged at `warn` like `market_limit`.
2. **Step 8 gains** the `transfer_gifts` row (`kind = 'market'`, the purchase, gift ≥ 0), inserted after the purchase row in the same transaction.
3. **`Listing.gift`**: every listing in `GET /api/market/listings` and `GET /api/market/mine` carries the gift a sale at its price would carry at today's rules, and to whom, or null. **`KarmaRules`** gains `gift`, `fairPriceMin` and `fairPriceMax`.
4. **Listing a card is not refused** for a price with a gift: whether it can sell depends on the buyer and on room that frees over time, and the bounds stay the owner's (ADR 0016 decision 6).

**What a buyer sees** (`market-and-shop.md` §3.4, §3.5, changed by T.1):

- The listing dialog's facts gain `Gift` when `listing.gift` is not null: `<g> Karma to you` (`to: "buyer"`, a price below the fair range) or `<g> Karma from you to the seller` (`to: "seller"`).
- The buy confirmation's body gains, when there is a gift: `This price is below <fairMin> Karma, so it counts as a gift of <g> Karma to you.` or `This price is above <fairMax> Karma, so it counts as a gift of <g> Karma from you to the seller.` (the tier's `fairPriceMin` / `fairPriceMax`).
- **`gift_limit`**: the red line by `limit` and direction, the date from now + `retryAfterSeconds`, the confirm button disabled until then (held on the Market page as `market_limit` is, `market-and-shop.md` §3.8: a buyer's own receiver limit disables every gift-to-you listing's button, a pair or seller's limit only that listing's):
  - gift to you, `gift_receiver`: `You've received as much in gifts as the game allows for 30 days, and at this price the card is a gift of <g> Karma to you. Try again on <D Mon> at <HH:MM>.`
  - gift to you, `gift_pair`: `This seller has given you as much in gifts as the game allows for 30 days. Try again on <D Mon> at <HH:MM>.`
  - gift from you, `gift_pair`: `You've given this seller as much in gifts as the game allows for 30 days, and this price is a gift of <g> Karma. Try again on <D Mon> at <HH:MM>.`
  - gift from you, `gift_receiver`: `This seller has received as much in gifts as the game allows for now. Try again on <D Mon> at <HH:MM>.`
  - no `retryAfterSeconds`: `At this price the card is a gift of <g> Karma, more than the game allows in 30 days.`
  - then always: `Cards priced from <fairMin> to <fairMax> Karma carry no gift.`
- **What a seller sees** (the card dialog's List section, `collection-overview.md` §3.5): under the price hint, `Prices from <fairMin> to <fairMax> Karma carry no gift.`; in the listing confirmation, when the price is above `fairMax`: `Above <fairMax> Karma, a sale counts as a gift to you, and gifts are limited, so a buyer may have to wait.`, and below `fairMin`: `Below <fairMin> Karma, a sale counts as a gift to the buyer.` These compare the typed price with two published numbers, as the bounds check does; the gift itself comes from the answer: the listed status line gains ` A sale counts as a gift of <g> Karma to you.` / `… to the buyer.` from `Listing.gift`. My listings' rows gain `Gift <g> Karma to you` / `Gift <g> Karma to the buyer` (`text-xs ink-400`).

## 7. States

| View            | State                                   | User sees                                                                                                          | User can do                           |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `/trades`       | loading (after 300 ms)                  | Section headings, three skeleton rows each (static); visually hidden `Loading your trades…`                        | Wait                                  |
| `/trades`       | loaded                                  | The five sections                                                                                                  | View, add, remove, make a code, offer |
| `/trades`       | no partners, no offers                  | `No offers for you.`, `No offers sent.`, the code block, `No trade partners yet.`, gifts `0 Karma of …`            | Make a code, add a partner            |
| `/trades`       | error, nothing held                     | `Couldn't load your trades.` and `Try again`                                                                       | Try again                             |
| `/trades`       | stale (held, refetch failed)            | The held sections; `Accept…`, `Make an offer` disabled with `Trading waits until the game server answers.`         | Look                                  |
| Code block      | none / shown / making / copied          | `Make a trade code` / the code, `Copy code`, `New code…` / `Making…` disabled / status `Code copied.`              | Make, copy, replace                   |
| Add partner     | idle / adding / error / added           | The field / `Adding…` / the field error / the status line                                                          | Add                                   |
| Partner row     | removing                                | `Removing…`, disabled; other rows usable                                                                           | Wait                                  |
| Offer row       | open / blocked / expired-now            | The row / the row and the blocked line / moves to Closed on the next read                                          | View                                  |
| Offer dialog    | checking                                | The held quote; `Accept…` disabled, `Checking the offer…`                                                          | Decline, close                        |
| Offer dialog    | open, can settle                        | Both sides, the gift line, `Accept…`, `Decline` (or `Cancel offer`)                                                | Accept, decline, cancel, close        |
| Offer dialog    | blocked                                 | The blocked line; `Accept…` disabled                                                                               | Decline, close                        |
| Accept          | confirm, accepting, failures            | As `collection-overview.md` §4.6, with §4.2's copy                                                                 | Confirm, cancel                       |
| Accept          | done                                    | `Trade done`, the cards with `New`, the Karma line, the balance; focus on the heading                              | Close                                 |
| Accept          | gone                                    | `This offer is no longer open.`                                                                                    | Close                                 |
| Decline, cancel | in flight / done / closed / no answer   | `Declining…` / status line / `That offer had already closed.` / `Try again`                                        | Wait, try again                       |
| Builder step 1  | partners / none                         | Radio rows and the add field / the add field and its line                                                          | Choose, add                           |
| Builder step 2  | empty                                   | Both panels empty; gift panel `Add cards or Karma to either side.`; `Send offer…` disabled                         | Add cards, add Karma                  |
| Builder step 2  | quoting                                 | The previous gift text, `Checking…` beside the heading (not live); `Send offer…` disabled                          | Keep editing                          |
| Builder step 2  | quoted, no gift / gift fits             | The gift line (and room line); `Send offer…` enabled                                                               | Send                                  |
| Builder step 2  | quoted, blocked                         | The blocked line; `Send offer…` disabled with it                                                                   | Edit                                  |
| Builder step 2  | quote failed                            | `Couldn't check this offer.` and `Try again`; `Send offer…` disabled                                               | Try again, edit                       |
| Builder step 2  | partner's cards loading / failed / none | Skeleton tiles in the picker / `Couldn't load <login>'s cards.` and `Try again` / `<login> has no cards to trade.` | Wait, try again                       |
| Builder step 2  | side full                               | `+` and `Add cards` disabled, `At most <maxCards> cards a side.`                                                   | Remove cards                          |
| Send            | confirm, sending, failures              | As `collection-overview.md` §4.6, with §4.3's copy                                                                 | Confirm, cancel                       |
| Market listing  | with a gift                             | The `Gift` fact                                                                                                    | Buy…                                  |
| Market buy      | gift limit                              | The red line with the date; confirm disabled                                                                       | Cancel                                |

Session ended and unreachable: `accounts.md` §4.8, as everywhere.

## 8. Layout

| Width        | `/trades`                                                                                                                                                                                                              | `/trades/new` step 2                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| below 640 px | One column, full width. Offer rows: login on line 1, summary on line 2, gift and `Open until` on lines 3–4, `View` under them. The code block: code on its own line, `Copy code` and `New code…` side by side under it | One column: `You give`, then `You get`, then the gift panel, then `Send offer…` full width. Card rows: thumbnail, text (name truncates), stepper under the text |
| 640–1023 px  | One column, `max-w-3xl`; rows `flex gap-3`, the action on the right                                                                                                                                                    | The two panels side by side, `grid-cols-2 gap-6`; the gift panel and the button under both                                                                      |
| 1024 px up   | As 640                                                                                                                                                                                                                 | As 640, `max-w-5xl`                                                                                                                                             |

- **320 px.** Content is 288 px. A card row is the 48 × 67 thumbnail, 12 px gap and 228 px of text; the stepper (`−`, the count, `+`, each 44 × 44) and `Remove` sit on a second line. The login truncates with an ellipsis at one line (`truncate`, full name in the accessible name). The code `XXXX-XXXX-XXXX` in `num` at 13 px is about 160 px and never wraps. The Karma fields are full width. The section nav (`Listings` · `Trades (<N>)`) fits in one row. No horizontal scroll anywhere; the picker's grid is the collection's 2-column phone grid.
- **The picker** is a full-screen dialog below 640 px (`radius-sheet` top corners only), a `max-w-4xl` dialog above, with its search and rarity select on one row from 640 px and stacked below it.
- **Offer dialog**: the card dialog's layout (`collection-overview.md` §5.4) without the large art: the two lists stack below 640 px and sit side by side above.

## 9. Visual treatment

Tokens from `visual-identity.md` §12 (PR #64). If that PR has not landed when T.3 is built, use today's classes, which its PR 1 remaps one to one (`zinc-950` → `night-950` and so on, `visual-identity.md` §12.1).

- **Page header**: the eyebrow and title pattern (`visual-identity.md` §10.1): eyebrow `Player trades`, `h1` `Trades` / `Make an offer` in `title`. The section nav under it: text links in `small`, `ink-300`; the current one `ink-100` with a 2 px `volt` underline; no pills, no boxes.
- **Sections**: `h2` in `section` size, separated by `mt-16` and a hairline (`night-700`), not boxed.
- **Rows**: `flex gap-3 border-b border-night-700 py-3`. Logins `body` `ink-100`; summaries and dates `small` `ink-300`; `Open until` `xs` `ink-400`.
- **Karma amounts**: every number before `Karma` in `num` and `ion`, the word `Karma` in `ink-400`, as the header chip (`visual-identity.md` §5.2). Gift amounts are Karma amounts and use the same.
- **Gift line**: `small` `ink-200`. No colour for "fair" or "generous": a gift is neither good nor bad. The blocked line in `danger`, words only, with `role="alert"` when it appears after an action, plain text when it is part of a quote.
- **The trade code**: `num` at 13 px, `ink-100`, on a `night-850` chip (`radius-chip`, 1 px `night-700` border), selectable text (`user-select: all`).
- **Buttons**: `Accept…`, `Send offer…` primary (Volt); `Decline`, `Cancel offer`, `Add partner`, `Add cards`, `Make an offer`, `Copy code` secondary; `Remove…`, `New code…`, `Change`, `How the gift is worked out` text buttons. One primary per view: on `/trades` there is none until a dialog opens; in the builder it is `Send offer…`.
- **Cards**: thumbnails and the picker's tiles are the existing card and tile (`card-and-rarity.md` §3.2, `collection-overview.md` §6.2) with the tier frame; the `×<available>` count in `num`. `Chosen` is a `night-850` chip with `ink-100` text over the tile's caption. The result's cards use the collection tile, with no reveal ceremony: a trade is not a pack (`pack-opening.md` does not apply).
- **Counts on links** (`Trades (<N>)`, the Market item's chip): no colour, no motion; `value-tick` is not used for them.
- No new tokens.

## 10. Accessibility

- **Navigation**: the section nav is a `<nav aria-label="Market sections">` of real links with `aria-current="page"` on the current page's; the header's Market item carries `aria-current="true"` on `/trades` and `/trades/new` (§4.1). The count is part of the accessible name (`Trades, 2 offers for you`; the Market item `Market, 2 trade offers`), never a separate badge element announced alone.
- **Titles and focus** as §4.1; after `Send offer` succeeds, focus goes to `/trades`'s `h1` and the live region reads `Offer sent to <login>.` once.
- **Lists**: each section's rows are a `<ul>`; an offer row is a `<li>` whose `View` button is named `View offer from <login>` / `View your offer to <login>`. Partner buttons: `Make an offer to <login>`, `Remove <login>`.
- **Dialogs**: native `<dialog>` with `showModal()`, heading focus, `aria-describedby` on the body, the in-flight rules (nothing closes it while a request is in flight; `Cancel` and Escape return focus to the control that opened the confirmation), as `collection-overview.md` §7.
- **The builder**: each panel a `<section aria-labelledby>` (`You give`, `You get`). The stepper is a `role="group"` named `Copies of <name>` with two buttons (`Fewer copies of <name>`, `More copies of <name>`) and the count as an `<output>`; `Remove <name>`. The Karma fields are `<input type="text" inputmode="numeric">` with visible labels, the hint and any reason linked by `aria-describedby`; a disabled field keeps its reason readable (`aria-disabled` with the reason, not `disabled`, so it stays in the tab order).
- **The gift panel** is not itself live. Its text goes to the shell's polite live region 500 ms after the last change, once per new quote, as the collection's results line does; `Checking…` is never announced. The blocked line, when it appears in answer to `Send offer` or `Accept trade`, is `role="alert"`.
- **The picker**: a `<search>` labelled `Card filters`, the grid of `<button>` tiles named `<name>, <Rarity>, <N> to trade` (`, chosen` when chosen); activating one announces `Added <name>.` politely. `Done` returns focus to `Add cards`.
- **The code**: `Copy code` is named `Copy your trade code`; its status line is `role="status"`. The code is text, readable by a screen reader character by character (`aria-label` on its chip spells it in groups: `Trade code K 7 Q M, 2 X R T, 9 P W A`).
- **Keyboard path** on `/trades/new`: step 1 radios (arrow keys), then step 2: `Change`, You give rows (stepper, remove), `Add cards`, the Karma field, the same for You get, the gift disclosure, `Send offer…`.
- Contrast, touch targets (44 px) and reduced motion as `visual-identity.md` §5.4, §6.1, §9. Nothing on these pages moves except the dialogs' `pop-in`, which reduced motion removes.

## 11. Copy

The rules of `collection-overview.md` §8 and `visual-identity.md` §11.5 apply unchanged: the banned words (among them "value", "worth", "pay", "paid", "earn", "balance" and "another"), no exclamation marks, no urgency, no scarcity, and `Karma` only after a number. The player-facing word for the gift value is **gift**; "value" appears in no string. **New allowed words**: `trade`, `trades`, `traded`, `offer`, `offers`, `partner`, `partners`, `accept`, `decline`, `gift`, `gifts`, `give`, `gave`, `send`, `sent`, `code`, `withdrawn`. **Exceptions added to the `Karma`-after-a-number rule**, and no others: the field labels `Karma you add` and `Karma you ask for`, the line `Karma goes one way in an offer.`, and `That would take one of you past the most Karma anyone can hold.` (the trades form of the recycle's approved ceiling line, `collection-overview.md` §3.6 item 10). New placeholders: `<login>` the partner's login (text, `dir="auto"`); `<g>` a gift; `<K>` the trade's Karma; `<fee>` its fee; `<r>`, `<a>`, `<b>` gift sums; `<pairLimit>`, `<receiverLimit>` from `rules.gift`; `<fairMin>`, `<fairMax>` the tier's fair prices; `<code>` the trade code; `<days>` the offer time in days (`3 days`); `<maxCards>`, `<maxOpen>`, `<maxPerPartner>`, `<perDay>` from the trade rules (`maxCards`, `maxOpenOffers`, `maxOpenPerPartner`, `offersPerDay`); `<youGive>`, `<youGet>`, `<band>` the quote's figures; `<window>` the market window in days.

**Section nav and pages**

| Element          | Copy                                                 |
| ---------------- | ---------------------------------------------------- |
| Section nav      | `Listings` · `Trades` / `Trades (<N>)`               |
| Titles           | `Trades · Anime TCG` · `Make an offer · Anime TCG`   |
| Eyebrow          | `Player trades`                                      |
| Headings (`h1`)  | `Trades` · `Make an offer`                           |
| Guard line       | `Log in to see your trades.`                         |
| Market item name | `Market, <N> trade offers` / `Market, 1 trade offer` |

**`/trades`**

| Element                   | Copy                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section headings          | `Offers for you` · `Offers you sent` · `Trade partners` · `Gifts, last 30 days` · `Closed in the last 30 days`                                                                                            |
| Offer summary             | `You give <cards>` · `You get <cards>` · `and <K> Karma` (only the parts there are); `<cards>` = `1 card` / `<N> cards`; an empty side `nothing`                                                          |
| Offer row                 | `Open until <D Mon>, <HH:MM>` · `View`                                                                                                                                                                    |
| Empty                     | `No offers for you.` · `No offers sent.` · `No trade partners yet.` · `Nothing in the last 30 days.`                                                                                                      |
| Code, none                | `Give your code to a player you want to trade with. Anyone who has it can send you offers.` · `Make a trade code` / `Making…`                                                                             |
| Code, shown               | `Your trade code` · `<code>` · `Copy code` · `New code…`                                                                                                                                                  |
| Code status               | `Code copied.` · `Couldn't copy. Select the code and copy it.` · `Your trade code is <code>.`                                                                                                             |
| New code confirmation     | `Make a new code? Your current code stops working. Your partners stay.` · `Make a new code` · `Cancel`                                                                                                    |
| Add partner               | label `Their trade code` · `Add partner` / `Adding…`                                                                                                                                                      |
| Add partner answers       | `<login> is now a trade partner.` · `<login> is already a trade partner.` · `No player has that code.` · `That's your own code.`                                                                          |
| Partner row               | `Partner since <D Mon YYYY>` · `Make an offer` · `Remove…`                                                                                                                                                |
| Remove confirmation       | `Remove <login> as a trade partner? Open offers between you are withdrawn. To trade again, one of you needs the other's code.` · `Remove` / `Removing…` · `Cancel`                                        |
| Removed                   | `<login> is no longer a trade partner.`                                                                                                                                                                   |
| Gifts total               | `You received <r> Karma of <receiverLimit> Karma in gifts.`                                                                                                                                               |
| Gifts per partner         | `<login>: gave you <a> of <pairLimit> Karma · you gave <b> of <pairLimit> Karma`                                                                                                                          |
| Gifts rule                | `A trade or a market sale counts as a gift when one side is more than a quarter larger than the other, at the reference prices. Gifts are limited. A trade without a gift never counts toward the limit.` |
| Closed statuses           | `Accepted` · `Declined` · `Cancelled` · `Expired` · `Withdrawn`; accepted with a gift adds ` · gift of <g> Karma to you` / `… to <login>`                                                                 |
| Stale reason              | `Trading waits until the game server answers.`                                                                                                                                                            |
| Loading (visually hidden) | `Loading your trades…`                                                                                                                                                                                    |
| Error                     | `Couldn't load your trades.` · `Try again`                                                                                                                                                                |

**Offer dialog, accept, decline, cancel**

| Element                | Copy                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Heading                | `Offer from <login>` · `Your offer to <login>`                                                                                  |
| Lists                  | `You give` · `You get` · row `×<N>` · `<K> Karma` · empty `Nothing`                                                             |
| Expiry                 | `Open until <D Mon>, <HH:MM>`                                                                                                   |
| Checking               | `Checking the offer…`                                                                                                           |
| Buttons                | `Accept…` · `Decline` / `Declining…` · `Cancel offer` / `Cancelling…`                                                           |
| Confirmation heading   | `Accept this trade?`                                                                                                            |
| Karma lines            | `<K> Karma goes from you to <login>.` · `You get <K> Karma, less a fee of <fee> Karma.`                                         |
| Last copy              | `This is your only <name>. Once traded, it stops counting toward completion.` · `This trades every copy of <name> at <Rarity>.` |
| Close of body          | `There is no undo.`                                                                                                             |
| Confirm button         | `Accept trade` / `Accepting…`                                                                                                   |
| Result                 | heading `Trade done` · `You got` · `New` · `<K> Karma, less a <fee> Karma fee.` · `You have <B> Karma.` · `Close`               |
| Own side changed       | `Your collection changed, so this trade can't go through as it is.`                                                             |
| Their side changed     | `<login> no longer has everything in this offer.`                                                                               |
| Gone                   | `This offer is no longer open.`                                                                                                 |
| Declined, cancelled    | `Offer declined.` · `Offer cancelled.` · `That offer had already closed.`                                                       |
| Not enough Karma (red) | `This trade needs <K> Karma. You have <B> Karma.`                                                                               |
| Ceiling (red)          | `That would take one of you past the most Karma anyone can hold.`                                                               |

**Builder**

| Element                   | Copy                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 1 heading (`h2`)     | `Choose a partner`                                                                                                                                                                                                                                                                                                      |
| Step 1, none              | `Add a partner with their trade code to make an offer.`                                                                                                                                                                                                                                                                 |
| Step 2 heading (`h2`)     | `Offer to <login>` · `Change`                                                                                                                                                                                                                                                                                           |
| Drop the draft            | `Drop this offer?` · `Drop it` · `Keep it`                                                                                                                                                                                                                                                                              |
| Panels                    | `You give` · `You get` · `Add cards` · `Remove` · `Karma you add` · `Karma you ask for`                                                                                                                                                                                                                                 |
| Karma one way             | `Karma goes one way in an offer.`                                                                                                                                                                                                                                                                                       |
| Your Karma hint           | `You have <B> Karma.`                                                                                                                                                                                                                                                                                                   |
| Side full                 | `At most <maxCards> cards a side.`                                                                                                                                                                                                                                                                                      |
| Picker                    | heading `Your cards` / `<login>'s cards` · search label `Search`, placeholder `Name or series` · `Rarity` · `All rarities` · tile `×<N>` · `Chosen` · `Done`                                                                                                                                                            |
| Picker empty              | `No cards to trade.` · `<login> has no cards to trade.` · `No cards match "<query>".`                                                                                                                                                                                                                                   |
| Picker failed             | `Couldn't load <login>'s cards.` · `Try again`                                                                                                                                                                                                                                                                          |
| Picker added (live)       | `Added <name>.`                                                                                                                                                                                                                                                                                                         |
| Gift panel heading (`h2`) | `Gift`                                                                                                                                                                                                                                                                                                                  |
| Empty draft               | `Add cards or Karma to either side.`                                                                                                                                                                                                                                                                                    |
| Quoting                   | `Checking…`                                                                                                                                                                                                                                                                                                             |
| Quote failed              | `Couldn't check this offer.` · `Try again`                                                                                                                                                                                                                                                                              |
| Disclosure                | `How the gift is worked out` · `At reference prices you give <youGive> Karma and get <youGet> Karma. Up to a quarter more on one side, <band> Karma here, is no gift.`                                                                                                                                                  |
| Send button               | `Send offer…` · stale reason `Sending waits until the game server answers.`                                                                                                                                                                                                                                             |
| Send confirmation         | heading `Send this offer to <login>?` · `Nothing leaves your collection until <login> accepts. The offer stays open for <days>, and you can cancel it until then.` · `Send offer` / `Sending…` · `Cancel`                                                                                                               |
| Sent (live)               | `Offer sent to <login>.`                                                                                                                                                                                                                                                                                                |
| Changed                   | `Something changed in your cards or theirs. The lists are up to date now.`                                                                                                                                                                                                                                              |
| Not a partner             | `<login> is no longer a trade partner.`                                                                                                                                                                                                                                                                                 |
| Offer limits (red)        | `offers_open`: `You have <maxOpen> offers open, the most at once. Cancel one to send this.` · `offers_partner`: `You have <maxPerPartner> offers open to <login>, the most at once.` · `offers_day`: `You've sent <perDay> offers in the last day, the most the game allows. You can send again on <D Mon> at <HH:MM>.` |

**Gift, room and blocked lines** are §4.4's tables, exactly; after every gift-limit line, `Trades without a gift still go through.`

**Market** strings are §6's.

Failures not listed here use `collection-overview.md` §8's "Failures" strings. The copy test scans every string above against the banned lists; the strings that name `Karma` without a number before it are only the three exceptions above.

## 12. Test plan

**Unit** (`api/src/domain/trades/*.test.ts`, `shared/`):

- The gift function: §3.6.1's and §3.6.2's tables row by row; band edges ±1 for every tier; symmetry (swapping the sides swaps the direction and keeps the amount); a pure gift counts in full; a gift of 0 for equal sides; monotonic (raising the larger side never lowers the gift); integers only, and `Number.isSafeInteger` on every input and output; the largest side (10 Mythics and `MAX_ENTRY_AMOUNT`).
- `fairPriceMin` / `fairPriceMax` recomputed per tier; §5.1's invariants; §3.7.1's funnel figures recomputed from the parameters (a change of a window or a limit fails until the spec's table is updated).
- `firstGiftLimitHit`: pair before receiver; at the limit exactly fits; one over refuses; `retryAfterSeconds` frees exactly the excess from the oldest gifts, at least 1; a gift above the limit itself → `null` seconds; a gift of 0 never hits.
- Offer shape rules (`offer_invalid`): each case of §3.1; the canonical body is order-insensitive; trade code normalisation (case, hyphens, spaces, `I`/`L` → `1`, `O` → `0`) and generation (alphabet, length, uniform from `crypto.randomInt`).
- The windows with trades: `trade_debit` counts as spend, `trade_credit` as proceeds, a trade's Karma in the pair; `buyer_purchases` does not count trades.

**Route** (`api/test/trades.test.ts`, `api/test/market.test.ts`): every row of §5.6's table, the happy path and each declared error; extra fields (`gift`, `value`, `fee`, `cardId`, `accountId`, `band`) → 400; a query string on a GET → 400; missing Origin → 403; signed out → 401; a trade moves exactly the cards and the Karma, writes three ledger rows with the 5 % fee from the Karma's receiver, and one gift row; the last copy can be traded and the entry goes; a listed copy cannot be offered or taken; a pure gift of Karma and of cards; a gift asked for; `Wallet.incomingOffers` follows propose, accept, decline, cancel, expiry; `Listing.gift` on browse and mine; `KarmaRules.gift`, `fairPriceMin`, `fairPriceMax`; a Mythic at the cap sells to an empty pair window and a second to the same buyer within 30 days is refused with `gift_pair`, and fits again 30 days after the first; floor Mythics: three from one seller fit and a fourth is refused with `gift_pair`, six from several sellers fit and a seventh is refused with `gift_receiver`; a fair purchase goes through at a full gift limit; deleting a party voids open offers and keeps the other's gift rows; the reset voids offers and deletes traded cards; removing a partner voids offers both ways; `audit-ledger` passes on the database each suite leaves.

**Concurrency** (parallel `inject()`, and through two app instances on one database for the first three):

- **Accept vs cancel** of one offer, 50 times → exactly one wins each time; an accepted offer is never cancelled, a cancelled one never settles.
- **Two accepts** of one offer with different keys → one 201, one 409 `offer_unavailable`; one set of moves; with the same key → one 201, one 200 with the same receipt.
- **A trade vs a market buy of the same card**: the proposer's listed-then-cancelled card offered, then listed again while a third account buys it and the recipient accepts → exactly one of the two gets the card; the other is refused (`listing_unavailable` or `offer_changed`); `audit-ledger` clean.
- **Two accepts of two offers naming the same card** of one proposer → one settles, the other `offer_changed`.
- **Opposite trades** (A accepts B's offer while B accepts A's), and a trade between A and B racing a purchase between B and A, 50 pairs → no deadlock, no lock timeout.
- **Gifts racing one receiver**: nine accounts each send the main a gift that fits alone, all accepted in parallel → the accepted gifts sum to at most `GIFT_LIMIT_RECEIVER`, the rest refused with `gift_receiver`; the same through market purchases at the cap; the same mixed.
- **A trade racing a recycle** of the offered duplicates → never both; the last copy never recycled.
- **Partner removal racing an accept** → either the trade settles and then the offers are gone, or the offer is void and nothing moved.

**Property** (a seeded loop, no new dependency): 2 000 random sequences of up to 50 operations over 6 accounts (offers, accepts, declines, cancels, market listings and buys at random prices, recycles, clock jumps of up to 10 days), checking after every step: for every account, the gifts received in every 30-day window ≤ `GIFT_LIMIT_RECEIVER`, and from every other account ≤ `GIFT_LIMIT_PAIR`; every gift row matches the formula; balances equal their ledgers; no card is held by two accounts; `audit-ledger` and `audit-market` run clean (exit 0). A failing seed is printed and kept as a regression case.

**Adversarial** (`api/test/security/trades.security.test.ts`): an offer to oneself by every route; another account's `partnerId` or `offerId` → 404, nothing revealed; accepting one's own offer → 404; a forged body field → 400; a code-guessing burst → 429 after 30; numbers at and beyond every bound (`count` 0, 11, `1.5`, `"2"`, `1e400`; Karma −1, `MAX_ENTRY_AMOUNT + 1`; 11 cards a side); a hostile login (`<script>`, an RTL override, 24 combining marks) in every answer and in `audit-market`'s output; replay of each key across accounts; the route inventory equals the documented list.

**Audits**: `audit-ledger` fails on a hand-broken database for each new rule of §5.7 (a missing gift row, a wrong band, a trade missing a card, a fee row of the wrong account, a receiver over the limit) and passes on every suite's database; `audit-market` prints each new section on a fixture, `No findings.` on an empty one.

**Web** (T.1, T.3): unit tests for each state of §7 and the error mapping; the copy test over §11; the T1 hostile-name test for logins. **e2e on the stack** (`web/e2e/stack.spec.ts`, local only): two accounts make codes and become partners; A offers a card and 500 Karma for one of B's cards; B sees `Trades (1)` after a navigation, accepts, and both collections, both balances (fee included), `audit-ledger` and `audit-market` agree after a reload; A (with a fixture balance) builds a pure gift above the pair limit and sees the blocked line with `Send offer…` disabled; on the market, B buys a Mythic listed at the cap from A, and a second at the cap is refused with the gift line; a decline and a cancel; nothing in `localStorage`. Axe checks on `/trades`, `/trades/new` and the dialogs at 320 px and 1280 px.

## 13. Security notes (for `security-officer`)

### 13.1 Changed controls

- **C1** (state server-side): gifts, limits, fair prices and quotes are computed only in `api/src/domain/`; the quote is display, the accept recomputes everything under the locks; no request carries a value, gift, fee or band.
- **C3** (own data only): an offer is readable and actionable only by its two parties, each only in its role; `partnerId` is the caller's own row; a partner's cards are readable only by a partner; every miss is a 404 that reveals nothing.
- **C11** (ledger): `trade_debit`, `trade_credit` and `trade_fee` are written by `postEntry` in the accept's transaction; `CREDIT_KINDS` gains `trade_credit`; `audit-ledger` checks them (§5.7).
- **C20** (pack grants): a trade never touches the allowance, `free_packs_opened` or `packs_since_mythic`; a traded card has no opening and no slot, and does not reset the pity counter, as a bought card does not.
- **C22** (ledger audit): extended to trades and gift rows, including that no limit was exceeded.
- **C24** (market trust boundary): extended to personal trades: the fee on trade Karma (decision 2), the 7-day windows counting trade Karma, no self-trade, both accounts locked in ascending id order; and the buy path gains the gift check.

### 13.2 New controls

- **C25, gift limits**: every transfer between accounts records its gift (`transfer_gifts`, append-only); a transfer whose gift would take the pair past `GIFT_LIMIT_PAIR` or the receiver past `GIFT_LIMIT_RECEIVER` in 30 days is refused before anything moves; the sums are read under both parties' account locks, so concurrent gifts cannot overshoot; `audit-ledger` checks the bound after the fact.
- **C26, trade partners by code**: a player is reachable for offers only by someone who redeemed the code they made; a login is disclosed only to a partner; codes are 60 random bits, rate-limited, replaceable; removing a partner voids the offers between the two.

### 13.3 Threat model additions

- **Funnelling with gifts and with the band** (§3.7.1), at the numbers: the gift term ≤ 27 500 per 30 days per receiver; the band term bounded by the 7-day windows; card-for-card cycling inside the band not bounded by any limit (decision 3), detected by `audit-market`.
- **Information disclosure**: a `gift_limit` or `blocked` answer tells the other party that a receiver's limit is used up and when it frees, as `seller_proceeds` does on the market; the receiver's room is never sent to anyone else. `their_karma` tells a party the other cannot cover the offer.
- **Over-commitment and stale offers** (§3.3): an accept can fail; it never half-settles.
- **Spam and enumeration** (§5.8).

## 14. Build split

Each PR is shippable on `main` on its own, through the full gate, **all T3**.

| #       | Branch             | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Pts | Depends on |
| ------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------- |
| **T.1** | `feat/gift-limits` | Shared: the gift parameters, `fairPriceMin/Max`, `gift_limit` and `GIFT_LIMITS`. API: `gift.ts`, `gift-limits.ts`, the `transfer_gifts` migration with its backfill, the buy path's step 6a and gift row, `Listing.gift`, `KarmaRules` additions, `audit-ledger` (gift rows, limits) and `audit-market` (net fair value, near the limits, pure gifts). Web, small: the market's `Gift` fact, the buy confirmation's gift sentence, the `gift_limit` lines and the fair-price hint in the List section, so no released build ever shows the new refusal as a server failure. | 8   | —          |
| **T.2** | `feat/trades`      | API: the trades migration (codes, partners, offers, items, card columns, ledger kinds, rights, trigger and reset changes), `api/src/domain/trades/`, the routes of §5.6, the windows reading trade Karma, `Wallet.incomingOffers`, the sweep, `audit-ledger` and `audit-market` for trades (one-way band trading, quick accepts), the full test plan's server parts. No web change: nothing can reach the routes yet, and the route inventory pins them.                                                                                                                    | 13  | T.1        |
| **T.3** | `feat/trades-ui`   | Web: `/trades`, `/trades/new`, the section nav on `/market` and `/trades`, the Market item's count and `aria-current`, the wallet reads on navigation and `visibilitychange`, the routes list, the copy, the web and e2e tests.                                                                                                                                                                                                                                                                                                                                             | 8   | T.2        |

T.1 is useful alone: from it on, the market's own gifts are tracked and capped, which narrows §10's residual before personal trades exist. T.2 then adds the second channel already bounded. Each PR adds its own security-log file (`docs/security-log/README.md`), and none edits a shared register table: the manager's register-sync PR does (§17).

## 15. What this changes in other specs

These passages change **when the PR named here lands**; each PR edits the spec it touches. `economy.md` is changed only through §17's register edits.

| Spec and passage                                                                          | Change                                                                                             | PR  |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --- |
| `market-and-shop.md` §3.4 step 7, §3.5, §3.6, §8 (listing dialog, buy, My listings, copy) | §6's `Gift` fact, gift sentence, `gift_limit` lines, `Gift` on My listings rows                    | T.1 |
| `collection-overview.md` §3.5 (List on the market), §8                                    | §6's fair-price hint and confirmation sentences                                                    | T.1 |
| `market-and-shop.md` §2 "Seller names on listings" and §3.2 (pages)                       | Still no seller names on the market; the Market section gains `/trades` and its section nav (§4.1) | T.3 |
| `navigation-and-landing.md` §3.1 (the page list) and §3.5 (header links)                  | `/trades` and `/trades/new`; the Market item's `aria-current="true"` and count                     | T.3 |
| `visual-identity.md` §10.1 (page table) and §10.3 (tab bar)                               | rows for `/trades` and `/trades/new` (eyebrow `Player trades`); the Market item's count chip       | T.3 |

## 16. Owner decisions

**Owner, 2026-10-31: option A on all three** (13 750 per pair and 27 500 per receiver per rolling 30 days; the 5 % fee on Karma in personal trades, paid by the receiver; fair card swaps accepted and flagged by `audit-market`). The options as they were put:

1. **The gift limits.** **A (recommended)**: per pair **13 750**, per receiver **27 500**, per rolling 30 days: a Mythic at the market cap fits one pair's month (your rule for the market limits, applied to gifts), and the receiver limit is about 920 Karma a day, a fifth of an active player's income; the funnel falls from about 365 400 to about 121 800 a month in fair value, and §10's cap-price attack from 52 250 a week to 52 250 a month (§3.7.1). **B**: half (6 875 / 13 750): a Mythic could then sell for at most 20 625 to one buyer in a month, so the top of the market's range (up to 27 500) could never sell; the funnel falls to about 108 000. **C**: double (27 500 / 55 000): more room for generous friends; the funnel rises to about 149 300.
2. **A fee on Karma in personal trades.** **A (recommended)**: the market's 5 %, paid by whoever receives the Karma and destroyed, as a seller pays it: §10's "every Karma moved between accounts loses a twentieth" stays true, and personal trades are not a cheaper way round the market. **B**: no fee: a friend's 1 000 Karma arrives as 1 000; the funnel bound rises to about 133 600 a month, and a Karma round trip between two accounts costs nothing.
3. **Cards pooled by many fair trades.** A fair band means two accounts can trade cards back and forth, each trade fair, and move one account's cards to the other over about twenty trades with no gift counted (§3.7.1). Karma stays bounded either way. **A (recommended)**: accept it, as the band's price: it moves only cards the other accounts pulled themselves, the roster is ten invited players, and `audit-market` lists such pairs for you to act on. **B**: also cap the cards (at reference prices) an account receives through personal trades at 55 000 per 7 days, which stops the cycling at about 11 000 a week but can also stop a big fair swap (five Mythics for five Mythics uses the whole week).

The trade-partner design (§3.4, trade codes), checking at acceptance instead of escrow (§3.3) and the notification model (§3.5) are this spec's recommendations, not questions; the owner may still overrule any of them.

## 17. Register edits

Exact text for the manager's register-sync PR. Anchors are quoted text, not line numbers, because the Karma upgrades spec (ADR 0015) edits `economy.md` §5, §9 and §10 at the same time; where both touch one table, both rows go in.

### 17.1 `docs/design/economy.md`

**Header paragraph**, after "as amended by ADR 0013 (six tiers, no franchise packs),": insert "and ADR 0016 (personal trades and gift limits, `personal-trades.md`),".

**§2 Out of scope**, replace the bullet "- Card-for-card trades (roadmap item 7). The market is cards for Karma." with:

> - Personal trades between two accounts, cards and/or Karma for cards and/or Karma: `personal-trades.md` (ADR 0016). The market stays cards for Karma; both are bounded by the gift limits (§10).

**§4 Ground rules**, in the row "Earned by recycling duplicates…", replace "Credits: `recycle_credit`, `market_sale`. Debits: `shop_purchase`, `market_purchase`, `market_fee`, `owner_reset`." with "Credits: `recycle_credit`, `market_sale`, `trade_credit`. Debits: `shop_purchase`, `market_purchase`, `market_fee`, `trade_debit`, `trade_fee`, `owner_reset`." In the row "Cards for Karma between server accounts on a player market…", append to the second cell: "; personal trades between trade partners (`personal-trades.md` §5.3), any card the last copy included".

**§5 Parameters**, append these rows to the table after `MARKET_SEARCH_TERMS`:

> | `GIFT_BAND_BPS` | 2 500 | the fair band: the larger side of a transfer may exceed the smaller by up to 25 % of the smaller with no gift (`personal-trades.md` §3.6, ADR 0016) |
> | `GIFT_WINDOW` | 30 days, rolling | the window of the two gift limits |
> | `GIFT_LIMIT_PAIR` | 13 750 | gifts one account receives from one other per window: the gift of one Mythic at the market cap (owner decision, `personal-trades.md` §16) |
> | `GIFT_LIMIT_RECEIVER` | 27 500 | gifts one account receives from all others together per window; not raised by any upgrade (ADR 0016 decision 6) |
> | `TRADE_MAX_CARDS`, `TRADE_OFFER_TTL`, `TRADE_MAX_OPEN_OFFERS`, `TRADE_MAX_OPEN_PER_PARTNER`, `TRADE_OFFERS_PER_DAY` | 10, 3 days, 20, 3, 50 | personal trades (`personal-trades.md` §5.1) |

and append to the invariants paragraph: "`gift(MARKET_PRICE_MAX.mythic, REFERENCE_VALUE.mythic) ≤ GIFT_LIMIT_PAIR ≤ GIFT_LIMIT_RECEIVER`; `MARKET_PRICE_MIN[r] ≤ fairPriceMin[r] ≤ REFERENCE_VALUE[r] ≤ fairPriceMax[r] ≤ MARKET_PRICE_MAX[r]` (`personal-trades.md` §3.6.2)."

**§5.2**, append after the table: "**Fair prices** (ADR 0016): a sale carries no gift from `fairPriceMin` to `fairPriceMax`: Common 8–12, Uncommon 19–28, Rare 28–43, Epic 128–200, Legendary 800–1 250, Mythic 8 800–13 750. At the floor a sale is a gift to its buyer of 4 / 8 / 13 / 60 / 375 / 4 125; at the cap a gift to its seller of 13 / 29 / 44 / 200 / 1 250 / 13 750 (`personal-trades.md` §3.6.2)."

**§7 Data model**, in `ledger_entries`, replace the `kind` comment's enum list with "enum: recycle_credit, shop_purchase, market_purchase, market_sale, market_fee, owner_reset, trade_debit, trade_credit, trade_fee (items 5, 6 add wager, payout)", and append after the `characters`/`series` blocks: "`transfer_gifts`, `trade_partners`, `trade_offers`, `trade_offer_items`, `accounts.trade_code`, `cards.trade_offer_id` and `cards.removed_by_trade`: `personal-trades.md` §5.2."

**§8.5 Buying**, insert after step 6:

> 6a. The gift (ADR 0016, `personal-trades.md` §3.6, §6): the gift of the price against `REFERENCE_VALUE[rarity]`; if it is above 0, the pair's and the receiver's gifts over the last `GIFT_WINDOW`, including this one, must fit `GIFT_LIMIT_PAIR` and `GIFT_LIMIT_RECEIVER` → else 409 `gift_limit` with `limit` (`gift_pair` first, then `gift_receiver`), `gift` and `retryAfterSeconds` (absent when the gift exceeds the limit itself).

and in step 8 after "the listing `sold`" insert "; the purchase's `transfer_gifts` row".

**§8.9 Concurrency**, replace "account rows first, in ascending id order when there are two; then listing rows; then card rows; then the ledger." with "account rows first, in ascending id order when there are two; then listing rows; then offer rows; then card rows; then the ledger; then gift rows (`personal-trades.md` §5.4)." and add "a trade's acceptance (both accounts, offer, cards)" to the list of paths.

**§9.3 Sinks**, replace "- **The market fee**: 5 % of every sale's price destroyed (at least 1)." with "- **The market fee**: 5 % of every sale's price destroyed (at least 1), and the same on the Karma of every personal trade, paid by its receiver (`personal-trades.md` §3.8)."

**§10 Anti-farming**, in the table: append to the Fee row's rule "; also on the Karma of a personal trade, paid by whoever receives it"; append to the Window limits row's rule "; Karma paid in personal trades counts in the spend, the proceeds and the pair, not in the purchase count"; and add two rows after Pair limit:

> | Gift limits (C25) | every transfer's gift, the part of the difference between the sides beyond 25 % of the smaller side at reference values, counts per rolling 30 days: at most 13 750 from one account to another, 27 500 to one account from all (ADR 0016) | Karma drawn into a main by selling cheap cards at the cap: at most 52 250 per 30 days (1.9 × 27 500); net fair value by any strategy about 121 800 per 30 days |
> | Trade partners (C26) | a personal trade needs a partner added with the code its owner gave out; no route lists or names other accounts | offers only between players who chose each other |

and replace the paragraph starting "**Residual risk, plainly.**" with:

> **Residual risk, plainly.** The server cannot tell two people from one person with two accounts. In Karma alone, the 7-day windows still let 52 250 net per seven days into one account, but since ADR 0016 only fairly priced: a sale more than a quarter above its reference value carries a gift, and gifts into one account are capped at 27 500 per 30 days from all others together, so selling cheap cards at the cap now moves at most 52 250 per 30 days, not per 7. Counting cards at their reference value, one account can draw about 121 800 per 30 days from all others (gifts 27 500; trades inside the band about 35 400 on sales and 58 900 on purchases), against about 365 400 before. What the gift limits cannot bound is cards moved by many card-for-card trades inside the band, which no window counts; they are cards the other accounts pulled themselves, `audit-market` reports such pairs, and the owner chose how to treat them (`personal-trades.md` §16, decision 3). Detection is after the fact and heuristic, and the remedy is the owner's. The roster is capped (`ACCOUNT_CAP`, 10) and every account comes from an invite the owner hands out, which is the real control.

**§11.1 Error codes**, append: "ADR 0016 adds `gift_limit` (409), `offer_limit` (409), `offer_invalid` (400), `offer_not_found` (404), `offer_unavailable` (409), `offer_changed` (409), `partner_not_found` (404), `trade_code_invalid` (404) and `own_trade_code` (409); `limit` widens to the gift limits (`gift_pair`, `gift_receiver`) and the offer limits (`offers_open`, `offers_partner`, `offers_day`), and `gift_limit` carries `gift` (`personal-trades.md` §5.6)."

**§11.2 Schemas**, append after `CollectionEntry`: "`KarmaRules` gains `gift { bandBps, pairLimit, receiverLimit, windowSeconds }`, `fairPriceMin` and `fairPriceMax`; `Wallet` gains `incomingOffers`; `Listing` gains `gift: { amount, to: "buyer" | "seller" } | null`. The trade schemas are `personal-trades.md` §5.6."

**§11.3 Routes**, append to the buy row's errors "409 `gift_limit`", and after the table: "The trade routes are `personal-trades.md` §5.6."

**§13.1 `audit-ledger`** and **§13.3 `audit-market`**, append to each: "Extended for gifts and personal trades by `personal-trades.md` §5.7."

**§16 Decision record**, append a section:

> **Personal trades and gift limits** (owner, 2026-10-31, ADR 0016; `personal-trades.md`):
>
> | #   | Decision (Owner, 2026-10-31)                                                                                                                                                         | Where          |
> | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
> | 1   | Personal trades: cards and/or Karma for cards and/or Karma between two accounts, accepted or declined, settled at once or not at all.                                                | §2, §4         |
> | 2   | Every transfer between players, the market included, has a gift value beyond a fair band of about 25 % (set at 25 % of the smaller side); a pure gift counts in full.                | §5, §5.2, §8.5 |
> | 3   | Two limits on gifts received: per pair and per receiver.                                                                                                                             | §5, §10        |
> | 4   | A rolling 30 days.                                                                                                                                                                   | §5             |
> | 5   | At a limit only unfair transfers are refused.                                                                                                                                        | §8.5           |
> | 6   | The market's controls stay; personal-trade Karma counts in the 7-day windows; the gift limits are not upgradable.                                                                    | §10            |
> | 7   | The numbers (`personal-trades.md` §16): limits 13 750 / 27 500 (question 1), the fee on trade Karma (question 2), the card-cycling residual (question 3), as the owner answers them. | §5, §9.3, §10  |

### 17.2 `docs/02-roadmap.md`

Add after row M-ui:

> | T | Personal trades and gift limits | 29 | T3 | specced | | `docs/design/personal-trades.md`, ADR 0016 | Three PRs, each ≤ 13: T.1 market gift check (8), T.2 trades server (13), T.3 trades web (8); gifts capped per pair and per receiver over 30 days; trade partners by code |

If the manager prefers rows of at most 13 points as the scale asks, these three instead:

> | T.1 | Gift limits on the market | 8 | T3 | specced | | `docs/design/personal-trades.md` §6, ADR 0016 | `transfer_gifts`, the buy path's gift check, market UI lines |
> | T.2 | Personal trades, server | 13 | T3 | specced | | `docs/design/personal-trades.md` §5, ADR 0016 | Codes, partners, offers, accept transaction, audits; after T.1 |
> | T.3 | Personal trades, web | 8 | T3 | specced | | `docs/design/personal-trades.md` §4, §7–§11 | `/trades`, `/trades/new`; after T.2 |

And in row 7 ("Trade between local profiles"), replace the note "Replaced by the player market (row M, ADR 0011)" with "Replaced by the player market (row M, ADR 0011) and personal trades (row T, ADR 0016)".
