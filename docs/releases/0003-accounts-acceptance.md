# Accounts acceptance — Sprint 1b (accounts API and UI)

Candidate: commit `f032f33` on `main` (PR #23 accounts API, PR #25 accounts UI, docs #26; `main` CI green on that commit). An **acceptance run**, not a production release: Sprint 1 is complete only after 1c (server-side collection and packs), so there is no release tag yet. Security tiers of what ran: T3 (#23) and T2 (#25), see `docs/05-security.md`.

Run by the manager session on the dev station on 2026-10-29, from the detached checkout `C:\ProgramData\AnimeTCG\src` with its existing `.env.acceptance.local` (secrets never printed). Acceptance is local only, on `127.0.0.1:8180` (8080 is taken on this host).

## What was done

1. `git checkout --detach origin/main` (f032f33) in the acceptance checkout.
2. `.env.acceptance.local`: `TAG=acceptance-f032f33`; added `INVITE_CODES` (one 8-character code chosen by the owner's request, kept outside the repository), `APP_DB_PASSWORD` (16 random letters and digits) and `ACCOUNT_CAP=10`.
3. The acceptance database volume predates the `anime_app` role, so the one-time step from `docs/04-deployment.md` was run: `CREATE ROLE anime_app LOGIN PASSWORD …` through `psql` on stdin, the password read from the env file.
4. `docker compose --env-file .env.acceptance.local --profile acceptance up -d --build --wait`: `anime-tcg-db-acceptance`, `anime-tcg-api-acceptance` (`anime-tcg-api:acceptance-f032f33`) and `anime-tcg-acceptance` (`anime-tcg-web:acceptance-f032f33`) all healthy.

## Smoke checks

| Check                                                      | Result                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /healthz` through Caddy                               | `ok`                                                                        |
| `GET /api/session`                                         | `{"signedIn":false}`                                                        |
| Page title                                                 | `Anime TCG — Booster Packs`                                                 |
| `POST /api/accounts/check-invite` with the configured code | 204                                                                         |
| The same with a wrong code                                 | 403                                                                         |
| `POST /api/session/login` without `Origin`                 | 403                                                                         |
| Database role of the api's connections                     | `anime_app` only                                                            |
| Migrations applied                                         | 3 (`0000`–`0002`)                                                           |
| Networks                                                   | `src_acceptance-front` 172.16.10.0/24, `src_acceptance-back` 172.16.11.0/24 |
| Home LAN still reachable from other containers             | yes                                                                         |

## Owner verdict

"acceptance ok f032f33" (owner, 2026-10-29). Comment from the same message, now a requirement: every screen gets its own address (`/collection`, `/shop`, `/profile`, `/register`, …), with a landing page at `/`; specced in `docs/design/navigation-and-landing.md` on `feat/navigation`.

## Known limits of this build

- The collection lives in the browser's memory until 1c: a reload empties it.
- `tcg.private-0118.nl` is not serving this build; it is reserved for the first production release (`docs/04-deployment.md`).
