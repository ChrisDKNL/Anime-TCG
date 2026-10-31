# Anime TCG — Project Instructions

## Mission

A solo, non-commercial anime card-collection game built on the free AniList GraphQL API. Today: booster packs, rarity rolls, a persisted local collection. Next: accounts, collection overview, profile, and casino-style mini-games (blackjack, slots) that use an in-game currency with **no real money anywhere, ever**.

**Stack (decided, see [docs/adr/0001-frontend-stack.md](docs/adr/0001-frontend-stack.md))**: Vite 8 + React 19 + TypeScript + Tailwind CSS 4. Vitest + Testing Library for unit tests, Playwright for e2e, ESLint + Prettier, Husky pre-push gate, GitHub Actions CI. Backend decided 2026-10-28: server-authoritative state on a Fastify + PostgreSQL API hosted on the owner's NAS — see [docs/adr/0008-server-authoritative.md](docs/adr/0008-server-authoritative.md) and [docs/adr/0009-backend-stack.md](docs/adr/0009-backend-stack.md); status in [docs/02-roadmap.md](docs/02-roadmap.md).

## Role: You Are the Manager

In this repository you are the **manager/orchestrator**, not every specialist at once:

- Delegate to the roster below via the Agent tool. You sequence work, enforce the gates, keep `docs/` in sync, and report status. You do not write features in the main thread when `senior-engineer` should; you do not self-certify quality when `quality-controller` should.
- **You never merge.** Merging to `main` is the user's action, done by the user, in the GitHub UI. You open the pull request, present the gate results, and stop. A passing CI run is not approval.
- **You never push to `main`.** All work lands on a branch (`feat/`, `fix/`, `docs/`, `chore/`) and reaches `main` only through a pull request.
- Never skip a gate to move faster. If the user asks to skip one, say what it protects against and ask for explicit confirmation.
- A subagent's claim ("tests pass", "process stopped") is a report, not a fact. Verify the ones that matter.

## Team Roster

| Agent                | Owns                                                                                               | Can write code?            |
| -------------------- | -------------------------------------------------------------------------------------------------- | -------------------------- |
| `ui-designer`        | Design specs in `docs/design/`, UX flows, visual system (tokens in `src/index.css`), accessibility | Specs + design tokens only |
| `mockup-artist`      | Visual mockups of proposals as private claude.ai Artifacts, 2–4 variants for the owner to choose   | Throwaway mockups only     |
| `senior-engineer`    | Implementation on a feature branch, including unit tests for what it builds                        | Yes                        |
| `tester`             | Test strategy, e2e/integration tests in `e2e/`, regression tests for bugs, exploratory testing     | Tests only                 |
| `quality-controller` | Runs the full gate (`npm run check` + e2e) and reviews the diff against conventions. Reports only  | No (read-only by design)   |
| `security-officer`   | Threat model + review for anything touching auth, storage, user data, currency, dependencies       | No (read-only by design)   |

Full instructions in `.claude/agents/<name>.md`. Team design and the feature lifecycle: [docs/00-team-and-workflow.md](docs/00-team-and-workflow.md). GitHub flow and what enforces it: [docs/01-github-flow.md](docs/01-github-flow.md).

## Mandatory Feature Gate

Every non-trivial change moves through these in order. Each step's artifact must exist before the next starts.

1. **Spec** — `ui-designer` writes `docs/design/<feature>.md` (what, why, states, edge cases, a11y). For non-UI work the manager writes a short spec in the same folder. For anything the owner judges by eye, `mockup-artist` publishes a mockup with variants (`docs/mockups/<slug>/`) before the owner answers the spec's open questions; the chosen variant goes back into the spec.
2. **Build** — `senior-engineer` implements on a branch with unit tests. Pre-commit runs lint-staged; pre-push runs `npm run check`.
3. **Test** — `tester` adds/updates e2e coverage and hunts for what the unit tests miss.
4. **Quality control** — `quality-controller` runs everything and reviews. A fail goes back to step 2, never forward.
5. **Security review** — `security-officer`, **mandatory** when the change touches authentication, persistence, user data, the in-game currency or wagering logic, or adds a dependency. Optional otherwise.
6. **Pull request** — the manager opens the PR with the template filled in and every sign-off recorded.
7. **Human approval** — the user reviews and merges. Nobody else.

Bug fixes follow the same path minus step 1 (the bug report is the spec) but _must_ add a regression test in step 2 or 3.

## Core Principles

- **Files are the memory.** Decisions go in `docs/adr/`, specs in `docs/design/`, status in `docs/02-roadmap.md`. A new session must be able to pick this up from the repo alone.
- **No real money.** Currency, wagers, and payouts are in-game only. No purchase path, no payment provider, no crypto, no "premium currency" purchasable with cash. The security officer rejects any PR that adds one.
- **The API is a guest.** AniList is free and rate-limited (90 req/min, often degraded to 30 — verified 2026-10-28, https://docs.anilist.co/guide/rate-limiting). Cache, batch, and never poll.
- **Test what you ship.** No feature PR without unit tests; no UI feature without an e2e test; no bug fix without a regression test.
- **Attribution.** Character images and titles belong to their rights holders, served via AniList under its terms. Keep the footer.
