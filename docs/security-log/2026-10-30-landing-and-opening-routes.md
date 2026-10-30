# Landing page redesign; packs open at /packs/open, /shop/open and /demo (#57)

- **Date:** 2026-10-30
- **Tier:** T1 (client routes and pages over existing endpoints; no api, schema, dependency, CSP or CI change)
- **Verdict:** PASS
- **Owner informed:** through the PR's sign-offs

## Change

The landing revision and the opening routes (`docs/design/navigation-and-landing.md` §3.7, §3.13, §3.14; `packs-page.md` §3.1, §3.7; `market-and-shop.md` §3.3 step 6). Web only: the diff is `web/src`, `web/e2e` and `docs/design`.

- **Routes:**
  - `/demo` is a public page; a signed-in visitor is replaced to `/packs`.
  - `/packs/open` and `/shop/open` are account pages under the guard, with no header link. Their guard and a session end write the section page (`/packs`, `/shop`) as the return path, and they are never a return path themselves.
- **`/packs/open`:**
  - `Open pack` on `/packs` sends `POST /api/packs/open` with `{ requestId }` and pushes `/packs/open` in the same task.
  - That page's own `Open pack` opens the next pack in place.
  - Any answer without cards replaces it with `/packs`, which shows that answer's row, and its line is read once.
  - No `GET /api/packs` is sent while an opening is in flight.
- **`/shop/open`:**
  - A purchase's answer holds its pack in the signed-in layout's memory, even when it lands after `/shop` was left (fix a423f6c).
  - When `/shop` still showed the confirmation, the purchase pushes `/shop/open`.
  - The page has no buy control.
- **`/demo`:**
  - `Open a demo pack` on `/` sends `POST /api/demo/open` and pushes `/demo`.
  - The visit's count, 429 wait, 503 and failure state, and the current cards live in the root layout's memory for the page load; a sign-in discards them.
  - The demo card plays no effects.
- **Landing:** a static, `aria-hidden` pack drawing; numbered steps; `Pack odds` as its own section with flat swatches.
- **Never:**
  - no client storage, no query string or hash, no HTML sink;
  - the opening pages read nothing from the address, so a load, a reload or a typed address replaces them with their section page and sends nothing.

## Review notes

- **Dependencies and headers:** none changed (no manifest, lockfile, `Caddyfile` or `index.html` change). `npm run audit` finds 0 high (the 4 pre-existing dev-only `drizzle-kit` moderates); `npm audit signatures` reports 488 verified, 166 attestations.
- **Keys:** the reducer keeps `key` on `noAnswer` and `rateLimited` and clears it on every other answer; the route change added only `keepReveal`, `landedShowing` and the replace. Proven by `opening-pages.hunt.spec.ts` (a lost answer on `/packs/open`'s own button, then a 429 on the retry: one `requestId`, two packs), `packs.hunt.spec.ts`, `game.test.ts` and `useGame.test.tsx`.
- **Double activation:** both `Open pack` buttons and both demo buttons have `openOnce`, `ignoreRepeat` and the single flight; a double click and a held Enter each send one `POST` and push at most once.
- **No GET in flight:** `opening-pages.hunt.spec.ts` counts no `GET /api/packs` across the push, Back, Forward, an in-place opening and `See your latest pack` during a flight.
- **`/demo`:** public; a signed-in visitor ends on `/packs`; a sign-in discards the visit; no storage keys, no query string or hash; requests only to the app's origin and `s4.anilist.co`.
- **Address:**
  - No `location.search`, `location.hash`, `URLSearchParams` or `useSearch` read anywhere in `web/src`.
  - `toReturnPath` still lists only `ACCOUNT_PAGES`, so `/packs/open`, `/shop/open` and `/demo` are rejected as forged return paths.
  - Unknown subpaths of the new routes are the not-found page.
- **AniList strings:** hostile names and titles render as text on `/packs/open`, `/shop/open` and `/demo`; the drawing, the odds table, the titles and the `h1`s carry no AniList string.
- **QC:** PASS at 05d80d9.
  - Web unit tests: 788, at 98.38 % statements.
  - e2e: 337 passed, 0 failed. The fresh-clone lint is clean, and CI is green.
  - The tester's bug (a purchase answered after `/shop` was left dropped its pack) is fixed in a423f6c; its regression fails on 79c9232 and passes at head.

## Findings

None.

## Register edits

- **C9, append to the status:**
  - #57 adds no HTML sink.
  - `/packs/open` and `/demo` render AniList names and series titles through the shared reveal card: `dir="auto"` elements, and U+2068/U+2069 in the card's `aria-label` and `title`s.
  - `/shop/open` keeps the theme title in a `<bdi>` in its `h2` reveal heading, isolated in the reveal label and the live-region purchase line.
  - Proven by `packs.hunt.spec.ts`, `economy.hunt.spec.ts` and `DemoPage.test.tsx`.
- **C19, append to the status:**
  - #57: the opening pages `/packs/open` and `/shop/open` are never a return path.
  - Their guard and a session end write their section page (`returnPathFor`).
  - `toReturnPath` still accepts only an `ACCOUNT_PAGES` key, so a forged `returnTo` of `/packs/open`, `/shop/open` or `/demo` lands on `/packs`.
  - Proven by `routes.test.ts` and `opening-pages.spec.ts`.
- **C20, append to the status:**
  - #57 (web): opening moves to `/packs/open` under 1c's key rule, unchanged.
  - The key is kept on no answer and on a 429, also when that answer replaces `/packs/open` with `/packs`, and discarded on every other answer.
  - Both `Open pack` buttons have the same single-flight, `detail > 1` and held-Enter guards.
  - No `GET /api/packs` is sent while an opening is in flight.
  - The opening pages read nothing from the address.
  - A shop purchase's answer holds its pack for `/shop/open` even after `/shop` was left.
  - Proven by `opening-pages.spec.ts`, `opening-pages.hunt.spec.ts`, `packs.hunt.spec.ts`, `economy.hunt.spec.ts` and `useGame.test.tsx`.
- **Threat model:** none.
- **New controls:** none.
- **Open items:** none added or closed.
- **Roadmap:** none (rows N and D stay shipped).
