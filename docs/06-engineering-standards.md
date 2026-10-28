# Engineering Standards

Standing rules from the owner (2026-10-28), binding on every agent and every PR. `quality-controller` checks code against the first two sections; `ui-designer` and `quality-controller` check the UI section; `security-officer` enforces the last.

## 1. Modern code, no exceptions

- TypeScript strict everywhere, including `api/` and `shared/`; `noUncheckedIndexedAccess` on; no `any`, no `@ts-ignore`, no non-null assertions outside tests.
- Current major versions of the stack (React 19, Vite 8, Node 26 LTS, Fastify 5, Postgres 16). Dependabot keeps them current; a pinned-back version needs a reason in the lockfile PR.
- ES modules only; `async`/`await` over promise chains; `fetch` over axios; native `crypto`, `URL`, `structuredClone`, `Intl` over polyfills and utility packages.
- React: function components and hooks only; server-derived state via a query layer (TanStack Query when the API lands), not hand-rolled effect fetching; forms with native validation attributes plus one validation schema shared with the API; no class components, no HOCs, no prop drilling past two levels (use context or composition).
- API: one schema per route is the contract; handlers are thin and call a domain function that is unit-testable without HTTP; migrations are SQL files; no business logic in the database.
- Tests are part of the change, not a follow-up. A PR without tests for its behaviour is incomplete.
- Small, named, single-purpose functions; comments explain _why_, never _what_; no dead code, no commented-out code, no TODO without an issue number.

## 2. What "AI vibe-coded" looks like, so we never ship it

Patterns that mark code as generated rather than engineered. Reviewers reject them on sight.

**Code**

- Defensive `try/catch` that swallows errors, or `catch (e) { console.error(e) }` as error handling.
- Functions that accept everything and validate nothing; `Record<string, unknown>` where a type exists.
- Comments that restate the line below them; banner comments; emoji in comments or logs.
- A `utils.ts` graveyard; helpers duplicated per file; `index.ts` barrels re-exporting everything.
- Re-implementing a standard library function; wrapping a library in a wrapper that adds nothing.
- Magic numbers inline; configuration spread across files instead of one typed config module.
- `setTimeout` to "wait for state"; `useEffect` with a state write as its only job.
- Tests that assert the mock was called and nothing else.

**UI**

- Gradient text headings, gradient buttons, purple-to-pink anything, glassmorphism cards, glowing borders as decoration, floating blobs.
- Emoji as icons; emoji in buttons, headings or empty states. Use a real icon set (Lucide) or none.
- "✨ Powered by …" footers, sparkle motifs, confetti on ordinary actions.
- Three-column "feature card" grids with icon-title-blurb; hero sections with centred copy and two CTAs.
- Rounded-2xl everything, drop shadows on everything, hover-lift on everything.
- Placeholder copy that explains the feature to the user ("Open packs, collect characters!").
- Toasts for every action; loading spinners instead of skeletons or optimistic updates.

**Known debt in this repo (as of 2026-10-28)**: the current header title is gradient text, the pack button is a three-colour gradient with an emoji, the rarity frames glow, the footer is explanatory copy. Scheduled for removal in the Sprint 1 web rework when the UI becomes a thin client (roadmap item 1b/1c); `ui-designer` defines the replacement visual system first.

## 3. Modern UI, what we build instead

- A restrained, typographic dark interface: one neutral scale, one accent used sparingly for primary actions and focus, semantic colours for rarity that read as a _system_ (consistent hue steps, not glows).
- Density and hierarchy from type scale, spacing and alignment, not from boxes and shadows.
- Motion that explains (a card entering, a value changing), 150–250 ms, respects `prefers-reduced-motion`; nothing that loops.
- Real empty, loading (skeleton), error and offline states, designed, not improvised.
- Keyboard-first: every action reachable by Tab/Enter/Escape; visible focus; roles and names on everything.
- Responsive by content, not by device: the layout is defined by the card's minimum size and reflows.
- Copy is short, specific and in the user's voice ("3 packs ready" not "You have 3 packs available to open!").

## 4. Zero trust on users; prefer the server

- The user's browser is hostile. Nothing it sends is believed until the server validates it, and nothing it holds is authoritative.
- **If a thing can be done server-side, it is done server-side.** Rarity rolls, pack grants, timers, balances, odds, invite checks, rate limits, feature flags, and any decision with a consequence. The client renders and requests.
- The client may hold: the session cookie (set by the server, unreadable by scripts), UI preferences, and a cache of what the server last said, clearly treated as a cache.
- Every endpoint authenticates, authorises against the caller's own data, validates the schema, rejects unknown fields, and is rate-limited where abuse has value.
- Secrets never reach the client bundle; the build fails if an env var without the public prefix is referenced in `web/`.
- Security tier and tests per change are in `docs/05-security.md`. When in doubt, the higher tier.
