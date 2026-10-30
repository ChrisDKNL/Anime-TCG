# Navigation, routes and landing page

Cross-cutting (no roadmap number yet; the manager adds the row) · builds on `accounts.md` (shipped in PR #25) and comes before the screens of `collection-packs.md` §8 (1c web), `collection-overview.md` (item 3), `market-and-shop.md` and `economy.md` §12 (item 2) · the demo pack depends on 1c's server pool (`collection-packs.md` §5.1, shipped in #28) · server-authoritative under [ADR 0008](../adr/0008-server-authoritative.md) · written 2026-10-29 from the owner's decisions of the same day · revised 2026-10-30 from two owner requests: a landing page inspired by kyara.games (§3.7, §12) and pack opening at its own address (§3.13); the demo pack opens on its own public page, `/demo` (§3.14, owner, 2026-10-30)

> **Owner decisions this spec implements (2026-10-29, binding).** 1. Every screen has its own short English path. 2. Pages only: no addresses for single cards, and filters and search are not kept in the URL. 3. `/` is a landing page that makes visitors want to play, with a way to try opening packs without an account; the demo grants nothing, stores nothing, says so plainly and leads naturally to Register. 4. (Manager) A signed-out visitor who opens a page that needs an account goes to `/login` and returns to that page after logging in, through a validated return path; a signed-in visitor at `/`, `/login` or `/register` goes to `/packs`.
>
> **The reference.** The owner named kyara.games for the feel on 2026-10-29 and asked again on 2026-10-30: "For the landing page, take inspiration from https://kyara.games/". §12 records what could and could not be seen of it, what this spec takes, how it is adapted to `docs/06-engineering-standards.md`, and what is left out. Nothing of its text, names, fonts, colours or assets is used here. The ideas taken: the landing page leads with opening a pack, the hero shows the pack beside the text, the way in reads as numbered steps, rarity has a section of its own, and opening a pack has a page of its own.
>
> **Owner request, 2026-10-30**: "Opening packs should also have their own route." Manager's reading: `/packs/open`. §3.13 gives the routing rules; `packs-page.md` §3.7 what the page shows.

## 1. Goal

Every screen of the game gets an address a visitor can type, bookmark, reload and move through with the browser's Back and Forward buttons, and the tabs in the header become links to those pages. A first-time visitor who opens the site without an account lands on a page that shows what the game is through the game itself: they open a demo pack drawn by the server at the real odds, see five real cards, read the odds and what the game offers, and find Register one step away. Nothing about the demo is kept, and the page says so. The router is TanStack Router (`@tanstack/react-router`), chosen by the manager in [ADR 0012](../adr/0012-client-router.md); this spec says what it has to do. The server stays the source of every card and every odd, the demo included.

## 2. Out of scope

- **Addresses for single cards, series, listings or filters** (owner decision 2). No `/collection/123`, no `?rarity=epic`, no `#series`. Search, filters, sort, page and view reset on reload, as `collection-overview.md` §2 already says.
- **The Profile page** (roadmap item 4). This spec reserves `/profile` and its placeholder state only.
- **The pages' own contents**: the pack page (`collection-packs.md` §8 and the 1c web PR's UI spec), the collection (`collection-overview.md`), the shop and the market (`market-and-shop.md`). This spec gives each page its path, title, `h1`, guard and place in the navigation; it does not redesign what is inside.
- **The router library.** [ADR 0012](../adr/0012-client-router.md) chooses it (TanStack Router, a code-based route tree, no file-based codegen); this spec lists only what the routing must do (§3.9).
- **The demo endpoint's implementation.** §3.8 states what the UI needs back; the API spec (paths, schemas, limits) is the manager's, under T3 (§3.8).
- **The visual-system rework** (`docs/design/visual-system.md`, not written yet). This spec changes only the header parts it has to touch: the title becomes a plain wordmark link and the explanatory subtitle goes (§6.1).
- **A "leave this page?" prompt** for unsaved forms. Leaving a page discards what was typed in its fields, as closing a dialog does today.
- **Server-side rendering, prerendering or search-engine work.** The app stays a static single-page build behind Caddy.
- **Remembering the last page across reloads or sign-ins.** A sign-in without a return path always lands on `/packs`.
- **Mini-games** (items 5, 6): no routes yet. Their paths are chosen in their own specs, by the rules of §3.1.
- **A permanent address for one opening** (`/packs/<id>`): a page that shows a given pack again after a reload or on another device, like kyara's shareable result page (§12). It needs a new API (a read of one opening by id, checked against the caller's account) and is a possible later option. The opening pages of §3.13 show only an opening held in memory.

## 3. Flow

Terms: **public page**, a page anyone can open (`/`, `/login`, `/register`, the not-found page); **account page**, a page that needs a session (`/packs`, `/collection`, `/shop`, `/market`, `/profile`, `/account`); **guard**, the check that sends a signed-out visitor from an account page to `/login`; **return path**, the account page the guard sent the visitor away from; **push** adds a history entry, **replace** swaps the current one; **page-change focus**, the rule of §3.6; **opening page**, `/packs/open` or `/shop/open`, the page that shows a pack being opened and its cards (§3.13); **current opening**, the opening an opening page shows, held in the signed-in layout (§3.13 step 2).

### 3.1 Routes

| Path           | Signed out                                           | Signed in                                                                                       | `document.title`             | `h1` (receives focus on navigation) | Ships with                                  |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------- | ------------------------------------------- |
| `/`            | Landing page (§3.7)                                  | Replace to `/packs`                                                                             | `Anime TCG`                  | `Anime TCG`                         | this feature                                |
| `/demo`        | The demo page (§3.14)                                | Replace to `/packs`                                                                             | `Demo pack · Anime TCG`      | `Demo pack`                         | the landing revision PR                     |
| `/packs`       | Replace to `/login`, return path `/packs`            | The pack page (`collection-packs.md` §8)                                                        | `Packs · Anime TCG`          | `Packs`                             | this feature                                |
| `/packs/open`  | Replace to `/login`, return path `/packs`            | The current opening and its cards (§3.13, `packs-page.md` §3.7); with none, replace to `/packs` | `Pack opening · Anime TCG`   | `Pack opening`                      | the opening-route PR                        |
| `/collection`  | Replace to `/login`, return path `/collection`       | The collection (`collection-overview.md`)                                                       | `Collection · Anime TCG`     | `Collection`                        | this feature                                |
| `/shop`        | Replace to `/login`, return path `/shop`             | The Karma shop (`market-and-shop.md` §3.3)                                                      | `Shop · Anime TCG`           | `Shop`                              | `feat/economy-ui`                           |
| `/shop/open`   | Replace to `/login`, return path `/shop`             | The bought pack's cards (§3.13, `market-and-shop.md` §3.3); with none, replace to `/shop`       | `Shop pack · Anime TCG`      | `Shop pack`                         | `feat/economy-ui` (owner, 2026-10-30, §9.2) |
| `/market`      | Replace to `/login`, return path `/market`           | The market (`market-and-shop.md` §3.4–3.6)                                                      | `Market · Anime TCG`         | `Market`                            | `feat/market-ui`                            |
| `/profile`     | Replace to `/login`, return path `/profile`          | Placeholder (§4.6) until item 4                                                                 | `Profile · Anime TCG`        | `Profile`                           | this feature (placeholder)                  |
| `/login`       | Log in (`accounts.md` §3.4, as amended in §3.5)      | Replace to `/packs`                                                                             | `Log in · Anime TCG`         | `Log in`                            | this feature                                |
| `/register`    | Register (`accounts.md` §3.3, as amended in §3.5)    | Replace to `/packs`                                                                             | `Register · Anime TCG`       | `Register`                          | this feature                                |
| `/account`     | Replace to `/login`, return path `/account`          | Manage account, as a page (§3.4)                                                                | `Manage account · Anime TCG` | `Manage account`                    | this feature                                |
| anything else  | Not-found page (§4.7)                                | Not-found page (§4.7)                                                                           | `Page not found · Anime TCG` | `Page not found`                    | this feature                                |
| (any, booting) | Header wordmark only; `Loading…` after 300 ms (§4.1) | same                                                                                            | `Anime TCG`                  | none                                | this feature                                |

Rules that hold for every row:

1. **A route exists from the PR that builds its page.** Until `feat/economy-ui` merges, `/shop` is the not-found page, and so is `/market` until `feat/market-ui`; neither has a header link before then, and there is no "coming soon" page. `/profile` is the one reserved exception (owner decision 1), with the placeholder of §4.6.
2. **Paths are exact and lower case.** `/packs/` (one trailing slash) is replaced by `/packs`; `/Packs`, `/packs/1` and `/index.html` are the not-found page. A query string or hash on any path is ignored: the app never reads one and never writes one, and it is dropped from the address the next time the app navigates.
3. **The route list is one typed module.** The header links, the guard, the return-path check (§3.3), the titles and the `h1` text all come from it, so a path cannot be added to one and missed in another.
4. **Signed-in titles do not carry the login.** The page name comes first so a row of browser tabs can be told apart; the header already shows whose account is open. This replaces `accounts.md` §8's `<login> · Anime TCG` (§10).
5. **Opening pages are not in the header and are never a return path.** Their rows exist so that a typed, bookmarked or reloaded address has a defined answer (§3.13 step 3); their guard writes the section page (`/packs`, `/shop`) as the return path.

### 3.2 Boot and the session check

1. Every load, whatever the path, starts with `GET /api/session` (`accounts.md` §3.1). Until it answers, the header shows the wordmark only (no links, no Account control) and the main area shows nothing, then `Loading…` once 300 ms have passed (§4.1). No page renders before the answer, the landing page included: a signed-in player at `/` must not see the landing flash before the replace to `/packs`.
2. The answer is held for the page's lifetime (the query layer already caches it). Navigating between pages does not ask again; only a reload, a sign-in, a log-out, a deletion or an `unauthenticated` answer changes it.
3. Then the route table decides: render, or replace to another path. A replace on boot is part of the load: focus is not moved (§3.6) and nothing is announced.
4. **Server unreachable at boot**: the app is treated as signed out (`accounts.md` §3.1). A public page renders with the unreachable banner. An account page replaces to `/login` with its return path, and the banner shows there; the forms stay usable. When `Try again` in the banner gets an answer that names a session, the app replaces `/login` with the return path (or `/packs`).

### 3.3 The guard and the return path

1. A signed-out visitor who opens an account page (typed, bookmarked, reloaded, or reached by Back) is sent to `/login` with a **replace**, so Back does not bounce them into the guard again.
2. The return path travels in the history entry's state (`history.state`), not in the URL. The address bar reads `/login` and nothing else. This keeps the URL to pages only (owner decision 2), and a link from another site cannot carry a return path at all, because history state can only be written by this origin's own scripts.
3. The return path is checked twice, when it is written and when it is used: it must be **exactly equal** to the path of an account page in the route list of this build (`/packs`, `/collection`, `/profile`, `/account`, plus `/shop` and `/market` once they exist). Anything else (a full URL, `//host`, `/\host`, `/packs?x`, `/PACKS`, a path with a trailing slash, an encoded character, a value that is not a string, a value longer than the longest listed path) is discarded and the destination is `/packs`. The opening pages are not on this list (§3.1 rule 5). The UI never passes the stored value to `location`, `window.open` or an `href`; it looks the path up in the route list and navigates to the list's own entry. There is no open redirect because nothing outside the list can be reached.
4. `/login` shows a line under its `h1` naming where the visitor is going (§8 "Guard lines"), only when a valid return path is held and the session-ended banner is not showing.
5. The `Register` link on `/login` carries the return path into `/register`'s history state, and the `Log in` link on `/register` carries it back, so a visitor who switches forms still returns to the page they asked for.
6. On a successful log in or register, the app **replaces** `/login` (or `/register`) with the return path, or `/packs` without one. Back from there goes to the entry before `/login`, never to a form the visitor already completed.
7. A signed-in visitor at `/`, `/demo`, `/login` or `/register` is replaced to `/packs`. The return path is not consulted here; it only applies to a sign-in.

### 3.4 Manage account becomes a page

`/account` is a page, not a dialog opened from a route. Reasons:

- **Every screen has an address** (owner decision 1), and a page is what an address means everywhere else in the app. A dialog "opened by a route" makes Back close a dialog on one screen and leave the page on every other; two meanings for one button is the confusion a route exists to remove.
- **It is page-sized.** Three sections, each a form with its own errors and server waits, already scroll inside an 85 vh dialog on a phone. A page scrolls with the document and needs no focus trap.
- **No history entries for dialogs.** The card dialog (`collection-overview.md` §3.4) and the shop's confirmation stay dialogs because they are steps inside a page; making one dialog a route would make the rule "dialogs are never addresses" untrue.

What changes from `accounts.md` §3.5.3 and §4.6:

1. The Account menu item reads `Manage account` (no ellipsis: it goes to a page, it does not open a dialog) and is a link to `/account`. When `/account` is the current page, that item carries `aria-current="page"`.
2. The page shows, top to bottom: the `h1` `Manage account`; the avatar (`size-10`), the login and the meta line (`<N cards> · Created <D Mon YYYY>`); then the **Login**, **Password** and **Delete account** sections with their `h2`s (they were `h3`s in the dialog). Every field, rule, error, wait and success line is unchanged.
3. `Delete account…` keeps its ellipsis: it opens the delete confirmation as a native modal `<dialog>` (the Manage dialog's shell, `max-w-lg`), with the same heading, body, `Password` field, `Delete <login>` and `Cancel`. `Cancel` and Escape close it and return focus to `Delete account…` (`accounts.md` §11).
4. There is no Close button: the page is left like any other page.
5. Deleting succeeds: the session is gone, the app **replaces** `/account` with `/`, the landing page's `h1` takes focus, and the live region reads `Deleted <login>.`

### 3.5 Header navigation, Log in and Register

1. **Signed out**: the wordmark on the left (a link to `/`); on the right, `Log in` (a link to `/login`) and `Register` (a link to `/register`). These replace the signed-out `Account` button of `accounts.md` §4.5. The current one of the two carries `aria-current="page"`.
2. **Signed in**: the wordmark (a link to `/packs`), the page links, and the Account control, which stays exactly as `accounts.md` §3.5 has it apart from the `Manage account` item (§3.4) and, from item 4, a `Profile` item at the top of the menu (§9, decision 2). Page links, in order: `Packs` · `Collection (<N>)` now; `Packs` · `Shop` · `Market` · `Collection (<N>)` once item 2's PRs have merged (the order `market-and-shop.md` §3.2 decided, with `Booster` renamed `Packs` to match its path). `<N>` is the card count the Collection tab shows today.
3. The links are real links (`<a href="/collection">`) that the router intercepts, so middle-click, Ctrl-click and "open in new tab" work. The link of the current page has `aria-current="page"`. Activating the current page's own link does nothing: no new history entry, no scroll, no focus move.
4. Links stay usable while a pack opens. An opening finishes even if the player leaves `/packs/open`: the result lands in the signed-in layout's state (§3.10), `Collection (<N>)` updates, and the cards are there when the player comes back to `/packs/open` (Forward, or `See your latest pack` on `/packs`, `packs-page.md` §3.1 step 3). The Account control is still disabled during an opening (`accounts.md` §4.5).
5. **Log in page**: the `accounts.md` form without its `Back` button (Back is the browser's, and the header links go everywhere a `Back` went). Under the form, before the forgotten-password line: `No account yet?` and a `Register` link. A visitor who arrived through the guard sees the guard line under the `h1` (§3.3 step 4).
6. **Register page**: step 1 without its `Back` button; under the form, `Already registered?` and a `Log in` link. Step 2 keeps its `Back` to step 1; the two steps are one page and one history entry, so the browser's Back from step 2 leaves `/register`. The step indicator tells the visitor where they are; an extra history entry for a form step would make Back discard a typed password silently.
7. **Log out** (any page): as `accounts.md` §3.5.2, then the app **replaces** the current page with `/`, the landing `h1` takes focus, and the live region reads `Logged out.` A replace, so Back does not land on an account page that would only bounce to `/login`.
8. **Session ended** (any `unauthenticated` answer on an account page): `accounts.md` §4.8, then a **replace** to `/login` with the current page as the return path; the session-ended banner shows; the `Log in` `h1` takes focus. After logging in, the player is back on the page they were on, with that page's state as §3.10 describes (it was cleared with the account state).

### 3.6 Focus, announcement and title on navigation

1. **Every navigation after the first render** (a link, Back, Forward, a redirect after an action) sets `document.title` from the route list, then moves focus to the new page's `h1` (`tabindex="-1"`). Screen readers read the heading on focus, which is the route-change announcement; the live region is **not** also used for it, so nothing is read twice.
2. **The first render** (load or reload) sets the title and moves no focus: the browser starts at the top of the document as on any page load. A replace during boot (§3.2 step 3) counts as the first render.
3. **Actions that navigate** keep their own live-region message and then follow rule 1: log in and register (`Logged in. You're now on <login>.`, `Registered <login>. You're now on <login>.`), log out (`Logged out.`), delete (`Deleted <login>.`). Focus goes to the destination's `h1`, not to the pack button; this replaces `accounts.md` §3.3.4, §3.4.4 and §7's focus on the pack button (§10). The pack button is the first control after the `Packs` heading, one Tab away. Opening a pack from `/packs` pushes `/packs/open` and follows rule 1 too: focus goes to the `Pack opening` `h1`, and the live region reads the reveal once when the cards land (`packs-page.md` §3.7, §7).
4. **Session ended**: focus to the `Log in` `h1`; the banner is `role="status"` and is read when focus lands just after it in reading order (`accounts.md` §7).
5. **A page whose content is still loading** (the collection's skeleton, the shop's) still has its `h1` rendered from the start, so focus always has somewhere to go.
6. **Skip link**: the first focusable element of every page is `Skip to content`, visually hidden until focused. It moves focus to the page's `h1` without changing the URL (no hash).

### 3.7 The landing page (`/`, signed out)

**Revised 2026-10-30** from the owner's "For the landing page, take inspiration from https://kyara.games/" (§12). Every rule of the version shipped in #30 and #42 stands: signed out only; the server's demo pack, up to 10 per page load, with the double-click guards; a demo card with no glow, glint or drift; the server's facts and the odds table; the copy rules of §8. What changes is the order and the weight: the hero shows the pack beside its text (item 1.8), the demo opens on its own public page, `/demo` (§3.14; owner, 2026-10-30, after kyara's flow, §12), How it plays becomes numbered steps (item 2), and the odds become a section of their own (item 3). Where kyara's style conflicts with `docs/06-engineering-standards.md` or this spec, the rule wins; §12 says how each part was adapted.

**Delivery.** The first version came in two PRs (owner, decision 1): #30 without the demo, #42 with it. This revision is one web PR (the manager names it). It needs nothing new from the server: the same `GET /api/demo` and `POST /api/demo/open` (§3.8).

Top to bottom, in one left-aligned column that splits into two in the hero from 640 px (§5.3). One primary action in the hero; no centred hero, no second button beside the first, no icon grid, no panel or tinted background around the hero.

1. **Hero and demo** (`<section aria-labelledby="landing-heading">`): on `/`, the text column (items 1.1 to 1.3) and the pack beside it (item 1.8). Items 1.4 to 1.7 are the demo's rules; they now apply on `/demo` (§3.14), where the cards are shown, and items 1.3 and 1.7 also on `/`. The items keep the numbers other specs cite; the pack is listed last for that reason, not because it comes last.
   1. `h1` `Anime TCG`, at the page's display size (§6.2).
   2. The lede, one sentence built from the server's pool facts: `<characters> characters from the <entries> most popular anime on AniList, five to a pack.` Before the facts arrive, or with no pool: `Characters from the most popular anime on AniList, five to a pack.` The numbers are never in the bundle.
   3. The demo control: one primary button, `Open a demo pack`, and directly under it the plain disclosure (§8): the demo uses the same odds as every pack, and its cards are not kept. It is written once, under the button, before the first press, so nobody has to open a pack to learn it. The button has the pack button's guards (`packs-page.md` §3.3 step 2): it ignores the second click of a double click (`detail` above 1) and the auto-repeats of a held Enter, on top of the in-flight single flight, so a double click spends one demo pack of the visit (manager decision, 2026-10-30). Activating it sends `POST /api/demo/open` and pushes `/demo` in the same task (§3.14 step 1), as `Open pack` pushes `/packs/open`.
   4. The reveal area, on `/demo`: five empty slots (5:7, the card's own aspect, `card-and-rarity.md` §3.2; static, `aria-hidden`) where the cards will land, the shared reveal component's empty slots (`packs-page.md` §6.5), so nothing moves when the cards land. A demo opening fills them with the server's five cards in slot order, using the 1c reveal card (tier border, no glow, no `NEW` marker, no count), over the pull summary `Demo pack: <summary>`, where `<summary>` is the 1c reveal's own summary phrase.
      Decided ("Owner, 2026-10-29, after #32"): this item and §6.2 stand. The demo card plays none of `card-and-rarity.md`'s effects (glow, glint, pearl drift), and that spec's §9 Option A no longer includes the demo pack.
   5. After the first reveal, one line under the grid: `To keep cards, register with an invite code.` with the word `register` as a link. It appears once and does not change, grow or repeat with further demo packs.
   6. The button keeps the label `Open a demo pack` for every pack. There is no counter, no "another", no "one more", and no comment on what was pulled. A new demo pack replaces the previous five cards; earlier ones are not listed anywhere.
   7. **Up to 10 demo packs per page load** (owner, decision 3). The number comes from the server (`perVisit` in `GET /api/demo`, 10), not from a constant in `web/`. When the tenth pack's cards arrive, the button and the disclosure are replaced, in the same place on `/demo` and on `/`, by the Join sentence (`Playing needs an account, and registering needs an invite code from the owner.`), the `Register` link-button and the `Already registered?` `Log in` sentence; the keep-cards line under the grid goes, since the same offer now sits above it. The tenth reveal stays on screen. Nothing counts down or up on the way: no remaining number, no "last one", no "used up", no "tries", and the first nine packs look exactly like the first. A reload resets the page's count to zero; that is accepted, because the count only paces one visit and the server's per-address rate limit (§3.8 item 5) is the real bound. **A page load is the document's lifetime** (manager decision, 2026-10-30): the count and any running 429 wait are held in app-level memory that outlives the landing page, never in storage, so moving between `/`, `/demo` and the other public pages with links, Back or Forward keeps both, and keeps the current demo cards too ("Demo cards are not kept" below). Returning to `/` or `/demo` after the last pack shows the Join offer in the button's place without moving focus to it; the page's `h1` takes focus as on any page change. **The cap holds without the facts** (manager decision, 2026-10-30): while `GET /api/demo` is loading or has failed, the web app caps the visit at a fallback of 10, the owner's number, and the answer's `perVisit` wins once it arrives.
   8. **The pack** (new; kyara's hero shows the pack beside its text, §12). A static drawing of the demo pack at the card's reveal size and 5:7 aspect, in the hero's right column from 640 px. It reads `Anime TCG` and `Demo pack` at the top, the six tiers' stars as a ladder from one star to six in their tier colours, and `Five cards` at the bottom (§6.2, §8). It is `aria-hidden` and not a control: the button names the action and the `Pack odds` section carries the tiers. It never moves, glows, tilts, lifts or changes: not on hover, not while a demo pack opens, not after the tenth. Below 640 px it is not rendered, so the button stays above the fold on a phone.
2. **How it plays** (`<section aria-labelledby>`, `h2` `How it plays`): numbered steps (kyara's numbered "how it works" band, §12, laid out as one column). An ordered list; each step is a two-digit number (`01`, `02`, …), a term (`h3`) and one sentence, filled with the server's numbers where there are any; no icons, no cards, no boxes, no three-across row. The steps are the rows below, in this order, numbered in the order they exist in the build:
   - `Packs`: `A new pack every <interval>, and up to <cap> can pile up. Five cards each.`
   - `Rarity`: `Every character has one of six tiers, set by how many AniList users favourited them. Every pack uses the odds below.`
   - `Collection`: `See how much of each series you have, and how much of all <characters> characters.`
   - From `feat/economy-ui`: `Karma` — `Recycle duplicates for Karma and spend it on themed packs. Karma comes only from playing. It can't be bought.`
   - From `feat/market-ui`: `Market` — `List cards for other players to buy with Karma, and buy theirs.`
   - Mini-games get a row in their own PRs, never before they ship. A row describes only what a player can do today.
   - Without pool facts the rows that need a number drop the number (§8).
3. **Pack odds** (`<section aria-labelledby>`, `h2` `Pack odds`; it was an `h3` inside How it plays): a table with the six tiers, lowest first: `Tier`, `At least one per pack`, `Each card`. Figures are the server's `odds.perPack` and `odds.share` (a standard pack's chance of at least one, and its share of cards per tier) over `odds.scale`, in the percentage format of `market-and-shop.md` §3.3 (three significant digits, never rounded up, so `0.05%` keeps its digits and 99.9704 % reads `99.9%`). The `Tier` cell shows, before the tier word, a small static swatch of the tier's frame colour and, from 640 px, the tier's stars (§6.2); both are `aria-hidden`, the word carries the tier. Under the table the source line `Drawn from <characters> characters, as of <D Mon YYYY>.` With no pool, the whole `Pack odds` section is absent rather than empty, and the `Rarity` step's sentence drops its pointer to it (§8). This is the landing page's only rarity tease: the tiers as the game deals them, at the server's odds (§12: kyara's feed of other players' rare pulls is not taken).
4. **Join** (`h2` `Join`): `Playing needs an account, and registering needs an invite code from the owner.` Then one primary link styled as a button, `Register`, and on the same line the text `Already registered?` with a `Log in` link. One action is primary; the other is a sentence.
5. The attribution footer, as on every page.

What the landing page never shows: account data of any kind, a player count, recent pulls by other players, a timer, a "limited" or "today only" message, a currency balance, an exclamation mark, reviews or a rating, a leaderboard, a feed of what anyone pulled, a pack price, a streak, daily missions or rewards to claim, a referral offer, sound, a full-screen mode.

**Demo cards are not kept.** The current demo pack's cards are held in app-level memory for the page load, beside the count and the wait (§3.14 step 6), so Back and Forward onto `/demo` show them again. A reload, a sign-in or a registration discards them, and nothing about them reaches storage, the server or a later account. (Revised 2026-10-30: the earlier rule dropped them on leaving `/`, the one page they were on.) A visitor who registers starts with the empty collection every new account starts with (`collection-packs.md` §5.5), and the page's disclosure line has already said so.

### 3.8 What the demo needs from the server

The demo is a read of the server's pool and a roll by the server's RNG with nothing written. The browser holds no pool, no odds and no roll (`collection-packs.md` §8 deletes them in 1c; the demo must not bring them back).

1. **Pool facts, public**: `GET /api/demo` (name for the API spec to confirm), no session needed, answering:
   - `odds`: 1c's `PublishedOdds` (`shared/src/api.ts`), the same object `GET /api/packs` returns, or `null` with no snapshot. The landing page reads `scale`, `share`, `perPack` and `snapshot` (`characterCount` for the rank chip's pool size, `takenAt` for the source line); the rest (`slots`, `enchanted`, `radiant`, `pity`, `bandScale`, `tierBands`, `tierSizes`) comes with the object and is not shown;
   - `pool`: `{ characters, entries }` from the current snapshot (`entries` is 100 in the owner's snapshot), or `null` with no snapshot;
   - `allowance`: `{ intervalSeconds, cap }`, the timer-pack parameters, so How it plays states them without a constant in `web/`;
   - `perVisit`: the demo packs one page load may open (10, owner decision 3).
2. **A demo opening, public**: `POST /api/demo/open` (name to confirm), no body, behind the 1a CSRF origin check, answering 200 with `{ cards, franchises }`: five cards in slot order, each `{ slot, character, rarity }` with 1c's `CharacterPublic` (name, native name, image, `franchiseIds`, `rank`), and the `FranchiseRef`s they name. No `isNew` (there is no collection to compare with), no `openingId`, no `requestId`, no allowance.
3. **Same roll, same odds.** The opening uses 1c's plan, slot roll and character pick (`collection-packs.md` §5.4: `SLOT_ODDS` with its slot floors, `RADIANT_ODDS` and `RADIANT_SLOT_ODDS`, the current snapshot's tiers, `crypto.randomInt`) with the writes left out. With no account there are no counters, so a demo pack is never Enchanted or pity-due (both count an account's free packs, §5.4.5); it can be Radiant, as every pack can (§5.4.7). The reveal adds no line for it (§3.7: no comment on what a demo pack contained). A demo pack is never boosted, seeded or tuned: odds better than a real pack's would be a bait, which ADR 0004 §6 rules out. A test draws demo packs and real packs from one fixture snapshot and checks both against `SLOT_ODDS` and `RADIANT_ODDS`. Because Radiant packs can happen, the demo's actual Mythic rate per card is slightly above the standard pack's published share: about 0.058 % against 0.05 % (one pack in 2 500 is Radiant, with 1.05 Mythics on average). That is true of every free pack too, before its Enchanted and pity rules, so "the same odds as every pack in the game" holds (manager decision, 2026-10-30).
4. **Stores nothing.** No account, session, cookie, opening, card or ledger row is created or touched; the response sets no cookie, and a visitor with no session still has none afterwards. The only state is the rate limiter's in-memory bucket for the client address, as for every route, and the ordinary request log line (method, path, status, duration, request id), with no card data in it.
5. **Rate-limited**: a per-client-address limit of its own (`DEMO_RATE_LIMIT`), answered with 429 `rate_limited` and `Retry-After`. It is the real bound on demo packs: the page's count of 10 (§3.7 item 1.7) lives in the browser and a reload resets it, so it paces a visit and limits nothing. The limit is sized so a normal visitor's 10 packs are never refused: **at least twice `perVisit` per minute (20 a minute to start)**, so one visit opened as fast as the button allows, plus a reload, stays under it. It is a public endpoint that reads the database; the limit bounds the cost of a script. The limit is a fixed window per address (`@fastify/rate-limit`), so a burst of up to 2 × 20 openings across a window edge is accepted; that is within what the limit is for (manager decision, 2026-10-30). **Size**: an opening is five cards and the franchises they name, so its size is bounded by the snapshot limits (`collection-packs.md` §4.2: `NAME_MAX`, `TITLE_MAX`, `IMAGE_URL_MAX`, `SNAPSHOT_CHARACTERS_PER_FRANCHISE`), about 278 KB in the worst case and a few kilobytes in practice (manager decision, 2026-10-30).
6. **Errors the UI maps**: 503 `pool_unavailable` → the demo-unavailable state; 429 → the demo wait state, counting down from `Retry-After` (or a plain line without one); 403 `bad_origin` and 400 → the generic demo failure (a client bug); no answer → the demo failure line with `Try again`.
7. **Tier**: T3 (a public endpoint on the RNG and pack-roll code) by `docs/05-security.md`; `security-officer` reviews it and adds it to the threat model (§10).
8. **Before 1c's server pool exists** (it shipped in #28) there is nothing to draw from and no endpoint to call. The navigation PR therefore ships the landing page without the demo, and the demo PR with these endpoints follows 1c's server PR (owner, decision 1; §3.7).

### 3.9 What the router must do

[ADR 0012](../adr/0012-client-router.md) chooses TanStack Router (`@tanstack/react-router`) with a **code-based route tree** (routes declared in TypeScript, no file-based routing and no generated route files). The requirements below are what the routing must do with it; the PR shows each one under test.

1. **Nested layouts**: a root layout (frame, banners, live region, skip link, footer) around a public layout (signed-out header) and a signed-in layout (header with page links and the Account control, the account's game state, §3.10). Moving between two pages of one layout does not remount the layout.
2. **A guard** on the signed-in layout that waits for the session check (§3.2) and replaces to `/login` with the return path in history state (§3.3); a matching rule that replaces signed-in visitors away from `/`, `/login` and `/register`.
3. **History state** read and written per entry, for the return path; **replace** as well as push.
4. **Title per route** from the one route module (§3.1 rule 3), set on every navigation.
5. **Focus on route change** to the page's `h1`, not on the first render (§3.6), and a way to know which of the two a render is.
6. **Scroll control** as §3.11 describes: top on a new navigation, restored on Back and Forward.
7. **A catch-all** route for the not-found page, and the trailing-slash replace of §3.1 rule 2.
8. **Real links** with an active state for `aria-current="page"`, client-side navigation on a plain click, and the browser's behaviour on modified clicks.
9. **No search-parameter state.** The app does not use the router's query or hash state for anything.
10. **Code splitting is optional.** If pages are split, a chunk that fails to load (a deploy replaced it) shows the page-load failure of §4.8 instead of a blank page.
11. Works with React 19 and the TanStack Query layer already in `web/`, in strict TypeScript with typed paths; a new dependency is reviewed under C13.

### 3.10 State that survives navigation

1. Everything account-scoped lives in the signed-in layout and survives moving between its pages: today's in-memory collection (until 1c moves it to the server) and the current opening that `/packs/open` shows (§3.13); from 1c, the collection answer and its stale flag; from item 3, the collection's search, filters, sort, page and view (`collection-overview.md` §2 already keeps them across tab switches); from item 2, the Karma balance, the bought pack that `/shop/open` shows and the market's filters.
2. Returning to `/packs/open` (or `/shop/open`) shows the held cards without re-running the reveal animation; the animation runs only for an opening that lands while its page is showing.
3. A reload discards all of it (owner decision 2), and so does log out or session end: the signed-in layout unmounts with the account.
4. Dialogs are not history entries. Back with the card dialog or a confirmation open leaves the page; the dialog closes with it, its in-flight request finishes and its result applies to the layout's state, and its live-region message is still announced. The market link inside the card dialog (`See <name> on the market`) sets the market's character filter in the layout's state and pushes `/market`; Back returns to `/collection` with the dialog closed.
5. Outside the signed-in layout, app-level memory holds the demo's count, its 429 wait and its current cards for the page load (§3.7 item 1.7, §3.14 step 6); a reload or a sign-in discards them.

### 3.11 Back, Forward and scroll

1. A link click pushes; a redirect, a sign-in, a log-out, a deletion and a session end replace (§3.3, §3.5). The browser's Back and Forward move through pushed pages only.
2. **New navigation** (a link): the page starts at the top, instantly (no smooth scroll).
3. **Back and Forward**: the scroll position of that history entry is restored once the page's content has rendered from data the layout holds. If the data is not held (since 1c the layout fetches the collection at sign-in, so this is only while that first answer is still on its way, or after it failed), the page starts at the top.
4. A signed-in player pressing Back onto an entry of `/` or `/login` is replaced forward to `/packs` (§3.3 step 7); one more Back leaves the site, or reaches whatever came before. This is accepted: the alternative, a landing page signed-in players can see, is rejected for the reasons in §9.

### 3.12 Hosting: what Caddy must do

The repo `Caddyfile` already serves the build as a single-page app (`try_files {path} /index.html` in its last `handle`). The engineer keeps that and makes the following true, with a test for each in `web/e2e/stack.spec.ts`:

1. **SPA fallback**: every path that is not under `/api`, not `/healthz` and not an existing file is answered with `index.html`, status 200, with the site's existing headers (the CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, no `Server`, no `Via`) and `Cache-Control: no-cache`. Tested on `/demo`, `/packs`, `/packs/open`, `/collection`, `/account`, `/login` and an unknown `/no-such-page`. An unknown path is 200 too, and the app shows the not-found page (owner, decision 4); the `Caddyfile` holds no copy of the route list.
2. **`/api` untouched**: the api handle matches `/api` itself as well as `/api/*` (today `/api` alone falls through to the SPA shell). Every path under it goes to the api, and an unknown one answers the api's JSON 404 envelope (`not_found`), never `index.html`. The existing test for an unknown api route stays and gains a case for `/api`.
3. **`/healthz` untouched**: Caddy's own `ok`; the api's own probe stays unreachable through the proxy (existing tests).
4. **`/assets/*` never falls back**: a missing asset is a plain 404, not `index.html` served as JavaScript, so a stale chunk fails loudly (§3.9 item 10). Cache headers for assets unchanged.
5. **Absolute asset URLs**: Vite's `base` stays `/`, so `index.html` loaded at any path references `/assets/...`. A relative base would break every page reached by its own address.
6. **The CSP does not change for this feature.** The demo endpoints are same-origin (`connect-src 'self'`); card images keep coming from `img-src https://s4.anilist.co`; the landing page loads no font, script or image from anywhere else.
7. `web/index.html`'s `<title>` is `Anime TCG` (it read `Anime TCG — Booster Packs` before #30), so the title before the script runs matches the boot title.
8. The development server (Vite) and `vite preview` already fall back to `index.html`; the e2e suite runs the guard and deep-link tests against them as well as the stack.
9. The owner's host proxy or tunnel forwards every path unchanged (`docs/04-deployment.md`); nothing there changes.

### 3.13 Opening pages (`/packs/open`, `/shop/open`)

Owner, 2026-10-30: "Opening packs should also have their own route." `/packs` keeps the allowance, the countdown, the pity line, the odds and `Open pack`; opening a pack moves to `/packs/open`, which shows the opening and the cards. This section gives the routing rules the two opening pages share. What `/packs/open` shows is `packs-page.md` §3.7; what `/shop/open` shows is `market-and-shop.md` §3.3 step 6 (owner, 2026-10-30, §9.2 question 1).

1. **Reached only from inside the app.** `/packs/open` is pushed when `Open pack` on `/packs` (or `Try again` with a held key) starts an opening, in the same task as the request (`packs-page.md` §3.3 step 2). `/shop/open` is pushed when a shop purchase answers with its pack (201 or 200). There is no header link to either. The only links to them are `See your latest pack` on `/packs` and `See your latest shop pack` on `/shop`, shown while a reveal is held.
2. **What they show: the current opening**, held in the signed-in layout (§3.10): an opening in flight, or the cards of the last one. A new opening replaces it. Log out, session end and reload clear it. Every `/packs/open` entry in the history shows the current opening; an older entry does not keep an older pack.
3. **Nothing to show, so replace.** With no opening in flight and no cards held (a load, a reload, a typed or bookmarked address, or Back or Forward onto the entry after its opening ended with an answer that had no cards), the app **replaces** `/packs/open` with `/packs` and `/shop/open` with `/shop`. On a load or reload this is a boot replace (§3.2 step 3): no focus move, nothing announced. After the first render it is a navigation (§3.6 rule 1): the title and the focus of `/packs` or `/shop`.
4. **Back** returns to the entry before, which is `/packs` (or `/shop`) when the player came from there; that page restores its scroll (§3.11) and its `h1` takes focus. Leaving does not cancel anything: the request finishes and its result is held (§3.5 step 4).
5. **Forward** onto an opening page with cards held shows them without the entrance (§3.10 item 2).
6. **Header**: the section's link (`Packs`, `Shop`) keeps the current fill and carries `aria-current="true"` (the current section, not the current page); activating it pushes `/packs` (`/shop`), since the opening page is not that page.
7. **Signed out**: the guard replaces to `/login` with the section page (`/packs`, `/shop`) as the return path. After logging in the player lands there, never on an opening page, because nothing is held after a sign-in.
8. **Session ended** on an opening page: as §3.5 step 8, with the section page as the return path.
9. **Scroll**: an opening page starts at the top.
10. **The demo is not an opening page.** It opens on `/demo` (§3.14), a public page that shows its button even with nothing held, so it has no replace rule.
11. **Later option, out of scope**: an address per opening, `/packs/<id>` (§2).

### 3.14 The demo page (`/demo`, signed out)

Owner, 2026-10-30 (§9.2 question 2, option B): the landing demo opens on a public `/demo` page, kyara's flow (§12). The demo's rules are §3.7 items 1.3 to 1.7 and §3.8, unchanged; this section says where they apply and how the page is reached and left.

1. **From `/`**: `Open a demo pack` passes its guards (§3.7 item 1.3), sends `POST /api/demo/open` and pushes `/demo` in the same task, so the opening shows there from its first frame. Title `Demo pack · Anime TCG`; focus on the `h1` `Demo pack` (§3.6 rule 1). The second click of a double click, or a held Enter's repeats, may reach `/demo`'s own button: it ignores them (`detail` above 1, `repeat`, the single flight), so one activation opens one demo pack.
2. **Top to bottom**: the `h1` `Demo pack`; the action row: `Open a demo pack` and the link `Back to the landing page`; the disclosure under them; then the reveal: `Demo pack: <summary>` over the grid (§3.7 item 1.4), and the keep-cards line under it (item 1.5).
3. **In flight**: `Open a demo pack` reads `Opening…`, `aria-disabled`; arriving from `/`, the grid shows the five empty slots; for a pack opened from `/demo`'s own button, the previous five cards stay until the answer.
4. **Cards**: the reveal with its entrance when `/demo` is showing; focus stays where it is; the live region reads `Demo pack: <summary>.` once. `Open a demo pack` stays in place for the next one, with the same label (§3.7 item 1.6). There is no count line: §3.7 item 1.7 keeps the count out of sight ("Nothing counts down or up on the way"), see §9.2.
5. **Every other answer** shows on `/demo`, which, unlike `/packs/open`, holds every state of its control: 503 the unavailable line in the button's place, 429 the wait, no answer, 400 or 403 the failure line (§4.9). Nothing navigates back to `/`.
6. **Held for the page load**: the count, a running 429 wait and the current cards live in app-level memory (§3.10 item 5), never in storage. Back or Forward onto `/demo` shows the held cards without their entrance. An answer that lands while `/demo` is not showing is counted and its cards are held, and nothing is announced.
7. **After the tenth pack**: in place of the button and the disclosure, the Join sentence, `Register` and the `Log in` sentence (§3.7 item 1.7); focus moves to the Join sentence; the keep-cards line goes; `Back to the landing page` stays.
8. **Back** (the browser's) returns to the entry before: `/` when the visitor came from the landing page, where the title and the `h1` focus are `/`'s (§3.6) and the scroll is restored (§3.11); otherwise wherever they came from, another site included. **`Back to the landing page`** is a link to `/` and pushes, as every link does.
9. **A direct load or reload of `/demo`** (a typed, bookmarked or shared address) with nothing in flight or held **shows the page with its button ready**: five empty slots, the disclosure, `Open a demo pack` enabled (or the unavailable line with no pool, or the wait if one is held). It sends `GET /api/demo` for the facts, as `/` does, and the count's fallback of 10 holds until the answer (§3.7 item 1.7). This is chosen over a replace to `/`:
   - `/demo` is a public page whose content is its button. It needs nothing held to make sense, unlike `/packs/open`, whose control and timer live on `/packs`.
   - A reload after a reveal keeps the visitor where they were, one press from the next pack; a replace would move them and cost a second press on `/`.
   - A link to `/demo` from elsewhere does what it says.
   - Nothing on the page is held account state, so showing it to anyone exposes nothing; the server's rate limit (§3.8 item 5) bounds the page however it is reached.
10. **Signed in**: replaced to `/packs` (§3.3 step 7), on a load as on a navigation.
11. **Header**: the signed-out header; no link is marked, since neither `Log in` nor `Register` is the page.
12. **Leaving `/demo` during a flight**: the request finishes; its answer is handled as step 6.

## 4. States

### 4.1 Boot and routing

| State                                          | User sees                                                                                                             | User can do                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| checking session, under 300 ms                 | Header with the wordmark only; main area empty; title `Anime TCG`                                                     | Wait                            |
| checking session, over 300 ms                  | Same, plus `Loading…` in the main area (`text-sm text-zinc-500`, `role="status"`)                                     | Wait                            |
| signed out, public page                        | The page                                                                                                              | Use it                          |
| signed out, account page                       | Replaced by `/login` with the guard line                                                                              | Log in, register                |
| signed in, `/`, `/demo`, `/login`, `/register` | Replaced by `/packs`                                                                                                  | Play                            |
| signed in, opening page, nothing held          | Replaced by `/packs` (or `/shop` from `/shop/open`), §3.13 step 3                                                     | Play                            |
| unreachable, public page                       | The page with the unreachable banner (`accounts.md` §4.1)                                                             | Try again, use the page         |
| unreachable, account page                      | `/login` with the unreachable banner and the guard line; `Try again` that finds a session replaces to the return path | Try again, log in               |
| trailing slash                                 | Replaced by the path without it, then as above                                                                        | —                               |
| unknown path                                   | The not-found page (§4.7)                                                                                             | Go to the start, use the header |

### 4.2 Header navigation

| State                     | User sees                                                                                                                            | User can do                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| booting                   | Wordmark only                                                                                                                        | —                             |
| signed out                | Wordmark (link to `/`); `Log in`, `Register`; the current one marked                                                                 | Go to either, or to `/`       |
| signed in                 | Wordmark (link to `/packs`); page links with the current one marked; Account control                                                 | Go to any page, open the menu |
| signed in, opening a pack | As signed in; the Account control disabled (`accounts.md` §4.5); links usable                                                        | Go to another page            |
| on a non-nav page         | On `/account`, `/profile` or not-found, no page link is marked; `Manage account` in the menu is marked on `/account`                 | As signed in                  |
| on an opening page        | The section's link (`Packs` on `/packs/open`, `Shop` on `/shop/open`) with the current fill and `aria-current="true"` (§3.13 step 6) | As signed in                  |

### 4.3 Log in and Register pages

`accounts.md` §4.4 A and B apply unchanged except: no `Back` on Log in or on Register step 1; the `h1` is the page heading; the cross-links of §3.5 are present and usable in every state, submitting included. Leaving while a request is in flight drops its answer from the screen but not from the server: a registration or log in that completes still starts the session, and the app, which holds the session answer, shows the visitor signed in. Success replaces the page as §3.3 step 6.

### 4.4 Manage account page

`accounts.md` §4.6 applies to the page except: `open` is the page itself; the delete confirmation is a modal dialog on the page (§3.4); `delete done` replaces to `/` (§3.4 step 5); `session ended` replaces to `/login` with return path `/account`.

### 4.5 Landing page

The pack drawing (§3.7 item 1.8) is the same in every row: it is shown from 640 px and never changes. The cards are on `/demo` (§4.9).

| State                         | User sees                                                                                                                                              | User can do                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| facts loading                 | `h1`, the lede without numbers, the demo button enabled, the disclosure, the pack drawing; the steps without numbers; no `Pack odds` section yet; Join | Open a demo pack (goes to `/demo`), register, log in |
| facts loaded                  | Lede, steps and `Pack odds` section with the server's numbers                                                                                          | Same                                                 |
| facts failed (no answer)      | As facts loading; the app's unreachable banner                                                                                                         | Try again, open a demo pack (it retries the network) |
| no pool (`odds: null`)        | Lede and steps without numbers; no `Pack odds` section; the demo button replaced by the unavailable line                                               | Register, log in                                     |
| demo opening, returned to `/` | The button reads `Opening…`, `aria-disabled`                                                                                                           | Wait, go to `/demo` with Forward                     |
| demo wait (429) held          | The button `aria-disabled`, reading `Try again in <S> s`, and the wait line                                                                            | Wait                                                 |
| ten demo packs opened         | In place of the button and the disclosure, the Join sentence, `Register` and the `Log in` sentence; focus not moved to it                              | Register, log in                                     |

### 4.6 Profile placeholder (`/profile`, signed in, until item 4)

| State   | User sees                                                                               | User can do          |
| ------- | --------------------------------------------------------------------------------------- | -------------------- |
| default | `h1` `Profile`; one line `Your profile isn't here yet.`; a link `Go to your collection` | Go to the collection |

No illustration, no "coming soon" badge, no date promise. Item 4 replaces the whole page.

### 4.7 Not-found page

| State      | User sees                                                                                                      | User can do               |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ------------------------- |
| signed out | Public header; `h1` `Page not found`; `There's no page at this address.`; link `Go to the start page` (to `/`) | Follow it, use the header |
| signed in  | Signed-in header; same `h1` and line; link `Go to Packs` (to `/packs`)                                         | Follow it, use the header |

The not-found page needs no session to render its body, but it waits for the boot check like every page so its header is the right one.

### 4.8 Cross-cutting

| State                            | User sees                                                                                                                                                     | User can do |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| page code failed to load         | The page's `h1` and, under it, `role="alert"`, `This page couldn't load. Reload to get the latest version.` with a `Reload` button (only with code splitting) | Reload      |
| session ended on an account page | `/login`, the session-ended banner, focus on `Log in` (§3.5 step 8)                                                                                           | Log in      |
| server unreachable later         | The app-level banner on whatever page is showing (`accounts.md` §4.8); no navigation happens because of it                                                    | Try again   |

### 4.9 Demo page (`/demo`)

| State                             | User sees                                                                                                                                                                  | User can do                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| arriving from `/`, in flight      | `h1` `Demo pack` (focused); `Opening…`, `aria-disabled`; `Back to the landing page`; the disclosure; five empty slots                                                      | Wait, go back                             |
| loaded directly, idle             | `h1`; `Open a demo pack`; `Back to the landing page`; the disclosure; five empty slots                                                                                     | Open, go back                             |
| facts loading or failed           | As idle; the rank chip shows the rank alone until the facts arrive (`card-and-rarity.md` §6.2); after a failure, the app's unreachable banner                              | Open (it retries the network)             |
| no pool (`odds: null`)            | The unavailable line in the button's place; previous cards, if any, stay                                                                                                   | Go back, register, log in                 |
| demo revealed                     | Five cards in slot order with the reveal motion; `Demo pack: <summary>`; the keep-cards line under the grid; the button back to `Open a demo pack`                         | Open the next one, register, go back      |
| demo revealed, opening again      | The previous five cards stay until the new answer arrives, then are replaced                                                                                               | Wait                                      |
| shown again (Back, Forward)       | The held cards without their entrance                                                                                                                                      | As revealed                               |
| tenth demo pack revealed          | The tenth pack's cards; in place of the button and the disclosure, the Join sentence, `Register` and the `Log in` sentence; no keep-cards line; focus on the Join sentence | Register, log in, read the cards, go back |
| demo unavailable (503)            | In place of the button: the unavailable line (§8); previous cards, if any, stay                                                                                            | Go back, register, log in                 |
| demo wait (429)                   | Button `aria-disabled`, reading `Try again in <S> s` (from `Retry-After`, down to 1, `tabular-nums`), and the wait line under it; at 0 it reads `Open a demo pack` again   | Wait                                      |
| demo failed (no answer, 400, 403) | Under the button, `role="alert"`, the demo failure line; previous cards stay                                                                                               | Try again                                 |
| image failed on a demo card       | The reveal card's own `No image` fallback                                                                                                                                  | —                                         |
| signed in                         | Replaced by `/packs`                                                                                                                                                       | Play                                      |

## 5. Layout

Breakpoints are Tailwind's: phone below 640 px, `sm` 640, `lg` 1024. The page container stays `max-w-6xl px-4 sm:px-6`.

### 5.1 Header

The header no longer carries an `h1` (each page has its own). It does not collapse into a menu at any width: at most four short links, which fit a 288 px row, and a hidden main navigation costs every phone player an extra tap on every page change.

| Width          | Signed out                                            | Signed in, before item 2                                                                    | Signed in, with Shop and Market                                                                                                                |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| below 640 px   | One row: wordmark left; `Log in` and `Register` right | Row 1: wordmark left, Account control right. Row 2: the links, full width, each `flex-auto` | `market-and-shop.md` §5.1: wordmark; then balance left and Account control right; then the four links full width, each `flex-auto` with `px-2` |
| 640–1023 px    | One row, as on phone                                  | One row: wordmark left; links, then the Account control, right                              | Wordmark; then one row, links left, balance and Account control right                                                                          |
| 1024 px and up | One row, as on phone                                  | One row, as at `sm`                                                                         | One row: wordmark left; links, balance and Account control right, `gap-3`                                                                      |

Below 400 px the `(<N>)` of `Collection (<N>)` is visually hidden (`sr-only min-[400px]:not-sr-only`), as `market-and-shop.md` §5.1 has it; the accessible name keeps it. The login in the Account control truncates as `accounts.md` §5 says.

### 5.2 Page heading

Every page starts its `<main>` with its `h1`, left-aligned, `mb-6`. On `/login` and `/register` the `h1` sits inside the existing panel (`w-full max-w-sm`, where today's `h2` is); the guard line is under it. On `/account` the page is one column, `max-w-lg`, the sections separated as in the dialog (`border-t border-zinc-800 pt-6 mt-6`). `/profile` and the not-found page are one column, `max-w-md`, `py-12`.

### 5.3 Landing page

- One column, left-aligned, in the page container. Text measures are `max-w-xl` (lede, disclosure, step sentences), so lines stay readable at every width.
- **Hero**, `pt-6 sm:pt-10 lg:pt-16`:
  - Below 640 px: one column: the `h1`, the lede (`mt-4`), the button (`mt-6`, full width) and the disclosure (`mt-3`). The pack drawing is not rendered. At 320 × 568 the button is above the fold.
  - From 640 px: `grid grid-cols-[minmax(0,1fr)_11.25rem] items-center gap-8`: the text column on the left (button `w-auto`), the pack drawing on the right at 180 × 252 px (the reveal card's size). At 640 px the text column is 380 px wide, which holds the `h1` at `sm:text-5xl` on one line.
  - From 1024 px: the same grid with `gap-16`; the text column is capped at `max-w-2xl`, so the pack sits beside the text, not at the far edge.
- **How it plays**: `mt-20`; the `h2`, then the ordered list `mt-6`, `divide-y divide-zinc-800 border-y border-zinc-800`, each step `py-4`. From 640 px a step is one row, `grid grid-cols-[2.5rem_8rem_minmax(0,1fr)] items-baseline gap-x-6` (number, term, sentence). Below 640 px the number and the term share the first line and the sentence sits under them.
- **Pack odds**: `mt-16`; the `h2`, then the table `mt-4`, full width up to `max-w-xl`, numbers right-aligned. On a 320 px phone the three columns fit at `text-sm` with the swatch (10 px plus an 8 px gap) before the word and the stars hidden; the longest cell is `Legendary`. From 640 px the stars show between the swatch and the word.
- **Join**: `mt-16 border-t border-zinc-800 pt-8`; the sentence, then the `Register` link-button and the log-in sentence on one row from `sm`, stacked on phone.
- The footer as on every page.

### 5.4 Demo page

- `h1` `Demo pack` (`mb-6`), as every page's (§5.2).
- **Action row**: `flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4`: `Open a demo pack` (full width on a phone, auto from `sm`) and `Back to the landing page`; the disclosure under the row, `mt-3`, `max-w-xl`. After the tenth pack the Join sentence and its actions take the button's and the disclosure's place, `Back to the landing page` after them.
- **Reveal**, `mt-10`: the summary, then the grid `mt-4` with the 1c reveal grid's columns (2 / 3 / 5 at phone / `sm` / `lg`, `packs-page.md` §5.2), then the keep-cards line `mt-4`. The summary's line keeps its height while the slots are empty (`min-h-5`), so nothing jumps when the cards land.
- The footer as on every page.

## 6. Visual treatment

No new tokens. Everything below uses existing utilities, `web/src/components/account/styles.ts` and the rarity tokens 1c adds.

### 6.1 Header

- **Wordmark**: `Anime TCG` as a link, `text-xl font-black tracking-tight text-zinc-100`, no gradient (it was gradient text, debt in `docs/06-engineering-standards.md` §2), the violet focus ring. Not a heading.
- **Subtitle removed**: `Open packs, collect characters. Data from AniList.` is explanatory copy (§2 debt). The AniList credit lives in the footer, which gains a link on `AniList` (§8).
- **Page links**: the former tab group's look, unchanged: the group `flex gap-1 rounded-xl bg-zinc-900 p-1`; each link `rounded-lg px-4 py-1.5 text-sm font-medium` (`px-2` on phone with four links), current `bg-zinc-700 text-white`, others `text-zinc-400 hover:text-zinc-200`, the violet focus ring, `min-h-10 sm:min-h-0`. The current page is shown by the fill and announced by `aria-current`; nothing else changes on hover.
- **Signed out**: `Log in` in `BUTTON.text` at `text-sm`, `Register` in `BUTTON.secondary`, both links.
- The page's radial violet background is debt for `visual-system.md`; this feature leaves it.

### 6.2 Landing page

No new tokens: the rarity text tokens and the frame colours of `card-and-rarity.md` §10 and the existing utilities cover every part. Where kyara's look conflicts with `docs/06-engineering-standards.md` §2 and §3, the rule wins (§12 lists each case).

- **Type** (kyara leads with a very heavy display face at a large size; the weight and size are taken, the typeface is not: no web font, since the CSP and §3.12 item 6 keep the page to same-origin and AniList images, and the system has one type family): `h1` `text-4xl leading-none font-black tracking-tight text-zinc-100 sm:text-5xl lg:text-6xl`; lede `text-base text-zinc-300 sm:text-lg`; section `h2`s `text-lg font-bold text-zinc-100`.
- `Open a demo pack`: `BUTTON.primary`. It is an ordinary primary action, not the 1c pack control and not louder than it: no gradient, no emoji, no size bump, no shadow, no hover scale or lift, no glow, no pill shape (kyara's call to action is a glowing pill that rises on hover; ours is the app's flat button).
- `Back to the landing page` on `/demo`: a link with `BUTTON.secondary`'s classes. The `h1` `Demo pack` as every account page's `h1` (§6.3).
- Disclosure line and keep-cards line: `text-sm text-zinc-400`, the `register` link inside it `text-zinc-200 underline decoration-zinc-600 underline-offset-2 hover:text-white`.
- **The pack drawing** (item 1.8): `aspect-[5/7] w-[11.25rem] rounded-[12px] border border-zinc-700 bg-zinc-900 p-4 flex flex-col`, `aria-hidden="true"`, `hidden sm:flex`.
  - Top: `Anime TCG` `text-base font-black tracking-tight text-zinc-100`; under it `Demo pack` `text-xs text-zinc-400`.
  - Middle (`mt-auto`): the ladder, six lines, Common's one star at the top to Mythic's six at the bottom, each in `text-rarity-<tier>-text`, `text-[11px] leading-4 tracking-[2px]`, `font-variant-emoji: text` (the card's star glyph, `card-and-rarity.md` §6.1).
  - Bottom (`mt-3`): `Five cards` `text-xs text-zinc-400`.
  - Nothing else: no shadow, glow, gradient, texture, card-back art, tilt, 3D, hover state or motion. It is a label, not a card frame, so the owner's frame exception does not reach it (`docs/06-engineering-standards.md` §2).
- Empty slots: the shared reveal's (`packs-page.md` §5.2, §6.5): the card's 5:7 box, `aspect-[5/7] rounded-[12px] bg-zinc-900`, static (no shimmer, no pulse, no card-back art).
- Demo cards: the 1c reveal card with no effects, so the demo shows what the game shows. No `Demo` stamp on the art: the summary line says it, and drawing on the art hides it.
- **Steps**: the number `text-sm font-semibold text-zinc-400 tabular-nums` (kyara's numbered labels, in our type), the term (`h3`) `text-sm font-semibold text-zinc-100`, the sentence `text-sm text-zinc-400`, numbers in it `tabular-nums`; hairline dividers `border-zinc-800`.
- **Odds table**: header cells `text-xs text-zinc-400`, rows `border-b border-zinc-800 py-2 text-sm`, the tier word in its tier's text colour (`--color-rarity-<tier>-text`, `card-and-rarity.md` §4.2), figures `text-zinc-200 tabular-nums`. The swatch before the word: `inline-block w-2.5 aspect-[5/7] rounded-[2px]`, filled with the tier's flat frame colour (`var(--card-frame-common)`, `var(--card-frame-uncommon)`, `var(--card-frame-rare)`, `var(--card-frame-flat-epic)`, `var(--card-frame-flat-legendary)`, `var(--card-frame-flat-mythic)`, the thumbnail colours of `card-and-rarity.md` §5.2), no glow. The stars `hidden sm:inline` in the tier's text colour. The source line `text-xs text-zinc-400`.
- Join: the sentence `text-sm text-zinc-300`; `Register` as a link with `BUTTON.primary`'s classes; `Log in` an underlined text link as above.
- Demo failure: `ERROR_TEXT` at `text-sm`; wait line `text-xs text-zinc-400`; unavailable line `text-sm text-zinc-400`.
- **Background**: the page's own background; no panel, tint, gradient wash, watermark glyph or glow behind the hero.
- **Motion**: on `/demo`, the 1c reveal's card entrance (`card-enter`, 200 ms, `packs-page.md` §6.3); nothing else moves on either page, the pack drawing included. Off under `prefers-reduced-motion: reduce`.
- **Nothing else**: no confetti, sparkles, glows, gradients, card fans, floating cards, carousels, counters, sound, "rare pull" emphasis, or a different treatment for a Legendary or Mythic in the demo.

### 6.3 Other pages

- `h1` on account pages, `/account`, `/profile`, not-found: `text-xl font-bold text-zinc-100`, `focus:outline-none` (it receives programmatic focus only, like today's account heading).
- `/login`, `/register`: the existing `PANEL_HEADING` on the `h1`.
- Skip link: `sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20` with `BUTTON.secondary` and `bg-zinc-950`.
- Not-found and profile lines `text-sm text-zinc-400`; their links `BUTTON.secondary`.

## 7. Accessibility

- **Landmarks**: one `<header>` (the wordmark, `<nav aria-label="Main">` with the page links, the Account control); one `<main>`; one `<footer>`. Signed out, `Log in` and `Register` are inside the same `<nav aria-label="Main">`.
- **Links**: `aria-current="page"` on the current page's link only. Not `aria-pressed` (the former tab buttons); these are links, and Tab moves through them in order. `Collection (<N>)` keeps its full accessible name at every width.
- **Headings**: exactly one `h1` per page, the one in the route table; sections below it start at `h2`. The collection's and the market's visually hidden region headings become the visible `h1`s (§10).
- **Focus**: as §3.6. The `h1` has `tabindex="-1"` and is the focus target of every navigation after the first render; dialogs restore focus to their opener as before; when a page is left with a dialog open, focus goes to the new page's `h1`.
- **Skip link**: first in the tab order, named `Skip to content`, moves focus to the `h1`.
- **Titles**: set before focus moves, so a screen reader that reads the title on focus change reads the new one.
- **Live region**: the existing single app-level region (`accounts.md` §7) carries the action messages of §3.6 step 3 and the demo's announcement; it never carries "navigated to".
- **Demo** (`/` and `/demo`): `Open a demo pack` is a `<button>`; while in flight it is `aria-disabled`. Pressed on `/`, it moves to `/demo` and focus goes to the `h1` `Demo pack` (§3.14 step 1); pressed on `/demo`, it keeps focus (`accounts.md` §11). When the cards arrive, focus stays where it is, and the live region reads `Demo pack: <summary>.` once. After the tenth pack the button leaves the page, so focus moves to the Join sentence that replaces it (a `<p tabindex="-1">`, read on focus), and the live region still reads the summary; `Register` is the next Tab stop. The reveal grid is a list (`<ul aria-label="Demo pack">`) of five items; each card's name, series and rarity are text in it, so a screen reader can walk the cards without the art. The wait is announced once by its `role="status"` line, and `You can try again now.` when it ends, as the Log in wait does. Empty slots are `aria-hidden`.
- **Hero**: the `h1` is the section's label (`aria-labelledby="landing-heading"`). The pack drawing is `aria-hidden="true"`, holds no focusable element and is not in the tab order; its words are said by the button, the disclosure and the `Pack odds` section.
- **Pack odds**: its own `<section aria-labelledby>` on the `h2`. A real `<table>` labelled by that `h2` (`aria-labelledby`, no second visible caption), `<th scope="col">` and a `<th scope="row">` per tier. The tier is a word, never colour alone; the swatch and the stars are `aria-hidden`.
- **Steps**: `<ol role="list">` (the role keeps list semantics where `list-style: none` removes them); each `<li>` holds the visible number (`aria-hidden`, since the list position is announced), the term as an `h3` and the sentence as a `<p>`.
- **Keyboard path on `/demo`**: Skip link → `h1` → `Open a demo pack` → `Back to the landing page` → the `register` link in the keep-cards line → the footer; the cards are articles, read in browse mode.
- **Opening pages**: as every page (§3.6), with the rules of §3.13; the section link's `aria-current="true"` is the only `aria-current` value on them.
- **Guard line, unavailable and failure lines**: the guard line is plain text (read with the page); the demo failure is `role="alert"`; the unavailable line is plain text.
- **Touch targets**: links, the skip link and the demo button are at least 40 px tall on phone (`accounts.md` §7).
- **Reduced motion**: the reveal entrance is the only motion and is off under `prefers-reduced-motion: reduce`.
- **Scroll**: restoring a position on Back never moves focus away from the `h1` it set; the `h1` is focused with `preventScroll` so the restored position holds.

## 8. Copy

Exact strings. `<login>` the account login; `<N>` a number; `<S>` countdown seconds; `<characters>` the pool's character count and `<entries>` its anime entry count (`Intl.NumberFormat("en-GB")`, `2,143`); `<interval>` `intervalSeconds` as `<n> minutes` (or `1 minute`, or `<n> hours` when it is a whole number of hours over 59 minutes); `<cap>` the pack cap (`cap`) as a number; `<summary>` the 1c reveal's summary phrase; `<D Mon YYYY>` the `metaLine` date format of `accounts.md`, from `odds.snapshot.takenAt`; percentages as `market-and-shop.md` §3.3.

**Words.** The words "secure", "verified", "protected", "safe", "private", "attempt", "locked" and "blocked" do not appear in any string below and must not be added (`accounts.md` §8). The money and nudge rules of `collection-overview.md` §8 apply to every string here, the landing page included: no "pay", "paid", "cash", "money", "coins", "earn", "profit", "worth", "value", "balance", "wallet", "store", "checkout", "purchase", no currency symbol; no exclamation marks; no urgency ("hurry", "act now", "today only", "ending soon", "last chance", "don't miss"); no scarcity ("only <N> left", "limited"); no "free" (except the exact phrases "free pack" and "free packs", the owner's term for the timer pack in `card-and-rarity.md` §7.1 and §7.4, allowed in the packs copy and the odds dialog only; `packs-page.md` §9), "lucky", "jackpot", "win", "prize", "you could get", "try your luck", "one more", "another"; no comment on what a demo pack contained. "Demo" is allowed. The copy test scans every string of this section for these, as it does for the accounts copy.

**Titles and headings**

| Element                | Copy                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Titles                 | as the route table (§3.1); `Anime TCG` while booting                                                                                                                            |
| `h1`s                  | `Anime TCG` · `Demo pack` · `Packs` · `Pack opening` · `Collection` · `Shop` · `Shop pack` · `Market` · `Profile` · `Log in` · `Register` · `Manage account` · `Page not found` |
| `index.html` `<title>` | `Anime TCG`                                                                                                                                                                     |

**Header and footer**

| Element      | Copy                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark     | `Anime TCG`                                                                                                                                                                                     |
| Nav label    | `Main`                                                                                                                                                                                          |
| Page links   | `Packs` · `Collection (<N>)` / before the first count `Collection`; from item 2 `Packs` · `Shop` · `Market` · `Collection (<N>)`                                                                |
| Signed out   | `Log in` · `Register`                                                                                                                                                                           |
| Account menu | `Manage account` · `Log out` (from item 4, `Profile` first; §9, decision 2)                                                                                                                     |
| Skip link    | `Skip to content`                                                                                                                                                                               |
| Footer       | `Non-commercial fan project. Character images and titles © their respective owners, served via the AniList API.` with `AniList` as a link to `https://anilist.co` (`rel="noreferrer"`, new tab) |

**Log in and Register pages** (only the strings that change; everything else is `accounts.md` §8)

| Element                        | Copy                                  |
| ------------------------------ | ------------------------------------- |
| Log in cross-link              | `No account yet?` + link `Register`   |
| Register cross-link            | `Already registered?` + link `Log in` |
| Guard line, from `/packs`      | `Log in to open your packs.`          |
| Guard line, from `/collection` | `Log in to see your collection.`      |
| Guard line, from `/shop`       | `Log in to see the shop.`             |
| Guard line, from `/market`     | `Log in to see the market.`           |
| Guard line, from `/profile`    | `Log in to see your profile.`         |
| Guard line, from `/account`    | `Log in to manage your account.`      |

**Landing page**

| Element                                       | Copy                                                                                                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `h1`                                          | `Anime TCG`                                                                                                                                                                                                                  |
| Lede                                          | `<characters> characters from the <entries> most popular anime on AniList, five to a pack.`                                                                                                                                  |
| Lede without facts                            | `Characters from the most popular anime on AniList, five to a pack.`                                                                                                                                                         |
| Demo button                                   | `Open a demo pack` / in flight `Opening…` / waiting `Try again in <S> s`                                                                                                                                                     |
| Disclosure (under the button)                 | `A demo pack uses the same odds as every pack in the game. Its cards aren't kept: nothing is saved, and they don't go to any account.`                                                                                       |
| Pack drawing (`aria-hidden`)                  | `Anime TCG` · `Demo pack` · `Five cards`                                                                                                                                                                                     |
| Demo page `h1` and title                      | `Demo pack` · `Demo pack · Anime TCG`                                                                                                                                                                                        |
| Demo page link                                | `Back to the landing page`                                                                                                                                                                                                   |
| Reveal list label                             | `Demo pack`                                                                                                                                                                                                                  |
| Summary                                       | `Demo pack: <summary>`                                                                                                                                                                                                       |
| Live region on reveal                         | `Demo pack: <summary>.`                                                                                                                                                                                                      |
| Keep-cards line                               | `To keep cards, register with an invite code.` with the lowercase `register` in the sentence as the link text                                                                                                                |
| After the tenth pack (in place of the button) | the Join sentence, `Register` and `Already registered?` + link `Log in`, exactly as in Join below; no other line                                                                                                             |
| Unavailable (503)                             | `Demo packs are unavailable right now.`                                                                                                                                                                                      |
| Wait (429, `role="status"`)                   | `Demo packs take a short pause after many in a row. The button comes back by itself.`                                                                                                                                        |
| Wait without `Retry-After`                    | the button reads `Open a demo pack` and stays `aria-disabled` for 60 s, with the same wait line                                                                                                                              |
| Wait over (live)                              | `You can try again now.`                                                                                                                                                                                                     |
| Failure (no answer, 400, 403)                 | `Couldn't reach the game server. Try again.`                                                                                                                                                                                 |
| Step numbers (`aria-hidden`)                  | `01`, `02`, … two digits, in the order the steps exist                                                                                                                                                                       |
| Section `h2`                                  | `How it plays`                                                                                                                                                                                                               |
| Row `Packs`                                   | `A new pack every <interval>, and up to <cap> can pile up. Five cards each.` / without facts `A new pack on a timer, and a few can pile up. Five cards each.`                                                                |
| Row `Rarity`                                  | `Every character has one of six tiers, set by how many AniList users favourited them. Every pack uses the odds below.` / without odds `Every character has one of six tiers, set by how many AniList users favourited them.` |
| Row `Collection`                              | `See how much of each series you have, and how much of all <characters> characters.` / without facts `See how much of each series you have, and of the whole pool.`                                                          |
| Row `Karma` (from `feat/economy-ui`)          | `Recycle duplicates for Karma and spend it on themed packs. Karma comes only from playing. It can't be bought.`                                                                                                              |
| Row `Market` (from `feat/market-ui`)          | `List cards for other players to buy with Karma, and buy theirs.`                                                                                                                                                            |
| Odds section `h2` (labels the table)          | `Pack odds`                                                                                                                                                                                                                  |
| Odds columns                                  | `Tier` · `At least one per pack` · `Each card`                                                                                                                                                                               |
| Odds source                                   | `Drawn from <characters> characters, as of <D Mon YYYY>.`                                                                                                                                                                    |
| Join `h2`                                     | `Join`                                                                                                                                                                                                                       |
| Join sentence                                 | `Playing needs an account, and registering needs an invite code from the owner.`                                                                                                                                             |
| Join actions                                  | `Register` · `Already registered?` + link `Log in`                                                                                                                                                                           |

**Profile placeholder and not-found**

| Element                    | Copy                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| Profile line               | `Your profile isn't here yet.`                                                 |
| Profile link               | `Go to your collection`                                                        |
| Not-found line             | `There's no page at this address.`                                             |
| Not-found link, signed out | `Go to the start page`                                                         |
| Not-found link, signed in  | `Go to Packs`                                                                  |
| Page-load failure          | `This page couldn't load. Reload to get the latest version.` · button `Reload` |

**Copy that changes elsewhere** (`accounts.md` §8; the other specs in §10)

| Element                              | Old                                                                                     | New                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Document title, signed in            | `<login> · Anime TCG`                                                                   | per page (§3.1)                                         |
| Document title, signed out           | `Anime TCG`                                                                             | per page (§3.1)                                         |
| Control, signed out                  | `Account`                                                                               | removed; `Log in` · `Register` links                    |
| Account screen                       | `Your account`, `Log in to your collection, or register a new one with an invite code.` | removed (the landing page and the two pages replace it) |
| Menu item                            | `Manage account…`                                                                       | `Manage account`                                        |
| Header subtitle                      | `Open packs, collect characters. Data from AniList.`                                    | removed                                                 |
| Tab `Booster`                        | `Booster`                                                                               | link `Packs`                                            |
| `Back` on Log in and Register step 1 | `Back`                                                                                  | removed                                                 |

## 9. Decisions and open questions

### 9.1 Decided by the owner, 2026-10-29

The owner's answers to this spec's four open questions; each took the recommended option except 3, where the owner set a number.

| #   | Question                                | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                                                                                        | Where                                       |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | The demo before 1c's server pool exists | The navigation PR ships the routes and the landing page without the demo block; the demo, the live numbers and the odds table land in a later PR with the demo endpoints, after 1c's server PR merges.                                                                                                                              | §3.7, §3.8 item 8, §4.5                     |
| 2   | Profile in the navigation               | No link until item 4 ships; then a `Profile` item at the top of the Account menu. Until then `/profile` is the placeholder, reachable only by its address.                                                                                                                                                                          | §3.5 step 2, §4.6, §8                       |
| 3   | How many demo packs a visitor can open  | 10. Manager's reading, applied here: up to 10 per page load; after the tenth the button is replaced by the Join sentence and `Register`, in plain words with no count or nudge; a reload resets the count; the server's per-address `DEMO_RATE_LIMIT` stays, sized so 10 packs in a visit are never refused, and is the real bound. | §3.7 item 1.7, §3.8 items 1 and 5, §4.5, §8 |
| 4   | The HTTP status of an unknown path      | Caddy serves `index.html` with 200 for every non-API, non-asset path; the app shows the not-found page.                                                                                                                                                                                                                             | §3.12 item 1, §4.7                          |

The router is chosen by the manager in [ADR 0012](../adr/0012-client-router.md): TanStack Router (`@tanstack/react-router`), a code-based route tree, no file-based codegen (§3.9).

### 9.2 Decided by the owner, 2026-10-30

The three questions of this revision; the owner took the recommended option for 1 and 3, and option B for 2.

| #   | Question                                                      | Decision (Owner, 2026-10-30)                                                                                                                                                                                         | Where                                   |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | Does a pack bought in the shop open on its own page?          | A: yes, at `/shop/open`; Back returns to `/shop`.                                                                                                                                                                    | §3.13, `market-and-shop.md` §3.3 step 6 |
| 2   | Where does the landing demo open?                             | B: on a public `/demo` page (kyara's flow). `Open a demo pack` on `/` pushes `/demo`; a direct load or reload of `/demo` shows the page with its button ready (§3.14 step 9 says why, rather than a replace to `/`). | §3.7, §3.14, §4.9, §5.4                 |
| 3   | What can the player do on `/packs/open` after the cards land? | A: `Open pack` and `Back to packs`, with the count line.                                                                                                                                                             | `packs-page.md` §3.7                    |

**Not applied, for the manager**: the instruction for question 2 also asked for a count line on `/demo` ("N of 10 this visit"). It conflicts with §3.7 item 1.7 ("Nothing counts down or up on the way: no remaining number"), which applies decision 3 of §9.1 ("in plain words with no count or nudge"), and with the same instruction's "every existing demo rule stays". A visible count of a limited allowance is the scarcity cue §8 rules out. `/demo` therefore has no count line. If the owner wants one anyway, it is one string (`Demo pack <n> of <perVisit>`) and the rule of item 1.7 has to change with it.

### 9.3 Open

None.

Decided in this spec, with the reasons given where they are made: `/account` is a page (§3.4); a signed-in visitor at `/` goes to `/packs` and does not see the landing page, because its demo shows cards that would not go into their collection and its Join section asks them to do what they have already done (§3.3 step 7, §3.11 step 4); the return path travels in history state, not in the URL (§3.3); signed-in titles carry the page name, not the login (§3.1 rule 4); the header never collapses into a menu (§5.1).

## 10. Changes to other specs

Not made here; each spec's owner (the `ui-designer` for UI specs, the manager for the rest) applies them in the PR that touches that spec.

**`docs/design/accounts.md`** (shipped; amend with this feature's PR)

- §3.1, §4.1: boot then routing as §3.2 here; unreachable on an account page goes to `/login` with the return path.
- §3.2, §4.3, §7 "Account screen": the choice screen and its copy are retired; `/login` and `/register` are pages, and the landing page offers the choice.
- §3.3.4, §3.4.4, §4.4 "success": land on the return path or `/packs` by replace; focus to that page's `h1` (§3.6 step 3), not the pack button.
- §3.4.1, §4.4-A step 1, §4.4-B idle: no `Back`; the cross-links of §3.5; the `h1` replaces the panel's `h2`.
- §3.5.2, §4.5 "after Log out": replace to `/`, focus to the landing `h1`.
- §3.5.3, §4.6, §5 "Dialog", §7 "Dialog": Manage account is the `/account` page (§3.4 here); the delete confirmation becomes a modal dialog on it; sections use `h2`.
- §4.5 signed out: the `Account` button is replaced by `Log in` and `Register` links.
- §4.8 session ended: replace to `/login` with the current page as the return path.
- §5 Header: as §5.1 here.
- §8: the rows in this spec's "Copy that changes elsewhere".

**`docs/design/collection-packs.md` §8** (1c web PR) and the 1c web UI spec

- "Booster tab" becomes the `/packs` page with the `h1` `Packs`; the pack control and reveal sit under it.
- The reveal card and the summary phrase are shared with the landing demo; the reveal entrance stays within 150–250 ms.
- "The pool is no longer loaded at boot or while signed out": still true; the landing page reads only the demo endpoints.
- §6.3 gains the two demo routes in the demo PR, after 1c's server PR (or a separate API spec does; the manager decides), with §3.8's rules (`perVisit` included): public, no session, no writes, `DEMO_RATE_LIMIT`, the 1c roll with no writes, and the shared-odds test.

**`docs/design/collection-overview.md`** (applied on `docs/specs-catch-up`, 826fd28)

- "the Collection tab" throughout becomes the `/collection` page; §3.1 "when the tab is shown" becomes "when the page is shown".
- §4.1 empty state: `Open a pack` is a link to `/packs` (focus by §3.6, to the `Packs` `h1`), not "switches to Booster, focuses the pack button".
- §7 Region: the visually hidden `h2` `Collection` becomes the visible `h1` `Collection`; headings below shift down one level.
- §2 "survive switching tabs" becomes "survive moving between pages"; still reset on reload and log out.
- §3.5 `See <name> on the market`: navigates to `/market` (push) with the character filter set in the signed-in layout's state; Back returns to `/collection` with the dialog closed.
- §8 "Tab label": the header link label, same strings.

**`docs/design/market-and-shop.md`** (applied on `docs/specs-catch-up`, 826fd28)

- §3.2: the tabs are the page links `Packs` · `Shop` · `Market` · `Collection (<N>)` (`Booster` renamed `Packs`), on `/packs`, `/shop`, `/market`, `/collection`.
- §3.3, §3.4: "showing the tab" becomes "showing the page"; the shop reveal stays "until the page is left" (superseded 2026-10-30: the bought pack shows on `/shop/open`, §3.13).
- §5.1: the header table stays, with the wordmark in place of the title block and no subtitle.
- §7 Tabs: `<nav aria-label="Main">` with links and `aria-current="page"`, not `aria-pressed` buttons. Shop and Market: the visually hidden `h2`s become the visible `h1`s `Shop` and `Market`.
- §8 Tabs row: `Packs` · `Shop` · `Market` · `Collection (<N>)`.
- `feat/economy-ui` adds the landing `Karma` row, `feat/market-ui` the `Market` row (§8 here).

**Applied in the 2026-10-30 revision (this branch)**

- `docs/design/packs-page.md`: `/packs` keeps the control, the countdown, the pity line and the odds; the reveal moves to `/packs/open` (its §3.7), with the routing of §3.13 here.
- `docs/design/market-and-shop.md` §3.3 step 6, §4, §5.2, §7, §8: the bought pack shows on `/shop/open` (owner, 2026-10-30, §9.2 question 1).
- `docs/design/card-and-rarity.md` §3.2, §5.3, §7.1, §7.2 and §11: the reveal is on `/packs/open`, the shop's on `/shop/open`, the demo's on `/demo`; the pity counter and `Pack odds` stay on `/packs`.

**`docs/design/economy.md` §12**

- "its own **Shop** tab" becomes the `/shop` page; "the free timer pack keeps its own control on the Booster tab" becomes "on the `/packs` page".

**For the manager** (not specs this designer edits)

- `docs/02-roadmap.md`: a row for this feature and a row (or a note) for the demo PR, which follows 1c's server PR (decision 1).
- [ADR 0012](../adr/0012-client-router.md) records the router (TanStack Router, code-based route tree); written by the manager on this branch.
- `docs/05-security.md`: the demo endpoints in the threat model (public, unauthenticated, RNG, database reads, rate limit) at T3; the return-path check as a control against open redirects, with its tests (every rejected form of §3.3 step 3); the `Caddyfile` change of §3.12 at T3 (proxy).
- `docs/04-deployment.md`: one line that every non-API path serves the app and `/api` itself goes to the api.

## 11. Test hooks

The tester queries by role and accessible name, as in `web/e2e/landing.spec.ts` and `navigation.spec.ts`. Extra attributes: `data-slot` on reveal items (`packs-page.md` §10) and `data-testid="landing-pack"` on the pack drawing, which has no role or name because it is `aria-hidden`.

**Unit**: the hero renders the `h1`, the lede in both forms, the button and the disclosure; the pack drawing is `aria-hidden`, holds no focusable element and has no animation or transition class; the steps are numbered `01` to `03` today, `04` with Karma, `05` with Market, and are absent from the build before their PR; with `odds: null` there is no `Pack odds` section and the `Rarity` sentence is the without-odds form; the copy scan covers the new strings of §8.

**e2e** (in addition to every landing test of #42, which stay: 10 per page load, the double-click guard, the demo card's lack of effects, the odds figures, the copy scan, no storage):

1. **Order**: on `/`, in DOM order, the `h1`, `Open a demo pack`, the disclosure, the `h2`s `How it plays`, `Pack odds` and `Join`, then the footer; no `Demo pack` list.
2. **The pack drawing**: rendered at 640 and 1024 px, not rendered at 320 px; `getAnimations()` is empty; computed `box-shadow` is `none` and `transform` is `none` before a hover, during a hover and during a demo opening.
3. **The button**: computed `background-image` is `none` (no gradient) and `transform` stays `none` on hover. At 320 × 568 it is inside the viewport on load.
4. **One primary action in the hero**: the hero section holds exactly one button and no link styled as a button.
5. **Requests**: loading `/` and opening three demo packs (on `/demo`) makes requests only to the app's origin and `s4.anilist.co` (no font host).
6. **Responsive**: at 320, 640 and 1024 px no horizontal scroll; the odds table's three columns fit at 320 px.
7. **The demo page** (§3.14):
   - `Open a demo pack` on `/` sends one `POST /api/demo/open`, changes the URL to `/demo` and the title to `Demo pack · Anime TCG`, and focuses the `h1` `Demo pack`; a double click and a held Enter send one `POST` and push once.
   - On `/demo` the button opens the next pack in place (no URL change, focus kept, the live region reads the summary once); the tenth pack replaces the button with the Join offer on `/demo` and on `/`.
   - Back from `/demo` returns to `/` with its `h1` focused; Forward shows the held cards with no running animations; `Back to the landing page` pushes `/`.
   - `page.goto("/demo")` and a reload show the page with the button enabled and five empty slots; the count restarts at zero.
   - Signed in, `/demo` ends on `/packs`.
   - 503, 429 and a lost answer show their states on `/demo`; nothing navigates.
   - The demo card has no glow, glint or drift on `/demo` (the #42 test, moved).
8. **Opening pages**: `packs-page.md` §10 item 17 covers `/packs/open`; `feat/economy-ui` adds the same cases for `/shop/open`. The stack test of §3.12 item 1 includes `/packs/open`.

## 12. Reference: kyara.games (studied 2026-10-30)

**What could be seen.** No browser was available, so the rendered page itself was not seen. What was read, as text:

- The page's HTML, a SvelteKit app shell in French: the title and description (free packs on a ten-minute timer, more than 6,000 anime characters, trading and selling cards, and a wiki page per character that owning its card unlocks), Open Graph tags, a red-orange theme colour, three Google-hosted fonts (a heavy display face, a Japanese gothic for text and a monospace for numbers), a full-screen boot splash with a pulsing, tilted logo tile, and structured data that declares the game free, a 4.7 rating from about 30,000 ratings, and a list of short player reviews.
- `robots.txt`, `sitemap.xml` and the app's route list: among others `/`, `/collection`, a market, a rarities page, rules, a leaderboard, missions, a wiki per character, profiles, **a pack-opening page per kind of pack** (`/ouvrir/<packId>`) and **a shareable page for one result** (`/tirage/<shareId>`).
- The compiled code of the landing page and of the opening page: their interface strings and class names, which show the structure, not the look.

**What could not be seen**: the rendered layout at any width, its images, the card design, the motion as it plays, the signed-in screens, and how a visitor without an account is led through. Web searches found no screenshots, reviews or write-ups of the site. Everything below about layout is read from code, not observed.

**Its landing page, as the code describes it**, top to bottom: a hero panel with a small uppercase label, a heading sentence, one line of text and two pill buttons (open a pack, and a second action), on a gradient tinted with the featured pack's colour, with a large blurred kana glyph behind and the pack's cards beside the text, rotating between featured packs; a shelf of packs to choose from, with prices in its currency and "daily", "limited" and "ends soon" flags; a numbered three-step "how it works" band (open packs, complete series, unlock the wiki); a live feed of other players' Legendary and Mythic pulls; a top-collectors board; a strip of market listings with prices; player reviews; and a "your day" block with a login streak, daily missions, rewards to claim and referral rewards.

**Its opening page, as the code describes it**: one page per kind of pack; the cards come face down and turn one at a time by tap, swipe or Space, with a "reveal all"; sound with a mute; special packs announced with exclamation marks; a best-card highlight; a shareable image of the result; then "open another", "back to the packs" and "see the collection". A note asks the player not to reload, because the pack is kept. Visitors without an account open packs on the same page, up to a guest limit.

**Taken, adapted, left out**

| kyara                                                       | Here                                                                                             | Why                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The hero shows the pack beside the text                     | The pack drawing beside the text from 640 px (§3.7 item 1.8)                                     | Taken. Static: no tilt, glow, shadow or colour wash (§2 of the standards)                                                                     |
| One call to action on the pack                              | `Open a demo pack`, one primary button, the disclosure under it                                  | Taken. The second hero button is left out: a hero with two calls to action is on the standards' list; Join is one button and a sentence       |
| A very heavy display heading                                | `font-black` at 4xl to 6xl in the system font                                                    | Adapted: no web font (CSP, §3.12 item 6), one type family                                                                                     |
| Uppercase monospace labels and numbers                      | Two-digit step numbers in `tabular-nums`                                                         | Adapted: no second typeface, no uppercase labels                                                                                              |
| A three-step band                                           | Numbered steps in one column (§3.7 item 2)                                                       | Adapted: a three-across icon-title-blurb row is on the standards' list                                                                        |
| Rarity teased by a live feed of others' rare pulls          | `Pack odds` as a section of its own, each tier with its stars and frame colour (item 3)          | Adapted: "recent pulls by other players" is excluded (§3.7), and a feed of rare pulls is a nudge                                              |
| A shelf of packs with prices and limited or ends-soon flags | None                                                                                             | Left out: one demo pack; prices, scarcity and urgency are banned on the landing page (§8)                                                     |
| Leaderboard, reviews and rating, streak, missions, referral | None                                                                                             | Left out: §3.7 "never shows"; each is a nudge                                                                                                 |
| A strip of market listings with prices                      | None (the `Market` step from `feat/market-ui`)                                                   | Left out: no prices or money-like cues on the landing page                                                                                    |
| Rotating hero, pulsing splash, glowing pill, hover lift     | None                                                                                             | Left out: motion that loops, glows as decoration and hover-lift are on the standards' list                                                    |
| A warm dark palette with a red-orange accent                | The app's zinc scale and violet accent                                                           | Left out: one accent, the visual system is this app's                                                                                         |
| An opening page per kind of pack                            | `/packs/open` and `/shop/open` (§3.13)                                                           | Taken, per the owner's request; no id in the path, since the free pack has one kind                                                           |
| A shareable page for one result                             | Later option, `/packs/<id>` (§2)                                                                 | Out of scope: it needs an API                                                                                                                 |
| Cards face down, turned one by one; reveal all              | All five land together, 50 ms apart (`packs-page.md` §3.4)                                       | Left out: turning cards one at a time is suspense built on the pull (ADR 0004 §6, `collection-packs.md` §8); the answer shows when it arrives |
| Sound, exclamation marks, a best-card highlight             | None                                                                                             | Left out: §8 here, `packs-page.md` §3.4 step 6                                                                                                |
| "Open another", "back to the packs", "see the collection"   | `Open pack` and `Back to packs` on `/packs/open` (owner, 2026-10-30); `Collection` in the header | Adapted: "another" is a banned word                                                                                                           |
| "Don't reload, your pack is kept"                           | No warning: the `requestId` retry and §3.13 step 3 make a reload safe                            | Adapted: the cards are in the collection either way                                                                                           |
| Guests open on the members' opening page, up to a limit     | The demo opens on a public `/demo` page (§3.14)                                                  | Taken (owner, 2026-10-30); the limit stays 10 per page load, out of sight                                                                     |
