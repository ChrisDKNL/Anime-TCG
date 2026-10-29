# Collection and packs (Sprint 1c, server side)

Manager-written technical spec (non-UI). Moves the character pool, pack grants, pack openings, rarity rolls and the collection from the browser to the API, on the 1b accounts (`accounts-api.md`), as ADR 0008 §1–2 requires. The pool is an owner-managed snapshot of AniList, and each character has one of six fixed rarity tiers set by its popularity rank; a pack's five slots roll from per-slot tables with a floor each, and three special rules (pity, Enchanted and Radiant packs) sit on top (§5.4). The collection answer carries what the collection overview needs (`collection-overview.md` §3.8), with completion per franchise. §8 is the web change: it lists what the UI needs back; the card, its frames and colours are `card-and-rarity.md`'s. Security tier **T3** (pack grants and openings, RNG; the web PR also changes the CSP). `security-officer` review and an adversarial test pass are required before each PR opens; a T3 change never merges on the day it is opened unless the owner says so.

Written 2026-10-29; revised five times the same day for the owner's decisions (§11). The fourth revision (round 4: six tiers, slot floors, pity, Enchanted and Radiant packs, the rank on the card, stricter image and name validation) supersedes the five-tier design everywhere in this spec; the fifth records the owner's answers to its two questions (round 5: the standard pack's shares, and a cap of 60 characters per franchise). The server code on `feat/collection-packs` implements the five-tier design and changes to this one.

## 1. Goal

A signed-in player opens packs that the server grants: one accrues every interval and a few can be stored. The server, not the browser, rolls each slot's rarity tier (Common, Uncommon, Rare, Epic, Legendary or Mythic) from that slot's table, applies the special-pack rules, picks a character of each tier, records the opening and adds the cards to the account's collection. The characters come from a snapshot the owner takes of AniList: every MAIN and SUPPORTING character of the 100 most popular anime, each with one tier fixed by its popularity rank, and the anime grouped into franchises. AniList is never called while the game runs, so nothing AniList changes reaches the live game until the owner takes a new snapshot. The collection answer carries the franchises, dates, totals and completion figures (whole pool and per franchise) the collection overview shows. At the end of 1c the game is playable end to end again, and Sprint 1 (1a, 1b, 1c) can be released (`docs/03-release-process.md`).

## 2. Out of scope

- Karma, the ledger, the player market, the pack shop and recycling duplicates for Karma (roadmap item 2, `economy.md`). In 1c a card has no Karma value; these tables are what item 2 builds on. §5.4.7 fixes how the special-pack rules treat the shop's themed packs, so `economy.md` inherits them.
- **Masterwork cards and Relics.** The owner has reserved both (§11, round 2, decision 6): a Masterwork is a variant of a character's card with a higher rarity than the character's tier, and a Relic is a separate kind of collectible. Upgrades of any kind come only from the mini-games (items 5 and 6, round 3), never from packs or recycling. **Neither is designed yet**: no rule, odds, source or value exists for them. 1c only reserves the column and the contract fields that let them arrive later without a breaking migration (§4.1, §6.2).
- Packs won as game prizes (items 5, 6). They will be a separate counter consumed by the same opening path (`economy.md` §8.11); the allowance here does not change for them.
- The collection overview's screen (item 3, `collection-overview.md`). 1c serves the data it needs (§5.5); search, filters, sort and pages are the browser's.
- Profile and its next-pack timer (item 4). In 1c the countdown lives on the pack control.
- Collection download (item 9).
- An image proxy (§5.1.9).
- Any live or scheduled AniList refresh (round 1, decision 8).
- The visual design of the card, its frames, the pack control, countdown, reveal, odds page and collection states: `card-and-rarity.md` (the card, the six frames, the special-pack lines, the pity line and the odds page) and `ui-designer`'s 1c web spec (§8).

## 3. Delivery

Two pull requests, in order, each through the full gate:

1. **`feat/collection-packs`** (this spec, everything except §8): the migration; `api/src/domain/pool/` (AniList client, validation, franchises, tiering, snapshot build), `api/src/domain/packs/` (allowance, pack plan, roll, opening) and `api/src/domain/collection/` (entries, totals, completion, reset); routes under `api/src/routes/packs/` and `api/src/routes/collection/` with `PACK_RATE_LIMIT` in `routes/limits.ts`; the owner commands `snapshot-pool` and `reset-collection` (§7); shared schemas and constants; tests; docs. The api server gains no background job for the pool. The web app is left as it is (browser pool, client roll, in-memory collection), so `main` stays playable between the two merges; the float constants it imports stay until PR 2 (§5.4.8).
2. **`feat/collection-packs-ui`** (§8): the web app becomes a client of these routes, the browser's AniList, roll and pool code are deleted, the CSP narrows, and the card of `card-and-rarity.md` replaces the proof of concept's card.

Sprint 1 is released after PR 2 merges.

## 4. Data model

### 4.1 Tables

```
enums
  rarity              common, uncommon, rare, epic, legendary, mythic   -- in rank order
  card_variant        standard                                        -- reserved: 'masterwork' is added later (ALTER TYPE ... ADD VALUE)
  item_kind           card                                            -- reserved: 'relic' is added later
  character_role      main, supporting
  pack_kind           standard, enchanted, radiant                    -- §5.4.3

pool_snapshots                                 -- one row per snapshot; never deleted (cards name the one that granted them)
  id                  integer pk generated always as identity   -- the version: 1, 2, 3 ...
  source              text not null            -- 'anilist' or 'file' (§7.1)
  taken_at            timestamptz not null     -- when the fetch began: AniList's state at that moment
  activated_at        timestamptz not null
  is_current          boolean not null         -- unique index on (is_current) where is_current: at most one
  series_count        integer not null
  franchise_count     integer not null
  character_count     integer not null
  tier_counts         integer[6] not null      -- common, uncommon, rare, epic, legendary, mythic; check cardinality = 6

series                                         -- latest display data of every anime entry ever in a snapshot; never deleted
  id                  integer pk               -- AniList media id
  title               text not null            -- English, else romaji
  title_native        text null
  start_year          smallint null

characters                                     -- latest display data of every character ever in a snapshot; never deleted
  id                  integer pk               -- AniList character id
  name                text not null            -- name.full, trimmed; rendered as text
  name_native         text null
  image_url           text not null            -- a canonical https URL on IMAGE_HOST (§5.1.6, §5.1.9);
                                               -- check like 'https://IMAGE_HOST/%'

pool_snapshot_franchises                       -- the franchises of a snapshot (§5.1.2)
  snapshot_id         integer not null references pool_snapshots(id)
  franchise_id        integer not null references series(id)   -- the smallest AniList id among its top-100 entries (its anchor)
  popularity_rank     smallint not null        -- the best popularity_rank of its entries
  primary key (snapshot_id, franchise_id)

pool_snapshot_series                           -- the 100 anime entries of a snapshot
  snapshot_id         integer not null references pool_snapshots(id)
  series_id           integer not null references series(id)
  franchise_id        integer not null
  popularity_rank     smallint not null        -- 1 .. SNAPSHOT_SERIES, AniList's POPULARITY_DESC order among the listed entries (§5.1.6)
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
  favourites_rank     integer not null         -- 1 = most favourited in this snapshot (§5.1.4); served as CharacterPublic.rank
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
  kind                pack_kind not null       -- §5.4.3; replayed as stored
  pity                boolean not null         -- slot 5's Mythic was forced by pity (§5.4.3); check (not pity or kind <> 'radiant')
  opened_at           timestamptz not null
  unique (account_id, request_id)

cards                                          -- one row per character card; duplicates are separate rows
  id                  uuid pk default gen_random_uuid()   -- internal: never in a request or a response
  account_id          uuid not null references accounts(id) on delete cascade
  opening_id          uuid not null references pack_openings(id) on delete cascade
  slot                smallint not null        -- 0 .. PACK_SIZE - 1, the reveal order (slot 0 is the owner's "slot 1");
                                               -- check between 0 and PACK_SIZE - 1
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
  packs_since_mythic  integer not null default 0   -- free packs opened since the account's last Mythic card (§5.4.5);
                                                   -- check between 0 and PITY_PACKS - 1
  free_packs_opened   integer not null default 0   -- free packs opened since registration or the last reset (§5.4.5); check ≥ 0
```

Rules:

- **The account row is the lock.** Every path with stakes (opening and reset here; listing, buying, the shop and recycling later) starts with `SELECT ... FOR UPDATE` on the acting account's `accounts` row, so two requests of one account run one after the other and all of them share one lock order. The allowance and both pack counters live on that row for the same reason: the row that is locked is the row that changes.
- **A card is a row**, duplicates included, never a counter. Each card names the opening it came from and the snapshot that granted it, so every pull can be audited against the tier table that was in force, and item 2 can move or remove exactly one copy.
- **A card's rarity is the card's, frozen.** `cards.rarity` is copied from the snapshot's tier at the grant, and no snapshot update writes it (§5.1.8). It is a property of the card, not of the character, which is also what lets a later Masterwork carry a rarity above its character's tier.
- **An opening records what kind of pack it was** (`kind`, `pity`), so a replay answers exactly what was dealt and an audit can recompute the counters from the openings (§5.4.5).
- **Reserved, not built**: `card_variant` and `item_kind` have one value each today. A Masterwork arrives as a new `card_variant` value (an additive enum change, existing rows keep `standard`); a Relic arrives as its own table and a new `item_kind` value, beside `cards`, so nothing in this model has to be rewritten for either.
- **Snapshots, characters and series are never deleted.** Cards reference them without cascade; a character that leaves the pool keeps rendering in every collection that holds it.
- **Card ids stay inside the server.** No request or response carries one; the API names a collection entry by character, rarity and variant (§5.5).
- Deleting an account removes its openings and cards (`on delete cascade`, as `accounts.md` promises: the account "and every card in it"). Snapshot, character and series rows are shared reference data and stay.
- The staging tables hold only what the schema parse of §5.1.6 kept, never a whole AniList body, and are emptied when a snapshot is built from them or a fetch is restarted.
- Migration: `0003_collection_packs.sql` has not reached `main`, so the build rewrites it in place for this model (six-value `rarity`, `pack_kind`, the opening's `kind` and `pity`, `tier_counts` of six, the two account counters) instead of adding a `0004`. A development or acceptance database that ran the five-tier `0003` is recreated (`down --volumes`); none holds data worth keeping. The app role gets its grants on the new tables from 0001's default privileges; `db-role.test.ts` gains an insert into `cards`. 0003 reached `main` with PR #28; the hardening after its security review is the forward migration `0004_packs_hardening.sql`: the checks on `cards.slot` and `characters.image_url` above, and the app role's rights cut to what the requests and owner commands use. It keeps `UPDATE` on `accounts`, `characters` and `series` (the upserts) and on `pool_snapshots` (`is_current`, and the activation's table lock), and `DELETE` on `pack_openings` (the reset), `pool_fetches`, `sessions`, `auth_throttle` and `accounts`; it loses `UPDATE` and `DELETE` on `cards` and the five `pool_snapshot_*` tables, `UPDATE` on `pack_openings`, and `DELETE` on `characters`, `series` and `pool_snapshots`. An account's or an opening's cards still go by cascade, which runs with the table owner's rights; `db-role.test.ts` pins the whole grant table.

### 4.2 Parameters

Every number this spec uses, in one place. The game numbers live in `shared/src/economy.ts` (exported as `@anime-tcg/shared/economy`; ADR 0004 wants them in one file, and item 2 adds its own there) and, for tiers, odds and the special-pack rules, in `shared/src/rarity.ts`. The AniList numbers are politeness towards AniList and live with the pool code.

| Name                                | Value                                                                           | Meaning                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `PACK_SIZE`                         | 5                                                                               | cards per pack, all different characters                                                    |
| `PACK_INTERVAL_MINUTES`             | 10                                                                              | one free pack accrues per interval                                                          |
| `PACK_CAP`                          | 3                                                                               | free packs stored at most; a new account starts with this many                              |
| `ODDS_SCALE`                        | 1 000 000                                                                       | every table and chance below is an integer out of this                                      |
| `SLOT_FLOOR`                        | common, common, common, uncommon, rare                                          | the lowest tier each slot of a pack can hold (§5.4.1)                                       |
| `SLOT_ODDS`                         | five tables, §5.4.1                                                             | the tier each slot of a standard pack rolls; each sums to `ODDS_SCALE`                      |
| `ENCHANTED_INTERVAL`                | 10                                                                              | every 10th free pack is Enchanted (§5.4.3)                                                  |
| `ENCHANTED_SLOT_ODDS`               | epic 850 000, legendary 137 500, mythic 12 500                                  | slot 5 of an Enchanted pack                                                                 |
| `RADIANT_ODDS`                      | 400                                                                             | the chance that a pack is Radiant: 1 in 2 500                                               |
| `RADIANT_SLOT_ODDS`                 | epic 850 000, legendary 137 500, mythic 12 500                                  | slots 1 to 4 of a Radiant pack; its slot 5 is Mythic                                        |
| `PITY_PACKS`                        | 300                                                                             | the 300th free pack in a row without a Mythic has one in slot 5                             |
| `SHARE_SCALE`                       | 10 000                                                                          | tier bands are integers out of this                                                         |
| `TIER_BAND`                         | mythic 200, legendary 600, epic 1 200, rare 2 000, uncommon 2 500, common 3 500 | 2 %, 6 %, 12 %, 20 %, 25 %, 35 % of the snapshot's characters, by favourites rank (§5.1.4)  |
| `SNAPSHOT_SERIES`                   | 100                                                                             | anime entries in a snapshot: AniList's top by `POPULARITY_DESC`                             |
| `SNAPSHOT_SERIES_MIN`               | 90                                                                              | a snapshot with fewer valid entries is refused                                              |
| `SNAPSHOT_CHARACTERS_MIN`           | 500                                                                             | a snapshot with fewer valid characters is refused (a sanity floor; the tier rule needs 225) |
| `SNAPSHOT_CHARACTERS_MAX`           | 6 000                                                                           | a snapshot with more is refused (bounds every response of §6)                               |
| `SNAPSHOT_CHARACTERS_PER_FRANCHISE` | 60                                                                              | each franchise keeps its 60 most-favourited characters (§5.1.3)                             |
| `SNAPSHOT_FILE_MAX`                 | 64 MB                                                                           | the largest `--stdin` file                                                                  |
| `FRANCHISE_RELATIONS`               | `SEQUEL`, `PREQUEL`, `SIDE_STORY`, `PARENT`                                     | the AniList relation types that merge entries into one franchise (§5.1.2)                   |
| `FRANCHISE_MAX_HOPS`                | 2                                                                               | entries outside the top 100 a merge path may pass through                                   |
| `FRANCHISE_MAX_REQUESTS`            | 40                                                                              | relation requests a fetch may make for the hops                                             |
| `ANILIST_SERIES_PER_PAGE`           | 50                                                                              | AniList's page maximum; also the batch size of a relations request                          |
| `ANILIST_CHARACTERS_PER_PAGE`       | 25                                                                              | per role connection, per request (§5.1.5)                                                   |
| `ANILIST_REQUEST_GAP`               | 2.5 s                                                                           | at most 24 requests a minute, below AniList's degraded 30                                   |
| `ANILIST_MAX_REQUESTS`              | 1 000                                                                           | a fetch that would need more stops and is refused                                           |
| `ANILIST_MAX_RETRIES`               | 5                                                                               | consecutive failures of one request before the fetch pauses (resumable)                     |
| `ANILIST_DEFAULT_RETRY_AFTER`       | 60 s                                                                            | the wait after a 429 without `Retry-After`                                                  |
| `ANILIST_TIMEOUT`                   | 10 s                                                                            | per request                                                                                 |
| `ANILIST_MAX_BODY`                  | 2 MB                                                                            | per response; a page is tens of kilobytes                                                   |
| `FETCH_RESUME_MAX_AGE`              | 24 hours                                                                        | an unfinished fetch older than this is started over                                         |
| `NAME_MAX`, `TITLE_MAX`             | 200, 300 characters                                                             | longer strings are rejected                                                                 |
| `IMAGE_HOST`                        | `s4.anilist.co`                                                                 | the one image host the CSP allows (C8)                                                      |
| `IMAGE_URL_MAX`                     | 2 048 characters                                                                | a longer image URL is rejected; AniList's are under 100                                     |

## 5. Behaviour

### 5.1 The character pool: an owner-managed snapshot

The server picks the cards, so the pool moves to the server and the browser stops calling AniList. The api server does not call AniList either: the pool is a snapshot that only the owner's command (§7.1) takes, and the game reads only the current snapshot.

#### 5.1.1 What a snapshot holds

- **Entries**: the first `SNAPSHOT_SERIES` anime of AniList's `Media(type: ANIME, sort: POPULARITY_DESC, isAdult: false)`, each with id, title (English, else romaji), native title, start year, popularity, popularity rank, genres and its relations. `isAdult: false` keeps adult entries out by AniList's own flag; the top 100 by popularity hold none today, so it guards later snapshots.
- **Franchises**: the entries grouped by AniList relations (§5.1.2). Series completion is per franchise.
- **Characters**: every character with role `MAIN` or `SUPPORTING` in at least one entry, each with id, name, native name, image, favourites, favourites rank, tier, primary entry and its memberships. `BACKGROUND` characters are not fetched. Each franchise contributes at most its `SNAPSHOT_CHARACTERS_PER_FRANCHISE` most-favourited characters (§5.1.3).

#### 5.1.2 Franchises

The owner's rule (round 2, decision 4): series completion groups AniList entries into franchises through their relations, and a character counts once per franchise.

- **Which relations merge**: `SEQUEL`, `PREQUEL`, `SIDE_STORY` and its inverse `PARENT`, between two `ANIME` entries, read in both directions (AniList usually lists a relation on both sides, not always). Not merged: `SPIN_OFF` (a different cast or a different show, such as a school-comedy spin-off), `ALTERNATIVE` (another adaptation of the same source, such as a remake), `CHARACTER` (crossovers that share characters), `SUMMARY`, `COMPILATION` and `CONTAINS` (recaps, whose characters already belong to the entries they recap), `ADAPTATION` and `SOURCE` (manga and novels, not anime), `SAME_UNIVERSE` and `OTHER`.
- **Paths through entries outside the top 100**: two top-100 entries belong to one franchise when a path of merging relations connects them that passes through at most `FRANCHISE_MAX_HOPS` entries outside the top 100. Season 1 and season 3 in the top 100 with season 2 outside it are one franchise. Entries outside the top 100 only connect; their characters are not fetched, and they are not members of the franchise.
- **Identity**: a franchise's id is the smallest AniList id among its top-100 entries (in practice its oldest entry, since AniList assigns ids in creation order), and its title, native title and start year are that entry's. The id stays the same across snapshots while that entry stays in the top 100. A franchise's `popularity_rank` is the best rank among its entries.
- **A franchise of one** is an entry no merging relation connects to another top-100 entry.

#### 5.1.3 A character in several entries and franchises

- **Membership**: a character belongs to every snapshot entry in which AniList lists it as MAIN or SUPPORTING (one `pool_snapshot_memberships` row each), and so to the franchises of those entries. A BACKGROUND appearance is not a membership.
- **Primary**: its primary entry is the most popular entry it belongs to, and its primary franchise is that entry's franchise. The card, the reveal and the market name the primary franchise first (`franchiseIds[0]`, §6.2).
- **Franchise completion** counts a character **once per franchise**: one copy of a character in seasons 1, 2 and 3 counts once towards that franchise. A character that belongs to two different franchises (a crossover star, MAIN in both) counts once in each.
- **Pool completion** counts each character **once**, whatever its memberships and its tiers: owned distinct characters of the current snapshot over the snapshot's character count.
- **In a pack** the character is one entry of the pool with one tier, so belonging to several entries does not make it more likely.
- **The franchise cap** (round 5, decision 2, "Owner, 2026-10-29"): after validation and the franchises (§5.1.2), and before ranking and tiers (§5.1.4), each franchise keeps its `SNAPSHOT_CHARACTERS_PER_FRANCHISE` (60) most-favourited members. The exact rule:
  1. A franchise's candidates are the accepted characters that are MAIN or SUPPORTING in at least one of its entries.
  2. They are sorted by `favourites` descending, ties by AniList character id ascending (the rank rule of §5.1.4), and the first 60 are kept; a franchise with 60 or fewer keeps all of them.
  3. A character is in the pool when at least one franchise keeps it. Its memberships are its memberships in the entries of the franchises that kept it, and its primary entry is the most popular of those entries. So no franchise has more than 60 members, and franchise completion is out of at most 60.
  4. Ranks and tiers are then computed over the capped pool, so `favourites_rank` and the card's rank are positions in it, and the refusal limits of §5.1.7 apply to it.
- The fetch still reads every character (ranking within a franchise needs their favourites), and a snapshot file is never changed: the cap applies at build time, so the same file always builds the same pool, and a different cap later is a rebuild from the same file. `--export` writes the capped pool, and building from that export gives the identical pool again (the cap is idempotent). A character the cap removes is not a skipped item; the build counts it as `capped`, per franchise. With at most 100 franchises the cap also bounds the pool at 6 000, `SNAPSHOT_CHARACTERS_MAX`.

#### 5.1.4 Tiers: fixed per character by popularity rank

The owner's bands (round 4, decision 1, "Owner, 2026-10-29"): by AniList favourites rank within the snapshot, **Mythic the top 2 %, Legendary 2–8 %, Epic 8–20 %, Rare 20–40 %, Uncommon 40–65 %, Common the rest (35 %)**.

- **Rank**: sort the snapshot's characters by `favourites` descending; **ties are broken by AniList character id ascending**, so equal favourites never make the split depend on query order, and a character with equal favourites and the lower id lands in the higher tier at a boundary. `favourites_rank` is the position, 1 first. It is the rank the card shows (`CharacterPublic.rank`, §6.2).
- **Counts**: with `N` characters, the tier boundaries are cumulative, `b(k) = round(N × k / 10 000)` with half-up integer rounding: Mythic is ranks 1 to `b(200)`, Legendary up to `b(800)`, Epic up to `b(2 000)`, Rare up to `b(4 000)`, Uncommon up to `b(6 500)`, Common the rest. Cumulative boundaries make the six counts sum to `N` exactly.

| N                    | Mythic | Legendary | Epic | Rare  | Uncommon | Common |
| -------------------- | ------ | --------- | ---- | ----- | -------- | ------ |
| 225 (smallest valid) | 5      | 13        | 27   | 45    | 56       | 79     |
| 500                  | 10     | 30        | 60   | 100   | 125      | 175    |
| 1 000                | 20     | 60        | 120  | 200   | 250      | 350    |
| 2 983 (§5.1.10)      | 60     | 179       | 358  | 596   | 746      | 1 044  |
| 6 000                | 120    | 360       | 720  | 1 200 | 1 500    | 2 100  |

- **Minimum pool**: every tier must hold at least `PACK_SIZE` (5) characters, so a pack whose five slots all land on one tier (a Radiant pack can deal five Mythics) still draws five different characters. Mythic, the smallest band, reaches 5 at N = 225 (`round(4.5)` = 5; at 224 it holds 4), so **225 is the smallest pool the tier rule allows**. `SNAPSHOT_CHARACTERS_MIN` stays 500 as a sanity floor: the real snapshot holds 2 983 after the cap (§5.1.10), and one under 500 means the fetch or the file is broken. A snapshot with a tier below 5 is refused either way (§5.1.7).
- **Per-character rarity** is §5.4.2's: each tier's characters are individually rarer than the tier below's, at every N from 225 to 6 000.

#### 5.1.5 Taking a snapshot from AniList

Only `snapshot-pool` (§7.1) does this, run by the owner. Requests go one after the other, never in parallel, at most one per `ANILIST_REQUEST_GAP`:

1. **Entries with their relations**: `SNAPSHOT_SERIES / ANILIST_SERIES_PER_PAGE` = 2 requests (`Page(page, perPage: 50) { media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { id title { english romaji native } startDate { year } popularity genres relations { edges { relationType node { id type } } } } }`).
2. **Relation hops**: the anime ids reached by a merging relation that are not in the top 100 and not yet read, in batches of 50 (`Page(perPage: 50) { media(id_in: [...], type: ANIME) { id relations { edges { relationType node { id type } } } } }`), for at most `FRANCHISE_MAX_HOPS` rounds, bounded by `FRANCHISE_MAX_REQUESTS`, beyond which the fetch is refused rather than building franchises from a partial graph.
3. **Characters**, per top-100 entry: one request per page carrying both roles as aliases, `main: characters(role: MAIN, page: p, perPage: 25)` and `supporting: characters(role: SUPPORTING, page: p, perPage: 25)`, each with `pageInfo { hasNextPage }` and `edges { role node { id name { full native } image { large } favourites } }`; the next page is fetched while either alias has one.

**Request count**: `2 + hops + Σ over the 100 entries of ceil(max(main, supporting) / 25)`. The first real fetch (§5.1.10) made **291 requests in about 12 minutes**. A fetch that would exceed `ANILIST_MAX_REQUESTS` (1 000, about 42 minutes) stops and is refused. Against AniList's limit (90 a minute, often degraded to 30, verified 2026-10-28, `CLAUDE.md`), 24 a minute stays under even the degraded figure, and the owner runs it rarely.

- **Backoff**: a 429 waits its `Retry-After` (or `ANILIST_DEFAULT_RETRY_AFTER` without one) and retries the same request; a network error, a timeout, a body over `ANILIST_MAX_BODY`, an HTTP status ≥ 500, invalid JSON or a GraphQL `errors` answer waits 2, 4, 8, 16, 32 s and retries. After `ANILIST_MAX_RETRIES` consecutive failures of one request the command stops with exit code 2 and prints how to resume. A status from 400 to 499 other than 429 stops it at once (a query bug; retrying cannot help).
- **Resumable**: each page that passed the schema parse is written to `pool_fetch_pages` as it arrives, in its own short transaction. Running the command again continues the newest unfinished fetch from the first missing page if it began less than `FETCH_RESUME_MAX_AGE` ago; an older one is discarded and started over, so a snapshot never mixes popularity rankings from days apart. `--restart` discards it on demand.
- **Building** starts only when every page is present (§5.1.7).

#### 5.1.6 Validation

AniList's answer is untrusted input, whether it arrives over the network or from a file (`--stdin`).

- Each page is read through a TypeBox schema of the declared fields only; anything else is dropped before it is stored. Every id (entry, hop entry, relation node, character), `popularity` and `favourites` must be an integer of at most 2 147 483 647 (`PG_INTEGER_MAX`, the Postgres `integer` it is stored in): an item with a larger one has the wrong shape, so it is skipped as `malformed` (an edge is dropped and counted), and a hostile page can never fail the activation's insert.
- An **entry** is accepted when: `id` is an integer ≥ 1 not seen earlier in the fetch; the title (English, else romaji), trimmed, is 1 to `TITLE_MAX` characters with at least one visible character (the test of the name rule below), and the native title is null or empty after the trim (stored as null), or at most `TITLE_MAX` characters with a visible character; `startDate.year` is null or an integer from 1900 to 2100; `popularity` is an integer ≥ 0; `genres` is an array of at most 20 strings of 1 to 50 characters. Otherwise it is skipped with its characters. Romaji stands in only when there is no English title (null or empty after the trim), not when the English one is too long or invisible. Genres are held to their length rule only, not to the visible-character test.
- A **relation edge** is kept when `relationType` is one of AniList's enum values (others are dropped and counted), `node.id` is an integer ≥ 1 and `node.type` is `ANIME`; at most 200 edges per entry are read.
- A **character** is accepted when all of these hold, and skipped with the reason in brackets otherwise:
  - `id` is an integer ≥ 1 (`id`); `role` is `MAIN` or `SUPPORTING` (`role`); `favourites` is an integer ≥ 0, null counting as 0 (`favourites`).
  - **Name** (`name`): `name.full`, trimmed, is 1 to `NAME_MAX` characters **and has at least one visible character**: what is left after removing every whitespace character, every control character (General Category Cc: C0, DEL and C1, such as U+0007 and U+009B) and every Unicode format character (General Category Cf: U+200B zero-width space, U+00AD soft hyphen, U+FEFF byte-order mark, U+200C/U+200D, U+200E/U+200F and U+202A–U+202E direction marks, U+2060–U+2064 and the rest of Cf) is not empty (round 4, decision 7). `name.native` is null or empty after the trim (stored as null), or at most `NAME_MAX` characters with at least one visible character by the same test; a native name that is all invisible is a skip, not a null. The test only decides acceptance: the stored name is the trimmed string as sent, format characters included (C9).
  - **Image** (`image`), round 4, decision 7: `image.large` is accepted **only if it is already canonical**, so the string served is exactly the URL the browser loads and nothing has to be repaired on the way. All of: at most `IMAGE_URL_MAX` characters; no whitespace, control character or backslash anywhere; it parses (`URL.canParse`); `new URL(raw).href === raw`, which refuses anything the WHATWG parser would change: upper-case or percent-encoded host characters, IDNA mappings (full-width letters, ideographic full stops, zero-width and soft-hyphen characters in the host), a default port such as `:443`, missing or extra slashes after the scheme, a missing path, and percent-encoding it would add; protocol `https:`; hostname exactly `IMAGE_HOST` (no trailing dot, no lookalike); `port`, `username` and `password` empty. Anything else is a skip with reason `image`; nothing is rewritten into an acceptable URL.
  - A character listed under several entries is accepted once with its memberships merged; its name, image and favourites come from its first appearance, and a later appearance that differs is logged, not an error.
- An entry with no accepted character is skipped (`entry:no_characters`).
- **An entry the cap empties** (§5.1.3: none of its characters is kept) is not listed. It is not a skip; its characters that no listed entry holds count in `capped` (in the total, not per franchise). The franchises and the cap are then worked out again without it, until every listed entry keeps a member.
- An entry that is not listed (skipped, or emptied by the cap) cannot anchor or title a franchise; its relations still connect, and a merge path counts it as an entry outside the top 100 (§5.1.2). Every listed franchise has at least one member. An entry's popularity rank is its position in AniList's order among the listed entries, so `--export` carries everything a rebuild needs.
- No string anywhere contains NUL (Postgres `text` cannot hold it); an item with one is skipped (`nul`).
- Accepted strings are stored as sent apart from the trim: no HTML decoding, no stripping, no normalisation; the web renders them as text (C9). Skipped items are counted by reason (`character:image`, `character:name`, …).

#### 5.1.7 Building and activating a snapshot

One transaction, with the app role (it has the DML this needs):

1. Apply the franchise cap (§5.1.3) to the accepted characters. Refuse, changing nothing, when fewer than `SNAPSHOT_SERIES_MIN` entries are listed after the cap (an entry the cap empties is not listed, §5.1.6), when the capped pool holds fewer than `SNAPSHOT_CHARACTERS_MIN` or more than `SNAPSHOT_CHARACTERS_MAX` characters, when the relation hops exceeded `FRANCHISE_MAX_REQUESTS`, or when any of the six tiers would hold fewer than `PACK_SIZE` characters.
2. Build the franchises (§5.1.2), the capped pool (§5.1.3) and the tiers over it (§5.1.4).
3. Insert the `pool_snapshots` row; upsert `series` and `characters` with the new display strings; insert the snapshot's franchises, entries, merge edges, characters (with rank, tier and primary entry) and memberships.
4. Clear `is_current` on the previous snapshot and set it on the new one.
5. Delete the fetch's staging rows. Commit.

An opening reads the current snapshot's id once, in its own transaction, and draws only from that snapshot's rows, so an activation that commits during an opening changes nothing about that opening. A fresh install has no snapshot: `GET /api/packs` answers `odds: null` and `packsUntilGuarantee: null`, and an opening answers 503 `pool_unavailable`, with the allowance and the counters untouched, until the owner runs §7.1.

#### 5.1.8 Updating a snapshot later

The owner runs §7.1 again whenever they choose. The new snapshot may rank characters differently (and so move them between tiers), add characters, drop characters or whole entries, and regroup franchises.

- **Owned cards keep the rarity they were granted with** (confirmed, round 2, decision 5). `cards.rarity` is written once, at the grant, and no snapshot touches it. Owned items never change value under the player: a Legendary pulled yesterday stays Legendary in the collection, on the market (`economy.md`) and in a recycle, whatever AniList's favourites did since.
- **Only future grants use the new tiers.** A character that moved from Epic to Legendary is dealt as Legendary from the activation on. A player can then hold it at both rarities, which the collection shows as two entries (§5.5).
- **Names, images and the rank refresh from the newest snapshot** (confirmed, round 2, decision 5). Name, native name, image and titles come from the `characters` and `series` rows, which each activation updates, and the rank the card shows is the current snapshot's. They are presentation, not value, and AniList's image URLs change when an image is re-uploaded. What is frozen on a card is what it is worth and where it came from: its rarity, its variant, its opening, its snapshot and when it was obtained.
- **Completion uses the current snapshot**: pool completion against its characters, franchise completion against its franchises and their current members.
- **A dropped character** (not in the current snapshot) stays in every collection that holds it, with `inCurrentSnapshot: false`, `tier: null` and `rank: null`; its entries keep their granted rarity; it counts in the card totals and in no completion figure; packs never deal it again. Its franchises are those of the newest snapshot that contained it, and a franchise no longer in the current snapshot has no completion figure (§6.2). This is the behaviour `collection-overview.md` §3.2 already designs.
- **The pack counters do not move** on an activation (§5.4.5): they count packs and Mythic cards, not characters.

#### 5.1.9 Images and network

- **Images**: the browser keeps loading card images from AniList's CDN, as today. The api does not proxy them: a proxy would make the NAS an image server and add an endpoint that fetches by URL. `IMAGE_HOST` is the one host the live CSP allows in `img-src` (C8); ADR 0008 §5's `*.anilist.co` is the ceiling and the CSP is the rule. A unit test reads the `Caddyfile` and fails if `img-src` and `IMAGE_HOST` disagree. Because only canonical URLs are accepted (§5.1.6), the URL the CSP judges is byte for byte the URL that was validated.
- **Network**: the snapshot command is the only outbound call the system makes, and only when the owner starts it. The endpoint is a constant, and no request input reaches the URL or the query variables (the only ids it sends are ones AniList itself returned in the relations). It runs in the api container, which reaches the internet through its `front` network; `back` stays internal; compose needs no network change. The api server process holds no AniList client: a test asserts that `buildApp` never constructs one.
- **Tests and CI never call AniList.** The CI stack and the e2e suite load a fixture snapshot through `--stdin` (§7.1). The client is tested against a local `node:http` server on `127.0.0.1:0` that it is constructed with, rather than undici's `MockAgent`: no new dev dependency, and the test goes through the real socket path, where the timeout and the body cap live.

#### 5.1.10 The first real snapshot (2026-10-29)

The owner took the first real snapshot on 2026-10-29 (`takenAt` 12:52 UTC) with a dry run of §7.1 and exported it as a file: **291 AniList requests in about 12 minutes; 100 entries in 77 franchises; 5 173 characters accepted before the cap; 0 skipped.** The file (`snapshot-2026-10-29.json`, format `anime-tcg-snapshot/2`, 1.4 MB) is kept by the owner outside the repository (AniList's content is not committed) and is what the acceptance stack loads with `--stdin`; the CI and e2e fixtures stay synthetic.

- **Uncapped**, one franchise dominated: ONE PIECE is one entry with 815 characters, about 16 % of the 5 173; Naruto (two entries) has 402, Bleach 272, Fairy Tail 219; about 18 % of all cards pulled would have been ONE PIECE characters, nearly all minor ones. The owner chose the franchise cap for this (round 5, decision 2).
- **With the cap of 60 per franchise** the pool is **2 983 characters: 60 Mythic, 179 Legendary, 358 Epic, 596 Rare, 746 Uncommon, 1 044 Common**. 18 franchises are trimmed (20 sit at exactly 60) and 2 190 characters are removed, none of them MAIN; the most favourited one removed ranked 1 030th of the 5 173, so every character in the uncapped pool's top 8 % stays in the pool (ranks are recomputed, so 60 of them are now Mythic). On this file no character loses a membership to the cap and no primary entry changes. ONE PIECE keeps its 60 most favourited (2.0 % of the pool), and no franchise supplies more than about 2.7 % of all cards pulled.
- The five-tier dry run printed 52 / 207 / 517 / 1 293 / 3 104 for the uncapped pool; tiers and the cap are applied at build time, so the same file builds the capped six-tier split.

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
- A pack from the allowance is a **free pack**; it is what the Enchanted cadence and the pity counter count (§5.4.5, §5.4.7).

### 5.3 Opening a pack

One transaction, in this order:

1. Lock the account row (`SELECT packs_anchor_at, packs_since_mythic, free_packs_opened ... FOR UPDATE`). No row → 401 `unauthenticated`, as in 1b.
2. If the account already has an opening with this `requestId`, answer 200 with that opening's kind, pity flag, cards, slots and `isNew` exactly as stored, and the current allowance and `packsUntilGuarantee`. Nothing is written; no counter moves.
3. If `available` is 0, answer 409 `no_pack_available` with `retryAfterSeconds` = `nextPackInSeconds`.
4. Read the current snapshot's id. None → 503 `pool_unavailable`; the allowance and the counters are untouched.
5. Plan the pack from the counters and one roll (§5.4.4): Radiant or not, Enchanted or not, pity due or not.
6. Roll each slot that is not forced and pick a character for every slot (§5.4.4) from that snapshot.
7. For each picked character, `isNew` = the account holds no card of that character yet, at any rarity or variant.
8. Insert the `pack_openings` row (snapshot id, `kind`, `pity`) and the cards (`slot` in roll order, `rarity` = the slot's tier, `variant` = `standard`, the snapshot id); move `packs_anchor_at`; set `free_packs_opened` to itself + 1 and `packs_since_mythic` to 0 if any card is Mythic, else to itself + 1 (§5.4.5); commit; answer 201.

Because steps 2–8 run under the lock, requests of one account serialise: with one pack available, two parallel openings give one 201 and one 409; two parallel requests with the same `requestId` give one 201 and one 200 with the same cards. `unique (account_id, request_id)` is the backstop: if the lock were ever bypassed, the second insert fails its transaction (a 500) and nothing is opened twice, no counter moved twice. A request that ends in 409 or 503 leaves no record, so its key can succeed later. Keys are scoped to the account: account B sending A's `requestId` finds nothing of A's and gets its own outcome.

Steps 5 to 8 are one domain function, `dealPack(tx, account, rng, pool, source)`, whose character source and pack source are parameters: 1c passes the current snapshot's pool and `source = free`; `economy.md`'s themed packs pass a theme's subset of the pool and `source = shop`, through the same plan, roll and writes, with the counter rules of §5.4.7.

### 5.4 RNG, tiers and odds

- **RNG**: `crypto.randomInt` only (C10), behind an injectable `Rng` (`(min, max) => integer`) so unit tests can script outcomes. `Math.random` already fails lint in `api/`.
- **Slots** are numbered 1 to 5 here, as the owner numbers them; the contract's `slot` is 0 to 4 (slot 1 is `slot: 0`).
- **Every figure below is computed from the integer tables in `shared/src/rarity.ts`**, and a unit test recomputes each one (§9), so a table change that moves a figure fails until this section is updated.

#### 5.4.1 Slot floors and the standard pack's tables

The owner's rules (round 4, decisions 2 and 3, "Owner, 2026-10-29"): a pack of five cards; **slots 1–3 Common or better, slot 4 Uncommon or better, slot 5 Rare or better (guaranteed)**; and a share of all cards pulled of **Common 56 %, Uncommon 27 %, Rare 13 %, Epic 3.4 %, Legendary 0.55 %, Mythic 0.05 %**.

**The two could not both hold.** Slot 5 is Rare or better in every pack, so one card in five, 20 % of all cards, is Rare or better at the least; those shares give Rare and above 13 + 3.4 + 0.55 + 0.05 = 17 %. The owner chose (round 5, decision 1, "Owner, 2026-10-29") to keep the slot floors and the Common, Epic, Legendary and Mythic shares and move 3 points from Uncommon to Rare: **Common 56 %, Uncommon 24 %, Rare 16 %, Epic 3.4 %, Legendary 0.55 %, Mythic 0.05 %, the shares of a standard pack** (the special rules add to them, §5.4.6).

**Derivation.** A share `s` of the five cards is `5 × s × 1 000 000` units summed over the five slot tables. Rare and above add up to 20 %, exactly the one card slot 5 always holds, so slot 5 carries all of Rare, Epic, Legendary and Mythic and slots 1–4 hold none; slot 4 is then always Uncommon; slots 1–3 share the remaining 2 800 000 Common and 200 000 Uncommon units. The solution is unique except for how slots 1–3 split the Commons; they split them as evenly as integers allow, and the unit that 2 800 000 leaves over when divided by three goes to slot 1. Every row sums to exactly 1 000 000, and the overall shares are exact, not rounded.

| Slot (floor)           | Common    | Uncommon  | Rare    | Epic    | Legendary | Mythic |
| ---------------------- | --------- | --------- | ------- | ------- | --------- | ------ |
| 1 (Common)             | 933 334   | 66 666    | 0       | 0       | 0         | 0      |
| 2 (Common)             | 933 333   | 66 667    | 0       | 0       | 0         | 0      |
| 3 (Common)             | 933 333   | 66 667    | 0       | 0       | 0         | 0      |
| 4 (Uncommon)           | 0         | 1 000 000 | 0       | 0       | 0         | 0      |
| 5 (Rare)               | 0         | 0         | 800 000 | 170 000 | 27 500    | 2 500  |
| **Sum of the 5 slots** | 2 800 000 | 1 200 000 | 800 000 | 170 000 | 27 500    | 2 500  |
| **Share of cards**     | 56 %      | 24 %      | 16 %    | 3.4 %   | 0.55 %    | 0.05 % |
| **Per pack, expected** | 2.8       | 1.2       | 0.8     | 0.17    | 0.0275    | 0.0025 |

A standard pack is three Common-or-Uncommon cards, one Uncommon and one Rare-or-better card: the classic booster shape. Slot 4's table has one tier; it is still rolled like the others (one call), so a later table change needs no code change.

#### 5.4.2 Per pack and per character

**At least one per pack** (`1 − Π over the slots of (1 − odds / 1 000 000)`, exactly in `BigInt`, rounded half up to parts per million; published as `perPack`):

| Tier      | Standard pack       | Enchanted pack (§5.4.3) | Radiant pack (§5.4.3) |
| --------- | ------------------- | ----------------------- | --------------------- |
| Common    | 99.9704 % (999 704) | 99.9704 %               | 0                     |
| Uncommon  | 100 %               | 100 %                   | 0                     |
| Rare      | 80 % (800 000)      | 0                       | 0                     |
| Epic      | 17 % (170 000)      | 85 %                    | 99.9494 %             |
| Legendary | 2.75 % (27 500)     | 13.75 %                 | 44.6603 %             |
| Mythic    | 0.25 % (2 500)      | 1.25 %                  | 100 %                 |

In plain words, a standard pack holds a Legendary about once in 36 packs and a Mythic once in 400. Only one slot can hold Rare or better, so "at least one" equals slot 5's table for those tiers.

**Per character.** A given character of tier `t` is drawn with chance `share[t] / tierSize[t]` per card, and is in a given standard pack with chance `5 × share[t] / tierSize[t]` (a pack never repeats a character, so the chance equals the expected count). With the bands of §5.1.4 that is about `1.600/N` per card for a given Common, `0.960/N` for an Uncommon, `0.800/N` for a Rare, `0.283/N` for an Epic, `0.0917/N` for a Legendary and `0.0250/N` for a Mythic: **each tier's characters are individually rarer than the tier below's**, Common > Uncommon > Rare > Epic > Legendary > Mythic in chance. The closest pair is Uncommon and Rare: a given Rare is 1.2 times rarer than a given Uncommon (at least 1.175 times at every N from 225 to 6 000 once the counts are rounded, 1.198 times at N = 2 983; a unit test checks every N). At the first real snapshot after the cap (N = 2 983), the rates still fall strictly tier by tier:

| Tier      | Characters | One given character, per card | Per standard pack |
| --------- | ---------- | ----------------------------- | ----------------- |
| Common    | 1 044      | 1 in 1 864                    | 1 in 373          |
| Uncommon  | 746        | 1 in 3 108                    | 1 in 622          |
| Rare      | 596        | 1 in 3 725                    | 1 in 745          |
| Epic      | 358        | 1 in 10 529                   | 1 in 2 106        |
| Legendary | 179        | 1 in 32 545                   | 1 in 6 509        |
| Mythic    | 60         | 1 in 120 000                  | 1 in 24 000       |

#### 5.4.3 Special packs

The owner's rules (round 4, decision 4, "Owner, 2026-10-29"):

- **Pity**: the 300th free pack in a row without a Mythic has a Mythic in slot 5. The counter is per account and is reset by any Mythic card from any source. Slot 5 is then not rolled: it is Mythic, and `pity` is true on the opening. Slots 1–4 roll as usual.
- **Enchanted pack**: every 10th free pack opened (the 10th, 20th, 30th … since registration or the last reset) has Epic or better in slot 5. Its slot 5 rolls `ENCHANTED_SLOT_ODDS`, the standard slot 5 table above Epic scaled up to the full scale (the same 170 : 27.5 : 2.5 ratio): **Epic 850 000, Legendary 137 500, Mythic 12 500**. Slots 1–4 roll the standard tables. `kind` is `enchanted`.
- **Radiant pack**: 1 pack in 2 500 (`RADIANT_ODDS` = 400 out of 1 000 000) is five Epic-or-better cards including at least one Mythic. **Slots 1–4 each roll `RADIANT_SLOT_ODDS` (Epic 850 000, Legendary 137 500, Mythic 12 500); slot 5 is Mythic**, not rolled. A Radiant pack holds 1.05 Mythics on average and at least one Legendary 44.66 % of the time. `kind` is `radiant`.
- **Standard pack**: anything else; `kind` is `standard`.

**Precedence** when rules coincide. Radiant comes first, then pity, then Enchanted; a rule lower down is not lost, it is already met:

| Due at this pack                       | `kind`      | Slots 1–4           | Slot 5                  | `pity` |
| -------------------------------------- | ----------- | ------------------- | ----------------------- | ------ |
| nothing                                | `standard`  | standard tables     | standard slot 5         | false  |
| Enchanted                              | `enchanted` | standard tables     | `ENCHANTED_SLOT_ODDS`   | false  |
| pity                                   | `standard`  | standard tables     | Mythic                  | true   |
| Enchanted and pity                     | `enchanted` | standard tables     | Mythic (Epic or better) | true   |
| Radiant (with or without either other) | `radiant`   | `RADIANT_SLOT_ODDS` | Mythic                  | false  |

- A Radiant pack already holds a Mythic, so pity changes nothing in it and its `pity` is false; it already holds five Epic-or-better cards, so it satisfies an Enchanted pack that falls on it, and the Enchanted cadence is not shifted (the next Enchanted pack is still 10 free packs later, because the cadence counts packs, §5.4.5).
- A pity Mythic in an Enchanted pack is Epic or better, so the pack is both; the card's frame and the reveal's line say which rule gave what (`card-and-rarity.md` §7.1).
- Slot 5 of a pity-due pack is not rolled, so `pity` is true exactly when the pack was pity-due and not Radiant. Under these tables slots 1–4 of a non-Radiant pack never hold a Mythic, so a pity pack holds exactly one.

#### 5.4.4 The roll, in order

The order is fixed, so a scripted `Rng` gives a known pack and the statistical tests can force each path:

1. **Plan**: `radiant = randomInt(0, ODDS_SCALE) < RADIANT_ODDS`, rolled for every pack whatever else is due, so the stream does not depend on the counters. For a free pack: `enchanted = (free_packs_opened + 1) mod ENCHANTED_INTERVAL = 0`; `pityDue = packs_since_mythic ≥ PITY_PACKS − 1` (`≥` is a defensive bound; the database holds the counter in 0 to `PITY_PACKS − 1`). A shop pack has `enchanted` and `pityDue` false (§5.4.7). `kind` and the forced slots follow from §5.4.3's precedence.
2. **Slots 1 to 5, in order**: a forced slot (Mythic, in Radiant or pity) takes no tier roll; any other slot rolls `r = randomInt(0, ODDS_SCALE)` against its table, taking the tiers rarest first by running sums (for standard slot 5: Mythic when `r < 2 500`, Legendary when `r < 30 000`, Epic when `r < 200 000`, otherwise Rare). Integers throughout, so the odds are exact.
3. **Character pick**, right after each slot's tier: uniform among the tier's characters in the snapshot (ordered by `character_id`) that this pack has not drawn yet: one partial Fisher–Yates shuffle per tier, `randomInt(i, n)` per draw. No pack repeats a character; every tier holds at least `PACK_SIZE` characters (§5.1.4), so a pick never runs out.

The pure part is `planPack(counters, source, rng)` and `drawPack(pool, plan, rng, tierRng = rng)`; `tierRng` is the seam the statistical test uses to force tiers while the pick stays on the real generator, and `planPack`'s inputs are the seam that forces Enchanted, pity and (with a scripted first call) Radiant.

#### 5.4.5 The counters

Both live on the `accounts` row (§4.1), are read and written only under the account lock, and change only in the transaction that writes a new opening (or, later, another grant of a Mythic card):

- `free_packs_opened` grows by 1 with every free pack, whatever its kind. A free pack is Enchanted when the new value is a multiple of `ENCHANTED_INTERVAL`.
- `packs_since_mythic` is set to 0 by any opening that deals a Mythic card (natural, Enchanted, Radiant or pity), and otherwise grows by 1 with every free pack. It never reaches `PITY_PACKS`: at `PITY_PACKS − 1` the next free pack is pity-due and deals a Mythic. **Any Mythic from any source** resets it: in 1c packs are the only source; `economy.md`'s shop packs, market purchases and prize packs and the mini-games' upgrades set it to 0 in the transaction that grants the Mythic card, under the same lock. A Mythic leaving the account (sold, later) does not change it. Any future source that grants a Mythic or moves the counter (shop, prizes) must keep it in 0 to `PITY_PACKS − 1`: the database check refuses anything else.
- **Published**: `packsUntilGuarantee = PITY_PACKS − packs_since_mythic`, an integer from 1 to 300: the free pack that many openings from now contains a Mythic at the latest (1 means the next free pack does). It is on `GET /api/packs` and on every `PackOpened` (§6.2), null only while there is no current snapshot. The owner decided it is shown on the pack page (round 4, decision 4); its wording is `card-and-rarity.md` §7.4's, which says `free packs` because shop packs do not count (§5.4.7). The Enchanted position is **not** published: the card spec rules out "next pack is Enchanted".
- **Replay and idempotency**: a replayed `requestId` returns the stored `kind`, `pity` and cards and moves no counter; its `packsUntilGuarantee` is the current one. A 409 or 503 moves nothing. Two parallel openings serialise on the lock, so each counter moves once per opening that committed; the unique key stops a double write, and with it a double count.
- **Reset** (`reset-collection`, §5.6): both counters go to 0 with the cards, as on registration. **Snapshot updates** do not touch them (§5.1.8). **Deleting** the account removes them with the row.
- **Audit**: the counters can be recomputed from the account's openings (`free_packs_opened` = the count of free openings; `packs_since_mythic` = the free openings after the last opening with a Mythic card), and a test does so after a long scripted run (§9).

#### 5.4.6 Effective figures with the special rules

The shares of §5.4.1 are those of a **standard pack**. The special rules add to them, and no table can make the shares hold over all packs: the guarantee alone gives every account at least one Mythic per 300 free packs, which is 0.067 % of the cards, above the 0.05 % share. Over the long run of one account's free packs (an exact Markov chain over the two counters, which a unit test recomputes from the parameters):

| Figure                                     | Value                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Free packs with at least one Mythic        | **0.5645 %, 1 in 177** (without pity it would be 0.390 %, 1 in 256)                            |
| Mythic cards per free pack                 | 0.005665                                                                                       |
| Mythic packs that come from pity           | 31 % of them; 0.176 % of all free packs                                                        |
| A run reaching the 300th pack              | about 31 % of the runs that start after a Mythic                                               |
| Enchanted packs                            | 10 % of free packs; Radiant 0.04 % (1 in 2 500)                                                |
| Share of all free-pack cards, all rules on | Common 55.98 %, Uncommon 23.99 %, Rare 14.38 %, Epic 4.77 %, Legendary 0.772 %, Mythic 0.113 % |

The Enchanted pack moves the upper tiers most: every 10th pack's slot 5 is Epic or better, which takes Epic from 3.4 % to 4.8 % of all cards and more than doubles Mythic with pity. These figures go in the PR and on no screen; `PublishedOdds` carries the tables and rules they come from (§6.2), not the long-run averages, because no single pack applies them.

**Completion horizon**, for the record, at the first real snapshot after the cap (N = 2 983, 60 Mythic, 179 Legendary): collecting every Mythic takes about 60 × H(60) ≈ 281 Mythic cards, about 49 600 free packs at 0.005665 a pack; every Legendary about 179 × H(179) ≈ 1 032 Legendary cards, about 26 800 packs at 0.0386 a pack. At the 144-pack daily ceiling the Mythics take about 345 days; at a casual nine packs a day, about 15 years. The market and recycling (`economy.md`) are how players close the gap.

#### 5.4.7 Which packs the rules apply to

Manager's recommendation, fixed here so `economy.md` and the pity line's wording can rely on it (the owner can overrule it when reviewing `economy.md`, before any shop code exists):

- **Pity and Enchanted count free packs only.** Shop (themed) packs and, later, prize packs neither advance `free_packs_opened` nor `packs_since_mythic`, and are never Enchanted or pity-due. A Mythic from one of them still resets `packs_since_mythic` ("any Mythic from any source"). Why: the counter is shown on the pack page; if Karma packs moved it, the number would become a reason to spend Karma to reach the guarantee, the nudge ADR 0004 §6 rules out, and the faucet model of `economy.md` §9 would gain a term that grows with spending. Counting free packs keeps the guarantee a protection against bad luck, bounded by time (at most 144 free packs a day).
- **Radiant applies to every pack**, shop packs included, from the theme's own Epic, Legendary and Mythic characters (a theme is eligible only when each of its six tiers holds `PACK_SIZE` characters, so a Radiant theme pack always fills). It needs no counter and has no position to chase, so nothing about it can be ground towards; a Radiant chance that varied between pack kinds would be harder to publish honestly.
- **The slot floors and tables are the same** for every pack kind.
- `PublishedOdds.pity.freePacksOnly` is `true` (§6.2), so the UI's wording follows the rule rather than repeating it.

#### 5.4.8 One source of truth and the published odds

- `shared/src/rarity.ts` holds `RARITIES` with six values in rank order, `RARITY_LABEL` (`Common`, `Uncommon`, `Rare`, `Epic`, `Legendary`, `Mythic`), `ODDS_SCALE`, `SLOT_FLOOR`, `SLOT_ODDS`, `ENCHANTED_INTERVAL`, `ENCHANTED_SLOT_ODDS`, `RADIANT_ODDS`, `RADIANT_SLOT_ODDS`, `PITY_PACKS`, `SHARE_SCALE` and `TIER_BAND`. The float `BASE_WEIGHTS` and `POPULARITY_INFLUENCE` (and the three legacy tiers) stay until PR 2 deletes their last users; nothing on the server reads them. The UI shows the odds the server returns, never constants of its own: the `web/` block of the ESLint config forbids importing the number constants from `@anime-tcg/shared/rarity` and anything from `@anime-tcg/shared/economy` (`no-restricted-imports` with `importNames`).
- **Published odds** (`GET /api/packs`, §6.2), what `card-and-rarity.md` §7.3's odds page reads: the five slot tables with their floors, the share of a standard pack's cards per tier, the at-least-one-per-pack figures, the Enchanted interval and slot table, the Radiant chance and slot table, the pity count and whether it counts free packs only, the tier bands, the current snapshot's tier sizes, and the snapshot's version, date and character count. The numbers a player reads are the numbers the server applies, and the economy's model refers to them (`economy.md` §9).
- **The popularity tilt is gone.** Every card of a tier is rolled with the same table. The snapshot id on each card names the tier split that applied, and the opening's kind names the tables.

### 5.5 Collection

- **Entries.** `GET /api/collection` answers the account's cards grouped into entries keyed by (character, granted rarity, variant), each with a count and the first and last time a card of the entry was obtained. A character has one tier per snapshot and every card is `standard` today, so a collection holds **one entry per character**; a second entry for the same character appears only when a snapshot update moved that character's tier and the player then obtained it at the new one (§5.1.8), and later for a Masterwork.
- **Character data per entry**: name, native name, image, `franchiseIds` (primary first), the character's current tier and popularity rank (both null when it is not in the current snapshot) and `inCurrentSnapshot`. The franchises themselves come once per response in `franchises` (id, title, native title, start year), so a character's franchise titles do not repeat in every entry. The pool size the rank is shown against is `snapshot.characterCount`.
- **Totals**: `cards` (the same number as `AccountPublic.cards`), `duplicates` (the sum of count − 1 over the entries) and `byRarity` (cards per granted rarity, all six).
- **Completion**, computed by the server against the current snapshot (§5.1.3, §5.1.8): `pool` = owned distinct characters of the snapshot over its character count; `franchises` = for every franchise of the current snapshot, in popularity order, the distinct characters of that franchise the account owns at any rarity over the franchise's distinct member count. Every franchise of the snapshot is listed, owned or not, so a filter can show `0/12` and a franchise whose last card was sold stays in the list.
- **Order**: entries by rarity (Mythic first), then name, then character id. Stable for tests; the UI may re-sort.
- **Size**: bounded by the characters an account has ever owned: at most one snapshot's `SNAPSHOT_CHARACTERS_MAX`, plus those dropped or moved by updates. A complete collection of the 2 983-character pool is about 3 000 entries, some 700 KB of JSON; a new player's answer is a few kilobytes. No pagination in 1c: the overview filters, sorts and pages in the browser (`collection-overview.md` §5.5) and fetches when its tab is shown, not after every opening.
- `AccountPublic.cards`, 0 since 1b (`CARDS_UNTIL_1C`), becomes the account's card count, so the Manage dialog and the delete confirmation show real numbers.
- Cards are named by (character, rarity, variant), never by id. There is no card id for a client to send or tamper with, which is the 1b pattern (C3: what cannot be named cannot be taken). Item 2's listing and recycle use the same naming.
- **No migration** (ADR 0008 §7). The server starts empty; the in-memory collection (`useInventory`) is dropped at the switch. The old browser keys `anime-tcg:inventory:v1` and `anime-tcg:character-pool:v1` are neither read nor deleted.

### 5.6 Reset (owner only)

The owner can reset one account's collection with `reset-collection` (§7.2), as with `reset-password` (round 1, decision 4). There is no route and no button: a player cannot reset their own collection, and the proof of concept's `Reset` goes from the web app (§8). The `Reset` mention in `accounts.md` §3.6 and its §8 copy row are superseded; `ui-designer` updates them in PR 2.

In 1c, one transaction: lock the account row; delete its `pack_openings` (its cards go by cascade); set `packs_anchor_at` to null, so the account is full as on registration, and `packs_since_mythic` and `free_packs_opened` to 0, so the pity counter starts over at 300 and the next Enchanted pack is the 10th; commit. The login, password, sessions and account id stay. Old `requestId`s no longer replay anything because their openings are gone, which is harmless: a client keeps a key only until it gets an answer. From item 2 on, a reset also cancels the account's market listings and applies the Karma rule of `economy.md` §8.10.

### 5.7 Authorisation

Every route calls `requireAccount(req)` (401 `unauthenticated`) and passes the session's account id into the domain function. No account id, card id, opening id or snapshot id appears in any path or body; a `requestId` is looked up only among the acting account's openings. Nothing in a request can choose a pack's kind, its slots or a counter.

### 5.8 Logging

At `info`, with the request id: pack opened (account id, opening id, snapshot id, kind, pity, count per rarity, `packs_since_mythic` after, whether it was a replay; on a replay, `packs_since_mythic` is the account's current value, since a replay moves no counter). From the commands: fetch progress every 25 requests (requests done, estimated remaining, 429s seen); snapshot built (version, entries, franchises, characters, the six tier counts, skipped by reason, capped per franchise, characters whose tier moved, characters dropped and added, franchises merged or split, duration); collection reset (account id, cards and openings removed). At `warn`: a page that failed and the wait before its retry; for skipped items, the reason and the first rejected field path. Never an AniList response body.

## 6. Contract (`shared/src/api.ts`, `shared/src/errors.ts`)

### 6.1 Error codes

New: `no_pack_available` (409) and `pool_unavailable` (503). `no_pack_available` carries `retryAfterSeconds` (the seconds until the next pack) and the `Retry-After` header, the same pair `too_many_failures` uses; the field's comment in `errors.ts` widens to both codes.

### 6.2 Schemas

```
Rarity              "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic"   -- from RARITIES, in rank order
CardVariant         "standard"                                               -- reserved: "masterwork" joins later
PackKind            "standard" | "enchanted" | "radiant"
PerRarity           { common, uncommon, rare, epic, legendary, mythic: integer ≥ 0 }
SnapshotInfo        { version: integer ≥ 1, takenAt: date-time, characterCount: integer ≥ 1 }   -- the pool size the rank is out of
SlotOdds            { floor: Rarity, odds: PerRarity }                       -- one slot's table; odds sum to scale, zero below floor
PublishedOdds       { scale: integer,                                        -- 1 000 000
                      slots: SlotOdds[PACK_SIZE],                            -- a standard pack, in slot order
                      share: PerRarity,                                      -- share of a standard pack's cards, parts per million; sums to scale
                      perPack: PerRarity,                                    -- chance of at least one per standard pack, parts per million
                      enchanted: { every: integer, slot: integer, floor: Rarity, odds: PerRarity },   -- 10, slot 4 (the fifth card), "epic"
                      radiant: { chance: integer,                            -- out of scale: 400
                                 odds: PerRarity,                            -- slots 0..3
                                 lastSlot: Rarity },                         -- "mythic"
                      pity: { packs: integer, freePacksOnly: boolean },      -- 300, true
                      bandScale: integer, tierBands: PerRarity,              -- 10 000; the pool share of each tier by rank
                      tierSizes: PerRarity,                                  -- the current snapshot's characters per tier
                      snapshot: SnapshotInfo }
PackAllowance       { available: integer 0..cap, cap: integer, intervalSeconds: integer, nextPackInSeconds: integer ≥ 1 | null }
PacksResponse       { allowance: PackAllowance, odds: PublishedOdds | null,  -- null while there is no snapshot
                      packsUntilGuarantee: integer 1..PITY_PACKS | null }    -- §5.4.5; null exactly when odds is null
FranchiseRef        { id: integer ≥ 1, title: string, titleNative: string | null, startYear: integer | null }
CharacterPublic     { id: integer ≥ 1, name: string, nameNative: string | null, imageUrl: string,
                      franchiseIds: integer[1..],                            -- primary franchise first
                      tier: Rarity | null,                                   -- in the current snapshot; null when not in it
                      rank: integer ≥ 1 | null,                              -- favourites rank in the current snapshot; null when not in it
                      inCurrentSnapshot: boolean }
OpenPackBody        { requestId: uuid string }
OpenedCard          { kind: "card", slot: integer 0..PACK_SIZE − 1, character: CharacterPublic, rarity: Rarity,
                      variant: CardVariant, isNew: boolean }
PackOpened          { openingId: uuid, openedAt: date-time,
                      packKind: PackKind,                                    -- as stored
                      pityMythic: boolean,                                   -- the fifth card's Mythic (slot 4) was forced by pity
                      cards: OpenedCard[PACK_SIZE], franchises: FranchiseRef[], allowance: PackAllowance,
                      packsUntilGuarantee: integer 1..PITY_PACKS | null }    -- after this opening (current, on a replay)
CollectionEntry     { kind: "card", character: CharacterPublic, rarity: Rarity, variant: CardVariant, count: integer ≥ 1,
                      firstObtainedAt: date-time, lastObtainedAt: date-time }
Completion          { owned: integer ≥ 0, total: integer ≥ 0 }
FranchiseCompletion { franchiseId: integer ≥ 1, owned: integer ≥ 0, total: integer ≥ 1 }
CollectionTotals    { cards: integer ≥ 0, duplicates: integer ≥ 0, byRarity: PerRarity }
CollectionResponse  { snapshot: SnapshotInfo | null, totals: CollectionTotals,
                      completion: { pool: Completion, franchises: FranchiseCompletion[] },   -- current snapshot; empty without one
                      franchises: FranchiseRef[],                            -- the current snapshot's, plus any an entry names
                      entries: CollectionEntry[] }
```

`rarity` on a card or entry is the card's, as granted; `character.tier` is what packs deal the character as now; they differ only after a tier move (and, later, for a Masterwork). `character.rank` is the current snapshot's favourites rank, shown on the card as `#0012 / 2983` against `snapshot.characterCount` (`card-and-rarity.md` §6.2); the favourites count itself is never sent. A `franchiseId` an entry names that has no `FranchiseCompletion` row is a franchise no longer in the current snapshot. The opening's kind is `packKind`, not `kind`, because `kind` already discriminates cards from Relics. **Reserved fields**: `kind` is the discriminator a Relic entry (`kind: "relic"`) will join as a second member of a union; `variant` is where `"masterwork"` will appear; `totals` and completion count `kind: "card"` only, and say so in their schema comments, so a Relic cannot change their meaning. Every object is `additionalProperties: false`; the 1b schema guard catches a miss. `economy.md`'s `ShopReceipt` carries a `PackOpened`, so a shop pack reports its `packKind` (`standard` or `radiant`) and the unchanged or reset `packsUntilGuarantee` the same way.

### 6.3 Routes

| Method, path           | Body           | Success                                                  | Errors (status, code)                                                                          | Limit  |
| ---------------------- | -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| `GET /api/packs`       | —              | 200 `PacksResponse`                                      | 401 `unauthenticated`                                                                          | global |
| `POST /api/packs/open` | `OpenPackBody` | 201 `PackOpened`; 200 `PackOpened` on a replay           | 401 `unauthenticated`, 409 `no_pack_available` (+ `retryAfterSeconds`), 503 `pool_unavailable` | 20/min |
| `GET /api/collection`  | —              | 200 `CollectionResponse`                                 | 401 `unauthenticated`                                                                          | global |
| `GET /api/session`     | —              | unchanged, except that `account.cards` is the card count | —                                                                                              | global |

GET routes take `NoQuery`. The POST is behind the 1a CSRF check, and its override (`PACK_RATE_LIMIT`, per client address) replaces the global bucket for that route. The allowance is the real limit on openings; the override bounds lock contention from a script and leaves room for a full allowance, retries and a second tab. Response schemas list every status above plus 400 `validation_failed`, 403 `bad_origin` and 429 `rate_limited` on the POST, so the serialiser strips anything undeclared: no card id, favourites count, counter value other than `packsUntilGuarantee`, or Enchanted position can leak. The rank is declared now (round 4, decision 5) and is no longer stripped.

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
- `--stdin`: read a snapshot file instead of fetching: `{ "format": "anime-tcg-snapshot/2", "takenAt": "<date-time>", "series": [<page bodies>], "relations": [<page bodies>], "characters": { "<seriesId>": [<page bodies>] } }`, the page bodies in AniList's GraphQL shape, at most `SNAPSHOT_FILE_MAX`. It goes through the same schema parse, validation, refusal rules and build, and records `source = 'file'`. The CI stack and the e2e suite seed their pool this way (from the fixture builder in `web/src/test/fixtures.ts`, extended to entries, relations and roles), the acceptance stack loads the owner's real file (§5.1.10), and an offline install, or a fresh install while AniList is down, loads a saved file. The file holds raw pages, not tiers, so a file taken under the five-tier rules builds six tiers unchanged.
- `--export`: print the current snapshot as such a file (its entries, merge edges, characters and memberships written back into page bodies), so one install's snapshot can seed another and a fixture can be cut from a real snapshot.
- Output, for example: `Snapshot 2 active: 100 entries in 77 franchises, 2 983 characters (60 mythic, 179 legendary, 358 epic, 596 rare, 746 uncommon, 1 044 common); 0 skipped; 2 190 capped in 18 franchises; 31 changed tier, 12 dropped, 55 added; 291 AniList requests.` A `--dry-run` also lists the franchises, each title JSON-quoted with every remaining control character (Cc: DEL and C1 such as U+009B and U+009D, which `JSON.stringify` leaves raw), format character (Cf: bidi and zero-width marks) and U+2028/U+2029 written as `\uXXXX` (`quote` in `api/src/cli/quote.ts`), so nothing AniList sends can drive the owner's terminal; other scripts print as they are. A refusal message, which can name a field path out of a file, gets the same escapes without the quotes. Exit 1 with a one-line reason on refusal; exit 2 when a fetch paused after `ANILIST_MAX_RETRIES` (`Paused after 118 of about 290 requests; run again to resume.`).

### 7.2 `reset-collection`

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/reset-collection.js <login>
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/reset-collection.js <login> --confirm
```

Without `--confirm` it only prints what a reset would remove (`Would reset "<login>": 214 cards, 43 openings; pity and Enchanted counters to zero.`). With it, §5.6 runs and it prints `Collection reset for "<login>": 214 cards and 43 openings removed; packs full; counters reset.` (the login quoted as §7.1 prints titles) Exit 1 with a one-line reason on an unknown login. Sessions are not touched; a signed-in player sees the empty collection and `packsUntilGuarantee` 300 on the next fetch.

## 8. The web change (second PR)

`feat/collection-packs-ui` makes the web app a client of §6. **The card, its six frames, colours, stars, rank chip, glows and animation, the special-pack headings and lines, the pity line and the odds page are specified in `card-and-rarity.md`** (round 4, decision 9); `ui-designer`'s 1c web spec adds the pack control's states (ready with a count, waiting with a countdown, opening, cards unavailable), the reveal sequence and the collection without `Reset`. This section fixes only what the UI needs back and what it may not do.

**Deleted**: `web/src/lib/anilist.ts`, `web/src/hooks/useCharacterPool.ts`, `web/src/lib/pack.ts`, the roll and popularity functions in `web/src/lib/rarity.ts`, `useInventory`'s in-memory store, the browser `Character` and `Card` types (replaced by the shared schemas), `Reset`, the float constants and legacy tiers in `shared/src/rarity.ts`, the e2e routes that stub `graphql.anilist.co`, and the proof of concept's card treatment that `card-and-rarity.md` §10–§11 removes (`CharacterCard`'s `FRAME_CLASS`, the `legendary-pulse` keyframes, `.glow-legendary`, the `RarityBadge` overlay and the gradient scrim).

**What the UI needs back**, and nothing more:

- From `GET /api/packs`: `available`, `cap`, `nextPackInSeconds`, `intervalSeconds`, `packsUntilGuarantee`, and the published odds (`null` means cards are unavailable), which the odds page reads whole.
- From `POST /api/packs/open`: `packKind` and `pityMythic` (for the reveal's heading and line); the cards in `slot` order, each with the character's name, native name, image, rank and franchises (resolved through `franchises`), its rarity, variant and `isNew`; the allowance and `packsUntilGuarantee` after the opening.
- From `GET /api/collection`: the entries, `franchises`, totals, completion and `snapshot.characterCount`. PR 2 shows the existing collection view over them (one card per entry, the rarity filter as a view, six tiers); `collection-overview.md` (item 3) builds the full screen on the same answer.

**What the UI does with it**:

- The pack control is enabled when `available ≥ 1` and no opening is in flight. It shows the count and, below the cap, the countdown from `nextPackInSeconds`, counted from the moment the answer arrived. When the countdown ends the UI asks `GET /api/packs` once; it never polls on an interval. The countdown appears on the pack control only: no notification, sound, title change or "come back" prompt (ADR 0004 §6).
- The pity line shows the last answer's `packsUntilGuarantee` as `card-and-rarity.md` §7.4 words it, and is not rendered when it is null. The UI never counts packs itself and never says which kind the next pack will be.
- Each click generates `requestId = crypto.randomUUID()`. If the request gets no answer (network failure), the UI keeps that id and sends it again on the next click, so a lost response shows the cards the server actually dealt instead of opening a second pack. Any answer from the server discards it.
- The reveal is the server's cards in `slot` order with `isNew`; the pull summary counts their rarities. The UI never computes an outcome. A special pack, a Mythic or a Legendary gets no extra animation, sound or delay beyond the card's own frame (`card-and-rarity.md` §5.3, §7.1): ADR 0004 §6 rules out near-miss and suspense effects.
- `Collection (N)` is `totals.cards` from `GET /api/collection`, fetched at sign-in and refetched after each opening (until item 3 replaces that with its stale-marking rule). The Collection tab renders the entries; the rarity filter stays a view over them.
- The pool is no longer loaded at boot or while signed out (`App.tsx`), and the AniList error banner gives way to the cards-unavailable state.

**CSP**: the browser no longer talks to AniList's API, so `connect-src` becomes `'self'` alone; `img-src` keeps `https://s4.anilist.co`. The `Caddyfile`, the CI `docker` job's `EXPECTED_CSP` and `web/e2e/stack.spec.ts` change together. That makes PR 2 T3 as well (CSP/headers), on top of T1 for rendering third-party strings.

## 9. Tests required (minimum, T3)

**Unit** (`api/src/**/*.test.ts`, `shared/`):

- Allowance: a new account has `C`; opening from full leaves `C − 1` with `nextPackInSeconds` of one interval; `C` openings back to back leave 0; one interval later 1; a week later `C`; opening while the timer runs keeps the countdown; a clock set back an hour gives 0, never negative, and `nextPackInSeconds` ≥ 1; set forward a year gives `C`; a fraction of a second rounds up.
- Tables, exhaustively: for each of the five slot tables, `ENCHANTED_SLOT_ODDS` and `RADIANT_SLOT_ODDS`, every `r` from 0 to `ODDS_SCALE − 1` through the tier function yields exactly the table's counts, and no tier below the slot's floor; every table sums to `ODDS_SCALE`; the Radiant plan roll is Radiant for exactly `RADIANT_ODDS` of the million values.
- Figures, recomputed from the tables: the sums over the five slots are 2 800 000 / 1 200 000 / 800 000 / 170 000 / 27 500 / 2 500 and `share` is 560 000 / 240 000 / 160 000 / 34 000 / 5 500 / 500 parts per million; the `perPack` figures of §5.4.2 in `BigInt` (999 704, 1 000 000, 800 000, 170 000, 27 500, 2 500); the Enchanted and Radiant columns; the per-character rates fall strictly from Common to Mythic for every N from 225 to 6 000 with the rounded tier counts; the long-run figures of §5.4.6 from the Markov chain over the two counters, to the digits printed.
- Plan and precedence (scripted `Rng`, every row of §5.4.3's table): `free_packs_opened` 8 → standard, 9 → Enchanted, 19 → Enchanted; `packs_since_mythic` 298 → not pity-due, 299 → slot 5 Mythic without a tier roll and `pity` true, and a value past 299 is still pity-due; both due → `enchanted` with a pity Mythic; a Radiant first roll with either or both due → `radiant`, `pity` false, slots 1–4 from `RADIANT_SLOT_ODDS`, slot 5 Mythic; a shop source is never Enchanted or pity-due and still rolls Radiant; the plan roll is made even when pity is due (the stream does not depend on the counters).
- Counters: after a pack with a Mythic in any slot `packs_since_mythic` is 0, after one without it is one more; `free_packs_opened` grows by one for every free pack of every kind; a shop pack moves neither but its Mythic resets `packs_since_mythic`; `packsUntilGuarantee` = 300 − `packs_since_mythic`, never 0 or 301; over a scripted run of 30 000 free packs on the real generator, no run of 300 packs without a Mythic, every 10th pack Enchanted unless Radiant, and the counters equal their recomputation from the openings.
- Tiering: ranks by favourites with ties by id ascending, and a tie straddling a boundary puts the lower id in the higher tier; cumulative rounding at N = 225, 500, 501, 1 000, 2 983 and 6 000 gives §5.1.4's counts and sums to N; every tier ≥ `PACK_SIZE` from N = 225, and N = 224 has a short Mythic tier; N = 499 is refused by `SNAPSHOT_CHARACTERS_MIN`; equal favourites everywhere still give a deterministic split.
- Franchise cap: a franchise of 61 candidates keeps the 60 most favourited and drops the 61st; equal favourites at the boundary keep the lower id; a franchise of 60 or fewer keeps all; a character kept by one franchise and cut by another is in the pool with only the keeping franchise's memberships and a primary entry among them; no franchise has more than 60 members; ranks and tiers are computed after the cap; building the capped pool's `--export` again changes nothing; an entry the cap empties is not listed, cannot anchor its franchise, and the round trip holds, also when a merge path ran through it; the real file's figures of §5.1.10 (2 983 and its tier counts) are reproduced by a test that runs only when the owner's file is present, never in CI.
- Franchises: SEQUEL, PREQUEL, SIDE_STORY and PARENT merge, in either direction; SPIN_OFF, ALTERNATIVE, CHARACTER, SUMMARY, COMPILATION, CONTAINS, ADAPTATION, SOURCE, SAME_UNIVERSE and OTHER do not; two top-100 entries joined through one and through two entries outside the top 100 merge, through three do not; a relation to a non-anime node is ignored; the franchise id is the smallest member id and its title that entry's; an entry with no merging relation is a franchise of one.
- Memberships: a character in three entries of one franchise counts once in it; a character in two franchises counts once in each; a BACKGROUND appearance adds nothing; pool completion counts each character once.
- Pick: a scripted RNG gives the expected characters; always `PACK_SIZE` different ones; a Radiant pack whose five slots are all Mythic draws five different Mythics from a tier of exactly `PACK_SIZE`.
- AniList validation: each rejection rule of §5.1.6 on its own, with a valid neighbour accepted; a name, and separately a native name, made only of whitespace and Cf characters (`"​"`, `"­﻿"`, `" ⁠ "`, `"‮"`) → skipped as `character:name`; a name with visible letters and zero-width characters → accepted and stored as sent; a name, and separately a native name, made only of control characters (`"\u0007\u009b\u0085"`) → `character:name`; a title, an English title beside a valid romaji one, and a native title made only of format or control characters → `entry:title`, a title with letters beside them accepted; an entry id, a popularity, a character id, favourites or a relation node id of 2 147 483 648 → that item `malformed`, and 2 147 483 647 accepted; every canonical-URL refusal of §5.1.6 on its own (upper-case host, percent-encoded host, `:443`, backslash, `https:host` and `https:/host`, full-width and ideographic-stop hosts, zero-width and soft-hyphen hosts, a trailing-dot host, no path) → `character:image`, and `https://s4.anilist.co/file/anilistcdn/character/large/b40-abc.png` accepted; an entry id repeated across pages; `SNAPSHOT_SERIES_MIN − 1` entries or `SNAPSHOT_CHARACTERS_MIN − 1` characters → refused; more than `SNAPSHOT_CHARACTERS_MAX` → refused; hops beyond `FRANCHISE_MAX_REQUESTS` → refused; `IMAGE_HOST` equals the host in the `Caddyfile`'s `img-src`.
- Snapshot file: `--export` of a built snapshot fed to `--stdin` builds an identical pool (same tiers, ranks, franchises, memberships and primaries).
- Completion: owned and total per franchise and for the pool, with a dropped character, a dropped franchise and a character held at two rarities.
- Reserved fields: every card written in 1c is `variant = 'standard'`; every entry and opened card says `kind: "card"`.

**Statistical** (`api/src/domain/packs/roll.odds.test.ts`, in the unit project so it runs on every push), on the real `crypto.randomInt`, against a fixture snapshot of 1 000 characters split 20 / 60 / 120 / 200 / 250 / 350 by the band rule. Pearson chi-square, each test at α = 0.001; the critical values are the chi-square 0.999 quantiles. About 7.5 million generator calls; **runtime target under 10 s** on CI (7.5 million `randomInt` calls alone take about half a second; the deal around them is the cost).

| #    | Path                                             | Sample                                                                                                                                            | Test                                                                    | df, critical                                                             | Power (probability of catching)                                                                                                                        |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Standard packs, natural (counters held at 0)     | 400 000 packs; Radiant ones set apart for test 4                                                                                                  | slots 1–3 pooled (1 200 000 cards) against Common / Uncommon            | 1, 10.83                                                                 | Uncommon 1.05 times as often as published: above 0.999                                                                                                 |
| 2    | same run                                         | same                                                                                                                                              | slot 5 against Rare / Epic / Legendary / Mythic (Mythic expected 1 000) | 3, 16.27                                                                 | Mythic 1.25 times: above 0.999; 1.2 times: 0.99; Legendary 1.2 times: above 0.999; 0.5 points from Rare to Epic: above 0.999                           |
| 3    | same run                                         | same, all 2 000 000 cards                                                                                                                         | overall six-tier counts against `share` (the owner's figure)            | 5, 20.52                                                                 | Mythic 1.25 times: above 0.999                                                                                                                         |
| 4    | same run                                         | same 400 000 plans (Radiant expected 160)                                                                                                         | Radiant against not Radiant                                             | 1, 10.83                                                                 | Radiant 1.5 times as often: 0.999; twice: above 0.999 (1.25 times: 0.45, accepted: test 7 and the exhaustive test cover the threshold)                 |
| 5    | Enchanted, forced (`free_packs_opened` = 9 each) | 80 000 packs (slot-5 Mythic expected 1 000)                                                                                                       | slot 5 against `ENCHANTED_SLOT_ODDS`                                    | 2, 13.82                                                                 | Mythic 1.25 times: above 0.999; 1.2 times: 0.997                                                                                                       |
| 6    | Radiant, forced (scripted first call)            | 20 000 packs, 80 000 slots 1–4 (Mythic expected 1 000)                                                                                            | slots 1–4 against `RADIANT_SLOT_ODDS`                                   | 2, 13.82                                                                 | as test 5                                                                                                                                              |
| 7–12 | Character draw within each tier, tier forced     | 2 000 draws per character: 40 000 Mythic, 120 000 Legendary, 240 000 Epic, 400 000 Rare, 500 000 Uncommon, 700 000 Common picks, in packs of five | against uniform, per tier                                               | 19, 43.82; 59, 98.32; 119, 172.42; 199, 266.39; 249, 323.69; 349, 436.37 | one character 1.3 times as often as the others of its tier: at least 0.99 in every tier; 1.2 times: 0.999, 0.98 and 0.86 in Mythic, Legendary and Epic |

- **Pity** is not statistical: it is forced and deterministic (the plan tests above, and test 1's run asserts no pity pack because its counters are held at 0). The forced paths keep the tier tables on the real generator and force only the plan, so each table is tested where a natural run would see it too rarely (an Enchanted Mythic is 1 in 800 free packs, a Radiant pack 1 in 2 500).
- **Sized for the rarest cell**: each table's Mythic cell expects about 1 000, two hundred times the usual minimum of 5 for the chi-square approximation, so it holds in every cell and no exact binomial test is needed; the exhaustive mapping already proves every threshold, so these tests catch wrong wiring to the RNG, a table applied to the wrong slot or pack kind, and a biased pick. The no-repeat rule makes draws within a pack slightly dependent, which only makes the uniformity tests conservative.
- Deterministically, on the same runs: no pack repeats a character; every pack has `PACK_SIZE` cards; every card is at or above its slot's floor; each card's character belongs to the tier its slot rolled; slot 4 is always Uncommon and slots 1–3 never above Uncommon in a standard pack; every Enchanted slot 5 is Epic or better; every Radiant card is Epic or better and its slot 5 Mythic.
- A correct implementation fails one of the twelve tests about 12 times in a thousand runs. A failure is a finding: the message prints the observed and expected counts, and nobody reruns it to green without reading them or changes a sample size or α to make it pass.

**Route** (`api/test/packs.test.ts`, `api/test/collection.test.ts`): every row of §6.3, the happy path and each declared error; an extra field → 400; a query string on a GET → 400; a missing Origin on the POST → 403; signed out → 401 on each route; a new account reads `C` available, `packsUntilGuarantee` 300 and the published odds equal to the constants and the fixture's `tierSizes` and `characterCount`; an opening returns `PACK_SIZE` different characters in slots 0 to `PACK_SIZE − 1`, each card's rarity equal to its character's tier and at or above its slot's floor, its variant `standard`, each character's `rank` equal to its `favourites_rank`, `packKind` `standard`, `pityMythic` false and `packsUntilGuarantee` 299 (no Mythic, scripted); the 10th opening of a fresh account is `enchanted` with an Epic-or-better fifth card (`slot: 4`); an account whose `packs_since_mythic` is set to 299 gets a Mythic as its fifth card, `pityMythic` true and `packsUntilGuarantee` 300 after; a scripted Radiant opening is five Epic-or-better cards with a Mythic last; a replay returns the stored `packKind`, `pityMythic` and cards and moves neither counter; the collection and `account.cards` reflect the cards; the opening after the last available pack → 409 with `retryAfterSeconds` of one interval (fake clock) and `Retry-After`, counters unchanged; no snapshot → `odds: null`, `packsUntilGuarantee: null`, an opening 503, the allowance and counters unchanged; deleting an account removes its cards and openings and leaves snapshots, characters and series; the migration on a database with 1b accounts leaves them full with both counters 0.

**Snapshot update** (route level, two fixture snapshots): after activating a second snapshot in which character A moved from Epic to Legendary, B was dropped, franchise F left the top 100 and two franchises merged: every card granted earlier keeps its rarity and snapshot id, and shows the new name, image and rank; A is dealt only as Legendary; a player holding A at both rarities sees two entries and pool completion counts A once; B shows `inCurrentSnapshot: false`, `tier: null` and `rank: null`, counts in `totals` and in no completion, and is never dealt again; F has no `FranchiseCompletion` row and still appears in `franchises` for the entries that name it; the merged franchise counts each of its characters once; an opening that read snapshot 1 before the activation committed deals only from snapshot 1; the account's counters are the same before and after the activation.

**Concurrency** (route, parallel `inject()` calls): one pack and two different `requestId`s → one 201, one 409, `PACK_SIZE` cards in the table, `free_packs_opened` + 1; `C` packs and `C + 1` parallel openings → `C` × 201 and one 409, `free_packs_opened` + `C`; one pack and the same `requestId` twice → one 201 and one 200 with the same `openingId`, kind and cards, counters moved once; an opening racing `reset-collection` → the opening's cards are either all removed by the reset or all present after it, never part of them, and the counters are 0 or match the surviving openings.

**Snapshot command** (`api/test/snapshot.test.ts`, against a local `node:http` server): a good set of answers builds and activates a snapshot with the expected request count, franchise hops and pace (fake timers); a 429 with `Retry-After` waits that long and retries; one without waits `ANILIST_DEFAULT_RETRY_AFTER`; a 500, a stall past `ANILIST_TIMEOUT`, a body over `ANILIST_MAX_BODY`, invalid JSON and a GraphQL `errors` answer back off and retry, and after `ANILIST_MAX_RETRIES` the command exits 2 with the staged pages kept; the next run resumes at the first missing page and sends no request for a stored one; a fetch older than `FETCH_RESUME_MAX_AGE` starts over; a 400 stops at once; a refused build leaves the current snapshot exactly as it was; `--dry-run` writes no snapshot; the api server makes no request to the local AniList stand-in during the whole route suite.

**Reset command**: without `--confirm` nothing changes; with it the account's cards and openings are gone, `packs_anchor_at` is null and both counters are 0, other accounts are untouched, and the account's sessions still work; an unknown login exits 1.

**Adversarial** (`api/test/security/packs.security.test.ts`):

- Replay: the same `requestId` sequentially and in parallel → one opening, the allowance spent once, each counter moved once; account B sending A's `requestId` → B's own outcome, never A's cards.
- Forged, flipped, truncated and expired session cookies → 401, nothing written.
- Tampered outcome payloads: a body with `cards`, `rarity`, `tier`, `variant`, `kind`, `packKind`, `pity`, `pityMythic`, `enchanted`, `radiant`, `packsUntilGuarantee`, `packsSinceMythic`, `characterIds`, `slot`, `seed`, `odds`, `snapshotId`, `accountId` or `available` → 400 each, nothing written; a `requestId` that is not a uuid, is empty, or is 10 000 characters long → 400.
- Brute force against the limit: with packs available, the POST after `PACK_RATE_LIMIT` is used up within its window → 429 `rate_limited` with `Retry-After`.
- Clock: a `Date` header or a client time anywhere in the request changes nothing.
- No player reset: the route inventory has no reset, snapshot or AniList route; a POST to `/api/collection/reset` → 404.
- Leaks: no response carries a favourites count, `packs_since_mythic` or `free_packs_opened` by any name (only `packsUntilGuarantee`), or a card id.
- Hostile pool content (through `--stdin`): names, native names and titles with `<script>`, an `<img onerror>`, an RTL override and zero-width characters beside visible letters are stored and returned byte for byte as text; a name or native name with no visible character → that character skipped as `character:name`; a NUL anywhere → that item skipped; the image URLs that leave the host (`http://…`, `https://s4.anilist.co.evil.example/…`, userinfo before or after the host, `:8443`, `javascript:`, `data:`, `blob:`, protocol-relative and relative URLs, a trailing dot, `anilist.co`, lookalike and IP hosts, backslash and percent-encoded tricks, tab, newline and CRLF) and the ones only the parser's repair puts on the host (upper case, `%2E` and `%73%34`, backslashes, missing slashes, full-width letters, the ideographic full stop, a zero-width space, a soft hyphen, `:443`) → each skipped as `character:image` (the tester's suite pins both lists); every accepted URL satisfies `new URL(url).href === url` with origin `https://s4.anilist.co`; a relation cycle and a relation from an entry to itself build a finite franchise; 10 000 relation edges on one entry → only 200 read; a file with 6 001 valid characters → refused; a file over `SNAPSHOT_FILE_MAX` or nested 10 000 levels deep → refused without exhausting memory.
- Dependency audit: nothing added (the PR states it; manifests change in scripts only).

**Web (PR 2)**: unit tests for the pack control's states, the countdown's single refetch, the `requestId` kept after a network failure, the pity line hidden on `null`, and the reveal's heading and line per `packKind` and `pityMythic`; the T1 test that hostile character names and franchise titles render as text in the reveal and in the collection; the card tests `card-and-rarity.md` lists for the six tiers. e2e (`web/e2e`, against the compose stack with a snapshot seeded through §7.1): sign in, open `C` packs, and the next is disabled with a countdown; the pity line counts down by one per pack; a reload keeps `Collection (N)`; `localStorage` holds no collection or pool key; the page makes no request to `graphql.anilist.co`; the CSP header is the narrowed one.

## 10. Acceptance criteria

1. All routes in §6.3 exist, are schema-validated, carry their limit, and pass the tests in §9; `api/src` coverage stays ≥ 85 %.
2. The browser holds no roll, no pool and no collection: the files listed in §8 are gone, `connect-src` is `'self'`, and e2e proves there is no request to AniList's API. The reveal and the collection draw `card-and-rarity.md`'s card for all six tiers.
3. AniList is called only by `snapshot-pool`, run by the owner; the api server holds no AniList client; no test or CI job calls AniList.
4. The statistical and exhaustive tests pass at the stated sizes and α, within the runtime target.
5. `docs/05-security.md`: C1 live for collection and packs, the C6 pack override live, C8 narrowed, C10 live (its text updated for the slot tables, the plan roll and the forced-path tests); a T3 row per PR; the threat model gains the owner-run outbound call, AniList content (network or file) as untrusted input, the allowance clock, the pack counters, replayed openings and the owner's reset. `docs/04-deployment.md`: `snapshot-pool` (first snapshot on a fresh install, update, resume, `--stdin` and `--export`), `reset-collection`, and what an install without a snapshot looks like.
6. On the acceptance stack, the owner's real snapshot file (§5.1.10) loads through `--stdin`, builds 2 983 characters with §5.1.10's tier counts, and the PR records them; a new account opens `C` packs and then waits for the countdown; `packsUntilGuarantee` falls by one per pack; two tabs together cannot open more than the allowance; a reload keeps the collection; the collection answer shows pool and franchise completion.

## 11. Decision record

The owner's answers, as far as they concern 1c. ADR 0011 records the ones that change ADR 0004; round 4 changes ADR 0011 §6–7 (five tiers and their split), which the manager amends.

**Round 1** (answers to this spec's first open questions and to `economy.md`'s):

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                      | Where      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 2   | Completion: show both series completion (per anime: owned / total characters of that anime) and completion of the whole pool. The starting pool is all characters of the top 100 anime by AniList popularity with role MAIN or SUPPORTING.                        | §5.1, §5.5 |
| 3   | Rarity: fixed rarity per character, decided by character popularity; each character has one rarity set by its popularity rank, and a pack rolls the tier, then a character from that tier. This supersedes the earlier answer to keep the popularity tilt.        | §5.1.4     |
| 4   | Reset: an owner-only CLI reset of one account's collection, like reset-password; no button for players.                                                                                                                                                           | §5.6, §7.2 |
| 8   | AniList: no live refresh. Take a snapshot of the pool so AniList changes never influence the live game, and keep an owner-run option to update the snapshot (and the popularity ratings) later. The earlier design (refresh every 24 h, hourly check) is dropped. | §5.1, §7.1 |
| 9   | The glowing rarity frames on the pack reveal are replaced in the 1c web PR. **Superseded** by the owner's frames in `card-and-rarity.md` (Epic, Legendary and Mythic glow there, §5.4) and round 4, decision 9.                                                   | §8         |

Round 1 decisions 1, 5, 6 and 7 (recycle, the name Karma, the player market, the pack shop) are `economy.md`'s.

**Round 2** (answers to this spec's second open questions):

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                     | Where          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | Five tiers: Common, Rare, Epic, Legendary, Mythic (the name "Mythic" is kept). **Superseded** by round 4, decision 1 (six tiers).                                                                                | §4.1, §5.4     |
| 2   | Tier split by AniList favourites rank: Mythic 1 %, Legendary 4 %, Epic 10 %, Rare 25 %, Common 60 % of the pool. **Superseded** by round 4, decision 1.                                                          | §5.1.4         |
| 3   | Pack odds per pack, as the chance a 5-card pack contains at least one: Rare 94.1 %, Epic 17.6 %, Legendary 2 %, Mythic 0.33 %; Common fills the rest of each slot. **Superseded** by round 4, decisions 2 and 3. | §5.4           |
| 4   | Series completion groups AniList entries into franchises via AniList relations (sequels, prequels, side stories); a character counts once per franchise.                                                         | §5.1.2, §5.1.3 |
| 5   | After a snapshot update owned cards keep their granted rarity; names and images refresh from the newest snapshot.                                                                                                | §5.1.8         |
| 6   | Reserve, do not build: "Masterwork" versions of cards (a variant of a character's card with increased rarity) and "Relics" (a separate collectible kind, details later).                                         | §2, §4.1, §6.2 |

**Round 3** (answer to this spec's third open question):

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                                                                                                                        | Where |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | Rare versus Common: lower the Rare odds so a given Rare character is rarer than a given Common one: Rare at least once per pack about 80 % (per slot about 27.5 %); Epic 17.6 %, Legendary 2 %, Mythic 0.33 % per pack unchanged. **Superseded** by round 4, decisions 2 and 3; the principle (each tier's characters rarer than the tier below's) is kept, §5.4.2. | §5.4  |

The owner's economy answers of round 3 (no tier recycling, recycling duplicates for Karma, upgrades only through the mini-games) are `economy.md`'s; for 1c they change only the out-of-scope note on Masterworks (§2).

**Round 4** (the owner's revision of tiers and packs, with the tester's validation finding):

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                                                                                                                                                                                       | Where         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| 1   | Six tiers, Common, Uncommon, Rare, Epic, Legendary, Mythic, by popularity rank (AniList favourites): Mythic the top 2 %, Legendary 2–8 %, Epic 8–20 %, Rare 20–40 %, Uncommon 40–65 %, Common the rest (35 %).                                                                                                                                                                                                     | §4.2, §5.1.4  |
| 2   | Share of all cards pulled: Common 56 %, Uncommon 27 %, Rare 13 %, Epic 3.4 %, Legendary 0.55 %, Mythic 0.05 %. Could not hold together with decision 3; **superseded** by round 5, decision 1.                                                                                                                                                                                                                     | §5.4.1        |
| 3   | A pack of five cards: slots 1–3 Common or better, slot 4 Uncommon or better, slot 5 Rare or better (guaranteed).                                                                                                                                                                                                                                                                                                   | §5.4.1        |
| 4   | Special rules. Pity: the 300th pack without a Mythic gets a Mythic in slot 5 (per-account counter, reset by any Mythic from any source). Enchanted pack: every 10th free pack opened has Epic or better in slot 5. Radiant pack: 1 in 2,500 packs is five Epic-or-better cards including at least one Mythic. The pity counter is shown on the pack page: the API returns the packs remaining until the guarantee. | §5.4.3–§5.4.7 |
| 5   | The card face shows the popularity rank (`CharacterPublic.rank`, `SnapshotInfo.characterCount`); six tiers in `Rarity`, `PerRarity` and `RARITY_LABEL`; the published odds carry the per-card shares, slot floors, Enchanted interval, Radiant chance, pity count and tier bands; each opened pack carries its kind and whether its Mythic came from pity.                                                         | §5.4.8, §6.2  |
| 6   | The statistical tests are redesigned for the slot tables and the special rules.                                                                                                                                                                                                                                                                                                                                    | §9            |
| 7   | Validation (the tester's finding, the manager's rule): an image URL is accepted only if it is already canonical (`new URL(raw).href === raw`, https, host exactly `s4.anilist.co`, no port, no userinfo, no backslash, nothing the parser would repair); a name or native name with no visible character after removing whitespace and Cf characters is a skip.                                                    | §5.1.6        |
| 8   | The real snapshot of 2026-10-29 is stored as a file; the cap is round 5, decision 2.                                                                                                                                                                                                                                                                                                                               | §5.1.10, §12  |
| 9   | Frames and colours are specified in `card-and-rarity.md`; this spec's web section points to it.                                                                                                                                                                                                                                                                                                                    | §2, §8        |

**Round 5** (answers to the round-4 revision's two questions):

| #   | Decision (Owner, 2026-10-29)                                                                                                                                                                                                                         | Where                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Pull shares, option A: the standard pack's shares are Common 56 %, Uncommon 24 %, Rare 16 %, Epic 3.4 %, Legendary 0.55 %, Mythic 0.05 %, with the three slot floors kept. This supersedes round 4, decision 2's 27 / 13 split of Uncommon and Rare. | §5.4.1                |
| 2   | Pool cap, option B: cap per franchise, the 60 most-favourited MAIN and SUPPORTING characters of each franchise (ties by id), applied at build time, the snapshot file unchanged. 2 983 characters on the real snapshot.                              | §4.2, §5.1.3, §5.1.10 |

## 12. Open questions

None. Every question of the five rounds is answered (§11).

ADRs: ADR 0011 records round 1's decisions 3 and 8, round 2's tiers, Mythic and reserved Masterwork and Relics, and round 3's rule that upgrades come only from the mini-games, together with the economy's reversals of ADR 0004; round 4's six tiers, bands and special packs amend its §6–7. ADR 0009 says `shared/` holds the constants "the UI displays"; they still live there, and the UI now displays the server's copy of them.
