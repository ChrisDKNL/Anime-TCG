# 0012 — Client-side router

2026-10-29 · accepted (decided by the manager on the owner's request for one address per screen; the owner chose the routes and behaviour in `docs/design/navigation-and-landing.md`)

Number 0011 is taken by the economy decisions on `feat/economy`, which merge later.

## Context

Until now the web app switched screens with in-page tabs and had no addresses. The owner asked that every screen have its own address (`/collection`, `/shop`, `/register`, …), with a landing page at `/` (accepted 2026-10-29, release note 0003). `docs/design/navigation-and-landing.md` §3.9 lists what the router must do: nested layouts (signed-out and signed-in), a guard that waits for the session check and sends signed-out visitors to `/login` with a return path held in history state, a title and an `h1` focus per route but not on first render, scroll restoration, a catch-all not-found route, real links with an active state, no state in the query string, optional code splitting, and React 19 with strict TypeScript. Server state already goes through TanStack Query (`@tanstack/react-query`, #25).

## Decision

Use **TanStack Router** (`@tanstack/react-router`) with a **code-based route tree**: routes are declared in one typed module, no file-based route generation and no Vite plugin. The session guard reads the TanStack Query cache in `beforeLoad`, so the router and the existing data layer share one source of truth.

| Option                                   | Why not chosen                                                                                                                                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React Router 7 (library mode)            | Mature and widely used, and it would work. Its paths and links are plain strings, so a renamed route fails at runtime instead of in `tsc`; TanStack Router types every `to` and `params` against the route tree.                          |
| A hand-written router on the History API | No dependency, but it re-implements guards, scroll restoration, pending states and link active-state that a maintained library already does; `docs/06-engineering-standards.md` §2 names re-implementing a library as a pattern to avoid. |
| TanStack Router with file-based routes   | Adds a code generator and a Vite plugin to the build for a dozen routes; one hand-written route module is easier to review.                                                                                                               |

Supply chain: the same publisher, repository and release process as `@tanstack/react-query`, which the security officer reviewed in #25 (trusted publishing with SLSA provenance, no install scripts). The routing PR is still a T2 dependency change and gets its own provenance check for the exact version.

## Consequences

- The routing PR adds one runtime dependency and a security-officer T2 review.
- Every route is declared once, in the route module; links and redirects are type-checked against it. Caddy keeps serving `index.html` for every non-API, non-asset path (owner decision: unknown paths answer 200 and the app shows its not-found page), so new pages never need a Caddyfile change.
- The return path after sign-in is validated against the route list (navigation spec §3.3), which is the open-redirect control the security officer records.
- If TanStack Router is abandoned or a major version breaks the API, the route module is the one place to port.
