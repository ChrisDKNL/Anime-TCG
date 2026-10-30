# Collection overview

Roadmap item 3 · builds on 1c (server-side collection, `docs/design/collection-packs.md`, shipped in #28), the page addresses (`docs/design/navigation-and-landing.md`, shipped in #30) and item 2 (economy, `docs/design/economy.md`) · shows [ADR 0004](../adr/0004-economy-ground-rules.md) §4 as amended by [ADR 0011](../adr/0011-economy-revised-karma-market-snapshot.md) §3 (market, recycle) under [ADR 0008](../adr/0008-server-authoritative.md) · written 2026-10-29, revised the same day for the owner's decisions

> **Revised 2026-10-29** to the owner's decisions (ADR 0011 and the owner's later answers the same day) and the server specs as revised for them (`collection-packs.md` at 0ce69bd, `economy.md` at 9a3e059): six rarity tiers (Common, Uncommon, Rare, Epic, Legendary, Mythic), fixed per character by popularity rank and drawn as the owner's frames with one to six stars (`docs/design/card-and-rarity.md`); one entry per character; completion per series, where a series is an AniList **franchise**, and for the whole pool; "Sell" becomes "List on the market", for every card including the last copy; **Recycle for Karma** turns duplicates into Karma at a set value per tier, and there is no recycling into a higher tier; the currency is Karma. The Karma balance in the header, the Shop page and the Market page are a companion spec, `docs/design/market-and-shop.md`, which says why it is separate. `economy.md`'s amounts are still five-tier, so they appear as placeholders (`<ref Epic>`, `<recycle Epic>`, `<min Epic>`, `<max Epic>`), and §3.9 says what is settled with it and what is not.
>
> **Reconciled 2026-10-29** with what is on `main`: 1c's server as shipped in #28 (six tiers, the rank and the pool size in the contract), the page addresses of `navigation-and-landing.md` as shipped in #30 (its §10: the Collection tab is now the `/collection` page, reached by a header link, with its own title and a visible `h1` that takes focus), and `economy.md` as landed in 0562e10, which settles the five mismatches E1 to E5 of the previous revision (§3.9).

## 1. Goal

A signed-in player sees their whole collection on one screen and can find any card in it: a grid of what they own, completion for the whole pool and for each series, search by character or series, filters for rarity, series and duplicates, and four sort orders. Opening a card shows its details and the two things a player can do with it: **list it on the market** at a price they set within the server's bounds, so another player can buy it for Karma, or **recycle its duplicates for Karma** at a set value per tier, a quarter of the tier's reference value (owner, 2026-10-29). Any card can be listed, the last copy included; only duplicates can be recycled, never the last copy. The server owns the collection, every number in it, every bound and fee, and the outcome of every action (ADR 0008). This view renders what the server last said and asks it to act. Roadmap item 3.

## 2. Out of scope

- The API's shape beyond what §3.8 names: paths and fields are `collection-packs.md` §6 and `economy.md` §11; this spec only maps them to the screen.
- Pack opening and the reveal grid (`collection-packs.md` §8 and the 1c web PR's UI spec). This view only learns that the collection changed.
- The Karma balance in the header, the Shop page (`/shop`), the Market page's browse and buy screens and My listings (`/market`, `market-and-shop.md`). This view links to the market from a card (§3.5) and reads the balance the header holds.
- Listing or recycling more than one entry per confirmation ("list all duplicates"). One listing is one card (`economy.md` §8.3); a bulk action is a later spec.
- **Upgrading a card to a higher tier.** There is no tier recycling. Upgrades happen only in the mini-games (items 5 and 6, for example an ante of five Legendaries that can win a Mythic) and are specced with them.
- Changing a listing's price. There is no route for it; a player cancels in My listings and lists again.
- Card-for-card trade (roadmap 7); profile, showcase and favourite card (roadmap 4); collection download (roadmap 9).
- Showing characters the player does not own (empty slots, the full pool). Completion is shown as numbers and bars only, including `0 of 12` for a series with no card yet.
- Undo for a recycle or a sale. The confirmation says there is none. A listing can be cancelled until it sells.
- Remembering search, filters, sort, view or page across reloads, or keeping them in the address. Nothing is written to browser storage, and the app never reads or writes a query string or hash (`navigation-and-landing.md` §3.1 rule 2, owner decision 2 there). They reset on reload and on log out, and survive moving between pages, because they live in the signed-in layout (`navigation-and-landing.md` §3.10).
- Arrow-key navigation inside the grid (§7 says why Tab is enough at 60 per page).
- Previous/next navigation between cards inside the dialog.
- **Collection reset.** It is an owner-only command (`collection-packs.md` §5.6, `reset-collection`), with no route and no player button anywhere. The proof of concept's `Reset` button and its copy go in the 1c web PR (`collection-packs.md` §8).
- **The pack reveal's glowing frames.** They are replaced in the 1c web PR together with the card and rarity tokens of `card-and-rarity.md` §10 (`collection-packs.md` §8), not by this feature.
- **Masterwork cards and Relics** (owner, 2026-10-29: reserved for later). A Masterwork is a variant of a card with increased rarity; a Relic is a separate kind of collectible. Neither is designed here and nothing in this view renders them. Room is left so that adding them later changes no layout: the card's stars line keeps room after the stars for a short variant marker (`card-and-rarity.md` §3.1); the dialog's facts list can take a further row; the Collection page's view switch is a group that can take a further button, such as a Relics view (§5.2); and an entry, keyed today by character and granted rarity, can take a variant as a third key.
- Replacing the app's visual system. This view is drawn in the target style; what the rest of the app must change is listed in §10, not done here.

## 3. Flow

Terms used below and in the copy.

- A **card** is one owned copy.
- An **entry** is every copy of one character at one **granted rarity** (the rarity the card was dealt with, which never changes); the grid shows one tile per entry. Each character has one **tier** per snapshot, so a collection normally holds **one entry per character**. A second entry for the same character appears only after a snapshot update moved that character's tier and the player then obtained it at the new tier (`collection-packs.md` §5.1.8). The entry's `rarity` is its granted rarity; `character.tier` is what packs deal the character as now (`null` when the character is not in the current snapshot). After a snapshot update, owned cards keep their granted rarity, while names and images follow the new snapshot.
- The **tiers**, lowest to highest: Common, Uncommon, Rare, Epic, Legendary, Mythic, shown as one to six stars ("Owner, 2026-10-29"; `card-and-rarity.md` §5).
- A **duplicate** is any copy beyond the first in an entry. Only duplicates can be recycled, never an entry's last copy; how many an entry offers is `recyclable` (§3.6, §3.9 E3).
- A card is **listed** while it is on the market and **available** otherwise. A listed card is still owned: it counts in the copies, the totals and completion until it sells (`economy.md` §7). The server sends `listed` and `available` per entry.
- The **pool** is the current snapshot's characters, the MAIN and SUPPORTING characters of the top 100 anime on AniList.
- A **series** in this spec's copy is a **franchise**: the AniList entries of the top 100 grouped through their relations (seasons, sequels and films of one story together). The player sees "series"; the contract says franchise (`collection-packs.md` §5.1.2, §6.2). A character can belong to more than one franchise (`franchiseIds`, primary first).
- A **character** counts once for pool completion, whatever its entries, and **once per franchise** for series completion, however many of the franchise's entries it appears in.

### 3.1 Entering the Collection page (`/collection`)

The page is `/collection` (`navigation-and-landing.md` §3.1), reached by the `Collection (<N>)` link in the header, by its address, or by Back and Forward. Arriving by a link, Back or Forward sets the title `Collection · Anime TCG` and then moves focus to the page's `h1` `Collection`, which is rendered from the start, in the loading, empty and error states too; a load or reload sets the title and moves no focus (`navigation-and-landing.md` §3.6). A signed-out visitor is sent to `/login` with `/collection` as the return path (`navigation-and-landing.md` §3.3). Activating the header link while on the page does nothing.

1. The view asks the server for the collection (`GET /api/collection`) and, from `feat/economy-ui` on, refetches the wallet (`GET /api/wallet`, `market-and-shop.md` §3.1). The header link reads `Collection (<N>)` with N = `totals.cards`, or `AccountPublic.cards` before the first collection answer.
2. Branch on what happens:
   - **First load, answered within 300 ms**: nothing renders in the main area until the answer (no skeleton flash).
   - **First load, slower than 300 ms**: the loading skeleton (§4.1) until the answer.
   - **Data already held from earlier in the session**: shown at once; the view refetches silently and swaps the numbers in when the answer arrives. No skeleton, no spinner.
   - **Answer with zero entries**: the empty state.
   - **Answer with entries**: stats, view switch, then the Cards view (toolbar, results line, grid, pages) or the Series view.
   - **Failure, nothing held**: the error state with `Try again`.
   - **Failure, data held**: the held data stays, marked with the stale note; listing and recycling wait.
   - **Wallet failure, collection loaded**: the grid and the Series view work; in the card dialog, listing and recycling wait (§4.5 stale) until a wallet answer arrives.
   - **`unauthenticated`**: `accounts.md` §4.8 (session ended: the page is replaced by `/login`, with `/collection` as the return path).
3. The collection is fetched when the page is shown and after every answer to a listing or a recycle (§3.5, §3.6). A pack opening, a shop pack, a market purchase and a cancel in My listings mark it stale, so the next visit refetches. It is never polled. A sale of one of the player's listings to another player is not pushed; it shows up at the next fetch.

### 3.2 Completion, totals and the Series view

1. **Pool completion**: `completion.pool`, the distinct characters of the current snapshot the player owns at least one card of, at any rarity, over the snapshot's character count: `412 of 2,983 characters`. A percentage, rounded down so `100%` appears only when it is true, and a bar sit beside it. Both figures are the server's.
2. **Series completion**: `completion.franchises`, one row for **every** franchise of the current snapshot, owned or not, in the server's order (most popular first). Each row is the franchise's characters the player owns at any rarity, each counted once, over the franchise's character count. A series with no card yet is `0 of 12`, shown like any other row, not hidden and not dimmed below the contrast floor. It appears in three places: the **Series view** (step 5), the series filter's option labels (§3.3), and, with a series filter active, a second stats line: `Cowboy Bebop: 3 of 4 characters`.
3. **Dropped characters** (`inCurrentSnapshot: false`, `tier: null`, `rank: null`) stay in the collection with their granted rarity, show the out-of-pool line in the dialog and no rank chip on the card, count in the card totals and in no completion figure (`collection-packs.md` §5.1.8). A franchise that is no longer in the current snapshot has no completion row: it appears in the series filter while an owned entry names it, without a figure, and not in the Series view.
4. **Totals**: `totals.cards`, `totals.duplicates` and `totals.byRarity` (cards per granted rarity, six tiers). No search, filter or view changes a stat; the stats always describe the whole collection.
5. **Series view.** Under the stats, a view switch, `Cards` (default) and `Series`. The Series view lists every row of step 2: the series title, `<owned> of <total>`, and a bar. Sort: `Most popular first` (the server's order, default) or `Title, A to Z`. A row with at least one owned character has `Show cards`, which switches to the Cards view with that series as the series filter, clears the search, the rarity filter and Duplicates only, keeps the sort, and goes to page 1. A `0 of N` row has no button: there is nothing to show. Under the list, one line names the source: `<S> series from the 100 most popular anime on AniList, as of <D Mon YYYY>.` (S = the number of rows, the date `snapshot.takenAt`). The Series view has no paging (fewer than 100 rows: 100 anime grouped into franchises).
6. With `snapshot: null` (a fresh install before the owner's first snapshot) there are no cards, so the empty state shows; nothing in this section renders.
7. Nothing happens at a threshold. At 100% the line reads `2,983 of 2,983 characters` and `100%`, like any other number; a completed series reads `12 of 12`.

### 3.3 Search, filters, sort and pages

All four run in the browser over the entries the server returned. They are display, not decisions. They combine with AND, every change updates the grid at once, and every change except paging returns to page 1.

**Search match rule** (`economy.md` §8.4 applies the same normalisation on the server for the market's search)

1. The query and every searched field are normalised the same way, in this order: Unicode NFKC (folds full-width letters), lower-case, NFD, remove U+0300–U+036F (Latin accents), NFC, trim, collapse whitespace runs to one space. Kana voiced marks (U+3099, U+309A) are outside the removed range, so `か` does not match `が`.
2. The normalised query is split on spaces into terms. An empty query is no search.
3. An entry matches when **every term** is a substring of **at least one** of: the character name, the character's native name, and the title and the native title of **each** of the character's franchises (`franchiseIds`, resolved through the response's `franchises`).
4. Punctuation counts: it is kept, so `d.luffy` does not match Monkey D. Luffy (`monkey d. luffy` has no `d.luffy` in it), while `d. luffy` and `d luffy` do, each term on its own (step 3: `d` is in `d.`). The field accepts at most 100 characters.
5. Each entry's normalised fields are computed once per collection answer, not per keystroke (§5.5).

| Query         | Matches                                                         | Why                                        |
| ------------- | --------------------------------------------------------------- | ------------------------------------------ |
| `spike`       | Spike Spiegel                                                   | substring of the name                      |
| `bebop spike` | Spike Spiegel (Cowboy Bebop)                                    | each term is in some field                 |
| `titan`       | every character of Attack on Titan, whichever season they're in | the franchise title covers its seasons     |
| `pokemon`     | characters from "Pokémon"                                       | accents removed                            |
| `ＬＵＦＦＹ`  | Monkey D. Luffy                                                 | NFKC folds full-width                      |
| `進撃`        | characters from 進撃の巨人                                      | native franchise title                     |
| `ルフィ`      | Monkey D. Luffy (native name モンキー・D・ルフィ)               | native character name                      |
| `luffy zoro`  | nothing, unless one entry contains both terms across its fields | terms are AND, not OR                      |
| `d luffy`     | Monkey D. Luffy                                                 | each term is a substring: `d` is in `d.`   |
| `d.luffy`     | nothing                                                         | punctuation counts: no field has `d.luffy` |

**Filters**

- **Rarity**: a row of chips, `All` and one per tier (`Common`, `Uncommon`, `Rare`, `Epic`, `Legendary`, `Mythic`). Several tiers can be pressed at once; an entry matches when its granted rarity is one of them. `All` is pressed exactly when no tier is; pressing it releases every tier. Pressing the last pressed tier again releases it, which presses `All`.
- **Series**: `All series` (default), then every franchise that at least one held entry names in its `franchiseIds`, sorted by title (`Intl.Collator`, §3.3 Sort). Each option with a completion row is labelled with it (`Cowboy Bebop · 3/4`); a franchise no longer in the current snapshot has no figure (`Cowboy Bebop`). Options are keyed by franchise id; two franchises with the same title are told apart by start year (`Hunter x Hunter, 2011 · 5/9`) when the server gives one. An entry matches when **any** of its `franchiseIds` is the selected one. A selected series stays in the list while selected, even after its last card goes (`· 0/4`). Series the player owns nothing of are not options; they are in the Series view.
- **Duplicates only**: off by default; on shows entries with 2 or more copies.
- `Clear filters` appears when the search or any filter differs from its default, and resets all of them. It does not touch the sort.

**Sort**. Default `Rarity, rarest first`. Name and title comparisons use `Intl.Collator("en", { sensitivity: "base", numeric: true })`. "Series" in a tie-break is the primary franchise's title (`franchiseIds[0]`). The last tie-break everywhere is the character id, then the granted rarity rarest first, so every order is stable even for a character held at two rarities.

| Option                 | Order                                                           | Then                          |
| ---------------------- | --------------------------------------------------------------- | ----------------------------- |
| `Rarity, rarest first` | granted rarity: Mythic, Legendary, Epic, Rare, Uncommon, Common | name A–Z, then series A–Z     |
| `Name, A to Z`         | name A–Z                                                        | rarest first, then series A–Z |
| `Newest first`         | last obtained, newest first                                     | rarest first, then name A–Z   |
| `Most copies`          | count, highest first                                            | rarest first, then name A–Z   |

"Last obtained" (`lastObtainedAt`) moves an entry up when a new copy arrives from a pack, a recycle or a purchase, so the cards from the latest pack lead `Newest first`.

**Pages**: 60 entries per page (§5.5). Page controls appear only with more than one page: `Previous`, a page select (`Page [3] of 34`), `Next`. A refetch keeps the page and clamps it if the page no longer exists; the clamped page becomes the chosen one, so a later answer with more pages stays there rather than going back (manager decision, 2026-10-30).

### 3.4 Card dialog

1. Activating a tile opens the **card dialog** for that entry: a native `<dialog>` opened with `showModal()`, the same shell as Manage account.
2. It shows the art, the name (heading), the native name when it differs from the name, the primary series' title and native title, and, when the character belongs to more franchises, an `Also in` list of their titles (each with its start year when titles are shared). Then a facts list: rarity (granted), copies, `On the market` (only when `listed` ≥ 1), first obtained, and last obtained (only with 2 or more copies).
3. Notes under the facts, at most one:
   - the character is not in the current snapshot: the out-of-pool line;
   - it is, at a tier other than this entry's rarity: `Packs now give <name> as <Tier>.` (the entry keeps its granted rarity; §3 terms).
4. Below, two sections: **List on the market** (§3.5), for every entry; and **Recycle for Karma** (§3.6), for every entry whose rarity has a recycle value in `GET /api/wallet` (every tier, §3.9 E1). The dialog ships with the collection overview right after 1c, showing details only, and each economy UI PR adds its section to it: Recycle for Karma with `feat/economy-ui`, List on the market with `feat/market-ui` (decided, §9.1).
5. The grid behind the dialog keeps its order while the dialog is open. Sort and filters are reapplied on close (§3.7), so no tile moves while the player is looking at it.

### 3.5 List on the market

One listing is one card (`economy.md` §8.3): there is no quantity. Any card can be listed, the last copy included.

1. The section shows a `Price` field, a whole number of Karma, empty by default (decided, §9.1), with the hint `<min> to <max> Karma` (`rules.priceMin` and `rules.priceMax` for this entry's granted rarity: half to two and a half times the tier's reference value, so for an Epic card `<min Epic>` to `<max Epic>`). Beside it, `List…`. Under them, a text link `See <name> on the market`, which closes the dialog, sets the market's character filter in the signed-in layout's state (never in the address) and pushes `/market`, whose browse view then shows this character (`market-and-shop.md` §3.4), so the player can see what others ask before choosing a price. Back returns to `/collection` with the dialog closed (`navigation-and-landing.md` §3.10 item 4).
2. While the field holds a whole number within the bounds, a line under it shows the fee and the net, updated as the player types: `Fee <fee> Karma (<feePct>). You get <net> Karma if it sells.` The fee is `max(feeMin, ceil(price × feeBps / 10 000))` with `feeBps` and `feeMin` from the wallet: 5 %, rounded up, at least 1 (owner, 2026-10-29; §3.9 E4). The net is price − fee. This is the one sum the UI works out before the server answers (`economy.md` §12); the receipt's `fee` is the one that counts. With the field empty or out of bounds the line is not shown, and the hint stays.
3. `List…` is disabled, with the reason visible under it, when `available` is 0 (every copy is listed already), or when `Wallet.activeListings` has reached `rules.maxListings` (the reason is the listing-cap line of §8, with the `My listings` link). Neither check is authoritative; the server checks again.
4. `List…` validates on submit, not per keystroke. Empty, not a whole number, or outside the bounds shows the field error, focus goes to the field, and nothing is sent.
5. A valid price replaces the dialog body with the **listing confirmation**. Its heading names the character and the price; its body says that one copy of this rarity goes on the market for the listing time (`rules.listingTtlSeconds`, shown in days), what the player gets after the fee if it sells, that the card stays in the collection until it sells and the listing can be cancelled until then, the last-copy sentence it needs (step 6), and that a sale cannot be undone.
6. Last-copy sentences, at most one, worked out from the held entries:
   - the player holds exactly one card of this character across all its entries: it is their only copy, and once it sells the character stops counting toward completion (or, not in the current snapshot: packs no longer include it);
   - otherwise, when `available` is 1: this puts every copy of this rarity on the market.
7. `List for <P> Karma` sends one `POST /api/market/listings` with `requestId`, `characterId`, the entry's `rarity` and `price` = the asking price the confirmation showed. This is the only number any request in this view carries (`economy.md` §11.2). While it is in flight the button reads `Listing…` and the button, `Cancel` and Escape are disabled, so the dialog cannot close on an unknown outcome.
8. **No optimistic changes.** The tile, the counts and the stats stay as they were until the server answers; then the view refetches the collection and shows the server's numbers.
9. Branch on the answer:
   - **201 or 200 (a replay) `Listing`**: the dialog returns to the details, which show the refetched `On the market` count, the inline status line `Listed for <P> Karma until <D Mon YYYY>, <HH:MM>. The fee is <fee> Karma if it sells.` (price, fee and `expiresAt` from the answer), and focus on the dialog heading. The field is cleared.
   - **`price_out_of_bounds`** (the bounds changed since the wallet was read): nothing was listed. The view refetches the wallet, returns to the details with the field kept, the field error showing the new bounds, and the neutral `Something changed…` notice.
   - **`not_enough_copies`** or **`request_id_reused`**: nothing was listed. The view refetches the collection, returns to the details with the new numbers and the neutral `Something changed…` notice.
   - **`listing_limit`**: nothing was listed. The details show the red line `You have <max> cards on the market, the most at once. Cancel a listing to list another.` (`rules.maxListings`) and a text link `My listings` (`market-and-shop.md` §3.6).
   - **Rate limited** (429): the confirmation stays; the button reads `Try again in <S> s` from the server's seconds and counts down (the `accounts.md` §4.4-B pattern); the status line under it appears once.
   - **Any other answer from the server** (`validation_failed`, `bad_origin`, a 5xx): nothing was listed, because a listing is all or nothing. The confirmation stays with the red `The game server couldn't finish this…` banner, and the button is enabled again.
   - **No answer (network)**: the outcome is unknown, because the request may have arrived. The confirmation body is replaced by the red `Couldn't reach the game server, so this may not have gone through.` banner, `Try again` and `Cancel`. `Try again` resends **the same request with the same `requestId`**; if the first one arrived, the server answers 200 with that listing and nothing is listed twice (`economy.md` §8.8). `Cancel` discards the key, refetches the collection and returns to the details as the server now shows them. The UI never resends by itself.
   - **`unauthenticated`**: `accounts.md` §4.8.
10. `Cancel`, or Escape on the confirmation, returns to the details with the price kept.

### 3.6 Recycle for Karma

The rule (owner, 2026-10-29): a player recycles **duplicates** of an entry, never its last copy, for a set amount of Karma per card: `<recycle T>` for tier T, a quarter of the tier's reference value `<ref T>`. Nothing is drawn and nothing is revealed: the cards go, the Karma comes. The value per tier comes from `GET /api/wallet` (§3.9 E1); none is a constant in `web/`. Upgrading to a higher tier is not a recycle (§2).

1. The section shows the value line (`Each duplicate recycles for <recycle Rare> Karma.`), a `Duplicates` field, a whole number from 1 to `recyclable` (the entry's recyclable copies: at most copies − 1, and never a listed copy, §3.9 E3), which starts at `recyclable`, with the hint `1 to <max>`, and `Recycle…`. While the field holds a valid number, the exact credit sits under it: `You get <total> Karma.` (`<total>` = the number × the value, both the server's; the UI multiplies, the server credits).
2. With `recyclable` at 0 there is no field, and `Recycle…` is disabled with the reason: with one copy, `No duplicates. The last copy can't be recycled.`; with duplicates that are all on the market, `Copies on the market can't be recycled.` Neither check is authoritative; the server checks again.
3. `Recycle…` validates on submit: empty, zero, not a whole number or above `recyclable` shows the field error, focus goes to the field, and nothing is sent.
4. A valid number replaces the body with the **recycle confirmation**: heading `Recycle <Q> duplicates of <name>?`; a body naming the number, the rarity and the exact Karma, how many copies the player keeps (and how many of those are on the market, when any are), and that there is no undo.
5. `Recycle for <total> Karma` sends one `POST /api/collection/recycle` with `requestId`, `characterId`, the entry's `rarity` and `count` = the number (§3.9 E2). It carries no Karma amount: the server computes the credit. In flight the button reads `Recycling…`, with the same disabling as a listing.
6. **No optimistic changes**: the counts and the balance stay until the server answers.
7. Branch on the answer:
   - **201, or 200 on a replay**: the dialog returns to the details with the refetched counts, the inline status line `Recycled <Q> <copy|copies> of <name> for <credited> Karma. You have <B> Karma.` (count, credit and balance from the receipt), and focus on the dialog heading. The header balance takes the receipt's `balance`. If the receipt's credit differs from the total the confirmation showed (the value changed between the wallet read and the request), the line states the server's amount and adds ` Each duplicate now recycles for <recycle T> Karma.` (§9.2 question 1).
   - **`not_enough_copies`** (fewer recyclable copies than asked) or **`request_id_reused`**: nothing was recycled. Refetch, return to the details, neutral `Something changed…` notice.
   - **`balance_limit`** (the credit would take the balance past its ceiling, `economy.md` §12): nothing was recycled. The confirmation stays with the red line `Your Karma is at its ceiling, so nothing was recycled.`, and the confirm button is disabled.
   - **Rate limited, any other answer, no answer, `unauthenticated`**: exactly as §3.5 step 9. `Try again` after no answer resends the same `requestId`, so a lost answer never recycles twice.
8. `Cancel`, or Escape on the confirmation, returns to the details with the number kept.
9. There is no fee, no balance check, no draw and no reveal: a recycle for Karma cannot fail for lack of Karma, and its outcome is known before it is sent.

### 3.7 Closing the dialog and where focus goes

1. The close button, or Escape on the details, closes the dialog. Escape on a confirmation returns to the details first.
2. On close the grid reapplies its sort and filters to the server's numbers.
3. Focus goes to the first of these that exists: the tile of the entry the dialog showed when it closed, if that tile is on the current page; the tile now at the opening tile's position on the page, or the last tile if the page got shorter; the results line, after the page is clamped. When a refetch emptied the collection while the dialog was open, the empty state is under it and focus goes to its heading `No cards yet` (`tabindex="-1"`): like the results line, it says what is there now, and `Open a pack` is the next Tab stop (manager decision, 2026-10-30).
4. While the dialog is open, a refetch can remove its entry (§4.5 "entry gone"). If focus was inside the details, the control that held it goes with them: focus moves to the message `You no longer have this card.`, a focus target (`tabindex="-1"`) and the first thing in the body under the close button, so a screen reader hears what replaced the details. It never falls to `<body>`. Focus on the dialog itself or on the close button stays where it is (manager decision, 2026-10-30).

### 3.8 What the UI needs from the server

Per screen, with the field that supplies it. ✓ means the server supplies it as needed (`collection-packs.md` as shipped in #28, `economy.md` as landed in 0562e10); Ex refers to §3.9.

**Cards view** (`GET /api/collection`, `CollectionResponse`, `collection-packs.md` §6.2 with `economy.md` §11.2's additions)

| Need                                                         | Field                                                             | Status                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------- |
| One tile per entry, keyed by character and rarity            | `entries[].character.id`, `entries[].rarity` (six tiers)          | ✓                                         |
| Reserved kind and variant (ignored while each has one value) | `entries[].kind` (`"card"`), `entries[].variant` (`"standard"`)   | ✓                                         |
| Name, native name, art                                       | `character.name`, `character.nameNative`, `character.imageUrl`    | ✓                                         |
| Rank chip on the card, and the pool size it is out of        | `character.rank`, `snapshot.characterCount`                       | ✓                                         |
| Franchises per character, primary first                      | `character.franchiseIds`                                          | ✓                                         |
| Franchise titles for tile, search, filter, disambiguation    | `franchises[]`: `id`, `title`, `titleNative`, `startYear`         | ✓                                         |
| Copies                                                       | `count`                                                           | ✓                                         |
| Listed and available copies                                  | `listed`, `available`                                             | pending: economy PRs (`economy.md` §11.2) |
| Recyclable duplicates                                        | `recyclable`                                                      | pending: economy PRs (`economy.md` §11.2) |
| Sort and facts dates                                         | `firstObtainedAt`, `lastObtainedAt`                               | ✓                                         |
| Current tier and snapshot membership                         | `character.tier`, `character.inCurrentSnapshot`                   | ✓                                         |
| Totals line, header link label                               | `totals.cards`, `totals.duplicates`, `totals.byRarity` (six keys) | ✓                                         |
| Pool completion                                              | `completion.pool.owned`, `.total`                                 | ✓                                         |
| Series option labels and the filtered series line            | `completion.franchises[]` by `franchiseId`                        | ✓                                         |

`listed`, `available` and `recyclable` are not in `CollectionEntry` as shipped in #28: they arrive with the economy PRs that add `economy.md` §11.2 to the contract, and the card dialog's facts, the tile's listed line and the List and Recycle sections that read them land with those PRs (manager decision, 2026-10-30).

**Series view**: `completion.franchises[]` in the server's popularity order, every franchise of the current snapshot including 0-owned rows; titles through `franchises[]`; `snapshot.takenAt` for the source line (all ✓).

**Card dialog** (the entry above, plus `GET /api/wallet`, `Wallet`)

| Need                                | Field                                              | Status |
| ----------------------------------- | -------------------------------------------------- | ------ |
| Other entries of the same character | the held `entries[]` (same `character.id`)         | ✓      |
| Price bounds for this rarity        | `rules.priceMin[rarity]`, `rules.priceMax[rarity]` | ✓      |
| Fee preview                         | `rules.feeBps`, `rules.feeMin`                     | ✓      |
| Listing time                        | `rules.listingTtlSeconds`                          | ✓      |
| Listing cap, before a request       | `rules.maxListings`, `activeListings`              | ✓      |
| Recycle value per tier              | `rules.recycleValues[rarity]`                      | ✓, E8  |
| Balance                             | `balance`                                          | ✓      |

**List on the market**: `POST /api/market/listings`, `ListBody` `{ requestId, characterId, rarity, price }`. Success `Listing` (201, 200 on a replay) with `price`, `fee`, `expiresAt`. Errors used: 400 `price_out_of_bounds`, 409 `not_enough_copies`, `listing_limit`, `request_id_reused`, 400 `validation_failed`, 401, 403 `bad_origin`, 429 `rate_limited` (all ✓). The `Listing` carries no updated entry or totals, so the view refetches the collection.

**Recycle for Karma**: `POST /api/collection/recycle`, `RecycleBody` `{ requestId, characterId, rarity, count }` (`count` 1 to `rules.maxRecycleCount`); success `RecycleReceipt` (201, 200 on a replay) with `recycled` (`characterId`, `rarity`, `count`), `credited` and `balance`, and no card; errors 409 `not_enough_copies`, `balance_limit`, `request_id_reused`, 400 `validation_failed`, 401, 403 `bad_origin`, 429 `rate_limited` (all ✓, `economy.md` §11.2, §11.3). The view refetches the collection after the answer.

**Request ids**: each confirmation creates `crypto.randomUUID()` when its confirm button is first pressed, keeps it while no answer has arrived (`Try again` resends the identical body with it), and discards it on any answer from the server and on `Cancel`. This is 1c's pack pattern (`collection-packs.md` §8).

**What the UI computes, and nothing more**: filtering, searching, sorting, paging, the series option list, the fee and net preview on the listing form (§3.5 step 2), the recycle total (number × value, §3.6 step 1), the listing time in days, which last-copy sentence a confirmation needs, and the order of the Series view's `Title, A to Z`. It never computes a count of cards, a completion figure, a balance or an outcome, and it never repeats an action by itself.

### 3.9 Mismatches and dependencies

Against `collection-packs.md` as shipped in #28 and `economy.md` as landed on `main` in 0562e10. Each open item is for the manager to settle; this spec designs around none of them silently, and says what it does meanwhile.

**Settled.** `collection-packs.md` carries six tiers in the contract, the rank and the pool size (`card-and-rarity.md` §12), franchises (`franchiseIds`, `FranchiseRef`, `completion.franchises`), the reserved `kind` and `variant`, and the card tokens in its web PR. `economy.md` carries `feeMin`, the balance on `insufficient_funds`, native names and titles in the market's search, and `Wallet.activeListings`; and, for `market-and-shop.md`, `closedAt`, the `limit` on `market_limit`, `ThemeOffer.cards`, `ThemeOffer.franchiseIds` for both kinds, `filterFranchiseIds`, and an `active` list without expired listings. The owner's decided build order (§9.1) settles the delivery order. Two notes stand with no change asked: the listing time arrives in seconds and is shown in days (whole days when divisible by 86 400, else hours), and listing and recycle answers carry no updated entry, so the view refetches.

**The previous revision's mismatches, all settled in `economy.md` as landed**

| #   | Was                                                                                                             | Settled by                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Recycle was still the tier recycle (five copies into a random character of the next tier), and created no Karma | §8.2, §8.7, §11.2: duplicates recycle for `rules.recycleValues[rarity]`, a quarter of the reference value rounded down and at least 1, as a ledger credit; no tier recycle; ADR 0011 §2 and §4 amended                                      |
| E2  | The request and receipt of a recycle for Karma                                                                  | §11.2: `RecycleBody` with `count` (1 to `maxRecycleCount`) and no Karma amount; `RecycleReceipt` with `recycled`, `credited` and `balance`, no card; no `insufficient_funds` or `pool_unavailable`, and a new `balance_limit` (§3.6 step 7) |
| E3  | Which copies are recyclable                                                                                     | §11.2: `CollectionEntry.recyclable` = `min(count − 1, available)`, the server's number                                                                                                                                                      |
| E4  | The market fee was 10 %                                                                                         | §5: `MARKET_FEE_BPS` 500 (5 %), `MARKET_FEE_MIN` 1, rounded up                                                                                                                                                                              |
| E5  | Decided questions still open there                                                                              | §16 round 3, decisions 7, 8 and 12; §17 has no open question                                                                                                                                                                                |

E2 and E3 also answer this spec's two open questions (§9.2) with their recommended options: the recycle request carries only the count, and `recyclable` counts unlisted copies. The owner's answer is not recorded in either spec's decision record, so §9.2 keeps them, marked as such.

**Still open**

| #   | Mismatch                                                                                                                                                                                                                                                                                                                                                                                             | This spec meanwhile                                 | Asked of `economy.md`                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| E8  | **Five-tier numbers.** `economy.md` says itself that it is not buildable yet: `REFERENCE_VALUE`, `RECYCLE_VALUE`, `MARKET_PRICE_MIN` and `MARKET_PRICE_MAX` have no Uncommon, are derived from the five-tier per-slot odds (§5.1, §5.2), and §11.2 and §12 still say `PerRarity` has five tiers. 1c shipped six tiers with five different slot tables, so there is no single per-slot rate to invert | Placeholders for every amount; six tiers everywhere | Re-derive §5, §5.1, §5.2 and §9 for six tiers on 1c's shipped tables (`collection-packs.md` §5.4.1, §5.4.6) |

The shop's open items (its odds fields and the rank chip on the market) are in `market-and-shop.md` §3.8.

**Dependencies: placeholders for numbers being recomputed in `economy.md`**

| Placeholder          | Meaning                                                                                     | Used in    |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------- |
| `<ref T>`            | reference value of tier T, six tiers with Uncommon (five-tier in `economy.md` §5 today, E8) | §3.5, §3.6 |
| `<recycle T>`        | Karma per recycled duplicate of tier T: a quarter of `<ref T>`, rounded down, at least 1    | §3.6, §8   |
| `<min T>`, `<max T>` | market bounds of tier T: half and two and a half times `<ref T>`                            | §3.5, §8   |
| `<feePct>`           | the market fee, `feeBps` as a percentage (5 %, `economy.md` §5)                             | §3.5, §8   |

The UI reads every one of them from `GET /api/wallet`; none is written into a string or a constant. The card's six tiers, its rank and the pool size are in 1c's shipped contract (`card-and-rarity.md` §12, R1 and R2).

## 4. States

### 4.1 Collection view

| State                                                | User sees                                                                                                                                                                                                                                     | User can do                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| first load, within 300 ms                            | Nothing in the main area                                                                                                                                                                                                                      | Wait                                                                |
| loading (after 300 ms)                               | Stats skeleton (two bars), the view switch and toolbar rendered and disabled, 12 skeleton tiles; visually hidden `Loading your collection…` in a `role="status"`                                                                              | Wait                                                                |
| empty                                                | Heading `No cards yet` and `Open a pack`; no stats, no view switch, no toolbar                                                                                                                                                                | Open a pack (a link to `/packs`; focus goes to its `Packs` heading) |
| loaded, Cards view                                   | Stats, view switch, toolbar, results line, grid, pages when there are more than 60 results                                                                                                                                                    | Everything                                                          |
| loaded, Series view                                  | Stats, view switch, the series sort, every series row, the source line                                                                                                                                                                        | Sort, Show cards, switch back                                       |
| loaded, no snapshot (`snapshot: null`, entries held) | As loaded, without the pool completion figure, its percentage and its bar: there is no pool to complete; the totals stay (manager decision, 2026-10-30)                                                                                       | Everything                                                          |
| refreshing (data held)                               | The held data, unchanged; nothing marks the refetch: the results line it changes is not announced, since only the player's changes (search, filters, sort, paging, `Clear filters`) send it to the live region (manager decision, 2026-10-30) | Everything                                                          |
| stale (refetch failed, data held)                    | The held data; under the totals the note `Showing your collection as of <HH:MM>.` (the time the held data arrived); the app-level unreachable banner when the network is the cause; listing and recycling disabled with their reason          | Browse, open cards, `Try again` in the banner                       |
| error (nothing held)                                 | `Couldn't load your collection.` and `Try again` in place of stats and grid; the app-level unreachable banner as well when the network is the cause                                                                                           | Try again                                                           |
| session ended                                        | `accounts.md` §4.8                                                                                                                                                                                                                            | Log in                                                              |

### 4.2 Toolbar and results (Cards view)

| State                    | User sees                                                                                                                                | User can do                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| default                  | Search empty, rarity `All` pressed, `All series`, duplicates off, `Rarity, rarest first`; no `Clear filters`; results line `<N> results` | Search, filter, sort        |
| filtered                 | The results line counts the matches; `Clear filters` visible; with a series filter, the series line under the pool completion            | Clear                       |
| several tiers pressed    | Those chips filled; `All` not pressed; the grid shows entries of any pressed tier                                                        | Press or release chips      |
| typing                   | The grid updates per keystroke; the live region gets the results line 500 ms after the last keystroke                                    | Type, Escape clears         |
| no matches, with search  | In place of the grid: `No cards match "<query>".` and `Clear filters`                                                                    | Clear, edit the search      |
| no matches, filters only | `No cards match these filters.` and `Clear filters`                                                                                      | Clear                       |
| several pages            | Results line `<N> results · page <page> of <pages>`; pages under the grid                                                                | Previous, Next, pick a page |

### 4.3 Series view

| State                | User sees                                                                                   | User can do                  |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| default              | Every series in popularity order, each with `<owned> of <total>` and a bar; the source line | Sort, Show cards             |
| series with no card  | The row reads `0 of <total>`, the bar's track empty, no `Show cards`                        | —                            |
| complete series      | `<total> of <total>` and a full bar, like any other row                                     | Show cards                   |
| sorted by title      | The same rows by title A–Z                                                                  | Sort back                    |
| Show cards activated | The Cards view filtered to that series, page 1, focus on the results line                   | Everything in the Cards view |

### 4.4 Tile

| State         | User sees                                                                                 | User can do       |
| ------------- | ----------------------------------------------------------------------------------------- | ----------------- |
| default       | The card (name, stars, art, rank, series); under it `×<N>` when N is 2 or more            | Open              |
| listed        | As default, plus the line `<L> listed`                                                    | Open              |
| hover         | Epic and up: the glint or drift plays (`card-and-rarity.md` §5.3); nothing moves or lifts | Open              |
| focus         | The violet focus ring with an offset                                                      | Enter/Space opens |
| image loading | The art placeholder (`card-and-rarity.md` §3.3)                                           | Open              |
| image failed  | The placeholder with `No image` centred                                                   | Open              |

### 4.5 Card dialog

| State                        | User sees                                                                                                                                                                                                                              | User can do          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| open                         | Close button, art, name (heading), native name, series, `Also in`, facts, at most one note, List on the market, Recycle for Karma                                                                                                      | List, recycle, close |
| tier moved                   | Under the facts: `Packs now give <name> as <Tier>.`                                                                                                                                                                                    | As open              |
| out of pool                  | Under the facts: `No longer in packs. Doesn't count toward completion.`                                                                                                                                                                | As open              |
| stale (collection or wallet) | `List…` and `Recycle…` disabled, reason `Listing and recycling wait until the game server answers.`                                                                                                                                    | Close                |
| entry changed by a refetch   | The facts show the server's new counts; reasons follow them                                                                                                                                                                            | As open              |
| entry gone after a refetch   | Body replaced by `You no longer have this card.` and `Close`; focus inside the details moves to the message (§3.7 step 4). When the collection is now empty, the dialog stays open over the empty state (manager decision, 2026-10-30) | Close                |
| session ended                | The dialog closes; `accounts.md` §4.8                                                                                                                                                                                                  | Log in               |

### 4.6 List on the market

| State               | User sees                                                                                                                 | User can do                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| idle                | `Price` (empty), hint `<min> to <max> Karma`, `List…`, `See <name> on the market`                                         | Type a price, List…, see market |
| price in bounds     | Under the field: `Fee <fee> Karma (<feePct>). You get <net> Karma if it sells.`                                           | List…                           |
| nothing available   | `List…` disabled, reason `Every copy is already on the market.`                                                           | See market                      |
| invalid price       | Field `aria-invalid`, red border, error under it, focus to the field; nothing sent                                        | Fix                             |
| confirm             | The confirmation panel (§8), `List for <P> Karma`, `Cancel`                                                               | Confirm, cancel, Escape         |
| listing             | `Listing…`; the button, `Cancel` and Escape disabled; counts unchanged                                                    | Wait                            |
| listed              | Details with the refetched counts and `On the market`, the status line, focus on the heading, the field cleared           | Continue                        |
| bounds changed      | Details, the neutral notice, the field error with the new bounds                                                          | Fix the price                   |
| something changed   | Details refreshed from the server, the neutral notice above the section                                                   | Check, list again               |
| listing cap reached | Details with the red line and `My listings`                                                                               | Go to My listings, close        |
| rate limited        | Confirmation; the button disabled, reading `Try again in <S> s` in `tabular-nums`; the status line once; `Cancel` enabled | Wait, cancel                    |
| wait over           | The button back to `List for <P> Karma`; live region `You can try again now.`                                             | Confirm                         |
| server failure      | Confirmation with the red banner; the button enabled                                                                      | Confirm again, cancel           |
| no answer           | Confirmation body replaced by the red banner, `Try again` (same request) and `Cancel`                                     | Try again, cancel               |
| trying again        | `Listing…`, disabled                                                                                                      | Wait                            |

`Cancel` from the no-answer state refetches the collection and returns to the details as the server now shows them; if that refetch fails, the stale state applies.

### 4.7 Recycle for Karma

| State                                                      | User sees                                                                                                     | User can do                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------- |
| idle                                                       | Value line, `Duplicates` (starting at `recyclable`), hint `1 to <max>`, `You get <total> Karma.`, `Recycle…`  | Change the number, Recycle… |
| no duplicates                                              | No field; `Recycle…` disabled, reason `No duplicates. The last copy can't be recycled.`                       | —                           |
| duplicates all on the market                               | No field; `Recycle…` disabled, reason `Copies on the market can't be recycled.`                               | —                           |
| invalid number                                             | Field `aria-invalid`, red border, error under it, focus to the field; nothing sent                            | Fix                         |
| confirm                                                    | The confirmation panel (§8), `Recycle for <total> Karma`, `Cancel`                                            | Confirm, cancel             |
| recycling                                                  | `Recycling…`; the button, `Cancel` and Escape disabled; counts and balance unchanged                          | Wait                        |
| recycled                                                   | Details with the refetched counts, the status line, focus on the heading; the header balance from the receipt | Continue                    |
| value changed                                              | As recycled, with the added sentence naming the current value                                                 | Continue                    |
| something changed, rate limited, server failure, no answer | As §4.6                                                                                                       | As §4.6                     |

### 4.8 Cross-cutting

Session ended and server unreachable behave as in `accounts.md` §4.8. Any `unauthenticated` answer closes the dialog and replaces the page with `/login`, `/collection` held as the return path (`navigation-and-landing.md` §3.5 step 8); after logging in the player is back on `/collection` with search, filters, sort, view and page at their defaults, since they went with the account state. An unreachable server shows the app-level banner, and this view keeps whatever the server last returned (the stale state).

## 5. Layout

### 5.1 Grid

The grid is set by the tile's minimum width, not by the device:

- Minimum tile width **10.5rem (168 px)**, gap `gap-3` (12 px), never fewer than **2 columns**: `grid-template-columns: repeat(auto-fill, minmax(min(10.5rem, calc(50% - 0.375rem)), 1fr))`.
- Inside the existing page container (`max-w-6xl`, `px-4`, `sm:px-6`, so at most 1104 px of content) this gives the same column counts as today's collection grid, each reached a little earlier because the tile decides, not the breakpoint:

| Viewport width | Columns | Today's grid                     |
| -------------- | ------- | -------------------------------- |
| below 560 px   | 2       | 2                                |
| 560–755 px     | 3       | 2 below 640 (`sm`), 3 from 640   |
| 756–935 px     | 4       | 3 below 768 (`md`), 4 from 768   |
| 936–1115 px    | 5       | 4 below 1024 (`lg`), 5 from 1024 |
| 1116 px and up | 6       | 5 below 1280 (`xl`), 6 from 1280 |

- Below 348 px of content the 2-column floor makes tiles narrower than the minimum (138 px at a 320 px viewport). The card keeps 5:7 and its text truncates.
- A page of 60 entries fills whole rows at 2, 3, 4, 5 and 6 columns (60 is their least common multiple), so only the last page can end on a short row.
- Tiles in a row stretch to the tallest (a listed tile has one more line); the art stays at the top, the text block grows downward.
- Two characters can share a name; the series line tells them apart, and the tile's accessible name includes it.

### 5.2 Stats, view switch and toolbar

Top to bottom inside `<main>`: stats, view switch, then the Cards view (toolbar, results line, grid, pages) or the Series view (sort, list, source line).

**Stats**

- Line 1: `412 of 2,983 characters` and `13%`, one row, wrapping on a phone.
- Series line, only with a series filter in the Cards view: under line 1, truncated to the line.
- Bar under them: full width up to `max-w-md`.
- Totals line: `214 cards · 153 duplicates`, then the six tiers lowest first, `Common 120`, `Uncommon 58`, `Rare 27`, `Epic 7`, `Legendary 2`, `Mythic 0`, each shown even at 0, wrapping as needed (a phone wraps after the duplicates).
- The stale note, when shown, under the totals line.

**View switch** (`mt-6`): `Cards` and `Series`, side by side, left-aligned, at every width. The group can take a further button later (§2, Relics) without changing this row.

**Toolbar** (Cards view, `mt-4`), a visible label above each control; the rarity chips have their own row because six tiers do not fit a select's width:

| Width          | Arrangement                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| below 640 px   | Row 1: Search, full width. Row 2: Series and Sort, half each. Row 3: the rarity chips, wrapping (two lines at 320 px, manager decision, 2026-10-30). Row 4: Duplicates only, then Clear filters |
| 640–1023 px    | Row 1: Search, full width. Row 2: Series and Sort, half each. Row 3: the rarity chips, then Duplicates only and Clear filters, wrapping as one row                                              |
| 1024 px and up | Row 1, bottom-aligned: Search (grows, at least 14rem), Series (14rem), Sort (12rem). Row 2: the rarity chips, Duplicates only, Clear filters                                                    |

Select widths are fixed so the row does not shift when a long series title is chosen; the chosen title truncates inside the select. The chips keep their order (`All`, then lowest tier first) at every width; `gap-2`.

### 5.3 Results line, pages and the Series list

- The results line sits `mt-4` above the grid; the grid follows at `mt-3`.
- Pages: `mt-6`, a centred row: `Previous`, the page select (`Page`, a `<select>` of 1 to `<pages>` at `w-20`, then `of <pages>`), `Next`. Hidden with a single page. `Previous` is disabled on page 1 and `Next` on the last page.
- Changing page scrolls the results line to the top of the viewport (instantly, no smooth scroll) and focuses it.
- **Series view**: the sort select (`w-48`, label above) at `mt-4`; the list at `mt-3`, full width up to `max-w-3xl`; the source line `mt-4`.
  - Each row is a grid with `border-b border-zinc-800 py-2.5`.
  - Below 640 px: `grid-cols-[1fr_auto]`; row 1 the title across both columns (two lines at most, then truncated); row 2 the bar (`w-full`) with the figure on its right, and `Show cards` under them at the left. Rows without the button are shorter.
  - 640 px and up: one line, `grid-cols-[1fr_6rem_10rem_7rem] items-center gap-4`: title (truncated), figure (right-aligned), bar, `Show cards` (right-aligned; an empty cell when absent, so the columns stay aligned).

### 5.4 Card dialog

- The Manage account dialog's shell with `max-w-2xl` instead of `max-w-lg`; `max-h-[85vh]`, the body scrolls, the backdrop is unchanged. The close button sits top right, as there.
- `sm` and up: two columns, `grid grid-cols-[15rem_1fr] gap-6`: the card at dialog size on the left (240 × 336 px, `card-and-rarity.md` §3.2), and on the right the heading block (name, native name, series, native title, `Also in`), facts, note and sections.
- Phone: the card at 200 × 280 px, centred, above the heading block; `Also in`, facts, note and sections full width below.
- `Also in`: a label and a comma-separated run of titles, wrapping; more than five show the first five and `and <N> more` as a text button that reveals the rest in place.
- List on the market and Recycle for Karma sit under the facts, separated by `border-t border-zinc-800 pt-5 mt-5`, each with an `h3`.
- The price row, at every width: `flex items-end gap-2`: the `Price` field (`w-24`, label above), the word `Karma` (aligned with the field's text baseline), then `List…` with `ml-1`. At a 320 px viewport the row needs 226 px of the dialog's 240. The hint, the fee line, an error and the market link stack under the row.
- Confirmations replace the body below the close button, like the delete confirmation in Manage account. Buttons stack full width on a phone and sit side by side from `sm`, the primary first in DOM order and on the right (`sm:flex-row-reverse sm:justify-start`).
- The recycle row, at every width: `flex items-end gap-2`: the `Duplicates` field (`w-20`, label above), then `Recycle…`. The hint, the credit line and an error stack under it.

### 5.5 Large collections: one response, paged in the browser

The pool is 2,983 characters (the first real snapshot after the franchise cap, `collection-packs.md` §5.1.10), but the read is bounded by what the account **owns**, not by the pool: one entry per owned character, plus one per tier move (§3 terms). A new player's answer is a few kilobytes. A complete collection of today's pool is about 3,000 entries and some 700 KB of JSON (`collection-packs.md` §5.5); the hard ceiling is one snapshot's `SNAPSHOT_CHARACTERS_MAX` (6,000) plus the entries that snapshot updates add.

**Decision: keep one response, and page in the browser.**

- **Why one response.** The stats, the series option list, the Series view, the last-copy sentences and all four sorts need the whole collection. Paging on the server would move search, filters and sort into query parameters, add a request per keystroke, and make the series options and the last-copy check need further reads. The market is paged on the server because its read is every player's listings (`market-and-shop.md` §3.4); a collection is one player's.
- **Why it stays fast.** Normalised search fields are built once per answer (§3.3 step 5), so a keystroke is a substring scan over at most a few thousand short strings: well under a frame. The Series view is under 100 rows.
- **Why pagination.** What thousands of tiles cost is DOM and images. The grid shows **60 entries per page**. Every rendered tile is a real element, so Tab order, screen-reader browse mode and find-in-page work. At most 60 images load per page, lazily. "Page 2 of 34" is a position a player can get back to, and the page select reaches page 34 without 33 clicks. 60 fills whole rows at every column count (§5.1). It needs no dependency.
- **Why not virtualisation.** It adds a dependency (a T2 review). It removes off-screen tiles, which breaks find-in-page and screen-reader browsing and can drop the focused tile. A responsive auto-fill grid also needs measured rows before it can be virtualised. At 60 tiles a page it buys nothing.
- **Measured, and kept (manager decision, 2026-10-30).** Client-side search and paging stay. Over 3,000 fixture entries (`makeLargeCollection`, the build PR's fixture): the search itself takes about 0.75 ms a keystroke (0.40 ms in Node on the owner's station, with the search fields built once per answer in 16 ms); from a keystroke to the new page of tiles painted, Chromium on the production build took 15 to 33 ms unthrottled (median 24 ms, 16 keystrokes) and 85 to 380 ms with the CPU throttled 4× (median about 190 ms). That time is mounting 60 cards, which server-side paging would not remove: a page from the server mounts the same 60 cards, after a round trip. The grid's update is deferred (`useDeferredValue`), so the field takes each keystroke at once and typing interrupts a render still in progress.
- **When to revisit** (any one, manager decision, 2026-10-30; it replaces only the earlier 16 ms a keystroke at 4× throttling, which measured the mount rather than the search): the `GET /api/collection` answer exceeds 1 MB; `SNAPSHOT_CHARACTERS_MAX` is raised; a player's collection exceeds about 10,000 entries; the keystroke-to-results time on the production build exceeds 100 ms unthrottled. Then the read moves to server-side paging with search, filters and sort as request parameters, like the market's, and this section is rewritten. The build PR's unit test renders 3,000 fixture entries and asserts that at most 60 tiles are in the DOM.

### 5.6 Truncation and AniList text (T1)

Names, native names, franchise titles, native titles and image URLs come from AniList through the server; the search query and the price come from the player. All of them are untrusted (`docs/05-security.md`, T1).

1. Rendered as React text only; no `dangerouslySetInnerHTML` (C9, lint-enforced).
2. Each AniList string sits in its own element with `dir="auto"` (a `<bdi>` where it sits inside a sentence). Counts, rarity words, separators and amounts sit in sibling elements, so a right-to-left override in a name cannot reorder `×3` or `120 Karma`.
3. In plain-string contexts (`<option>` text, `aria-label`, `title`, live-region text) each AniList string is wrapped in U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL ISOLATE. The string itself is not altered.
4. One-line renderings (tile name and series, the series line in the stats, a Series view row's title from `sm`) use `truncate` and carry `title` with the full string. The dialog heading, series lines, `Also in`, confirmation headings and bodies, the result heading and the no-match message wrap with `break-words` (`overflow-wrap: anywhere`), so a 200-character name without spaces stays inside the dialog.
5. Series option labels are cut at 60 grapheme clusters (`Intl.Segmenter`) followed by `…`. The full title still matches a search.
6. Tile text lines clip vertically (`overflow-hidden` with `leading-tight`), so a stack of combining marks cannot paint over the tile below.
7. `imageUrl` is only ever an `<img src>`. An image the browser cannot load, or that the CSP (C8) refuses, shows the `No image` box. A new address, as a refetch after a snapshot update brings, resets the art: the new image is asked for and shows on the placeholder until it loads. The address that failed is not tried again while the card shows it (manager decision, 2026-10-30). Card art is never a link.
8. Normalisation (§3.3) is for matching only. Everything on screen is the original string.
9. The price field accepts digits only after trimming; the value sent is the parsed integer, never the raw text.

The T1 test for this feature uses a name, a native name, a franchise title, a native title and a search query of each of: `<img src=x onerror=alert(1)>`, an RTL override (U+202E … U+202C), 200 characters without a space, and a stack of 50 combining marks. It checks that each appears as text in the tile, the dialog heading, `Also in`, a confirmation heading, the series option, a Series view row and the no-match message; that no `[onerror]` attribute and no `img` other than the card art exists; and that the count, the stars, the rank and amounts are siblings of the name's element, not inside it.

## 6. Visual treatment

**Tokens.** This feature adds and changes none. The card, the tiers, their colours, frames, effects and tokens are `docs/design/card-and-rarity.md`; the tokens land in the 1c web PR, the first to render a card.

### 6.1 Rarity as a system

The six tiers, their frames, stars, rank line, colours, contrast and motion are **`docs/design/card-and-rarity.md`**, which supersedes the five-tier hue ladder this section held. This view uses:

- the card at tile size (§6.2) and at dialog size (§5.4);
- the tier text colours `--color-rarity-<tier>-text` for every tier word and number outside a card (chips, totals, facts, odds), all at least 4.5:1 on `zinc-900` and `zinc-950` (`card-and-rarity.md` §4.2);
- the mark colours `--color-rarity-<tier>` for chip borders and fills.

Rarity is never colour alone: on a card the stars carry it, elsewhere the tier word.

### 6.2 Tile

The tile is the card (`card-and-rarity.md` §3) at tile size, inside a button, with a caption under it. The market's browse grid uses the same tile with its own caption (`market-and-shop.md` §6).

- Box: `<button type="button">`, `flex flex-col gap-1.5 text-left`, no border or background of its own. Focus: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950` around the card. No translate, no scale, no shadow beyond the card's own glow.
- Card: fluid width (the grid's column), 5:7, by the entry's **granted** rarity; effects per `card-and-rarity.md` §5.3 (in the grid: glow always, glint and drift on hover and focus).
- Caption, `flex items-baseline justify-between gap-2 px-0.5 text-xs leading-tight tabular-nums`, always one line high so rows align: `×<N>` in `text-zinc-300` (only for N of 2 or more) on the left, `<L> listed` in `text-zinc-400` (only when `listed` ≥ 1) on the right; empty but present otherwise.
- No `NEW` badge in the collection.
- Skeleton tile: a 5:7 box `rounded-xl bg-zinc-800` and a caption-height gap. Static: nothing shimmers or pulses.

### 6.3 Stats, view switch, toolbar, results, pages, Series view

- Completion line: the numbers in `text-base font-semibold text-zinc-100 tabular-nums`, the percentage in `text-sm text-zinc-400`. Series line `text-sm text-zinc-400`.
- Bars (pool and every Series row): track `h-1 rounded-full bg-zinc-800`, fill `bg-zinc-300`. A `0 of N` row shows the track alone. Not the accent and not a rarity colour; violet stays for primary actions and focus. The pool bar is `w-full max-w-md`.
- Totals line: `text-xs text-zinc-400`, `flex flex-wrap gap-x-4 gap-y-1`; each tier word in `text-rarity-<tier>-text`, its number in `text-zinc-200 tabular-nums`.
- Stale note: `text-xs text-zinc-400`.
- View switch: `inline-flex gap-1 rounded-lg bg-zinc-900 p-1`; each button `rounded-md px-3 py-1.5 text-sm font-medium`, pressed `bg-zinc-700 text-white`, not pressed `text-zinc-400 hover:text-zinc-200`, the violet focus ring. The header links' look at a smaller radius.
- **Rarity chips**: `rounded-md border px-2.5 py-2.5 sm:py-1.5 text-[11px] leading-[18px] font-semibold tracking-wider uppercase`, the violet focus ring. A tier chip not pressed: `border-zinc-800 bg-transparent`, the word in `text-rarity-<tier>-text`, hover `border-rarity-<tier>/40`. Pressed: `border-rarity-<tier>/80 bg-rarity-<tier>/15`, the word in `text-rarity-<tier>-text`. Chips sit on `zinc-950` only (`card-and-rarity.md` §4.2). `All`: not pressed `border-zinc-800 text-zinc-300`, pressed `border-zinc-600 bg-zinc-800 text-zinc-100`. The fill is the pressed cue, so it does not rest on hue alone. No glow, no shadow; nothing moves when pressed.
- Toolbar labels: `text-xs text-zinc-400`, above the control. Not the accounts hint colour (`zinc-500`): these labels are the controls' names and must reach 4.5:1 on `zinc-950`.
- Search, selects and the price field: the accounts `INPUT` classes (`rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100`, violet focus ring).
- Duplicates only: a native checkbox `size-4 accent-violet-600` inside its label, `text-sm text-zinc-200`; the whole label is clickable.
- Clear filters, `Show cards`, `See <name> on the market`, `My listings`, `and <N> more`: `BUTTON.text` (the Show/Hide toggle style) at `text-sm`.
- Results line: `text-sm text-zinc-400 tabular-nums`.
- Pages: `BUTTON.secondary` for Previous and Next; the page select `INPUT` at `w-20`; `of <pages>` `text-sm text-zinc-400 tabular-nums`.
- Series rows: title `text-sm text-zinc-200`, figure `text-sm text-zinc-300 tabular-nums`; source line `text-xs text-zinc-400`.
- Page heading: the `h1` `Collection` as every account page's (`navigation-and-landing.md` §5.2 and §6.3: left-aligned, `mb-6`, `text-xl font-bold text-zinc-100`, `focus:outline-none`), above the stats in every state.
- Empty state: `No cards yet` in `text-lg font-bold text-zinc-100`, `Open a pack` as a link with `BUTTON.primary`'s classes, centred, `py-16`. No dashed box, no illustration.
- No matches: the message in `text-sm text-zinc-400 break-words`, `Clear filters` as `BUTTON.secondary`, centred, `py-12`.
- Error: `Couldn't load your collection.` in `text-sm text-zinc-300`, `Try again` as `BUTTON.secondary`.

### 6.4 Dialog and confirmations

- Shell, headings, body text and buttons: `web/src/components/account/styles.ts` as it is (`PANEL_HEADING`, `SECTION_HEADING`, `BODY_TEXT`, `BUTTON.*`).
- The card in the dialog: `card-and-rarity.md` at dialog size, with every effect (subject to reduced motion).
- Name: `PANEL_HEADING` with `break-words`. Native name: `text-sm text-zinc-400`. Series: `text-sm text-zinc-400`. Native title: `text-xs text-zinc-400`. Native strings carry `lang="ja"` as the current card does, and are shown only when they differ from the name or title. `Also in`: label `text-xs text-zinc-400`, titles `text-xs text-zinc-300`.
- Facts: `<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">`, `dt` in `text-zinc-400`, `dd` in `text-zinc-200 tabular-nums`; the rarity value in `text-rarity-<tier>-text`, preceded by its stars.
- Notes (tier moved, out of pool): `text-sm text-zinc-300`.
- `List…`, `Recycle…`, `List for <P> Karma`, `Recycle for <total> Karma` and `Try again` are `BUTTON.primary`. Listing and recycling are ordinary game actions, not dangers; the confirmation copy carries "There is no undo." or "A sale can't be undone." `Cancel` and `Close` on a panel are `BUTTON.secondary`.
- Price field: `INPUT` at `w-24`, invalid `border-red-800`, error `ERROR_TEXT` under it; hint and fee line `text-xs text-zinc-400 tabular-nums`; the word `Karma` beside the field `text-sm text-zinc-400`.
- Disabled reasons under a button: `text-xs text-zinc-400`.
- Success status line: `text-sm text-zinc-200`.
- Neutral notice (something changed): the `STATUS_BANNER` style. Red banners (server failure, no answer): the `FormBanner` style with this feature's copy. Red lines (the listing cap): `ERROR_TEXT` at `text-sm`.
- `Duplicates` field: `INPUT` at `w-20`, with the price field's invalid, hint and error styles; the credit line `text-xs text-zinc-400 tabular-nums`.
- `New` marker, used by the market's buy result (`market-and-shop.md` §3.5): flat, `rounded border border-zinc-600 px-1.5 text-[11px] font-semibold tracking-wider uppercase text-zinc-200` (no fill, no glow; the 1c reveal's `NEW` should match it).
- Amounts are plain text `<amount> Karma`, formatted with `Intl.NumberFormat("en-GB")` (`1,240`). Percentages use `Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 2 })` (`10%`). No coin, wallet, cart or bag icon, and no currency symbol, in this view; Karma has no icon (decided, §9.1): an amount always reads `<n> Karma`.

### 6.5 Motion

- Dialog enter: the existing `pop-in` (150 ms).
- Completion bar fill: `transition-[width] duration-200` when the number changes after an action.
- Cards animate only as `card-and-rarity.md` §5.3 says; chips never animate. No `card-reveal` in the collection (the current Inventory re-runs it on every filter change), no hover lift.
- All of it is off under `prefers-reduced-motion: reduce`, the width transition included (`motion-reduce:transition-none`, `motion-reduce:animate-none`).

### 6.6 Not in this view

No gradients, glows, glass (backdrop blur), drop shadows, hover lift or zoom, emoji, sparkles, confetti, coin or store iconography, exclamation marks, or emphasis on Karma numbers (they are the same weight and colour as the text around them). The one exception is the card frames of Epic, Legendary and Mythic, by the owner's decision (`card-and-rarity.md` §5.4); it does not extend to anything else in this view.

## 7. Accessibility

- **Page and heading** (`navigation-and-landing.md` §3.6, §7): `<main>` starts with the visible `h1` `Collection` (`id="collection-heading"`, `tabindex="-1"`), the focus target of every navigation to the page after the first render and of the `Skip to content` link; the title `Collection · Anime TCG` is set before focus moves. `<main>` holds `<section aria-labelledby="collection-heading">`; the visually hidden `h2` `Collection` of the previous revision is gone, and headings below the `h1` start at `h2`. When the page is left with the card dialog open, the dialog closes with it and focus goes to the new page's `h1`.
- **View switch**: `<div role="group" aria-label="View">` with `<button aria-pressed>` per view. Switching keeps focus on the pressed button. The Series view is a `<section>` with a visually hidden `h2` `Series completion`.
- **Toolbar**: a `<search>` element labelled `Collection filters`. Every control has a visible label. Changes apply at once; Enter in the search field does nothing more (no submit, no reload). Escape in a non-empty search field clears it and keeps focus there.
- **Rarity chips**: `<div role="group" aria-labelledby>` pointing at the visible `Rarity` label, holding seven `<button type="button" aria-pressed>`. Each chip is one Tab stop; Space and Enter toggle it. Pressing `All` or releasing the last tier moves `aria-pressed` accordingly; focus stays on the chip pressed.
- **Controls and their names**:

| Control           | Element                                                                               | Accessible name                                                                      |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Search            | `<input type="search" maxlength="100" autocomplete="off" spellcheck="false">`         | `Search`                                                                             |
| Rarity chips      | `<button aria-pressed>` in a labelled group                                           | `All`, `Common`, `Uncommon`, `Rare`, `Epic`, `Legendary`, `Mythic` (group: `Rarity`) |
| Series            | `<select>`                                                                            | `Series`                                                                             |
| Duplicates only   | `<input type="checkbox">`                                                             | `Duplicates only`                                                                    |
| Sort (both views) | `<select>`                                                                            | `Sort`                                                                               |
| Clear filters     | `<button>`                                                                            | `Clear filters`                                                                      |
| Cards, Series     | `<button aria-pressed>`                                                               | `Cards`, `Series`                                                                    |
| Tile              | `<button aria-haspopup="dialog">` in an `<li>`                                        | `<name>, <Rarity>, <series>, <copies>`, then `, <L> listed` when listed              |
| Show cards        | `<button>`                                                                            | `Show cards from <title>`                                                            |
| Previous, Next    | `<button>`                                                                            | `Previous page`, `Next page`                                                         |
| Page select       | `<select>`                                                                            | `Page`, described by `of <pages>`                                                    |
| Open a pack       | `<a href="/packs">`, a real link the router intercepts                                | `Open a pack`                                                                        |
| Try again (view)  | `<button>`                                                                            | `Try again`                                                                          |
| Card dialog       | `<dialog aria-labelledby>`                                                            | the name heading; on a confirmation or the result, its heading                       |
| Close             | `<button>`                                                                            | `Close`                                                                              |
| Price             | `<input type="text" inputmode="numeric" autocomplete="off">` in a `<form noValidate>` | `Price`, described by the hint, the fee line and any error                           |
| Duplicates        | `<input type="text" inputmode="numeric" autocomplete="off">` in a `<form noValidate>` | `Duplicates`, described by the hint, the credit line and any error                   |
| List…, Recycle…   | `<button>`                                                                            | the visible text, described by the fee line or the value line and any reason         |
| See on the market | `<button>`                                                                            | `See <name> on the market`                                                           |
| Confirm buttons   | `<button>`                                                                            | the visible text, e.g. `List for 120 Karma`, `Recycle for 6 Karma`                   |
| Cancel, Try again | `<button>`                                                                            | the visible text                                                                     |

- **Grid**: `<ul role="list" aria-labelledby="collection-results">`. The explicit role keeps list semantics in Safari, which drops them under `list-style: none`. DOM order is visual order, row by row, so Tab, browse mode and sight agree. Tile art is `alt=""`: the name is already in the button's name.
- **Series list**: `<ul role="list">` of `<li>` rows; the title, then the figure as text (`3 of 12`); the bars are `aria-hidden="true"` because the figure carries the number. The pool bar is `aria-hidden` for the same reason.
- **Results line**: a plain paragraph with `id="collection-results"` and `tabindex="-1"` (a focus target). Its text goes to the app live region 500 ms after the last change the player makes (search, filters, sort, paging, `Clear filters`), never per keystroke; a refetch that changes it says nothing (§4.1 "refreshing", manager decision, 2026-10-30).
- **Pages**: `<nav aria-label="Pages">`. After a page change focus moves to the results line, which reads for example `2,014 results · page 2 of 34`.
- **Dialog**: native `<dialog>` with `showModal()`, which gives the focus trap, Escape and the inert background. Initial focus is the dialog element (`tabindex="-1"`), as in Manage account. A confirmation focuses its heading (`tabindex="-1"`) and points `aria-describedby` at its body, so a screen reader reads the exact outcome before reaching the button. After a success that keeps the dialog open, focus goes to the dialog heading and the status line (`role="status"`) is read.
- **Fee line and credit line**: not live regions (they change per keystroke); each is part of its field's description, and the confirmation repeats its numbers.
- **In flight**: the confirm button is disabled and keeps focus; it is never removed. Escape is ignored (the `cancel` event is prevented) until the answer arrives.
- **Disabled reasons** are visible text linked with `aria-describedby`, never tooltips.
- **Countdown**: as `accounts.md` §7 "Wait": the number lives in the button's text, which is not a live region; the status line is read once; `You can try again now.` goes to the live region when the wait ends.
- **Announcements**: the app-level live region (`role="status"`) receives the results line (debounced) and wait-over. Status lines inside the open dialog are `role="status"`; red banners are `role="alert"`.
- **Keyboard path, end to end**: Tab to the `Collection (<N>)` link in the header, Enter; focus moves to the `Collection` heading. Tab through the view switch, Search, Series, Sort, the rarity chips, Duplicates only and Clear filters (when shown), then into the tiles. Enter opens the dialog. Tab to `Price`, type, Tab to `List…`, Enter. The confirmation heading has focus; Tab to `List for …`, Enter. The status line is read. Tab to `Duplicates`, then `Recycle…`, Enter, Tab to `Recycle for …`, Enter; the status line is read. Escape closes; focus returns per §3.7. In the Series view, Tab moves through the sort and the `Show cards` buttons only. No step needs a pointer.
- **No arrow-key grid**: a page holds at most 60 tiles, one Tab stop each. A roving-tabindex grid would need the column count measured from the layout and adds a pattern screen-reader users must learn, for little gain at this size.
- **Contrast**: everything that must be read is `zinc-400` or lighter, or a tier text colour (`--color-rarity-<tier>-text`), on `zinc-900` or `zinc-950` (and on a pressed chip's `/15` fill over `zinc-950`): all at least 4.5:1, as `card-and-rarity.md` §4.2 computes; the card's own text pairs are checked there too. This view uses no `zinc-500` text. Frames are decorative; rarity is always also the stars or the word (WCAG 1.4.1).
- **Touch targets**: every control is at least 40 px tall on a phone, the chips and the `BUTTON.text` links included (`py-2.5` and `py-2` on a phone; the chips' 11 px text sits in an 18 px line box, since its inherited 1.5 line height made them 38.5 px); tiles are far larger.
- **Reduced motion**: §6.5.

## 8. Copy

Exact strings. Placeholders: `<name>` the character name; `<series>` and `<title>` a series (franchise) title; `<Rarity>` the entry's granted rarity label (`RARITY_LABEL`); `<Tier>` the label of the character's current tier; `<N>` a count; `<copies>` the phrase `1 copy` / `<N> copies`; `<K>` the copies kept; `<L>` listed copies; `<A>` available copies; `<Q>` the duplicates to recycle; `<V>` the Karma per recycled duplicate (`<recycle T>`); `<total>` Q × V; `<credited>` the credit in the receipt; `<P>` the asking price; `<min>`, `<max>` the price bounds for the entry's rarity, and in the `Duplicates` hint and error `<max>` is `recyclable`; `<fee>` the market fee (preview, or the server's `Listing.fee`); `<feePct>` `feeBps` as a percentage (`5%`); `<net>` P − fee; `<days>` the listing time as `<N> days`; `<B>` the balance the server sent; `<S>` countdown seconds, or in the source line the number of series rows; `<owned>`, `<total>`, `<pct>` completion figures; `<page>`, `<pages>`; `<HH:MM>` from `Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })`; `<D Mon YYYY>` the `metaLine` date format (`day: "numeric", month: "short", year: "numeric"`); `<query>` the search as typed. Every amount comes from the server (§3.9 dependencies); none is written into a string. Numbers use `Intl.NumberFormat("en-GB")`. `Karma` is the currency's name, one constant in `web/src/lib/copy.ts` (`economy.md` §12); every `Karma` below is that constant. The player-facing word for a franchise is "series" (§3 terms).

**Words.** The words "secure", "verified", "protected", "safe", "private", "attempt", "locked" and "blocked" do not appear in any string below and must not be added (`accounts.md` §8). The market and shop words this feature needs are allowed: `Karma`, `price`, `fee`, `list`, `listed`, `listing`, `market`, `sell`, `sells`, `sold`, `buy`, `bought`, `cost`, `costs`. No other money words: no "pay", "paid", "cash", "money", "coins", "earn", "profit", "worth", "value", "balance", "wallet", "store", "checkout", "purchase", and no currency symbol. "Franchise" is not a player-facing word. **No casino nudges**: no exclamation marks; no urgency ("hurry", "ending soon", "last chance", "before it's gone", "don't miss"); no streaks; no "deal", "bargain", "discount", "save", "cheap", "steal"; no fake scarcity ("only <N> left", "rare find", "few on the market", "selling fast"); no "lucky", "jackpot", "win", "you could get", "try your luck"; no prompt near a completion threshold or after a recycle; nothing that comments on a balance going up. The copy test scans every string for these.

**Header link and page**

| Element                   | Copy                                                      |
| ------------------------- | --------------------------------------------------------- |
| Header link label         | `Collection (<N>)` / before the first answer `Collection` |
| Document title            | `Collection · Anime TCG`                                  |
| Page heading (`h1`)       | `Collection`                                              |
| Toolbar landmark label    | `Collection filters`                                      |
| Loading (visually hidden) | `Loading your collection…`                                |

**Stats and view switch**

| Element                                  | Copy                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Completion                               | `<owned> of <total> characters`                                                          |
| Completion percentage                    | `<pct>%` (rounded down)                                                                  |
| Series completion (Cards view, filtered) | `<series>: <owned> of <total> characters`                                                |
| Cards                                    | the existing `cardCount`: `No cards yet` / `1 card` / `<N> cards`                        |
| Duplicates                               | `No duplicates` / `1 duplicate` / `<N> duplicates`                                       |
| Separator between cards and duplicates   | `·`                                                                                      |
| Per rarity                               | `Common <N>` · `Uncommon <N>` · `Rare <N>` · `Epic <N>` · `Legendary <N>` · `Mythic <N>` |
| Stale note                               | `Showing your collection as of <HH:MM>.`                                                 |
| View group label (`aria-label`)          | `View`                                                                                   |
| View buttons                             | `Cards` · `Series`                                                                       |

**Series view**

| Element                       | Copy                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Heading (visually hidden)     | `Series completion`                                                          |
| Sort label                    | `Sort`                                                                       |
| Sort options                  | `Most popular first` · `Title, A to Z`                                       |
| Row figure                    | `<owned> of <total>`                                                         |
| Row title with a shared title | `<title>, <startYear>`                                                       |
| Row button                    | `Show cards` (accessible name `Show cards from <title>`)                     |
| Source line                   | `<S> series from the 100 most popular anime on AniList, as of <D Mon YYYY>.` |

**Toolbar**

| Element            | Copy                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search label       | `Search`                                                                                                                                                      |
| Search placeholder | `Name or series`                                                                                                                                              |
| Rarity label       | `Rarity`                                                                                                                                                      |
| Rarity chips       | `All` · `Common` · `Uncommon` · `Rare` · `Epic` · `Legendary` · `Mythic`                                                                                      |
| Series label       | `Series`                                                                                                                                                      |
| Series options     | `All series` · `<title> · <owned>/<total>` · with a shared title `<title>, <startYear> · <owned>/<total>` · not in the current snapshot `<title>` (no figure) |
| Duplicates         | `Duplicates only`                                                                                                                                             |
| Sort label         | `Sort`                                                                                                                                                        |
| Sort options       | `Rarity, rarest first` · `Name, A to Z` · `Newest first` · `Most copies`                                                                                      |
| Clear              | `Clear filters`                                                                                                                                               |

**Results and pages**

| Element                       | Copy                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Results line                  | `<N> results` / `1 result`; with pages `<N> results · page <page> of <pages>` |
| Live announcement, no results | `No results`                                                                  |
| Pages landmark label          | `Pages`                                                                       |
| Buttons                       | `Previous` · `Next` (accessible names `Previous page` · `Next page`)          |
| Page select label             | `Page`                                                                        |
| After the select              | `of <pages>`                                                                  |

**Empty, no matches, error**

| Element                  | Copy                             |
| ------------------------ | -------------------------------- |
| Empty heading            | `No cards yet`                   |
| Empty action             | `Open a pack`                    |
| No matches, with search  | `No cards match "<query>".`      |
| No matches, filters only | `No cards match these filters.`  |
| No matches action        | `Clear filters`                  |
| Load error               | `Couldn't load your collection.` |
| Load error action        | `Try again`                      |

**Tile**

| Element         | Copy                                                                |
| --------------- | ------------------------------------------------------------------- |
| Accessible name | `<name>, <Rarity>, <series>, <copies>`; listed: then `, <L> listed` |
| Count           | `×<N>` (N of 2 or more)                                             |
| Listed line     | `<L> listed`                                                        |
| Image fallback  | `No image`                                                          |

**Card dialog**

| Element              | Copy                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| Close (`aria-label`) | `Close`                                                                    |
| Also in label        | `Also in`                                                                  |
| Also in, more        | `and <N> more`                                                             |
| Facts labels         | `Rarity` · `Copies` · `On the market` · `First obtained` · `Last obtained` |
| Dates                | `<D Mon YYYY>`                                                             |
| Tier moved           | `Packs now give <name> as <Tier>.`                                         |
| Out of pool          | `No longer in packs. Doesn't count toward completion.`                     |
| Entry gone           | `You no longer have this card.`                                            |
| Entry gone action    | `Close`                                                                    |
| Stale reason         | `Listing and recycling wait until the game server answers.`                |

**List on the market**

| Element                                      | Copy                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Section heading                              | `List on the market`                                                                      |
| Price label                                  | `Price`                                                                                   |
| After the field                              | `Karma`                                                                                   |
| Hint                                         | `<min> to <max> Karma`                                                                    |
| Fee line                                     | `Fee <fee> Karma (<feePct>). You get <net> Karma if it sells.`                            |
| Price error                                  | `Choose a whole number from <min> to <max>.`                                              |
| Button                                       | `List…`                                                                                   |
| Reason, nothing available                    | `Every copy is already on the market.`                                                    |
| Market link                                  | `See <name> on the market`                                                                |
| Confirmation heading                         | `List <name> for <P> Karma?`                                                              |
| Body, first sentence                         | `One <Rarity> copy goes on the market for <days>.`                                        |
| Body, second sentence                        | ` If someone buys it, you get <net> Karma after the <fee> Karma fee.`                     |
| Body, third sentence                         | ` It stays in your collection until it sells, and you can cancel the listing until then.` |
| Body, only copy of the character             | ` This is your only <name>; once it sells, it stops counting toward completion.`          |
| Body, only copy, not in the current snapshot | ` This is your only <name>, and packs no longer include this character.`                  |
| Body, last available copy of this rarity     | ` That puts every <Rarity> copy you have on the market.`                                  |
| Body, last sentence                          | ` A sale can't be undone.`                                                                |
| Confirm button                               | `List for <P> Karma` / in flight `Listing…`                                               |
| Cancel                                       | `Cancel`                                                                                  |
| Success (inline status)                      | `Listed for <P> Karma until <D Mon YYYY>, <HH:MM>. The fee is <fee> Karma if it sells.`   |
| Listing cap (red)                            | `You have <max> cards on the market, the most at once. Cancel a listing to list another.` |
| Listing cap link                             | `My listings`                                                                             |

Here `<max>` is `rules.maxListings`.

**Recycle for Karma**

| Element                          | Copy                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| Section heading                  | `Recycle for Karma`                                                                         |
| Value line                       | `Each duplicate recycles for <V> Karma.`                                                    |
| Field label                      | `Duplicates`                                                                                |
| Hint                             | `1 to <max>`                                                                                |
| Credit line                      | `You get <total> Karma.`                                                                    |
| Field error                      | `Choose a whole number from 1 to <max>.`                                                    |
| Button                           | `Recycle…`                                                                                  |
| Reason, one copy                 | `No duplicates. The last copy can't be recycled.`                                           |
| Reason, duplicates on the market | `Copies on the market can't be recycled.`                                                   |
| Confirmation heading             | `Recycle <Q> duplicates of <name>?`; for one, `Recycle 1 duplicate of <name>?`              |
| Body, first sentence             | `<Q> <Rarity> <copy\|copies> become <total> Karma.`                                         |
| Body, copies kept                | ` You keep <K>.`; when some of them are listed, ` You keep <K>, <L> of them on the market.` |
| Body, last sentence              | ` There is no undo.`                                                                        |
| Confirm button                   | `Recycle for <total> Karma` / in flight `Recycling…`                                        |
| Cancel                           | `Cancel`                                                                                    |
| Success (inline status)          | `Recycled <Q> <copy\|copies> of <name> for <credited> Karma. You have <B> Karma.`           |
| Success, value changed (added)   | ` Each duplicate now recycles for <V> Karma.`                                               |
| Karma at its ceiling (red)       | `Your Karma is at its ceiling, so nothing was recycled.`                                    |

**Failures, for listing and recycling**

| Element                     | Copy                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- |
| Something changed (neutral) | `Something changed since you opened this card. Check the numbers and try again.` |
| Rate limited (status, once) | `That was a lot in a short time. Give it a few seconds.`                         |
| Countdown button            | `Try again in <S> s` (the existing `common.tryAgainIn`)                          |
| Wait over (live region)     | `You can try again now.` (existing)                                              |
| Server failure (red)        | `The game server couldn't finish this. Nothing changed. Try again.`              |
| No answer (red)             | `Couldn't reach the game server, so this may not have gone through.`             |
| No answer actions           | `Try again` (in flight: the confirm button's in-flight label) · `Cancel`         |

**Existing copy that changes**

| Element             | Old                                                     | New                                          |
| ------------------- | ------------------------------------------------------- | -------------------------------------------- |
| Empty collection    | `Your collection is empty. Open a pack to get started.` | `No cards yet` with the `Open a pack` button |
| Stats line          | `<N> cards · <U> unique` and the rarity chips           | The Stats strings above                      |
| Rarity filter label | `Filter by rarity` (visually hidden)                    | `Rarity` (visible, over the chips)           |

The Inventory `Reset` button and its confirmation are deleted by the 1c web PR (`collection-packs.md` §5.6, §8); no reset string exists in this view.

## 9. Decisions and open questions

### 9.1 Decided by the owner, 2026-10-29

| Question                              | Decision                                                                                                                                                          | Where                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Who builds the card dialog            | The collection overview is built right after 1c with a details-only dialog; `feat/economy-ui` adds Recycle for Karma and `feat/market-ui` adds List on the market | §3.4                       |
| A Karma icon                          | None: every amount reads `<n> Karma`                                                                                                                              | §6.4                       |
| The list price field's starting value | Empty, with the bounds as the hint and `See <name> on the market` beside it                                                                                       | §3.5                       |
| Where the Karma shop lives            | Its own Shop tab, which is now the `/shop` page (`navigation-and-landing.md` §3.1)                                                                                | `market-and-shop.md` §3.2  |
| Recycling                             | Duplicates only, never the last copy, for Karma at a quarter of the tier's reference value; no tier recycle                                                       | §3.6                       |
| Upgrades                              | Only in the mini-games (items 5, 6)                                                                                                                               | §2                         |
| Selling                               | Every card, the last copy included, on the player market; fee 5 %, at least 1, rounded up; bounds 0.5 × to 2.5 × the reference value; limits per rolling 7 days   | §3.5, `market-and-shop.md` |
| Themed packs                          | Genre packs automatically, plus franchise packs the owner picks; price about 2.3 × the expected card value                                                        | `market-and-shop.md` §3.3  |

### 9.2 Open

For the owner; each is a choice of three, and this spec is drawn for the recommended one. `economy.md` as landed already specifies option A for both (§3.9, under E2 and E3); the owner's answer is still to be recorded.

1. **If the recycle value changes between the confirmation and the server's answer** (a deploy changes `<recycle T>`: rare, but the player confirmed a number).
   - **A (recommended)**: the request carries only the count; the server credits its current value, and the success line states it and says the value changed. No Karma amount travels in a request, as `economy.md` §11.2 holds for every route but the seller's asking price.
   - B: the request also carries the total the confirmation showed, and the server refuses with "something changed" when its own total differs. The player never gets a number they did not see, but a Karma amount enters a request body.
   - C: the UI refetches the wallet whenever a confirmation opens. Narrows the gap to seconds without closing it, at one request per confirmation.
2. **Can a duplicate be recycled while another copy of the same entry is on the market?** (With two copies and one listed, recycling the unlisted one leaves only the listed one, which may then sell.)
   - **A (recommended)**: yes; `recyclable` is the smaller of copies − 1 and the unlisted copies. A listed card is still owned, as everywhere else, and listing a last copy is already the player's choice.
   - B: no; one unlisted copy always stays (`recyclable` = unlisted copies − 1). A player never ends up holding only a listed copy, but listing one card makes a duplicate unrecyclable.
   - C: no recycle at all while any copy of the entry is listed. The simplest rule, and the most surprising one.

## 10. Visual system follow-up

The collection overview can be built within the current tokens plus `card-and-rarity.md` §10. The rest of the app still carries the known debt of `docs/06-engineering-standards.md` §2, and this view sits next to it. What must change, and why; none of it blocks this feature:

1. **`CharacterCard` frame glow, `RarityBadge` and scrim**: replaced in the 1c web PR by the card of `card-and-rarity.md` (frames, stars, rank chip, no overlay badges, no gradient scrim); `legendary-pulse` and `.glow-legendary` go. Not this feature's work.
2. **`CharacterCard` hover lift and image zoom** (`hover:-translate-y-1`, `group-hover:scale-105`): hover-lift on everything. Remove.
3. **`RarityBadge` and the `×N` and `NEW` chips over the art**: drop shadow plus backdrop blur, which reads as glass. Move rarity and count under the art as in §6.2, or make them flat chips without blur or shadow; `NEW` as §6.4's flat marker.
4. **The gradient over the bottom of the art**: only there so overlaid text stays legible; it goes with item 3.
5. **Header and page**: the gradient title text and the explanatory subtitle "Open packs, collect characters." went with the navigation PR (#30: a plain wordmark, `navigation-and-landing.md` §6.1). The violet radial page background and the three-colour gradient pack button with an emoji remain, and belong to `docs/design/visual-system.md`, which does not exist yet. The header's layout with Karma (page links, balance, Account control) is `navigation-and-landing.md` §5.1 and `market-and-shop.md` §5.1.
6. **`rounded-2xl` on panels, dialogs and cards**: this view uses it only through the shared dialog shell; the radius scale is a visual-system decision.
7. **The avatar placeholder's gradient** (`accounts.md` §6): the pack button's gradient reused; replaced by card art in roadmap 4.
