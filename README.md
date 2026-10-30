# Anime TCG

A solo, non-commercial anime card-collection game. Open packs of five characters
drawn from the most popular anime on [AniList](https://docs.anilist.co/), each
dealt a rarity tier by the server, and build a collection kept on the server.

Stack: Vite 8 · React 19 · TypeScript · Tailwind CSS 4 in `web/`, served from a hardened Caddy container; Fastify 5 · PostgreSQL 16 · Drizzle in `api/`; the API contract and game constants both sides share in `shared/` (`docs/04-deployment.md`, [ADR 0009](docs/adr/0009-backend-stack.md)).

## Status (2026-10-28)

What is on `main` today is the **proof of concept**: packs, rarity rolls and a collection kept in the browser's `localStorage`. There is no backend, no accounts and no API key yet, and nothing in the browser is protected from manipulation. That is a known, temporary state.

The decided direction is **server-authoritative** ([ADR 0008](docs/adr/0008-server-authoritative.md)): accounts, sessions, collection, pack grants, currency and every game outcome move to an API on the owner's NAS ([ADR 0007](docs/adr/0007-backend-on-nas.md)) built on Fastify, PostgreSQL and Drizzle ([ADR 0009](docs/adr/0009-backend-stack.md)); the web app becomes a thin UI. Sprint 1a (`docs/design/backend-foundation.md`) lays that foundation: the repo is an npm workspace (`web/`, `api/`, `shared/`), the api serves `/healthz` and `/api/session` (always signed out until accounts arrive in 1b) with sessions, rate limiting, CSRF and the error envelope in place, and `compose.yml` runs caddy, api and db together. The roadmap and current status live in [`docs/02-roadmap.md`](docs/02-roadmap.md). The "How it works" section below describes the proof of concept and will be replaced when the game moves server-side (1b/1c).

Policies that apply to every change: [`docs/05-security.md`](docs/05-security.md) (controls, security tiers, change log) and [`docs/06-engineering-standards.md`](docs/06-engineering-standards.md) (modern code and UI, zero trust on the client). Team, gates and GitHub flow: [`docs/00-team-and-workflow.md`](docs/00-team-and-workflow.md), [`docs/01-github-flow.md`](docs/01-github-flow.md), releases: [`docs/03-release-process.md`](docs/03-release-process.md).

## Run it

```bash
npm install                            # installs every workspace (shared, api, web)
docker compose --profile dev up -d     # Postgres on 127.0.0.1:5432 for the api
cp api/.env.example api/.env.local     # set SESSION_SECRET (openssl rand -base64 48)
npm run dev                            # api on http://localhost:3000, web on http://localhost:5173 (proxies /api)
```

The web app needs the api: every page after sign-in reads it through the `/api` proxy.

```bash
npm run check                 # format, lint, typecheck, unit tests, build for every workspace (the pre-push gate)
npm run test:routes -w api    # api route and adversarial tests against the dev database
npm run test:e2e              # Playwright against the Vite dev server
npm run build                 # shared/dist, api/dist, web/dist
```

Running the containers (acceptance, production, variables, rollback): [`docs/04-deployment.md`](docs/04-deployment.md).

## File structure

```
package.json                   Workspace root: tooling only; scripts fan out to shared, api, web
tsconfig.base.json             Strictness flags shared by shared/ and api/
eslint.config.js               One flat config: type-aware base for every workspace, React rules for web/
compose.yml                    caddy + api + db per profile; Postgres alone for dev/test
Dockerfile, Caddyfile          The web image: Vite build served by Caddy, /api proxied to the api
shared/                        @anime-tcg/shared: TypeScript only
  src/api.ts                   SessionResponse, HealthResponse (TypeBox schema + Static type)
  src/errors.ts                ERROR_CODES, ErrorEnvelope
  src/rarity.ts                RARITIES, RARITY_LABEL and the server's integer odds tables
api/                           @anime-tcg/api: Fastify 5 on Node 26
  src/server.ts                The only file that reads process.env and listens
  src/start.ts                 migrate, build, listen, drain on shutdown
  src/app.ts                   buildApp(): plugins and routes, no listen (tests inject())
  src/config.ts                parseConfig(env): TypeBox-validated, refuses weak SESSION_SECRET
  src/plugins/                 db, security (helmet, rate limit, CSRF, no-store), session, errors, logging
  src/domain/                  Pure logic: csrf, errors (ApiError + envelope), session/{ids,policy,service}
  src/db/                      Drizzle schema, pg client, migrator, committed SQL migrations
  src/routes/                  health (/healthz), session (/api/session)
  test/                        Route and security tests against a real Postgres
  Dockerfile                   node:26-alpine multi-stage, non-root, read-only friendly
web/                           @anime-tcg/web: the Vite app, a client of the api
  index.html                   Vite entry, <html class="dark">
  vite.config.ts               React + Tailwind v4 plugins, /api dev proxy, shared source alias
  src/
    main.tsx, App.tsx          React root; the session check, then the router
    router.tsx                 TanStack Router route tree and guards (ADR 0012)
    index.css                  Tailwind import, the card and rarity tokens, the reveal entrance
    lib/                       Pure logic: api client, game state reducer, copy modules, routes
    hooks/                     State: the session, the game (packs, opening, collection), countdowns
    components/                card/ (the six-tier card), packs/ (control, reveal, odds), collection/,
                               account/, layout/
    pages/                     One component per route
  e2e/                         Playwright
```

## How it works

The server decides every outcome; the browser renders what it says ([ADR 0008](docs/adr/0008-server-authoritative.md)).

- **Characters** come from an owner-run snapshot of AniList (`snapshot-pool`, `docs/04-deployment.md`), never from the browser: the web app makes no request to AniList's API and its CSP allows `connect-src 'self'` only. Card art is loaded from AniList's image CDN.
- **Packs** (`docs/design/collection-packs.md`, `docs/design/packs-page.md`): `GET /api/packs` gives the allowance, the published odds and the pity counter; `POST /api/packs/open` with a `requestId` deals five cards on the server. A lost answer is retried with the same `requestId`, so it shows the pack the server dealt instead of opening a second one. The countdown to the next pack runs on the monotonic clock and asks the server once when it ends; nothing polls.
- **The card** (`docs/design/card-and-rarity.md`): six tiers, each with its frame, stars and colours; Epic and up glow, and their glint and drift stop under `prefers-reduced-motion`.
- **The collection** is `GET /api/collection`; the browser stores no cards, pool or odds.

### UI notes

- Dark mode only (`color-scheme: dark`, zinc palette).
- Tailwind v4 only emits classes it can see at build time, so per-tier classes are `Record<Rarity, string>` lookups of complete class strings, never templated.

## Attribution

Character images and titles belong to their respective rights holders and are
served by the AniList API under its [terms](https://anilist.co/terms). This
project is non-commercial and for personal use.
