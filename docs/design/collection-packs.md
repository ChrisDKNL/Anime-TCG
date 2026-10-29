# Collection and packs (Sprint 1c, server side)

Manager-written technical spec (non-UI). Moves the character pool, pack grants, pack openings, rarity rolls and the collection from the browser to the API, on the 1b accounts (`accounts-api.md`), as ADR 0008 §1–2 requires. The pool is an owner-managed snapshot of AniList, and each character has one of five fixed rarity tiers set by its popularity (ADR 0011 §6–7); the collection answer carries what the collection overview needs (`collection-overview.md` §3.8), with completion per franchise. §8 is the web change: it lists what the UI needs back and leaves the visual design to `ui-designer`. Security tier **T3** (pack grants and openings, RNG; the web PR also changes the CSP). `security-officer` review and an adversarial test pass are required before each PR opens; a T3 change never merges on the day it is opened unless the owner says so.

Written 2026-10-29; revised three times the same day for the owner's decisions (§11).

## 1. Goal

A signed-in player opens packs that the server grants: one accrues every interval and a few can be stored. The server, not the browser, rolls each slot's rarity tier (Common, Rare, Epic, Legendary or Mythic), picks a character of that tier, records the opening and adds the cards to the account's collection. The characters come from a snapshot the owner takes of AniList: every MAIN and SUPPORTING character of the 100 most popular anime, each with one tier fixed by its popularity rank, and the anime grouped into franchises. AniList is never called while the game runs, so nothing AniList changes reaches the live game until the owner takes a new snapshot. The collection answer carries the franchises, dates, totals and completion figures (whole pool and per franchise) the collection overview shows. At the end of 1c the game is playable end to end again, and Sprint 1 (1a, 1b, 1c) can be released (`docs/03-release-process.md`).

## 2. Out of scope

- Karma, the ledger, the player market, the pack shop and recycling duplicates for Karma (roadmap item 2, `economy.md`). In 1c a card has no Karma value; these tables are what item 2 builds on.
- **Masterwork cards and Relics.** The owner has reserved both (§11, round 2, decision 6): a Masterwork is a variant of a character's card with a higher rarity than the character's tier, and a Relic is a separate kind of collectible. Upgrades of any kind come only from the mini-games (items 5 and 6, round 3), never from packs or recycling. **Neither is designed yet**: no rule, odds, source or value exists for them. 1c only reserves the column and the contract fields that let them arrive later without a breaking migration (§4.1, §6.2).
- Packs won as game prizes (items 5, 6). They will be a separate counter consumed by the same opening path (`economy.md` §8.11); the allowance here does not change for them.
- The collection overview's screen (item 3, `collection-overview.md`). 1c serves the data it needs (§5.5); search, filters, sort and pages are the browser's.
- Profile and its next-pack timer (item 4). In 1c the countdown lives on the pack control.
- Collection download (item 9).
- An image proxy (§5.1.9).
- Any live or scheduled AniList refresh (round 1, decision 8).
- The visual design of the pack control, countdown, reveal and collection states (`ui-designer`, §8), except that the reveal's glowing frames go (§8, round 1, decision 9).

## 3. Delivery

Two pull requests, in order, each through the full gate:

1. **`feat/collection-packs`** (this spec, everything except §8): the migration; `api/src/domain/pool/` (AniList client, validation, franchises, tiering, snapshot build), `api/src/domain/packs/` (allowance, roll, opening) and `api/src/domain/collection/` (entries, totals, completion, reset); routes under `api/src/routes/packs/` and `api/src/routes/collection/` with `PACK_RATE_LIMIT` in `routes/limits.ts`; the owner commands `snapshot-pool` and `reset-collection` (§7); shared schemas and constants; tests; docs. The api server gains no background job for the pool. The web app is left as it is (browser pool, client roll, in-memory collection), so `main` stays playable between the two merges; the float constants it imports stay until PR 2 (§5.4).
2. **`feat/collection-packs-ui`** (§8): the web app becomes a client of these routes, the browser's AniList, roll and pool code are deleted, the CSP narrows, and the reveal's glowing rarity frames are replaced by tier borders.

Sprint 1 is released after PR 2 merges.

## 4. Data model

### 4.1 Tables

```
enums
  rarity              common, rare, epic, legendary, mythic          -- in rank order
  card_variant        standard                                        -- reserved: 'masterwork' is added later (ALTER TYPE ... ADD VALUE)
  item_kind           card                                            -- reserved: 'relic' is added later
  character_role      main, supporting

pool_snapshots                                 -- one row per snapshot; never deleted (cards name the one that granted them)
  id                  integer pk generated always as identity   -- the version: 1, 2, 3 ...
  source              text not null            -- 'anilist' or 'file' (§7.1)
  taken_at            timestamptz not null     -- when the fetch began: AniList's state at that moment
  activated_at        timestamptz not null
  is_current          boolean not null         -- unique index on (is_current) where is_current: at most one
  series_count        integer not null
  franchise_count     integer not null
  character_count     integer not null
  tier_counts         integer[5] not null      -- common, rare, epic, legendary, mythic

series                                         -- latest display data of every anime entry ever in a snapshot; never deleted
  id                  integer pk               -- AniList media id
  title               text not null            -- English, else romaji
  title_native        text null
  start_year          smallint null

characters                                     -- latest display data of every character ever in a snapshot; never deleted
  id                  integer pk               -- AniList character id
  name                text not null            -- name.full, trimmed; rendered as text
  name_native         text null
  image_url           text not null            -- an https URL on IMAGE_HOST (§5.1.9)

pool_snapshot_franchises                       -- the franchises of a snapshot (§5.1.2)
  snapshot_id         integer not null references pool_snapshots(id)
  franchise_id        integer not null references series(id)   -- the smallest AniList id among its top-100 entries (its anchor)
  popularity_rank     smallint not null        -- the best popularity_rank of its entries
  primary key (snapshot_id, franchise_id)

pool_snapshot_series                           -- the 100 anime entries of a snapshot
  snapshot_id         integer not null references pool_snapshots(id)
  series_id           integer not null references series(id)
  franchise_id        integer not null
  popularity_rank     smallint not null        -- 1 .. SNAPSHOT_SERIES, AniList's POPULARITY_DESC order
  popularity          integer not null
  genres              text[] not null          -- AniList's genres; economy.md's themed packs read them
  primary key (snapshot_id, series_id)
  foreign key (snapshot_id, franchise_id) references pool_snapshot_franchises

pool_snapshot_relations                        -- the merge edges that built the franchises, for audit and --export
  snapshot_id         integer not null references pool_snapshots(id)
  from_id             integer not null         -- AniList media ids; either may be outside the top 100
  to_id               integer not null
  relation_type       text not null            -- one of FRANCHISE_RELATIONS
  primary key (snapshot_id, from_id, to_id, relation_type)

pool_snapshot_characters                       -- the pool of a snapshot, one row per character
  snapshot_id         integer not null references pool_snapshots(id)
  character_id        integer not null references characters(id)
  favourites          integer not null
  favourites_rank     integer not null         -- 1 = most favourited in this snapshot (§5.1.4)
  tier                rarity not null          -- fixed for this snapshot
  primary_series_id   integer not null references series(id)
  primary key (snapshot_id, character_id)
  index (snapshot_id, tier, character_id)

pool_snapshot_memberships                      -- the snapshot's entries a character is MAIN or SUPPORTING in
  snapshot_id         integer not null
  character_id        integer not null
  series_id           integer not null
  role                character_role not null
  primary key (snapshot_id, character_id, series_id)
  foreign key (snapshot_id, character_id) references pool_snapshot_characters
  foreign key (snapshot_id, series_id) references pool_snapshot_series

pool_fetches                                   -- staging for a resumable fetch (§5.1.5)
  id                  integer pk generated always as identity
  started_at          timestamptz not null

pool_fetch_pages
  fetch_id            integer not null references pool_fetches(id) on delete cascade
  kind                text not null            -- 'series', 'relations' or 'characters'
  key                 text not null            -- '' for series pages, the batch's first id for relations, the series id for characters
  page                smallint not null
  body                jsonb not null           -- the declared fields of AniList's answer, after the schema parse
  fetched_at          timestamptz not null
  primary key (fetch_id, kind, key, page)

pack_openings
  id                  uuid pk default gen_random_uuid()
  account_id          uuid not null references accounts(id) on delete cascade
  request_id          uuid not null            -- the client's idempotency key
  snapshot_id         integer not null references pool_snapshots(id)
  opened_at           timestamptz not null
  unique (account_id, request_id)

cards                                          -- one row per character card; duplicates are separate rows
  id                  uuid pk default gen_random_uuid()   -- internal: never in a request or a response
  account_id          uuid not null references accounts(id) on delete cascade
  opening_id          uuid not null references pack_openings(id) on delete cascade
  slot                smallint not null        -- 0 .. PACK_SIZE - 1, the reveal order
  character_id        integer not null references characters(id)
  rarity              rarity not null          -- the card's rarity as granted; never changes
  variant             card_variant not null default 'standard'   -- reserved for Masterwork (§2)
  snapshot_id         integer not null references pool_snapshots(id)   -- the snapshot that granted it
  is_new              boolean not null         -- the account held no card of this character before this opening
  pulled_at           timestamptz not null
  unique (opening_id, slot)
  index (account_id, character_id, rarity, variant)

accounts (1b) gains
  packs_anchor_at     timestamptz null         -- the allowance clock (§5.2); null means full
```

Rules:

- **The account row is the lock.** Every path with stakes (opening and reset here; listing, buying, the shop and recycling later) starts with `SELECT ... FOR UPDATE` on the acting account's `accounts` row, so two requests of one account run one after the other and all of them share one lock order. The allowance lives on that row for the same reason: the row that is locked is the row that changes.
- **A card is a row**, duplicates included, never a counter. Each card names the opening it came from and the snapshot that granted it, so every pull can be audited against the tier table that was in force, and item 2 can move or remove exactly one copy.
- **A card's rarity is the card's, frozen.** `cards.rarity` is copied from the snapshot's tier at the grant, and no snapshot update writes it (§5.1.8). It is a property of the card, not of the character, which is also what lets a later Masterwork carry a rarity above its character's tier.
- **Reserved, not built**: `card_variant` and `item_kind` have one value each today. A Masterwork arrives as a new `card_variant` value (an additive enum change, existing rows keep `standard`); a Relic arrives as its own table and a new `item_kind` value, beside `cards`, so nothing in this model has to be rewritten for either.
- **Snapshots, characters and series are never deleted.** Cards reference them without cascade; a character that leaves the pool keeps rendering in every collection that holds it.
- **Card ids stay inside the server.** No request or response carries one; the API names a collection entry by character, rarity and variant (§5.5).
- Deleting an account removes its openings and cards (`on delete cascade`, as `accounts.md` promises: the account "and every card in it"). Snapshot, character and series rows are shared reference data and stay.
- The staging tables hold only what the schema parse of §5.1.6 kept, never a whole AniList body, and are emptied when a snapshot is built from them or a fetch is restarted.
- Migration: the next file in `api/src/db/migrations/` (`0003` at the time of writing). The app role gets its grants on the new tables from 0001's default privileges; `db-role.test.ts` gains an insert into `cards`.

### 4.2 Parameters

Every number this spec uses, in one place. The game numbers live in `shared/src/economy.ts` (new, exported as `@anime-tcg/shared/economy`; ADR 0004 wants them in one file, and item 2 adds its own there) and, for tiers and odds, in `shared/src/rarity.ts`. The AniList numbers are politeness towards AniList and live with the pool code.

| Name                          | Value                                                                  | Meaning                                                                              |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PACK_SIZE`                   | 5                                                                      | cards per pack, all different characters                                             |
| `PACK_INTERVAL_MINUTES`       | 10                                                                     | one pack accrues per interval                                                        |
| `PACK_CAP`                    | 3                                                                      | packs stored at most; a new account starts with this many                            |
| `ODDS_SCALE`                  | 1 000 000                                                              | per-slot odds are integers out of this                                               |
| `SLOT_ODDS`                   | common 682 110, rare 275 220, epic 37 977, legendary 4 032, mythic 661 | the tier each slot rolls (§5.4); sums to `ODDS_SCALE`                                |
| `SHARE_SCALE`                 | 10 000                                                                 | tier shares are integers out of this                                                 |
| `TIER_SHARE`                  | mythic 100, legendary 400, epic 1 000, rare 2 500, common 6 000        | 1 %, 4 %, 10 %, 25 %, 60 % of the snapshot's characters, by favourites rank (§5.1.4) |
| `SNAPSHOT_SERIES`             | 100                                                                    | anime entries in a snapshot: AniList's top by `POPULARITY_DESC`                      |
| `SNAPSHOT_SERIES_MIN`         | 90                                                                     | a snapshot with fewer valid entries is refused                                       |
| `SNAPSHOT_CHARACTERS_MIN`     | 500                                                                    | a snapshot with fewer valid characters is refused; the smallest pool with 5 Mythics  |
| `SNAPSHOT_CHARACTERS_MAX`     | 6 000                                                                  | a snapshot with more is refused (bounds every response of §6)                        |
| `SNAPSHOT_FILE_MAX`           | 64 MB                                                                  | the largest `--stdin` file                                                           |
| `FRANCHISE_RELATIONS`         | `SEQUEL`, `PREQUEL`, `SIDE_STORY`, `PARENT`                            | the AniList relation types that merge entries into one franchise (§5.1.2)            |
| `FRANCHISE_MAX_HOPS`          | 2                                                                      | entries outside the top 100 a merge path may pass through                            |
| `FRANCHISE_MAX_REQUESTS`      | 40                                                                     | relation requests a fetch may make for the hops                                      |
| `ANILIST_SERIES_PER_PAGE`     | 50                                                                     | AniList's page maximum; also the batch size of a relations request                   |
| `ANILIST_CHARACTERS_PER_PAGE` | 25                                                                     | per role connection, per request (§5.1.5)                                            |
| `ANILIST_REQUEST_GAP`         | 2.5 s                                                                  | at most 24 requests a minute, below AniList's degraded 30                            |
| `ANILIST_MAX_REQUESTS`        | 1 000                                                                  | a fetch that would need more stops and is refused                                    |
| `ANILIST_MAX_RETRIES`         | 5                                                                      | consecutive failures of one request before the fetch pauses (resumable)              |
| `ANILIST_DEFAULT_RETRY_AFTER` | 60 s                                                                   | the wait after a 429 without `Retry-After`                                           |
| `ANILIST_TIMEOUT`             | 10 s                                                                   | per request                                                                          |
| `ANILIST_MAX_BODY`            | 2 MB                                                                   | per response; a page is tens of kilobytes                                            |
| `FETCH_RESUME_MAX_AGE`        | 24 hours                                                               | an unfinished fetch older than this is started over                                  |
| `NAME_MAX`, `TITLE_MAX`       | 200, 300 characters                                                    | longer strings are rejected                                                          |
| `IMAGE_HOST`                  | `s4.anilist.co`                                                        | the one image host the CSP allows (C8)                                               |

## 5. Behaviour

### 5.1 The character pool: an owner-managed snapshot

The server picks the cards, so the pool moves to the server and the browser stops calling AniList. The api server does not call AniList either: the pool is a snapshot that only the owner's command (§7.1) takes, and the game reads only the current snapshot.

#### 5.1.1 What a snapshot holds

- **Entries**: the first `SNAPSHOT_SERIES` anime of AniList's `Media(type: ANIME, sort: POPULARITY_DESC, isAdult: false)`, each with id, title (English, else romaji), native title, start year, popularity, popularity rank, genres and its relations. `isAdult: false` keeps adult entries out by AniList's own flag; the top 100 by popularity hold none today, so it guards later snapshots.
- **Franchises**: the entries grouped by AniList relations (§5.1.2). Series completion is per franchise.
- **Characters**: every character with role `MAIN` or `SUPPORTING` in at least one entry, each with id, name, native name, image, favourites, favourites rank, tier, primary entry and its memberships. `BACKGROUND` characters are not fetched.

#### 5.1.2 Franchises

The owner's rule (round 2, decision 4): series completion groups AniList entries into franchises through their relations, and a character counts once per franchise.

- **Which relations merge**: `SEQUEL`, `PREQUEL`, `SIDE_STORY` and its inverse `PARENT`, between two `ANIME` entries, read in both directions (AniList usually lists a relation on both sides, not always). Not merged: `SPIN_OFF` (a different cast or a different show, such as a school-comedy spin-off), `ALTERNATIVE` (another adaptation of the same source, such as a remake), `CHARACTER` (crossovers that share characters), `SUMMARY`, `COMPILATION` and `CONTAINS` (recaps, whose characters already belong to the entries they recap), `ADAPTATION` and `SOURCE` (manga and novels, not anime) and `OTHER`.
- **Paths through entries outside the top 100**: two top-100 entries belong to one franchise when a path of merging relations connects them that passes through at most `FRANCHISE_MAX_HOPS` entries outside the top 100. Season 1 and season 3 in the top 100 with season 2 outside it are one franchise. Entries outside the top 100 only connect; their characters are not fetched, and they are not members of the franchise.
- **Identity**: a franchise's id is the smallest AniList id among its top-100 entries (in practice its oldest entry, since AniList assigns ids in creation order), and its title, native title and start year are that entry's. The id stays the same across snapshots while that entry stays in the top 100. A franchise's `popularity_rank` is the best rank among its entries.
- **A franchise of one** is an entry no merging relation connects to another top-100 entry.

#### 5.1.3 A character in several entries and franchises

- **Membership**: a character belongs to every snapshot entry in which AniList lists it as MAIN or SUPPORTING (one `pool_snapshot_memberships` row each), and so to the franchises of those entries. A BACKGROUND appearance is not a membership.
- **Primary**: its primary entry is the most popular entry it belongs to, and its primary franchise is that entry's franchise. The tile, the reveal and the market name the primary franchise first (`franchiseIds[0]`, §6.2).
- **Franchise completion** counts a character **once per franchise**: one copy of a character in seasons 1, 2 and 3 counts once towards that franchise. A character that belongs to two different franchises (a crossover star, MAIN in both) counts once in each.
- **Pool completion** counts each character **once**, whatever its memberships and its tiers: owned distinct characters of the current snapshot over the snapshot's character count.
- **In a pack** the character is one entry of the pool with one tier, so belonging to several entries does not make it more likely.

#### 5.1.4 Tiers: fixed per character by popularity

The owner's split (round 2, decision 2): Mythic 1 %, Legendary 4 %, Epic 10 %, Rare 25 %, Common 60 % of the pool, by AniList favourites rank.

- **Rank**: sort the snapshot's characters by `favourites` descending; **ties are broken by AniList character id ascending**, so equal favourites never make the split depend on query order, and a character with equal favourites and the lower id lands in the higher tier at a boundary. `favourites_rank` is the position, 1 first.
- **Counts**: with `N` characters, the tier boundaries are cumulative, `b(k) = round(N × cumulative share / 10 000)` with half-up integer rounding: Mythic is ranks 1 to `b(100)`, Legendary up to `b(500)`, Epic up to `b(1 500)`, Rare up to `b(4 000)`, Common the rest. Cumulative boundaries make the five counts sum to `N` exactly. At N = 500: 5 / 20 / 50 / 125 / 300; at N = 2 000: 20 / 80 / 200 / 500 / 1 200; at N = 6 000: 60 / 240 / 600 / 1 500 / 3 600.
- **Minimum per tier**: every tier must hold at least `PACK_SIZE` (5) characters, so a pack whose five slots all roll one tier still draws five different characters. Mythic, the smallest share, reaches 5 at N = 500, which is why `SNAPSHOT_CHARACTERS_MIN` is 500; a snapshot with a tier below 5 is refused (§5.1.7).
- **What one character's chance per card works out to**, with `SLOT_ODDS` (§5.4): `SLOT_ODDS[tier] / ODDS_SCALE / tier size`, which is `1.137/N` for a given Common, `1.101/N` for a given Rare, `0.380/N` for a given Epic, `0.101/N` for a given Legendary and `0.066/N` for a given Mythic: **each tier's characters are individually rarer than the tier below**, Common < Rare < Epic < Legendary < Mythic. The Rare odds were lowered for exactly this (round 3, decision 1): with the 60 / 25 / 10 / 4 / 1 split, a given Rare stays rarer than a given Common only while Rare fills less than 28.16 % of the slots, which is at least one Rare in at most 80.86 % of packs; the owner's 80 % is inside that bound. Common and Rare characters are close (a given Rare about 3 % rarer than a given Common); the upper tiers are far apart.

#### 5.1.5 Taking a snapshot from AniList

Only `snapshot-pool` (§7.1) does this, run by the owner. Requests go one after the other, never in parallel, at most one per `ANILIST_REQUEST_GAP`:

1. **Entries with their relations**: `SNAPSHOT_SERIES / ANILIST_SERIES_PER_PAGE` = 2 requests (`Page(page, perPage: 50) { media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { id title { english romaji native } startDate { year } popularity genres relations { edges { relationType node { id type } } } } }`).
2. **Relation hops**: the anime ids reached by a merging relation that are not in the top 100 and not yet read, in batches of 50 (`Page(perPage: 50) { media(id_in: [...], type: ANIME) { id relations { edges { relationType node { id type } } } } }`), for at most `FRANCHISE_MAX_HOPS` rounds. Expected **about 4 to 12 requests** (a few hundred neighbouring entries over two rounds); bounded by `FRANCHISE_MAX_REQUESTS`, beyond which the fetch is refused rather than building franchises from a partial graph.
3. **Characters**, per top-100 entry: one request per page carrying both roles as aliases, `main: characters(role: MAIN, page: p, perPage: 25)` and `supporting: characters(role: SUPPORTING, page: p, perPage: 25)`, each with `pageInfo { hasNextPage }` and `edges { role node { id name { full native } image { large } favourites } }`; the next page is fetched while either alias has one. The engineer confirms the `role` argument, the nested page maximum and the `relations` fields against AniList's schema by introspection during the build and records the date in the PR; a smaller page maximum only adds requests.

**Request count**: `2 + hops + Σ over the 100 entries of ceil(max(main, supporting) / 25)`. Most anime have fewer than 25 MAIN and 50 SUPPORTING characters (1 or 2 requests); long-running series (One Piece, Naruto, Bleach, Gintama) need up to about 15. Expected total: **about 210 to 310 requests**, which at 24 a minute is 9 to 13 minutes; the franchise hops add under half a minute. The command prints the real count, and the first run measures it. A fetch that would exceed `ANILIST_MAX_REQUESTS` (1 000, about 42 minutes) stops and is refused. Against AniList's limit (90 a minute, often degraded to 30, verified 2026-10-28, `CLAUDE.md`), 24 a minute stays under even the degraded figure, and the owner runs it rarely.

- **Backoff**: a 429 waits its `Retry-After` (or `ANILIST_DEFAULT_RETRY_AFTER` without one) and retries the same request; a network error, a timeout, a body over `ANILIST_MAX_BODY`, an HTTP status ≥ 500, invalid JSON or a GraphQL `errors` answer waits 2, 4, 8, 16, 32 s and retries. After `ANILIST_MAX_RETRIES` consecutive failures of one request the command stops with exit code 2 and prints how to resume. A status from 400 to 499 other than 429 stops it at once (a query bug; retrying cannot help).
- **Resumable**: each page that passed the schema parse is written to `pool_fetch_pages` as it arrives, in its own short transaction. Running the command again continues the newest unfinished fetch from the first missing page if it began less than `FETCH_RESUME_MAX_AGE` ago; an older one is discarded and started over, so a snapshot never mixes popularity rankings from days apart. `--restart` discards it on demand.
- **Building** starts only when every page is present (§5.1.7).

#### 5.1.6 Validation

AniList's answer is untrusted input, whether it arrives over the network or from a file (`--stdin`).

- Each page is read through a TypeBox schema of the declared fields only; anything else is dropped before it is stored.
- An **entry** is accepted when: `id` is an integer ≥ 1 not seen earlier in the fetch; the title (English, else romaji), trimmed, is 1 to `TITLE_MAX` characters and the native title at most `TITLE_MAX`; `startDate.year` is null or an integer from 1900 to 2100; `popularity` is an integer ≥ 0; `genres` is an array of at most 20 strings of 1 to 50 characters. Otherwise it is skipped with its characters.
- A **relation edge** is kept when `relationType` is one of AniList's enum values (others are dropped and counted), `node.id` is an integer ≥ 1 and `node.type` is `ANIME`; at most 200 edges per entry are read.
- A **character** is accepted when: `id` is an integer ≥ 1; `name.full`, trimmed, is 1 to `NAME_MAX` characters, and `name.native` at most `NAME_MAX`; `image.large` parses with `URL`, has protocol `https:`, hostname exactly `IMAGE_HOST`, no userinfo and no port; `favourites` is an integer ≥ 0 (null counts as 0); `role` is `MAIN` or `SUPPORTING`. A character listed under several entries is accepted once with its memberships merged; its name, image and favourites come from its first appearance, and a later appearance that differs is logged, not an error.
- No string anywhere contains NUL (Postgres `text` cannot hold it).
- Accepted strings are stored as sent apart from the trim: no HTML decoding, no stripping; the web renders them as text (C9). Skipped items are counted by reason.

#### 5.1.7 Building and activating a snapshot

One transaction, with the app role (it has the DML this needs):

1. Refuse, changing nothing, when fewer than `SNAPSHOT_SERIES_MIN` entries or `SNAPSHOT_CHARACTERS_MIN` characters were accepted, when more than `SNAPSHOT_CHARACTERS_MAX` were, when the relation hops exceeded `FRANCHISE_MAX_REQUESTS`, or when any tier would hold fewer than `PACK_SIZE` characters.
2. Build the franchises (§5.1.2) and the tiers (§5.1.4).
3. Insert the `pool_snapshots` row; upsert `series` and `characters` with the new display strings; insert the snapshot's franchises, entries, merge edges, characters (with rank, tier and primary entry) and memberships.
4. Clear `is_current` on the previous snapshot and set it on the new one.
5. Delete the fetch's staging rows. Commit.

An opening reads the current snapshot's id once, in its own transaction, and draws only from that snapshot's rows, so an activation that commits during an opening changes nothing about that opening. A fresh install has no snapshot: `GET /api/packs` answers `odds: null` and an opening answers 503 `pool_unavailable`, with the allowance untouched and still accruing, until the owner runs §7.1.

#### 5.1.8 Updating a snapshot later

The owner runs §7.1 again whenever they choose. The new snapshot may rank characters differently (and so move them between tiers), add characters, drop characters or whole entries, and regroup franchises.

- **Owned cards keep the rarity they were granted with** (confirmed, round 2, decision 5). `cards.rarity` is written once, at the grant, and no snapshot touches it. Owned items never change value under the player: a Legendary pulled yesterday stays Legendary in the collection, on the market (`economy.md`) and in a recycle, whatever AniList's favourites did since.
- **Only future grants use the new tiers.** A character that moved from Epic to Legendary is dealt as Legendary from the activation on. A player can then hold it at both rarities, which the collection shows as two entries (§5.5).
- **Names and images refresh from the newest snapshot** (confirmed, round 2, decision 5). Name, native name, image and titles come from the `characters` and `series` rows, which each activation updates. They are presentation, not value, and AniList's image URLs change when an image is re-uploaded. What is frozen on a card is what it is worth and where it came from: its rarity, its variant, its opening, its snapshot and when it was obtained.
- **Completion uses the current snapshot**: pool completion against its characters, franchise completion against its franchises and their current members.
- **A dropped character** (not in the current snapshot) stays in every collection that holds it, with `inCurrentSnapshot: false` and `tier: null`; its entries keep their granted rarity; it counts in the card totals and in no completion figure; packs never deal it again. Its franchises are those of the newest snapshot that contained it, and a franchise no longer in the current snapshot has no completion figure (§6.2). This is the behaviour `collection-overview.md` §3.2 already designs.

#### 5.1.9 Images and network

- **Images**: the browser keeps loading card images from AniList's CDN, as today. The api does not proxy them: a proxy would make the NAS an image server and add an endpoint that fetches by URL. `IMAGE_HOST` is the one host the live CSP allows in `img-src` (C8); ADR 0008 §5's `*.anilist.co` is the ceiling and the CSP is the rule. A unit test reads the `Caddyfile` and fails if `img-src` and `IMAGE_HOST` disagree.
- **Network**: the snapshot command is the only outbound call the system makes, and only when the owner starts it. The endpoint is a constant, and no request input reaches the URL or the query variables (the only ids it sends are ones AniList itself returned in the relations). It runs in the api container, which reaches the internet through its `front` network; `back` stays internal; compose needs no network change. The api server process holds no AniList client: a test asserts that `buildApp` never constructs one.
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
6. For each picked character, `isNew` = the account holds no card of that character yet, at any rarity or variant.
7. Insert the `pack_openings` row (with the snapshot id) and the cards (`slot` in roll order, `rarity` = the slot's tier, `variant` = `standard`, the snapshot id), move `packs_anchor_at`, commit, answer 201.

Because steps 2–7 run under the lock, requests of one account serialise: with one pack available, two parallel openings give one 201 and one 409; two parallel requests with the same `requestId` give one 201 and one 200 with the same cards. `unique (account_id, request_id)` is the backstop: if the lock were ever bypassed, the second insert fails its transaction (a 500) and nothing is opened twice. A request that ends in 409 or 503 leaves no record, so its key can succeed later. Keys are scoped to the account: account B sending A's `requestId` finds nothing of A's and gets its own outcome.

Steps 5 to 7 are one domain function, `dealPack(tx, account, rng, pool)`, whose character source is a parameter: 1c passes the current snapshot's pool, and `economy.md`'s themed packs pass a theme's subset of it, through the same roll and the same writes.

### 5.4 RNG, tiers and odds

- **RNG**: `crypto.randomInt` only (C10), behind an injectable `Rng` (`(min, max) => integer`) so unit tests can script outcomes. `Math.random` already fails lint in `api/`.
- **The owner's odds are per pack** (round 2, decision 3, with the Rare figure lowered in round 3, decision 1): the chance that a 5-card pack contains at least one card of the tier is Rare 80 %, Epic 17.6 %, Legendary 2 %, Mythic 0.33 %; Common fills the rest of each slot.
- **Per slot**: slots roll independently, so a per-pack figure `P` corresponds to a per-slot probability `p = 1 − (1 − P)^(1/5)`: Rare 27.5220 % (`1 − 0.2^(1/5)`), Epic 3.7977 %, Legendary 0.40324 %, Mythic 0.066087 %. As integers out of `ODDS_SCALE` = 1 000 000, each upper tier rounded to the nearest unit and Common the remainder, so the five sum to exactly 1 000 000:

| Tier      | Per slot (out of 1 000 000) | Per slot  | At least one per pack (published) | Expected per pack |
| --------- | --------------------------- | --------- | --------------------------------- | ----------------- |
| Common    | 682 110                     | 68.2110 % | 99.68 %                           | 3.411             |
| Rare      | 275 220                     | 27.5220 % | 80.00 %                           | 1.376             |
| Epic      | 37 977                      | 3.7977 %  | 17.60 %                           | 0.190             |
| Legendary | 4 032                       | 0.4032 %  | 2.00 %                            | 0.0202            |
| Mythic    | 661                         | 0.0661 %  | 0.33 %                            | 0.0033            |

The published per-pack figures are recomputed from the integers (`1 − (1 − n / 1 000 000)^5`, exactly in `BigInt` and rounded to parts per million: Rare 800 000, Epic 176 000, Legendary 19 998, Mythic 3 301), and they round to the owner's numbers. In plain words: about one Legendary in 50 packs, one Mythic in 300.

- **Tier roll, per slot**: `r = randomInt(0, ODDS_SCALE)`; Mythic when `r < 661`, Legendary when `r < 661 + 4 032`, Epic when `r < 4 693 + 37 977`, Rare when `r < 42 670 + 275 220`, otherwise Common. Integers throughout, so the odds are exact.
- **Character pick**: uniform among the tier's characters in the snapshot (ordered by `character_id`) that this pack has not drawn yet: one partial Fisher–Yates shuffle per tier, `randomInt(i, n)` per draw. No pack repeats a character; every tier holds at least `PACK_SIZE` characters (§5.1.4), so a pick never runs out.
- **Completion horizon**, for the record, at a pool of 2 000 (20 Mythic, 80 Legendary): collecting every Mythic takes about 20 × H(20) ≈ 72 Mythic cards, which is about 22 000 packs; every Legendary about 80 × H(80) ≈ 400 Legendary cards, about 20 000 packs. At the 144-pack daily ceiling that is about 150 days; at a casual nine packs a day, years. The market and recycling (`economy.md`) are how players close the gap.
- **One source of truth**: `shared/src/rarity.ts` becomes integer (`RARITIES` with five values in rank order, `RARITY_LABEL` with `Common`, `Rare`, `Epic`, `Legendary`, `Mythic`, `ODDS_SCALE`, `SLOT_ODDS`, `SHARE_SCALE`, `TIER_SHARE`). The float `BASE_WEIGHTS` and `POPULARITY_INFLUENCE` stay until PR 2 deletes their last users; nothing on the server reads them. The UI shows the odds the server returns, never constants of its own: the `web/` block of the ESLint config forbids importing the number constants from `@anime-tcg/shared/rarity` and anything from `@anime-tcg/shared/economy` (`no-restricted-imports` with `importNames`).
- **Published odds** (`GET /api/packs`): `perSlot` (`SLOT_ODDS`), `perPack` (the chance of at least one per pack, in parts per million), `tierSizes` (the current snapshot's character count per tier, so the chance of one given character per card is `perSlot[tier] / scale / tierSizes[tier]`) and the snapshot's version and date. The numbers a player reads are the numbers the server applies, and the economy's model refers to them (`economy.md` §9).
- **The popularity tilt is gone.** Every card of a tier is rolled with the same table. The snapshot id on each card names the tier table that applied.

### 5.5 Collection

- **Entries.** `GET /api/collection` answers the account's cards grouped into entries keyed by (character, granted rarity, variant), each with a count and the first and last time a card of the entry was obtained. A character has one tier per snapshot and every card is `standard` today, so a collection holds **one entry per character**; a second entry for the same character appears only when a snapshot update moved that character's tier and the player then obtained it at the new one (§5.1.8), and later for a Masterwork.
- **Character data per entry**: name, native name, image, `franchiseIds` (primary first), the character's current tier (null when it is not in the current snapshot) and `inCurrentSnapshot`. The franchises themselves come once per response in `franchises` (id, title, native title, start year), so a character's franchise titles do not repeat in every entry.
- **Totals**: `cards` (the same number as `AccountPublic.cards`), `duplicates` (the sum of count − 1 over the entries) and `byRarity` (cards per granted rarity, all five).
- **Completion**, computed by the server against the current snapshot (§5.1.3, §5.1.8): `pool` = owned distinct characters of the snapshot over its character count; `franchises` = for every franchise of the current snapshot, in popularity order, the distinct characters of that franchise the account owns at any rarity over the franchise's distinct member count. Every franchise of the snapshot is listed, owned or not, so a filter can show `0/12` and a franchise whose last card was sold stays in the list.
- **Order**: entries by rarity (Mythic first), then name, then character id. Stable for tests; the UI may re-sort.
- **Size**: bounded by the characters an account has ever owned: at most one snapshot's `SNAPSHOT_CHARACTERS_MAX`, plus those dropped or moved by updates. A complete collection of a 2 000-character pool is about 2 000 entries, some 450 KB of JSON; a new player's answer is a few kilobytes. No pagination in 1c: the overview filters, sorts and pages in the browser (`collection-overview.md` §5.5) and fetches when its tab is shown, not after every opening.
- `AccountPublic.cards`, 0 since 1b (`CARDS_UNTIL_1C`), becomes the account's card count, so the Manage dialog and the delete confirmation show real numbers.
- Cards are named by (character, rarity, variant), never by id. There is no card id for a client to send or tamper with, which is the 1b pattern (C3: what cannot be named cannot be taken). Item 2's listing and recycle use the same naming.
- **No migration** (ADR 0008 §7). The server starts empty; the in-memory collection (`useInventory`) is dropped at the switch. The old browser keys `anime-tcg:inventory:v1` and `anime-tcg:character-pool:v1` are neither read nor deleted.

### 5.6 Reset (owner only)

The owner can reset one account's collection with `reset-collection` (§7.2), as with `reset-password` (round 1, decision 4). There is no route and no button: a player cannot reset their own collection, and the proof of concept's `Reset` goes from the web app (§8). The `Reset` mention in `accounts.md` §3.6 and its §8 copy row are superseded; `ui-designer` updates them in PR 2.

In 1c, one transaction: lock the account row; delete its `pack_openings` (its cards go by cascade); set `packs_anchor_at` to null, so the account is full as on registration; commit. The login, password, sessions and account id stay. Old `requestId`s no longer replay anything because their openings are gone, which is harmless: a client keeps a key only until it gets an answer. From item 2 on, a reset also cancels the account's market listings and applies the Karma rule of `economy.md` §8.10.

### 5.7 Authorisation

Every route calls `requireAccount(req)` (401 `unauthenticated`) and passes the session's account id into the domain function. No account id, card id, opening id or snapshot id appears in any path or body; a `requestId` is looked up only among the acting account's openings.

### 5.8 Logging

At `info`, with the request id: pack opened (account id, opening id, snapshot id, count per rarity, whether it was a replay). From the commands: fetch progress every 25 requests (requests done, estimated remaining, 429s seen); snapshot built (version, entries, franchises, characters, tier counts, skipped by reason, characters whose tier moved, characters dropped and added, franchises merged or split, duration); collection reset (account id, cards and openings removed). At `warn`: a page that failed and the wait before its retry; for skipped items, the reason and the first rejected field path. Never an AniList response body.

## 6. Contract (`shared/src/api.ts`, `shared/src/errors.ts`)

### 6.1 Error codes

New: `no_pack_available` (409) and `pool_unavailable` (503). `no_pack_available` carries `retryAfterSeconds` (the seconds until the next pack) and the `Retry-After` header, the same pair `too_many_failures` uses; the field's comment in `errors.ts` widens to both codes.

### 6.2 Schemas

```
Rarity              "common" | "rare" | "epic" | "legendary" | "mythic"     -- from RARITIES, in rank order
CardVariant         "standard"                                               -- reserved: "masterwork" joins later
PerRarity           { common: integer ≥ 0, rare: integer ≥ 0, epic: integer ≥ 0, legendary: integer ≥ 0, mythic: integer ≥ 0 }
SnapshotInfo        { version: integer ≥ 1, takenAt: date-time }
PublishedOdds       { scale: integer,                        -- 1 000 000
                      perSlot: PerRarity,                    -- sums to scale
                      perPack: PerRarity,                    -- chance of at least one per pack, parts per million
                      tierSizes: PerRarity, snapshot: SnapshotInfo }
PackAllowance       { available: integer 0..cap, cap: integer, intervalSeconds: integer, nextPackInSeconds: integer ≥ 1 | null }
PacksResponse       { allowance: PackAllowance, odds: PublishedOdds | null }      -- null while there is no snapshot
FranchiseRef        { id: integer ≥ 1, title: string, titleNative: string | null, startYear: integer | null }
CharacterPublic     { id: integer ≥ 1, name: string, nameNative: string | null, imageUrl: string,
                      franchiseIds: integer[1..],                     -- primary franchise first
                      tier: Rarity | null,                            -- in the current snapshot; null when not in it
                      inCurrentSnapshot: boolean }
OpenPackBody        { requestId: uuid string }
OpenedCard          { kind: "card", slot: integer 0..PACK_SIZE − 1, character: CharacterPublic, rarity: Rarity,
                      variant: CardVariant, isNew: boolean }
PackOpened          { openingId: uuid, openedAt: date-time, cards: OpenedCard[PACK_SIZE], franchises: FranchiseRef[], allowance: PackAllowance }
CollectionEntry     { kind: "card", character: CharacterPublic, rarity: Rarity, variant: CardVariant, count: integer ≥ 1,
                      firstObtainedAt: date-time, lastObtainedAt: date-time }
Completion          { owned: integer ≥ 0, total: integer ≥ 0 }
FranchiseCompletion { franchiseId: integer ≥ 1, owned: integer ≥ 0, total: integer ≥ 1 }
CollectionTotals    { cards: integer ≥ 0, duplicates: integer ≥ 0, byRarity: PerRarity }
CollectionResponse  { snapshot: SnapshotInfo | null, totals: CollectionTotals,
                      completion: { pool: Completion, franchises: FranchiseCompletion[] },   -- current snapshot; empty without one
                      franchises: FranchiseRef[],                     -- the current snapshot's, plus any an entry names
                      entries: CollectionEntry[] }
```

`rarity` on a card or entry is the card's, as granted; `character.tier` is what packs deal the character as now; they differ only after a tier move (and, later, for a Masterwork). A `franchiseId` an entry names that has no `FranchiseCompletion` row is a franchise no longer in the current snapshot. **Reserved fields**: `kind` is the discriminator a Relic entry (`kind: "relic"`) will join as a second member of a union; `variant` is where `"masterwork"` will appear; `totals` and completion count `kind: "card"` only, and say so in their schema comments, so a Relic cannot change their meaning. Every object is `additionalProperties: false`; the 1b schema guard catches a miss.

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

- No arguments: fetch from AniList (§5.1.5), resuming an unfinished fetch younger than `FETCH_RESUME_MAX_AGE`, then build and activate (§5.1.7). `--restart` discards an unfinished fetch first.
- `--dry-run`: fetch (or resume) and build inside a transaction that is rolled back, and print what activation would do, the franchises included. The staging rows stay, so the next run without `--dry-run` builds from them without another request.
- `--stdin`: read a snapshot file instead of fetching: `{ "format": "anime-tcg-snapshot/2", "takenAt": "<date-time>", "series": [<page bodies>], "relations": [<page bodies>], "characters": { "<seriesId>": [<page bodies>] } }`, the page bodies in AniList's GraphQL shape, at most `SNAPSHOT_FILE_MAX`. It goes through the same schema parse, validation, refusal rules and build, and records `source = 'file'`. The CI stack and the e2e suite seed their pool this way (from the fixture builder in `web/src/test/fixtures.ts`, extended to entries, relations and roles), and an offline install, or a fresh install while AniList is down, loads a saved file.
- `--export`: print the current snapshot as such a file (its entries, merge edges, characters and memberships written back into page bodies), so one install's snapshot can seed another and a fixture can be cut from a real snapshot.
- Output, for example: `Snapshot 2 active: 100 entries in 61 franchises, 2 143 characters (22 mythic, 86 legendary, 214 epic, 535 rare, 1 286 common); 7 skipped; 31 changed tier, 12 dropped, 55 added; 247 AniList requests.` Exit 1 with a one-line reason on refusal; exit 2 when a fetch paused after `ANILIST_MAX_RETRIES` (`Paused after 118 of about 240 requests; run again to resume.`).

### 7.2 `reset-collection`

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/reset-collection.js <login>
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/reset-collection.js <login> --confirm
```

Without `--confirm` it only prints what a reset would remove (`Would reset <login>: 214 cards, 43 openings.`). With it, §5.6 runs and it prints `Collection reset for <login>: 214 cards and 43 openings removed; packs full.` Exit 1 with a one-line reason on an unknown login. Sessions are not touched; a signed-in player sees the empty collection on the next fetch.

## 8. The web change (second PR)

`feat/collection-packs-ui` makes the web app a client of §6. `ui-designer` specifies the new states first (the pack control ready with a count, waiting with a countdown, opening, and cards unavailable; the odds line with the per-pack figures; the collection without `Reset`; five tiers with the tokens below). This section fixes only what the UI needs back and what it may not do.

**Deleted**: `web/src/lib/anilist.ts`, `web/src/hooks/useCharacterPool.ts`, `web/src/lib/pack.ts`, the roll and popularity functions in `web/src/lib/rarity.ts`, `useInventory`'s in-memory store, the browser `Character` and `Card` types (replaced by the shared schemas), `Reset`, the float constants in `shared/src/rarity.ts`, the e2e routes that stub `graphql.anilist.co`, and (round 1, decision 9) the reveal's glow: `CharacterCard`'s per-tier `FRAME_CLASS` shadows, the `legendary-pulse` keyframes and the `.glow-legendary` class.

**Rarity frames (round 1, decision 9)**: the reveal card's frame becomes a flat tier border as in `collection-overview.md` §6.1 (`border-rarity-<tier>/40`, no shadow, no animation), so the reveal and the collection share one rarity treatment from the day the collection moves to the server. This PR is the first to render five tiers, so it carries all four token lines of `web/src/index.css` `@theme` that §6.1 lists: `--color-rarity-common` changes to `#a1a1aa` and `--color-rarity-legendary` to `#fbbf24`, and `--color-rarity-epic` (`#34d399`, emerald) and `--color-rarity-mythic` (`#fb7185`, rose) are added; `--color-rarity-rare` stays `#38bdf8`. The rest of `collection-overview.md` §10 (hover lift, glass badges, gradients) waits for `docs/design/visual-system.md`.

**What the UI needs back**, and nothing more:

- From `GET /api/packs`: `available`, `cap`, `nextPackInSeconds`, `intervalSeconds`, and the published odds (`null` means cards are unavailable).
- From `POST /api/packs/open`: the cards in `slot` order, each with the character's name, native name, image and franchises (resolved through `franchises`), its rarity, variant and `isNew`; the allowance after the opening.
- From `GET /api/collection`: the entries, `franchises`, totals and completion. PR 2 shows the existing collection view over them (one tile per entry, the rarity filter as a view, five tiers); `collection-overview.md` (item 3) builds the full screen on the same answer.

**What the UI does with it**:

- The pack control is enabled when `available ≥ 1` and no opening is in flight. It shows the count and, below the cap, the countdown from `nextPackInSeconds`, counted from the moment the answer arrived. When the countdown ends the UI asks `GET /api/packs` once; it never polls on an interval. The countdown appears on the pack control only: no notification, sound, title change or "come back" prompt (ADR 0004 §6).
- Each click generates `requestId = crypto.randomUUID()`. If the request gets no answer (network failure), the UI keeps that id and sends it again on the next click, so a lost response shows the cards the server actually dealt instead of opening a second pack. Any answer from the server discards it.
- The reveal is the server's cards in `slot` order with `isNew`; the pull summary counts their rarities. The UI never computes an outcome. A Mythic or Legendary card gets no extra animation, sound or delay: ADR 0004 §6 rules out near-miss and suspense effects, and the visual system has none.
- `Collection (N)` is `totals.cards` from `GET /api/collection`, fetched at sign-in and refetched after each opening (until item 3 replaces that with its stale-marking rule). The Collection tab renders the entries; the rarity filter stays a view over them.
- The odds line shows the server's per-pack figures (and, where `ui-designer` wants them, the per-slot ones) instead of constants.
- The pool is no longer loaded at boot or while signed out (`App.tsx`), and the AniList error banner gives way to the cards-unavailable state.

**CSP**: the browser no longer talks to AniList's API, so `connect-src` becomes `'self'` alone; `img-src` keeps `https://s4.anilist.co`. The `Caddyfile`, the CI `docker` job's `EXPECTED_CSP` and `web/e2e/stack.spec.ts` change together. That makes PR 2 T3 as well (CSP/headers), on top of T1 for rendering third-party strings.

## 9. Tests required (minimum, T3)

**Unit** (`api/src/**/*.test.ts`, `shared/`):

- Allowance: a new account has `C`; opening from full leaves `C − 1` with `nextPackInSeconds` of one interval; `C` openings back to back leave 0; one interval later 1; a week later `C`; opening while the timer runs keeps the countdown; a clock set back an hour gives 0, never negative, and `nextPackInSeconds` ≥ 1; set forward a year gives `C`; a fraction of a second rounds up.
- Odds, exhaustively: every `r` from 0 to `ODDS_SCALE − 1` (one million values) through the tier function yields exactly `SLOT_ODDS`'s counts; `SLOT_ODDS` sums to `ODDS_SCALE`; the per-slot integers are the rounded `1 − (1 − P)^(1/5)` of the owner's per-pack figures; the published `perPack` figures, computed in `BigInt`, are 800 000, 176 000, 19 998 and 3 301 parts per million and round to 80 %, 17.6 %, 2 % and 0.33 %; the per-character rates fall strictly from Common to Mythic for the fixture's split and for N = 500, 2 000 and 6 000.
- Tiering: ranks by favourites with ties by id ascending, and a tie straddling a boundary puts the lower id in the higher tier; cumulative rounding at N = 500, 501, 2 000 and 6 000 sums to N; every tier ≥ `PACK_SIZE` at `SNAPSHOT_CHARACTERS_MIN`, and N = 499 is refused; equal favourites everywhere still give a deterministic split.
- Franchises: SEQUEL, PREQUEL, SIDE_STORY and PARENT merge, in either direction; SPIN_OFF, ALTERNATIVE, CHARACTER, SUMMARY, COMPILATION, CONTAINS, ADAPTATION, SOURCE and OTHER do not; two top-100 entries joined through one and through two entries outside the top 100 merge, through three do not; a relation to a non-anime node is ignored; the franchise id is the smallest member id and its title that entry's; an entry with no merging relation is a franchise of one.
- Memberships: a character in three entries of one franchise counts once in it; a character in two franchises counts once in each; a BACKGROUND appearance adds nothing; pool completion counts each character once.
- Pick: a scripted RNG gives the expected characters; always `PACK_SIZE` different ones; five Mythic slots draw five different Mythics from a tier of exactly `PACK_SIZE`.
- AniList validation: each rejection rule of §5.1.6 on its own, with a valid neighbour accepted; an entry id repeated across pages; `SNAPSHOT_SERIES_MIN − 1` entries or `SNAPSHOT_CHARACTERS_MIN − 1` characters → refused; more than `SNAPSHOT_CHARACTERS_MAX` → refused; hops beyond `FRANCHISE_MAX_REQUESTS` → refused; `IMAGE_HOST` equals the host in the `Caddyfile`'s `img-src`.
- Snapshot file: `--export` of a built snapshot fed to `--stdin` builds an identical pool (same tiers, franchises, memberships and primaries).
- Completion: owned and total per franchise and for the pool, with a dropped character, a dropped franchise and a character held at two rarities.
- Reserved fields: every card written in 1c is `variant = 'standard'`; every entry and opened card says `kind: "card"`.

**Statistical** (`api/src/domain/packs/roll.odds.test.ts`, in the unit project so it runs on every push; about three million calls to `crypto.randomInt`, a few seconds), against a fixture snapshot of 1 000 characters split 10 / 40 / 100 / 250 / 600 by the tier rule:

- **Tier draw** against the published `SLOT_ODDS`: 200 000 packs (1 000 000 slots) through the real deal, the count per tier against 1 000 000 × the per-slot odds, Pearson chi-square with 4 degrees of freedom at significance α = 0.001 (critical value 18.47). **Sized for Mythic**: its expected count is 661, a hundred times the usual minimum of 5 for the chi-square approximation, so the approximation holds for every tier and no separate exact binomial test is needed; the exhaustive mapping test above already proves every threshold, so this test only has to catch wrong wiring to the RNG. Power: Mythic drawn 1.25 times as often as published is caught with probability 0.99 (1.2 times: 0.88); Legendary 1.2 times as often: above 0.999; a shift of 0.5 percentage points from Common to Rare: above 0.999.
- **Character draw within each tier** against uniform: Mythic slots are too rare for natural draws to test the pick (661 in the run above, 66 per Mythic character), so each tier's pick is tested with the tier forced through the scripted tier seam and the character pick on the real RNG: 2 000 draws per character (20 000 Mythic, 80 000 Legendary, 200 000 Epic, 500 000 Rare, 1 200 000 Common picks, in packs of five). Chi-square per tier with 9, 39, 99, 249 and 599 degrees of freedom at α = 0.001 (critical values 27.88, 72.05, 148.23, 323.69 and 711.68). Power: one character drawn 1.3 times as often as the others of its tier is caught with probability at least 0.94 in every tier; 1.2 times with at least 0.91 in the Mythic, Legendary and Epic tiers. The no-repeat rule makes draws within a pack slightly dependent, which only makes the test conservative.
- Deterministically, on the same runs: no pack repeats a character, every pack has `PACK_SIZE` cards, and each card's character belongs to the tier its slot rolled.
- A correct implementation fails one of the six tests about six times in a thousand runs. A failure is a finding: the message prints the observed and expected counts, and nobody reruns it to green without reading them or changes the sample size or α to make it pass.

**Route** (`api/test/packs.test.ts`, `api/test/collection.test.ts`): every row of §6.3, the happy path and each declared error; an extra field → 400; a query string on a GET → 400; a missing Origin on the POST → 403; signed out → 401 on each route; a new account reads `C` available, `perSlot` equal to `SLOT_ODDS`, the four `perPack` figures and `tierSizes` equal to the fixture's; an opening returns `PACK_SIZE` different characters in slots 0 to `PACK_SIZE − 1`, each card's rarity equal to its character's tier and its variant `standard`, and the collection and `account.cards` reflect them; the opening after the last available pack → 409 with `retryAfterSeconds` of one interval (fake clock) and `Retry-After`; no snapshot → `odds: null`, an opening 503, the allowance unchanged; deleting an account removes its cards and openings and leaves snapshots, characters and series; the migration on a database with 1b accounts leaves them full.

**Snapshot update** (route level, two fixture snapshots): after activating a second snapshot in which character A moved from Epic to Legendary, B was dropped, franchise F left the top 100 and two franchises merged: every card granted earlier keeps its rarity and snapshot id, and shows the new name and image; A is dealt only as Legendary; a player holding A at both rarities sees two entries and pool completion counts A once; B shows `inCurrentSnapshot: false` and `tier: null`, counts in `totals` and in no completion, and is never dealt again; F has no `FranchiseCompletion` row and still appears in `franchises` for the entries that name it; the merged franchise counts each of its characters once; an opening that read snapshot 1 before the activation committed deals only from snapshot 1.

**Concurrency** (route, parallel `inject()` calls): one pack and two different `requestId`s → one 201, one 409, `PACK_SIZE` cards in the table; `C` packs and `C + 1` parallel openings → `C` × 201 and one 409; one pack and the same `requestId` twice → one 201 and one 200 with the same `openingId` and cards; an opening racing `reset-collection` → the opening's cards are either all removed by the reset or all present after it, never part of them.

**Snapshot command** (`api/test/snapshot.test.ts`, against a local `node:http` server): a good set of answers builds and activates a snapshot with the expected request count, franchise hops and pace (fake timers); a 429 with `Retry-After` waits that long and retries; one without waits `ANILIST_DEFAULT_RETRY_AFTER`; a 500, a stall past `ANILIST_TIMEOUT`, a body over `ANILIST_MAX_BODY`, invalid JSON and a GraphQL `errors` answer back off and retry, and after `ANILIST_MAX_RETRIES` the command exits 2 with the staged pages kept; the next run resumes at the first missing page and sends no request for a stored one; a fetch older than `FETCH_RESUME_MAX_AGE` starts over; a 400 stops at once; a refused build leaves the current snapshot exactly as it was; `--dry-run` writes no snapshot; the api server makes no request to the local AniList stand-in during the whole route suite.

**Reset command**: without `--confirm` nothing changes; with it the account's cards and openings are gone and `packs_anchor_at` is null, other accounts are untouched, and the account's sessions still work; an unknown login exits 1.

**Adversarial** (`api/test/security/packs.security.test.ts`):

- Replay: the same `requestId` sequentially and in parallel → one opening, the allowance spent once; account B sending A's `requestId` → B's own outcome, never A's cards.
- Forged, flipped, truncated and expired session cookies → 401, nothing written.
- Tampered outcome payloads: a body with `cards`, `rarity`, `tier`, `variant`, `kind`, `characterIds`, `slot`, `seed`, `odds`, `snapshotId`, `accountId` or `available` → 400 each, nothing written; a `requestId` that is not a uuid, is empty, or is 10 000 characters long → 400.
- Brute force against the limit: with packs available, the POST after `PACK_RATE_LIMIT` is used up within its window → 429 `rate_limited` with `Retry-After`.
- Clock: a `Date` header or a client time anywhere in the request changes nothing.
- No player reset: the route inventory has no reset, snapshot or AniList route; a POST to `/api/collection/reset` → 404.
- Hostile pool content (through `--stdin`): names, native names and titles with `<script>`, an `<img onerror>`, an RTL override and zero-width characters are stored and returned byte for byte as text; a NUL anywhere → that item skipped; image URLs `http://s4.anilist.co/…`, `https://s4.anilist.co.evil.example/…`, `https://user@s4.anilist.co/…`, `https://s4.anilist.co:8443/…`, `javascript:…` and `data:…` → each skipped; a relation cycle and a relation from an entry to itself build a finite franchise; 10 000 relation edges on one entry → only 200 read; a file with 6 001 valid characters → refused; a file over `SNAPSHOT_FILE_MAX` or nested 10 000 levels deep → refused without exhausting memory.
- Dependency audit: nothing added (the PR states it; manifests change in scripts only).

**Web (PR 2)**: unit tests for the pack control's states, the countdown's single refetch and the `requestId` kept after a network failure; the T1 test that hostile character names and franchise titles render as text in the reveal and in the collection; a test that `CharacterCard` renders no shadow or animation class for any of the five tiers. e2e (`web/e2e`, against the compose stack with a snapshot seeded through §7.1): sign in, open `C` packs, and the next is disabled with a countdown; a reload keeps `Collection (N)`; `localStorage` holds no collection or pool key; the page makes no request to `graphql.anilist.co`; the CSP header is the narrowed one.

## 10. Acceptance criteria

1. All routes in §6.3 exist, are schema-validated, carry their limit, and pass the tests in §9; `api/src` coverage stays ≥ 85 %.
2. The browser holds no roll, no pool and no collection: the files listed in §8 are gone, `connect-src` is `'self'`, and e2e proves there is no request to AniList's API. The reveal shows flat tier borders for all five tiers and no glow.
3. AniList is called only by `snapshot-pool`, run by the owner; the api server holds no AniList client; no test or CI job calls AniList.
4. The statistical and exhaustive tests pass at the stated sizes and α.
5. `docs/05-security.md`: C1 live for collection and packs, the C6 pack override live, C8 narrowed, C10 live; a T3 row per PR; the threat model gains the owner-run outbound call, AniList content (network or file) as untrusted input, the allowance clock, replayed openings and the owner's reset. `docs/04-deployment.md`: `snapshot-pool` (first snapshot on a fresh install, update, resume, `--stdin` and `--export`), `reset-collection`, and what an install without a snapshot looks like.
6. On the acceptance stack, the owner takes a real snapshot and the PR records its request count, its franchise count and its duration; a new account opens `C` packs and then waits for the countdown; two tabs together cannot open more than the allowance; a reload keeps the collection; the collection answer shows pool and franchise completion.

## 11. Decision record

The owner's answers, as far as they concern 1c. ADR 0011 records the ones that change ADR 0004.

**Round 1** (answers to this spec's first open questions and to `economy.md`'s):

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                      | Where      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 2   | Completion: show both series completion (per anime: owned / total characters of that anime) and completion of the whole pool. The starting pool is all characters of the top 100 anime by AniList popularity with role MAIN or SUPPORTING.                        | §5.1, §5.5 |
| 3   | Rarity: fixed rarity per character, decided by character popularity; each character has one rarity set by its popularity rank, and a pack rolls the tier, then a character from that tier. This supersedes the earlier answer to keep the popularity tilt.        | §5.1.4     |
| 4   | Reset: an owner-only CLI reset of one account's collection, like reset-password; no button for players.                                                                                                                                                           | §5.6, §7.2 |
| 8   | AniList: no live refresh. Take a snapshot of the pool so AniList changes never influence the live game, and keep an owner-run option to update the snapshot (and the popularity ratings) later. The earlier design (refresh every 24 h, hourly check) is dropped. | §5.1, §7.1 |
| 9   | The glowing rarity frames on the pack reveal are replaced in the 1c web PR (`collection-overview.md` §6.1 borders; the glow animation deleted).                                                                                                                   | §8         |

Round 1 decisions 1, 5, 6 and 7 (recycle, the name Karma, the player market, the pack shop) are `economy.md`'s.

**Round 2** (answers to this spec's second open questions):

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                           | Where          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 1   | Five tiers: Common, Rare, Epic, Legendary, Mythic (the name "Mythic" is kept).                                                                                                                         | §4.1, §5.4     |
| 2   | Tier split by AniList favourites rank: Mythic 1 %, Legendary 4 %, Epic 10 %, Rare 25 %, Common 60 % of the pool.                                                                                       | §5.1.4         |
| 3   | Pack odds per pack, as the chance a 5-card pack contains at least one: Rare 94.1 % (superseded by round 3, decision 1), Epic 17.6 %, Legendary 2 %, Mythic 0.33 %; Common fills the rest of each slot. | §5.4           |
| 4   | Series completion groups AniList entries into franchises via AniList relations (sequels, prequels, side stories); a character counts once per franchise.                                               | §5.1.2, §5.1.3 |
| 5   | After a snapshot update owned cards keep their granted rarity; names and images refresh from the newest snapshot.                                                                                      | §5.1.8         |
| 6   | Reserve, do not build: "Masterwork" versions of cards (a variant of a character's card with increased rarity) and "Relics" (a separate collectible kind, details later).                               | §2, §4.1, §6.2 |

These answer and close the second round's three questions (tier split, odds per slot, what counts as one anime).

**Round 3** (answer to this spec's last open question):

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                                                               | Where              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | Rare versus Common: lower the Rare odds so a given Rare character is rarer than a given Common one: Rare at least once per pack about 80 % (per slot about 27.5 %); Epic 17.6 %, Legendary 2 %, Mythic 0.33 % per pack unchanged; Common fills the rest. This supersedes round 2 decision 3's Rare 94.1 %. | §4.2, §5.1.4, §5.4 |

The owner's economy answers of round 3 (no tier recycling, recycling duplicates for Karma, upgrades only through the mini-games) are `economy.md`'s; for 1c they change only the out-of-scope note on Masterworks (§2).

## 12. Open questions

None. Every question of the three rounds is answered (§11).

ADRs: ADR 0011 records round 1's decisions 3 and 8, round 2's tiers, Mythic and reserved Masterwork and Relics, and round 3's rule that upgrades come only from the mini-games, together with the economy's reversals of ADR 0004. ADR 0009 says `shared/` holds the constants "the UI displays"; they still live there, and the UI now displays the server's copy of them.
