# Collection overview

Roadmap item 3 · builds on 1c (server-side collection, `docs/design/collection-packs.md`) and item 2 (economy, `docs/design/economy.md`) · shows [ADR 0004](../adr/0004-economy-ground-rules.md) §4 (sell, recycle) under [ADR 0008](../adr/0008-server-authoritative.md) · written 2026-10-29

> **Written before its neighbours.** The collection and economy specs were being written in parallel and could not be read. §3.8 lists exactly what this view needs back from the server. Where those specs decide differently (the recycle rule above all, open question 2), this spec is amended to match them.

## 1. Goal

A signed-in player sees their whole collection on one screen and can find any card in it: a grid of what they own, a completion figure, search by character or series, filters for rarity, series and duplicates, and four sort orders. Opening a card shows its details and the two things a player can do with copies: sell them to the system for the in-game currency, or recycle several into one copy of the same character at the next rarity (ADR 0004 §4; the rule shape is open question 2). The server owns the collection, every number in it and the outcome of every action (ADR 0008). This view renders what the server last said and asks it to act. Roadmap item 3.

## 2. Out of scope

- The API's shape: paths, payloads, status codes, storage. §3.8 names only what the UI needs back.
- Pack opening and the reveal grid (`collection-packs.md`). This view only learns that the collection changed.
- The currency's name, icon, balance display and numbers (`economy.md`). This spec writes `<currency>` where the name goes and shows the numbers the server sends.
- Selling or recycling more than one entry per confirmation ("sell all duplicates"). A bulk action moves a lot of currency in one click; it is a later spec, once the numbers are settled.
- Trade (roadmap 7); profile, showcase and favourite card (roadmap 4); collection download (roadmap 9).
- Showing characters the player does not own (empty slots, the full pool). Completion is shown as numbers only.
- Undo for a sale or a recycle. The confirmation says there is none.
- Remembering search, filters, sort or page across reloads. Nothing is written to browser storage; they reset on reload and on log out, and survive switching tabs.
- Arrow-key navigation inside the grid (§7 says why Tab is enough at 60 per page).
- Previous/next navigation between cards inside the dialog.
- The collection `Reset` button. It cleared the browser-held proof-of-concept collection. After 1c the collection is on the server, and deleting every card would be a server action nobody has specced. It is removed from this view, which supersedes the Reset line in `accounts.md` §3.6. If the owner wants it back, it belongs in Manage account beside Delete account, specced with `collection-packs.md`.
- Replacing the app's visual system. This view is drawn in the target style; what the rest of the app must change is listed in §10, not done here.

## 3. Flow

Terms used below and in the copy. A **card** is one owned copy. An **entry** is every copy of one character at one rarity; the grid shows one tile per entry, as the current Inventory does. A **duplicate** is any copy beyond the first in an entry. A **character** counts once, whatever rarities it is owned at. The **pool** is the set of characters packs can currently produce, as the server defines it.

### 3.1 Entering the Collection tab

1. The view asks the server for the collection (§3.8). The tab reads `Collection (<N>)` with N the server's card total, or `Collection` before the first answer.
2. Branch on what happens:
   - **First load, answered within 300 ms**: nothing renders in the main area until the answer (no skeleton flash).
   - **First load, slower than 300 ms**: the loading skeleton (§4.1) until the answer.
   - **Data already held from earlier in the session**: shown at once; the view refetches silently and swaps the numbers in when the answer arrives. No skeleton, no spinner.
   - **Answer with zero entries**: the empty state.
   - **Answer with entries**: stats, toolbar, results line, grid, pages.
   - **Failure, nothing held**: the error state with `Try again`.
   - **Failure, data held**: the held data stays, marked with the stale note; selling and recycling wait.
   - **`unauthenticated`**: `accounts.md` §4.8 (session ended).
3. The collection is fetched when the tab is shown and after every sale and recycle. A pack opening marks it stale, so the next visit refetches. It is never polled.

### 3.2 Completion and totals

1. **Completion** is the number of distinct characters in the current pool that the player owns at least one copy of, at any rarity, over the pool size: `37 of 100 characters`. A percentage, rounded down so `100%` appears only when it is true, and a bar sit beside it. Both figures come from the server. Open question 1 has the alternative.
2. Characters that are no longer in the pool, if the pool ever changes, stay in the collection, show a note in the dialog and do not count toward completion. Their copies still count in the card totals.
3. With a series filter active, a second line gives that series' completion: `Cowboy Bebop: 3 of 4 characters`. No other filter and no search changes a stat; the stats always describe the whole collection.
4. **Totals**: cards, duplicates, and cards per rarity. All server figures.
5. Nothing happens at a threshold. At 100% the line reads `100 of 100 characters` and `100%`, like any other number.

### 3.3 Search, filters, sort and pages

All four run in the browser over the entries the server returned. They are display, not decisions. They combine with AND, every change updates the grid at once, and every change except paging returns to page 1.

**Search match rule**

1. The query and every searched field are normalised the same way, in this order: Unicode NFKC (folds full-width letters), lower-case, NFD, remove U+0300–U+036F (Latin accents), NFC, trim, collapse whitespace runs to one space. Kana voiced marks (U+3099, U+309A) are outside the removed range, so `か` does not match `が`.
2. The normalised query is split on spaces into terms. An empty query is no search.
3. An entry matches when **every term** is a substring of **at least one** of: the character name, the series title, the native series title.
4. Punctuation counts: `d. luffy` matches Monkey D. Luffy, `d luffy` does not. The field accepts at most 100 characters.

| Query         | Matches                                       | Why                        |
| ------------- | --------------------------------------------- | -------------------------- |
| `spike`       | Spike Spiegel                                 | substring of the name      |
| `bebop spike` | Spike Spiegel (Cowboy Bebop)                  | each term is in some field |
| `pokemon`     | characters from "Pokémon"                     | accents removed            |
| `ＬＵＦＦＹ`  | Monkey D. Luffy                               | NFKC folds full-width      |
| `進撃`        | characters from 進撃の巨人                    | native series title        |
| `luffy zoro`  | nothing, unless one entry contains both terms | terms are AND, not OR      |

**Filters**

- **Rarity**: `All rarities` (default), `Common`, `Rare`, `Legendary`. One at a time.
- **Series**: `All series` (default), then every series the player owns at least one card of, sorted by title, each labelled with its completion (`Cowboy Bebop · 3/4`). Entries without a series group under `Unknown series`, listed last. Options are keyed by the server's series id; two series with the same title are told apart by start year (`Hunter x Hunter, 2011 · 5/9`) when the server gives one. A selected series stays in the list while selected, even after its last card is sold (`· 0/4`).
- **Duplicates only**: off by default; on shows entries with 2 or more copies.
- `Clear filters` appears when the search or any filter differs from its default, and resets all of them. It does not touch the sort.

**Sort**. Default `Rarity, rarest first`. Name and title comparisons use `Intl.Collator("en", { sensitivity: "base", numeric: true })`. The last tie-break everywhere is the character id, ascending, so every order is stable.

| Option                 | Order                       | Then                          |
| ---------------------- | --------------------------- | ----------------------------- |
| `Rarity, rarest first` | Legendary, Rare, Common     | name A–Z, then series A–Z     |
| `Name, A to Z`         | name A–Z                    | rarest first, then series A–Z |
| `Newest first`         | last obtained, newest first | rarest first, then name A–Z   |
| `Most copies`          | count, highest first        | rarest first, then name A–Z   |

"Last obtained" moves an entry up when a new copy arrives or a recycle creates it, so the cards from the latest pack lead `Newest first`.

**Pages**: 60 entries per page (§5.5). Page controls appear only with more than one page. A refetch keeps the page and clamps it if the page no longer exists.

### 3.4 Card dialog

1. Activating a tile opens the **card dialog** for that entry: a native `<dialog>` opened with `showModal()`, the same shell as Manage account.
2. It shows the art, the name, the series title and the native title, then a facts list: rarity, copies, first obtained, and last obtained (only with 2 or more copies). A character no longer in the pool shows the out-of-pool line.
3. Below the facts, two sections, each rendered only when the server returns a rule for this rarity (§3.8): **Sell** (§3.5) and **Recycle** (§3.6). With no rules at all (the economy not live yet) the dialog shows details only.
4. The grid behind the dialog keeps its order while the dialog is open. Sort and filters are reapplied on close (§3.7), so no tile moves while the player is looking at it.

### 3.5 Sell

1. The Sell section shows `Sells for <V> <currency> each.` With 2 or more copies it shows a `Quantity` field (a whole number from 1 to the copies) that defaults to the duplicates (copies − 1), so the default keeps one. With 1 copy there is no field and the quantity is 1.
2. `Sell…` validates the quantity on submit, not per keystroke. Empty, zero, a fraction or more than the copies shows the field error (§8), focus goes to the field, and nothing is sent.
3. A valid quantity replaces the dialog body with the **sell confirmation**. Its heading names the copies and the character; its body names the rarity, the exact total (quantity × V, both server numbers) and what is left. If the sale leaves no copy at this rarity, the body says so. If it leaves no copy of the character at all, the body says it stops counting toward completion, or, for a character no longer in the pool, that packs no longer include it.
4. `Sell for <T> <currency>` sends one request with the entry, the quantity and the total the confirmation showed. While it is in flight the button reads `Selling…` and the button, `Cancel` and Escape are disabled, so the dialog cannot close on an unknown outcome.
5. **No optimistic changes.** The tile, the counts, the stats and the balance stay exactly as they were until the server answers. Then they show the server's numbers, never numbers the UI worked out. Because nothing changes in advance, there is no rollback state.
6. Branch on the answer:
   - **Success, copies left**: the dialog returns to the details with the server's new count, the inline status line `Sold <copies> of <name> for <T> <currency>. You now have <B> <currency>.` (T and B from the answer), and focus on the dialog heading.
   - **Success, entry gone**: the dialog closes, the app live region announces the same sentence, and focus moves per §3.7.
   - **Something changed** (the server holds fewer copies than asked, or its total differs from the one sent): nothing was sold. The view refetches, returns to the details with the new numbers, and shows the neutral `Something changed…` notice.
   - **Rate limited**: the confirmation stays; the button reads `Try again in <S> s` from the server's seconds and counts down (the `accounts.md` §4.4-B pattern); the status line under it appears once.
   - **Any other answer from the server**: nothing was sold, because a sale is atomic (§3.8). The confirmation stays with the red `The game server couldn't finish this…` banner, and the button is enabled again.
   - **No answer (network)**: the outcome is unknown, because the request may have arrived. The confirmation body is replaced by the red `Couldn't reach the game server, so this may not have gone through.` banner and `Check again`, which refetches the collection and returns to the details with whatever the server now says. The UI never resends a sale by itself.
   - **`unauthenticated`**: `accounts.md` §4.8.
7. `Cancel`, or Escape on the confirmation, returns to the details with the quantity kept.

### 3.6 Recycle

Designed for this rule (open question 2): **C copies of one character at one rarity become one copy of the same character at the next rarity**, optionally using a fee in currency; Legendary has no rule. C, the result rarity and the fee come from the server per rarity (5-to-1 is the owner's provisional number).

1. The Recycle section shows the rule line (`5 Common copies become 1 Rare Spike Spiegel.`), the fee line when the fee is above 0, and `Recycle…`.
2. `Recycle…` is disabled, with the reason visible under it, when the copies are fewer than C, or when the fee is above the balance the app last received. Neither check is authoritative; the server checks again.
3. `Recycle…` replaces the body with the **recycle confirmation**: heading, then a body naming C, the rarity, the result, what is left at this rarity, the fee if any, and that there is no undo.
4. `Recycle into <Next>` sends one request with the entry and the rule the confirmation showed. In flight the button reads `Recycling…`, with the same disabling as a sale.
5. Branch on the answer exactly as in §3.5 step 6, except:
   - **Success**: the dialog switches to the **resulting** entry (same character, next rarity) with the server's numbers, the new art fades in (§6.5), the inline status reads `Recycled <C> <Rarity> copies into this card.`, and focus goes to the heading. The player sees what they got without closing anything.
   - **Not enough currency** (the server's answer about the fee): nothing was used. The details show the red line `You need <fee> <currency> for this. You have <B>.` with B from the answer.
6. Under this rule the result is never random, so there is no reveal, no suspense delay and no odds table. If `economy.md` makes it random, this section is redesigned (open question 2).

### 3.7 Closing the dialog and where focus goes

1. The close button, or Escape on the details, closes the dialog. Escape on a confirmation returns to the details first.
2. On close the grid reapplies its sort and filters to the server's numbers.
3. Focus goes to the first of these that exists: the tile of the entry the dialog showed when it closed, if that tile is on the current page; the tile now at the opening tile's position on the page, or the last tile if the page got shorter; the results line, after the page is clamped.

### 3.8 What the UI needs from the server

The API's shape is not this spec's. From the UX side the server must give back the following, in one response or several; the view counts as loaded only when the whole read set has arrived.

**Read: the signed-in account's collection**

- **Entries**, one per character and rarity with at least one copy:
  - `characterId`: stable; with `rarity` it keys the entry
  - `rarity`: one of `RARITIES` in `shared/src/rarity.ts`
  - `count`: integer, at least 1
  - `firstObtainedAt`, `lastObtainedAt`: date-times
  - `name`: the AniList character name
  - `imageUrl`: the AniList image
  - `series`: `id`, `title`, `titleNative` (nullable) and `startYear` (nullable, used only to tell apart two series with the same title); or null when AniList lists no series
  - `inPool`: whether packs can still produce this character
- **Totals**: cards (the same number as `AccountPublic.cards` and the tab label), duplicates (the sum of count − 1), and cards per rarity.
- **Completion**: owned and total for the whole pool; owned and total per series, for every series that appears in the entries.
- **Rules per rarity**: the sell value of one copy, or none (then there is no Sell section); the recycle rule (copies needed, result rarity, fee), or none (no Recycle section).
- **Balance**: the account's balance, from wherever `economy.md` puts it. This view only reads it and replaces it with the one in a sell or recycle answer.

**Sell**, one request per confirmation, carrying the entry, the quantity and the total the confirmation showed. The answer is exactly one of:

- success: the amount credited, the new balance, the entry after the sale or the fact that it is gone, and the totals and completion after it (alternatively the UI refetches the read set before showing success; it never computes them);
- something changed: fewer copies than asked, or the server's total differs from the one sent; nothing sold;
- rate limited, with the seconds remaining;
- `unauthenticated`;
- any other failure, which means nothing changed: a sale is all or nothing;
- no answer (network): the outcome is unknown to the UI.

**Recycle**, one request per confirmation, carrying the entry and the rule the confirmation showed. The answer is exactly one of: success with the resulting entry, the source entry after (or the fact that it is gone), totals, completion and, if a fee was used, the new balance; something changed (copies or rule); not enough currency, with the balance; rate limited; `unauthenticated`; any other failure (nothing changed); no answer.

**What the UI computes, and nothing more**: filtering, searching, sorting, paging, the series option list, quantity × sell value for the confirmation text (which the server checks against its own), and which "last copy" sentence a confirmation needs. It never computes a count, a total, a completion figure or a balance after an action, and it never repeats an action by itself.

## 4. States

### 4.1 Collection view

| State                             | User sees                                                                                                                                                                                                                       | User can do                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| first load, within 300 ms         | Nothing in the main area                                                                                                                                                                                                        | Wait                                                       |
| loading (after 300 ms)            | Stats skeleton (two bars), the toolbar rendered and disabled, 12 skeleton tiles; visually hidden `Loading your collection…` in a `role="status"`                                                                                | Wait                                                       |
| empty                             | Heading `No cards yet` and `Open a pack`; no stats, no toolbar                                                                                                                                                                  | Open a pack (switches to Booster, focuses the pack button) |
| loaded                            | Stats, toolbar, results line, grid, pages when there are more than 60 results                                                                                                                                                   | Everything                                                 |
| refreshing (data held)            | The held data, unchanged; nothing marks the refetch                                                                                                                                                                             | Everything                                                 |
| stale (refetch failed, data held) | The held data; under the totals the note `Showing your collection as of <HH:MM>.` (the time the held data arrived); the app-level unreachable banner when the network is the cause; Sell and Recycle disabled with their reason | Browse, open cards, `Try again` in the banner              |
| error (nothing held)              | `Couldn't load your collection.` and `Try again` in place of stats and grid; the app-level unreachable banner as well when the network is the cause                                                                             | Try again                                                  |
| session ended                     | `accounts.md` §4.8                                                                                                                                                                                                              | Log in                                                     |

### 4.2 Toolbar and results

| State                    | User sees                                                                                                                          | User can do            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| default                  | Search empty, `All rarities`, `All series`, duplicates off, `Rarity, rarest first`; no `Clear filters`; results line `<N> results` | Search, filter, sort   |
| filtered                 | The results line counts the matches; `Clear filters` visible                                                                       | Clear                  |
| typing                   | The grid updates per keystroke; the live region gets the results line 500 ms after the last keystroke                              | Type, Escape clears    |
| no matches, with search  | In place of the grid: `No cards match "<query>".` and `Clear filters`                                                              | Clear, edit the search |
| no matches, filters only | `No cards match these filters.` and `Clear filters`                                                                                | Clear                  |
| several pages            | Results line `<N> results · page <page> of <pages>`; pages under the grid                                                          | Previous, Next         |

### 4.3 Tile

| State         | User sees                                                         | User can do       |
| ------------- | ----------------------------------------------------------------- | ----------------- |
| default       | Art, name, series, rarity word, `×<N>` when N is 2 or more        | Open              |
| hover         | The border goes from 40% to 80% of the tier colour; nothing moves | Open              |
| focus         | The violet focus ring with an offset                              | Enter/Space opens |
| image loading | The 3:4 box in `bg-zinc-800`                                      | Open              |
| image failed  | The same box with `No image` centred                              | Open              |

### 4.4 Card dialog

| State                      | User sees                                                                                                         | User can do          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------- |
| open                       | Close button, art, name (heading), series, native title, facts, and the Sell and Recycle sections the rules allow | Sell, recycle, close |
| no rules                   | Details only                                                                                                      | Close                |
| out of pool                | Under the facts: `No longer in packs. Doesn't count toward completion.`                                           | As open              |
| stale                      | `Sell…` and `Recycle…` disabled, reason `Selling and recycling wait until the game server answers.`               | Close                |
| entry changed by a refetch | The facts show the server's new count; the quantity field's maximum follows it                                    | As open              |
| entry gone after a refetch | Body replaced by `You no longer have this card.` and `Close`                                                      | Close                |
| session ended              | The dialog closes; `accounts.md` §4.8                                                                             | Log in               |

### 4.5 Sell

| State              | User sees                                                                                                                 | User can do                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| idle, 1 copy       | `Sells for <V> <currency> each.` and `Sell…`                                                                              | Sell…                         |
| idle, 2+ copies    | The same, plus `Quantity` (default: copies − 1) with the hint `1 to <N>`                                                  | Change quantity, Sell…        |
| invalid quantity   | Field `aria-invalid`, red border, error under it, focus to the field; nothing sent                                        | Fix                           |
| confirm            | The confirmation panel (§8), `Sell for <T> <currency>`, `Cancel`                                                          | Confirm, cancel, Escape       |
| selling            | `Selling…`; the button, `Cancel` and Escape disabled; counts and stats unchanged                                          | Wait                          |
| sold, copies left  | Details with the server's new count, the status line, focus on the heading                                                | Continue                      |
| sold, entry gone   | Dialog closed, live region announces, focus per §3.7                                                                      | Continue                      |
| something changed  | Details refreshed from the server, the neutral notice above the Sell section                                              | Check the numbers, sell again |
| rate limited       | Confirmation; the button disabled, reading `Try again in <S> s` in `tabular-nums`; the status line once; `Cancel` enabled | Wait, cancel                  |
| wait over          | The button back to `Sell for <T> <currency>`; live region `You can try again now.`                                        | Confirm                       |
| server failure     | Confirmation with the red banner; the button enabled                                                                      | Confirm again, cancel         |
| no answer          | Confirmation body replaced by the red banner, `Check again` and `Cancel`                                                  | Check again, cancel           |
| checking again     | `Checking…`, disabled                                                                                                     | Wait                          |
| check again failed | The same banner stays; the app-level unreachable banner shows                                                             | Check again, cancel           |

`Cancel` from the no-answer state returns to the details as the stale state shows them; selling waits until the server answers again.

### 4.6 Recycle

| State                                                      | User sees                                                                                     | User can do     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| available                                                  | Rule line, fee line if the fee is above 0, `Recycle…`                                         | Recycle…        |
| not enough copies                                          | `Recycle…` disabled, reason `Needs <C> copies. You have <N>.`                                 | —               |
| not enough currency                                        | `Recycle…` disabled, reason `Needs <fee> <currency>. You have <B>.`                           | —               |
| no rule (Legendary under the designed rule)                | No Recycle section                                                                            | —               |
| confirm                                                    | The confirmation panel (§8), `Recycle into <Next>`, `Cancel`                                  | Confirm, cancel |
| recycling                                                  | `Recycling…`; the button, `Cancel` and Escape disabled                                        | Wait            |
| recycled                                                   | The dialog shows the resulting entry; the art fades in; the status line; focus on the heading | Continue        |
| server says not enough currency                            | Details with the red line naming the fee and the balance                                      | —               |
| something changed, rate limited, server failure, no answer | As §4.5                                                                                       | As §4.5         |

### 4.7 Cross-cutting

Session ended and server unreachable behave as in `accounts.md` §4.8. Any `unauthenticated` answer closes the dialog and drops to the Account screen. An unreachable server shows the app-level banner, and this view keeps whatever the server last returned (the stale state).

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

- Below 348 px of content the 2-column floor makes tiles narrower than the minimum (138 px at a 320 px viewport). The art keeps 3:4 and the text truncates.
- A page of 60 entries fills whole rows at 2, 3, 4, 5 and 6 columns (60 is their least common multiple), so only the last page can end on a short row.
- Two characters can share a name; the series line tells them apart, and the tile's accessible name includes it.

### 5.2 Stats and toolbar

Top to bottom inside `<main>`: stats, toolbar, results line, grid, pages.

**Stats**

- Line 1: `37 of 100 characters` and `37%`, one row, wrapping on a phone.
- Series line, only with a series filter: under line 1, truncated to the line.
- Bar under them: full width up to `max-w-md`.
- Totals line: `214 cards · 153 duplicates`, then `Common 180`, `Rare 30`, `Legendary 4`, wrapping as needed.
- The stale note, when shown, under the totals line.

**Toolbar** (`mt-6`), a visible label above each control:

| Width          | Arrangement                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| below 640 px   | Row 1: Search, full width. Row 2: Rarity and Series, half each. Row 3: Sort (half) and Duplicates only (half, aligned with the controls' bottom edge). Row 4: Clear filters, when shown |
| 640–1023 px    | Row 1: Search, full width. Row 2: Rarity, Series and Sort, a third each. Row 3: Duplicates only, then Clear filters                                                                     |
| 1024 px and up | One row, bottom-aligned: Search (grows, at least 14rem), Rarity (10rem), Series (14rem), Sort (12rem), Duplicates only, Clear filters                                                   |

Select widths are fixed so the row does not shift when a long series title is chosen; the chosen title truncates inside the select.

### 5.3 Results line and pages

- The results line sits `mt-4` above the grid; the grid follows at `mt-3`.
- Pages: `mt-6`, a centred row: `Previous`, `Page <page> of <pages>`, `Next`. Hidden with a single page. `Previous` is disabled on page 1 and `Next` on the last page.
- Changing page scrolls the results line to the top of the viewport (instantly, no smooth scroll) and focuses it.

### 5.4 Card dialog

- The Manage account dialog's shell with `max-w-2xl` instead of `max-w-lg`; `max-h-[85vh]`, the body scrolls, the backdrop is unchanged. The close button sits top right, as there.
- `sm` and up: two columns, `grid grid-cols-[12rem_1fr] gap-6`: the art on the left (12rem wide, 3:4), and on the right the heading, series, native title, facts and sections.
- Phone: the art at `w-28` (7rem) beside the heading block (name, series, native title) in a `flex gap-4` row; facts and sections full width below.
- Sell and Recycle sit under the facts, separated by `border-t border-zinc-800 pt-5 mt-5`, each with an `h3`. The `Quantity` field (`w-24`) and `Sell…` share one row at every width.
- Confirmations replace the body below the close button, like the delete confirmation in Manage account. Buttons stack full width on a phone and sit side by side from `sm`, the primary first in DOM order and on the right (`sm:flex-row-reverse sm:justify-start`).

### 5.5 Large collections: pagination, not virtualisation

The read set is bounded: at most pool size × 3 rarities entries, 300 today. One response carries all of it, and search, filters and sort over it run in well under a frame.

What hundreds of tiles cost is DOM and images. The grid therefore shows **60 entries per page**, paged in the browser.

- **Why pagination.** Every rendered tile is a real element, so Tab order, screen-reader browse mode and find-in-page all work. At most 60 images load per page, lazily. "Page 2 of 5" is a position a player can get back to. 60 fills whole rows at every column count (§5.1). It needs no dependency.
- **Why not virtualisation.** It adds a dependency (a T2 review) for a list of at most 300. It removes off-screen tiles, which breaks find-in-page and screen-reader browsing and can drop the focused tile. A responsive auto-fill grid also needs measured rows before it can be virtualised.
- **When to revisit.** If `collection-packs.md` lets the pool grow past 500 characters (1,500 entries), the read moves to server-side paging with search, filters and sort as request parameters, and this section is rewritten.

### 5.6 Truncation and AniList text (T1)

Names, series titles, native titles and image URLs come from AniList through the server; the search query comes from the player. All of them are untrusted (`docs/05-security.md`, T1).

1. Rendered as React text only; no `dangerouslySetInnerHTML` (C9, lint-enforced).
2. Each AniList string sits in its own element with `dir="auto"` (a `<bdi>` where it sits inside a sentence). Counts, rarity words, separators and amounts sit in sibling elements, so a right-to-left override in a name cannot reorder `×3` or `30 <currency>`.
3. In plain-string contexts (`<option>` text, `aria-label`, `title`, live-region text) each AniList string is wrapped in U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL ISOLATE. The string itself is not altered.
4. One-line renderings (tile name and series, the series line in the stats) use `truncate` and carry `title` with the full string. The dialog heading, series lines, confirmation headings and bodies and the no-match message wrap with `break-words` (`overflow-wrap: anywhere`), so a 200-character name without spaces stays inside the dialog.
5. Series option labels are cut at 60 grapheme clusters (`Intl.Segmenter`) followed by `…`. The full title still matches a search.
6. Tile text lines clip vertically (`overflow-hidden` with `leading-tight`), so a stack of combining marks cannot paint over the tile below.
7. `imageUrl` is only ever an `<img src>`. An image the browser cannot load, or that the CSP (C8) refuses, shows the `No image` box. Card art is never a link.
8. Normalisation (§3.3) is for matching only. Everything on screen is the original string.

The T1 test for this feature uses a name, a series title, a native title and a search query of each of: `<img src=x onerror=alert(1)>`, an RTL override (U+202E … U+202C), 200 characters without a space, and a stack of 50 combining marks. It checks that each appears as text in the tile, the dialog heading, a confirmation heading, the series option and the no-match message; that no `[onerror]` attribute and no `img` other than the card art exists; and that the count and the rarity word are siblings of the name's element, not inside it.

## 6. Visual treatment

### 6.1 Rarity as a system

Rarity is carried by hue, at the same lightness step for every tier, and always also by the word. No glow, no shadow, no animation.

| Tier      | Hue            | Mark colour (token, step 400)        | Text (step 300)  | Tile border                  | Tile border on hover |
| --------- | -------------- | ------------------------------------ | ---------------- | ---------------------------- | -------------------- |
| Common    | neutral (zinc) | `--color-rarity-common` `#a1a1aa`    | `text-zinc-300`  | `border-rarity-common/40`    | `/80`                |
| Rare      | sky            | `--color-rarity-rare` `#38bdf8`      | `text-sky-300`   | `border-rarity-rare/40`      | `/80`                |
| Legendary | amber          | `--color-rarity-legendary` `#fbbf24` | `text-amber-300` | `border-rarity-legendary/40` | `/80`                |

**Token change** in `web/src/index.css` `@theme`: two values change, no token is added.

- `--color-rarity-common`: `#94a3b8` (slate-400) → `#a1a1aa` (zinc-400). Slate is a blue-grey that sat next to Rare's blue; zinc is the app's one neutral scale.
- `--color-rarity-legendary`: `#f59e0b` (amber-500) → `#fbbf24` (amber-400), the same step as the other two.
- `--color-rarity-rare` stays `#38bdf8`. The comment above the block changes from "Rarity glow colours …" to "Rarity colours, step 400 of each hue."

`senior-engineer` applies the change in this feature's build PR, together with the tile, not in this spec's commit. The pack reveal's glow keyframes hard-code the old amber (`rgb(245 158 11)`), so changing the token alone would put the two out of step; see open question 3.

### 6.2 Tile

A new tile for the collection. It is a button (it opens the dialog) where the reveal card is an article, and it is drawn in the target style. It reuses `RARITY_LABEL` and the rarity tokens, not `CharacterCard`'s frame, overlay or badges.

- Box: `<button type="button">`, `flex flex-col overflow-hidden rounded-lg border bg-zinc-900 text-left`, the border per §6.1, `transition-colors duration-150`. Focus: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950`. No shadow, no translate, no scale.
- Art: an `aspect-[3/4] w-full bg-zinc-800` box holding `<img alt="" loading="lazy" decoding="async">` at `h-full w-full object-cover`. No gradient overlay; nothing is drawn on the art.
- Text block `flex flex-col gap-0.5 p-2.5`:
  - name: `truncate text-sm leading-tight font-semibold text-zinc-100`
  - series: `truncate text-xs leading-tight text-zinc-400`
  - meta row `mt-1 flex items-baseline justify-between gap-2`: the rarity word in `text-[11px] font-semibold tracking-wider uppercase` and the tier's text colour; `×<N>` in `text-xs text-zinc-300 tabular-nums`, only for N of 2 or more.
- No `NEW` badge in the collection.
- Image failed: `No image` in `text-xs text-zinc-400`, centred in the art box.
- Skeleton tile: the same box with `border-zinc-800`, the art box in `bg-zinc-800`, and two `h-3 rounded bg-zinc-800` bars at 75% and 50% width. Static: nothing shimmers or pulses.

### 6.3 Stats, toolbar, results, pages

- Completion line: the numbers in `text-base font-semibold text-zinc-100 tabular-nums`, the percentage in `text-sm text-zinc-400`. Series line `text-sm text-zinc-400`.
- Bar: track `h-1 w-full max-w-md rounded-full bg-zinc-800`, fill `bg-zinc-300`. Not the accent; violet stays for primary actions and focus.
- Totals line: `text-xs text-zinc-400`, `flex flex-wrap gap-x-4 gap-y-1`; each rarity word in its tier's text colour, its number in `text-zinc-200 tabular-nums`.
- Stale note: `text-xs text-zinc-400`.
- Toolbar labels: `text-xs text-zinc-400`, above the control. Not the accounts hint colour (`zinc-500`): these labels are the controls' names and must reach 4.5:1 on `zinc-950`.
- Search and selects: the accounts `INPUT` classes (`rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100`, violet focus ring).
- Duplicates only: a native checkbox `size-4 accent-violet-600` inside its label, `text-sm text-zinc-200`; the whole label is clickable.
- Clear filters: `BUTTON.text` (the Show/Hide toggle style) at `text-sm`.
- Results line: `text-sm text-zinc-400 tabular-nums`.
- Pages: `BUTTON.secondary` for Previous and Next; the page text `text-sm text-zinc-400 tabular-nums`.
- Empty state: `No cards yet` in `text-lg font-bold text-zinc-100`, `Open a pack` as `BUTTON.primary`, centred, `py-16`. No dashed box, no illustration.
- No matches: the message in `text-sm text-zinc-400 break-words`, `Clear filters` as `BUTTON.secondary`, centred, `py-12`.
- Error: `Couldn't load your collection.` in `text-sm text-zinc-300`, `Try again` as `BUTTON.secondary`.

### 6.4 Dialog and confirmations

- Shell, headings, body text and buttons: `web/src/components/account/styles.ts` as it is (`PANEL_HEADING`, `SECTION_HEADING`, `BODY_TEXT`, `BUTTON.*`).
- Art in the dialog: `rounded-md`, `alt=""`, the same `No image` fallback.
- Name: `PANEL_HEADING` with `break-words`. Series: `text-sm text-zinc-400`. Native title: `text-xs text-zinc-400`, `lang="ja"` as the current card has it, shown only when it differs from the title.
- Facts: `<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">`, `dt` in `text-zinc-400`, `dd` in `text-zinc-200 tabular-nums`; the rarity value in its tier's text colour.
- `Sell…`, `Recycle…`, `Sell for <T> <currency>`, `Recycle into <Next>` and `Check again` are `BUTTON.primary`. Selling is an ordinary game action, not a danger; the confirmation copy carries "There is no undo." `Cancel` is `BUTTON.secondary`.
- Quantity field: `INPUT` at `w-24`, invalid `border-red-800`, error `ERROR_TEXT` under it, hint `text-xs text-zinc-400`.
- Disabled reasons under a button: `text-xs text-zinc-400`.
- Success status line: `text-sm text-zinc-200`.
- Neutral notice (something changed): the `STATUS_BANNER` style. Red banners (server failure, no answer): the `FormBanner` style with this feature's copy. Red line (not enough currency): `ERROR_TEXT`.
- Amounts are plain text `<amount> <currency>`, formatted with `Intl.NumberFormat("en-GB")` (`1,240`). No coin, wallet, cart or bag icon in this view. If `economy.md` gives the currency an icon, adding it here is an amendment to this spec.

### 6.5 Motion

- Dialog enter: the existing `pop-in` (150 ms).
- Recycle result: the new art enters with `pop-in`, which shows that the card changed.
- Completion bar fill: `transition-[width] duration-200` when the number changes after an action.
- Tiles never animate: no `card-reveal` in the collection (the current Inventory re-runs it on every filter change), no hover motion.
- All of it is off under `prefers-reduced-motion: reduce`, the width transition included (`motion-reduce:transition-none`).

### 6.6 Not in this view

No gradients, glows, glass (backdrop blur), drop shadows, hover lift or zoom, emoji, sparkles, confetti, coin iconography, exclamation marks, or emphasis on currency numbers.

## 7. Accessibility

- **Region**: `<main>` holds `<section aria-labelledby="collection-heading">` with a visually hidden `h2` `Collection`.
- **Toolbar**: a `<search>` element labelled `Collection filters`. Every control has a visible `<label>`. Changes apply at once; Enter in the search field does nothing more (no submit, no reload). Escape in a non-empty search field clears it and keeps focus there.
- **Controls and their names**:

| Control             | Element                                                                       | Accessible name                                                      |
| ------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Search              | `<input type="search" maxlength="100" autocomplete="off" spellcheck="false">` | `Search`                                                             |
| Rarity              | `<select>`                                                                    | `Rarity`                                                             |
| Series              | `<select>`                                                                    | `Series`                                                             |
| Duplicates only     | `<input type="checkbox">`                                                     | `Duplicates only`                                                    |
| Sort                | `<select>`                                                                    | `Sort`                                                               |
| Clear filters       | `<button>`                                                                    | `Clear filters`                                                      |
| Tile                | `<button aria-haspopup="dialog">` in an `<li>`                                | `<name>, <Rarity>, <series>, <copies>`                               |
| Previous, Next      | `<button>`                                                                    | `Previous page`, `Next page`                                         |
| Open a pack         | `<button>`                                                                    | `Open a pack`                                                        |
| Try again (view)    | `<button>`                                                                    | `Try again`                                                          |
| Card dialog         | `<dialog aria-labelledby>`                                                    | the name heading; on a confirmation, its heading                     |
| Close               | `<button>`                                                                    | `Close`                                                              |
| Quantity            | `<input type="number" inputmode="numeric" min="1" max="<N>" step="1">`        | `Quantity`, described by the hint and any error                      |
| Sell…, Recycle…     | `<button>`                                                                    | the visible text, described by the value or rule line and any reason |
| Confirm buttons     | `<button>`                                                                    | the visible text, e.g. `Sell for 30 <currency>`, `Recycle into Rare` |
| Cancel, Check again | `<button>`                                                                    | the visible text                                                     |

- **Grid**: `<ul role="list" aria-labelledby="collection-results">`. The explicit role keeps list semantics in Safari, which drops them under `list-style: none`. DOM order is visual order, row by row, so Tab, browse mode and sight agree. Tile art is `alt=""`: the name is already in the button's name.
- **Results line**: a plain paragraph with `id="collection-results"` and `tabindex="-1"` (a focus target). Its text goes to the app live region 500 ms after the last change, never per keystroke.
- **Pages**: `<nav aria-label="Pages">`. After a page change focus moves to the results line, which reads for example `214 results · page 2 of 4`.
- **Dialog**: native `<dialog>` with `showModal()`, which gives the focus trap, Escape and the inert background. Initial focus is the dialog element (`tabindex="-1"`), as in Manage account. A confirmation focuses its heading (`tabindex="-1"`) and points `aria-describedby` at its body, so a screen reader reads the exact result before reaching the button. After a success that keeps the dialog open, focus goes to the dialog heading and the status line (`role="status"`) is read.
- **In flight**: the confirm button is disabled and keeps focus; it is never removed. Escape is ignored (the `cancel` event is prevented) until the answer arrives.
- **Disabled reasons** are visible text linked with `aria-describedby`, never tooltips.
- **Countdown**: as `accounts.md` §7 "Wait": the number lives in the button's text, which is not a live region; the status line is read once; `You can try again now.` goes to the live region when the wait ends.
- **Announcements**: the app-level live region (`role="status"`) receives the results line (debounced), the sale sentence when a sale closes the dialog, and wait-over. Status lines inside the open dialog are `role="status"`; red banners are `role="alert"`.
- **Keyboard path, end to end**: Tab to the `Collection` tab, Enter. Tab through Search, Rarity, Series, Duplicates only, Sort and Clear filters (when shown), then into the tiles. Enter opens the dialog. Tab to `Quantity`, type, Tab to `Sell…`, Enter. The confirmation heading has focus; Tab to `Sell for …`, Enter. The status line is read. Escape closes; focus returns per §3.7. No step needs a pointer.
- **No arrow-key grid**: a page holds at most 60 tiles, one Tab stop each. A roving-tabindex grid would need the column count measured from the layout and adds a pattern screen-reader users must learn, for little gain at this size.
- **Contrast**: everything that must be read is `zinc-400` or lighter, or a rarity text colour at step 300, on `zinc-900` or `zinc-950`: all at least 4.5:1. This view uses no `zinc-500` text. Tile borders are decorative; rarity is always also the word (WCAG 1.4.1).
- **Touch targets**: every control is at least 40 px tall on a phone; tiles are far larger.
- **Reduced motion**: §6.5.

## 8. Copy

Exact strings. Placeholders: `<name>` the character name; `<series>` and `<title>` a series title; `<Rarity>` the rarity label (`RARITY_LABEL`); `<Next>` the label of the rarity a recycle produces; `<N>` a count; `<copies>` the phrase `1 copy` / `<N> copies`; `<Q>` the quantity to sell; `<K>` the copies kept; `<C>` the copies a recycle needs; `<V>` what one copy sells for; `<T>` the total (on a confirmation Q × V; on success the amount the server credited); `<B>` the balance the server sent; `<fee>` the recycle fee; `<S>` countdown seconds; `<owned>`, `<total>`, `<pct>` completion figures; `<page>`, `<pages>`; `<HH:MM>` from `Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })`; `<D Mon YYYY>` the `metaLine` date format (`day: "numeric", month: "short", year: "numeric"`); `<query>` the search as typed. Numbers use `Intl.NumberFormat("en-GB")`. `<currency>` is the currency's name, one constant in `web/src/lib/copy.ts`, set by `economy.md`.

The words "secure", "verified", "protected", "safe", "private", "attempt", "locked" and "blocked" do not appear in any string below and must not be added (`accounts.md` §8). No money words other than the currency's name: no "buy", "price", "pay", "cash", "money", "cost", "earn", "profit", "worth", "value", "deal" or "balance". "Sell" is ADR 0004's name for the action and stays. No casino nudges: no exclamation marks, no urgency or scarcity wording ("hurry", "only", "last chance"), no "lucky", no streaks, no "you could get", no prompts near a completion threshold.

**Tab and region**

| Element                          | Copy                                                      |
| -------------------------------- | --------------------------------------------------------- |
| Tab label                        | `Collection (<N>)` / before the first answer `Collection` |
| Region heading (visually hidden) | `Collection`                                              |
| Toolbar landmark label           | `Collection filters`                                      |
| Loading (visually hidden)        | `Loading your collection…`                                |

**Stats**

| Element                                | Copy                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| Completion                             | `<owned> of <total> characters`                                   |
| Completion percentage                  | `<pct>%` (rounded down)                                           |
| Series completion                      | `<series>: <owned> of <total> characters`                         |
| Cards                                  | the existing `cardCount`: `No cards yet` / `1 card` / `<N> cards` |
| Duplicates                             | `No duplicates` / `1 duplicate` / `<N> duplicates`                |
| Separator between cards and duplicates | `·`                                                               |
| Per rarity                             | `Common <N>` · `Rare <N>` · `Legendary <N>`                       |
| Stale note                             | `Showing your collection as of <HH:MM>.`                          |

**Toolbar**

| Element            | Copy                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Search label       | `Search`                                                                                                                     |
| Search placeholder | `Name or series`                                                                                                             |
| Rarity label       | `Rarity`                                                                                                                     |
| Rarity options     | `All rarities` · `Common` · `Rare` · `Legendary`                                                                             |
| Series label       | `Series`                                                                                                                     |
| Series options     | `All series` · `<title> · <owned>/<total>` · with a shared title `<title>, <startYear> · <owned>/<total>` · `Unknown series` |
| Duplicates         | `Duplicates only`                                                                                                            |
| Sort label         | `Sort`                                                                                                                       |
| Sort options       | `Rarity, rarest first` · `Name, A to Z` · `Newest first` · `Most copies`                                                     |
| Clear              | `Clear filters`                                                                                                              |

**Results and pages**

| Element                       | Copy                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Results line                  | `<N> results` / `1 result`; with pages `<N> results · page <page> of <pages>` |
| Live announcement, no results | `No results`                                                                  |
| Pages landmark label          | `Pages`                                                                       |
| Buttons                       | `Previous` · `Next` (accessible names `Previous page` · `Next page`)          |
| Page text                     | `Page <page> of <pages>`                                                      |

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

| Element         | Copy                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Accessible name | `<name>, <Rarity>, <series>, <copies>`; without a series `<name>, <Rarity>, Unknown series, <copies>` |
| Count           | `×<N>` (N of 2 or more)                                                                               |
| Series fallback | `Unknown series`                                                                                      |
| Image fallback  | `No image`                                                                                            |

**Card dialog**

| Element              | Copy                                                        |
| -------------------- | ----------------------------------------------------------- |
| Close (`aria-label`) | `Close`                                                     |
| Facts labels         | `Rarity` · `Copies` · `First obtained` · `Last obtained`    |
| Dates                | `<D Mon YYYY>`                                              |
| Out of pool          | `No longer in packs. Doesn't count toward completion.`      |
| Entry gone           | `You no longer have this card.`                             |
| Entry gone action    | `Close`                                                     |
| Stale reason         | `Selling and recycling wait until the game server answers.` |

**Sell**

| Element                                                        | Copy                                                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Section heading                                                | `Sell`                                                                                                                                         |
| Value line                                                     | `Sells for <V> <currency> each.`                                                                                                               |
| Quantity label                                                 | `Quantity`                                                                                                                                     |
| Quantity hint                                                  | `1 to <N>`                                                                                                                                     |
| Quantity error                                                 | `Choose a whole number from 1 to <N>.`                                                                                                         |
| Button                                                         | `Sell…`                                                                                                                                        |
| Confirmation heading                                           | `Sell <copies> of <name>?`                                                                                                                     |
| Body, copies left at this rarity                               | `<Q> <Rarity> <copy\|copies> for <T> <currency>. You keep <K>. There is no undo.`                                                              |
| Body, last copies of this rarity                               | `<Q> <Rarity> <copy\|copies> for <T> <currency>. That is every <Rarity> copy you have. There is no undo.`                                      |
| Body, last copies of the character                             | `<Q> <Rarity> <copy\|copies> for <T> <currency>. That is every <name> you have, so it stops counting toward completion. There is no undo.`     |
| Body, last copies of a character no longer in packs            | `<Q> <Rarity> <copy\|copies> for <T> <currency>. That is every <name> you have, and packs no longer include this character. There is no undo.` |
| Confirm button                                                 | `Sell for <T> <currency>` / in flight `Selling…`                                                                                               |
| Cancel                                                         | `Cancel`                                                                                                                                       |
| Success (inline status, or live region when the dialog closes) | `Sold <copies> of <name> for <T> <currency>. You now have <B> <currency>.`                                                                     |

**Recycle**

| Element                          | Copy                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section heading                  | `Recycle`                                                                                                                                                 |
| Rule line                        | `<C> <Rarity> copies become 1 <Next> <name>.`                                                                                                             |
| Fee line (fee above 0)           | `Uses <fee> <currency>.`                                                                                                                                  |
| Button                           | `Recycle…`                                                                                                                                                |
| Reason, copies                   | `Needs <C> copies. You have <N>.`                                                                                                                         |
| Reason, currency                 | `Needs <fee> <currency>. You have <B>.`                                                                                                                   |
| Confirmation heading             | `Recycle <C> copies of <name>?`                                                                                                                           |
| Body, copies left at this rarity | `<C> <Rarity> copies become 1 <Next> <name>. You keep <K> <Rarity> <copy\|copies>.`, then with a fee ` Uses <fee> <currency>.`, then ` There is no undo.` |
| Body, last copies of this rarity | `<C> <Rarity> copies become 1 <Next> <name>. That is every <Rarity> copy you have.`, then with a fee ` Uses <fee> <currency>.`, then ` There is no undo.` |
| Confirm button                   | `Recycle into <Next>` / in flight `Recycling…`                                                                                                            |
| Cancel                           | `Cancel`                                                                                                                                                  |
| Success (inline status)          | `Recycled <C> <Rarity> copies into this card.`                                                                                                            |
| Not enough currency (server)     | `You need <fee> <currency> for this. You have <B>.`                                                                                                       |

**Failures, for sell and recycle**

| Element                     | Copy                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- |
| Something changed (neutral) | `Something changed since you opened this card. Check the numbers and try again.` |
| Rate limited (status, once) | `That was a lot in a short time. Give it a few seconds.`                         |
| Countdown button            | `Try again in <S> s` (the existing `common.tryAgainIn`)                          |
| Wait over (live region)     | `You can try again now.` (existing)                                              |
| Server failure (red)        | `The game server couldn't finish this. Nothing changed. Try again.`              |
| No answer (red)             | `Couldn't reach the game server, so this may not have gone through.`             |
| No answer action            | `Check again` / in flight `Checking…`                                            |

**Existing copy that changes**

| Element                  | Old                                                             | New                                          |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------------- |
| Empty collection         | `Your collection is empty. Open a pack to get started.`         | `No cards yet` with the `Open a pack` button |
| Stats line               | `<N> cards · <U> unique` and the rarity chips                   | The Stats strings above                      |
| Rarity filter label      | `Filter by rarity` (visually hidden)                            | `Rarity` (visible)                           |
| Reset button and confirm | `Reset`, `Delete every card in <login>? This cannot be undone.` | Removed (§2)                                 |

## 9. Open questions

1. **What counts toward completion?** This spec counts distinct characters in the current pack pool, owned at any rarity: `37 of 100 characters`. The alternative counts every character at every rarity (300 slots with today's pool), which turns Legendaries into the long tail of completion; a third option, per series only, has no single headline number. Percent of all of AniList is not offered: it is unreachable by design. **Recommendation**: distinct characters in the pool, with the per-rarity card counts beside it as plain numbers and per-series figures in the series filter.
2. **Which recycle rule does `economy.md` choose?** This spec is designed for "C copies of one character at one rarity become one copy of the same character at the next rarity; Legendary has no rule". If `economy.md` chooses "any C cards of a rarity become one random card of the next rarity", recycling needs a multi-card picker outside the dialog and a published odds table (ADR 0004 §6), and §3.6 and §4.6 are redone. **Recommendation**: the same-character rule. It is deterministic, needs no odds, fits the card dialog, and turns a character's duplicates into progress on that character.
3. **Apply the non-glow rarity frame to the pack reveal now, or wait for the Sprint 1 web rework?** The collection tile drops the glow, the hover lift and the glass badges (§10). Left alone, the pack reveal keeps its glowing frames and the app shows two rarity treatments side by side. **Recommendation**: now, in this feature's build PR: replace `CharacterCard`'s `FRAME_CLASS` with the §6.1 borders, delete `legendary-pulse` and `.glow-legendary`, and apply the two token values at the same time. Items 2 to 7 of §10 wait for `docs/design/visual-system.md`.

## 10. Visual system follow-up

The collection overview can be built well within the current tokens plus the two values in §6.1. The rest of the app still carries the known debt of `docs/06-engineering-standards.md` §2, and this view sits next to it. What must change, and why; none of it blocks this feature:

1. **`CharacterCard` frame glow**: box-shadow glows per tier and a looping `legendary-pulse` animation. Glow as decoration, and motion that loops. Replace with the §6.1 border; delete the keyframes and the class. This is open question 3.
2. **`CharacterCard` hover lift and image zoom** (`hover:-translate-y-1`, `group-hover:scale-105`): hover-lift on everything. Remove.
3. **`RarityBadge` and the `×N` and `NEW` chips over the art**: drop shadow plus backdrop blur, which reads as glass. Move rarity and count under the art as in §6.2, or make them flat chips without blur or shadow.
4. **The gradient over the bottom of the art**: only there so overlaid text stays legible; it goes with item 3.
5. **Header and page**: gradient title text, the violet radial page background, the three-colour gradient pack button with an emoji, and the explanatory subtitle "Open packs, collect characters." These belong to `docs/design/visual-system.md`, which does not exist yet.
6. **`rounded-2xl` on panels, dialogs and cards**: this view uses it only through the shared dialog shell; the radius scale is a visual-system decision.
7. **The avatar placeholder's gradient** (`accounts.md` §6): the pack button's gradient reused; replaced by card art in roadmap 4.
