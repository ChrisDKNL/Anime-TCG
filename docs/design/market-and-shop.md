# Market and Karma shop (UI)

Roadmap item 2, the two UI PRs of `docs/design/economy.md` §3 (`feat/economy-ui`: the balance and the shop; `feat/market-ui`: browse, buy, my listings) · server: `economy.md` §8, §11, §12 · [ADR 0011](../adr/0011-economy-revised-karma-market-snapshot.md) · companion of `docs/design/collection-overview.md` · written 2026-10-29

> **Why a second spec.** The collection overview is one screen around one read, the account's own collection, paged in the browser. The shop and the market are two new tabs, each around reads of their own (`GET /api/shop`; the server-paged `GET /api/market/listings`; `GET /api/market/mine`), and they ship in different PRs from the overview's. One file would make one spec span four PRs and two paging models. Listing a card and recycling stay in the overview's card dialog (`collection-overview.md` §3.5, §3.6), because their input is one collection entry. This spec reuses the overview's patterns by reference (the confirmation, in-flight and failure rules of §3.5 step 9, the tile of §6.2, the rarity system of §6.1, the copy rules of §8) and adds only what is new.
>
> Five tiers and franchises (the owner's update of 2026-10-29) are assumed as in `collection-overview.md` §3.9 D1 to D3; the shop's and the market's amounts come from the server and appear here as placeholders.

## 1. Goal

A signed-in player sees their Karma in the header, buys themed packs in a Shop tab with the price and the odds in plain view, and on a Market tab browses other players' cards, buys one for Karma and manages their own listings. The server holds every price, fee, limit and outcome (ADR 0008); the UI shows them and sends requests. No real money anywhere, no store iconography, no nudges (ADR 0004 §6, `economy.md` §12).

## 2. Out of scope

- Listing a card and recycling (`collection-overview.md` §3.5, §3.6).
- The free pack control, its countdown and the reveal grid (the 1c web PR, `collection-packs.md` §8). This spec adds one line to the reveal (§3.1 step 5) and reuses the grid for shop packs.
- A Karma history and the profile (roadmap 4).
- Price history, charts, "lowest price" or "popular" badges, recommendations, watchlists, and any notice when a listing sells. A seller sees a sale in My listings and in the balance; nothing calls them back.
- Changing a listing's price (no route: cancel and list again), bulk buying or cancelling.
- Seller names on listings (`Listing` carries none).
- How many of a theme's characters the player owns. The server sends no such figure, and the UI computes no completion.
- Masterwork and Relics (`collection-overview.md` §2).

## 3. Flow

### 3.1 Karma in the header

1. While signed in, the header shows the balance as `1,240 Karma`, beside the Account control.
2. Source: `GET /api/wallet` at sign-in and whenever the Shop, Market or Collection tab is shown. Every `balance` in an answer replaces it: `ShopReceipt`, `RecycleReceipt`, `PurchaseReceipt` and `PackOpened.karma.balance`. It is never computed and never polled. A sale of one of the player's listings shows up at the next of those fetches.
3. Before the first answer the element is empty (it reserves no space). If the first fetch fails, the header shows nothing; actions that need the balance show their stale reasons. With a value held and a refetch failing, the held value stays.
4. The balance is plain text: not a button, not a link, not a live region. The status line of the action that changed it carries the new number.
5. **On the free pack's reveal**: when `PackOpened.karma` is not null and `granted` is above 0, the line `This pack added <granted> Karma.` sits under the pull summary. With `granted` 0 (the balance at its cap), no line.

### 3.2 Tabs

`Booster` · `Shop` · `Market` · `Collection (<N>)`. The shop is a tab of its own, not a section under the free pack, so the free pack's waiting state never sits next to a Karma price; the Booster tab never mentions the shop (§9 question 1).

### 3.3 Shop

1. Showing the tab fetches `GET /api/shop` and the wallet. First load: the 300 ms rule and skeleton of `collection-overview.md` §3.1; held data shows at once and refetches silently.
2. The themes are listed in the server's order. Each shows: its title; its kind (`Genre` or `Series`); its series (titles through `ShopResponse`'s lookup; the first three, then `and <N> more` revealing the rest in place); the odds per card for every tier, from `odds.perSlot` over `odds.scale` (`Each card: Common <x>% · Rare <x>% · Epic <x>% · Legendary <x>% · Mythic <x>%`); the characters per tier, from `odds.tierSizes` (`Drawn from <n> Common, <n> Rare, <n> Epic, <n> Legendary and <n> Mythic characters.`); the price, `<price> Karma`; and `Buy…`.
3. `Buy…` is disabled, with the reason under it, when the balance is below the price. Not authoritative; the server checks again.
4. `Buy…` opens the **pack confirmation**: a native `<dialog>` in the Manage account shell. Heading `Buy the <title> pack?`; body naming the price, the number of cards, that they come from this pack's characters at the odds shown, the balance, and that there is no undo. `Buy for <price> Karma` and `Cancel`.
5. The confirm button sends `POST /api/shop/buy` with `requestId` and `themeId`, nothing else. The request id follows `collection-overview.md` §3.8. In flight: `Buying…`, with the button, `Cancel` and Escape disabled.
6. Answers:
   - **201, or 200 on a replay**: the dialog closes. At the top of the Shop tab a reveal section opens: heading `<title> pack` (the focus target), the 1c reveal grid with the receipt's cards in slot order with `isNew`, and the pull summary. The header takes `receipt.balance`; the collection is marked stale; the live region reads `Bought the <title> pack for <price> Karma. You have <B> Karma.` The reveal stays until the tab is left or another pack is bought; the themes follow below it.
   - **`insufficient_funds`**: the confirmation stays, the wallet is refetched, the red line reads `This pack costs <price> Karma. You have <B> Karma.` and the confirm button is disabled.
   - **`theme_unavailable`**: the dialog closes, the shop is refetched, and the tab shows the neutral notice `That pack is no longer in the shop.`
   - **`pool_unavailable`**: the red line `There are no cards to draw from right now. Nothing changed.`
   - **Rate limited, any other answer, no answer, `unauthenticated`**: as `collection-overview.md` §3.5 step 9. `Try again` resends the same `requestId`, so a lost answer shows the pack that was dealt instead of buying a second; `Cancel` discards the key, refetches the wallet and marks the collection stale (cards that were dealt are in the collection).
7. No themes offered, or no snapshot: `No packs in the shop.`

### 3.4 Market: browse

1. The Market tab has two views, `Browse` (default) and `My listings`, switched like the collection's Cards and Series (`collection-overview.md` §3.2 step 5).
2. Browse asks `GET /api/market/listings` with the toolbar's parameters and shows the first page; `Show more` asks for the next page with `nextCursor` and appends it. There is no total count, so the results line counts what is shown.
3. Toolbar:
   - **Search** → `q`: the trimmed text, sent 300 ms after the last keystroke; empty means no `q`; at most 100 characters. The server normalises as `collection-overview.md` §3.3 does (but see `collection-overview.md` §3.9 M4).
   - **Rarity** → `rarity`: a select, `All rarities` then the five tiers. The server takes one tier per request, so this is not the collection's multi-select chip row.
   - **Series** → the franchise parameter (`seriesId` today, D2): `All series`, then every franchise of the current snapshot by title, from the held collection answer's lookup (§3.8 S5).
   - **Sort** → `sort`: `Lowest price first` (`price_asc`, default), `Highest price first` (`price_desc`), `Newest first` (`newest`).
   - **Character** → `characterId`: set only by `See <name> on the market` in the card dialog. It shows as the line `Showing <name> only.` with `Show all`, which clears it.
   - `Clear filters` resets search, rarity, series and character, not the sort.
4. Every change asks for the first page again and replaces the list; an answer to an older set of parameters is discarded (the request is aborted). A listing already shown is not shown twice if a later page repeats it.
5. Each listing is the collection tile (`collection-overview.md` §6.2) with the meta row's right side showing `<price> Karma` instead of a count, and a line `Until <D Mon>, <HH:MM>` from `expiresAt` in place of the listed line. The player's own listings (`mine: true`) carry the line `Yours` instead.
6. The list is bounded: at most `ACCOUNT_CAP` × `MARKET_MAX_LISTINGS` listings exist (10 × 50 = 500), so at most ten pages. `Show more` disappears when `nextCursor` is null.
7. Activating a tile opens the **listing dialog**: the card dialog's shell and layout with the art, name, native name, series and `Also in`; facts `Rarity`, `Price`, `Until`; a line `In your collection: <Rarity> ×<N>` for each of the player's entries of this character, or `Not in your collection.`, from the held collection answer; then `Buy…`, or for the player's own listing `This is your listing.` and `Cancel listing` (§3.6 step 3).

### 3.5 Market: buy

1. `Buy…` is disabled, with the reason under it, when the balance is below the price. Not authoritative.
2. `Buy…` replaces the dialog body with the **buy confirmation**: heading `Buy <name> for <price> Karma?`; body naming the rarity, the balance and that there is no undo. `Buy for <price> Karma` and `Cancel`.
3. The confirm button sends `POST /api/market/listings/{listingId}/buy` with `requestId` only. **The request carries no price**: the server holds the listing's price (`economy.md` §8.5), and the number on the button is display. In flight: `Buying…`, with the usual disabling.
4. Answers:
   - **201, or 200 on a replay**: the dialog body becomes the result: heading `<name> is in your collection`, the rarity word, `New` when `card.isNew`, and `Bought for <price> Karma. You have <B> Karma.` (from the receipt), then `Close`. The header takes `receipt.balance`; the listing leaves the browse list; the collection is marked stale.
   - **`listing_unavailable`** or **`listing_not_found`**: `This card is no longer on the market.` and `Close`; the listing leaves the browse list.
   - **`market_limit`**: the red line `Your market limit for the last 24 hours is used up. It frees up at <HH:MM>.` (now + `retryAfterSeconds`); the confirm button stays disabled until then. See §3.8 S2.
   - **`insufficient_funds`**: the wallet is refetched; the red line `This card costs <price> Karma. You have <B> Karma.`
   - **`own_listing`**, **`request_id_reused`**: never expected (the UI offers no buy on its own listings, and keys are fresh); shown as the server failure.
   - **Rate limited, any other answer, no answer, `unauthenticated`**: as `collection-overview.md` §3.5 step 9; `Try again` resends the same `requestId`; `Cancel` discards it, refetches the wallet and the first page, and marks the collection stale.

### 3.6 Market: My listings

1. The view fetches `GET /api/market/mine` and the wallet when shown, and `mine` again after a cancel.
2. It shows four parts, top to bottom:
   - **On the market, `<n>` of `<max>`** (`rules.maxListings`): each active listing as a row with a thumbnail, name, rarity word, `<price> Karma`, `Fee <fee> Karma · you get <net> Karma` (`fee` from the listing, net = price − fee), `Until <D Mon>, <HH:MM>`, and `Cancel listing`. Empty: `Nothing on the market.`
   - **Market limits, last 24 hours**, always shown, from `left`: `You can buy <purchases> more cards and spend <spend> more Karma, and receive <proceeds> more Karma from sales.` No warning colour and no change in wording as the numbers fall.
   - **Closed in the last 30 days**: each row with its status: `Sold for <price> Karma · you got <proceeds> Karma`, `Cancelled` or `Expired`, and a date (§3.8 S1). Empty: `Nothing in the last 30 days.`
   - **Bought in the last 30 days**: name, rarity word, `<price> Karma`, `<D Mon YYYY>` from `boughtAt`. Empty: `Nothing in the last 30 days.`
3. **Cancel** needs no confirmation: the card comes back to the collection at once and can be listed again. `POST /api/market/listings/{listingId}/cancel` with `{}`; the row's button reads `Cancelling…` and is disabled. Answers:
   - **200**, status `cancelled`: status line `Listing cancelled. <name> is available again.`; `mine` refetched; collection marked stale. Status `expired`: `That listing had already ended.`
   - **`listing_unavailable`** (it sold first): `It sold before the cancel arrived.`; `mine` and the wallet refetched.
   - **`listing_not_found`**: `That listing is gone.`; `mine` refetched.
   - **No answer**: the red line `Couldn't reach the game server, so this may not have gone through.` and `Try again`, which resends the cancel; cancel is idempotent on the server (`economy.md` §8.5), so this is safe.
   - **Rate limited, other failures, `unauthenticated`**: as `collection-overview.md` §3.5 step 9.

### 3.7 What the UI needs from the server

| Screen         | Needs                                                                   | Field                                                                                                                         | Status    |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------- |
| Header         | Balance                                                                 | `Wallet.balance`; then every receipt's `balance`, `PackOpened.karma.balance`                                                  | ✓         |
| Booster        | Karma granted by a pack                                                 | `PackOpened.karma.granted`                                                                                                    | ✓         |
| Shop           | Themes with title, kind, series, price, odds, tier sizes                | `ShopResponse.themes[]` (`id`, `title`, `kind`, `seriesIds`, `price`, `odds.scale`, `odds.perSlot`, `odds.tierSizes`), lookup | ✓, S3, S4 |
| Shop           | Cards per pack                                                          | —                                                                                                                             | S3        |
| Shop buy       | Receipt: the pack, the price, the balance                               | `ShopReceipt.pack` (`PackOpened`), `price`, `balance`                                                                         | ✓         |
| Browse         | Listings with character, rarity, price, expiry, own flag; the next page | `ListingsPage.listings[]` (`listingId`, `character`, `rarity`, `price`, `expiresAt`, `mine`), lookup, `nextCursor`            | ✓         |
| Browse         | Filter by rarity, series, character, text; sort                         | `ListingsQuery` (`rarity`, `seriesId`, `characterId`, `q`, `sort`, `cursor`)                                                  | ✓, S5, D2 |
| Browse         | The series options                                                      | the held `CollectionResponse` lookup                                                                                          | S5        |
| Listing dialog | The player's copies of the character                                    | the held `CollectionResponse.entries[]`                                                                                       | ✓         |
| Buy            | Receipt: card, price, balance                                           | `PurchaseReceipt.card`, `price`, `balance`                                                                                    | ✓         |
| Buy            | Which limit was hit, and when it frees up                               | `market_limit` + `retryAfterSeconds`                                                                                          | ✓, S2     |
| My listings    | Active, closed (with proceeds), purchases, daily room                   | `MarketMine.active`, `closed[].proceeds`, `purchases`, `left`                                                                 | ✓, S6     |
| My listings    | When a listing closed                                                   | —                                                                                                                             | S1        |
| My listings    | The listing cap                                                         | `Wallet.rules.maxListings`                                                                                                    | ✓         |
| Cancel         | The listing's new state                                                 | `Listing.status`                                                                                                              | ✓         |

The amounts on these screens (`<price>`, the bounds, the fee, the tier sizes and odds for five tiers) are `collection-overview.md` §3.9 D1 to D3.

### 3.8 Mismatches with the server specs

| #   | Mismatch                                                                                                                                                                                                                                                                          | This spec meanwhile                                                                                              | Asked of `economy.md`                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | **`Listing` has no `closedAt`.** The table has `closed_at`, but the schema does not send it, so a closed row cannot say when it sold or was cancelled.                                                                                                                            | Sold and cancelled rows show `Listed <D Mon YYYY>` (`listedAt`); expired rows `Ended <D Mon YYYY>` (`expiresAt`) | `Listing` gains `closedAt: date-time \| null`; the rows then show `Sold <D Mon YYYY>` and `Cancelled <D Mon YYYY>`                                                 |
| S2  | **`market_limit` does not say whose limit.** A purchase is refused when the buyer's purchases or spend, the seller's proceeds, or the pair's total is used up (`economy.md` §8.5 step 6). A buyer refused by the seller's proceeds limit is told to wait while `left` shows room. | One message for all four, naming the time only                                                                   | The error carries `limit: "purchases" \| "spend" \| "proceeds" \| "pair"`, so the copy can say `This seller can't take more sales right now.` for the seller's two |
| S3  | **No pack size in the shop.** `ThemeOffer` has no card count and `web/` may not import `PACK_SIZE`; the confirmation needs it.                                                                                                                                                    | The body says `a pack of cards` without the number                                                               | `ThemeOffer` (or `PublishedOdds`) gains `cards: integer`                                                                                                           |
| S4  | **Series of a genre theme.** `pack_themes.series_ids` is null for a genre theme; `ThemeOffer.seriesIds` is required. Is it the computed list of the snapshot's series with that genre (possibly 40 or more)? With franchises (D2) it becomes franchise ids.                       | Shows whatever ids arrive, first three then `and <N> more`                                                       | State that `ThemeOffer.seriesIds` is the computed set for both kinds, and its order                                                                                |
| S5  | **No series list for the market's filter.** `ListingsPage`'s lookup covers only the listings on that page.                                                                                                                                                                        | The options come from the held collection answer (fetched at sign-in by 1c)                                      | None required; or the first page (no cursor) carries the current snapshot's whole lookup                                                                           |
| S6  | **Expired but not yet purged listings in `mine`.** Browse never returns a listing past `expiresAt`; `GET /api/market/mine` does not say the same of `active`.                                                                                                                     | A row in `active` whose `expiresAt` has passed shows as `Expired`                                                | State that `active` excludes listings past `expiresAt` and `closed` includes them as `expired`                                                                     |

`collection-overview.md` §3.9 M3 (`insufficient_funds` carries no balance) and M4 (the market's search skips native strings) apply here as well.

## 4. States

| View              | State                     | User sees                                                                              | User can do                 |
| ----------------- | ------------------------- | -------------------------------------------------------------------------------------- | --------------------------- |
| Header            | no answer yet, or failed  | No balance                                                                             | —                           |
| Header            | loaded                    | `<B> Karma`                                                                            | —                           |
| Shop              | loading (after 300 ms)    | Three skeleton theme rows (static bars); visually hidden `Loading the shop…`           | Wait                        |
| Shop              | loaded                    | The themes                                                                             | Buy…                        |
| Shop              | too little Karma          | That theme's `Buy…` disabled with the reason                                           | —                           |
| Shop              | empty                     | `No packs in the shop.`                                                                | —                           |
| Shop              | error, nothing held       | `Couldn't load the shop.` and `Try again`                                              | Try again                   |
| Shop              | stale                     | The held themes, `Buy…` disabled, reason `Buying waits until the game server answers.` | —                           |
| Shop              | revealed                  | The reveal section above the themes, focus on its heading                              | Buy another, leave          |
| Pack confirmation | confirm, buying, failures | As `collection-overview.md` §4.6, with this spec's copy                                | Confirm, cancel             |
| Browse            | loading (after 300 ms)    | The toolbar disabled, 12 skeleton tiles; visually hidden `Loading the market…`         | Wait                        |
| Browse            | loaded                    | Results line, tiles, `Show more` when there is a next page                             | Everything                  |
| Browse            | refreshing (new filters)  | The previous list stays, unchanged, until the new first page arrives                   | Keep filtering              |
| Browse            | empty market              | `No cards on the market.`                                                              | —                           |
| Browse            | no matches                | `No listings match "<q>".` or `No listings match these filters.` and `Clear filters`   | Clear                       |
| Browse            | loading more              | `Show more` reads `Loading…`, disabled                                                 | Wait                        |
| Browse            | more failed               | Under the list: `Couldn't load more.` and `Try again`                                  | Try again                   |
| Browse            | error, nothing held       | `Couldn't load the market.` and `Try again`                                            | Try again                   |
| Listing dialog    | open                      | Details, `In your collection`, `Buy…` or, if yours, `Cancel listing`                   | Buy…, cancel listing, close |
| Listing dialog    | too little Karma          | `Buy…` disabled, reason `Costs <price> Karma. You have <B>.`                           | Close                       |
| Buy               | confirm, buying, failures | As `collection-overview.md` §4.6, with this spec's copy                                | Confirm, cancel             |
| Buy               | bought                    | The result, focus on its heading                                                       | Close                       |
| Buy               | gone                      | `This card is no longer on the market.`                                                | Close                       |
| Buy               | limit                     | The red line with the time; confirm disabled                                           | Cancel                      |
| My listings       | loading, error            | As browse, with `Loading your listings…` and `Couldn't load your listings.`            | Try again                   |
| My listings       | loaded                    | The four parts                                                                         | Cancel listing              |
| My listings       | cancelling                | That row's button `Cancelling…`, disabled; other rows usable                           | Wait                        |
| My listings       | cancelled                 | The row moves to Closed; the status line                                               | Continue                    |

Session ended and unreachable: `accounts.md` §4.8, as everywhere.

## 5. Layout

### 5.1 Header

| Width          | Arrangement                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| below 640 px   | The title block; then a row with the balance on the left and the Account control on the right; then the tabs, full width, each tab `flex-auto` with `px-2` |
| 640–1023 px    | The title block; then one row: the tabs on the left, the balance and the Account control on the right                                                      |
| 1024 px and up | One row: the title block on the left; the tabs, the balance and the Account control on the right, `gap-3`                                                  |

`PageFrame`'s header changes from `sm:flex-row` to `lg:flex-row` for this; the signed-out header holds only the Account button and looks the same. Below 400 px the `(<N>)` of `Collection (<N>)` is visually hidden (`sr-only min-[400px]:not-sr-only`), so the four tabs fit 288 px; the accessible name keeps it.

### 5.2 Shop

One column, `max-w-3xl`. Each theme is a block with `border-b border-zinc-800 py-5`: row 1 the title (`h3`) and kind on the left, the price and `Buy…` on the right (stacked under the title below 640 px); then the series line, the odds line and the tier sizes line. Not cards in a grid: one list, read top to bottom. The reveal section, when present, sits above with `mb-8` and the 1c reveal grid's own layout.

### 5.3 Market

- The view switch, then (Browse) the toolbar: below 640 px, Search full width, then Rarity and Series half each, then Sort half; from 640 px, Search full width, then Rarity, Series and Sort a third each; from 1024 px one row, Search growing (at least 14rem), Rarity (10rem), Series (14rem), Sort (12rem), Clear filters. The character line, when set, sits under the toolbar.
- Results line `mt-4`, then the collection grid (`collection-overview.md` §5.1); `Show more` centred `mt-6`.
- Listing dialog: the card dialog's layout (`collection-overview.md` §5.4), confirmations and result as there.
- My listings: one column, `max-w-3xl`, each part an `h3` with its rows. A row is `flex gap-3 border-b border-zinc-800 py-3`: thumbnail `w-12` (3:4), then the text lines, then `Cancel listing` on the right (under the text below 640 px).

## 6. Visual treatment

No new tokens. Everything reuses `collection-overview.md` §6: the rarity system (§6.1), the tile (§6.2) with the price in `text-xs text-zinc-200 tabular-nums` in place of the count and the `Until` or `Yours` line in `text-xs text-zinc-400`, the controls (§6.3), the dialog and banners (§6.4), the motion rules (§6.5).

- Balance in the header: `text-sm`; the number `font-medium text-zinc-100 tabular-nums`, the word `Karma` `text-zinc-400`. No icon (`collection-overview.md` §9 question 2), no box, no colour of its own.
- Theme title `text-base font-semibold text-zinc-100`; kind `text-xs text-zinc-400`; the series, odds and tier lines `text-sm text-zinc-400`, rarity words in their tier's text colour, numbers `tabular-nums`; the price `text-sm text-zinc-200 tabular-nums`. `Buy…` is `BUTTON.primary`, as every primary action; no larger or louder button for a paid pack.
- My listings: names `text-sm text-zinc-100`, the other lines `text-xs text-zinc-400`, `Cancel listing` `BUTTON.secondary`. Statuses are words in `text-zinc-300`; no green for sold, no red for expired.
- Nothing marks a price as low, high, popular or new on the market.

## 7. Accessibility

- **Tabs**: the existing `<nav aria-label="Views">` with `aria-pressed` buttons, now four.
- **Balance**: a `<p>` reading `1,240 Karma`; not live. The action's status line or the live region carries a change.
- **Shop**: `<section aria-labelledby>` with a visually hidden `h2` `Shop`; each theme an `<article aria-labelledby>` on its `h3`. `Buy…` is described by the price and any reason. The reveal heading takes focus after a purchase.
- **Market**: `<section>` with a visually hidden `h2` `Market`; the view switch as in the collection; the toolbar a `<search>` labelled `Market filters`, each control with a visible label. The results line is the focus target after a filter change from the keyboard is applied, and goes to the live region 500 ms after the last change. `Show more` keeps focus after it appends; the live region reads `<N> listings shown`. Tiles are `<button aria-haspopup="dialog">` named `<name>, <Rarity>, <series>, <price> Karma`, or `…, yours`.
- **Dialogs and confirmations**: as `collection-overview.md` §7 (native `<dialog>`, heading focus, `aria-describedby` on the body, in-flight rules, countdown, banners).
- **My listings**: each part a list; `Cancel listing` named `Cancel listing of <name>`; after a cancel, focus moves to the status line (`role="status"`, `tabindex="-1"`).
- **Odds**: the odds line is text, never only a chart; percentages keep their decimals (`6.5%`).
- Contrast, touch targets and reduced motion as `collection-overview.md` §7.

## 8. Copy

The word rules, placeholders and number formats of `collection-overview.md` §8 apply. New placeholders: `<price>` a listing's or a theme's price; `<title>` a theme's title (the owner's, rendered as text, `dir="auto"`); `<purchases>`, `<spend>`, `<proceeds>` the `left` figures; `<D Mon>` the date without the year.

**Header and Booster**

| Element     | Copy                                               |
| ----------- | -------------------------------------------------- |
| Balance     | `<B> Karma`                                        |
| Reveal line | `This pack added <granted> Karma.`                 |
| Tabs        | `Booster` · `Shop` · `Market` · `Collection (<N>)` |

**Shop**

| Element                   | Copy                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Region (visually hidden)  | `Shop`                                                                                                                                                                         |
| Kind                      | `Genre` · `Series`                                                                                                                                                             |
| Series line               | `<title>, <title>, <title> and <N> more`                                                                                                                                       |
| Odds line                 | `Each card: Common <x>% · Rare <x>% · Epic <x>% · Legendary <x>% · Mythic <x>%`                                                                                                |
| Tier sizes line           | `Drawn from <n> Common, <n> Rare, <n> Epic, <n> Legendary and <n> Mythic characters.`                                                                                          |
| Price                     | `<price> Karma`                                                                                                                                                                |
| Button                    | `Buy…`                                                                                                                                                                         |
| Reason                    | `Costs <price> Karma. You have <B>.`                                                                                                                                           |
| Stale reason              | `Buying waits until the game server answers.`                                                                                                                                  |
| Confirmation heading      | `Buy the <title> pack?`                                                                                                                                                        |
| Confirmation body         | `<price> Karma for <cards> cards from this pack's characters, at the odds shown. You have <B> Karma. There is no undo.` (until S3: `<price> Karma for a pack of cards from …`) |
| Confirm button            | `Buy for <price> Karma` / in flight `Buying…`                                                                                                                                  |
| Reveal heading            | `<title> pack`                                                                                                                                                                 |
| Bought (live region)      | `Bought the <title> pack for <price> Karma. You have <B> Karma.`                                                                                                               |
| Not enough Karma (red)    | `This pack costs <price> Karma. You have <B> Karma.`                                                                                                                           |
| Gone (neutral)            | `That pack is no longer in the shop.`                                                                                                                                          |
| No cards (red)            | `There are no cards to draw from right now. Nothing changed.`                                                                                                                  |
| Empty                     | `No packs in the shop.`                                                                                                                                                        |
| Loading (visually hidden) | `Loading the shop…`                                                                                                                                                            |
| Error                     | `Couldn't load the shop.` · `Try again`                                                                                                                                        |

**Market, browse**

| Element                   | Copy                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| Region (visually hidden)  | `Market`                                                                        |
| View buttons              | `Browse` · `My listings`                                                        |
| Toolbar landmark          | `Market filters`                                                                |
| Search label, placeholder | `Search` · `Name or series`                                                     |
| Rarity                    | `Rarity` · `All rarities` · `Common` · `Rare` · `Epic` · `Legendary` · `Mythic` |
| Series                    | `Series` · `All series` · `<title>`                                             |
| Sort                      | `Sort` · `Lowest price first` · `Highest price first` · `Newest first`          |
| Character line            | `Showing <name> only.` · `Show all`                                             |
| Clear                     | `Clear filters`                                                                 |
| Results line              | `<N> listings shown` / `1 listing shown`                                        |
| Tile price                | `<price> Karma`                                                                 |
| Tile line                 | `Until <D Mon>, <HH:MM>` · own listing `Yours`                                  |
| More                      | `Show more` / in flight `Loading…`                                              |
| More failed               | `Couldn't load more.` · `Try again`                                             |
| Empty                     | `No cards on the market.`                                                       |
| No matches                | `No listings match "<q>".` · `No listings match these filters.`                 |
| Loading (visually hidden) | `Loading the market…`                                                           |
| Error                     | `Couldn't load the market.` · `Try again`                                       |

**Listing dialog and buy**

| Element                        | Copy                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Facts labels                   | `Rarity` · `Price` · `Until`                                                    |
| In your collection             | `In your collection: <Rarity> ×<N>` (one per entry) / `Not in your collection.` |
| Own listing                    | `This is your listing.` · `Cancel listing`                                      |
| Button                         | `Buy…`                                                                          |
| Reason                         | `Costs <price> Karma. You have <B>.`                                            |
| Confirmation heading           | `Buy <name> for <price> Karma?`                                                 |
| Confirmation body              | `One <Rarity> card. You have <B> Karma. There is no undo.`                      |
| Confirm button                 | `Buy for <price> Karma` / in flight `Buying…`                                   |
| Result heading                 | `<name> is in your collection`                                                  |
| Result marker                  | `New`                                                                           |
| Result line                    | `Bought for <price> Karma. You have <B> Karma.`                                 |
| Gone                           | `This card is no longer on the market.`                                         |
| Limit (red)                    | `Your market limit for the last 24 hours is used up. It frees up at <HH:MM>.`   |
| Seller's limit (red, after S2) | `This seller can't take more sales right now. Try again at <HH:MM>.`            |
| Not enough Karma (red)         | `This card costs <price> Karma. You have <B> Karma.`                            |

**My listings**

| Element                   | Copy                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Active heading            | `On the market, <n> of <max>`                                                                                    |
| Active row                | `<price> Karma` · `Fee <fee> Karma · you get <net> Karma` · `Until <D Mon>, <HH:MM>`                             |
| Cancel button             | `Cancel listing` (accessible name `Cancel listing of <name>`) / in flight `Cancelling…`                          |
| Active empty              | `Nothing on the market.`                                                                                         |
| Limits heading            | `Market limits, last 24 hours`                                                                                   |
| Limits line               | `You can buy <purchases> more cards and spend <spend> more Karma, and receive <proceeds> more Karma from sales.` |
| Closed heading            | `Closed in the last 30 days`                                                                                     |
| Closed rows               | `Sold for <price> Karma · you got <proceeds> Karma` · `Cancelled` · `Expired`; dates per S1                      |
| Bought heading            | `Bought in the last 30 days`                                                                                     |
| Empty (closed, bought)    | `Nothing in the last 30 days.`                                                                                   |
| Cancelled (status)        | `Listing cancelled. <name> is available again.`                                                                  |
| Already ended (status)    | `That listing had already ended.`                                                                                |
| Sold first (status)       | `It sold before the cancel arrived.`                                                                             |
| Gone (status)             | `That listing is gone.`                                                                                          |
| Loading (visually hidden) | `Loading your listings…`                                                                                         |
| Error                     | `Couldn't load your listings.` · `Try again`                                                                     |

Failures not listed here use `collection-overview.md` §8's "Failures" strings.

## 9. Open questions

For the owner; a choice of three, this spec drawn for the recommended one.

1. **Where the Karma shop lives.**
   - **A (recommended)**: its own `Shop` tab. The free pack stays alone on `Booster`, and no Karma price appears next to the free pack's countdown, so waiting for a free pack never turns into an offer.
   - B: on the `Booster` tab, under the free pack. One place for all packs, but the paid packs sit beside the free pack's waiting state, which is the upsell ADR 0004 §6 rules out in spirit.
   - C: inside the `Market` tab, as a third view. Fewer tabs, but buying a pack from the game and buying a card from a player look like the same kind of action.
