# Deployment

How to run the stack on the NAS, and how to run its parts while developing. The stack is three containers: **caddy** (the static web app plus a reverse proxy for `/api`), **api** (Fastify, Node 26) and **db** (PostgreSQL 16). The files this covers (`Dockerfile`, `api/Dockerfile`, `Caddyfile`, `compose.yml`, `.dockerignore`, `.env.example`, `api/.env.example`, the `docker` and `api-tests` jobs in `.github/workflows/ci.yml`) are security tier **T3** per `docs/05-security.md`.

## What the images are

**Web image** (`Dockerfile`, build context: the repository root). A `node:26-alpine` stage runs `npm ci --include-workspace-root --workspace shared --workspace web --ignore-scripts` (no package runs code during the build; the root `prepare` script would otherwise try to install Husky hooks) and `npm run build` for `shared` then `web`. A `caddy:2-alpine` stage serves `web/dist` from `/srv` on port **8080** as the unprivileged `web` user, with the `cap_net_bind_service` file capability that the base image sets on `/usr/bin/caddy` stripped (`setcap -r`) so the binary starts under `cap_drop: ALL`. The Caddyfile forwards `/api/*` to `api:3000` and serves everything else as the single-page app. Its `servers` block trusts `X-Forwarded-For` from private ranges only (`trusted_proxies static private_ranges`), so the host proxy or tunnel's view of the client reaches the api, and cuts stalled connections (`read_header 10s`, `read_body 30s`, `idle 2m`).

**Api image** (`api/Dockerfile`, build context: the repository root, because the api depends on `shared/` and the root lockfile). A `node:26-alpine` stage installs the root, `shared` and `api` workspaces with `--ignore-scripts`, compiles both (`shared/dist`, `api/dist`, with the SQL migrations copied next to the compiled code), then reinstalls with `--omit=dev` so only runtime modules remain. The final stage copies `package.json`, `node_modules`, `shared/dist` and `api/dist`, owned by root, and runs `node api/dist/server.js` as the unprivileged `api` user. Nothing writes to the filesystem at runtime. The image `HEALTHCHECK` is `GET /healthz`, which runs `SELECT 1`, so "healthy" means the database is reachable too.

**Database**: `postgres:16-alpine`, pinned by digest in `compose.yml`, run as the image's own `postgres` user from the start so its entrypoint never needs root or a capability. Data lives on a named volume; the socket directory and `/tmp` are tmpfs so the root filesystem stays read-only.

Base images are pinned to their multi-arch index digest; Dependabot (`package-ecosystem: docker`) proposes bumps.

## Profiles

Nothing starts without a profile. `compose.yml` defines:

| Profile       | Containers                                                                            | Published on                                     | Restart          |
| ------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------- |
| `acceptance`  | `anime-tcg-acceptance` (caddy), `anime-tcg-api-acceptance`, `anime-tcg-db-acceptance` | caddy only: `127.0.0.1:${ACCEPTANCE_PORT:-8080}` | no               |
| `production`  | `anime-tcg-production` (caddy), `anime-tcg-api-production`, `anime-tcg-db-production` | caddy only: `127.0.0.1:${PRODUCTION_PORT:-8081}` | `unless-stopped` |
| `dev`, `test` | `anime-tcg-db-local` (Postgres alone)                                                 | `127.0.0.1:${DEV_DB_PORT:-5432}`                 | no               |

Each of `acceptance` and `production` has two compose networks: `<profile>-front` carries Caddy to the api, `<profile>-back` carries the api to the database and is `internal: true`, so the database has no route out of the host and nothing but the api can reach it. The api carries the alias `api` on `front` and the database the alias `db` on `back`, which is why the Caddyfile's `reverse_proxy api:3000` and the api's `DATABASE_URL` (`...@db:5432/anime`) are the same text in both profiles. Caddy waits until the api is healthy; the api waits until the database is. **The api and the database publish no port**: `docker port anime-tcg-api-acceptance` prints nothing. Only Caddy is reachable from the host, and only on loopback.

**Pinned subnets.** Every compose network has a fixed subnet in 172.16.0.0/16: `acceptance-front` 172.16.10.0/24, `acceptance-back` 172.16.11.0/24, `production-front` 172.16.20.0/24, `production-back` 172.16.21.0/24 and the `dev`/`test` database's `default` 172.16.30.0/24. Without a pin Docker takes the next free block of its default pool, and when that pool is exhausted it continues into 192.168.0.0/16; on 2026-10-28 that put `acceptance-front` on 192.168.0.0/20, over the owner's home LAN, and every container on the host lost LAN access until the network was removed. Before the first start on a new host check that nothing there uses 172.16.0.0/16 (`route print -4` on Windows, `ip route` on Linux, `docker network inspect $(docker network ls -q) --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}'`) and change the pins in `compose.yml` if it does. Compose never changes the subnet of an existing network: a stack created before this change needs one `docker compose --profile <profile> down` (volumes stay) before it comes up on the pinned subnet.

Every container runs with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, a process limit (64; 128 for Postgres) and a memory limit (128 MB caddy, 256 MB api and db). Caddy gets a 16 MB `noexec,nosuid` tmpfs for each of `/data` and `/config`; Postgres gets tmpfs for `/var/run/postgresql` and `/tmp` and a 128 MB `/dev/shm`. Container logs rotate at 10 MB with 5 files kept (`json-file`), so no container can fill the NAS disk by logging.

## Variables

Compose reads them from the shell or from a file passed with `--env-file`. Use a gitignored name such as `.env.acceptance.local` or `.env.production.local` (`.env`, `.env.*` and `*.local` are ignored; `.env.example` is the only exception and lists every variable with a placeholder). The file is read by compose only; `.dockerignore` excludes `**/.env*` and `**/*.local` from every build context, so it never enters an image.

| Variable            | Required     | Meaning                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | yes          | Password of the `anime` database role (the owner; runs the migrations), used only inside the compose network. `openssl rand -hex 24`: hex, because the value is embedded in the connection URL and base64 characters would break it.                                                                                                    |
| `APP_DB_PASSWORD`   | yes          | Password of the `anime_app` role the api serves requests as: `SELECT`/`INSERT`/`UPDATE`/`DELETE` on the tables, less what migration `0004` takes back, and nothing else. Created by `db/init/01-app-role.sh` on the first start of an empty volume (see _Existing volumes_). `openssl rand -hex 24`                                     |
| `SESSION_SECRET`    | yes          | Key for the HMAC that protects session ids at rest. At least 32 bytes; the api refuses to start with fewer, or with the placeholder. `openssl rand -base64 48`                                                                                                                                                                          |
| `WEB_ORIGIN`        | yes          | The origin browsers use for the site, exactly as they send it in the `Origin` header (`http://127.0.0.1:8080` for acceptance, the proxy's or tunnel's `https://...` for production). State-changing requests from any other origin get 403.                                                                                             |
| `TAG`               | no (`local`) | Image tag for `anime-tcg-web` and `anime-tcg-api`; bake a date into production builds so you can roll back to it.                                                                                                                                                                                                                       |
| `ACCEPTANCE_PORT`   | no (`8080`)  | Loopback port of the acceptance stack.                                                                                                                                                                                                                                                                                                  |
| `PRODUCTION_PORT`   | no (`8081`)  | Loopback port of the production stack.                                                                                                                                                                                                                                                                                                  |
| `LOG_LEVEL`         | no (`info`)  | Api log level (`fatal` … `trace`, `silent`).                                                                                                                                                                                                                                                                                            |
| `INVITE_CODES`      | no (empty)   | Comma-separated invite codes players need to register, each 8 to 64 characters, compared trimmed and case-insensitively. Empty or absent closes registration (every code is refused and the api logs one warning at start-up). The code printed in `docs/design/accounts.md` is in a public repository: never use it as the real value. |
| `ACCOUNT_CAP`       | no (`10`)    | How many accounts may exist. Checked when a code is verified and again, authoritatively, inside the registration transaction.                                                                                                                                                                                                           |
| `DEV_DB_PORT`       | no (`5432`)  | Loopback port of the `dev`/`test` database.                                                                                                                                                                                                                                                                                             |

Compose derives the api's own environment from these: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`, `DATABASE_URL` (as `anime_app`, the pool every request runs on), `MIGRATIONS_DATABASE_URL` (as `anime`, one connection used by the migrations at start-up and closed afterwards), `API_ORIGIN` (same as `WEB_ORIGIN`, since the api is served under it) and the rate-limit defaults (100 requests per minute per client address), and passes `INVITE_CODES` and `ACCOUNT_CAP` through. The api refuses to start when the two URLs name the same role, or when an `INVITE_CODES` entry is outside 8 to 64 characters (it names the entry's position, never its text).

### Database roles

Two roles, so a bug that reaches the database cannot change the schema or empty a table: `anime` owns the database and runs the migrations (`api/src/db/migrations/`, including `0001_app_role_grants.sql`, which grants the app role row access to every current and future table in `public`, and `0004_packs_hardening.sql`, which takes back the rights no request or owner command uses: `UPDATE` and `DELETE` on `cards`, on the five `pool_snapshot_*` tables and on `pool_fetch_pages`, `UPDATE` on `pack_openings` and `pool_fetches`, `DELETE` on `characters`, `series` and `pool_snapshots`); `anime_app` is `LOGIN` only plus those grants, no `CREATE`, `TRUNCATE`, `REFERENCES`, and no access to `drizzle.__drizzle_migrations`. `db/init/01-app-role.sh` is mounted read-only into the Postgres entrypoint's init folder and creates `anime_app` with `APP_DB_PASSWORD`; the entrypoint runs it only when the data volume is empty.

**Existing volumes** (the acceptance volume on the dev station predates this): create the role by hand once, _before_ starting an api image that carries migration `0001` (the migration grants to the role and fails, and so does the api, if the role does not exist):

```bash
docker compose --env-file .env.acceptance.local --profile acceptance up -d db-acceptance
docker compose --env-file .env.acceptance.local --profile acceptance exec db-acceptance \
  psql -U anime -d anime -c "CREATE ROLE anime_app LOGIN PASSWORD '<the APP_DB_PASSWORD from the env file>'"
```

(`db-production` and `.env.production.local` for production.) To change the password later: `ALTER ROLE anime_app PASSWORD '<new>'`, then update `APP_DB_PASSWORD` and recreate the api container. The grants themselves are applied by the next api start-up; nothing else needs running by hand. `api/.env.example` documents the full set for running the api outside compose. The api validates all of it at start-up and exits naming the variable, never the value, when something is missing or wrong.

## Acceptance

```bash
cp .env.example .env.acceptance.local
# edit: POSTGRES_PASSWORD ($ openssl rand -hex 24), SESSION_SECRET ($ openssl rand -base64 48); WEB_ORIGIN stays http://127.0.0.1:8080
docker compose --env-file .env.acceptance.local --profile acceptance up -d --build --wait
curl -fsS http://127.0.0.1:8080/healthz        # ok              (Caddy)
curl -fsS http://127.0.0.1:8080/api/session    # {"signedIn":false}
docker compose --env-file .env.acceptance.local --profile acceptance exec api-acceptance wget -qO- http://127.0.0.1:3000/healthz
                                               # {"status":"ok","db":"ok"}   (the api's own probe; not routed through Caddy)
docker port anime-tcg-api-acceptance           # prints nothing
```

Open http://127.0.0.1:8080, open a few packs, check the collection persists across a reload (the web app still opens packs in the browser until the 1c web PR moves it onto the api's pack routes; those routes answer `pool_unavailable` until a snapshot is loaded, see _Take the card pool snapshot_). Then:

```bash
docker compose --env-file .env.acceptance.local --profile acceptance down            # keeps the database volume
docker compose --env-file .env.acceptance.local --profile acceptance down --volumes  # drops it
```

Acceptance is bound to loopback and cannot be changed through a variable. It is for the owner's own checks on the host, never for the LAN. On the dev station it is kept on the newest app change of `main` by the acceptance watcher (`docs/03-release-process.md`, _Automatic acceptance_). The three acceptance services restart unless stopped, so a Docker restart brings the stack back.

**A database that ran the five-tier `0003`** (an acceptance or development volume that ran `feat/collection-packs` before its six-tier revision): migration `0003_collection_packs.sql` was rewritten in place before it reached `main`, with a newer timestamp, so the migrator tries to apply it again, fails on the types and tables the old one created, and the api exits. Recreate the volume with `down --volumes` and load the snapshot again; nothing in it is worth keeping. A database that never ran the branch, production included, just applies the new `0003`.

## Production

```bash
TAG=2026-10-28 docker compose --env-file .env.production.local --profile production up -d --build --wait
```

Build only from a commit on `main` whose CI run is green (branches no longer have to be up to date with `main` before merging, so the `main` run is the proof the merged tree works; `docs/01-github-flow.md`). This builds `anime-tcg-web:2026-10-28` and `anime-tcg-api:2026-10-28` and starts the three production containers; Caddy listens on `127.0.0.1:8081`. Later runs with the same `TAG` and no `--build` reuse those images. `docker image ls 'anime-tcg-*'` lists what you have. Set `WEB_ORIGIN` to the public `https://` origin the proxy or tunnel serves; a wrong value makes every POST a 403.

The api applies pending SQL migrations (`api/src/db/migrations/`) before it starts listening and exits if one fails, so a bad migration never results in a half-running service.

### Network exposure

Production is published on loopback only and is reached through a reverse proxy or Cloudflare Tunnel on the same host. There is no variable to widen the bind address, on purpose: Docker's published ports bypass `ufw` / `firewalld` unless the `DOCKER-USER` chain is configured, so a `0.0.0.0` binding would be reachable from the LAN (or the internet, if the host is) regardless of the host firewall's rules. If the proxy runs as a container, attach it to this project's `production-front` network only (`docker network connect <project>_production-front <proxy>`, where `<project>` is the checkout's directory name in lowercase, or declare that network as `external` in the proxy's own compose file) and reference the service by name, `http://caddy-production:8080`, instead of publishing any port. Never give a proxy the `production-back` network: that one exists so the database is reachable from the api alone. The api and the database are never published, in any profile.

### Reverse proxy or tunnel

Point the proxy at `http://127.0.0.1:8081` (or your `PRODUCTION_PORT`). The proxy owns TLS, HSTS, any authentication and access logs; the containers do none of that.

The proxy must pass the visitor's address in `X-Forwarded-For`: the api keys its rate limit on it, and the container's Caddy trusts that header only from private ranges, which the host proxy and a tunnel connector are. Caddy on the host and `cloudflared` set or append it by default; nginx needs `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. Behind Cloudflare Tunnel, Cloudflare appends to whatever `X-Forwarded-For` the visitor sent, so the leftmost entry can be forged. That is harmless to the api: it walks the header from the right and keys on the first entry that is not a trusted proxy, which is the one Cloudflare appended. Keep `trusted_proxies static private_ranges` in the container's `Caddyfile` `servers` block (without it Caddy replaces the header with the Docker gateway address and every visitor shares one bucket) and, if Caddy's own `{client_ip}` placeholder and access logs should show the visitor rather than the connector, add `client_ip_headers CF-Connecting-IP` next to it. That directive only applies to peers matched by `trusted_proxies` and does not change what the api sees. Caddy on the host:

```
anime.example.com {
	reverse_proxy 127.0.0.1:8081
}
```

Cloudflare Tunnel (`cloudflared` config ingress):

```yaml
ingress:
  - hostname: anime.example.com
    service: http://127.0.0.1:8081
  - service: http_status:404
```

### Data and backups

The database volume (`<project>_db-production`) is the only state in the stack. A dump for the NAS backup scheme (control C16, still planned):

```bash
docker compose --env-file .env.production.local --profile production exec db-production pg_dump -U anime anime > anime-$(date +%F).sql
```

## Operations

### Reset a player's password

There is no self-service reset (ADR 0008 §3). The owner runs the command inside the api container; it reads the new password from stdin so the password never lands in shell history or `ps`:

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production \
  node api/dist/cli/reset-password.js <login> <<'PASSWORD'
the new password
PASSWORD
```

It prints `Password reset for "<login>"; N sessions ended.` (the login JSON-quoted, with every control character, DEL and C1 included, every format character such as a bidi or zero-width mark, and U+2028/U+2029 printed as `\uXXXX`; other scripts print as they are): the Argon2id hash is rewritten and every session of the account is ended, so the player signs in again with the new password on every device. The login is matched case-insensitively (the stored spelling is printed back); the password must be 8 to 128 characters and is taken exactly as given except for the here-document's own trailing newline. An unknown login or a bad password is one line on stderr and exit code 1. The command needs `DATABASE_URL` only (the app role has every statement it uses), which compose already sets on the container. `api-acceptance` and `.env.acceptance.local` for the acceptance stack; outside compose, `node api/dist/cli/reset-password.js <login>` with `DATABASE_URL` exported.

The two commands below (`docs/design/collection-packs.md` §7) work the same way: run inside the api container, `DATABASE_URL` only, one line on stderr and exit code 1 on a refusal. 1c adds no variable.

### Take the card pool snapshot

The game deals cards only from a snapshot of AniList that the owner takes: the MAIN and SUPPORTING characters of the 100 most popular anime, the anime grouped into franchises, each franchise keeping its 60 most-favourited characters (`SNAPSHOT_CHARACTERS_PER_FRANCHISE`), and each character given one of six fixed rarity tiers by its favourites rank in that capped pool (Mythic the top 2 %, Legendary 6 %, Epic 12 %, Rare 20 %, Uncommon 25 %, Common 35 %). The cap is applied when a snapshot is built, never to the fetched pages or a snapshot file, so the same file always builds the same pool. The api server never calls AniList; this command is the only thing in the system that does, and only when you run it. It runs in the api container, which reaches the internet through its `front` network (no compose change; `back` stays internal).

**A fresh install has no snapshot.** Until the first one is active, `GET /api/packs` answers `odds: null` and `packsUntilGuarantee: null`, and `POST /api/packs/open` answers 503 `pool_unavailable`; accounts keep their pack allowance (it accrues up to 3 and is not spent by a refused opening) and their pity and Enchanted counters do not move. Take the first snapshot after the first deploy:

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production \
  node api/dist/cli/snapshot-pool.js --dry-run     # fetch and build, print what would change, activate nothing
docker compose --env-file .env.production.local --profile production exec -T api-production \
  node api/dist/cli/snapshot-pool.js               # build from the pages the dry run fetched, and activate
```

It prints a line of counts, for example `Snapshot 2 active: 100 entries in 77 franchises, 2983 characters (60 mythic, 179 legendary, 358 epic, 596 rare, 746 uncommon, 1044 common); 0 skipped; 2190 capped in 18 franchises; 31 changed tier, 12 dropped, 55 added; 291 AniList requests.`, then the Karma shop's genre themes the snapshot offers and every genre it does not, with why: for a genre too small, each tier that holds fewer than a pack's 5 characters (`docs/design/economy.md` §8.6). Genres are quoted the way titles are. On the real snapshot that reads:

```
Genre themes on offer: 13 of 17 genres:
  "Action" (genre-action)
  "Adventure" (genre-adventure)
  ...
  "Thriller" (genre-thriller)
Genres not on offer:
  "Ecchi": mythic 2 of 5
  "Mecha": mythic 4 of 5
  "Music": common 0 of 5, ...
  "Sports": mythic 1 of 5
```

`--dry-run` prints the same counts and genre themes, then the franchise list, each franchise with its kept characters and, when the cap trimmed it, how many it cut (`8. "ONE PIECE" (21): 1 entry, 60 characters (755 capped)`; titles are quoted the way the reset commands quote a login, so a control or format character AniList sends prints as `\uXXXX`), and writes no snapshot. `capped` counts the characters the cap left out of the pool; they are not errors and are not in `skipped`. The `snapshot built` log line on stderr carries the same counts and `cappedByFranchise` (franchise id to characters cut). Progress goes to stderr as JSON log lines every 25 requests.

- **Pace**: one request every 2.5 s (24 a minute, below AniList's degraded 30), never in parallel. Expect about 210 to 310 requests, 9 to 13 minutes. More than 1 000 needed, or more than 40 for the franchise relations, is refused (exit 1) rather than built from a partial answer.
- **Resume**: every page is stored as it arrives. A 429 waits its `Retry-After` (60 s without one, 15 minutes at most); other failures back off 2, 4, 8, 16 and 32 s. After five retries of one request the command stops with exit code 2 (`Paused after 118 of about 240 requests; run again to resume.`); running it again continues from the first missing page. A fetch that began more than 24 hours ago is started over so a snapshot never mixes rankings from days apart; `--restart` starts over on demand. A dry run keeps the fetched pages, so the run after it sends no request.
- **Refusals** (exit 1, nothing changes, the current snapshot stays): fewer than 90 valid entries, fewer than 500 or more than 6 000 characters in the capped pool, a tier with fewer than 5 characters, or AniList refusing a request with a 4xx other than 429. With at most 100 franchises of at most 60 the cap itself keeps the pool at 6 000 or fewer.
- **Skipped items** are counted by reason in the output and the log (`character:image`, `character:name`, ...). An image URL is accepted only when it is already in the exact form the browser loads (https on `s4.anilist.co`, nothing the URL parser would rewrite); a name, native name or title with no visible character (only whitespace, control or format characters) is skipped, and so is an item whose id, popularity or favourites will not fit a database integer. AniList's own data passes both rules (the 2026-10-29 snapshot skipped nothing), so a jump in skips means AniList changed what it sends.
- **Updating later**: run the same command whenever you choose. Cards players already own keep the rarity they were granted with; names, images and the rank shown on the card refresh from the new snapshot; tier changes apply to packs opened from the activation on; a character the new snapshot drops stays in collections and is never dealt again. Players' pity and Enchanted counters are not touched by an activation. A dry run takes a version number that the next real activation does not reuse.
- **From a file** (an offline install, AniList down, or seeding a test stack): `--stdin` loads a snapshot file through the same validation, cap and refusals and records it as source `file`; `--export` prints the current snapshot as such a file (the capped pool, so loading it again builds the same pool), so one install can seed another. Files are at most 64 MB. The owner's real snapshot of 2026-10-29 (`snapshot-2026-10-29.json`, kept outside the repository) loads as 2 983 characters, 2 190 capped in 18 franchises; with `REAL_SNAPSHOT_FILE` set to its path, `npm run test:routes -w api` checks those figures (CI never has the file and skips that test).

A snapshot file is AniList's content and is never committed: keep it outside the repository, in `~/.anime-tcg/snapshots/` (`.gitignore` also ignores `snapshot*.json` as a backstop).

```bash
mkdir -p ~/.anime-tcg/snapshots
docker compose --env-file .env.production.local --profile production exec -T api-production \
  node api/dist/cli/snapshot-pool.js --export > ~/.anime-tcg/snapshots/snapshot-$(date +%F).json
docker compose --env-file .env.acceptance.local --profile acceptance exec -T api-acceptance \
  node api/dist/cli/snapshot-pool.js --stdin < ~/.anime-tcg/snapshots/snapshot-2026-10-29.json
```

### Reset a player's collection

There is no player-facing reset; the owner resets one account's collection:

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production \
  node api/dist/cli/reset-collection.js <login>             # Would reset "<login>": 212 cards, 2 recycled cards, 43 openings; pity and Enchanted counters to zero; balance 2750 to 0.
docker compose --env-file .env.production.local --profile production exec -T api-production \
  node api/dist/cli/reset-collection.js <login> --confirm   # Collection reset for "<login>": 212 cards, 2 recycled cards and 43 openings removed; packs full; counters reset; balance 2750 set to 0.
docker compose --env-file .env.production.local --profile production exec -T api-production \
  node api/dist/cli/reset-collection.js <login> --keep-karma --confirm   # ...; balance 2750 kept.
```

Without `--confirm` it only counts: the cards the player holds, and apart the cards already recycled (shown only when there are some), which the reset deletes too, and the account's live market listings (`, 2 listings`, shown only when there are some). With it, the account's live listings are cancelled first (one already past its expiry is closed as expired), so nobody can buy one; then the account's pack openings and their cards are deleted, and so are the cards it bought on the market (through the `delete_bought_cards` function of migration `0006`, the one way the app role deletes a card); the listings keep their history without their card, and the account's purchases and sales stay in its ledger and in the other players' receipts. The same run leaves its allowance full and both pack counters at 0 as on registration (the guarantee reads 300 free packs again and the next Enchanted pack is the 10th), in one transaction under the same account lock an opening takes, so an opening running at that moment is either removed whole or kept whole. The Karma balance is your choice per reset (`docs/design/economy.md` §8.10): by default it goes to 0 with one `owner_reset` ledger row of minus the balance (none when it is already 0); with `--keep-karma` it stays and nothing is written to the ledger. Either way the account's ledger and recycles stay as its history, and the reset's time is recorded on the account, which is how `audit-ledger` knows the recycles and shop purchases before it lost their cards and openings to the reset. The login, password, sessions and account id stay; a signed-in player sees the empty collection on the next fetch. The login is matched case-insensitively; an unknown one is exit code 1.

### Audit the market

The owner's report on Karma moving between accounts (`docs/design/economy.md` §10, §13.3), to read after the acceptance checks and whenever multi-accounting is suspected:

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production \
  node api/dist/cli/audit-market.js             # No findings.
docker compose --env-file .env.production.local --profile production exec -T api-production \
  node api/dist/cli/audit-market.js --days 90   # the same report over the last 90 days (1 to 3650; 30 by default)
```

Read-only, in one repeatable-read transaction. Under a heading per section, one line per finding, each account named by its quoted login and its id: the net Karma per account pair over the last 7 days and over the period, largest first; pairs where one side makes more than half of the other's market volume; each seller's sales at the floor and at the cap of their tier; listings bought within 60 seconds of being listed; pairs that registered with the same invite code and traded with each other. `No findings.` when the market had no trade in the period. The exit code is 0 either way: the server cannot tell two people from one person with two accounts, so a finding is for you to judge, with `reset-collection`, deleting an account or rotating `INVITE_CODES` as the remedies. `DATABASE_URL` only.

### Audit the Karma ledger

Run before every release and after any restore of the database (C16):

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production \
  node api/dist/cli/audit-ledger.js   # Ledger consistent: 10 accounts, 1234 entries.
```

Read-only, in one repeatable-read transaction, so it can run while the game does. It checks every account against `docs/design/economy.md` §7: the balance equals the sum of its ledger rows and the newest row's `balance_after`; `seq` runs 1, 2, 3 ... with no gap and each row's `balance_after` follows from the one before; every row has its kind's sign; every shop opening has its debit of the price it recorded; every recycle has its credit of count × the value per card it recorded and removed exactly that many cards of its own entry (or none, only if the account was reset after the recycle); every shop purchase has its opening (or none, only if the account was reset after the purchase); every market purchase has the buyer's debit of its price and the seller's sale of the price and fee of the listing's fee, its listing sold at that price and fee, and moved one card each way (the bought card missing only after a reset of the buyer, the sold one only after a reset or the deletion of the seller); a market sale and fee without a purchase are accepted only as what a listing sold to an account since deleted leaves behind, amount for amount; a live listing's card is still the seller's to sell; a reset account holds no card older than its last reset (`card <id> predates the last reset`); no credit lacks its recycle; no card is removed by nothing or held in escrow. A consistent ledger is one line on stdout and exit 0; otherwise one line per failing account on stderr (`Account "<login>" (<id>): <what is wrong>; ...`) and exit 1. A failure is a bug or a tampered database: stop and investigate before releasing. After a change of `RECYCLE_VALUE`, `THEMED_PACK_PRICE` or the market fee, rows recorded at the old value
are listed on stdout as `Note: Account "<login>" (<id>): ...` lines; they are expected and do not change the exit code. `DATABASE_URL` only.

## Rollback

Re-run production with the previous tag and without a build:

```bash
TAG=2026-10-21 docker compose --env-file .env.production.local --profile production up -d --no-build
```

Compose recreates the containers from the older images. The database keeps its data; migrations are forward-only, so rolling back past a migration is safe only when that migration was additive (true of everything so far: `0000` creates the `sessions` table, `0001` grants the app role row access, `0002` creates `accounts` and `auth_throttle` and adds the foreign key from `sessions.account_id`, `0003` creates the snapshot pool, pack opening and card tables and adds the nullable `accounts.packs_anchor_at` and the two pack counters `packs_since_mythic` and `free_packs_opened`, both defaulting to 0, `0004` adds checks on `cards.slot` and `characters.image_url` that every row the api writes already satisfies and revokes rights no api image uses; an older api image that still connects as `anime` is unaffected by the grants, one that never sets `account_id` is unaffected by the constraint, and one from before 1c never reads the new tables or column). `0006` (the market) is the first that is not: it makes a card's opening and slot nullable for bought cards and adds the not-null search columns of `characters` and `series`, so an api image from before it cannot load a snapshot over it (its upsert leaves the search columns empty) and does not know bought cards; roll back past `0006` only to an image that also has it, or restore the database from before it. `0007` and `0008` only tighten `delete_bought_cards` and the `cards_removed_stays` trigger, which an image with `0006` never trips. Session rows survive a rollback, account, snapshot and card rows stay in their tables for the next deploy, and the browser-side collection the web app still keeps until the 1c web PR is unaffected.

## Headers

Caddy sets on every response, including the ones it proxies from the api:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://s4.anilist.co; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- No `Server` or `Via` header.

The headers live in a `(site_headers)` snippet that the site and `handle_errors` both import, so Caddy's own error responses (a 405 on the shell, a 502 while the api is down) carry them too, with the error status and an empty body. A missing `/assets/*` file is answered by the asset handle itself with a plain 404 and an empty body, under the same headers. The CI `docker` job asserts this.

`connect-src 'self'` already covers `/api`, which is why the api is proxied under the same origin instead of getting CORS. `style-src` is `'self'` with no `'unsafe-inline'`: React applies the `style` prop through the CSSOM, which CSP does not govern, and the production build links its CSS via `<link>` with no inline `<style>`. The dev server, which does inject `<style>` elements, never runs behind this `Caddyfile`. If SSR or a `?inline` CSS import is ever introduced, this must be revisited (a nonce or hash, not `'unsafe-inline'`). `img-src` names the only remote host the app uses, AniList's image CDN; since the 1c web PR the browser no longer calls AniList's API (`docs/design/collection-packs.md` §8), so `connect-src` is `'self'` alone. Adding a remote host means updating `Caddyfile`, this file, `EXPECTED_CSP` in `.github/workflows/ci.yml` and `web/e2e/stack.spec.ts` together.

The api adds `Cache-Control: no-store` to every response of its own (nothing from `/api` is cacheable) and its own `X-Content-Type-Options: nosniff`; helmet's remaining defaults are harmless duplicates of Caddy's. Caching of the static site: `/assets/*` is content-hashed by Vite and served with `Cache-Control: public, max-age=31536000, immutable`; `index.html` is `no-cache`, so a new deploy is picked up on the next load; a missing `/assets/*` file gets no `Cache-Control`, and a 405 keeps whatever `Cache-Control` its route had set (harmless: a response to a POST or PUT is never reused for a GET).

Routing: `/api` and everything under `/api/` go to the api with the path unchanged, and `/healthz` is answered by Caddy itself. Every other path serves the app's `index.html` (status 200, `no-cache`) and the client router decides what to show, including its not-found page; only `/assets/*` answers a missing file with a plain 404 instead of the app.

Left to the proxy: TLS, `Strict-Transport-Security`, and anything that needs to know the public hostname.

## Development

```bash
POSTGRES_PASSWORD=x APP_DB_PASSWORD=x SESSION_SECRET=x WEB_ORIGIN=x \
  docker compose --profile dev up -d      # Postgres on 127.0.0.1:5432, database anime; roles anime / anime (owner) and anime_app / anime_app
cp api/.env.example api/.env.local        # set SESSION_SECRET; the rest matches the dev database (INVITE_CODES=local-dev-invite opens registration locally)
npm run dev                               # api on :3000 (node --watch, reloads on change) + Vite on :5173
```

The four throwaway values are needed even though the `dev` and `test` profiles start Postgres alone: compose interpolates every service in the file before applying the profile filter, and the `:?` guards on the acceptance and production services fail on a missing value ("required variable POSTGRES_PASSWORD is missing a value"). The local database ignores them; its credentials are fixed in `compose.yml`. Put `DEV_DB_PORT=55432` (any free port) in front as well when something else already listens on 5432, and point `DATABASE_URL` and `MIGRATIONS_DATABASE_URL` in `api/.env.local` (or the shell, for the route tests) at that port.

Vite proxies `/api` to `localhost:3000`, so the browser sees one origin in development as well. `api/.env.local` is loaded by `node --env-file-if-exists`; `server.ts` is the only file that reads the environment. The database schema is applied by the api at start-up. After changing `api/src/db/schema.ts`, run `npm run db:generate -w api` and commit the SQL it writes under `api/src/db/migrations/`; never edit a committed migration.

Tests:

```bash
npm run check                 # format, lint, typecheck, every unit suite, build (what the pre-push hook runs; no database needed)
npm run test:routes -w api    # route + adversarial tests against DATABASE_URL (default: the dev/test database above)
npm run test:coverage -w api  # unit + routes with coverage; fails under 85 % statements
npm run test:e2e              # Playwright against the Vite dev server
```

`POSTGRES_PASSWORD=x APP_DB_PASSWORD=x SESSION_SECRET=x WEB_ORIGIN=x docker compose --profile test up -d` starts the same loopback database as `dev` for the route tests (same throwaway values, same reason as above; add `DEV_DB_PORT=55432` when 5432 is taken and export the two URLs with that port before running the tests); stop it with the same prefix and `--profile test down` (add `--volumes` to start fresh). The route tests run the app pool as `anime_app` (`DATABASE_URL`) and the migrations as `anime` (`MIGRATIONS_DATABASE_URL`); a `db-local` volume created before the init script existed needs the `CREATE ROLE anime_app LOGIN PASSWORD 'anime_app'` statement once, or `--volumes` to recreate it. Test cleanup is `DELETE`, not `TRUNCATE`, because the app role is not granted the latter; the snapshot cleanup runs as the owner, because the app role may not delete snapshots, characters or series.

## CI

`.github/workflows/ci.yml`:

- `quality`: root `format:check`, `lint`, `typecheck`, the shared unit tests (the schema guard), the web unit tests with coverage, the api unit tests, `build`.
- `api-tests`: a `postgres:16-alpine` service container in which a `psql` step creates `anime_app` (the service container has no init mount); `npm run test:coverage -w api` with `DATABASE_URL` (app role) and `MIGRATIONS_DATABASE_URL` (owner) pointing at it runs the unit, route and adversarial suites and enforces the 85 % statement threshold from `api/vitest.config.ts`.
- `e2e`: Playwright against the Vite dev server.
- `security`: `npm audit` (high and above) and gitleaks over the full history.
- `docker`: writes throwaway `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` and `SESSION_SECRET` values to `.env.ci` at run time, runs `docker compose --env-file .env.ci --profile acceptance up -d --build --wait --wait-timeout 120` with `TAG=ci`, and asserts with `docker inspect` that all three containers run read-only, non-root, with every capability dropped, `no-new-privileges` and their pid limits, that Caddy is bound to `127.0.0.1` and that the api and db publish nothing. It then checks `/healthz` and the app `<title>` through Caddy, the exact `Content-Security-Policy`, that `/api/session` answers `{"signedIn":false}` with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and neither a `Server` nor a `Via` header, that a POST without `Origin` gets 403, that `/packs` serves the app shell with the exact CSP and `no-cache`, that a missing `/assets/*` file is a 404 that is not HTML and not `immutable`, that `POST /` is a 405 with an empty body, the CSP, nosniff and no `Server` or `Via`, that `/api` itself answers the api's JSON `not_found`, that the api's own `/healthz` reports `db: ok` from inside the network, that a request sent with `X-Forwarded-For: 203.0.113.9` is logged by the api with that `remoteAddress` (the `trusted_proxies` proof), and that the api image has no `node_modules/typescript` (no dev modules at runtime). A last step stops the api and checks that `/api/session` is then a 502 with an empty body, the exact CSP and no `Server` or `Via`. Compose logs are printed on failure and the stack is always torn down with `--volumes`. The checkout step uses `persist-credentials: false` so the workflow token is never in a build context. `docker` is one of the required checks in the ruleset (`docs/01-github-flow.md`).
