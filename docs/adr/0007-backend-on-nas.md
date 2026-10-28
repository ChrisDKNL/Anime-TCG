# 0007 — The backend runs in Docker on the owner's NAS

2026-10-28 · accepted · amends ADR 0005 (the "dev station" assumption)

## Context

ADR 0005 recorded the app as hosted in Docker on the owner's dev workstation and warned that a public backend there means a compromised game is a compromised workstation. The owner's response: the server will run locally on a NAS, in a Docker container. The owner also accepted the ADR 0006 caveat that client-side passwords only gate the UI, and named the server-side backend as the fix.

## Decision

1. **Production (frontend + backend + database) runs on the NAS in Docker**, not on the workstation. The workstation keeps the acceptance stack and the local Claude Code session that deploys (`docs/03-release-process.md`); the production target in that process is the NAS.
2. **ADR 0003 Phase 2 is confirmed as "own backend"**: an API service and a database next to the static frontend, in one `compose.yml`. Authentication provider choice (Google/Discord via OAuth, own password accounts, or both) is still a separate ADR, but the hosting question for it is closed.
3. **Sprint 1 scope is unchanged.** Local accounts (ADR 0006) remain the proof of concept: the Account UI flow, the `StorageAdapter` boundary and the migration logic all survive the move to a server; only the PBKDF2-in-the-browser code is throwaway, and it is small. Building the backend first would delay every visible feature by weeks.
4. **Exposure**: the NAS's own management interface, file shares and any other service stay off the internet. Only the reverse proxy for this app is reachable, preferably through an outbound tunnel (Cloudflare Tunnel, https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/, verified 2026-10-28) so no inbound port is forwarded to the NAS at all.
5. **Containment**: the app's containers mount only their own data volume, never NAS shares; run as non-root; the database port is not published to the LAN; secrets come from an env file outside the repo.
6. **Backups**: the database volume is included in the NAS's existing backup scheme, and a restore is tested once before the first real user other than the owner exists.

## Consequences

- The ADR 0005 workstation warning is resolved by moving the target; the NAS warning replaces it: NAS vendors ship Docker and kernels that lag upstream, so the NAS itself needs updates on a schedule, and anything on it is one container escape away from the owner's personal data. Items 4 and 5 are the mitigation.
- Deployment files in the repo (roadmap item 0.2) now target two hosts: acceptance on the workstation, production on the NAS. One `compose.yml` with profiles, or two override files, is the expected shape.
- The release process gains a step: the local Claude session deploys to the NAS over SSH or the NAS's Docker socket; how is documented when the deployment files are committed.
