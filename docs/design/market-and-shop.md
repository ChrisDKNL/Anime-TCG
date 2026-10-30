# Market and Karma shop (UI)

Roadmap item 2, the two UI PRs of `docs/design/economy.md` §3 (`feat/economy-ui`: the balance and the shop; `feat/market-ui`: browse, buy, my listings) · pages `/shop` and `/market` (`navigation-and-landing.md` §3.1, shipped in #30) · server: `economy.md` §8, §11, §12 · [ADR 0011](../adr/0011-economy-revised-karma-market-snapshot.md) · companion of `docs/design/collection-overview.md` · written 2026-10-29 · revised 2026-10-30: a bought pack opens on its own page, `/shop/open` (§3.3 step 6, `navigation-and-landing.md` §3.13), (owner, 2026-10-30: `navigation-and-landing.md` §9.2 question 1, option A)

> **Why a second spec.** The collection overview is one screen around one read, the account's own collection, paged in the browser. The shop and the market are two new pages, `/shop` and `/market`, each around reads of their own (`GET /api/shop`; the server-paged `GET /api/market/listings`; `GET /api/market/mine`), and they ship in different PRs from the overview's. One file would make one spec span four PRs and two paging models. Listing a card and recycling duplicates for Karma stay in the overview's card dialog (`collection-overview.md` §3.5, §3.6), because their input is one collection entry. This spec reuses the overview's patterns by reference (the confirmation, in-flight and failure rules of §3.5 step 9, the tile of §6.2, the rarity system of §6.1, the copy rules of §8) and adds only what is new.
>
> Written against `economy.md` at 9a3e059 and `collection-packs.md` at 0ce69bd, with the owner's final answers of 2026-10-29 (`collection-overview.md` §9.1). **Reconciled 2026-10-29** with what is on `main`: 1c as shipped in #28 (six tiers, slot floors, Enchanted, Radiant and pity), `economy.md` as landed in 0562e10, and the changes `navigation-and-landing.md` §10 assigns to this spec (#30: pages at their own addresses, header links instead of tabs, no query string, focus and titles per page). **Revised 2026-10-29** to `economy.md` at 64b20f9 and ADR 0013: the economy's numbers are re-derived for six tiers, and there are no franchise packs (owner, 2026-10-29: "Cut franchise packs, only have themed packs that contain cards from all franchises."), so every themed pack is a genre theme and a theme has no kind. The amounts come from the server, so they appear as placeholders: `<pack price>`, `<min T>`, `<max T>`, `<feePct>` (`collection-overview.md` §3.9).

## 1. Goal

A signed-in player sees their Karma in the header, buys themed packs on the Shop page (`/shop`) with the price and the odds in plain view, and on the Market page (`/market`) browses other players' cards, buys one for Karma and manages their own listings. The server holds every price, fee, limit and outcome (ADR 0008); the UI shows them and sends requests. No real money anywhere, no store iconography, no nudges (ADR 0004 §6, `economy.md` §12).

## 2. Out of scope

- Listing a card and recycling duplicates for Karma (`collection-overview.md` §3.5, §3.6).
- Upgrades to a higher tier: only in the mini-games (items 5 and 6).
- The free pack control, its countdown and the reveal grid (the 1c web PR, `collection-packs.md` §8, on the `/packs` and `/packs/open` pages). This spec reuses the grid for shop packs and adds nothing to the free pack's reveal (§3.1 step 5).
- A Karma history and the profile (roadmap 4).
- Price history, charts, "lowest price" or "popular" badges, recommendations, watchlists, and any notice when a listing sells. A seller sees a sale in My listings and in the balance; nothing calls them back.
- Changing a listing's price (no route: cancel and list again), bulk buying or cancelling.
- Seller names on listings (`Listing` carries none).
- How many of a theme's characters the player owns. The server sends no such figure, and the UI computes no completion.
- Masterwork and Relics (`collection-overview.md` §2).

## 3. Flow

### 3.1 Karma in the header

1. While signed in, the header shows the balance as `1,240 Karma`, beside the Account control.
2. Source: `GET /api/wallet` at sign-in and whenever the Shop, Market or Collection page is shown. Every `balance` in an answer replaces it: `ShopReceipt`, `RecycleReceipt`, `PurchaseReceipt` and the `balance` on `insufficient_funds`. It is never computed and never polled. A sale of one of the player's listings shows up at the next of those fetches.
3. Before the first answer the element is empty (it reserves no space). If the first fetch fails, the header shows nothing; actions that need the balance show their stale reasons. With a value held and a refetch failing, the held value stays.
4. The balance is plain text: not a button, not a link, not a live region. The status line of the action that changed it carries the new number.
5. **The free pack grants no Karma** (`economy.md` §16, round 3, decision 3: recycling duplicates is the source; `PackOpened` has no Karma field, `shared/src/api.ts`). The free pack's reveal therefore has no Karma line, and opening a free pack does not change the balance.

### 3.2 Pages and header links

1. **Links**: `Packs` · `Shop` · `Market` · `Collection (<N>)`, the header's page links for `/packs`, `/shop`, `/market` and `/collection` (`navigation-and-landing.md` §3.5 step 2; `Booster` is renamed `Packs` to match its path). Each is a real link; the current page's carries `aria-current="page"`, and activating it does nothing. A link appears in the PR that builds its page: `Shop` with `feat/economy-ui` (the links read `Packs` · `Shop` · `Collection (<N>)` until the market ships), `Market` with `feat/market-ui`. Before then the path is the not-found page, with no link and no "coming soon" (`navigation-and-landing.md` §3.1 rule 1).
2. **The shop is a page of its own**, not a section under the free pack, so the free pack's waiting state never sits next to a Karma price; the Packs page never mentions the shop (decided by the owner, 2026-10-29, as "its own Shop tab").
3. **Titles and focus** (`navigation-and-landing.md` §3.6): arriving by a link, Back or Forward sets the title (`Shop · Anime TCG`, `Market · Anime TCG`) and then moves focus to the page's visible `h1` (`Shop`, `Market`), which is rendered from the start, in the loading and error states too. A load or reload sets the title and moves no focus. A signed-out visitor is sent to `/login` with the page as the return path.
4. **No address state.** The app never reads or writes a query string or hash (`navigation-and-landing.md` §3.1 rule 2). The market's view, search, filters, sort and character filter live in the signed-in layout's state (`navigation-and-landing.md` §3.10): they survive moving between pages and reset on reload and log out. `ListingsQuery` is the request's parameters to the API, never the page's address.
5. **`/shop/open`** is the bought pack's own page (owner, 2026-10-30: "Opening packs should also have their own route"; applied to shop packs by the owner, 2026-10-30, `navigation-and-landing.md` §9.2 question 1). Its routing (push, replace with `/shop`, Back, Forward, the guard, the header link) is `navigation-and-landing.md` §3.13; what it shows is §3.3 step 6.
6. **Dialogs are not history entries.** Back with a confirmation or the listing dialog open leaves the page; the dialog closes with it, an in-flight request finishes and its result applies to the layout's state (`navigation-and-landing.md` §3.10 item 4).

### 3.3 Shop

1. Showing the page fetches `GET /api/shop` and the wallet. First load: the 300 ms rule and skeleton of `collection-overview.md` §3.1; held data shows at once and refetches silently.
2. The themes are listed in the server's order: one genre pack for every eligible genre (each of the theme's six tiers holds at least `PACK_SIZE`, five, characters), which the shop offers on its own. Every themed pack draws from all franchises; there are no franchise packs (owner, 2026-10-29; `economy.md` §8.6, ADR 0013). Each theme shows: its title; its series (`franchiseIds` through `ShopResponse.franchises`; the first three, then `and <N> more` revealing the rest in place); the headline odds, the chance of at least one card of each tier per pack, from `odds.perPack` over `odds.scale` (`At least one per pack: Common <x>% · Uncommon <x>% · Rare <x>% · Epic <x>% · Legendary <x>% · Mythic <x>%`); a disclosure `Odds per card` (a native `<details>`) that shows the share of the pack's cards per tier (`Each card: Common <x>% · …`; 1c's per-tier `share`, which `ThemeOffer.odds` does not carry yet, §3.8 E8) and the characters per tier from `odds.tierSizes` (`Drawn from <n> Common, <n> Uncommon, <n> Rare, <n> Epic, <n> Legendary and <n> Mythic characters.`); the special-pack lines, which follow 1c's rule for shop packs (`collection-packs.md` §5.4.7, `card-and-rarity.md` §7.2): the Radiant sentence of `card-and-rarity.md` §7.1, then `Shop packs don't count toward Enchanted packs or the guarantee.`; the price, `<pack price> Karma` (about 2.3 times the expected reference value of a shop pack's cards, `economy.md` §5, re-derived for six tiers); and `Buy…`. Percentages use `Intl.NumberFormat("en-GB", { style: "percent", maximumSignificantDigits: 3, roundingMode: "trunc" })`, so small figures keep their digits (`0.25%`, `0.05%`) and a figure below 100 % never reads `100%` (99.9704 % reads `99.9%`).
3. `Buy…` is disabled, with the reason under it, when the balance is below the price. Not authoritative; the server checks again.
4. `Buy…` opens the **pack confirmation**: a native `<dialog>` in the Manage account shell. Heading `Buy the <title> pack?`; body naming the price, the number of cards (`ThemeOffer.cards`), that they come from this pack's characters at the odds shown, the balance, and that there is no undo. `Buy for <price> Karma` and `Cancel`.
5. The confirm button sends `POST /api/shop/buy` with `requestId` and `themeId`, nothing else. The request id follows `collection-overview.md` §3.8. In flight: `Buying…`, with the button, `Cancel` and Escape disabled.
6. Answers:
   - **201, or 200 on a replay**: the dialog closes and the app **pushes `/shop/open`** (revised 2026-10-30; until then the reveal opened at the top of `/shop`). Title `Shop pack · Anime TCG`; focus on its `h1` `Shop pack` (`navigation-and-landing.md` §3.6). The page shows, top to bottom: the `h1`; the link `Back to the shop`; the reveal section: heading `<title> pack` (an `h2`), the pull summary, the Radiant line of `card-and-rarity.md` §7.1 when `receipt.pack.packKind` is `radiant` (the heading stays `<title> pack`), and the 1c reveal grid with the receipt's cards in slot order with `isNew`, with the entrance. The header takes `receipt.balance`; the collection is marked stale; the live region reads `Bought the <title> pack for <price> Karma. You have <B> Karma.` once, after the page change.
   - **On `/shop/open`** there is no buy control: buying again goes through `/shop` and its confirmation, so a Karma spend always starts from the price and the odds. The bought pack is held in the signed-in layout until another pack is bought, log out, session end or reload. Back returns to `/shop`, which shows the themes and, while a pack is held, the text link `See your latest shop pack` under its `h1`; Forward or that link shows the held cards without the entrance. A load or reload of `/shop/open`, or an address typed there, with nothing held replaces it with `/shop`.
   - **`insufficient_funds`**: the confirmation stays, the red line reads `This pack costs <price> Karma. You have <B> Karma.` (B from the error's `balance`, which also replaces the header's) and the confirm button is disabled.
   - **`theme_unavailable`**: the dialog closes, the shop is refetched, and the page shows the neutral notice `That pack is no longer in the shop.`
   - **`pool_unavailable`**: the red line `There are no cards to draw from right now. Nothing changed.`
   - **Rate limited, any other answer, no answer, `unauthenticated`**: as `collection-overview.md` §3.5 step 9. `Try again` resends the same `requestId`, so a lost answer shows the pack that was dealt instead of buying a second; `Cancel` discards the key, refetches the wallet and marks the collection stale (cards that were dealt are in the collection).
7. No themes offered, or no snapshot: `No packs in the shop.`

### 3.4 Market: browse

1. The Market page has two views, `Browse` (default) and `My listings`, switched like the collection's Cards and Series (`collection-overview.md` §3.2 step 5).
2. Browse asks `GET /api/market/listings` with the toolbar's parameters and shows the first page; `Show more` asks for the next page with `nextCursor` and appends it. There is no total count, so the results line counts what is shown.
3. Toolbar:
   - **Search** → `q`: the trimmed text, sent 300 ms after the last keystroke; empty means no `q`; at most 100 characters. The server normalises as `collection-overview.md` §3.3 does (`economy.md` §8.4).
   - **Rarity** → `rarity`: a select, `All rarities` then the six tiers. The server takes one tier per request, so this is not the collection's multi-select chip row.
   - **Series** → `franchiseId`: `All series`, then the franchises in the first page's `filterFranchiseIds` (every franchise with an active listing, in popularity order), titles through the page's `franchises`. A selected series stays in the list while selected, even after its last listing goes.
   - **Sort** → `sort`: `Lowest price first` (`price_asc`, default), `Highest price first` (`price_desc`), `Newest first` (`newest`).
   - **Character** → `characterId`: set only by `See <name> on the market` in the card dialog, which sets it in the signed-in layout's state and pushes `/market` (`collection-overview.md` §3.5). It shows as the line `Showing <name> only.` with `Show all`, which clears it.
   - `Clear filters` resets search, rarity, series and character, not the sort.
4. Every change asks for the first page again and replaces the list; an answer to an older set of parameters is discarded (the request is aborted). A listing already shown is not shown twice if a later page repeats it.
5. Each listing is the collection tile (`collection-overview.md` §6.2): the card (`card-and-rarity.md`, by the listing's rarity; its rank chip's pool size from a held `SnapshotInfo`, `card-and-rarity.md` §6.2, since `ListingsPage` carries none, §3.8 E9) with a caption under it showing `<price> Karma` on the left and `Until <D Mon>, <HH:MM>` on the right, or `Yours` for the player's own listings (`mine: true`).
6. The list is bounded: at most `ACCOUNT_CAP` × `MARKET_MAX_LISTINGS` listings exist (10 × 50 = 500), so at most ten pages. `Show more` disappears when `nextCursor` is null.
7. Activating a tile opens the **listing dialog**: the card dialog's shell and layout with the card at dialog size (`card-and-rarity.md` §3.2), name, native name, series and `Also in`; facts `Rarity`, `Price`, `Until`; a line `In your collection: <Rarity> ×<N>` for each of the player's entries of this character, or `Not in your collection.`, from the held collection answer; then `Buy…`, or for the player's own listing `This is your listing.` and `Cancel listing` (§3.6 step 3).

### 3.5 Market: buy

1. `Buy…` is disabled, with the reason under it, when the balance is below the price. Not authoritative.
2. `Buy…` replaces the dialog body with the **buy confirmation**: heading `Buy <name> for <price> Karma?`; body naming the rarity, the balance and that there is no undo. `Buy for <price> Karma` and `Cancel`.
3. The confirm button sends `POST /api/market/listings/{listingId}/buy` with `requestId` only. **The request carries no price**: the server holds the listing's price (`economy.md` §8.5), and the number on the button is display. In flight: `Buying…`, with the usual disabling.
4. Answers:
   - **201, or 200 on a replay**: the dialog body becomes the result: the bought card at dialog size (`card-and-rarity.md` §3.2), heading `<name> is in your collection`, the tier word with its stars, `New` when `card.isNew`, and `Bought for <price> Karma. You have <B> Karma.` (from the receipt), then `Close`. The header takes `receipt.balance`; the listing leaves the browse list; the collection is marked stale.
   - **`listing_unavailable`** or **`listing_not_found`**: `This card is no longer on the market.` and `Close`; the listing leaves the browse list.
   - **`market_limit`**: a red line chosen by the error's `limit`, with the time from now + `retryAfterSeconds` (which can be days away, so the line names the date): `buyer_purchases` and `buyer_spend`, `Your market limit for the last <window> is used up. It frees up on <D Mon> at <HH:MM>.`; `seller_proceeds`, `This seller can't take more sales right now. Try again on <D Mon> at <HH:MM>.`; `pair`, `You've bought as much from this seller as the market allows for now. Try again on <D Mon> at <HH:MM>.` The confirm button stays disabled until then. `<window>` is `rules.window.seconds` in days (`7 days`).
   - **`insufficient_funds`**: the red line `This card costs <price> Karma. You have <B> Karma.`, B from the error's `balance`, which also replaces the header's.
   - **`own_listing`**, **`request_id_reused`**: never expected (the UI offers no buy on its own listings, and keys are fresh); shown as the server failure.
   - **Rate limited, any other answer, no answer, `unauthenticated`**: as `collection-overview.md` §3.5 step 9; `Try again` resends the same `requestId`; `Cancel` discards it, refetches the wallet and the first page, and marks the collection stale.

### 3.6 Market: My listings

1. The view fetches `GET /api/market/mine` and the wallet when shown, and `mine` again after a cancel.
2. It shows four parts, top to bottom:
   - **On the market, `<n>` of `<max>`** (`rules.maxListings`): each active listing as a row with a thumbnail, name, rarity word, `<price> Karma`, `Fee <fee> Karma · you get <net> Karma` (`fee` from the listing, net = price − fee), `Until <D Mon>, <HH:MM>`, and `Cancel listing`. Empty: `Nothing on the market.`
   - **Market limits, last `<window>`** (rolling, `rules.window.seconds`), always shown, from `left`: `You can buy <purchases> more cards and spend <spend> more Karma, and receive <proceeds> more Karma from sales.` No warning colour and no change in wording as the numbers fall.
   - **Closed in the last 30 days**: each row with its status: `Sold for <price> Karma · you got <proceeds> Karma`, `Cancelled` or `Expired`, and the date from `closedAt`. Empty: `Nothing in the last 30 days.`
   - **Bought in the last 30 days**: name, rarity word, `<price> Karma`, `<D Mon YYYY>` from `boughtAt`. Empty: `Nothing in the last 30 days.`
3. **Cancel** needs no confirmation: the card comes back to the collection at once and can be listed again. `POST /api/market/listings/{listingId}/cancel` with `{}`; the row's button reads `Cancelling…` and is disabled. Answers:
   - **200**, status `cancelled`: status line `Listing cancelled. <name> is available again.`; `mine` refetched; collection marked stale. Status `expired`: `That listing had already ended.`
   - **`listing_unavailable`** (it sold first): `It sold before the cancel arrived.`; `mine` and the wallet refetched.
   - **`listing_not_found`**: `That listing is gone.`; `mine` refetched.
   - **No answer**: the red line `Couldn't reach the game server, so this may not have gone through.` and `Try again`, which resends the cancel; cancel is idempotent on the server (`economy.md` §8.5), so this is safe.
   - **Rate limited, other failures, `unauthenticated`**: as `collection-overview.md` §3.5 step 9.

### 3.7 What the UI needs from the server

Against `economy.md` at 64b20f9 (six tiers, no franchise packs, ADR 0013) and 1c as shipped in #28. ✓ means it is there as needed; Ex refers to §3.8.

| Screen         | Needs                                                                   | Field                                                                                                                                                   | Status |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Header         | Balance                                                                 | `Wallet.balance`; then every receipt's `balance` and the `balance` on `insufficient_funds`                                                              | ✓      |
| Shop           | Themes with title, series, card count, price, odds, tier sizes          | `ShopResponse.themes[]` (`id`, `title`, `cards`, `franchiseIds`, `price`, `odds.scale`, `odds.perPack`, `odds.perSlot`, `odds.tierSizes`), `franchises` | ✓, E8  |
| Shop           | Rank chip's pool size                                                   | `ShopResponse.snapshot.characterCount`                                                                                                                  | ✓      |
| Shop buy       | Receipt: the pack, the price, the balance                               | `ShopReceipt.pack` (`PackOpened`), `price`, `balance`                                                                                                   | ✓      |
| Browse         | Listings with character, rarity, price, expiry, own flag; the next page | `ListingsPage.listings[]` (`listingId`, `character`, `rarity`, `price`, `expiresAt`, `mine`), `franchises`, `nextCursor`                                | ✓      |
| Browse         | Filter by rarity, series, character, text; sort                         | `ListingsQuery` (`rarity`, `franchiseId`, `characterId`, `q`, `sort`, `cursor`)                                                                         | ✓      |
| Browse         | The series options                                                      | `ListingsPage.filterFranchiseIds` (first page)                                                                                                          | ✓      |
| Browse         | Rank chip's pool size                                                   | — (`ListingsPage` has no `SnapshotInfo`)                                                                                                                | E9     |
| Listing dialog | The player's copies of the character                                    | the held `CollectionResponse.entries[]`                                                                                                                 | ✓      |
| Buy            | Receipt: card, price, balance                                           | `PurchaseReceipt.card`, `price`, `balance`                                                                                                              | ✓      |
| Buy            | Which limit was hit, and when it frees up                               | `market_limit` with `limit` and `retryAfterSeconds`; `rules.window.seconds`                                                                             | ✓      |
| My listings    | Active, closed with proceeds and dates, purchases, room left            | `MarketMine.active`, `closed[]` (`proceeds`, `closedAt`), `purchases`, `left`                                                                           | ✓      |
| My listings    | The listing cap                                                         | `Wallet.rules.maxListings`, `Wallet.activeListings`                                                                                                     | ✓      |
| Cancel         | The listing's new state                                                 | `Listing.status`                                                                                                                                        | ✓      |

The amounts on these screens (`<pack price>`, the bounds, the fee) are `collection-overview.md` §3.9's dependencies.

### 3.8 Mismatches with the server specs

All six mismatches of this spec's first version (S1 to S6: `closedAt`, the `limit` on `market_limit`, the pack size, a genre theme's series, the series filter's list, expired listings in `mine`) are resolved in `economy.md` at 9a3e059. The three of the previous revision are settled in `economy.md` as landed in 0562e10: **E4**, the market fee (`MARKET_FEE_BPS` 500, 5 %, §5); **E6**, genre packs offered automatically for every eligible genre as `genre-<slug>` (§8.6, §13.2), since 64b20f9 the only themes: the franchise packs, `pack-themes` and `ThemeOffer.kind` are gone (ADR 0013); **E7**, the themed pack price at about 2.3 times the expected reference value of a pack's cards (`THEMED_PACK_PRICE` 400, §5, re-derived for six tiers at 64b20f9: 2.34 times a shop pack's 170.79, §9.1). What remains, against 1c as shipped in #28 and `economy.md` at 64b20f9:

| #   | Mismatch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | This spec meanwhile                                                                                           | Asked of `economy.md`                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| E8  | **The shop's odds carry no per-card share.** At 64b20f9 `ThemeOffer.odds` is six-tier and carries 1c's five slot tables with their floors (`perSlot`), `perPack` (at least once per pack: Common 99.97 %, Uncommon 100 %, Rare 80 %, Epic 17 %, Legendary 2.75 %, Mythic 0.25 %), `tierSizes` and `radiant` (§8.6, §11.2); the price and the eligibility (each of six tiers ≥ `PACK_SIZE`) are re-derived for six tiers. It has no per-tier share of the pack's cards, which 1c's `PublishedOdds` carries as `share` (`collection-packs.md` §5.4.1) and the `Odds per card` line shows | Reads `perPack` and `tierSizes`; shows the per-card line from whatever per-tier share the theme publishes     | Add 1c's `share` (six tiers) to `ThemeOffer.odds`, as in `PublishedOdds`                                          |
| E9  | **No pool size on the market.** `ListingsPage` carries characters but no `SnapshotInfo`, so a listing's rank chip has no pool size unless another answer holding one is cached                                                                                                                                                                                                                                                                                                                                                                                                         | The chip shows `#0012 / <count>` from any held `SnapshotInfo`, else `#0012` alone (`card-and-rarity.md` §6.2) | `ListingsPage.snapshot: SnapshotInfo \| null`, or a statement that the market's rank chip may show the rank alone |

**Settled for `feat/economy-ui`** (manager decision, 2026-10-30), where this spec was silent or waited on E8:

- **E8 meanwhile**: until `ThemeOffer.odds` carries a per-tier `share`, `Odds per card` holds the slot floors line of the odds page (`Cards 1 to 3: Common or better. …`, from `perSlot`) and the tier sizes line; there is no `Each card:` line, and the UI derives no share from the slot tables.
- **Before the wallet's first answer**, and while it is failing, `Buy…` is disabled with the stale reason, as the stale state.
- **Focus**: `Cancel` or Escape returns focus to the `Buy…` that opened the confirmation; after `theme_unavailable` it goes to the notice `That pack is no longer in the shop.` (`tabindex="-1"`).
- **`insufficient_funds` without `balance`** (no current server sends one): the red line names the balance the page holds, which is the server's last.
- **Leaving the page with the confirmation open** closes it as `Cancel` does: its `requestId` goes with it. The next showing of Shop or Collection reads the wallet and the collection again, so a purchase whose answer was lost shows up there.

**After the hunt on #51** (manager decisions, 2026-10-30):

- **The 429 wait lives on the Shop page**, not in the confirmation: it survives `Cancel` and re-opening, as the recycle's does in the card dialog. `Cancel` still discards the `requestId`; the first try after the wait is a new request.
- **A successful wallet read (200) clears the unreachable banner**, as any other answer from the server does.
- **Wallet ordering**: a balance from a receipt (or from `insufficient_funds`) is newer than every `GET /api/wallet` sent before that answer arrived, so a read in flight when the receipt lands cannot overwrite it; a read sent after it replaces it.
- **Nothing closes the confirmation while a purchase is in flight**, whatever closes it (Chromium lets a second Escape close a `<dialog>` without a cancelable `cancel` event): it opens again at once. `Cancel` and Escape close the dialog first and then return focus to `Buy…`, since a modal dialog's page is inert.

**Settled for `feat/market-ui`** (manager decision, 2026-10-30), where this spec was silent; where it was silent on Karma or idempotency, the shop's rules above apply:

- **Keys**: a market purchase follows the shop's key rule (`useKeyedAction`): kept on no answer and on a 429, discarded on every other answer, on `Cancel`, on close and on unmount. The 429 wait lives on the Market page, shared by buying and cancelling, and survives `Cancel` and reopening. `Cancel` after no answer reads the wallet, the first page and the collection again. Cancelling a listing carries no key (the server's cancel is idempotent); after no answer the row's button reads `Try again` and resends it, after a 429 it counts down, and any other failure shows the server failure banner.
- **`market_limit`** is held on the Market page: the buyer's own limits (`buyer_purchases`, `buyer_spend`) keep every listing's confirm button disabled, a seller's or a pair's limit only that listing's, so reopening a confirmation does not ask again. The button is disabled for `retryAfterSeconds`, at most `MAX_WAIT_SECONDS` (after that the next press asks the server again); the line names the date from the full `retryAfterSeconds`, and nothing counts down. A `market_limit` without `limit` is shown as the server failure; one without seconds waits 60 s.
- **A non-envelope answer** (a proxy's 503 page) is no answer: the key is kept and `Try again` replays it. A 503 envelope is the server failure.
- **Before the wallet's first answer**, and while it fails, `Buy…` is disabled with the shop's stale reason `Buying waits until the game server answers.`; My listings' headings read `On the market, <n>` and `Market limits` without the numbers the wallet carries, and the buyer's limit line reads `Your market limit is used up. It frees up on <D Mon> at <HH:MM>.`
- **The player's own listing in the listing dialog**: `Cancel listing`'s answer shows in place of the button, with the strings of §3.6 step 3.
- **Focus and announcements**: the results line goes to the live region 500 ms after the player's last change, as the collection's does. Focus moves to the results line only when the control that was used goes away: `Clear filters`, `Show all`, and `Show more` when the last page has arrived; a select or the search keeps focus. After a purchase's result or `This card is no longer on the market.` is closed, focus goes to the listing's tile, or to the results line once the listing has left the list.
- **Search**: control characters (a pasted tab) become spaces, and the request carries at most 100 characters; Escape in a non-empty search clears it and applies at once.
- **A sale without `proceeds`** (never expected) reads `Sold for <price> Karma`.
- **E9 meanwhile**: the tiles' rank chip takes its pool size from the held collection answer's `snapshot`.
- **A bought card opens nowhere**: the purchase confirms in place in the listing dialog (§3.5 step 4); there is no market opening route.

## 4. States

| View              | State                      | User sees                                                                                  | User can do                 |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------ | --------------------------- |
| Header            | no answer yet, or failed   | No balance                                                                                 | —                           |
| Header            | loaded                     | `<B> Karma`                                                                                | —                           |
| Shop              | loading (after 300 ms)     | Three skeleton theme rows (static bars); visually hidden `Loading the shop…`               | Wait                        |
| Shop              | loaded                     | The themes                                                                                 | Buy…                        |
| Shop              | too little Karma           | That theme's `Buy…` disabled with the reason                                               | —                           |
| Shop              | empty                      | `No packs in the shop.`                                                                    | —                           |
| Shop              | error, nothing held        | `Couldn't load the shop.` and `Try again`                                                  | Try again                   |
| Shop              | stale                      | The held themes, `Buy…` disabled, reason `Buying waits until the game server answers.`     | —                           |
| Shop              | bought                     | `/shop/open`: `h1` `Shop pack` (focused), `Back to the shop`, the reveal with its entrance | Go back to the shop, leave  |
| Shop              | pack held                  | `/shop`: the themes, and `See your latest shop pack` under the `h1`                        | Buy…, see the pack          |
| Shop              | `/shop/open`, nothing held | Replaced by `/shop`                                                                        | Buy…                        |
| Pack confirmation | confirm, buying, failures  | As `collection-overview.md` §4.6, with this spec's copy                                    | Confirm, cancel             |
| Browse            | loading (after 300 ms)     | The toolbar disabled, 12 skeleton tiles; visually hidden `Loading the market…`             | Wait                        |
| Browse            | loaded                     | Results line, tiles, `Show more` when there is a next page                                 | Everything                  |
| Browse            | refreshing (new filters)   | The previous list stays, unchanged, until the new first page arrives                       | Keep filtering              |
| Browse            | empty market               | `No cards on the market.`                                                                  | —                           |
| Browse            | no matches                 | `No listings match "<q>".` or `No listings match these filters.` and `Clear filters`       | Clear                       |
| Browse            | loading more               | `Show more` reads `Loading…`, disabled                                                     | Wait                        |
| Browse            | more failed                | Under the list: `Couldn't load more.` and `Try again`                                      | Try again                   |
| Browse            | error, nothing held        | `Couldn't load the market.` and `Try again`                                                | Try again                   |
| Listing dialog    | open                       | Details, `In your collection`, `Buy…` or, if yours, `Cancel listing`                       | Buy…, cancel listing, close |
| Listing dialog    | too little Karma           | `Buy…` disabled, reason `Costs <price> Karma. You have <B>.`                               | Close                       |
| Buy               | confirm, buying, failures  | As `collection-overview.md` §4.6, with this spec's copy                                    | Confirm, cancel             |
| Buy               | bought                     | The result, focus on its heading                                                           | Close                       |
| Buy               | gone                       | `This card is no longer on the market.`                                                    | Close                       |
| Buy               | limit                      | The red line with the time; confirm disabled                                               | Cancel                      |
| My listings       | loading, error             | As browse, with `Loading your listings…` and `Couldn't load your listings.`                | Try again                   |
| My listings       | loaded                     | The four parts                                                                             | Cancel listing              |
| My listings       | cancelling                 | That row's button `Cancelling…`, disabled; other rows usable                               | Wait                        |
| My listings       | cancelled                  | The row moves to Closed; the status line                                                   | Continue                    |

Session ended and unreachable: `accounts.md` §4.8, as everywhere.

## 5. Layout

### 5.1 Header

| Width          | Arrangement                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| below 640 px   | The wordmark; then a row with the balance on the left and the Account control on the right; then the page links, full width, each link `flex-auto` with `px-2` |
| 640–1023 px    | The wordmark; then one row: the page links on the left, the balance and the Account control on the right                                                       |
| 1024 px and up | One row: the wordmark on the left; the page links, the balance and the Account control on the right, `gap-3`                                                   |

This is the "with Shop and Market" column of `navigation-and-landing.md` §5.1: the wordmark (a link to `/packs`) stands where the title block stood, and there is no subtitle. The header (`web/src/components/layout/PageFrame.tsx`) changes from `sm:flex-row` to `lg:flex-row` for it, from `feat/economy-ui` on (three links until `feat/market-ui`, in the same arrangement); the signed-out header (wordmark, `Log in`, `Register`) does not change. Below 400 px the `(<N>)` of `Collection (<N>)` is visually hidden (`sr-only min-[400px]:not-sr-only`), so the four links fit 288 px; the accessible name keeps it.

### 5.2 Shop

The page's `h1` `Shop` first (`navigation-and-landing.md` §5.2), then one column, `max-w-3xl`. Each theme is a block with `border-b border-zinc-800 py-5`: row 1 the title (`h2`) on the left, the price and `Buy…` on the right (stacked under the title below 640 px); then the series line, the odds line and the tier sizes line. Not cards in a grid: one list, read top to bottom. `See your latest shop pack`, when shown, sits under the `h1`, `mb-6`.

**`/shop/open`**: the `h1` `Shop pack` (`mb-6`), `Back to the shop`, then the reveal section `mt-10` with `packs-page.md` §5.5's heading block and the 1c reveal grid's layout (§5.2 there).

### 5.3 Market

- The page's `h1` `Market` first (`navigation-and-landing.md` §5.2), then the view switch, then (Browse) the toolbar: below 640 px, Search full width, then Rarity and Series half each, then Sort half; from 640 px, Search full width, then Rarity, Series and Sort a third each; from 1024 px one row, Search growing (at least 14rem), Rarity (10rem), Series (14rem), Sort (12rem), Clear filters. The character line, when set, sits under the toolbar.
- Results line `mt-4`, then the collection grid (`collection-overview.md` §5.1); `Show more` centred `mt-6`.
- Listing dialog: the card dialog's layout (`collection-overview.md` §5.4), confirmations and result as there.
- My listings: one column, `max-w-3xl`, each part an `h2` with its rows. A row is `flex gap-3 border-b border-zinc-800 py-3`: the card thumbnail (48 × 67 px, `card-and-rarity.md` §3.2), then the text lines, then `Cancel listing` on the right (under the text below 640 px).

## 6. Visual treatment

No new tokens. Everything reuses `collection-overview.md` §6: the card and rarity system (`card-and-rarity.md`, which supersedes the overview's old §6.1 hue ladder), the tile (§6.2) with the price in `text-xs text-zinc-200 tabular-nums` in place of the count and the `Until` or `Yours` line in `text-xs text-zinc-400`, the controls (§6.3), the dialog and banners (§6.4), the motion rules (§6.5).

- Page headings: the visible `h1`s `Shop` and `Market` as every account page's (`navigation-and-landing.md` §6.3: `text-xl font-bold text-zinc-100`, `focus:outline-none`).
- Page links: `navigation-and-landing.md` §6.1 (the former tab group's look), `px-2` on a phone with four links.
- Balance in the header: `text-sm`; the number `font-medium text-zinc-100 tabular-nums`, the word `Karma` `text-zinc-400`. No icon (decided by the owner, 2026-10-29), no box, no colour of its own.
- Theme title `text-base font-semibold text-zinc-100`; the series, odds and tier lines `text-sm text-zinc-400`, the `Odds per card` summary `BUTTON.text`, tier words in `text-rarity-<tier>-text`, numbers `tabular-nums`; the price `text-sm text-zinc-200 tabular-nums`. `Buy…` is `BUTTON.primary`, as every primary action; no larger or louder button for a paid pack.
- `See your latest shop pack`: `BUTTON.text` at `text-sm`, a link. `Back to the shop`: a link with `BUTTON.secondary`'s classes. The `h1` `Shop pack` as every account page's.
- My listings: names `text-sm text-zinc-100`, the other lines `text-xs text-zinc-400`, `Cancel listing` `BUTTON.secondary`. Statuses are words in `text-zinc-300`; no green for sold, no red for expired.
- Nothing marks a price as low, high, popular or new on the market.

## 7. Accessibility

- **Page links**: `<nav aria-label="Main">` with real links (`<a href="/shop">` and so on) and `aria-current="page"` on the current page's link only, not `aria-pressed` buttons; Tab moves through them in order (`navigation-and-landing.md` §7).
- **Titles and focus**: `Shop · Anime TCG` and `Market · Anime TCG`, set before focus moves to the page's `h1` (`tabindex="-1"`) on every navigation after the first render; the `h1` is also the target of `Skip to content`. When the page is left with a dialog open, focus goes to the new page's `h1` (`navigation-and-landing.md` §3.6, §7).
- **Balance**: a `<p>` reading `1,240 Karma`; not live. The action's status line or the live region carries a change.
- **Shop**: `<main>` starts with the visible `h1` `Shop` (the visually hidden `h2` of the previous revision is gone) and holds a `<section aria-labelledby>` on it; each theme an `<article aria-labelledby>` on its `h2`; the reveal section's heading is an `h2`. `Buy…` is described by the price and any reason. After a purchase, focus goes to `/shop/open`'s `h1` `Shop pack` (`navigation-and-landing.md` §3.6); the reveal there is a `<section aria-labelledby>` its `h2` `<title> pack`, with the list of `packs-page.md` §7.
- **Market**: `<main>` starts with the visible `h1` `Market` (replacing the visually hidden `h2`) and holds a `<section>` labelled by it; My listings' parts are `h2`s; the view switch as in the collection; the toolbar a `<search>` labelled `Market filters`, each control with a visible label. The results line is the focus target after a filter change from the keyboard is applied, and goes to the live region 500 ms after the last change. `Show more` keeps focus after it appends; the live region reads `<N> listings shown`. Tiles are `<button aria-haspopup="dialog">` named `<name>, <Rarity>, <series>, <price> Karma`, or `…, yours`.
- **Dialogs and confirmations**: as `collection-overview.md` §7 (native `<dialog>`, heading focus, `aria-describedby` on the body, in-flight rules, countdown, banners).
- **My listings**: each part a list; `Cancel listing` named `Cancel listing of <name>`; after a cancel, focus moves to the status line (`role="status"`, `tabindex="-1"`).
- **Odds**: the odds line is text, never only a chart; percentages keep three significant digits (`0.05%`) and never round up to `100%` (§3.3).
- Contrast, touch targets and reduced motion as `collection-overview.md` §7.

## 8. Copy

The word rules, placeholders and number formats of `collection-overview.md` §8 apply. New placeholders: `<price>` a listing's or a theme's price; `<title>` a theme's title (the owner's, rendered as text, `dir="auto"`); `<pack price>` a theme's price; `<window>` the market window in days (`7 days`); `<purchases>`, `<spend>`, `<proceeds>` the `left` figures; `<D Mon>` the date without the year.

**Header and pages**

| Element    | Copy                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Balance    | `<B> Karma`                                                                                                      |
| Page links | `Packs` · `Shop` · `Market` · `Collection (<N>)`; before `feat/market-ui`, `Packs` · `Shop` · `Collection (<N>)` |
| Titles     | `Shop · Anime TCG` · `Market · Anime TCG`                                                                        |

**Shop**

| Element                   | Copy                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Page heading (`h1`)       | `Shop`                                                                                                                    |
| Series line               | `<title>, <title>, <title> and <N> more`                                                                                  |
| Odds headline             | `At least one per pack: Common <x>% · Uncommon <x>% · Rare <x>% · Epic <x>% · Legendary <x>% · Mythic <x>%`               |
| Odds disclosure           | `Odds per card`                                                                                                           |
| Odds per card line        | `Each card: Common <x>% · Uncommon <x>% · Rare <x>% · Epic <x>% · Legendary <x>% · Mythic <x>%`                           |
| Tier sizes line           | `Drawn from <n> Common, <n> Uncommon, <n> Rare, <n> Epic, <n> Legendary and <n> Mythic characters.`                       |
| Special packs             | the Radiant sentence of `card-and-rarity.md` §7.1, then `Shop packs don't count toward Enchanted packs or the guarantee.` |
| Price                     | `<pack price> Karma`                                                                                                      |
| Button                    | `Buy…`                                                                                                                    |
| Reason                    | `Costs <price> Karma. You have <B>.`                                                                                      |
| Stale reason              | `Buying waits until the game server answers.`                                                                             |
| Confirmation heading      | `Buy the <title> pack?`                                                                                                   |
| Confirmation body         | `<price> Karma for <cards> cards from this pack's characters, at the odds shown. You have <B> Karma. There is no undo.`   |
| Confirm button            | `Buy for <price> Karma` / in flight `Buying…`                                                                             |
| Reveal heading            | `<title> pack`                                                                                                            |
| Opening page              | `h1` `Shop pack` · title `Shop pack · Anime TCG` · link `Back to the shop`                                                |
| Link while a pack is held | `See your latest shop pack`                                                                                               |
| Bought (live region)      | `Bought the <title> pack for <price> Karma. You have <B> Karma.`                                                          |
| Not enough Karma (red)    | `This pack costs <price> Karma. You have <B> Karma.`                                                                      |
| Gone (neutral)            | `That pack is no longer in the shop.`                                                                                     |
| No cards (red)            | `There are no cards to draw from right now. Nothing changed.`                                                             |
| Empty                     | `No packs in the shop.`                                                                                                   |
| Loading (visually hidden) | `Loading the shop…`                                                                                                       |
| Error                     | `Couldn't load the shop.` · `Try again`                                                                                   |

**Market, browse**

| Element                   | Copy                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Page heading (`h1`)       | `Market`                                                                                     |
| View buttons              | `Browse` · `My listings`                                                                     |
| Toolbar landmark          | `Market filters`                                                                             |
| Search label, placeholder | `Search` · `Name or series`                                                                  |
| Rarity                    | `Rarity` · `All rarities` · `Common` · `Uncommon` · `Rare` · `Epic` · `Legendary` · `Mythic` |
| Series                    | `Series` · `All series` · `<title>`                                                          |
| Sort                      | `Sort` · `Lowest price first` · `Highest price first` · `Newest first`                       |
| Character line            | `Showing <name> only.` · `Show all`                                                          |
| Clear                     | `Clear filters`                                                                              |
| Results line              | `<N> listings shown` / `1 listing shown`                                                     |
| Tile price                | `<price> Karma`                                                                              |
| Tile line                 | `Until <D Mon>, <HH:MM>` · own listing `Yours`                                               |
| More                      | `Show more` / in flight `Loading…`                                                           |
| More failed               | `Couldn't load more.` · `Try again`                                                          |
| Empty                     | `No cards on the market.`                                                                    |
| No matches                | `No listings match "<q>".` · `No listings match these filters.`                              |
| Loading (visually hidden) | `Loading the market…`                                                                        |
| Error                     | `Couldn't load the market.` · `Try again`                                                    |

**Listing dialog and buy**

| Element                | Copy                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Facts labels           | `Rarity` · `Price` · `Until`                                                                            |
| In your collection     | `In your collection: <Rarity> ×<N>` (one per entry) / `Not in your collection.`                         |
| Own listing            | `This is your listing.` · `Cancel listing`                                                              |
| Button                 | `Buy…`                                                                                                  |
| Reason                 | `Costs <price> Karma. You have <B>.`                                                                    |
| Confirmation heading   | `Buy <name> for <price> Karma?`                                                                         |
| Confirmation body      | `One <Rarity> card. You have <B> Karma. There is no undo.`                                              |
| Confirm button         | `Buy for <price> Karma` / in flight `Buying…`                                                           |
| Result heading         | `<name> is in your collection`                                                                          |
| Result marker          | `New`                                                                                                   |
| Result line            | `Bought for <price> Karma. You have <B> Karma.`                                                         |
| Gone                   | `This card is no longer on the market.`                                                                 |
| Limit (red)            | `Your market limit for the last <window> is used up. It frees up on <D Mon> at <HH:MM>.`                |
| Seller's limit (red)   | `This seller can't take more sales right now. Try again on <D Mon> at <HH:MM>.`                         |
| Pair limit (red)       | `You've bought as much from this seller as the market allows for now. Try again on <D Mon> at <HH:MM>.` |
| Not enough Karma (red) | `This card costs <price> Karma. You have <B> Karma.`                                                    |

**My listings**

| Element                   | Copy                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Active heading            | `On the market, <n> of <max>`                                                                                           |
| Active row                | `<price> Karma` · `Fee <fee> Karma · you get <net> Karma` · `Until <D Mon>, <HH:MM>`                                    |
| Cancel button             | `Cancel listing` (accessible name `Cancel listing of <name>`) / in flight `Cancelling…`                                 |
| Active empty              | `Nothing on the market.`                                                                                                |
| Limits heading            | `Market limits, last <window>`                                                                                          |
| Limits line               | `You can buy <purchases> more cards and spend <spend> more Karma, and receive <proceeds> more Karma from sales.`        |
| Closed heading            | `Closed in the last 30 days`                                                                                            |
| Closed rows               | `Sold for <price> Karma · you got <proceeds> Karma` · `Cancelled` · `Expired`, each with `<D Mon YYYY>` from `closedAt` |
| Bought heading            | `Bought in the last 30 days`                                                                                            |
| Empty (closed, bought)    | `Nothing in the last 30 days.`                                                                                          |
| Cancelled (status)        | `Listing cancelled. <name> is available again.`                                                                         |
| Already ended (status)    | `That listing had already ended.`                                                                                       |
| Sold first (status)       | `It sold before the cancel arrived.`                                                                                    |
| Gone (status)             | `That listing is gone.`                                                                                                 |
| Loading (visually hidden) | `Loading your listings…`                                                                                                |
| Error                     | `Couldn't load your listings.` · `Try again`                                                                            |

Failures not listed here use `collection-overview.md` §8's "Failures" strings.

## 9. Open questions

None. Decided by the owner on 2026-10-30 (`navigation-and-landing.md` §9.2 question 1): a bought pack opens on `/shop/open`.

Decided by the owner on 2026-10-29: the shop is its own Shop tab (now the `/shop` page); Karma has no icon; genre packs are automatic, and there are no franchise packs: every themed pack draws from all franchises (ADR 0013, replacing the earlier answer that franchise packs are owner-picked); the market fee is 5 %, the bounds 0.5 × to 2.5 × the reference value, the limits per rolling 7 days (`collection-overview.md` §9.1).
