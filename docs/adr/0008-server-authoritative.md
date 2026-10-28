# 0008 — Server-authoritative game state; the web app is a thin UI

2026-10-28 · accepted · supersedes ADR 0003 Phase 1 (local profiles) and ADR 0006 (browser-side password hashing); amends ADR 0004 (where the economy maths lives)

## Context

The owner's direction, same day: "The site should just function as a UI. The collection, packs, currency all need to stay server-side and be protected against webpage manipulation or script injection from users." The server runs in Docker on the owner's NAS (ADR 0007).

## Decision

1. **The server is the only source of truth** for accounts, sessions, invite codes, the character pool, collections, pack grants and openings, currency balances, and every game outcome. The browser holds nothing authoritative: no inventory in `localStorage`, no client-side rarity roll, no client-side balance. The existing `useInventory` / `openPack` / `rarity.ts` client code is retired or demoted to display helpers once the API exists.
2. **Every state change is a server endpoint that validates its input and decides the outcome itself.** The client asks "open a pack"; the server checks the grant, rolls the cards, writes them, and returns them. The client never sends "here are the 5 cards I got".
3. **Accounts** are server-side from the start: invite code → register (login + password) → session. Passwords are hashed server-side with Argon2id (OWASP, https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html, verified 2026-10-28). Third-party sign-in (Google/Discord) is added later as an additional provider, not a replacement of the account model.
4. **Sessions** are server-side, referenced by an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. No tokens in `localStorage`. Logout invalidates the session server-side.
5. **Anti-manipulation and anti-injection baseline**, enforced in the API and the web server, reviewed by `security-officer` on every PR:
   - input validation with a schema on every endpoint; unknown fields rejected
   - authorisation on every endpoint (a user can only read and change their own data)
   - rate limiting on auth and on pack/game endpoints
   - CSRF protection for cookie sessions (origin check plus same-site cookie)
   - a Content-Security-Policy with no inline scripts, images only from `self` and `*.anilist.co`, `connect-src` only the API origin
   - all AniList-sourced strings rendered as text (React default); no `dangerouslySetInnerHTML` anywhere, lint-enforced
   - integer arithmetic for currency; every balance change is a ledger row, never an in-place update without a reason
   - server-side RNG (`crypto.randomInt`), never `Math.random`, for anything with stakes
6. **ADR 0004 amendment**: "money-like maths lives in `src/lib/economy/`" becomes "lives in the API's domain layer", unit-tested there; the web app only displays.
7. **No migration of the pre-accounts `localStorage` collection.** It was a proof of concept and the server cannot trust client-held data. The first server-side account starts empty.

## Consequences

- Sprint 1 is replanned (roadmap): backend foundation and server-side accounts first, then server-side collection and packs, then currency. The Account UI flow already specified in `docs/design/accounts.md` stays; its storage sections are superseded.
- The repo becomes two deployable parts: `web/` (static, served by the web server) and `api/`. The stack is ADR 0009.
- The `quality-controller` gate grows an API test run; `tester` gains API integration tests; `security-officer` review becomes mandatory on every API PR.
- The game is now only playable with the server up. Acceptance and production stacks (`docs/03-release-process.md`) must include the API and database.
