# 0003 — Accounts: local profiles first, third-party sign-in later

2026-10-28 · accepted

## Context

User accounts are the first roadmap priority. The app is fully static (no server). The owner decided in the 2026-10-28 brainstorm: local accounts as a proof of concept, invite-only for now, migrating later to a third-party identity provider (Google, Discord or similar) with two-factor authentication.

## Decision

1. **Phase 1 (now): local profiles.** Multiple named profiles in the browser's `localStorage`, each with its own collection, currency balance, timers and settings. No password. All storage access goes through a `StorageAdapter` interface (`src/lib/storage/`) with a `localStorage` implementation, so a backend can replace it without touching hooks or components.
2. **Invite code at profile creation.** A profile can only be created with a valid invite code. In Phase 1 this is a client-side check against a list shipped in the bundle; it is a **flow placeholder, not security** (see consequences). It exists so the create-profile UX is already right when a backend arrives.
3. **Phase 2 (later): third-party sign-in.** Google and/or Discord via a backend-as-a-service (Supabase is the leading candidate; separate ADR when chosen). The app will never store passwords. Two-factor authentication is the provider's: the app does not implement its own 2FA, and it treats a provider login as trusted. Where the provider exposes an MFA signal (Discord's `mfa_enabled` on the user object, verified 2026-10-28, https://discord.com/developers/docs/resources/user) the app may require it; Google exposes no reliable per-login MFA claim to third-party apps, so "2FA" there means the user's own Google account setting.
4. **Migration path.** Phase 2 must offer "import this device's local profile" so Phase 1 collections are not lost.

## Consequences

- Phase 1 gives the owner (and anyone with the URL) multiple collections on one device, nothing more. Any local profile, balance, or collection can be edited in DevTools. Nothing in Phase 1 is trustworthy, and no leaderboard or trading between real people can be built on it.
- The invite code in Phase 1 is readable from the JavaScript bundle. It keeps casual visitors out of the flow; it stops nobody who looks.
- A local system clock change defeats any timer in Phase 1 (pack drops). Acceptable for a PoC; a Phase 2 backend must own the clock.
- The `StorageAdapter` boundary is the one piece of Phase 1 that must be done properly; everything else is replaceable.
