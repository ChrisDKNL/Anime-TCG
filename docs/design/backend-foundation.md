# Backend foundation (Sprint 1a)

Manager-written technical spec (non-UI). Implements ADR 0008 (server-authoritative) on the stack of ADR 0009. Security tier **T3** (network exposure, sessions infrastructure, compose). `security-officer` review and an adversarial test pass are required before the PR opens.

## 1. Goal

Turn the repo into a deployable two-part system: a static `web/` app and an `api/` service with a PostgreSQL database, wired together by `compose.yml` behind Caddy, with the cross-cutting server machinery (config, logging, errors, sessions, rate limits, CSRF, migrations, health) in place and tested, so that 1b (accounts) and 1c (collection and packs) only add domain code. At the end of 1a the API serves `/healthz` and `/api/session` (always "signed out") and nothing else; the web app is unchanged except for moving into `web/`.

## 2. Out of scope

- Any account, collection, pack, currency or game endpoint (1b, 1c, item 2).
- Changing the web UI or its visual system (item 0.4 rides with 1b/1c).
- Third-party sign-in, email, password reset UI (the owner-only reset is a CLI command in 1b).
- Observability beyond structured logs (metrics and tracing are a later item).
- TLS inside compose (the proxy or tunnel on the NAS terminates it; ADR 0007).

## 3. Repository layout

npm workspaces at the root; each workspace has its own `tsconfig`, `eslint` inherits from the root flat config.

```
package.json            workspaces: ["web", "api", "shared"]; root scripts fan out with `npm run <script> --workspaces --if-present`
web/                    the existing Vite app, moved as-is (git mv), paths updated
api/                    Fastify service
  src/
    app.ts              buildApp(): registers plugins and routes; no listen
    server.ts           reads config, buildApp(), listen; the only file with side effects
    config.ts           typed config from env (TypeBox schema, fail fast on missing/invalid)
    plugins/            db, session, security (helmet, cors, csrf, rate-limit), error-handler, logging
    routes/             one folder per domain, each exports a Fastify plugin; 1a: health.ts, session.ts
    domain/             pure functions and services; no Fastify imports; 1a: session service
    db/
      schema.ts         Drizzle schema (1a: sessions table only; accounts come in 1b)
      migrations/       drizzle-kit generated SQL, committed
      client.ts         pg Pool + drizzle instance
  test/                 route tests via app.inject() against a real Postgres (compose "test" profile or a Testcontainers-free local DB)
  Dockerfile
shared/                 TypeScript only, no runtime deps: API contract types (TypeBox schemas exported as both schema and type), rarity constants moved from web/src/lib/rarity.ts constants
Caddyfile               serves web/dist, proxies /api/* to api:3000, sets headers (from item 0.2, extended)
compose.yml             services: caddy, api, db; profiles: acceptance, production, test
```

## 4. Services and compose

| Service | Image                                  | Exposed                      | Notes                                                                                                     |
| ------- | -------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| caddy   | from `Dockerfile` (web build + Caddy)  | `127.0.0.1:${PORT}` only     | Static files + reverse proxy `/api/*` → `api:3000`; strips `Server`; sets CSP and security headers        |
| api     | from `api/Dockerfile` (node:22-alpine) | none (internal network only) | Non-root, read-only FS, `cap_drop ALL`, `no-new-privileges`; healthcheck `GET /healthz`                   |
| db      | `postgres:16-alpine`                   | none                         | Named volume; `POSTGRES_PASSWORD` from env file; healthcheck `pg_isready`; api waits on `service_healthy` |

Env: one `.env.<profile>` file outside git (`*.local` and `.env*` gitignored; a committed `.env.example` lists every variable with a safe placeholder). Variables: `DATABASE_URL`, `SESSION_SECRET` (≥ 32 bytes, used to HMAC session ids at rest), `API_ORIGIN`, `WEB_ORIGIN`, `NODE_ENV`, `LOG_LEVEL`, `RATE_LIMIT_*`. The api refuses to start if `SESSION_SECRET` is shorter than 32 bytes or equals the example value.

## 5. Cross-cutting behaviour (what 1a must get right)

**Config**: TypeBox schema, parsed once in `config.ts`, exported as a frozen object. Unknown env vars are ignored; missing required ones fail startup with the variable name, never its value.

**Logging**: pino via Fastify, JSON, `LOG_LEVEL` from config, request id on every line, redaction list covering `req.headers.cookie`, `req.headers.authorization`, any field named `password`, `secret`, `token`.

**Errors**: one error envelope for every non-2xx response: `{ "error": { "code": "snake_case_code", "message": "human sentence" } }`. Validation failures return 400 with code `validation_failed` and the first failing path in `message`; unknown routes 404 `not_found`; unexpected errors 500 `internal` with the message "Something went wrong" and the real error logged with the request id. Stack traces never reach the client.

**Validation**: every route declares `schema.body` / `schema.querystring` / `schema.params` / `schema.response` with TypeBox; Fastify's Ajv is configured with `removeAdditional: false`, `additionalProperties: false` on every object schema, `coerceTypes: false`. The `response` schema serialises only declared fields, so a leaked column never reaches the client.

**Sessions**: table `sessions(id, account_id nullable in 1a, created_at, expires_at, last_seen_at, user_agent_hash)`. The cookie holds a 32-byte random id (base64url) and is `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30d`. The stored id is `HMAC-SHA256(SESSION_SECRET, cookie value)` so a database read does not yield usable cookies. Sliding expiry: `last_seen_at` updated at most once per 5 minutes. Expired rows purged by a scheduled query in the api process every hour. `GET /api/session` returns `{ "signedIn": false }` in 1a (and `{ "signedIn": true, "account": {...} }` from 1b).

**CSRF**: for every non-GET route, reject unless `Origin` (or `Referer` when `Origin` is absent) matches `WEB_ORIGIN`; plus the same-site cookie. No CSRF tokens needed with this combination. Rejection is 403 `bad_origin`.

**Rate limiting**: `@fastify/rate-limit` with an in-memory store (one api instance), defaults 100 req/min per IP for all routes, and per-route overrides reserved for auth in 1b (10/min). `X-RateLimit-*` headers on; 429 uses the error envelope with code `rate_limited`.

**Security headers**: set at Caddy for the site; the api additionally sets `Cache-Control: no-store` on every response and `X-Content-Type-Options: nosniff`. CORS is not enabled: the API is same-origin behind Caddy (`/api/*`). In development, Vite proxies `/api` to `localhost:3000` so the browser still sees one origin.

**Health**: `GET /healthz` (unauthenticated, not under `/api`) returns 200 `{ "status": "ok", "db": "ok" }` after a `SELECT 1`, 503 with `"db": "down"` otherwise. Not rate-limited. Never includes versions or hostnames.

**Migrations**: `drizzle-kit generate` output committed under `api/src/db/migrations/`; applied at api startup by `drizzle-orm/migrator` before `listen` (single instance, fail fast). A migration never edits an existing migration file.

**Shutdown**: SIGTERM → stop accepting, drain in-flight up to 10 s, close the pool, exit 0.

## 6. Development workflow

- `npm run dev` at root starts `api` (tsx watch) and `web` (Vite with `/api` proxy) together; `db` comes from `docker compose --profile dev up db`. Documented in `docs/04-deployment.md`.
- `npm run check` at root runs format, lint, typecheck, unit tests and build for every workspace; the Husky pre-push hook keeps calling it.
- CI: the `quality` job runs the root `check`; a new `api-tests` job starts a `postgres:16` service container and runs `api` route tests; the `docker` job (item 0.2) builds both images and smoke-tests `caddy` → `api` → `db` with compose.

## 7. Tests required (minimum, per `docs/05-security.md` T3)

Unit (`api/src/**/*.test.ts`): config parsing (missing, invalid, weak secret), error envelope mapping, session id hashing, CSRF origin check, sliding-expiry logic.

Route (`api/test/*.test.ts` via `app.inject()` with a real database):

- `/healthz` 200 with db up; 503 with the pool pointed at a dead port.
- `/api/session` 200 `signedIn: false` with no cookie; with a garbage cookie; with a well-formed but unknown cookie; with an expired session row.
- Unknown route → 404 envelope; body with an extra field on any POST → 400 `validation_failed`.
- CSRF: POST with no Origin → 403; with a foreign Origin → 403; with `WEB_ORIGIN` → passes to the handler.
- Rate limit: 101st request in a minute → 429 envelope with `Retry-After`.

Adversarial (`api/test/security/*.security.test.ts`): cookie tampering (flipped bit, wrong length, non-base64url); session fixation (a session id supplied by the client is never accepted as new); header injection via `Origin`; a 2 MB body → 413; slowloris-style open connection → closed by `connectionTimeout`; response schema strips an undeclared field (prove with a handler that returns an extra key).

e2e (`web/e2e`): unchanged pack-opening tests pass against the Vite dev server with the `/api` proxy pointed at a stub; and one new test that `GET /api/session` through Caddy in the compose `test` profile returns `signedIn: false` with the expected security headers.

## 8. Acceptance criteria

1. `docker compose --profile acceptance up -d --build` on a clean machine brings up caddy, api and db; `/healthz` is `ok`; the existing game is playable at the bound loopback port.
2. The api container runs as non-root with a read-only filesystem and no published ports; `docker port` on it is empty.
3. All tests in §7 exist and pass in CI; coverage of `api/src` ≥ 85 % statements.
4. No secret, hostname or stack trace appears in any response, log line at `info`, or committed file (gitleaks and a grep in the QC report).
5. `docs/04-deployment.md` and `docs/05-security.md` updated: controls C2, C5, C6, C7 move to "live (infrastructure)" with the file that implements each.

## 9. Open questions

None blocking. Deferred: whether to run two api replicas later (would require a shared rate-limit store, Redis); not needed for one NAS.
