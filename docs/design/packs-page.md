# Packs page (1c web)

Roadmap row **1c-web** (`docs/02-roadmap.md`) · the UI spec that `collection-packs.md` §8 assigns to `ui-designer`: the pack control's states, the reveal sequence and the collection without `Reset` · builds on the shipped contract (`collection-packs.md` §6, `shared/src/api.ts`, #28 and #31), the card (`card-and-rarity.md`) and the page addresses (`navigation-and-landing.md`, #30) · security tier T3 (CSP narrowing, `collection-packs.md` §8) plus T1 (third-party strings rendered) · written 2026-10-29 · revised 2026-10-30: opening a pack moves to its own page, `/packs/open` (§3.7; owner: "Opening packs should also have their own route")

**What this spec does not repeat.** It links to these specs and does not restate them:

| Topic                                                                                                             | Where                                                     |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| what the UI gets back, what it may not do, what is deleted, the CSP                                               | `collection-packs.md` §8                                  |
| the card's anatomy, sizes, frames, stars, rank chip, effects and tokens                                           | `card-and-rarity.md` §3 to §6 and §10                     |
| the special-pack headings and lines, the pity line, the odds page                                                 | `card-and-rarity.md` §7.1, §7.4, §7.3                     |
| the page's path, title, `h1`, guard, focus on navigation, state kept across pages, session ended, the live region | `navigation-and-landing.md` §3.1, §3.5, §3.6, §3.10, §4.8 |
| the opening page's routing: push, replace with `/packs`, Back, Forward, the guard, the header link                | `navigation-and-landing.md` §3.13                         |

## 1. Goal

A signed-in player on `/packs` sees how many packs are ready out of the most they can hold and, below the cap, when the next one arrives; the page shows the guarantee counter and opens the odds. They open a pack, and the game moves to `/packs/open`, which shows the opening and then the five cards the server dealt, in slot order, with the new ones marked, a one-line summary and, after a special pack, the plain line that explains it. Back returns to `/packs`. Every number on the page comes from the last server answer. The browser counts down to the next pack and asks the server once when the countdown ends. It never polls, never sends a time, never rolls a card and never says what the next pack will be. A lost answer never costs a pack: the retry carries the same `requestId`, so the player sees the cards the server actually dealt (`collection-packs.md` §5.3, §8). `/collection` shows the server's collection in the interim view (§3.6) until item 3 replaces it. The view has six tiers and no `Reset`.

## 2. Out of scope

- **The demo pack** (roadmap row D, on its own public page `/demo`, `navigation-and-landing.md` §3.7, §3.14). It is a later PR. It reuses this spec's reveal component (§3.4, §6.5) without effects, the `New` marker or the special-pack lines. Its card has no glow, glint or drift (owner, 2026-10-29, `card-and-rarity.md` §12 note).
- **A permanent address for one opening** (`/packs/<id>`), which would show a given pack again after a reload. It needs a new API and is a possible later option (`navigation-and-landing.md` §2).
- **The collection overview** (item 3, `collection-overview.md`): completion, search, the series filter, sort, pages, the Series view and the card dialog. The interim view (§3.6) shows only what the old Inventory showed, over the server's answer.
- **The shop, the market and Karma** (item 2, `market-and-shop.md`, `economy.md`). Shop packs reuse the reveal, on their own opening page `/shop/open` (`market-and-shop.md` §3.3, `card-and-rarity.md` §7.2). This PR makes nothing for them.
- **The profile's next-pack timer** (item 4). In 1c the countdown is on the pack control only.
- **Any notification, sound, change to the document title or favicon, badge, or "come back" prompt** about packs (`collection-packs.md` §8, ADR 0004 §6).
- **The card itself.** It is `card-and-rarity.md`'s, and this spec only places it.
- **The visual-system rework** (`visual-system.md`, not written). The page's radial background and the header stay as they are.

## 3. Flow

Terms: **allowance**, the server's `PackAllowance` (`available`, `cap`, `intervalSeconds`, `nextPackInSeconds`); **held answer**, the last `PacksResponse` or `PackOpened` applied to the page; **key**, the `requestId` of an opening that has not had an answer yet; **reveal**, the current opening's cards, shown on `/packs/open`; **current opening**, the opening in flight or the last one with cards, held in the signed-in layout (`navigation-and-landing.md` §3.13 step 2).

### 3.1 Arriving on `/packs`

1. `navigation-and-landing.md` §3.6 sets the title `Packs · Anime TCG` and moves focus to the `h1` `Packs`, except on a load or reload. The `h1` is rendered from the start, in every state.
2. Each time the page is shown, it sends one `GET /api/packs`. A held answer from earlier in the session shows at once, and the new answer replaces it silently. With no held answer, the control area is blank for the first 300 ms, then shows the loading state (§4.1).
3. `/packs` shows no reveal: the cards are on `/packs/open` (§3.7). While the signed-in layout holds a current opening with cards, the control block ends with the text link `See your latest pack`, which pushes `/packs/open`; the cards show there without their entrance.
4. Branches on the answer:
   - `odds` not null: the control renders from `allowance` (§4.1, the ready, waiting and at-cap rows). The pity line and `Pack odds` show (§3.5).
   - `odds` null: cards unavailable (§4.1). There is no pity line and no `Pack odds`.
   - `unauthenticated`: session ended (`accounts.md` §4.8, `navigation-and-landing.md` §3.5 step 8), with `/packs` as the return path.
   - No answer (`NetworkError`, which includes a non-envelope answer such as a proxy error page): the app's unreachable banner. With a held answer, the page keeps it (stale). Without one, the page shows the load-failure row.
5. **Newest request wins.** Every request that returns an allowance (`GET /api/packs`, `POST /api/packs/open`) is numbered when it is sent. The page applies an allowance or a `packsUntilGuarantee` only from an answer whose request was sent after the one it last applied. A `GET` that was sent before an opening and answers after it is ignored for the allowance and the pity line, so the page never steps back.

### 3.2 The countdown

1. A countdown runs only when the held allowance has `nextPackInSeconds` (below the cap). It starts from that number at the moment the answer arrived. It is measured with a monotonic clock (`performance.now()`), never with `Date`, so a wrong or changed device clock does not matter (`collection-packs.md` §5.2). The display is the remaining time rounded up to whole seconds and updates once a second.
2. A 409 `no_pack_available` starts a countdown from its `retryAfterSeconds` in the same way (§3.3).
3. **At zero**, the page sends exactly one `GET /api/packs` and starts no other timer. If that answer is still below the cap, a new countdown starts from its `nextPackInSeconds`. At the cap (`null`), no timer runs at all. Each request is triggered by a time the server stated, so this is not polling. Nothing refetches on an interval, on window focus or on reconnect (the query client's defaults stay as `web/src/lib/queryClient.ts` sets them).
4. Until the zero-time `GET` answers, the line keeps reading `Next pack in 0:00` and the button stays as it was.
5. If the zero-time `GET` gets no answer, the countdown line becomes `Couldn't check for the next pack.` with a `Check again` text button that sends one `GET`. The app's unreachable banner shows as well. Nothing retries by itself.
6. While `/packs` is not showing, no countdown runs and nothing is fetched for it. Returning to the page refetches (§3.1 step 2).
7. A countdown that ends during an opening sends its `GET` as usual. Rule §3.1 step 5 orders the answers.

### 3.3 Opening a pack

1. `Open pack` is enabled when all of these hold:
   - the held answer has `odds` and `available ≥ 1`, or a key is held (step 4);
   - no opening is in flight;
   - no 429 wait is running.
2. **On activation** (click, Enter or Space), the page does the following in order:
   - It checks a synchronous single-flight guard (a ref, not React state). If an opening is in flight, the activation does nothing, so a double click or a held Enter sends one request.
   - The guard covers only the time in flight, and a near server answers before a double click's second click or the next auto-repeat. So the button also ignores a click whose `detail` is above 1 (the second click of a double click, or a double tap where the browser reports one) and an Enter keydown with `repeat` true; a later single click, tap or key press opens the next pack (manager decision, 2026-10-30).
   - It takes the held key, or creates `crypto.randomUUID()` and holds it.
   - It sends `POST /api/packs/open` with `{ requestId }`.
   - **On `/packs`**, it pushes `/packs/open` in the same task, so the opening shows there from its first frame (`navigation-and-landing.md` §3.13 step 1): title `Pack opening · Anime TCG`, focus on the `h1` `Pack opening`. On `/packs/open`'s own `Open pack` (§3.7 step 5), it stays on the page.
   - The button reads `Opening…` and is `aria-disabled`. On `/packs/open` it keeps focus; from `/packs`, focus has moved to the new page's `h1`, and if the player goes back during the flight, `/packs`'s button reads `Opening…` too.
   - On `/packs/open`, the previous reveal, if any, stays on screen with `aria-busy="true"` on its list until the answer arrives (§4.2). Nothing is cleared early, so nothing jumps. Arriving from `/packs`, the page shows the five empty slots instead (§3.4 step 7).
   - The Account control is disabled until the answer arrives (`accounts.md` §4.5).
   - No artificial delay is added: the current 350 ms `REVEAL_DELAY_MS` goes. The cards appear when the server's answer does.
3. **On the answer**:

| Answer                                                             | Key                        | Allowance and pity line                                                                                                                                        | Reveal                                                                           | Also                                                                                                                                                                  |
| ------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201, or 200 (a replay)                                             | discarded                  | from `PackOpened.allowance` and `PackOpened.packsUntilGuarantee`; the countdown restarts from this answer                                                      | the new pack, on `/packs/open`, with its entrance if that page is showing (§3.4) | `GET /api/collection` refetched (`Collection (<N>)`); the live region reads the summary (§7) if `/packs/open` is showing                                              |
| 409 `no_pack_available`                                            | discarded                  | `available` shown as 0 and the countdown starts from `retryAfterSeconds`; then **one** `GET /api/packs`, whose answer replaces the allowance and the pity line | unchanged                                                                        | the status line `There was no pack left to open.` (§8); `GET /api/collection` refetched, since another tab or device opened the packs                                 |
| 503 `pool_unavailable`                                             | discarded                  | unchanged (the server left it untouched)                                                                                                                       | unchanged                                                                        | the cards-unavailable state (§4.1) until a `GET /api/packs` answers with `odds`                                                                                       |
| 401 `unauthenticated`                                              | gone with the account      | gone                                                                                                                                                           | gone                                                                             | session ended; return path `/packs`                                                                                                                                   |
| 429 `rate_limited`                                                 | **kept** (open question 2) | unchanged                                                                                                                                                      | unchanged                                                                        | the wait (§4.1): the button reads `Try again in <S> s`; the wait line shows once                                                                                      |
| 400 `validation_failed`, 403 `bad_origin`, 500, any other envelope | discarded                  | unchanged                                                                                                                                                      | unchanged                                                                        | the generic failure line (§4.1). These are client or server bugs, and the page does not guess                                                                         |
| no answer (`NetworkError`)                                         | **kept**                   | unchanged                                                                                                                                                      | unchanged                                                                        | the app's unreachable banner; under the button `Couldn't reach the game server. Trying again opens this same pack, never a second one.`; the button reads `Try again` |

**Answers without cards, on `/packs/open`.** Every answer above except 201 and 200 has no cards to show. If `/packs/open` is showing when it lands, the app replaces it with `/packs` (§3.7 step 6), where the row of the table shows; 401 goes to `/login` as the table says.

4. **A held key** survives a page change (it lives in the signed-in layout) and is lost on reload, log out and session end. A lost key loses nothing: the cards are in the collection. While a key is held, `Open pack` reads `Try again` and stays enabled even if a later `GET` shows `available` 0 or `odds` null. A replay is answered before the allowance and snapshot checks (`collection-packs.md` §5.3 steps 2 to 4), so the retry still shows the pack the lost answer carried.
5. **Leaving during an opening**: the request finishes, the result goes into the layout's state and `Collection (<N>)` updates. The cards wait on `/packs/open` (Forward, or `See your latest pack` on `/packs`), without their entrance (`navigation-and-landing.md` §3.5 step 4). The live region does not announce a reveal that lands while `/packs/open` is not showing. An answer without cards that lands while another page is showing changes nothing but `/packs`'s row; nothing navigates.

### 3.4 The reveal

1. **Heading** (`h2`), from `PackOpened.packKind`: `Your pack` (standard), `Enchanted pack` or `Radiant pack` (`card-and-rarity.md` §7.1). The UI never infers the kind from the cards.
2. **Summary line**, under the heading: the pull summary (§8 `<summary>`). It counts the five cards' `rarity` per tier, rarest first, and leaves out tiers with no card, for example `1 Epic, 1 Rare and 3 Common`. Then ` · <k> new` when `k`, the number of cards with `isNew`, is at least 1. The demo reuses `<summary>` as `Demo pack: <summary>` (`navigation-and-landing.md` §8).
3. **Special lines**, under the summary, from `packKind` and `pityMythic`, in this order: the Enchanted line or the Radiant line, then the guarantee line (`card-and-rarity.md` §7.1, both lines when an Enchanted pack's Mythic came from pity). Their numbers come from the held `odds` (§8). A standard pack without pity has no line.
4. **Cards**: the five `PackOpened.cards` in `slot` order, 0 to 4, sorted by `slot` and never by rarity. Each card is the `card-and-rarity.md` card at reveal size with every effect (§5.3 "in the reveal always", stopped by reduced motion). It uses the card's `rarity` (granted) and `character`. Its series is `franchiseIds[0]` through `PackOpened.franchises`, and the rank chip's pool size is the held `odds.snapshot.characterCount` (`card-and-rarity.md` §6.2).
5. **New marker**: under a card whose `isNew` is true, in the card's caption row and outside the frame (nothing is drawn on the art, `card-and-rarity.md` §3.1). The word is `New`. Nothing else differs for a new card.
6. **Entrance**: each card's list item fades and rises 8 px over 200 ms. Slot `i` starts `i × 50 ms` after the answer, so the last card starts at 200 ms and lands at 400 ms (§6.3). The timing is the same for every pack. A Radiant pack, a pity Mythic, a Legendary or a Mythic gets no extra animation, delay, sound, colour or confetti beyond the card's own frame (`collection-packs.md` §8, `card-and-rarity.md` §5.3, §7.1). Under `prefers-reduced-motion: reduce` there is no entrance: the cards are there at once. The entrance runs only for an opening that lands while `/packs/open` is showing.
7. **Arriving on `/packs/open` from `/packs`**: five empty slots in the same grid (§5.2, §6.5) until the answer, under a heading block that keeps the height of the heading and the summary (§5.5), so the cards do not move the page when they land. There is no heading, summary or text yet. A special line, when the pack has one, adds its line above the grid as the cards land.
8. **Focus**: an opening started on `/packs` moves focus to the `Pack opening` `h1` (§3.3 step 2); it then stays where the player puts it. An opening started on `/packs/open` leaves focus on its `Open pack`. Neither page removes `Open pack` from the DOM: it is `aria-disabled` while opening, and also when that pack was the last one. The live region reads the reveal once (§7).
9. **Replay** (a 200 after a lost answer): drawn exactly like a 201, with the stored `packKind`, `pityMythic`, cards and `isNew`. No line says it was a retry.

### 3.5 The pity line and `Pack odds`

- **Pity line**: `card-and-rarity.md` §7.4 in every respect: wording, placement, look, `null`, no live region and no transition. It is its own `<p>` after the control and its countdown in DOM order, and it is never part of the button's name or description. It shows the number from the last applied answer (§3.1 step 5). During an opening it keeps the old number.
- **`Pack odds`**: a text button in the same row as the pity line (counter left, button right from 640 px; stacked on a phone, counter first, `card-and-rarity.md` §7.4). It opens the odds dialog of `card-and-rarity.md` §7.3, which reads the held `odds` whole. It is rendered only when `odds` is not null. The current one-line odds text in `BoosterPack` (`BASE_WEIGHTS`) goes.
- **Odds dialog** behaviour, which §7.3 leaves open: a native `<dialog>` opened with `showModal()` in the Manage account shell. Initial focus is on the dialog element (`tabindex="-1"`), as in `collection-overview.md` §7. `Close`, Escape and the backdrop close it, and focus returns to `Pack odds`. It can be opened during an opening and while waiting, and it shows the held answer, even a stale one. Below 640 px the tier column shows the word without the stars, header cells wrap, and the figures stay right-aligned at `text-sm` (§5.4).

### 3.6 The interim collection (`/collection`)

The page keeps today's Inventory layout and swaps its data and card for the server's (`collection-packs.md` §8). Item 3 replaces it.

1. **Data**: `GET /api/collection`. The signed-in layout fetches it at sign-in and after every opening answer (201, 200, 409), and refetches it silently each time `/collection` is shown. A held answer shows at once.
2. **Header link**: `Collection (<N>)`. `N` is `totals.cards` from the last collection answer, or `AccountPublic.cards` before the first one (open question 4). The UI never adds a pack's five cards itself: `N` changes when the refetch answers.
3. **Totals line**: `<cardCount>` · `<duplicates>` from `totals.cards` and `totals.duplicates`. Under it, the six per-tier totals from `totals.byRarity`, lowest tier first (`Common <N>` … `Mythic <N>`), with each tier word in its tier text colour.
4. **Rarity filter**: a view over the entries already held. A native `<select>` with the visible label `Rarity` and the options `All rarities` and the six tiers, lowest first. Changing it sends no request. Its value lives in the signed-in layout (`navigation-and-landing.md` §3.10), so it survives page changes and resets on reload and log out, as item 3's filters will.
5. **Grid**: one tile per entry, in the server's order (Mythic first, then name, `collection-packs.md` §5.5). The filter only hides entries. Each tile is the card at tile size, by the entry's granted `rarity`, with the caption under it (`×<N>` for 2 or more, `collection-overview.md` §6.2). The rank chip's pool size is `CollectionResponse.snapshot.characterCount` (with no snapshot, the rank alone, `card-and-rarity.md` §6.2). Tiles are not buttons: the card dialog is item 3's. Glows always show. Glint and drift play on hover only, because the tile cannot take focus until item 3 makes it a button (§9 note).
6. **No `Reset`**: no button, no confirm and no copy. The owner's `reset-collection` command is the only reset (`collection-packs.md` §5.6).
7. **States**: §4.3.

### 3.7 The opening page (`/packs/open`)

Owner, 2026-10-30: "Opening packs should also have their own route." The routing rules (push, replace, Back, Forward, guard, header link) are `navigation-and-landing.md` §3.13; this section says what the page shows and does.

1. **Arrival**: pushed when an opening starts on `/packs` (§3.3 step 2). Title `Pack opening · Anime TCG`; focus on the `h1` `Pack opening`. The second click of a double click, or a held Enter's repeats, may reach this page's `Open pack`: it ignores them (`detail` above 1, `repeat`, and the single flight), so one activation opens one pack.
2. **Top to bottom**: the `h1`; the action row: the count line `<n> of <cap> packs ready`, `Open pack` and the link `Back to packs`; then the reveal (§3.4). The action row comes first so that the button keeps its place from one pack to the next and stays above the fold on a phone.
3. **In flight**: `Open pack` reads `Opening…`, `aria-disabled`; the count line keeps the held number; the reveal shows the five empty slots (from `/packs`) or the previous reveal with `aria-busy` (from this page's button).
4. **Cards**: the reveal of §3.4, with its entrance when this page is showing; the live region reads `<heading>: <summary>.` once, and ` <k> new.` when `k ≥ 1` (§7). The count line takes the new allowance.
5. **`Open pack` on this page** is the control of §3.3 in every respect (enabled rules, guards, key, answers), except that it does not navigate. There is no countdown, timer, zero-time `GET`, pity line or `Pack odds` on this page; they stay on `/packs`. With `available` 0, `Open pack` is `aria-disabled` and described by the count line (`0 of 3 packs ready`), and `Back to packs` beside it leads to the countdown. (Owner, 2026-10-30: `navigation-and-landing.md` §9.2 question 3, option A.)
6. **An answer without cards** (409, 503, 429, 400, 403, 500, other, no answer) replaces `/packs/open` with `/packs`, which shows that answer's row (§4.1): the line under the button, the countdown, the `Try again` with a held key, or the wait. Focus goes to the `Packs` `h1` (`navigation-and-landing.md` §3.6 rule 1), and the line under the button is also sent to the app live region once, since a status line that is already there when a page renders is not reliably read. 401: session ended, return path `/packs`.
7. **`Back to packs`** is a link to `/packs` and pushes, as every link does. The browser's Back returns to the entry before, `/packs` when the player came from there.
8. **Shown again** (Back or Forward onto it, or `See your latest pack`): the held cards without their entrance, and one `GET /api/packs` for the count line, as `/packs` does on showing (§3.1 steps 2 and 5).
9. **Nothing held** (load, reload, typed address, or an entry whose opening ended without cards): replaced by `/packs` (`navigation-and-landing.md` §3.13 step 3).
10. **Leaving during the flight**: §3.3 step 5.

## 4. States

### 4.1 Pack control

`<n>` = `available`, `<cap>` = `cap`, both from the held answer.

| State                                   | User sees                                                                                                                                                                                                                                                                                                                                             | User can do                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| first `GET`, under 300 ms               | The `h1` only (and `See your latest pack`, if cards are held)                                                                                                                                                                                                                                                                                         | Wait                                |
| first `GET`, over 300 ms                | The count line as a static skeleton bar; `Open pack` `aria-disabled`; no countdown, pity line or `Pack odds`; visually hidden `Loading your packs…` (`role="status"`)                                                                                                                                                                                 | Wait                                |
| first `GET` failed, nothing held        | In place of the control: `Couldn't load your packs.` and `Try again` (one `GET`); the app's unreachable banner                                                                                                                                                                                                                                        | Try again                           |
| ready, below the cap (`1 ≤ n < cap`)    | `<n> of <cap> packs ready`; `Open pack` enabled; `Next pack in <M:SS>`; the pity line and `Pack odds`                                                                                                                                                                                                                                                 | Open, read the odds                 |
| at the cap (`n = cap`)                  | `<cap> of <cap> packs ready`; `Open pack` enabled; **no countdown line** and no timer (`nextPackInSeconds` is null)                                                                                                                                                                                                                                   | Open, read the odds                 |
| waiting (`n = 0`)                       | `0 of <cap> packs ready`; `Open pack` `aria-disabled`, described by the countdown; `Next pack in <M:SS>`; the pity line and `Pack odds`                                                                                                                                                                                                               | Wait, read the odds                 |
| countdown at zero, checking             | As before, with `Next pack in 0:00`, until the one `GET` answers; then the row the answer gives                                                                                                                                                                                                                                                       | Wait (sub-second)                   |
| countdown check failed                  | The held count; in place of the countdown `Couldn't check for the next pack.` and `Check again`; the unreachable banner                                                                                                                                                                                                                               | Check again                         |
| opening (in flight)                     | Seen on `/packs` only after going back from `/packs/open` during the flight: `Opening…`, `aria-disabled`; count, countdown and pity line unchanged                                                                                                                                                                                                    | Wait, read the odds, leave the page |
| opened                                  | The new allowance (any row above); the new pity number; `See your latest pack` at the end of the control block. The cards are on `/packs/open` (§4.4)                                                                                                                                                                                                 | Open again, see the pack, or wait   |
| none left (409)                         | `0 of <cap> packs ready`; `Open pack` `aria-disabled`; the countdown from `retryAfterSeconds`; under the button `There was no pack left to open.` (`role="status"`) until the next answer changes the row                                                                                                                                             | Wait                                |
| no answer, key held                     | Button `Try again`, enabled; under it `Couldn't reach the game server. Trying again opens this same pack, never a second one.`; the unreachable banner; count, countdown and pity line as held                                                                                                                                                        | Try again                           |
| cards unavailable (`odds` null, or 503) | Count and countdown as held; `Open pack` stays, `aria-disabled` (§3.4 step 8, §7), with `Cards are unavailable right now. Your packs are kept until they're back.` and `Check again` (one `GET`) under it (manager decision, 2026-10-30); no pity line, no `Pack odds`. With a key held, the button reads `Try again` and stays enabled (§3.3 step 4) | Check again                         |
| rate limited (429)                      | Button `aria-disabled`, reading `Try again in <S> s` (down to 1, `tabular-nums`); under it, once, `Packs take a short pause after many requests in a row. The button comes back by itself.`; at the end, `Open pack` (or `Try again` with a key) and the live region `You can try again now.`                                                         | Wait                                |
| generic failure (400, 403, 500, other)  | Under the button, `role="alert"`, `Couldn't open the pack. Try again.`; the button as the allowance gives                                                                                                                                                                                                                                             | Try again                           |
| session ended (401, any call)           | `/login`, the session-ended banner and focus on `Log in` (`navigation-and-landing.md` §3.5 step 8); after logging in, `/packs` with no reveal and no key                                                                                                                                                                                              | Log in                              |
| stale (a later call got no answer)      | The held answer as it was, the countdown still running from it; the unreachable banner                                                                                                                                                                                                                                                                | As the held row allows              |

Lines under the button (none left, no answer, wait, failure) replace each other and clear on the next answer that changes the row. At most one shows.

A 201 or 200 (replay) answer to an opening also clears the app's unreachable banner that a lost answer raised, since the server has answered (manager decision, 2026-10-30).

`Couldn't check for the next pack.` belongs to the answer the check failed after: any newer answer (a `GET`, or an opening's 201 or 200) replaces it, and that answer's countdown shows (manager decision, 2026-10-30).

A zero-time `GET` answered with an error envelope (a 500 or any other) is treated like no answer: `Couldn't check for the next pack.` and `Check again`, without the unreachable banner, since the server answered (manager decision, 2026-10-30).

The 429 wait honours `Retry-After` up to 3600 s; a longer one counts down from 3600 s, as the account forms cap theirs (manager decision, 2026-10-30).

### 4.2 Reveal

| State                             | User sees                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| arriving from `/packs`, in flight | Five empty slots; no heading or text; the heading block's height kept                                                             |
| revealed (standard)               | `Your pack`; the summary; five cards in slot order with their entrance; `New` under the new ones                                  |
| revealed (Enchanted)              | `Enchanted pack`; the summary; the Enchanted line; with `pityMythic` also the guarantee line                                      |
| revealed (Radiant)                | `Radiant pack`; the summary; the Radiant line                                                                                     |
| revealed (pity, standard)         | `Your pack`; the summary; the guarantee line                                                                                      |
| opening again                     | The previous reveal unchanged, list `aria-busy`, until the answer replaces it                                                     |
| shown again on `/packs/open`      | The held reveal, no entrance                                                                                                      |
| image loading / failed            | The card's art placeholder / `No image` (`card-and-rarity.md` §3.3)                                                               |
| character not in snapshot         | Not possible in a fresh pack. In a held reveal after a snapshot change, the card draws without a rank chip, as the card spec says |
| reduced motion                    | The same, with no entrance, glint or drift; frames and glows still show                                                           |

### 4.3 Interim collection (`/collection`)

| State                             | User sees                                                                                                                                                                         | User can do    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| first load, under 300 ms          | The `h1` only                                                                                                                                                                     | Wait           |
| loading (over 300 ms)             | Totals as two static skeleton bars; the `Rarity` select disabled; 12 skeleton tiles (`collection-overview.md` §6.2); visually hidden `Loading your collection…` (`role="status"`) | Wait           |
| empty (`entries` is empty)        | `No cards yet` and the link `Open a pack` (to `/packs`); no totals or filter                                                                                                      | Go to `/packs` |
| loaded                            | Totals line, per-tier totals, `Rarity` filter, grid                                                                                                                               | Filter         |
| filtered, no match                | Totals and filter; in place of the grid `No <Tier> cards in your collection.`                                                                                                     | Change filter  |
| refreshing (data held)            | The held data; nothing marks the refetch                                                                                                                                          | Everything     |
| stale (refetch failed, data held) | The held data; under the totals `Showing your collection as of <HH:MM>.`; the unreachable banner                                                                                  | Filter, retry  |
| error (nothing held)              | `Couldn't load your collection.` and `Try again`; the unreachable banner when the network is the cause                                                                            | Try again      |
| session ended                     | `accounts.md` §4.8, return path `/collection`                                                                                                                                     | Log in         |

### 4.4 Opening page (`/packs/open`)

| State                                               | User sees                                                                                                             | User can do                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| arriving, in flight                                 | `h1` `Pack opening` (focused); the count line as held; `Opening…`, `aria-disabled`; `Back to packs`; five empty slots | Wait, go back               |
| revealed                                            | The new count line; `Open pack` as the allowance allows; the reveal with its entrance (§4.2)                          | Open the next pack, go back |
| revealed, none left (`n = 0`)                       | `0 of <cap> packs ready`; `Open pack` `aria-disabled`, described by the count line; `Back to packs`                   | Go back                     |
| opening again from this page                        | The previous reveal, `aria-busy`; `Opening…`, focus kept                                                              | Wait                        |
| answer without cards                                | Replaced by `/packs`, which shows that answer's row (§4.1); focus on `Packs`; the line read once                      | As `/packs` allows          |
| shown again (Back, Forward, `See your latest pack`) | The held reveal, no entrance; the count line refreshed by one `GET`                                                   | As revealed                 |
| nothing held (load, reload, typed address)          | Replaced by `/packs` (no focus move on a load)                                                                        | As `/packs` allows          |
| session ended                                       | `/login`, the session-ended banner; return path `/packs`                                                              | Log in                      |

## 5. Layout

Breakpoints are Tailwind's: phone below 640 px, `sm` 640, `lg` 1024. The page container is unchanged (`max-w-6xl px-4 sm:px-6`). Everything is **left-aligned** under the `h1` (`navigation-and-landing.md` §5.2). Today's centred column goes.

### 5.1 `/packs`, top to bottom

1. `h1` `Packs`, `mb-6`.
2. **Control block**, `max-w-md`, `flex flex-col items-start gap-2`:
   - the count line;
   - `Open pack`: full width on a phone, auto from `sm`;
   - the line under the button, when there is one;
   - the countdown line;
   - the pity and odds row, `mt-2`: stacked on a phone (pity line first, then `Pack odds`), and from `sm` one row, `flex items-baseline justify-between gap-4`;
   - `See your latest pack`, `mt-2`, while cards are held.
3. No reveal section: the reveal's layout (the heading, then the summary `mt-1`, then the special lines `mt-1 max-w-prose`, then the grid `mt-4`) is on `/packs/open` (§5.5).

### 5.2 Reveal grid

The card is `card-and-rarity.md` §3.2's reveal size: 180 × 252 px from 640 px, fluid below.

| Viewport | Grid                                                                   | Card                | Rows for 5 cards |
| -------- | ---------------------------------------------------------------------- | ------------------- | ---------------- |
| 320 px   | `grid-cols-2 gap-4` (288 px content)                                   | 136 × 190 px, fluid | 3 (2 + 2 + 1)    |
| 640 px   | `sm:grid-cols-[repeat(3,11.25rem)]` (3 × 180 + 2 × 16 = 572 of 592 px) | 180 × 252 px        | 2 (3 + 2)        |
| 1024 px  | `lg:grid-cols-[repeat(5,11.25rem)]` (5 × 180 + 4 × 16 = 964 of 976 px) | 180 × 252 px        | 1                |

- The grid is left-aligned, `justify-start`. The empty slots use the same grid and the card's 5:7 box, so nothing moves when cards land.
- The caption row under each card (`New`, or empty) is always one line tall (`min-h-5`), so rows line up whether or not a card is new.
- A long name or series truncates inside the card (`card-and-rarity.md` §3.1, §3.2). The summary and the special lines wrap.

### 5.3 Interim collection

- `h1`, then the totals line, the per-tier totals (`flex flex-wrap gap-x-4 gap-y-1`), then the `Rarity` label and select (`w-full sm:w-48`), `mt-4`. Then the grid, `mt-4`.
- Grid: `collection-overview.md` §5.1 (minimum tile 10.5 rem, never fewer than 2 columns). That gives 2 columns at 320 px (138 px tiles), 3 at 640 px and 5 at 1024 px.
- Empty and error states: centred, `py-16` (`collection-overview.md` §6.3).

### 5.4 Odds dialog

The Manage account shell (`w-[calc(100%-2rem)] max-w-lg max-h-[85vh]`, the body scrolls). At 320 px the table's four columns fit in the 240 px of content because the stars are hidden below `sm` and the header cells wrap. At 640 px and up, the stars show before each tier word.

### 5.5 `/packs/open`, top to bottom

1. `h1` `Pack opening`, `mb-6`.
2. **Action row**, `flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4`: the count line, `Open pack` (full width on a phone, auto from `sm`), `Back to packs`.
3. **Reveal section**, `mt-10`: the heading, the summary (`mt-1`), the special lines (`mt-1`, `max-w-prose`), the grid (`mt-4`, §5.2). While the empty slots show, the heading block keeps the height of the heading and the summary (`min-h-[3.25rem]`), so the grid does not move when they arrive.

## 6. Visual treatment

The debt that `docs/06-engineering-standards.md` §2 lists for these components goes. The only exception is the card frames that `card-and-rarity.md` §5.4 allows (the owner's exception, frames only).

| Today                                                                                                                                                                                                                       | Replacement                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `BoosterPack`: three-colour gradient button, `shadow-lg`, `hover:scale-[1.03]`, `active:scale`, `rounded-2xl`, `text-lg`                                                                                                    | `BUTTON.primary` from `web/src/components/account/styles.ts`, unchanged: flat violet, no shadow, no scale, `rounded-lg`   |
| `BoosterPack`'s odds line from `BASE_WEIGHTS`                                                                                                                                                                               | the pity line and `Pack odds` (§3.5)                                                                                      |
| `CharacterCard`: `FRAME_CLASS` glows on every tier, `glow-legendary` pulse, `rounded-2xl`, `hover:-translate-y-1`, image `group-hover:scale-105`, gradient scrim, `RarityBadge` overlay, `backdrop-blur-sm` badges, shadows | the `card-and-rarity.md` card; frames and glow only for Epic, Legendary and Mythic as §5.2 allows; nothing moves on hover |
| `card-reveal`: 550 ms, `rotateY(90deg)`, `scale(0.9)`, 120 ms stagger                                                                                                                                                       | `card-enter` (§6.3): 200 ms, opacity and 8 px, 50 ms per slot                                                             |
| the summary's `text-amber-300` / `text-sky-300` words, centred                                                                                                                                                              | tier text tokens (`--color-rarity-<tier>-text`), left-aligned                                                             |
| Inventory: dashed empty box, `Reset` (red outline), the `×N` badge over the art with `backdrop-blur`                                                                                                                        | `collection-overview.md` §6.3's empty state; no `Reset`; `×N` in the caption under the card                               |

### 6.1 Pack control

- Count line: `text-sm font-medium text-zinc-200 tabular-nums`. Its skeleton is `h-4 w-36 rounded bg-zinc-800`, static.
- `Open pack`: `BUTTON.primary`, `w-full sm:w-auto`. `Opening…`, `Try again` and `Try again in <S> s` use the same button. `aria-disabled` looks like `disabled` (the existing `DISABLED` classes).
- Countdown line: `text-sm text-zinc-400 tabular-nums`. The number changes without animation.
- Lines under the button: the none-left, wait and unavailable lines in `text-sm text-zinc-400`; the no-answer and failure lines in `ERROR_TEXT` at `text-sm`. `Check again` and `Try again` (load failure): `BUTTON.secondary`.
- Pity line: `text-xs text-zinc-400 tabular-nums` (`card-and-rarity.md` §7.4). `Pack odds`: `BUTTON.text` at `text-sm`.
- `See your latest pack`: `BUTTON.text` at `text-sm`, a link. On `/packs/open`: the count line as on `/packs`, `Open pack` as on `/packs`, `Back to packs` a link with `BUTTON.secondary`'s classes. The `h1` `Pack opening` as every account page's (`navigation-and-landing.md` §6.3).
- No icon, gradient, glow, shadow, ring, meter or badge anywhere on the control. Nothing pulses when a pack is ready or at the cap.

### 6.2 Reveal

- Heading: `text-lg font-bold text-zinc-100`, the same for every kind (no colour, star or icon for Enchanted or Radiant).
- Summary: `text-sm text-zinc-300`. Each tier word is in `text-rarity-<tier>-text`, each number in `text-zinc-200 tabular-nums`, and ` · <k> new` in `text-zinc-300`.
- Special lines: `text-sm text-zinc-400`.
- `New` marker: the flat marker of `collection-overview.md` §6.4 (`rounded border border-zinc-600 px-1.5 text-[11px] font-semibold tracking-wider uppercase text-zinc-200`), no fill and no glow. It is in the caption row, left.
- Cards: `card-and-rarity.md`, with every effect at reveal size and `--card-phase` from the character id.

### 6.3 Motion and the new tokens

The reveal entrance is the only new motion. Its tokens are added to `web/src/index.css` with this spec:

| Token                  | Where    | Value                                                                                                 |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `--animate-card-enter` | `@theme` | `card-enter 200ms ease-out both`, with `@keyframes card-enter` (opacity 0 → 1, `translateY(8px)` → 0) |
| `--card-enter-step`    | `:root`  | `50ms`, the delay between one slot and the next                                                       |

- It goes on each slot's list item, not on the card. The Mythic frame animates its own background (`card-pearl`) and one element cannot run two `animation`s without one replacing the other. The item gets `animate-card-enter motion-reduce:animate-none` and `animation-delay: calc(var(--slot) * var(--card-enter-step))`, with `--slot` set from `slot`.
- `both` keeps a waiting card invisible until its turn. Under reduced motion there is no animation, so the cards show at once.
- It runs only for an opening that lands while `/packs/open` is showing (§3.4 step 6). Re-renders, filter changes and returning to the page do not run it.
- The card's tokens (`card-and-rarity.md` §10) land in this PR with the card. They are specified there, so this spec adds nothing to them. `card-reveal`, `legendary-pulse` and `.glow-legendary` are removed with `CharacterCard`.

### 6.4 Interim collection

`collection-overview.md` §6.2 (tile caption, skeleton tile) and §6.3 (totals line, empty, error and stale note), with these differences:

- the filter is the existing native `<select>` with the `INPUT` classes and a visible `Rarity` label (`text-xs text-zinc-400`), not item 3's chips;
- the tile is not a button, so it has no focus ring;
- no completion, view switch, search, sort or pages.

### 6.5 The shared reveal component (for the demo)

The reveal (the heading, the summary, the lines, the grid with empty slots, the entrance) is one component, so the demo PR reuses it. It takes:

- the heading text and the list's label;
- the cards (`slot`, `character`, `rarity`, and `isNew` when known);
- the franchises and the pool size;
- whether this render is a new opening (entrance or not);
- an effects mode (`full` here, `none` for the demo);
- whether to show `New` markers and the special lines (both off for the demo, `navigation-and-landing.md` §3.7 item 1.4).

The summary phrase (`<summary>`) is one function both use.

## 7. Accessibility

- **Headings**: `/packs` has one `h1` `Packs` (focus target, `navigation-and-landing.md` §3.6) and the odds dialog's heading `h2` `Pack odds`. `/packs/open` has one `h1` `Pack opening` (focus target) and the reveal, a `<section aria-labelledby>` its `h2`.
- **Control**: `Open pack` is a `<button>`, never removed. While it is unusable (opening, waiting, the 429 wait) it is `aria-disabled="true"`, not `disabled`, so focus stays on it (`accounts.md` §11). Activating it then does nothing. Waiting, `aria-describedby` points at the countdown line, so focusing the button tells the player why it is unusable and how long the wait is. Its name is its visible text only. The count and the pity line are never in its name or description (`card-and-rarity.md` §7.4).
- **Countdown, not announced every second**: the countdown line is a plain `<p>`, not a live region. The visible `Next pack in 7:42` is `aria-hidden`, and a visually hidden sibling carries `Next pack in 7 minutes 42 seconds` (§8), so it is not read as a time of day. A screen reader reads the current value when the player reaches it.
- **When a pack arrives**: only when the count rises from 0 to at least 1 while `/packs` is showing, the app live region reads the new count line once (`1 of 3 packs ready.`). This tells a screen-reader user that the button just became usable, as a sighted player sees. A rise from 1 to 2 is not announced, and nothing is announced on any other page.
- **The reveal**: when a new opening lands while `/packs/open` is showing, the app live region reads `<heading>: <summary>.` and then ` <k> new.` when `k ≥ 1`, once (for example `Your pack: 1 Epic, 1 Rare and 3 Common. 2 new.`). The special lines, the cards and the pity number are not announced: they are in the reading order right after it. The reveal section itself is not a live region.
- **Reveal list**: `<ul role="list" aria-labelledby="<reveal heading id>">` of five `<li>`s in slot order (DOM order = visual order, row by row). Each `<li>` holds the card's `<article aria-label="<name>, <Tier>, <series>">` (`card-and-rarity.md` §8) and, when new, the visible text `New`. The empty slots are `aria-hidden="true"` and the list has no items before the first pack. `aria-busy="true"` is set while an opening is in flight.
- **Status and errors**: the none-left and wait lines are `role="status"`, rendered once. The failure line is `role="alert"`. The no-answer line is plain text, because the app banner is already the `role="alert"`. The unavailable line is plain text. `You can try again now.` goes to the app live region when the 429 wait ends, as the Log in wait does (`accounts.md` §7). `Loading your packs…` is a visually hidden `role="status"`.
- **Keyboard path**: on `/packs`, Skip link → `h1` → `Open pack` (Enter or Space opens, and moves to `/packs/open`) → `Check again` or `Try again` when shown → `Pack odds` (Enter opens the dialog; Tab moves through it; Escape or `Close` returns to `Pack odds`) → `See your latest pack` when shown. On `/packs/open`, Skip link → `h1` → `Open pack` → `Back to packs` → the cards, which are not focusable (they are articles, read in browse mode). Nothing on either page needs a pointer.
- **Answers without cards**: after the replace to `/packs` (§3.7 step 6), focus is on the `Packs` `h1` and the app live region reads the line under the button once; the line keeps its own role (`role="status"` or `role="alert"`) as in §4.1.
- **Interim collection**: `h1` `Collection`. The `Rarity` `<select>` has a visible `<label>`. The grid is `<ul role="list" aria-label="Your cards">`. Each tile's article is named as the card spec says. The caption's `×<N>` is `aria-hidden`, with a visually hidden `<N> copies` beside it. The loading text is a visually hidden `role="status"`. The empty-state `Open a pack` is a real link.
- **Contrast** (WCAG AA, text at 4.5:1), on `zinc-950` (`#09090b`):

| Text                                                      | Colour                       | Ratio                                    |
| --------------------------------------------------------- | ---------------------------- | ---------------------------------------- |
| count line, `New` marker, summary numbers                 | `zinc-200`                   | 15.6                                     |
| summary, `· <k> new`                                      | `zinc-300`                   | 13.5                                     |
| countdown, pity line, special lines, status lines, labels | `zinc-400`                   | 7.76                                     |
| no-answer and failure lines                               | `red-300`                    | 10.5                                     |
| tier words in the summary and totals                      | `--color-rarity-<tier>-text` | 5.74 or more (`card-and-rarity.md` §4.2) |
| `Open pack` text on `violet-600`                          | white                        | 5.7                                      |
| focus ring `violet-500` against `zinc-950` (non-text)     | —                            | 4.5 or more (3:1 needed)                 |

No text on this page uses `zinc-500` (4.12:1 on `zinc-950`, below AA). The card's own pairs are in `card-and-rarity.md` §4.2.

- **Touch targets**: `Open pack`, `Check again`, `Try again`, `Pack odds`, `Close` and the `Rarity` select are at least 40 px tall on a phone (the existing `PHONE_MIN_HEIGHT`).
- **Reduced motion**: no entrance, glint or drift (§6.3, `card-and-rarity.md` §5.3). Nothing else on the page moves.
- **T1**: character names, native names and series titles are rendered as text nodes only (no `dangerouslySetInnerHTML`, no `title` built by concatenating markup), in the reveal and in the collection.
- **Bidi isolation**: each name and series title sits in its own `dir="auto"` element and is wrapped in U+2068 … U+2069 in every plain-string sink (the card's `aria-label` and `title`s), as C9 does for logins (`card-and-rarity.md` §8, `collection-overview.md` §5.6).

## 8. Copy

Exact strings, for a new module `web/src/lib/packsCopy.ts`. The copy test renders every string of it and scans them as it scans `navigationCopy.ts`. `navigationCopy.ts` loses `poolCopy` and `packsCopy`, and `copy.ts` loses `inventoryCopy`. The card's own strings (`No image`, the stars' text, the rank's text) are `card-and-rarity.md`'s.

**Placeholders.** `<n>` is `available`. `<cap>` is `cap`. `<M:SS>` is the countdown, minutes and two-digit seconds, or `<H:MM:SS>` from one hour. `<S>` is the 429 wait in seconds. `<k>` is the number of new cards. `<Tier>` is a `RARITY_LABEL`. `<N>` is a count, formatted with `Intl.NumberFormat("en-GB")`. `<HH:MM>` is formatted as `collection-overview.md` §8. **Number words and ordinals**: ordinals use `Intl.PluralRules("en-GB", { type: "ordinal" })` (`10th`, `300th`, `1st`, `2nd`, `3rd`), and slot and pack-size words come from a five-word list (`first` … `fifth`, `one` … `five`).

**Rules.** No string here uses a word that `navigation-and-landing.md` §8 or `collection-overview.md` §8 forbids. That covers the security words, the money words, exclamation marks, urgency, scarcity, "lucky", "win", "prize", "one more" and "another", and also comments on what a pack contained. **One exception is open** (open question 1): `free`, which `navigation-and-landing.md` §8 forbids and `card-and-rarity.md` §7.1 and §7.4 require in the owner-decided phrase `free pack` / `free packs`.

**Pack control**

| Key           | Element                                    | Copy                                                                                                                                                                |
| ------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `count`       | Count line                                 | `<n> of <cap> packs ready` (with `cap` 1: `<n> of 1 pack ready`)                                                                                                    |
| `loading`     | Loading (visually hidden)                  | `Loading your packs…`                                                                                                                                               |
| `loadFailed`  | First `GET` failed                         | `Couldn't load your packs.`                                                                                                                                         |
| `tryAgain`    | Its button; the button with a key held     | `Try again`                                                                                                                                                         |
| `open`        | Button                                     | `Open pack`                                                                                                                                                         |
| `opening`     | Button, in flight                          | `Opening…`                                                                                                                                                          |
| `waitButton`  | Button, 429                                | `Try again in <S> s` (the existing `common.tryAgainIn`)                                                                                                             |
| `next`        | Countdown, visible                         | `Next pack in <M:SS>`                                                                                                                                               |
| `nextSpoken`  | Countdown, visually hidden                 | `Next pack in <m> minutes <s> seconds`; `1 minute`, `1 second`; no minutes part under one minute (`Next pack in 42 seconds`); from one hour `<h> hours <m> minutes` |
| `checkFailed` | Countdown check failed                     | `Couldn't check for the next pack.`                                                                                                                                 |
| `checkAgain`  | Its button; the unavailable state's button | `Check again`                                                                                                                                                       |
| `noneLeft`    | 409 line                                   | `There was no pack left to open.`                                                                                                                                   |
| `unavailable` | Cards unavailable                          | `Cards are unavailable right now. Your packs are kept until they're back.`                                                                                          |
| `noAnswer`    | No answer, key held                        | `Couldn't reach the game server. Trying again opens this same pack, never a second one.`                                                                            |
| `failed`      | Generic failure                            | `Couldn't open the pack. Try again.`                                                                                                                                |
| `wait`        | 429 line                                   | `Packs take a short pause after many requests in a row. The button comes back by itself.`                                                                           |
| `waitOver`    | 429 over (live region)                     | `You can try again now.` (the existing `common.waitOver`)                                                                                                           |
| `ready`       | Count rose from 0 (live region)            | the count line followed by `.`, e.g. `1 of 3 packs ready.`                                                                                                          |
| `pity`        | Pity line                                  | `card-and-rarity.md` §7.4: `Mythic guaranteed within <N> free packs.` / `Mythic guaranteed within 1 free pack.` (`packs` / `pack` when `freePacksOnly` is false)    |
| `latest`      | Link on `/packs` while cards are held      | `See your latest pack`                                                                                                                                              |
| `back`        | Link on `/packs/open`                      | `Back to packs`                                                                                                                                                     |
| (route)       | `h1` and title of `/packs/open`            | `Pack opening` · `Pack opening · Anime TCG` (`navigation-and-landing.md` §8)                                                                                        |
| `odds`        | Odds button and dialog heading             | `Pack odds`; the dialog's strings are `card-and-rarity.md` §7.3; its button `Close` (`common.close`)                                                                |

**Reveal**

| Key          | Element                           | Copy                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heading`    | Heading and list label            | `Your pack` (standard) · `Enchanted pack` · `Radiant pack`                                                                                                                                                                                                                                                                                                                                                                                        |
| `summary`    | `<summary>`, shared with the demo | `<N> <Tier>` per tier with at least one card, rarest first, joined with `, ` and a final `and`: `5 Common` · `1 Rare and 4 Common` · `1 Epic, 1 Rare and 3 Common`                                                                                                                                                                                                                                                                                |
| `newCount`   | After the summary, `k ≥ 1`        | ` · <k> new`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `newMarker`  | Under a new card                  | `New`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `enchanted`  | Enchanted line                    | `Every <every-th> free pack is Enchanted: its <slot word> card is <Floor> or better.`, where `<every-th>` is the ordinal of `odds.enchanted.every`, `<slot word>` the word for `odds.enchanted.slot + 1` and `<Floor>` the label of `odds.enchanted.floor`. Today: `Every 10th free pack is Enchanted: its fifth card is Epic or better.`                                                                                                         |
| `radiant`    | Radiant line                      | `About 1 pack in <N> is Radiant: <size word> cards of <Lowest> or better, at least one of them <Last>.`, where `<N>` is `odds.scale ÷ odds.radiant.chance` rounded, `<size word>` the word for `odds.slots.length`, `<Lowest>` the lowest tier with non-zero odds in `odds.radiant.odds` and `<Last>` the label of `odds.radiant.lastSlot`. Today: `About 1 pack in 2,500 is Radiant: five cards of Epic or better, at least one of them Mythic.` |
| `pityMythic` | Guarantee line                    | `This Mythic came from the guarantee: a <packs-th> free pack in a row without a Mythic always has one.`, where `<packs-th>` is the ordinal of `odds.pity.packs`. Today: `… a 300th free pack in a row …`                                                                                                                                                                                                                                          |
| (free)       | In the three lines above          | `free ` is left out when `odds.pity.freePacksOnly` is false (`card-and-rarity.md` §7.1)                                                                                                                                                                                                                                                                                                                                                           |
| `announce`   | Live region on a reveal           | `<heading>: <summary>.` then ` <k> new.` when `k ≥ 1`                                                                                                                                                                                                                                                                                                                                                                                             |

**Interim collection**

| Key           | Element                   | Copy                                                                                          |
| ------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| (route)       | `h1`, title, header link  | `Collection` · `Collection · Anime TCG` · `Collection (<N>)` (`navigation-and-landing.md` §8) |
| `loading`     | Loading (visually hidden) | `Loading your collection…`                                                                    |
| `empty`       | Empty heading             | `No cards yet`                                                                                |
| `openAPack`   | Empty link                | `Open a pack`                                                                                 |
| `error`       | Error                     | `Couldn't load your collection.` with `Try again`                                             |
| `stale`       | Stale note                | `Showing your collection as of <HH:MM>.`                                                      |
| `cards`       | Totals                    | the existing `cardCount`: `No cards yet` / `1 card` / `<N> cards`                             |
| `duplicates`  | Totals                    | `No duplicates` / `1 duplicate` / `<N> duplicates`, after `·`                                 |
| `perTier`     | Per-tier totals           | `Common <N>` · `Uncommon <N>` · `Rare <N>` · `Epic <N>` · `Legendary <N>` · `Mythic <N>`      |
| `filterLabel` | Filter label              | `Rarity`                                                                                      |
| `filterAll`   | First option              | `All rarities`; then the six `RARITY_LABEL`s                                                  |
| `noMatch`     | Filter with no match      | `No <Tier> cards in your collection.`                                                         |
| `copies`      | Caption                   | `×<N>` (visible), `<N> copies` (visually hidden)                                              |
| `gridLabel`   | Grid list label           | `Your cards`                                                                                  |

**Removed**: `Open Booster Pack`, the `Base odds · …` line, `You pulled`, `Loading character pool from AniList…`, `Couldn't load characters:`, `Retry` (the AniList banner), `Reset`, `Delete every card in <login>? This cannot be undone.` and `Your collection is empty. Open a pack to get started.`.

## 9. Open questions

Each has a recommendation. None is an owner-level product question except 1, whose wording the owner already chose in `card-and-rarity.md`.

**Decided by the manager, 2026-10-29: all five as recommended.** 1: the exception is recorded in `navigation-and-landing.md` §8 and the copy test allows only the two exact phrases. 2 and 3: `collection-packs.md` §8 amended (the key survives a 429; the wait is `Retry-After`, else 60 s). 4: `AccountPublic.cards`. 5: hover only in 1c.

1. **`free` is forbidden by one spec and required by another.** `navigation-and-landing.md` §8 lists `free` among forbidden words. The owner-decided pity line (`card-and-rarity.md` §7.4) and the special lines (§7.1) say `free pack(s)`, a defined term for allowance packs (`collection-packs.md` §5.2). **Recommendation**: the copy test allows `free` only in the exact phrases `free pack` and `free packs`, and only in `packsCopy` and the odds dialog. It still rejects `free` anywhere else. The manager records the exception beside the owner's frame exception.
2. **The `requestId` after a 429.** `collection-packs.md` §8 says "any answer from the server discards it". A 429 comes from the rate limiter before the route looks for the key, so it says nothing about the opening. If it discards a key held after a lost answer, the next click opens a second pack and the first pack's reveal is never shown. **Recommendation**: keep the key on 429 (this spec's §3.3 table already assumes it) and discard it on every other answer. `collection-packs.md` §8 gains "except 429" (the manager's spec).
3. **The 429's wait has no number in the body.** `rate_limited` envelopes carry no `retryAfterSeconds` (`api/src/plugins/security.ts`, `shared/src/errors.ts`), and `web/src/lib/api.ts` reads only the body. `@fastify/rate-limit` does send `Retry-After`. **Recommendation**: the web client reads the `Retry-After` header (whole seconds, at least 1) when the body has no `retryAfterSeconds`. With neither, the wait is 60 s, the window of `PACK_RATE_LIMIT` and the demo's fallback (`navigation-and-landing.md` §8). The alternative, adding the field to the 429 body, is a contract change for the manager.
4. **`Collection (<N>)` before the first collection answer.** `navigation-and-landing.md` §8 says `Collection` with no number. `collection-overview.md` §3.1 says `AccountPublic.cards`, which 1c makes the real count. **Recommendation**: `AccountPublic.cards` from the session answer, so the link always shows a number and does not change width when the collection loads. `navigation-and-landing.md` §8's "before the first count" row then covers only an account answer without `cards`, which cannot happen.
5. **Glint and drift on interim tiles.** `card-and-rarity.md` §5.3 plays them in grids "on hover or focus", but the interim tiles cannot take focus until item 3 makes them buttons. **Recommendation** (applied in §3.6): hover only in 1c, which is decoration that no keyboard user misses. Item 3 adds focus with the button.

## 10. Test hooks

The tester queries by role and accessible name, as in the existing suites. The only extra attribute is `data-slot` on each reveal `<li>`. Unit tests cover what `collection-packs.md` §9 "Web (PR 2)" lists, and these:

- every row of §4.1;
- the newest-request-wins rule of §3.1 step 5;
- the summary phrase for 1 to 6 tiers;
- the ordinals and number words;
- each special line per `packKind` and `pityMythic`, with `freePacksOnly` true and false;
- no live announcement when a reveal lands while `/packs/open` is not showing;
- the replace to `/packs` for each answer without cards, and the line sent to the live region;
- `See your latest pack` present exactly while cards are held;
- the copy scan of `packsCopy`.

**e2e** (`web/e2e`, against the compose stack with a snapshot seeded through `snapshot-pool --stdin`, `collection-packs.md` §7.1, and Playwright's `page.clock` for time). It asserts:

1. **No AniList API**: across sign-in, three openings, `/collection` and a reload, no request goes to `graphql.anilist.co` (a `page.on("request")` collector that fails on any host other than the app's origin and `s4.anilist.co`). The response's CSP has `connect-src 'self'` and still `img-src 'self' https://s4.anilist.co`.
2. **No browser storage**: `localStorage` and `sessionStorage` hold no `anime-tcg:` key after openings. The old `anime-tcg:inventory:v1` value is neither read nor changed (the existing check).
3. **The cap and the countdown**:
   - A new account reads `3 of 3 packs ready`, with no `Next pack in` text.
   - After one opening it reads `2 of 3 packs ready` and `Next pack in 10:00` (or `9:59`), counting down under `page.clock`.
   - After three openings (the first from `/packs`, the next two from `/packs/open`), `/packs/open`'s `Open pack` has `aria-disabled="true"` and keeps focus.
4. **One refetch, no polling**:
   - At the cap, advancing the clock 60 minutes sends no request to `/api/packs`.
   - Below the cap, running the clock to the countdown's zero sends exactly one `GET /api/packs`. The count rises, and the live region reads `1 of 3 packs ready.`
   - Advancing a further 9 minutes sends nothing.
5. **Double-click proof**: a double click, and Enter held down, on `/packs`'s `Open pack` send one `POST /api/packs/open`, or several with the same `requestId`, push `/packs/open` once (`history.length` grows by one), and the count falls by exactly one. The same on `/packs/open`'s `Open pack`, which pushes nothing.
6. **Lost answer**:
   - `page.route` lets the first `POST` reach the server (`route.fetch()`) and then aborts it, so the response is lost.
   - The unreachable banner and `Try again` show.
   - The next click sends the same `requestId`. The answer is a 200 with the cards the first request was dealt (compared with the intercepted body), and `available` fell by one in total, not two.
7. **The reveal**:
   - Five list items in the `slot` order of the response.
   - `New` exactly under the cards with `isNew`.
   - The summary matches the response's rarities.
   - The heading is `Your pack` for a standard pack.
   - The kind variants are covered by unit tests and, if wanted, by `route.fulfill` with a crafted `PackOpened`.
   - After the first opening from `/packs`, focus is on the `h1` `Pack opening`; after an opening from `/packs/open`, focus stays on its `Open pack`. The live region reads the summary once.
8. **Pity line**: it reads `within 300 free packs` on a new account and falls by one per opening. It is not a live region and not in the button's description.
9. **409**:
   - Two browser contexts on one account; the second opens the remaining packs.
   - The first context's click shows `There was no pack left to open.` and a countdown, and sends one follow-up `GET /api/packs`.
10. **503**: a stack without a snapshot, or `GET /api/packs` fulfilled with `odds: null`, shows the unavailable line and `Check again`, with no pity line and no `Pack odds`.
11. **401**: the session cookie is cleared, then `Open pack` is clicked. The page goes to `/login` with the session-ended banner, and logging in returns to `/packs`.
12. **429**: the `POST` is fulfilled with a 429 envelope and `Retry-After: 3`. The button reads `Try again in 3 s` and counts down. Then `You can try again now.` is announced.
13. **Collection**:
    - `Collection (<N>)` equals `totals.cards` after openings and after a reload.
    - `/collection` shows six tier options and no `Reset` button.
    - Changing the `Rarity` filter sends no request.
    - Hostile names from the seeded snapshot (`<script>`, `<img onerror>`, RTL override) render as text in the reveal and in the collection.
14. **Nothing else nags**: during the countdown and at its end, `document.title` stays `Packs · Anime TCG`, and `Notification.requestPermission` is never called (stubbed and counted).
15. **Reduced motion** (`page.emulateMedia({ reducedMotion: "reduce" })`): the reveal's items and cards have no running animations (`getAnimations()` is empty).
16. **Responsive**: at 320, 640 and 1024 px the reveal has 2, 3 and 5 columns, and the page has no horizontal scroll.
17. **The opening page** (`navigation-and-landing.md` §3.13):
    - `Open pack` on `/packs` changes the URL to `/packs/open`, the title to `Pack opening · Anime TCG`, and focuses the `h1` `Pack opening`.
    - Back returns to `/packs` with focus on its `h1` and `See your latest pack` shown; Forward shows the same cards with no running animations and sends one `GET /api/packs`.
    - `page.goto("/packs/open")` and a reload on `/packs/open` end on `/packs` with the title `Packs · Anime TCG`, no focus move and no `POST`.
    - Signed out, `/packs/open` goes to `/login`; logging in lands on `/packs`.
    - A 409 (two contexts, as item 9) on `/packs/open`'s `Open pack` ends on `/packs` with `There was no pack left to open.` and the live region reading it once; a lost answer (as item 6) ends on `/packs` with `Try again`, which pushes `/packs/open` again and shows the same cards.
    - An opening whose answer is delayed (`route.fulfill` after a wait) while the player goes to `/collection`: nothing is announced there; Back onto `/packs/open` shows the cards without animation.
    - The header's `Packs` link has `aria-current="true"` on `/packs/open` and `aria-current="page"` on `/packs`.

## 11. Changes to other specs and to code

**Revision of 2026-10-30 (`docs/landing-and-opening-route`)**: the reveal moves from `/packs` to `/packs/open` (§3.7); the senior engineer adds the route to the route module (`navigation-and-landing.md` §3.1 rule 3) and moves `Reveal` from `PacksPage` to the new page. Nothing changes on the server.

**Applied in this PR (`ui-designer`)**: `accounts.md` §3.6, §4.5 and §8 drop the Inventory `Reset` and its confirm (`collection-packs.md` §5.6 asks `ui-designer` to do so in PR 2), and the Account control's "disabled ~350 ms" becomes "until the opening answers".

**For the demo PR** (`navigation-and-landing.md`, `ui-designer`): §3.7 item 1.4's empty slots become 5:7 (the card's aspect, `card-and-rarity.md` §3.2), not 3:4, so the demo's slots match the shared component (§6.5).

**For the manager**:

- `collection-packs.md` §8: the 429 exception for the key (open question 2) and the `Retry-After` reading (open question 3).
- `docs/06-engineering-standards.md` (or an ADR): the owner's frame exception (`card-and-rarity.md` §5.4) and, if accepted, the `free pack` copy exception (open question 1).
- `docs/02-roadmap.md` row 1c-web: this spec.

**Found on `main`, for `senior-engineer`** (not designed here, listed so it is not missed):

- `navigationCopy.ts` `landingCopy` still says "one of five tiers". `navigation-and-landing.md` §8 says six.
- `useGame`'s client roll, `REVEAL_DELAY_MS`, `ownedBeforePack` and the in-memory `cards` go. `isNew` and the counts come from the server.
- The AniList error banner in `SignedInLayout` goes with the pool (`collection-packs.md` §8).
