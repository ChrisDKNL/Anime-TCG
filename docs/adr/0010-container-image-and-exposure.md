# 0010 — Container image, hardening and network exposure for the web app

2026-10-28 · accepted (security tier T3; reviewed by `security-officer`, PASS WITH FINDINGS applied; gated by `quality-controller`)

## Context

Roadmap item 0.2: the owner runs acceptance on a workstation and production on a NAS, both in Docker (ADR 0005, 0007), and asked that acceptance be reachable locally only. Nothing in the repo made the deployment reproducible. ADR 0008 and the security register (`docs/05-security.md`, C8, C15) set the bar for headers and exposure.

## Decision

1. **One image, two profiles.** A multi-stage `Dockerfile` builds the Vite app on Node 22 and serves `dist/` with Caddy 2 on port 8080 as a non-root user. `compose.yml` defines `acceptance` and `production` profiles from one shared service definition; nothing starts without a profile.
2. **Loopback only, no override.** Both profiles publish on `127.0.0.1` and there is no variable to widen the bind. Production is reached through a reverse proxy or Cloudflare Tunnel on the same host, or by a containerised proxy joining the compose network. Reason: Docker's published ports bypass ufw/firewalld unless the `DOCKER-USER` chain is configured, so a "0.0.0.0 if your firewall allows" escape hatch would mislead more than it helps.
3. **Hardening in the compose file, not in prose**: `read_only` root with `noexec,nosuid` 16 MB tmpfs for Caddy's state, `cap_drop: ALL`, `no-new-privileges`, `pids_limit: 64`, 128 MB memory limit, image healthcheck on `/healthz`.
4. **The image needs no capability.** `caddy:2-alpine` ships `/usr/bin/caddy` with the file capability `cap_net_bind_service=ep`; with `cap_drop: ALL` the kernel refuses to exec a binary whose file capabilities cannot be granted, so the container died on start. The capability is stripped in the final build stage instead of granting it back, because the service binds an unprivileged port and least privilege is the point of `cap_drop: ALL`. Found by the CI job below on its first real run, which is why that job exists.
5. **Strict CSP at the edge**: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://s4.anilist.co; connect-src 'self' https://graphql.anilist.co; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`. No inline allowances: the production build links its CSS and React applies the `style` prop through the CSSOM, which CSP does not govern. Revisit if SSR or `?inline` CSS imports are introduced. No HSTS in the container; TLS and HSTS are the proxy's job.
6. **Base images pinned by digest**, bumped by Dependabot's `docker` ecosystem.
7. **CI builds and runs the real thing.** The `docker` job starts the `acceptance` profile with `docker compose up --build --wait`, verifies with `docker inspect` that the read-only root, the pid limit and the loopback bind are in effect, asserts the exact CSP header, and tears down. It is a required check in the ruleset (owner action to add it to the live ruleset).
8. **Env files never enter the image or git**: `.env*` and `*.local` are in `.dockerignore`; `.env` and `.env.*` in `.gitignore`. Compose reads them; the build does not.

## Consequences

- Acceptance and production are reproducible from the repo with the commands in `docs/04-deployment.md`; the local Claude Code session deploys only from committed files.
- A proxy or tunnel is mandatory for any non-local access; that is the only way in by design.
- When the API arrives (Sprint 1a), Caddy gains a `/api/*` reverse-proxy route and `connect-src` stays `'self'`; the image and hardening carry over.
- Rejected: `cap_add: NET_BIND_SERVICE` (grants an unused privilege to keep a vendor default), nginx (Caddy's header and SPA handling is shorter and it is the proxy choice of ADR 0009), running CI with bare `docker run` (hid the capability failure).
