# Economy UI: wallet, Shop page, Recycle for Karma (item 2, PR 2) (#51)

- **Date:** 2026-10-30
- **Tier:** T3 (the browser drives Karma-changing actions and their idempotency keys)
- **Verdict:** PASS WITH FINDINGS (none blocking). Reviewed after the merge, at head 9fbe361 (merged as 65afb0a). The two nits are fixed in the follow-up PR that carries this file.
- **Owner informed:** through the PR's sign-offs

## Change

Economy PR 2, web only (`docs/design/market-and-shop.md` §3.1–§3.3 and §3.8; `docs/design/collection-overview.md` §3.6 item 10; `economy.md` §11, §12; `packs-page.md` §3.3). No api, shared, dependency, CI or CSP change.

- **Header balance:**
  - `GET /api/wallet` is read at sign-in and each time Shop or Collection is shown, and never polled.
  - The header shows the newest server balance, plain text, and nothing before the first answer.
  - Wallet reads are numbered when sent; a receipt's or an `insufficient_funds` balance is numbered when it arrives (`heldBalance`, `web/src/lib/game.ts`).
  - A wallet 200 clears only the unreachable banner.
  - The wallet and shop queries are removed on every owner change.
- **`/shop`:**
  - An account page (guard to `/login` with the return path) over `GET /api/shop`.
  - `Buy…` opens a native modal confirmation that sends one `POST /api/shop/buy` with `{ requestId, themeId }` only.
  - The reveal shows the server's pack.
  - The 429 wait lives on the page and survives Cancel.
- **Recycle for Karma, in the card dialog:**
  - The count runs from 1 to `min(recyclable, maxRecycleCount)`, both from the server.
  - The confirmation sends one `POST /api/collection/recycle` with `{ requestId, characterId, rarity, count }` only.
  - The preview total is `count ×` the wallet's published value, and the receipt's `credited` and `balance` replace it.
- **Keys (`useKeyedAction`):**
  - Made with `crypto.randomUUID()`, kept only on no answer and on a 429, and discarded on every other answer, on Cancel, on close and on unmount.
  - Single-flight plus the pack button's `detail > 1` and held-Enter guards.
  - Nothing closes a confirmation while its request is in flight: a `close` event then re-opens the modal.
- **Never:** no client storage, no query string or hash, no HTML sink.

## Review notes

- **Dependencies:** none changed. `npm run audit` finds 0 high (the 4 pre-existing dev-only `drizzle-kit` moderates), and `npm audit signatures` reports 488 verified, 166 attestations.
- **CI and unit tests:** CI on 9fbe361 passed quality, api-tests, e2e, docker, security and CodeQL. The web unit tests ran 733 tests at 98.48 % statements.
- **`web/e2e/economy.hunt.spec.ts`:** 29 hunt tests and 4 regressions.
  - Double spend from the UI: double click, held Enter, two devices, a buy racing a recycle, leaving the Shop in flight.
  - The requestId lifecycle.
  - The header balance as an ordered sequence of server answers.
  - A 401 on a buy and on a recycle.
  - Hostile theme titles and character names.
  - The copy rules, and 320 px.
- **Bug fixes proven:** the 4 regression tests and 8 unit tests fail on the pre-fix code (ab24330).

## Findings

1. **Info:** two receipts in one tab are ordered by when they arrive, not by their ledger order. So after a buy left in flight and a later recycle, the header can show the older balance until the next wallet read. Display only; the server holds the balance. Open item.
2. **Info:** after a lost answer, Cancel, Close or leaving the page discards the key, so a fresh confirmation can buy or recycle again. This is spec'd, and bounded by the server: every debit has its pack, and a recycle never takes the last copy. Accepted.
3. **Info:** `ShopPage.tsx` passed the raw theme title as the reveal's `label`, which would become an `aria-label` if the heading were ever null. Not reachable. Fixed in the follow-up PR with `isolate(theme.title)`.
4. **Info:** `Buy…` is disabled when the held balance is below the price. This is a display check only; the server checks again. Accepted.

## Register edits

- **Threat model, append:** From #51 the browser drives the Karma actions: it sends only `{ requestId, themeId }` to buy and `{ requestId, characterId, rarity, count }` to recycle, holds each key in memory for one confirmation, never in storage or the address, and shows only balances the server sent, so editing the client changes what is displayed, never what is held (C1, C11, C20).
- **C1, append:** #51: the web shop and recycle requests carry no amount, price, balance or card id; the header balance is the newest server answer (`heldBalance`) with no arithmetic; the one client sum is the recycle confirmation's preview (`count ×` the wallet's published value), which the receipt's `credited` and `balance` replace.
- **C3, append:** #51 adds no route; `/shop` is an account page in the route list (guard to `/login` with the return path).
- **C9, append:** #51: theme titles render as text in a `dir="auto"` `h2`, in a `<bdi>` in the confirmation and reveal headings, and isolated with U+2068/U+2069 in the live-region purchase line and the reveal label; character names sit in a `<bdi>` in the recycle heading and receipt line; proven by `economy.hunt.spec.ts` and `economyCopy.test.ts`.
- **C11, append:** #51 (web): the client never sends or computes a balance; `ApiError.balance` is accepted only as a safe integer of at least 0; a receipt's or `insufficient_funds` balance is numbered when it arrives and a wallet read when it is sent, so a read in flight cannot step the header back.
- **C20, append:** #51 (web): shop purchases and recycles follow 1c's key rule (`useKeyedAction`); a changed recycle count is always a new key; single-flight plus the `detail > 1` and held-Enter guards; nothing closes a confirmation in flight.
- **Open item, add:** Header ordering (#51, info): two receipts in one tab are ordered by arrival, so a buy left in flight and a later recycle can leave the older balance in the header until the next wallet read; publish the ledger `seq` in `ShopReceipt`, `RecycleReceipt` and `Wallet` and order the header by it.
- **Roadmap:** row 2's UI part shipped (#51); the market (PR 3, PR 4) remains.
