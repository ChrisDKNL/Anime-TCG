# 0001 — Frontend stack: Vite + React 19 + TypeScript + Tailwind 4

2026-10-28 · accepted

## Context

A solo, non-commercial card game with no backend. Needs fast iteration, a dark UI, and a build that runs anywhere Node runs.

## Decision

Vite 8, React 19, TypeScript strict (`noUncheckedIndexedAccess` on), Tailwind CSS 4 via the Vite plugin. No router yet (single page with tabs). State in hooks, pure logic in `src/lib/`, persistence in `localStorage` behind hooks.

Testing: Vitest + Testing Library (unit), Playwright (e2e, AniList mocked). Lint/format: ESLint 10 flat config with type-aware rules, Prettier with the Tailwind plugin.

## Consequences

- No SSR, no server. Accounts/sync will require a separate decision (see roadmap).
- Vite 8 and React 19 are current majors; Dependabot keeps them moving.
- Playwright is pinned to 1.63.0 to match the browsers available in the manager's cloud environment; CI installs its own.
