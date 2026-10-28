# 0006 — Local accounts get a login and password (Phase 1)

2026-10-28 · accepted (owner's decision; the manager's caveat is recorded below)

## Context

ADR 0003 specified Phase 1 local profiles **without** a password. The owner decided on 2026-10-28 that the flow should be: **Account → Login or Register**; Register asks for the invite code first, then lets the user set a login and a password. Cap of 10 accounts per device. Invite code for Phase 1: `ANIME-TCG-2026`.

## The caveat, stated once

A password on a `localStorage`-only app protects nothing from anyone who opens DevTools: the collection, the balance and the hash all sit in the same storage, readable and editable. The password gates the **UI**, which is useful on a shared screen (a sibling can't open your account by clicking) and nothing more. Encrypting the profile data with a password-derived key would make a forgotten password equal to a lost collection, which is worse for a PoC. So Phase 1 stores a hash, leaves the data in the clear, and the copy says so. Real protection arrives with the backend (ADR 0003 Phase 2), where these passwords are discarded in favour of third-party sign-in.

## Decision

1. **Account entry point** replaces the profile switcher: a header "Account" control opens Login or Register. Switching accounts is logout then login.
2. **Register**: invite code (checked first, trimmed, case-insensitive, against `src/lib/invites.ts`) → login + password + confirm. Login is the display name: 3–24 characters, unique per device case-insensitively. Password: minimum 8 characters, no other composition rules, maximum 128.
3. **Password storage**: PBKDF2-SHA-256 via WebCrypto, 600 000 iterations (OWASP recommendation, verified 2026-10-28, https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), random 16-byte salt per account, stored with the account index. Never plaintext, never logged, never exported. Verification compares derived keys of equal length.
4. **Login** keeps the account signed in on that device until logout; the active account id is persisted. No "remember me" toggle. Five wrong passwords in a row show a 10-second wait: a UX nudge, not security, and the copy does not call it security.
5. **No password recovery.** There is no email. The copy says: "There is no way to recover a forgotten password. You can delete the account from this device." Delete requires the password.
6. **Legacy collection**: on first launch with the pre-accounts collection present, the Register screen says the existing N cards will be attached to the first account created on this device, and does so after a verified write. Nothing is deleted until the read-back matches.
7. **Phase 2 migration**: passwords are not migrated. Sign-in through a provider replaces them; local accounts are imported by export/import or a one-time "claim this device's accounts" step. Defined in the Phase 2 ADR.
8. **Cap**: 10 accounts per device.

## Consequences

- The `StorageAdapter` (ADR 0003) gains credential operations; the spec in `docs/design/accounts.md` is amended, not rewritten.
- `security-officer` review is mandatory for the implementation (persistence + authentication).
- The e2e suite must register or seed an account before the pack flow; `tester` owns that.
- Nothing in Phase 1 may claim to be secure. The word does not appear in the UI.
