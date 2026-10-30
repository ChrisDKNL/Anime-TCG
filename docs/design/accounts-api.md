# Accounts API (Sprint 1b, server side)

Manager-written technical spec (non-UI). The UI half is `docs/design/accounts.md`; this file defines the API it calls, the data model, the owner-side commands and the two prerequisites carried from the 1a security review (`accounts.md` §10). Implements ADR 0008 §3–5 on the 1a foundation (`backend-foundation.md`). Security tier **T3** (authentication, sessions, password handling, invite codes). `security-officer` review and an adversarial test pass are required before each PR opens; the owner is informed through the PR's sign-offs (since 2026-10-30 a T3 PR may merge the day it opens).

Written 2026-10-28.

## 1. Goal

A player with an invite code registers a login and a password, signs in, and gets a server session; signed in, they can rename the login, change the password and delete the account. The API decides every outcome, the web app only renders what comes back. At the end of 1b the game is still the browser-side proof of concept; the account exists so that 1c can hang the server-side collection on it.

## 2. Out of scope

- Collection, packs, currency (1c, item 2). The `cards` count the UI shows in the Manage dialog is `0` until 1c.
- Third-party sign-in, email, self-service password reset (ADR 0008 §3; `accounts.md` §2). Owner-side reset is a CLI command here.
- Multiple sessions management UI ("log out everywhere"): the server does it implicitly on password change (§6.4).
- Compose `secrets:` for `SESSION_SECRET` and `POSTGRES_PASSWORD` (register open item; separate chore).
- Account roles. There is no admin in the API (skill: owner operations are CLI commands).

## 3. Delivery

Two pull requests, in order, each through the full gate:

1. **`feat/accounts-api`** (this spec, everything in §4–§9): schema, prerequisites, endpoints, CLI, tests, docs.
2. **`feat/accounts-ui`**: the web app per `accounts.md`, calling these endpoints through a typed client in `web/src/lib/api.ts` built from the `shared/` schemas.

## 4. Prerequisites from the 1a review (land first, in the same PR)

### 4.1 Least-privilege database role

Migrations run as the database owner `anime`; request handling runs as `anime_app`, which can only read and write rows.

- compose: the `db` services get an init script (`db/init/01-app-role.sh`, mounted read-only into `/docker-entrypoint-initdb.d/`) that creates role `anime_app` with `LOGIN` and the password from `APP_DB_PASSWORD`, and nothing else. It runs only on first initialisation of the volume; `docs/04-deployment.md` documents how to run the same statements by hand on an existing volume (the acceptance volume on the dev station already exists).
- The migration `0001_app_role_grants.sql` grants `SELECT, INSERT, UPDATE, DELETE` on all current tables in `public` to `anime_app` and sets `ALTER DEFAULT PRIVILEGES` so future tables get the same grants automatically. No `CREATE`, `TRUNCATE`, `REFERENCES`, no ownership. `drizzle.__drizzle_migrations` is never granted to the app role.
- The api gets two URLs: `DATABASE_URL` (as `anime_app`) for the pool used by routes, and `MIGRATIONS_DATABASE_URL` (as `anime`) used only by `runMigrations` at start-up, after which that single connection is closed. Config fails fast if either is missing or they name the same role (string check on the user part of the URL).
- `/healthz`'s `SELECT 1` runs on the app pool.
- Test: a route test proves the app pool cannot `CREATE TABLE` (expect a permission error) and can insert into `sessions`. The CI `api-tests` job and the `test` compose profile create both roles.

### 4.2 Session hardening

- **Absolute lifetime**: a session row dies 90 days after `created_at` regardless of activity. `find()` requires `expires_at > now AND created_at > now - 90d`; the purge deletes both kinds. The cookie `Max-Age` stays 30 d (it slides on each touch, so the absolute bound is the server's only).
- **Rotation on sign-in**: `register` and `login` first destroy the session the request arrived with, if any, then create a new one for the account; the old cookie value never becomes authenticated. Tested: a pre-auth cookie fixed in the browser before login is unknown after login.
- **Password change**: every other session of the account is destroyed; the current one is rotated (new id, same account). Response sets the new cookie.
- **Delete**: all sessions go with the account (`ON DELETE CASCADE`), the response clears the cookie.
- `req.session` gains `accountId`, `reply.createSession(accountId)` returns the new cookie value and `reply.destroySession()` clears it (already the plugin's shape in 1a; now exercised).

### 4.3 Schema guard

A unit test in `shared/` walks every exported TypeBox object schema (recursively through properties, arrays, unions) and asserts `additionalProperties === false`. Register and session-response schemas added here are the first ones it has to catch.

## 5. Data model

```
accounts
  id                uuid pk default gen_random_uuid()
  login             text not null                      -- as typed, trimmed; the display name
  login_normalized  text not null unique               -- lower(login), the uniqueness key
  password_hash     text not null                      -- PHC string from Argon2id
  invite_code_hash  text not null                      -- sha256 of the normalised code used; audit only
  created_at        timestamptz not null default now()
  updated_at        timestamptz not null default now()

sessions
  account_id        uuid null references accounts(id) on delete cascade   -- 1a column gains the FK

auth_throttle
  key               text pk                            -- lower(trim(login)); for password checks, the account's login
  failures          integer not null default 0
  blocked_until     timestamptz null
  updated_at        timestamptz not null default now()
```

Rules: `login` 3–24 characters after trim, any characters; uniqueness is on `login_normalized`. Password 8–128 characters, never trimmed, compared as bytes. The account cap is a count of `accounts` rows checked inside the registration transaction with the table locked in `SHARE ROW EXCLUSIVE` mode so two concurrent registrations cannot both pass the cap (tested with two parallel `inject()` calls at cap − 1).

## 6. Behaviour

### 6.1 Passwords

Argon2id, OWASP minimum or better: memory 19 MiB, iterations 2, parallelism 1, 16-byte salt, 32-byte hash, stored as the PHC string. Verification re-hashes with the stored parameters; if the stored parameters are weaker than the current constants, the hash is rewritten after a successful login (`needsRehash`). Implementation choice, in this order, decided by the engineer and recorded in the PR: Node's built-in `crypto.argon2` if the Node 26 image provides it as a stable API; otherwise `@node-rs/argon2` (N-API, prebuilt for `linux-x64-musl` and `linux-arm64-musl`, no install script, which matters because the image installs with `--ignore-scripts`). The chosen package's provenance (publisher, download count, repo) goes in the PR as the T2 dependency note. The 256 MB memory limit on the api container allows at most ~10 concurrent verifications at 19 MiB; the auth rate limit (§6.6) keeps it under that.

A login attempt for an unknown login still runs one Argon2id verification against a fixed dummy hash so response time does not reveal whether the login exists.

### 6.2 Invite codes and the cap

- `INVITE_CODES`: comma-separated list in the environment, each entry 8–64 characters, compared after `trim()` and case-folding, in constant time against the SHA-256 of each configured entry. Empty or missing → registration is closed (`invite_invalid` for every code), and the api logs one warning at start-up. The code `ANIME-TCG-2026` quoted in `accounts.md` is an example in a public repository; the owner sets the real value in the env file and should not use the published one.
- `ACCOUNT_CAP`: integer, default 10. Checked at `check-invite` (so step 1 can show the cap message) and again inside the register transaction (the only authoritative check).
- Codes are reusable until the owner changes the variable. No per-code use limit in 1b; the hash of the code used is stored on the account for the owner's audit.

### 6.3 Sign-in throttle ("login breather")

Keyed on the normalised login, persisted in `auth_throttle` so a reload or a second tab does not reset it:

- On a failed password check: `failures + 1`; when it reaches 5, `blocked_until = now + 10 s` and `failures` resets to 0.
- While `blocked_until > now`: the request is refused **before** the password is checked, with 429 `too_many_failures`, `Retry-After: <seconds>` and `retryAfterSeconds` in the envelope (§7.1).
- On success: the row is deleted.
- The same rule and table serve `change-password` and `delete`, keyed on the acting account's login.
- Rows with `updated_at` older than one hour are removed by the hourly purge that already handles sessions.

This is the only place the spec adds state keyed on an unauthenticated input; the auth rate limit (§6.6) bounds how many rows one client can create.

### 6.4 Sessions

Per §4.2. `GET /api/session` returns the account when the cookie names a live session with an `account_id`; a live session without an account (there are none after 1b, but the column stays nullable for a pre-auth session created by a future flow) is reported as signed out.

### 6.5 Authorisation

Every account route calls `requireAccount(req)` (401 `unauthenticated`) and passes the session's `account_id` into the domain function; there is no account id in any path or body. A session whose account no longer exists is treated as signed out and its row deleted.

### 6.6 Rate limits

Per-route overrides on top of the global 100/min (1a now honours them): `check-invite`, `register`, `login` 10 per minute per client address; `change-password`, `delete` 10 per minute; `rename` 30 per minute. 429 uses the standard envelope (`rate_limited`). The throttle in §6.3 is separate and per login, not per client.

### 6.7 Logging

Never log a password, a hash, an invite code or a session id. Log at `info`: account created (id, login), login success/failure (login, outcome, throttle state), rename, password change, delete, each with the request id. Failed logins are not logged above `info` and never include the attempted password.

## 7. Contract (`shared/src/api.ts`, `shared/src/errors.ts`)

### 7.1 Envelope change

`ErrorEnvelope.error` gains an optional `retryAfterSeconds: integer ≥ 1`, present only on `too_many_failures`. New codes: `invite_invalid`, `cap_reached`, `login_taken`, `bad_credentials`, `wrong_password`, `too_many_failures`, `unauthenticated`.

### 7.2 Schemas

```
AccountPublic      { id: uuid string, login: string, createdAt: date-time string, cards: integer }   -- cards is 0 until 1c
SessionResponse    { signedIn: false } | { signedIn: true, account: AccountPublic }
InviteBody         { inviteCode: string(1..64) }
RegisterBody       { inviteCode: string(1..64), login: string(3..24), password: string(8..128) }
LoginBody          { login: string(1..24), password: string(1..128) }
RenameBody         { login: string(3..24) }
ChangePasswordBody { currentPassword: string(1..128), newPassword: string(8..128) }
DeleteBody         { password: string(1..128) }
```

Length limits are byte-agnostic character counts (TypeBox `minLength`/`maxLength`); the domain trims `login` and `inviteCode` and re-checks `login` length after the trim (so `"  ab  "` is 2 characters, a 400). Passwords are never trimmed.

### 7.3 Routes

| Method, path                        | Body                 | Success                                                | Errors (status, code)                                                  | Limit  |
| ----------------------------------- | -------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- | ------ |
| `GET /api/session`                  | —                    | 200 `SessionResponse`                                  | —                                                                      | global |
| `POST /api/accounts/check-invite`   | `InviteBody`         | 204                                                    | 403 `invite_invalid`, 403 `cap_reached`                                | 10/min |
| `POST /api/accounts/register`       | `RegisterBody`       | 201 `{ signedIn: true, account }` + new session cookie | 403 `invite_invalid`, 403 `cap_reached`, 409 `login_taken`             | 10/min |
| `POST /api/session/login`           | `LoginBody`          | 200 `{ signedIn: true, account }` + new session cookie | 401 `bad_credentials`, 429 `too_many_failures` (+ `retryAfterSeconds`) | 10/min |
| `POST /api/session/logout`          | — (`{}` rejected)    | 204 + cookie cleared                                   | — (signed out is still 204)                                            | global |
| `PATCH /api/account/login`          | `RenameBody`         | 200 `{ account }`                                      | 401 `unauthenticated`, 409 `login_taken`                               | 30/min |
| `POST /api/account/change-password` | `ChangePasswordBody` | 204 + rotated session cookie                           | 401 `unauthenticated`, 403 `wrong_password`, 429 `too_many_failures`   | 10/min |
| `POST /api/account/delete`          | `DeleteBody`         | 204 + cookie cleared                                   | 401 `unauthenticated`, 403 `wrong_password`, 429 `too_many_failures`   | 10/min |

Every POST/PATCH is behind the 1a CSRF origin check. Bodies are `additionalProperties: false`; a body on `logout` is a 400. `GET /api/session` keeps `NoQuery`. Response schemas list every status above so the serialiser strips anything undeclared (`password_hash` can never leak by construction).

The UI maps codes to its copy (`accounts.md` §3.7): `invite_invalid` → invalid code, `cap_reached` → cap message, `login_taken` → duplicate, `bad_credentials` → incorrect, `wrong_password` → wrong-current, `too_many_failures` → the wait with `retryAfterSeconds`, `validation_failed` → the matching field message (the UI validates first, so this is the fallback), `unauthenticated` → session ended.

## 8. Owner-side command

`api/src/cli/reset-password.ts`, run inside the api container:

```bash
docker compose --env-file .env.production.local --profile production exec -T api-production node api/dist/cli/reset-password.js <login>
```

Reads the new password from stdin (not an argument, so it never lands in shell history or `ps`), validates 8–128 characters, rehashes, writes it, and destroys every session of the account. Prints one line: `Password reset for "<login>"; 3 sessions ended.`, the login JSON-quoted and then with every remaining control character (Cc: DEL, C1), format character (Cf: bidi and zero-width marks) and U+2028/U+2029 written as `\uXXXX` (`quote` in `api/src/cli/quote.ts`; `JSON.stringify` alone escapes only C0), so none of them reaches the terminal raw. Uses `DATABASE_URL` (the app role has the DML it needs). Exit 1 with a one-line reason on unknown login or bad input. Unit-tested through its exported function; the stdin wrapper is a thin shell. Documented in `docs/04-deployment.md` under "Operations".

## 9. Tests required (minimum, T3)

Unit (`api/src/**/*.test.ts`, `shared/`): password hash/verify/needsRehash; invite normalisation and constant-time check; throttle state machine (4 failures no block, 5th blocks for 10 s, success resets, expiry); login trim and length after trim; schema guard; config rejects a missing `INVITE_CODES` only with a warning, rejects `ACCOUNT_CAP` < 1, rejects identical roles in the two URLs.

Route (`api/test/accounts.test.ts`, `api/test/session.test.ts`): every row of §7.3, happy path and each declared error; extra field → 400; missing Origin → 403; signed-out call to each account route → 401; register at cap → 403 and no row; two parallel registrations at cap − 1 → exactly one 201; rename to own login → 200 no-op; rename to another's login (different case) → 409; login with wrong case of the login → 200 (case-insensitive) with the stored display login returned; `password_hash` absent from every response body (grep the JSON).

Adversarial (`api/test/security/accounts.security.test.ts`): session fixation (pre-auth cookie unknown after login, old cookie 200 `signedIn:false`); other sessions destroyed on password change, current rotated; delete removes sessions; throttle survives a new app instance (same database); unknown-login timing within tolerance of known-login timing (same dummy verify); bad `inviteCode` with case/whitespace variants of a valid one accepted, with a trailing character rejected; 1000-character password → 400 before hashing (no CPU spent); null bytes and RTL overrides in login stored and returned as text, uniqueness still holds; `retryAfterSeconds` never exceeds 10; the cookie after login has the 1a flags; response time of `check-invite` does not differ between an invalid code and a valid one at cap (both refuse before any slow work).

e2e (`web/e2e`): none in this PR (no UI change); the stack spec gains one check that `POST /api/session/login` through Caddy with a foreign `Origin` is 403.

## 10. Acceptance criteria

1. All routes in §7.3 exist, are schema-validated, carry their rate-limit override, and pass the tests in §9; `api/src` coverage stays ≥ 85 %.
2. The app pool runs as `anime_app` and cannot create tables; migrations run as `anime`; both documented, the acceptance-volume upgrade steps included.
3. Sessions have the absolute lifetime and rotate on sign-in and password change; proven by tests.
4. No password, hash, code or session id in any log line at `info` or any response (tests grep for them).
5. `docs/05-security.md`: C3, C4, C5 (absolute lifetime), C6 (auth overrides live) updated; a T3 row for the PR; the throttle and the dummy-hash timing defence recorded as controls. `docs/04-deployment.md`: variables `APP_DB_PASSWORD`, `MIGRATIONS_DATABASE_URL`, `INVITE_CODES`, `ACCOUNT_CAP`; the reset command; the role upgrade steps.

## 11. Open questions

None blocking. Noted for the owner: the invite code printed in `accounts.md` is public; choose a different real value when setting `INVITE_CODES`.
