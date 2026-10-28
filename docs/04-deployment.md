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

Every container runs with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, a process limit (64; 128 for Postgres) and a memory limit (128 MB caddy, 256 MB api and db). Caddy gets a 16 MB `noexec,nosuid` tmpfs for each of `/data` and `/config`; Postgres gets tmpfs for `/var/run/postgresql` and `/tmp` and a 128 MB `/dev/shm`. Container logs rotate at 10 MB with 5 files kept (`json-file`), so no container can fill the NAS disk by logging.

## Variables

Compose reads them from the shell or from a file passed with `--env-file`. Use a gitignored name such as `.env.acceptance.local` or `.env.production.local` (`.env`, `.env.*` and `*.local` are ignored; `.env.example` is the only exception and lists every variable with a placeholder). The file is read by compose only; `.dockerignore` excludes `**/.env*` and `**/*.local` from every build context, so it never enters an image.

| Variable            | Required     | Meaning                                                                                                                                                                                                                                     |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | yes          | Password of the `anime` database role, used only inside the compose network. `openssl rand -hex 24`: hex, because the value is embedded in the connection URL and base64 characters would break it.                                         |
| `SESSION_SECRET`    | yes          | Key for the HMAC that protects session ids at rest. At least 32 bytes; the api refuses to start with fewer, or with the placeholder. `openssl rand -base64 48`                                                                              |
| `WEB_ORIGIN`        | yes          | The origin browsers use for the site, exactly as they send it in the `Origin` header (`http://127.0.0.1:8080` for acceptance, the proxy's or tunnel's `https://...` for production). State-changing requests from any other origin get 403. |
| `TAG`               | no (`local`) | Image tag for `anime-tcg-web` and `anime-tcg-api`; bake a date into production builds so you can roll back to it.                                                                                                                           |
| `ACCEPTANCE_PORT`   | no (`8080`)  | Loopback port of the acceptance stack.                                                                                                                                                                                                      |
| `PRODUCTION_PORT`   | no (`8081`)  | Loopback port of the production stack.                                                                                                                                                                                                      |
| `LOG_LEVEL`         | no (`info`)  | Api log level (`fatal` … `trace`, `silent`).                                                                                                                                                                                                |
| `DEV_DB_PORT`       | no (`5432`)  | Loopback port of the `dev`/`test` database.                                                                                                                                                                                                 |

Compose derives the api's own environment from these: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`, `DATABASE_URL`, `API_ORIGIN` (same as `WEB_ORIGIN`, since the api is served under it) and the rate-limit defaults (100 requests per minute per client address). `api/.env.example` documents the full set for running the api outside compose. The api validates all of it at start-up and exits naming the variable, never the value, when something is missing or wrong.

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

Open http://127.0.0.1:8080, open a few packs, check the collection persists across a reload (the game itself is still the browser-side proof of concept until 1b/1c). Then:

```bash
docker compose --env-file .env.acceptance.local --profile acceptance down            # keeps the database volume
docker compose --env-file .env.acceptance.local --profile acceptance down --volumes  # drops it
```

Acceptance is bound to loopback and cannot be changed through a variable. It is for the owner's own checks on the host, never for the LAN.

## Production

```bash
TAG=2026-10-28 docker compose --env-file .env.production.local --profile production up -d --build --wait
```

This builds `anime-tcg-web:2026-10-28` and `anime-tcg-api:2026-10-28` and starts the three production containers; Caddy listens on `127.0.0.1:8081`. Later runs with the same `TAG` and no `--build` reuse those images. `docker image ls 'anime-tcg-*'` lists what you have. Set `WEB_ORIGIN` to the public `https://` origin the proxy or tunnel serves; a wrong value makes every POST a 403.

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

## Rollback

Re-run production with the previous tag and without a build:

```bash
TAG=2026-10-21 docker compose --env-file .env.production.local --profile production up -d --no-build
```

Compose recreates the containers from the older images. The database keeps its data; migrations are forward-only, so rolling back past a migration is safe only when that migration was additive (true of everything in Sprint 1a, which creates the `sessions` table and nothing else). Session rows survive a rollback; the browser-side collection is unaffected because it is not on the server yet.

## Headers

Caddy sets on every response, including the ones it proxies from the api:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://s4.anilist.co; connect-src 'self' https://graphql.anilist.co; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- No `Server` header.

`connect-src 'self'` already covers `/api`, which is why the api is proxied under the same origin instead of getting CORS. `style-src` is `'self'` with no `'unsafe-inline'`: React applies the `style` prop through the CSSOM, which CSP does not govern, and the production build links its CSS via `<link>` with no inline `<style>`. The dev server, which does inject `<style>` elements, never runs behind this `Caddyfile`. If SSR or a `?inline` CSS import is ever introduced, this must be revisited (a nonce or hash, not `'unsafe-inline'`). `img-src` and `connect-src` name the only remote hosts the app uses (`web/src/lib/anilist.ts`); adding a new remote host means updating `Caddyfile`, this file and `EXPECTED_CSP` in `.github/workflows/ci.yml` together.

The api adds `Cache-Control: no-store` to every response of its own (nothing from `/api` is cacheable) and its own `X-Content-Type-Options: nosniff`; helmet's remaining defaults are harmless duplicates of Caddy's. Caching of the static site: `/assets/*` is content-hashed by Vite and served with `Cache-Control: public, max-age=31536000, immutable`; everything else (`index.html` included) is `no-cache`, so a new deploy is picked up on the next load.

Left to the proxy: TLS, `Strict-Transport-Security`, and anything that needs to know the public hostname.

## Development

```bash
docker compose --profile dev up -d        # Postgres on 127.0.0.1:5432, role anime / password anime, database anime
cp api/.env.example api/.env.local        # set SESSION_SECRET; the rest matches the dev database
npm run dev                               # api on :3000 (node --watch, reloads on change) + Vite on :5173
```

Vite proxies `/api` to `localhost:3000`, so the browser sees one origin in development as well. `api/.env.local` is loaded by `node --env-file-if-exists`; `server.ts` is the only file that reads the environment. The database schema is applied by the api at start-up. After changing `api/src/db/schema.ts`, run `npm run db:generate -w api` and commit the SQL it writes under `api/src/db/migrations/`; never edit a committed migration.

Tests:

```bash
npm run check                 # format, lint, typecheck, every unit suite, build (what the pre-push hook runs; no database needed)
npm run test:routes -w api    # route + adversarial tests against DATABASE_URL (default: the dev/test database above)
npm run test:coverage -w api  # unit + routes with coverage; fails under 85 % statements
npm run test:e2e              # Playwright against the Vite dev server
```

`docker compose --profile test up -d` starts the same loopback database as `dev` for the route tests; stop it with `--profile test down` (add `--volumes` to start fresh).

## CI

`.github/workflows/ci.yml`:

- `quality`: root `format:check`, `lint`, `typecheck`, the web unit tests with coverage, the api unit tests, `build`.
- `api-tests`: a `postgres:16-alpine` service container; `npm run test:coverage -w api` with `DATABASE_URL` pointing at it runs the unit, route and adversarial suites and enforces the 85 % statement threshold from `api/vitest.config.ts`.
- `e2e`: Playwright against the Vite dev server.
- `security`: `npm audit` (high and above) and gitleaks over the full history.
- `docker`: writes throwaway `POSTGRES_PASSWORD` and `SESSION_SECRET` values to `.env.ci` at run time, runs `docker compose --env-file .env.ci --profile acceptance up -d --build --wait --wait-timeout 120` with `TAG=ci`, and asserts with `docker inspect` that all three containers run read-only, non-root, with every capability dropped, `no-new-privileges` and their pid limits, that Caddy is bound to `127.0.0.1` and that the api and db publish nothing. It then checks `/healthz` and the app `<title>` through Caddy, the exact `Content-Security-Policy`, that `/api/session` answers `{"signedIn":false}` with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and neither a `Server` nor a `Via` header, that a POST without `Origin` gets 403, that the api's own `/healthz` reports `db: ok` from inside the network, that a request sent with `X-Forwarded-For: 203.0.113.9` is logged by the api with that `remoteAddress` (the `trusted_proxies` proof), and that the api image has no `node_modules/typescript` (no dev modules at runtime). Compose logs are printed on failure and the stack is always torn down with `--volumes`. The checkout step uses `persist-credentials: false` so the workflow token is never in a build context. `docker` is one of the required checks in the ruleset (`docs/01-github-flow.md`).
