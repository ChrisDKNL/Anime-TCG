# Collection and packs (Sprint 1c, server side)

Manager-written technical spec (non-UI). Moves the character pool, pack grants, pack openings, rarity rolls and the collection from the browser to the API, on the 1b accounts (`accounts-api.md`), as ADR 0008 §1–2 requires. §8 is the web change: it lists what the UI needs back and leaves the visual design to `ui-designer`. Security tier **T3** (pack grants and openings, RNG; the web PR also changes the CSP). `security-officer` review and an adversarial test pass are required before each PR opens; a T3 change never merges on the day it is opened unless the owner says so.

Written 2026-10-29.

## 1. Goal

A signed-in player opens packs that the server grants: one accrues every interval and a few can be stored. The server, not the browser, picks the characters, rolls the rarities, records the opening and adds the cards to the account's collection. The web app shows the pack control, the reveal and the collection from the server's answers and holds nothing authoritative. At the end of 1c the game is playable end to end again, and Sprint 1 (1a, 1b, 1c) can be released (`docs/03-release-process.md`).

## 2. Out of scope

- Currency, the ledger, sell and recycle (roadmap item 2, `economy.md`). In 1c a card has no currency value; these tables are what item 2 builds on.
- Packs won as game prizes (items 5, 6). They will be a separate counter consumed by the same opening path (`economy.md` §7.6); the allowance here does not change for them.
- Collection overview: sort, search, completion stats (item 3). The existing rarity filter stays a client-side view of the server's list.
- Profile and its next-pack timer (item 4). In 1c the countdown lives on the pack control.
- Collection download (item 9).
- An image proxy (§5.1).
- The visual design of the pack control, countdown, reveal and collection states (`ui-designer`, §8).

## 3. Delivery

Two pull requests, in order, each through the full gate:

1. **`feat/collection-packs`** (this spec, everything except §8): the migration; `api/src/domain/pool/` (AniList client, validation, refresh), `api/src/domain/packs/` (allowance, roll, opening) and `api/src/domain/collection/`; a `packs` plugin that owns the refresh check, a sibling of the accounts plugin's purge; routes under `api/src/routes/packs/` and `api/src/routes/collection/` with `PACK_RATE_LIMIT` in `routes/limits.ts`; the owner command; shared schemas and constants; tests; docs. The web app is left as it is (browser pool, client roll, in-memory collection), so `main` stays playable between the two merges; the float constants it imports stay until PR 2 (§5.4).
2. **`feat/collection-packs-ui`** (§8): the web app becomes a client of these routes, the browser's AniList, roll and pool code are deleted, and the CSP narrows.

Sprint 1 is released after PR 2 merges.

## 4. Data model

### 4.1 Tables

```
characters                                     -- the pool cache; a row is never deleted (cards reference it)
  id                  integer pk               -- AniList character id
  name                text not null            -- name.full as AniList sends it, trimmed; rendered as text
  image_url           text not null            -- an https URL on IMAGE_HOST (§5.1)
  anime_title         text not null            -- English, else romaji, else "Unknown anime"
  anime_title_native  text null
  favourites          integer not null         -- the popularity input
  odds_rare           integer not null         -- out of ODDS_SCALE, set at each refresh (§5.4)
  odds_legendary      integer not null
  in_pool             boolean not null         -- false once a refresh no longer returns it
  refreshed_at        timestamptz not null     -- the last refresh that returned it

pack_openings
  id                  uuid pk default gen_random_uuid()
  account_id          uuid not null references accounts(id) on delete cascade
  request_id          uuid not null            -- the client's idempotency key
  opened_at           timestamptz not null
  unique (account_id, request_id)

cards                                          -- one row per card; duplicates are separate rows
  id                  uuid pk default gen_random_uuid()   -- internal: never in a request or a response
  account_id          uuid not null references accounts(id) on delete cascade
  opening_id          uuid not null references pack_openings(id) on delete cascade
  slot                smallint not null        -- 0 .. PACK_SIZE - 1, the reveal order
  character_id        integer not null references characters(id)
  rarity              rarity not null          -- enum: common, rare, legendary
  odds_rare           integer not null         -- the odds this roll used, copied from the character row
  odds_legendary      integer not null
  is_new              boolean not null         -- the account held no card of this character before this opening
  pulled_at           timestamptz not null
  unique (opening_id, slot)
  index (account_id, character_id, rarity)

accounts (1b) gains
  packs_anchor_at     timestamptz null         -- the allowance clock (§5.2); null means full
```

Rules:

- **The account row is the lock.** Every path with stakes (opening here; sell, recycle and wagers later) starts with `SELECT ... FOR UPDATE` on the acting account's `accounts` row, so two requests of one account run one after the other and all of them share one lock order. The allowance lives on that row for the same reason: the row that is locked is the row that changes.
- **A card is a row**, duplicates included, never a counter. Each card names the opening it came from and the odds it was rolled with, so every pull can be audited afterwards, and item 2 can remove exactly one copy.
- **Characters are never deleted.** Cards reference them without cascade; a character that leaves the pool keeps rendering in every collection that holds it.
- **Card ids stay inside the server.** No request or response carries one; the API names cards by character and rarity (§5.5).
- Deleting an account removes its openings and cards (`on delete cascade`, as `accounts.md` promises: the account "and every card in it"). Character rows are shared reference data and stay.
- Migration: the next file in `api/src/db/migrations/` (`0003` at the time of writing). The app role gets its grants on the new tables from 0001's default privileges; `db-role.test.ts` gains an insert into `cards`.

### 4.2 Parameters

Every number this spec uses, in one place. The game numbers live in `shared/src/economy.ts` (new, exported as `@anime-tcg/shared/economy`; ADR 0004 wants them in one file, and item 2 adds its own there) and, for odds, in `shared/src/rarity.ts`. The pool numbers are politeness towards AniList and live with the pool code.

| Name                           | Value                                   | Meaning                                                                         |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------- |
| `PACK_SIZE`                    | 5                                       | cards per pack, all different characters                                        |
| `PACK_INTERVAL_MINUTES`        | 10                                      | one pack accrues per interval                                                   |
| `PACK_CAP`                     | 3                                       | packs stored at most; a new account starts with this many                       |
| `ODDS_SCALE`                   | 10 000                                  | odds are integers out of this                                                   |
| `BASE_ODDS`                    | common 7 000, rare 2 500, legendary 500 | the least popular character's odds                                              |
| `POPULARITY_BEND_MAX`          | 600                                     | added to both rare and legendary for the most popular character                 |
| `POOL_PAGES` × `POOL_PER_PAGE` | 2 × 50                                  | the pool: AniList's top characters by favourites (50 is AniList's page maximum) |
| `POOL_MIN_ACCEPTED`            | 50                                      | a refresh with fewer valid characters is discarded                              |
| `POOL_MAX_AGE`                 | 24 hours                                | a pool older than this is refreshed                                             |
| `POOL_CHECK_INTERVAL`          | 1 hour                                  | how often the age is checked (the session purge's cadence)                      |
| `ANILIST_TIMEOUT`              | 10 s                                    | per request                                                                     |
| `ANILIST_MAX_BODY`             | 2 MB                                    | per response; a page is tens of kilobytes                                       |
| `NAME_MAX`, `TITLE_MAX`        | 200, 300 characters                     | longer strings are rejected                                                     |
| `IMAGE_HOST`                   | `s4.anilist.co`                         | the one image host the CSP allows (C8)                                          |

## 5. Behaviour

### 5.1 The character pool

The server picks the cards, so the pool moves to the server and the browser stops calling AniList.

- **Source**: the query in `web/src/lib/anilist.ts` today (characters by `FAVOURITES_DESC`, each with its most popular anime), moved to `api/src/domain/pool/`: `POOL_PAGES` requests of `POOL_PER_PAGE`, one after the other, never in parallel.
- **Cache: Postgres, not memory.** The `characters` table is the cache. It survives a restart, so restarting the api costs AniList nothing; it is what cards reference; and with one api instance there is no second copy to keep in step. An opening reads the in-pool rows, about a hundred, from Postgres.
- **Refresh policy**: a refresh runs when the pool is empty or its newest `refreshed_at` is older than `POOL_MAX_AGE`. The api checks once after `listen` (start-up never waits on AniList) and then every `POOL_CHECK_INTERVAL`. No request path calls AniList. Steady state is `POOL_PAGES` requests a day; the worst case (AniList failing every check, or a pool that is still empty) is `POOL_PAGES` an hour, far below AniList's 30 a minute. Nothing retries within a check; a 429 ends the refresh, and the next attempt waits at least the `Retry-After` it carried. This is fewer AniList requests than today, where every browser fetched the same pages every 24 hours.
- **Validation**: AniList's answer is untrusted input. It is read through a TypeBox schema of the declared fields only, and a character is accepted when: `id` is an integer ≥ 1 not seen earlier in the same refresh; `name.full`, trimmed, is 1 to `NAME_MAX` characters; `image.large` parses with `URL`, has protocol `https:`, hostname exactly `IMAGE_HOST`, no userinfo and no port; the title (English, else romaji, else `Unknown anime`) and the native title are at most `TITLE_MAX`; `favourites` is an integer ≥ 0 (null counts as 0); no string contains NUL (Postgres `text` cannot hold it). Anything else is skipped and counted. Accepted strings are stored as sent apart from the trim: no HTML decoding, no stripping; the web renders them as text (C9).
- **All or nothing**: a refresh that fails in any way (network error, `ANILIST_TIMEOUT`, a body over `ANILIST_MAX_BODY`, HTTP status ≥ 400, invalid JSON, a GraphQL `errors` array) or accepts fewer than `POOL_MIN_ACCEPTED` characters changes nothing and logs one warning. A successful one applies in one transaction: upsert every accepted character with `in_pool = true`, its new odds (§5.4) and `refreshed_at`, then set `in_pool = false` on every other row.
- **AniList down**: the stored pool keeps serving, however old. Names and images rarely change, and the odds were fixed at the last refresh. Only a fresh install that has never reached AniList has no pool: `GET /api/packs` then answers `odds: null`, an opening answers 503 `pool_unavailable`, and the allowance keeps accruing up to the cap. The owner can load a saved response by hand (§7). `/healthz` does not look at AniList: a third-party outage is not a reason for compose to restart the api.
- **Images**: the browser keeps loading card images from AniList's CDN, as today. The api does not proxy them: a proxy would make the NAS an image server and add an endpoint that fetches by URL. `IMAGE_HOST` is the one host the live CSP allows in `img-src` (C8); ADR 0008 §5's `*.anilist.co` is the ceiling and the CSP is the rule. A unit test reads the `Caddyfile` and fails if `img-src` and `IMAGE_HOST` disagree.
- **Network**: this is the first outbound call the api makes. The endpoint is a constant, and no request input reaches the URL or the query variables. The api reaches the internet through its `front` network, which is not internal; `back` stays internal; compose needs no network change.
- **Off switch for tests**: `POOL_AUTO_REFRESH` (`true` or `false`, default `true`, anything else fails start-up by name; compose passes it through). It is `false` in route tests and in every CI job, the `docker` job's acceptance stack included, so no test or CI run calls AniList; the CI stack and the e2e suite load a fixture through §7. The refresh code is tested against a local `node:http` server on `127.0.0.1:0` that the AniList client is constructed with, rather than undici's `MockAgent`: no new dev dependency, and the test goes through the real socket path, where the timeout and the body cap live.

### 5.2 Pack allowance

**1c ships the allowance; item 2 does not.** Roadmap item 2 lists the pack timer under the economy, but an opening endpoint without an allowance is an unlimited mint, and from the day item 2 lets cards be sold, an unlimited mint of currency. The allowance needs nothing from the economy (no currency, no ledger); it is pack-grant logic, which is exactly what this T3 review covers; and `economy.md` builds on it unchanged. Currency, the ledger, sell and recycle stay in item 2. The manager updates the roadmap row.

The allowance is one timestamp per account, `packs_anchor_at`, read and written only under the account lock. With `I` = `PACK_INTERVAL_MINUTES` and `C` = `PACK_CAP`:

```
anchor            = packs_anchor_at, or now − C·I when it is null (full)
available         = clamp(floor((now − anchor) / I), 0, C)
nextPackInSeconds = null when available = C, else ceil((anchor + (available + 1)·I − now) in seconds), at least 1
on an opening:      packs_anchor_at ← max(anchor, now − C·I) + I
```

A full account that opens one pack has `C − 1` left and the next arrives one interval later; opening while the timer runs does not restart it; an account that was away for a week comes back to `C`, not hundreds.

- **The server clock decides.** The client sends no time and none is read (no field, no `Date` header). A server clock set back delays packs by as much as it was set back; one set forward grants at most `C`. Neither mints more than the cap.
- **New accounts start full** (`null`). The first visit is when a player wants to open something; an empty start would make the first card a wait of one interval. Existing accounts get the same: the column is added as `null`.
- `nextPackInSeconds` is relative and rounded up, so a countdown that reaches zero on the client finds the pack there, and the client's own clock never has to be right (§8).

### 5.3 Opening a pack

One transaction, in this order:

1. Lock the account row (`SELECT packs_anchor_at ... FOR UPDATE`). No row → 401 `unauthenticated`, as in 1b.
2. If the account already has an opening with this `requestId`, answer 200 with that opening's cards, slots and `isNew` exactly as stored, and the current allowance. Nothing is written.
3. If `available` is 0, answer 409 `no_pack_available` with `retryAfterSeconds` = `nextPackInSeconds`.
4. Read the in-pool characters. Fewer than `PACK_SIZE` → 503 `pool_unavailable`; the allowance is untouched.
5. Pick `PACK_SIZE` different characters and roll each one's rarity (§5.4).
6. For each picked character, `isNew` = the account holds no card of that character yet.
7. Insert the `pack_openings` row and the cards (`slot` in pick order), move `packs_anchor_at`, commit, answer 201.

Because steps 2–7 run under the lock, requests of one account serialise: with one pack available, two parallel openings give one 201 and one 409; two parallel requests with the same `requestId` give one 201 and one 200 with the same cards. `unique (account_id, request_id)` is the backstop: if the lock were ever bypassed, the second insert fails its transaction (a 500) and nothing is opened twice. A request that ends in 409 or 503 leaves no record, so its key can succeed later. Keys are scoped to the account: account B sending A's `requestId` finds nothing of A's and gets its own outcome.

### 5.4 RNG and odds

- **RNG**: `crypto.randomInt` only (C10), behind an injectable `Rng` (`(min, max) => integer`) so unit tests can script outcomes. `Math.random` already fails lint in `api/`.
- **Pick**: a partial Fisher–Yates shuffle over the in-pool rows ordered by `id`, `PACK_SIZE` draws of `randomInt(i, n)`: every character equally likely, no repeats within a pack.
- **Roll**: `r = randomInt(0, ODDS_SCALE)`; legendary when `r < odds_legendary`, rare when `r < odds_legendary + odds_rare`, otherwise common. Integers throughout, so the odds are exact; no float is involved at roll time.
- **Odds per character**: today's popularity tilt, moved to the refresh and made integer. `p` is the character's log-scaled favourites relative to the pool (0 for the least popular, 1 for the most, 0.5 for everyone when all are equal), as `popularityScore` in `web/src/lib/rarity.ts` computes it today; `bend = round(POPULARITY_BEND_MAX × p)`; `odds_legendary = BASE_ODDS.legendary + bend`, `odds_rare = BASE_ODDS.rare + bend`, and common is the remainder. These are today's numbers (`POPULARITY_INFLUENCE` × 10 % is `POPULARITY_BEND_MAX`), now integers; floats appear once, at refresh, to produce them. Each card stores the odds it was rolled with, so production openings can be checked against the odds actually applied without trusting the code (the computation of §9's statistical test).
- **One source of truth**: `shared/src/rarity.ts` becomes integer (`ODDS_SCALE`, `BASE_ODDS`, `POPULARITY_BEND_MAX`; `RARITIES` and `RARITY_LABEL` unchanged). The float `BASE_WEIGHTS` and `POPULARITY_INFLUENCE` stay until PR 2 deletes their last users, pinned to the integer constants by a test meanwhile. The UI shows the odds the server returns, never constants of its own: the `web/` block of the ESLint config forbids importing the number constants from `@anime-tcg/shared/rarity` and anything from `@anime-tcg/shared/economy` (`no-restricted-imports` with `importNames`).
- **Published odds** (`GET /api/packs`): `base` (`BASE_ODDS`), `highest` (the most popular in-pool character's odds) and `average` (the mean over the in-pool characters, rare and legendary rounded to whole units of `ODDS_SCALE`, common the remainder). Characters are drawn uniformly, so `average` is the chance that a card in the next pack has each rarity: the honest headline figure, and the one the economy's model refers to (`economy.md` §8).

### 5.5 Collection

- The collection is the account's `cards` rows. `GET /api/collection` answers them grouped by (character, rarity) with a copy count and totals. That is the shape the UI already shows (one tile per character and rarity, `×N`), and it bounds the response by the number of groups (at most three per character ever pooled, about 300 today) rather than by the number of cards. No pagination in 1c.
- Order: legendary first, then by name, then by character id. Stable for tests; the UI may re-sort.
- `AccountPublic.cards`, 0 since 1b (`CARDS_UNTIL_1C`), becomes the account's card count, so the Manage dialog and the delete confirmation show real numbers.
- Cards are named by (character, rarity), never by id. There is no card id for a client to send or tamper with, which is the 1b pattern (C3: what cannot be named cannot be taken). Item 2's sell and recycle use the same naming.
- **No reset.** The proof of concept's `Reset` (delete every card) goes. On the server the collection is the account's record: deleting it has no gameplay purpose, and from item 2 on every card has a sale value that a reset would destroy with no undo. Starting over is deleting the account. The `Reset` mention in `accounts.md` §3.6 and its §8 copy row are superseded; `ui-designer` updates them in PR 2.
- **No migration** (ADR 0008 §7). The server starts empty; the in-memory collection (`useInventory`) is dropped at the switch. The old browser keys `anime-tcg:inventory:v1` and `anime-tcg:character-pool:v1` are neither read nor deleted.

### 5.6 Authorisation

Every route calls `requireAccount(req)` (401 `unauthenticated`) and passes the session's account id into the domain function. No account id, card id or opening id appears in any path or body; a `requestId` is looked up only among the acting account's openings.

### 5.7 Logging

At `info`, with the request id: pack opened (account id, opening id, count per rarity, whether it was a replay); pool refreshed (accepted, skipped, duration). At `warn`: refresh failed (the reason class: status, timeout, size, invalid answer, below minimum) and, for skipped characters, the first rejected field path. Never an AniList response body.

## 6. Contract (`shared/src/api.ts`, `shared/src/errors.ts`)

### 6.1 Error codes

New: `no_pack_available` (409) and `pool_unavailable` (503). `no_pack_available` carries `retryAfterSeconds` (the seconds until the next pack) and the `Retry-After` header, the same pair `too_many_failures` uses; the field's comment in `errors.ts` widens to both codes.

### 6.2 Schemas

```
Rarity              "common" | "rare" | "legendary"                  -- from RARITIES
PerRarity           { common: integer ≥ 0, rare: integer ≥ 0, legendary: integer ≥ 0 }
PublishedOdds       { scale: integer, base: PerRarity, average: PerRarity, highest: PerRarity }   -- each table sums to scale
PackAllowance       { available: integer 0..cap, cap: integer, intervalSeconds: integer, nextPackInSeconds: integer ≥ 1 | null }
PacksResponse       { allowance: PackAllowance, odds: PublishedOdds | null }                       -- null while the pool is empty
CharacterPublic     { id: integer ≥ 1, name: string, imageUrl: string, animeTitle: string, animeTitleNative: string | null }
OpenPackBody        { requestId: uuid string }
OpenedCard          { slot: integer 0..PACK_SIZE − 1, character: CharacterPublic, rarity: Rarity, isNew: boolean }
PackOpened          { openingId: uuid, openedAt: date-time, cards: OpenedCard[PACK_SIZE], allowance: PackAllowance }
CollectionGroup     { character: CharacterPublic, rarity: Rarity, copies: integer ≥ 1 }
CollectionResponse  { total: integer, unique: integer, byRarity: PerRarity, groups: CollectionGroup[] }
```

`unique` counts characters regardless of rarity, as the UI's "unique" does today. Every object is `additionalProperties: false`; the 1b schema guard catches a miss.

### 6.3 Routes

| Method, path           | Body           | Success                                                  | Errors (status, code)                                                                          | Limit  |
| ---------------------- | -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| `GET /api/packs`       | —              | 200 `PacksResponse`                                      | 401 `unauthenticated`                                                                          | global |
| `POST /api/packs/open` | `OpenPackBody` | 201 `PackOpened`; 200 `PackOpened` on a replay           | 401 `unauthenticated`, 409 `no_pack_available` (+ `retryAfterSeconds`), 503 `pool_unavailable` | 20/min |
| `GET /api/collection`  | —              | 200 `CollectionResponse`                                 | 401 `unauthenticated`                                                                          | global |
| `GET /api/session`     | —              | unchanged, except that `account.cards` is the card count | —                                                                                              | global |

GET routes take `NoQuery`. The POST is behind the 1a CSRF check, and its override (`PACK_RATE_LIMIT`, per client address) replaces the global bucket for that route. The allowance is the real limit on openings; the override bounds lock contention from a script and leaves room for a full allowance, retries and a second tab. Response schemas list every status above plus 400 `validation_failed`, 403 `bad_origin` and 429 `rate_limited` on the POST, so the serialiser strips anything undeclared: no card id and no `odds_*` column can leak.

The UI maps `no_pack_available` → the waiting state, counting down from `retryAfterSeconds`; `pool_unavailable` → the cards-unavailable state; `unauthenticated` → session ended (`accounts.md` §4.8); `validation_failed` → a client bug, shown as the generic failure; a network failure → the unreachable banner.

## 7. Owner-side command

`api/src/cli/refresh-pool.ts`, run inside the api container:

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/refresh-pool.js
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/refresh-pool.js --stdin < pool.json
```

Without arguments it refreshes from AniList now, whatever the pool's age. With `--stdin` it reads a JSON array of AniList response bodies, one per page, exactly as the GraphQL endpoint returns them, and applies them through the same validation and the same all-or-nothing rule. The CI stack and the e2e suite seed their pool this way (from the fixture builder in `web/src/test/fixtures.ts`), and the owner can use a saved response when AniList is down on a fresh install. Prints one line: `Pool refreshed: 100 characters, 0 skipped.` Exit 1 with a one-line reason otherwise. Uses `DATABASE_URL`. Unit-tested through its exported function; documented in `docs/04-deployment.md` under "Operations".

## 8. The web change (second PR)

`feat/collection-packs-ui` makes the web app a client of §6. `ui-designer` specifies the new states first (the pack control ready with a count, waiting with a countdown, opening, and cards unavailable; the odds line; the collection without `Reset`). This section fixes only what the UI needs back and what it may not do.

**Deleted**: `web/src/lib/anilist.ts`, `web/src/hooks/useCharacterPool.ts`, `web/src/lib/pack.ts`, the roll functions in `web/src/lib/rarity.ts`, `useInventory`'s in-memory store, the browser `Character` and `Card` types (replaced by the shared schemas), `Reset`, the float constants in `shared/src/rarity.ts`, and the e2e routes that stub `graphql.anilist.co`.

**What the UI needs back**, and nothing more:

- From `GET /api/packs`: `available`, `cap`, `nextPackInSeconds`, `intervalSeconds`, and the published odds (`null` means cards are unavailable).
- From `POST /api/packs/open`: the cards in `slot` order, each with the character's name, image and titles, its rarity and `isNew`; the allowance after the opening.
- From `GET /api/collection`: the groups with their copies, and `total`, `unique` and `byRarity`.

**What the UI does with it**:

- The pack control is enabled when `available ≥ 1` and no opening is in flight. It shows the count and, below the cap, the countdown from `nextPackInSeconds`, counted from the moment the answer arrived. When the countdown ends the UI asks `GET /api/packs` once; it never polls on an interval. The countdown appears on the pack control only: no notification, sound, title change or "come back" prompt (ADR 0004 §6).
- Each click generates `requestId = crypto.randomUUID()`. If the request gets no answer (network failure), the UI keeps that id and sends it again on the next click, so a lost response shows the cards the server actually dealt instead of opening a second pack. Any answer from the server discards it.
- The reveal is the server's cards in `slot` order with `isNew`; the pull summary counts their rarities. The UI never computes an outcome.
- `Collection (N)` is `total` from `GET /api/collection`, fetched at sign-in and refetched after each opening. The Collection tab renders the groups; the rarity filter stays a view over them.
- The odds line shows the server's published odds, in `ui-designer`'s wording, instead of the constant base odds.
- The pool is no longer loaded at boot or while signed out (`App.tsx`), and the AniList error banner gives way to the cards-unavailable state.

**CSP**: the browser no longer talks to AniList's API, so `connect-src` becomes `'self'` alone; `img-src` keeps `https://s4.anilist.co`. The `Caddyfile`, the CI `docker` job's `EXPECTED_CSP` and `web/e2e/stack.spec.ts` change together. That makes PR 2 T3 as well (CSP/headers), on top of T1 for rendering third-party strings.

## 9. Tests required (minimum, T3)

**Unit** (`api/src/**/*.test.ts`, `shared/`):

- Allowance: a new account has `C`; opening from full leaves `C − 1` with `nextPackInSeconds` of one interval; `C` openings back to back leave 0; one interval later 1; a week later `C`; opening while the timer runs keeps the countdown; a clock set back an hour gives 0, never negative, and `nextPackInSeconds` ≥ 1; set forward a year gives `C`; a fraction of a second rounds up.
- Roll mapping, exhaustively: every `r` from 0 to `ODDS_SCALE − 1` through the tier function yields exactly the table's counts, for `BASE_ODDS` and for the highest table (`BASE_ODDS` plus `POPULARITY_BEND_MAX` on rare and legendary).
- Odds from favourites: least popular → `BASE_ODDS`; most popular → the full bend; all equal → half of it; always integers summing to `ODDS_SCALE`. The float constants equal the integer ones while both exist.
- Pick: a scripted RNG gives the expected characters; always `PACK_SIZE` different ones; a pool of exactly `PACK_SIZE` gives all of them; a smaller pool raises `pool_unavailable`.
- Published `average`: rounding keeps each table's sum at `ODDS_SCALE`.
- AniList validation: each rejection rule of §5.1 on its own, with a valid neighbour accepted; an id repeated across pages; `POOL_MIN_ACCEPTED − 1` valid characters → discarded; `IMAGE_HOST` equals the host in the `Caddyfile`'s `img-src`.
- Config: `POOL_AUTO_REFRESH` accepts `true` and `false` and rejects anything else by name.

**Statistical** (`api/src/domain/packs/roll.odds.test.ts`, in the unit project so it runs on every push): the domain roll with the real `crypto.randomInt`, over a fixture pool of 100 characters with spread favourites (so per-card odds differ), for 40 000 packs, which is 200 000 cards.

- Rarity: the expected count per rarity is the sum, over the dealt cards, of each card's stored odds divided by `ODDS_SCALE`. Pearson chi-square with 2 degrees of freedom at significance α = 0.001 (critical value 13.82). With odds that differ per card the test is slightly conservative. At this size, a shift of half a percentage point from common to legendary is caught with probability above 0.99 wherever the average odds lie between the base and the highest table.
- Characters: the count per character against an equal share for each, chi-square with 99 degrees of freedom at α = 0.001 (critical value 148.23); one character drawn 1.2 times as often as the others is caught with probability about 0.9. Deterministically on the same run: no pack repeats a character, and every pack has `PACK_SIZE` cards.
- A correct implementation fails either test about once in a thousand runs. A failure is a finding: the message prints the observed and expected counts, and nobody reruns it to green without reading them or changes the sample size or α to make it pass. The exhaustive mapping test is the deterministic half: it proves the tables, this one proves the wiring to the real RNG.

**Route** (`api/test/packs.test.ts`, `api/test/collection.test.ts`): every row of §6.3, the happy path and each declared error; an extra field → 400; a query string on a GET → 400; a missing Origin on the POST → 403; signed out → 401 on each route; a new account reads `C` available and a `base` equal to `BASE_ODDS`; an opening returns `PACK_SIZE` different characters in slots 0 to `PACK_SIZE − 1`, and the collection and `account.cards` reflect them; the opening after the last available pack → 409 with `retryAfterSeconds` of one interval (fake clock) and `Retry-After`; an empty pool → `odds: null`, an opening 503, the allowance unchanged; with a pool of exactly `PACK_SIZE` characters, the second opening has every `isNew` false; `average` equals the mean of the stored odds; deleting an account removes its cards and openings and leaves the characters; a character dropped by a refresh still renders in the collection and is never dealt again; the migration on a database with 1b accounts leaves them full.

**Concurrency** (route, parallel `inject()` calls): one pack and two different `requestId`s → one 201, one 409, `PACK_SIZE` cards in the table; `C` packs and `C + 1` parallel openings → `C` × 201 and one 409; one pack and the same `requestId` twice → one 201 and one 200 with the same `openingId` and cards, and `PACK_SIZE` cards in the table.

**Pool refresh** (`api/test/pool.test.ts`, against a local `node:http` server): a good answer fills the pool; then a 429, a 500, a stall past `ANILIST_TIMEOUT`, a body over `ANILIST_MAX_BODY`, invalid JSON, a GraphQL `errors` answer and too few valid characters each leave the pool exactly as it was; a 429's `Retry-After` defers the next attempt; with `POOL_AUTO_REFRESH=false` the server receives no request during a whole route suite.

**Adversarial** (`api/test/security/packs.security.test.ts`):

- Replay: the same `requestId` sequentially and in parallel → one opening, the allowance spent once; account B sending A's `requestId` → B's own outcome, never A's cards.
- Forged, flipped, truncated and expired session cookies → 401, nothing written.
- Tampered outcome payloads: a body with `cards`, `rarity`, `characterIds`, `slot`, `seed`, `odds`, `accountId` or `available` → 400 each, nothing written; a `requestId` that is not a uuid, is empty, or is 10 000 characters long → 400.
- Brute force against the limit: with packs available, the POST after `PACK_RATE_LIMIT` is used up within its window → 429 `rate_limited` with `Retry-After`.
- Clock: a `Date` header or a client time anywhere in the request changes nothing.
- Hostile pool content: names with `<script>`, an `<img onerror>`, an RTL override and zero-width characters are stored and returned byte for byte as text; a NUL in a name → that character skipped; image URLs `http://s4.anilist.co/…`, `https://s4.anilist.co.evil.example/…`, `https://user@s4.anilist.co/…`, `https://s4.anilist.co:8443/…`, `javascript:…` and `data:…` → each skipped.
- Dependency audit: nothing added (the PR states it; manifests change in scripts only).

**Web (PR 2)**: unit tests for the pack control's states, the countdown's single refetch and the `requestId` kept after a network failure; the T1 test that hostile character names render as text in the reveal and in the collection. e2e (`web/e2e`, against the compose stack with a pool seeded through §7): sign in, open `C` packs, and the next is disabled with a countdown; a reload keeps `Collection (N)`; `localStorage` holds no collection or pool key; the page makes no request to `graphql.anilist.co`; the CSP header is the narrowed one.

## 10. Acceptance criteria

1. All routes in §6.3 exist, are schema-validated, carry their limit, and pass the tests in §9; `api/src` coverage stays ≥ 85 %.
2. The browser holds no roll, no pool and no collection: the files listed in §8 are gone, `connect-src` is `'self'`, and e2e proves there is no request to AniList's API.
3. AniList is called only by the refresh check and by §7: `POOL_PAGES` requests per refresh, at most one refresh attempt per `POOL_CHECK_INTERVAL`, and no test or CI job calls it.
4. The statistical and exhaustive tests pass at the stated sizes and α.
5. `docs/05-security.md`: C1 live for collection and packs, the C6 pack override live, C8 narrowed, C10 live; a T3 row per PR; the threat model gains the api's first outbound call, AniList content as untrusted input, the allowance clock and replayed openings. `docs/04-deployment.md`: `POOL_AUTO_REFRESH`, the refresh command, and what a fresh install with AniList down looks like.
6. On the acceptance stack, a new account opens `C` packs and then waits for the countdown; two tabs together cannot open more than the allowance; a reload keeps the collection.

## 11. Open questions

For the owner, none blocking; each has the default this spec builds.

1. **Popularity tilt.** Keep it (as today: a card's legendary chance is 5 % to 11 % depending on the character's popularity) or flatten every card to the base odds? Recommendation: keep it for 1c, so moving the game to the server changes no odds; revisit at the economy rebalance, since the tilt raises the average sale value of a pack (`economy.md` §8).
2. **Reset.** Drop the collection `Reset` (§5.5) or keep it as a server action? Recommendation: drop it.
3. **Pool size.** Keep the top 100 characters (two AniList requests per refresh) or grow it for item 3's completion tracking? Recommendation: keep 100 until item 3 decides what completion means.

ADRs: none needs amending for 1c. ADR 0009 says `shared/` holds the constants "the UI displays"; they still live there, and the UI now displays the server's copy of them.
