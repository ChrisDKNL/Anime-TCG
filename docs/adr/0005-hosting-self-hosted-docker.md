# 0005 — Hosting: self-hosted Docker on the owner's dev station

2026-10-28 · accepted (facts recorded from the owner; deployment files still to be committed)

## Context

The owner runs the app in a Docker container on their own dev station, reachable from the internet at `tcg.private-0118.nl` (Cloudflare DNS, record pending as of 2026-10-28). A backend can run in the same container or alongside it. This was not known when ADR 0003 was written and it changes the cost of its Phase 2 options.

## Decision

1. **Production is the owner's Docker host.** No cloud static host, no PaaS. The deployment must be reproducible from the repo: `Dockerfile`, a `compose.yml` and the reverse-proxy/tunnel config (minus secrets) belong in the repository, with a `docs/03-deployment.md` describing how the image is built and updated. Until they are committed, the deployment is undocumented and ADR 0005 is only half true.
2. **Phase 2 of ADR 0003 may use an own backend** co-located with the frontend, because hosting is free and already exposed. "Own backend" (option C in the roadmap brainstorm) is no longer the expensive option. The choice between (a) own backend with self-managed OAuth, (b) a BaaS for auth only with the API in the container, or (c) full BaaS, is made in the Phase 2 ADR, not here.
3. **Separate services, one compose file.** Frontend (static files behind a web server), API, and database run as separate services in one `compose.yml`, not as one process in one container, so each can be upgraded and restarted independently and the database gets its own volume and backup path.
4. **A public URL raises the bar for anything server-side.** While the app is static, exposure is limited to serving files. The moment a backend exists, `security-officer` review covers: TLS termination (Cloudflare or the proxy), rate limiting at the edge, OAuth callback allow-listing to the public origin only, session cookie flags, database backups, and what the dev station leaks if compromised (it is the owner's working machine, not a disposable VM).

## Consequences

- Phase 1 (local profiles) is unchanged: it ships as static files and needs no server.
- The economy's trust problem (ADR 0004: client-side balances are editable) now has a realistic fix path: a backend owning balances and timers, on hardware the owner already runs.
- The owner takes on uptime, backups and patching of a machine that is also their workstation. A compromised game backend is a compromised dev station. Isolating the stack (a VM, or at minimum rootless containers with no host mounts beyond the data volume) is strongly recommended before any backend goes live.
- AniList calls stay browser-side; the public URL does not change the rate-limit picture (limits are per client IP, https://docs.anilist.co/guide/rate-limiting, verified 2026-10-28).
