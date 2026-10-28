# 0009 — Backend stack

2026-10-28 · accepted (proposed by the manager, confirmed by the owner the same day)

## Context

ADR 0008 requires a server that owns all game state, running in Docker on a NAS (ADR 0007), maintained by a one-person team plus Claude agents. The frontend is TypeScript/React.

## Decision

| Concern        | Choice                                                                                                                                    | Why                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Language       | TypeScript on Node 22                                                                                                                     | One language and one lint/test toolchain for the whole repo; request/response types shared with `web/` instead of hand-kept in two places |
| HTTP framework | Fastify 5                                                                                                                                 | Schema-validated routes out of the box (JSON Schema / TypeBox), built-in rate-limit, CORS, cookie and helmet plugins, fast, mainstream    |
| Validation     | TypeBox schemas, one per route                                                                                                            | Validates and types at once; unknown fields rejected by default                                                                           |
| Database       | PostgreSQL 16 in compose                                                                                                                  | Transactions for pack opening and ledger writes; `pg_dump` for NAS backups; the owner's other project already runs Postgres               |
| Data access    | Drizzle ORM + drizzle-kit migrations                                                                                                      | Typed SQL without a query DSL to learn; migrations are plain SQL files reviewable in PRs                                                  |
| Auth           | Argon2id (`argon2` package), server sessions in Postgres, cookie id                                                                       | ADR 0008 §3–4; no JWT (revocation and rotation are trivial with server sessions)                                                          |
| Layout         | npm workspaces: `web/`, `api/`, `shared/`                                                                                                 | `shared/` holds the API contract types and the rarity/economy constants the UI displays                                                   |
| Web server     | Caddy in compose                                                                                                                          | Serves `web/dist`, reverse-proxies `/api`, sets CSP and security headers, automatic TLS if not behind a tunnel                            |
| Tests          | Vitest for unit; Fastify `inject` for route tests against a test database; Playwright e2e against the full compose stack with a seeded DB |                                                                                                                                           |

Rejected: SQLite (simpler, but no concurrent writers and no first-class dump/restore story on a NAS), NestJS (too much framework for one person), Express (no schema validation built in), a BaaS (the owner wants the server local), Python (would split the toolchain).

## Consequences

- `package.json` becomes a workspace root; CI runs lint/typecheck/test per workspace; the Husky pre-push gate runs all of them.
- The Dockerfiles live in the repo: multi-stage builds for `api` and `web`; `compose.yml` with `caddy`, `api`, `db`, and profiles for acceptance and production.
- New agent knowledge is needed: `senior-engineer` and `tester` instructions gain an API section; `security-officer` gains the ADR 0008 §5 checklist. A `fastify-api-conventions` skill is written before the first API PR.
- First measurable cost: Sprint 1 grows from "a few days" to "one to two weeks" before the game is playable again end to end. The owner accepted this trade in exchange for state that cannot be manipulated from the browser.
