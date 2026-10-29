# Collection and packs (Sprint 1c, server side)

Manager-written technical spec (non-UI). Moves the character pool, pack grants, pack openings, rarity rolls and the collection from the browser to the API, on the 1b accounts (`accounts-api.md`), as ADR 0008 §1–2 requires. The pool is an owner-managed snapshot of AniList and each character has one fixed rarity set by its popularity (ADR 0011 §4–5); the collection answer carries what the collection overview needs (`collection-overview.md` §3.8). §8 is the web change: it lists what the UI needs back and leaves the visual design to `ui-designer`. Security tier **T3** (pack grants and openings, RNG; the web PR also changes the CSP). `security-officer` review and an adversarial test pass are required before each PR opens; a T3 change never merges on the day it is opened unless the owner says so.

Written 2026-10-29; revised the same day for the owner's decisions (§11).

## 1. Goal

A signed-in player opens packs that the server grants: one accrues every interval and a few can be stored. The server, not the browser, rolls each slot's rarity tier, picks a character of that tier, records the opening and adds the cards to the account's collection. The characters come from a snapshot the owner takes of AniList: every MAIN and SUPPORTING character of the 100 most popular anime, each with one rarity fixed by its popularity rank. AniList is never called while the game runs, so nothing AniList changes reaches the live game until the owner takes a new snapshot. The collection answer carries the series, dates, totals and completion figures (whole pool and per series) the collection overview shows. At the end of 1c the game is playable end to end again, and Sprint 1 (1a, 1b, 1c) can be released (`docs/03-release-process.md`).

## 2. Out of scope

- Karma, the ledger, the player market, the pack shop and recycle (roadmap item 2, `economy.md`). In 1c a card has no Karma value; these tables are what item 2 builds on.
- Packs won as game prizes (items 5, 6). They will be a separate counter consumed by the same opening path (`economy.md` §8.11); the allowance here does not change for them.
- The collection overview's screen (item 3, `collection-overview.md`). 1c serves the data it needs (§5.5); search, filters, sort and pages are the browser's.
- Profile and its next-pack timer (item 4). In 1c the countdown lives on the pack control.
- Collection download (item 9).
- An image proxy (§5.1.8).
- Any live or scheduled AniList refresh. The earlier design (refresh every 24 hours, checked hourly) is dropped (§11, decision 8).
- The visual design of the pack control, countdown, reveal and collection states (`ui-designer`, §8), except that the reveal's glowing frames go (§8, decision 9).

## 3. Delivery

Two pull requests, in order, each through the full gate:

1. **`feat/collection-packs`** (this spec, everything except §8): the migration; `api/src/domain/pool/` (AniList client, validation, tiering, snapshot build), `api/src/domain/packs/` (allowance, roll, opening) and `api/src/domain/collection/` (entries, totals, completion, reset); routes under `api/src/routes/packs/` and `api/src/routes/collection/` with `PACK_RATE_LIMIT` in `routes/limits.ts`; the owner commands `snapshot-pool` and `reset-collection` (§7); shared schemas and constants; tests; docs. The api server gains no background job for the pool: nothing about it runs on a timer. The web app is left as it is (browser pool, client roll, in-memory collection), so `main` stays playable between the two merges; the float constants it imports stay until PR 2 (§5.4).
2. **`feat/collection-packs-ui`** (§8): the web app becomes a client of these routes, the browser's AniList, roll and pool code are deleted, the CSP narrows, and the reveal's glowing rarity frames are replaced by `collection-overview.md` §6.1's borders.

Sprint 1 is released after PR 2 merges.

## 4. Data model

### 4.1 Tables

```
pool_snapshots                                 -- one row per snapshot; never deleted (cards name the one that granted them)
  id                  integer pk generated always as identity   -- the version: 1, 2, 3 ...
  source              text not null            -- 'anilist' or 'file' (§7.1)
  taken_at            timestamptz not null     -- when the fetch began: AniList's state at that moment
  activated_at        timestamptz not null
  is_current          boolean not null         -- unique index on (is_current) where is_current: at most one
  series_count        integer not null
  character_count     integer not null
  tier_counts         integer[3] not null      -- common, rare, legendary

series                                         -- latest display data of every anime ever in a snapshot; never deleted
  id                  integer pk               -- AniList media id
  title               text not null            -- English, else romaji
  title_native        text null
  start_year          smallint null

characters                                     -- latest display data of every character ever in a snapshot; never deleted
  id                  integer pk               -- AniList character id
  name                text not null            -- name.full, trimmed; rendered as text
  name_native         text null
  image_url           text not null            -- an https URL on IMAGE_HOST (§5.1.8)

pool_snapshot_series                           -- the 100 anime of a snapshot
  snapshot_id         integer not null references pool_snapshots(id)
  series_id           integer not null references series(id)
  popularity_rank     smallint not null        -- 1 .. SNAPSHOT_SERIES, AniList's POPULARITY_DESC order
  popularity          integer not null
  genres              text[] not null          -- AniList's genres; economy.md's themed packs read them
  primary key (snapshot_id, series_id)

pool_snapshot_characters                       -- the pool of a snapshot, one row per character
  snapshot_id         integer not null references pool_snapshots(id)
  character_id        integer not null references characters(id)
  favourites          integer not null
  favourites_rank     integer not null         -- 1 = most favourited in this snapshot (§5.1.3)
  tier                rarity not null          -- enum: common, rare, legendary; fixed for this snapshot
  primary_series_id   integer not null references series(id)
  primary key (snapshot_id, character_id)
  index (snapshot_id, tier, character_id)

pool_snapshot_memberships                      -- the snapshot's anime a character is MAIN or SUPPORTING in
  snapshot_id         integer not null
  character_id        integer not null
  series_id           integer not null
  role                character_role not null  -- enum: main, supporting
  primary key (snapshot_id, character_id, series_id)
  foreign key (snapshot_id, character_id) references pool_snapshot_characters
  foreign key (snapshot_id, series_id) references pool_snapshot_series

pool_fetches                                   -- staging for a resumable fetch (§5.1.4)
  id                  integer pk generated always as identity
  started_at          timestamptz not null

pool_fetch_pages
  fetch_id            integer not null references pool_fetches(id) on delete cascade
  kind                text not null            -- 'series' or 'characters'
  series_id           integer not null         -- 0 for the series pages
  page                smallint not null
  body                jsonb not null           -- the declared fields of AniList's answer, after the schema parse
  fetched_at          timestamptz not null
  primary key (fetch_id, kind, series_id, page)

pack_openings
  id                  uuid pk default gen_random_uuid()
  account_id          uuid not null references accounts(id) on delete cascade
  request_id          uuid not null            -- the client's idempotency key
  snapshot_id         integer not null references pool_snapshots(id)
  opened_at           timestamptz not null
  unique (account_id, request_id)

cards                                          -- one row per card; duplicates are separate rows
  id                  uuid pk default gen_random_uuid()   -- internal: never in a request or a response
  account_id          uuid not null references accounts(id) on delete cascade
  opening_id          uuid not null references pack_openings(id) on delete cascade
  slot                smallint not null        -- 0 .. PACK_SIZE - 1, the reveal order
  character_id        integer not null references characters(id)
  rarity              rarity not null          -- the tier the card was granted with; never changes
  snapshot_id         integer not null references pool_snapshots(id)   -- the snapshot that granted it
  is_new              boolean not null         -- the account held no card of this character before this opening
  pulled_at           timestamptz not null
  unique (opening_id, slot)
  index (account_id, character_id, rarity)

accounts (1b) gains
  packs_anchor_at     timestamptz null         -- the allowance clock (§5.2); null means full
```

Rules:

- **The account row is the lock.** Every path with stakes (opening and reset here; listing, buying, the shop and recycle later) starts with `SELECT ... FOR UPDATE` on the acting account's `accounts` row, so two requests of one account run one after the other and all of them share one lock order. The allowance lives on that row for the same reason: the row that is locked is the row that changes.
- **A card is a row**, duplicates included, never a counter. Each card names the opening it came from and the snapshot that granted it, so every pull can be audited against the tier table that was in force, and item 2 can move or remove exactly one copy.
- **A card's rarity is frozen.** `cards.rarity` is copied from the snapshot's tier at the moment of the grant, and no snapshot update writes it (§5.1.7).
- **Snapshots, characters and series are never deleted.** Cards reference them without cascade; a character that leaves the pool keeps rendering in every collection that holds it.
- **Card ids stay inside the server.** No request or response carries one; the API names a collection entry by character and rarity (§5.5).
- Deleting an account removes its openings and cards (`on delete cascade`, as `accounts.md` promises: the account "and every card in it"). Snapshot, character and series rows are shared reference data and stay.
- The staging tables hold only what the schema parse of §5.1.5 kept, never a whole AniList body, and are emptied when a snapshot is built from them or a fetch is restarted.
- Migration: the next file in `api/src/db/migrations/` (`0003` at the time of writing). The app role gets its grants on the new tables from 0001's default privileges; `db-role.test.ts` gains an insert into `cards`.

### 4.2 Parameters

Every number this spec uses, in one place. The game numbers live in `shared/src/economy.ts` (new, exported as `@anime-tcg/shared/economy`; ADR 0004 wants them in one file, and item 2 adds its own there) and, for tiers and odds, in `shared/src/rarity.ts`. The AniList numbers are politeness towards AniList and live with the pool code.

| Name                          | Value                                     | Meaning                                                                          |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| `PACK_SIZE`                   | 5                                         | cards per pack, all different characters                                         |
| `PACK_INTERVAL_MINUTES`       | 10                                        | one pack accrues per interval                                                    |
| `PACK_CAP`                    | 3                                         | packs stored at most; a new account starts with this many                        |
| `ODDS_SCALE`                  | 10 000                                    | odds and shares are integers out of this                                         |
| `SLOT_ODDS`                   | common 6 700, rare 2 650, legendary 650   | the tier each slot rolls (§5.4)                                                  |
| `TIER_SHARE`                  | legendary 1 000, rare 3 000 (common rest) | the share of the snapshot's characters in each tier, by favourites rank (§5.1.3) |
| `SNAPSHOT_SERIES`             | 100                                       | anime in a snapshot: AniList's top by `POPULARITY_DESC`                          |
| `SNAPSHOT_SERIES_MIN`         | 90                                        | a snapshot with fewer valid anime is refused                                     |
| `SNAPSHOT_CHARACTERS_MIN`     | 500                                       | a snapshot with fewer valid characters is refused                                |
| `SNAPSHOT_CHARACTERS_MAX`     | 6 000                                     | a snapshot with more is refused (bounds every response of §6)                    |
| `SNAPSHOT_FILE_MAX`           | 64 MB                                     | the largest `--stdin` file                                                       |
| `ANILIST_SERIES_PER_PAGE`     | 50                                        | AniList's page maximum                                                           |
| `ANILIST_CHARACTERS_PER_PAGE` | 25                                        | per role connection, per request (§5.1.4)                                        |
| `ANILIST_REQUEST_GAP`         | 2.5 s                                     | at most 24 requests a minute, below AniList's degraded 30                        |
| `ANILIST_MAX_REQUESTS`        | 1 000                                     | a fetch that would need more stops and is refused                                |
| `ANILIST_MAX_RETRIES`         | 5                                         | consecutive failures of one request before the fetch pauses (resumable)          |
| `ANILIST_DEFAULT_RETRY_AFTER` | 60 s                                      | the wait after a 429 without `Retry-After`                                       |
| `ANILIST_TIMEOUT`             | 10 s                                      | per request                                                                      |
| `ANILIST_MAX_BODY`            | 2 MB                                      | per response; a page is tens of kilobytes                                        |
| `FETCH_RESUME_MAX_AGE`        | 24 hours                                  | an unfinished fetch older than this is started over                              |
| `NAME_MAX`, `TITLE_MAX`       | 200, 300 characters                       | longer strings are rejected                                                      |
| `IMAGE_HOST`                  | `s4.anilist.co`                           | the one image host the CSP allows (C8)                                           |

## 5. Behaviour

### 5.1 The character pool: an owner-managed snapshot

The server picks the cards, so the pool moves to the server and the browser stops calling AniList. The api server does not call AniList either: the pool is a snapshot that only the owner's command (§7.1) takes, and the game reads only the current snapshot.

#### 5.1.1 What a snapshot holds

- **Series**: the first `SNAPSHOT_SERIES` anime of AniList's `Media(type: ANIME, sort: POPULARITY_DESC, isAdult: false)`. Each AniList entry is one series, so a sequel season with its own entry is its own series (open question 3). `isAdult: false` keeps adult entries out by AniList's own flag; the top 100 by popularity hold none today, so it changes nothing now and guards later snapshots.
- **Characters**: every character with role `MAIN` or `SUPPORTING` in at least one of those anime. `BACKGROUND` characters are not fetched.
- **Per series**: id, title (English, else romaji), native title, start year, popularity, popularity rank, genres.
- **Per character**: id, name, native name, image, favourites, favourites rank, tier, primary series, and its memberships (§5.1.2).

#### 5.1.2 A character in several anime

A character is often MAIN or SUPPORTING in several of the top 100 (sequels above all: one character, several seasons).

- **Membership**: the character belongs to every snapshot series in which AniList lists it as MAIN or SUPPORTING (one `pool_snapshot_memberships` row each). A BACKGROUND appearance in another top-100 anime is not a membership.
- **Primary series**: of its memberships, the one with the best `popularity_rank`. It is the series a tile, the reveal and the market name first (`seriesIds[0]`, §6.2).
- **Series completion** counts the character in **each** of its series: one copy of a character that is in three seasons counts towards each season's figure. "Owned out of the characters of this anime" is then true for every series; counting it only in its primary series would make the other seasons impossible to complete.
- **Pool completion** counts each character **once**, whatever its memberships and its tiers: owned distinct characters of the current snapshot over the snapshot's character count.
- **In a pack** the character is one entry of the pool with one tier, so being in three anime does not make it three times as likely.

#### 5.1.3 Tiers: fixed per character by popularity

- Within a snapshot, sort the characters by `favourites` descending, ties by `id` ascending; `favourites_rank` is the position, 1 first. Favourites are AniList's count of users who marked the character as a favourite, the input today's tilt reads.
- With `N` characters: legendary is the first `L = round(N × 1 000 / 10 000)` ranks, rare the next `R = round(N × 3 000 / 10 000)`, common the rest (`round` is half up, in integers). A pool of 2 000 characters has 200 legendary, 600 rare and 1 200 common characters.
- Every tier holds at least `PACK_SIZE` characters (guaranteed from `N ≥ 50`, so by `SNAPSHOT_CHARACTERS_MIN`), so a pack can always draw five different characters of one tier.
- **Why these shares**: with `SLOT_ODDS` (§5.4), one given character turns up per card with chance `SLOT_ODDS[tier] / ODDS_SCALE / tier size`. At 10 / 30 / 60 that is `0.65/N` for a legendary, `0.88/N` for a rare and `1.12/N` for a common: a given legendary is the rarest single card and a given common the most frequent, while the tier seen in a pack keeps today's feel. A 5 % legendary share would make each legendary character more frequent than each common one (`1.3/N` against `0.89/N` at 5 / 20 / 75), which inverts what "legendary" means; a much larger one dilutes the tier. Open question 1.

#### 5.1.4 Taking a snapshot from AniList

Only `snapshot-pool` (§7.1) does this, run by the owner. Requests go one after the other, never in parallel, at most one per `ANILIST_REQUEST_GAP`:

1. **Series**: `SNAPSHOT_SERIES / ANILIST_SERIES_PER_PAGE` = 2 requests (`Page(page, perPage: 50) { media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { id title { english romaji native } startDate { year } popularity genres } }`).
2. **Characters**, per series: one request per page carrying both roles as aliases, `main: characters(role: MAIN, page: p, perPage: 25)` and `supporting: characters(role: SUPPORTING, page: p, perPage: 25)`, each with `pageInfo { hasNextPage }` and `edges { role node { id name { full native } image { large } favourites } }`; the next page is fetched while either alias has one. The engineer confirms the `role` argument and the nested page maximum against AniList's schema by introspection during the build and records the date in the PR; a smaller maximum only adds requests.

**Request count**: `2 + Σ over the 100 series of ceil(max(main, supporting) / 25)`. Most anime have fewer than 25 MAIN and 50 SUPPORTING characters (1 or 2 requests); long-running series (One Piece, Naruto, Bleach, Gintama) need up to about 15. Expected total: **about 200 to 300 requests**, which at 24 a minute is 8 to 13 minutes; the command prints the real count, and the first run measures it. A fetch that would exceed `ANILIST_MAX_REQUESTS` (1 000, about 42 minutes) stops and is refused: a pool that large breaks the response bounds anyway. Against AniList's limit (90 a minute, often degraded to 30, verified 2026-10-28, `CLAUDE.md`), 24 a minute stays under even the degraded figure, and the owner runs it rarely: an update, not a schedule.

- **Backoff**: a 429 waits its `Retry-After` (or `ANILIST_DEFAULT_RETRY_AFTER` without one) and retries the same request; a network error, a timeout, a body over `ANILIST_MAX_BODY`, an HTTP status ≥ 500, invalid JSON or a GraphQL `errors` answer waits 2, 4, 8, 16, 32 s and retries. After `ANILIST_MAX_RETRIES` consecutive failures of one request the command stops with exit code 2 and prints how to resume. A status from 400 to 499 other than 429 stops it at once (a query bug; retrying cannot help).
- **Resumable**: each page that passed the schema parse is written to `pool_fetch_pages` as it arrives, in its own short transaction. Running the command again continues the newest unfinished fetch from the first missing page if it began less than `FETCH_RESUME_MAX_AGE` ago; an older one is discarded and started over, so a snapshot never mixes popularity rankings from days apart. `--restart` discards it on demand.
- **Building** starts only when every page is present (§5.1.6).

#### 5.1.5 Validation

AniList's answer is untrusted input, whether it arrives over the network or from a file (`--stdin`).

- Each page is read through a TypeBox schema of the declared fields only; anything else is dropped before it is stored.
- A **series** is accepted when: `id` is an integer ≥ 1 not seen earlier in the fetch; the title (English, else romaji), trimmed, is 1 to `TITLE_MAX` characters and the native title at most `TITLE_MAX`; `startDate.year` is null or an integer from 1900 to 2100; `popularity` is an integer ≥ 0; `genres` is an array of at most 20 strings of 1 to 50 characters. Otherwise it is skipped with its characters.
- A **character** is accepted when: `id` is an integer ≥ 1; `name.full`, trimmed, is 1 to `NAME_MAX` characters, and `name.native` at most `NAME_MAX`; `image.large` parses with `URL`, has protocol `https:`, hostname exactly `IMAGE_HOST`, no userinfo and no port; `favourites` is an integer ≥ 0 (null counts as 0); `role` is `MAIN` or `SUPPORTING`. A character listed under several series is accepted once with its memberships merged; its name, image and favourites come from its first appearance, and a later appearance that differs is logged, not an error.
- No string anywhere contains NUL (Postgres `text` cannot hold it).
- Accepted strings are stored as sent apart from the trim: no HTML decoding, no stripping; the web renders them as text (C9). Skipped items are counted by reason.

#### 5.1.6 Building and activating a snapshot

One transaction, with the app role (it has the DML this needs):

1. Refuse, changing nothing, when fewer than `SNAPSHOT_SERIES_MIN` series or `SNAPSHOT_CHARACTERS_MIN` characters were accepted, when more than `SNAPSHOT_CHARACTERS_MAX` were, or when any tier would hold fewer than `PACK_SIZE` characters.
2. Insert the `pool_snapshots` row; upsert `series` and `characters` with the new display strings; insert the snapshot's series, characters (with rank, tier and primary series) and memberships.
3. Clear `is_current` on the previous snapshot and set it on the new one.
4. Delete the fetch's staging rows. Commit.

An opening reads the current snapshot's id once, in its own transaction, and draws only from that snapshot's rows, so an activation that commits during an opening changes nothing about that opening. A fresh install has no snapshot: `GET /api/packs` answers `odds: null` and an opening answers 503 `pool_unavailable`, with the allowance untouched and still accruing, until the owner runs §7.1.

#### 5.1.7 Updating a snapshot later

The owner runs §7.1 again whenever they choose. The new snapshot may rank characters differently (and so move them between tiers), add characters, and drop characters or whole series.

- **Owned cards keep the rarity they were granted with.** `cards.rarity` is written once, at the grant, and no snapshot touches it. Owned items never change value under the player: a legendary pulled yesterday stays legendary in the collection, on the market (`economy.md`) and in a recycle, whatever AniList's favourites did since.
- **Only future grants use the new tiers.** A character that moved from rare to legendary is dealt as legendary from the activation on. A player can then hold it at both tiers, which the collection shows as two entries (§5.5).
- **Display data follows the newest snapshot.** Name, native name, image and series titles come from the `characters` and `series` rows, which each activation updates. They are presentation, not value, and AniList's image URLs change when an image is re-uploaded, so keeping the strings of the grant would leave broken images. What is frozen on a card is what it is worth and where it came from: its tier, its opening, its snapshot and when it was obtained.
- **Completion uses the current snapshot.** Pool completion is owned distinct characters of the current snapshot over its size; series completion lists the current snapshot's series with their current members.
- **A dropped character** (not in the current snapshot) stays in every collection that holds it, with `inCurrentSnapshot: false` and `tier: null`; its entries keep their granted rarity; it counts in the card totals and in no completion figure; packs never deal it again. Its series are those of the newest snapshot that contained it, and a series no longer in the current snapshot has no completion figure (§6.2). This is the behaviour `collection-overview.md` §3.2 already designs.

#### 5.1.8 Images and network

- **Images**: the browser keeps loading card images from AniList's CDN, as today. The api does not proxy them: a proxy would make the NAS an image server and add an endpoint that fetches by URL. `IMAGE_HOST` is the one host the live CSP allows in `img-src` (C8); ADR 0008 §5's `*.anilist.co` is the ceiling and the CSP is the rule. A unit test reads the `Caddyfile` and fails if `img-src` and `IMAGE_HOST` disagree.
- **Network**: the snapshot command is the only outbound call the system makes, and only when the owner starts it. The endpoint is a constant, and no request input reaches the URL or the query variables (the command takes no AniList ids from its arguments). It runs in the api container, which reaches the internet through its `front` network; `back` stays internal; compose needs no network change. The api server process holds no AniList client: a test asserts that `buildApp` never constructs one.
- **Tests and CI never call AniList.** The CI stack and the e2e suite load a fixture snapshot through `--stdin` (§7.1). The client is tested against a local `node:http` server on `127.0.0.1:0` that it is constructed with, rather than undici's `MockAgent`: no new dev dependency, and the test goes through the real socket path, where the timeout and the body cap live.

### 5.2 Pack allowance

**1c ships the allowance; item 2 does not.** Roadmap item 2 lists the pack timer under the economy, but an opening endpoint without an allowance is an unlimited mint, and from the day item 2 lets cards be sold, an unlimited source of cards to sell. The allowance needs nothing from the economy (no Karma, no ledger); it is pack-grant logic, which is exactly what this T3 review covers; and `economy.md` builds on it unchanged. The manager updates the roadmap row.

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
4. Read the current snapshot's id. None → 503 `pool_unavailable`; the allowance is untouched.
5. Roll `PACK_SIZE` slots and pick a character for each (§5.4) from that snapshot.
6. For each picked character, `isNew` = the account holds no card of that character yet, at any rarity.
7. Insert the `pack_openings` row (with the snapshot id) and the cards (`slot` in roll order, `rarity` = the slot's tier, the snapshot id), move `packs_anchor_at`, commit, answer 201.

Because steps 2–7 run under the lock, requests of one account serialise: with one pack available, two parallel openings give one 201 and one 409; two parallel requests with the same `requestId` give one 201 and one 200 with the same cards. `unique (account_id, request_id)` is the backstop: if the lock were ever bypassed, the second insert fails its transaction (a 500) and nothing is opened twice. A request that ends in 409 or 503 leaves no record, so its key can succeed later. Keys are scoped to the account: account B sending A's `requestId` finds nothing of A's and gets its own outcome.

Steps 5 to 7 are one domain function, `dealPack(tx, account, rng, pool)`, whose character source is a parameter: 1c passes the current snapshot's pool, and `economy.md`'s themed packs pass a theme's subset of it, through the same roll and the same writes.

### 5.4 RNG, tiers and odds

- **RNG**: `crypto.randomInt` only (C10), behind an injectable `Rng` (`(min, max) => integer`) so unit tests can script outcomes. `Math.random` already fails lint in `api/`.
- **Tier roll, per slot, independently**: `r = randomInt(0, ODDS_SCALE)`; legendary when `r < 650`, rare when `r < 650 + 2 650`, otherwise common. Integers throughout, so the odds are exact.
- **Character pick**: uniform among the tier's characters in the snapshot (ordered by `character_id`) that this pack has not drawn yet: one partial Fisher–Yates shuffle per tier, `randomInt(i, n)` per draw. Every character of a tier is equally likely in each slot that rolled that tier; no pack repeats a character. Every tier holds at least `PACK_SIZE` characters (§5.1.3), so a pick never runs out.
- **What a pack holds, in expectation**: **0.325 legendary cards** (5 × 0.065, about one every three packs), 1.325 rare and 3.35 common. At least one legendary in 28.5 % of packs (1 − 0.935⁵), at least one rare or legendary in 86.5 % (1 − 0.67⁵).
- **Why these odds**: they keep today's feel. Today a card's legendary chance is 5 % to 11 % under the popularity tilt, and the average over a top-100 pool whose favourites fall off like today's (roughly Zipf-shaped) is near 6.3 % legendary and 26 % rare. `SLOT_ODDS` makes those averages the per-slot numbers, rounded to 6.5 % and 26.5 %. Today's base table alone (5 %, 0.25 legendaries a pack) would make packs noticeably poorer. Open question 2.
- **Completion horizon**, for the record, at a pool of 2 000 split 200 / 600 / 1 200: every legendary character takes about 200 × H(200) ≈ 1 180 legendary cards, which is about 3 600 packs; every common about 1 200 × H(1 200) ≈ 9 200 common cards, about 2 750 packs. At the 144-pack daily ceiling that is about 25 days of packs; at a casual nine packs a day, more than a year. The market (`economy.md`) is how players close the gap.
- **One source of truth**: `shared/src/rarity.ts` becomes integer (`ODDS_SCALE`, `SLOT_ODDS`, `TIER_SHARE`; `RARITIES` and `RARITY_LABEL` unchanged). The float `BASE_WEIGHTS` and `POPULARITY_INFLUENCE` stay until PR 2 deletes their last users; nothing on the server reads them. The UI shows the odds the server returns, never constants of its own: the `web/` block of the ESLint config forbids importing the number constants from `@anime-tcg/shared/rarity` and anything from `@anime-tcg/shared/economy` (`no-restricted-imports` with `importNames`).
- **Published odds** (`GET /api/packs`): `perSlot` (`SLOT_ODDS`), `tierSizes` (the current snapshot's character count per tier, so the chance of one given character per card is `perSlot[tier] / scale / tierSizes[tier]`) and the snapshot's version and date. They are exact: the numbers a player reads are the numbers the server applies, and the economy's model refers to them (`economy.md` §9).
- **The popularity tilt is gone.** Every card of a tier is rolled with the same table; the per-character `odds_rare` and `odds_legendary` of the first draft no longer exist. The snapshot id on each card names the tier table that applied.

### 5.5 Collection

- **Entries.** `GET /api/collection` answers the account's cards grouped into entries keyed by (character, granted rarity), each with a count and the first and last time a card of the entry was obtained. Because a character has one tier per snapshot, a collection holds **one entry per character**; a second entry for the same character appears only when a snapshot update moved that character's tier and the player then obtained it at the new one (§5.1.7). This replaces the first draft's "one group per character and rarity", which came from the per-card popularity roll.
- **Character data per entry**: name, native name, image, `seriesIds` (primary first), the character's current tier (null when it is not in the current snapshot) and `inCurrentSnapshot`. The series themselves come once per response in `series` (id, title, native title, start year), so a character in four seasons does not repeat four titles in every entry.
- **Totals**: `cards` (the same number as `AccountPublic.cards`), `duplicates` (the sum of count − 1 over the entries) and `byRarity` (cards per granted rarity).
- **Completion**, computed by the server against the current snapshot (§5.1.2, §5.1.7): `pool` = owned distinct characters of the snapshot over its character count; `series` = for every series of the current snapshot, in popularity order, the characters of that series the account owns at any rarity over the series' member count. Every series of the snapshot is listed (100 rows), owned or not, so a series filter can show `0/12` and a series whose last card was sold stays in the list.
- **Order**: entries by rarity (legendary first), then name, then character id. Stable for tests; the UI may re-sort.
- **Size**: bounded by the characters an account has ever owned: at most one snapshot's `SNAPSHOT_CHARACTERS_MAX`, plus those dropped or moved by updates. A complete collection of a 2 000-character pool is about 2 000 entries, some 450 KB of JSON; a new player's answer is a few kilobytes. No pagination in 1c: the overview filters, sorts and pages in the browser (`collection-overview.md` §5.5) and fetches when its tab is shown, not after every opening.
- `AccountPublic.cards`, 0 since 1b (`CARDS_UNTIL_1C`), becomes the account's card count, so the Manage dialog and the delete confirmation show real numbers.
- Cards are named by (character, rarity), never by id. There is no card id for a client to send or tamper with, which is the 1b pattern (C3: what cannot be named cannot be taken). Item 2's listing and recycle use the same naming.
- **No migration** (ADR 0008 §7). The server starts empty; the in-memory collection (`useInventory`) is dropped at the switch. The old browser keys `anime-tcg:inventory:v1` and `anime-tcg:character-pool:v1` are neither read nor deleted.

### 5.6 Reset (owner only)

The owner can reset one account's collection with `reset-collection` (§7.2), as with `reset-password`. There is no route and no button: a player cannot reset their own collection, and the proof of concept's `Reset` goes from the web app (§8). The `Reset` mention in `accounts.md` §3.6 and its §8 copy row are superseded; `ui-designer` updates them in PR 2.

In 1c, one transaction: lock the account row; delete its `pack_openings` (its cards go by cascade); set `packs_anchor_at` to null, so the account is full as on registration; commit. The login, password, sessions and account id stay. Old `requestId`s no longer replay anything because their openings are gone, which is harmless: a client keeps a key only until it gets an answer. From item 2 on, a reset also cancels the account's market listings and applies the Karma rule of `economy.md` §8.10.

### 5.7 Authorisation

Every route calls `requireAccount(req)` (401 `unauthenticated`) and passes the session's account id into the domain function. No account id, card id, opening id or snapshot id appears in any path or body; a `requestId` is looked up only among the acting account's openings.

### 5.8 Logging

At `info`, with the request id: pack opened (account id, opening id, snapshot id, count per rarity, whether it was a replay). From the commands: fetch progress every 25 requests (requests done, estimated remaining, 429s seen); snapshot built (version, series, characters, tier counts, skipped by reason, characters whose tier moved, characters dropped and added, duration); collection reset (account id, cards and openings removed). At `warn`: a page that failed and the wait before its retry; for skipped items, the reason and the first rejected field path. Never an AniList response body.

## 6. Contract (`shared/src/api.ts`, `shared/src/errors.ts`)

### 6.1 Error codes

New: `no_pack_available` (409) and `pool_unavailable` (503). `no_pack_available` carries `retryAfterSeconds` (the seconds until the next pack) and the `Retry-After` header, the same pair `too_many_failures` uses; the field's comment in `errors.ts` widens to both codes.

### 6.2 Schemas

```
Rarity              "common" | "rare" | "legendary"                  -- from RARITIES
PerRarity           { common: integer ≥ 0, rare: integer ≥ 0, legendary: integer ≥ 0 }
SnapshotInfo        { version: integer ≥ 1, takenAt: date-time }
PublishedOdds       { scale: integer, perSlot: PerRarity, tierSizes: PerRarity, snapshot: SnapshotInfo }   -- perSlot sums to scale
PackAllowance       { available: integer 0..cap, cap: integer, intervalSeconds: integer, nextPackInSeconds: integer ≥ 1 | null }
PacksResponse       { allowance: PackAllowance, odds: PublishedOdds | null }      -- null while there is no snapshot
SeriesRef           { id: integer ≥ 1, title: string, titleNative: string | null, startYear: integer | null }
CharacterPublic     { id: integer ≥ 1, name: string, nameNative: string | null, imageUrl: string,
                      seriesIds: integer[1..],                        -- primary series first
                      tier: Rarity | null,                            -- in the current snapshot; null when not in it
                      inCurrentSnapshot: boolean }
OpenPackBody        { requestId: uuid string }
OpenedCard          { slot: integer 0..PACK_SIZE − 1, character: CharacterPublic, rarity: Rarity, isNew: boolean }
PackOpened          { openingId: uuid, openedAt: date-time, cards: OpenedCard[PACK_SIZE], series: SeriesRef[], allowance: PackAllowance }
CollectionEntry     { character: CharacterPublic, rarity: Rarity, count: integer ≥ 1,
                      firstObtainedAt: date-time, lastObtainedAt: date-time }
Completion          { owned: integer ≥ 0, total: integer ≥ 0 }
SeriesCompletion    { seriesId: integer ≥ 1, owned: integer ≥ 0, total: integer ≥ 1 }
CollectionTotals    { cards: integer ≥ 0, duplicates: integer ≥ 0, byRarity: PerRarity }
CollectionResponse  { snapshot: SnapshotInfo | null, totals: CollectionTotals,
                      completion: { pool: Completion, series: SeriesCompletion[] },   -- current snapshot; empty without one
                      series: SeriesRef[],                            -- the current snapshot's, plus any an entry names
                      entries: CollectionEntry[] }
```

`rarity` on a card or entry is what it was granted with; `character.tier` is what packs deal the character as now; they differ only after a tier move. A `seriesId` an entry names that has no `SeriesCompletion` row is a series no longer in the current snapshot. Every object is `additionalProperties: false`; the 1b schema guard catches a miss.

### 6.3 Routes

| Method, path           | Body           | Success                                                  | Errors (status, code)                                                                          | Limit  |
| ---------------------- | -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| `GET /api/packs`       | —              | 200 `PacksResponse`                                      | 401 `unauthenticated`                                                                          | global |
| `POST /api/packs/open` | `OpenPackBody` | 201 `PackOpened`; 200 `PackOpened` on a replay           | 401 `unauthenticated`, 409 `no_pack_available` (+ `retryAfterSeconds`), 503 `pool_unavailable` | 20/min |
| `GET /api/collection`  | —              | 200 `CollectionResponse`                                 | 401 `unauthenticated`                                                                          | global |
| `GET /api/session`     | —              | unchanged, except that `account.cards` is the card count | —                                                                                              | global |

GET routes take `NoQuery`. The POST is behind the 1a CSRF check, and its override (`PACK_RATE_LIMIT`, per client address) replaces the global bucket for that route. The allowance is the real limit on openings; the override bounds lock contention from a script and leaves room for a full allowance, retries and a second tab. Response schemas list every status above plus 400 `validation_failed`, 403 `bad_origin` and 429 `rate_limited` on the POST, so the serialiser strips anything undeclared: no card id, favourites count or rank can leak.

The UI maps `no_pack_available` → the waiting state, counting down from `retryAfterSeconds`; `pool_unavailable` → the cards-unavailable state; `unauthenticated` → session ended (`accounts.md` §4.8); `validation_failed` → a client bug, shown as the generic failure; a network failure → the unreachable banner.

## 7. Owner-side commands

Both run inside the api container, use `DATABASE_URL` (the app role has the DML they need), are unit-tested through their exported functions with thin argument and stdin wrappers, and are documented in `docs/04-deployment.md` under "Operations".

### 7.1 `snapshot-pool`

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/snapshot-pool.js
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/snapshot-pool.js --dry-run
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/snapshot-pool.js --stdin < snapshot.json
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/snapshot-pool.js --export > snapshot.json
```

- No arguments: fetch from AniList (§5.1.4), resuming an unfinished fetch younger than `FETCH_RESUME_MAX_AGE`, then build and activate (§5.1.6). `--restart` discards an unfinished fetch first.
- `--dry-run`: fetch (or resume) and build inside a transaction that is rolled back, and print what activation would do. The staging rows stay, so the next run without `--dry-run` builds from them without another request.
- `--stdin`: read a snapshot file instead of fetching: `{ "format": "anime-tcg-snapshot/1", "takenAt": "<date-time>", "series": [<page bodies>], "characters": { "<seriesId>": [<page bodies>] } }`, the page bodies in AniList's GraphQL shape, at most `SNAPSHOT_FILE_MAX`. It goes through the same schema parse, validation, refusal rules and build, and records `source = 'file'`. The CI stack and the e2e suite seed their pool this way (from the fixture builder in `web/src/test/fixtures.ts`, extended to series and roles), and an offline install, or a fresh install while AniList is down, loads a saved file.
- `--export`: print the current snapshot as such a file (its series, characters and memberships written back into page bodies), so one install's snapshot can seed another and a fixture can be cut from a real snapshot.
- Output, for example: `Snapshot 2 active: 100 series, 2 143 characters (214 legendary, 643 rare, 1 286 common); 7 skipped; 31 changed tier, 12 dropped, 55 added; 241 AniList requests.` Exit 1 with a one-line reason on refusal; exit 2 when a fetch paused after `ANILIST_MAX_RETRIES` (`Paused after 118 of about 240 requests; run again to resume.`).

### 7.2 `reset-collection`

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/reset-collection.js <login>
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/reset-collection.js <login> --confirm
```

Without `--confirm` it only prints what a reset would remove (`Would reset <login>: 214 cards, 43 openings.`). With it, §5.6 runs and it prints `Collection reset for <login>: 214 cards and 43 openings removed; packs full.` Exit 1 with a one-line reason on an unknown login. Sessions are not touched; a signed-in player sees the empty collection on the next fetch.

## 8. The web change (second PR)

`feat/collection-packs-ui` makes the web app a client of §6. `ui-designer` specifies the new states first (the pack control ready with a count, waiting with a countdown, opening, and cards unavailable; the odds line; the collection without `Reset`). This section fixes only what the UI needs back and what it may not do.

**Deleted**: `web/src/lib/anilist.ts`, `web/src/hooks/useCharacterPool.ts`, `web/src/lib/pack.ts`, the roll and popularity functions in `web/src/lib/rarity.ts`, `useInventory`'s in-memory store, the browser `Character` and `Card` types (replaced by the shared schemas), `Reset`, the float constants in `shared/src/rarity.ts`, the e2e routes that stub `graphql.anilist.co`, and (decision 9) the reveal's glow: `CharacterCard`'s per-tier `FRAME_CLASS` shadows, the `legendary-pulse` keyframes and the `.glow-legendary` class.

**Rarity frames (decision 9)**: the reveal card's frame becomes `collection-overview.md` §6.1's border (`border-rarity-<tier>/40`, no shadow, no animation), and §6.1's two token values (`--color-rarity-common` `#a1a1aa`, `--color-rarity-legendary` `#fbbf24`) change in the same PR, so the reveal and the collection share one rarity treatment from the day the collection moves to the server. The rest of `collection-overview.md` §10 (hover lift, glass badges, gradients) waits for `docs/design/visual-system.md`.

**What the UI needs back**, and nothing more:

- From `GET /api/packs`: `available`, `cap`, `nextPackInSeconds`, `intervalSeconds`, and the published odds (`null` means cards are unavailable).
- From `POST /api/packs/open`: the cards in `slot` order, each with the character's name, native name, image and series (resolved through `series`), its rarity and `isNew`; the allowance after the opening.
- From `GET /api/collection`: the entries, `series`, totals and completion. PR 2 shows the existing collection view over them (one tile per entry, the rarity filter as a view); `collection-overview.md` (item 3) builds the full screen on the same answer.

**What the UI does with it**:

- The pack control is enabled when `available ≥ 1` and no opening is in flight. It shows the count and, below the cap, the countdown from `nextPackInSeconds`, counted from the moment the answer arrived. When the countdown ends the UI asks `GET /api/packs` once; it never polls on an interval. The countdown appears on the pack control only: no notification, sound, title change or "come back" prompt (ADR 0004 §6).
- Each click generates `requestId = crypto.randomUUID()`. If the request gets no answer (network failure), the UI keeps that id and sends it again on the next click, so a lost response shows the cards the server actually dealt instead of opening a second pack. Any answer from the server discards it.
- The reveal is the server's cards in `slot` order with `isNew`; the pull summary counts their rarities. The UI never computes an outcome.
- `Collection (N)` is `totals.cards` from `GET /api/collection`, fetched at sign-in and refetched after each opening (until item 3 replaces that with its stale-marking rule). The Collection tab renders the entries; the rarity filter stays a view over them.
- The odds line shows the server's `perSlot` odds, in `ui-designer`'s wording, instead of the constant base odds.
- The pool is no longer loaded at boot or while signed out (`App.tsx`), and the AniList error banner gives way to the cards-unavailable state.

**CSP**: the browser no longer talks to AniList's API, so `connect-src` becomes `'self'` alone; `img-src` keeps `https://s4.anilist.co`. The `Caddyfile`, the CI `docker` job's `EXPECTED_CSP` and `web/e2e/stack.spec.ts` change together. That makes PR 2 T3 as well (CSP/headers), on top of T1 for rendering third-party strings.

## 9. Tests required (minimum, T3)

**Unit** (`api/src/**/*.test.ts`, `shared/`):

- Allowance: a new account has `C`; opening from full leaves `C − 1` with `nextPackInSeconds` of one interval; `C` openings back to back leave 0; one interval later 1; a week later `C`; opening while the timer runs keeps the countdown; a clock set back an hour gives 0, never negative, and `nextPackInSeconds` ≥ 1; set forward a year gives `C`; a fraction of a second rounds up.
- Tier roll mapping, exhaustively: every `r` from 0 to `ODDS_SCALE − 1` through the tier function yields exactly `SLOT_ODDS`'s counts; `SLOT_ODDS` sums to `ODDS_SCALE`.
- Tiering: ranks by favourites with ties by id; `L` and `R` rounding at N = 50, 51, 2 000 and 6 000; every tier ≥ `PACK_SIZE` at `SNAPSHOT_CHARACTERS_MIN`; equal favourites everywhere still give a deterministic split.
- Memberships: a character in three series gets three rows and the most popular as primary; a BACKGROUND appearance adds none; series completion counts it in each series, pool completion once.
- Pick: a scripted RNG gives the expected characters; always `PACK_SIZE` different ones; five legendary slots draw five different legendaries from a tier of exactly `PACK_SIZE`.
- AniList validation: each rejection rule of §5.1.5 on its own, with a valid neighbour accepted; a series id repeated across pages; `SNAPSHOT_SERIES_MIN − 1` series or `SNAPSHOT_CHARACTERS_MIN − 1` characters → refused; more than `SNAPSHOT_CHARACTERS_MAX` → refused; `IMAGE_HOST` equals the host in the `Caddyfile`'s `img-src`.
- Snapshot file: `--export` of a built snapshot fed to `--stdin` builds an identical pool (same tiers, memberships and primary series).
- Completion: owned and total per series and for the pool, with a dropped character, a dropped series and a character held at two tiers.

**Statistical** (`api/src/domain/packs/roll.odds.test.ts`, in the unit project so it runs on every push): the domain deal with the real `crypto.randomInt` over a fixture snapshot of 200 characters, split 20 / 60 / 120 by the tier rule, for 40 000 packs, which is 200 000 cards.

- **Tier draw** against the published `SLOT_ODDS`: the count of cards per tier against 200 000 × (0.67, 0.265, 0.065), Pearson chi-square with 2 degrees of freedom at significance α = 0.001 (critical value 13.82). Power: a shift of 0.3 percentage points from common to legendary (6.5 % → 6.8 %) is caught with probability 0.97, a shift of 0.5 points with probability above 0.999.
- **Character draw within each tier** against uniform: per tier, the count per character against an equal share of that tier's cards, chi-square with 19, 59 and 119 degrees of freedom at α = 0.001 (critical values 43.82, 98.32 and 172.42). Power: one character drawn 1.3 times as often as the others of its tier is caught with probability at least 0.97 in each tier; 1.25 times with 0.75 to 0.82. The no-repeat rule makes draws within a pack slightly dependent, which only makes the test conservative.
- Deterministically, on the same run: no pack repeats a character, every pack has `PACK_SIZE` cards, and each card's character belongs to the tier its slot rolled.
- A correct implementation fails one of the four tests about four times in a thousand runs. A failure is a finding: the message prints the observed and expected counts, and nobody reruns it to green without reading them or changes the sample size or α to make it pass. The exhaustive mapping test is the deterministic half: it proves the table, this one proves the wiring to the real RNG.

**Route** (`api/test/packs.test.ts`, `api/test/collection.test.ts`): every row of §6.3, the happy path and each declared error; an extra field → 400; a query string on a GET → 400; a missing Origin on the POST → 403; signed out → 401 on each route; a new account reads `C` available, `perSlot` equal to `SLOT_ODDS` and `tierSizes` equal to the fixture's; an opening returns `PACK_SIZE` different characters in slots 0 to `PACK_SIZE − 1`, each card's rarity equal to its character's tier, and the collection and `account.cards` reflect them; the opening after the last available pack → 409 with `retryAfterSeconds` of one interval (fake clock) and `Retry-After`; no snapshot → `odds: null`, an opening 503, the allowance unchanged; with a fixture where every tier holds exactly `PACK_SIZE`, repeated openings mark `isNew` correctly; deleting an account removes its cards and openings and leaves snapshots, characters and series; the migration on a database with 1b accounts leaves them full.

**Snapshot update** (route level, two fixture snapshots): after activating a second snapshot in which character A moved from rare to legendary, B was dropped and series S left the top 100: every card granted earlier keeps its rarity and snapshot id; A is dealt only as legendary; a player holding A at both tiers sees two entries and pool completion counts A once; B shows `inCurrentSnapshot: false` and `tier: null`, counts in `totals` and in no completion, and is never dealt again; S has no `SeriesCompletion` row and still appears in `series` for the entries that name it; an opening that read snapshot 1 before the activation committed deals only from snapshot 1.

**Concurrency** (route, parallel `inject()` calls): one pack and two different `requestId`s → one 201, one 409, `PACK_SIZE` cards in the table; `C` packs and `C + 1` parallel openings → `C` × 201 and one 409; one pack and the same `requestId` twice → one 201 and one 200 with the same `openingId` and cards; an opening racing `reset-collection` → the opening's cards are either all removed by the reset or all present after it, never part of them.

**Snapshot command** (`api/test/snapshot.test.ts`, against a local `node:http` server): a good set of answers builds and activates a snapshot with the expected request count and pace (fake timers); a 429 with `Retry-After` waits that long and retries; one without waits `ANILIST_DEFAULT_RETRY_AFTER`; a 500, a stall past `ANILIST_TIMEOUT`, a body over `ANILIST_MAX_BODY`, invalid JSON and a GraphQL `errors` answer back off and retry, and after `ANILIST_MAX_RETRIES` the command exits 2 with the staged pages kept; the next run resumes at the first missing page and sends no request for a stored one; a fetch older than `FETCH_RESUME_MAX_AGE` starts over; a 400 stops at once; a refused build leaves the current snapshot exactly as it was; `--dry-run` writes no snapshot; the api server makes no request to the local AniList stand-in during the whole route suite.

**Reset command**: without `--confirm` nothing changes; with it the account's cards and openings are gone and `packs_anchor_at` is null, other accounts are untouched, and the account's sessions still work; an unknown login exits 1.

**Adversarial** (`api/test/security/packs.security.test.ts`):

- Replay: the same `requestId` sequentially and in parallel → one opening, the allowance spent once; account B sending A's `requestId` → B's own outcome, never A's cards.
- Forged, flipped, truncated and expired session cookies → 401, nothing written.
- Tampered outcome payloads: a body with `cards`, `rarity`, `tier`, `characterIds`, `slot`, `seed`, `odds`, `snapshotId`, `accountId` or `available` → 400 each, nothing written; a `requestId` that is not a uuid, is empty, or is 10 000 characters long → 400.
- Brute force against the limit: with packs available, the POST after `PACK_RATE_LIMIT` is used up within its window → 429 `rate_limited` with `Retry-After`.
- Clock: a `Date` header or a client time anywhere in the request changes nothing.
- No player reset: the route inventory has no reset, snapshot or AniList route; a POST to `/api/collection/reset` → 404.
- Hostile pool content (through `--stdin`): names, native names and series titles with `<script>`, an `<img onerror>`, an RTL override and zero-width characters are stored and returned byte for byte as text; a NUL anywhere → that item skipped; image URLs `http://s4.anilist.co/…`, `https://s4.anilist.co.evil.example/…`, `https://user@s4.anilist.co/…`, `https://s4.anilist.co:8443/…`, `javascript:…` and `data:…` → each skipped; a file with 6 001 valid characters → refused; a file over `SNAPSHOT_FILE_MAX` or nested 10 000 levels deep → refused without exhausting memory.
- Dependency audit: nothing added (the PR states it; manifests change in scripts only).

**Web (PR 2)**: unit tests for the pack control's states, the countdown's single refetch and the `requestId` kept after a network failure; the T1 test that hostile character names and series titles render as text in the reveal and in the collection; a test that `CharacterCard` renders no shadow or animation class for any tier. e2e (`web/e2e`, against the compose stack with a snapshot seeded through §7.1): sign in, open `C` packs, and the next is disabled with a countdown; a reload keeps `Collection (N)`; `localStorage` holds no collection or pool key; the page makes no request to `graphql.anilist.co`; the CSP header is the narrowed one.

## 10. Acceptance criteria

1. All routes in §6.3 exist, are schema-validated, carry their limit, and pass the tests in §9; `api/src` coverage stays ≥ 85 %.
2. The browser holds no roll, no pool and no collection: the files listed in §8 are gone, `connect-src` is `'self'`, and e2e proves there is no request to AniList's API. The reveal shows §6.1's borders and no glow.
3. AniList is called only by `snapshot-pool`, run by the owner; the api server holds no AniList client; no test or CI job calls AniList.
4. The statistical and exhaustive tests pass at the stated sizes and α.
5. `docs/05-security.md`: C1 live for collection and packs, the C6 pack override live, C8 narrowed, C10 live; a T3 row per PR; the threat model gains the owner-run outbound call, AniList content (network or file) as untrusted input, the allowance clock, replayed openings and the owner's reset. `docs/04-deployment.md`: `snapshot-pool` (first snapshot on a fresh install, update, resume, `--stdin` and `--export`), `reset-collection`, and what an install without a snapshot looks like.
6. On the acceptance stack, the owner takes a real snapshot and the PR records its request count and duration; a new account opens `C` packs and then waits for the countdown; two tabs together cannot open more than the allowance; a reload keeps the collection; the collection answer shows pool and series completion.

## 11. Decision record

The owner's answers to this spec's first open questions and to `economy.md`'s, as far as they concern 1c. ADR 0011 records the ones that change ADR 0004.

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                      | Where                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 2   | Completion: show both series completion (per anime: owned / total characters of that anime) and completion of the whole pool. The starting pool is all characters of the top 100 anime by AniList popularity with role MAIN or SUPPORTING.                        | §5.1.1, §5.1.2, §5.5 |
| 3   | Rarity: fixed rarity per character, decided by character popularity; each character has one rarity set by its popularity rank, and a pack rolls the tier, then a character from that tier. This supersedes the earlier answer to keep the popularity tilt.        | §5.1.3, §5.4         |
| 4   | Reset: an owner-only CLI reset of one account's collection, like reset-password; no button for players.                                                                                                                                                           | §5.6, §7.2           |
| 8   | AniList: no live refresh. Take a snapshot of the pool so AniList changes never influence the live game, and keep an owner-run option to update the snapshot (and the popularity ratings) later. The earlier design (refresh every 24 h, hourly check) is dropped. | §5.1, §7.1           |
| 9   | The glowing rarity frames on the pack reveal are replaced in the 1c web PR (`collection-overview.md` §6.1 borders; the glow animation deleted).                                                                                                                   | §8                   |

Decisions 1, 5, 6 and 7 (recycle, the name Karma, the player market, the pack shop) are `economy.md`'s.

## 12. Open questions

For the owner, none blocking; each is a choice of three, and this spec builds the recommended one.

1. **Tier split** (share of the snapshot's characters per tier, by favourites rank).
   - A: 5 % legendary, 20 % rare, 75 % common. Fewer legendary characters, but each of them turns up more often than each common one.
   - **B (recommended)**: 10 % legendary, 30 % rare, 60 % common. Each legendary character is the rarest single card (about 1.7 times rarer than a common one), and the tier seen in packs keeps today's feel.
   - C: 15 % legendary, 35 % rare, 50 % common. Each legendary character about 3 times rarer than a common one, but "legendary" then covers 300 characters of a 2 000-character pool.
2. **Tier odds per slot.**
   - A: 70 / 25 / 5 % (today's base table): 0.25 legendaries per pack, one pack in four. Poorer than today.
   - **B (recommended)**: 67 / 26.5 / 6.5 %: 0.325 legendaries per pack, about one in three; today's average under the tilt.
   - C: 64 / 28 / 8 % (the middle of today's tilt range): 0.4 legendaries per pack. Richer than today, and more legendaries reach the market.
3. **What counts as one anime for series completion.**
   - **A (recommended)**: each AniList entry in the top 100 is a series, so "Attack on Titan" and "Attack on Titan Season 3" have their own figures and a character counts in both. Exact and needs no extra requests; the list holds some near-duplicate titles, told apart by start year.
   - B: group sequels into one franchise through AniList's SEQUEL and PREQUEL relations. One figure per franchise, but about 100 more requests per snapshot and a rule for the franchise's title.
   - C: keep only the most popular entry of each franchise and drop its other seasons. One figure per franchise, but characters who appear only in a later season leave the pool.

ADRs: ADR 0011 records decisions 3 and 8 together with the economy's reversals of ADR 0004. ADR 0009 says `shared/` holds the constants "the UI displays"; they still live there, and the UI now displays the server's copy of them.
