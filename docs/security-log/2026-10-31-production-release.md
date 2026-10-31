# First production release v0.1.0 (#63)

- **Date:** 2026-10-31
- **Tier:** T3 (proxy and network exposure, production secrets, backups)
- **Verdict:** PASS WITH FINDINGS: GO WITH CONDITIONS M1–M8. M1–M5 and M7 before the domain switch, M6 before the first invite code is handed out. The register edits below apply once the local session reports each condition done.
- **Owner informed:** through this review; Caddyfile and Cloudflare edits are the owner's
- **Status:** written before the deploy. The checks below marked "to verify" are run by the local session at deploy time and recorded in the register-sync PR.

## Change

Production goes live at https://tcg.private-0118.nl from `v0.1.0` (`6ac7ccbf8633d86c48504d9aab1dd482fdf4a982`, same app tree as acceptance `360dd85`). Path: Cloudflare (proxied DNS: A 104.21.14.56, 172.67.158.23; AAAA 2606:4700:3037::6815:e38, 2606:4700:3034::ac43:9e17), with an Origin CA certificate, to the owner's native Caddy 2.10.0 on the host's `[::]:443` (router port-forward, no tunnel), to `reverse_proxy 127.0.0.1:8190` (`caddy-production`), to the api, to the database. Production runs from its own checkout `C:\ProgramData\AnimeTCG\production\tcg` at the tag, under compose project `anime-tcg-production`, with its own env file `C:\ProgramData\AnimeTCG\production\.env.production.local` (fresh `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `SESSION_SECRET`, one `INVITE_CODES` entry per invitee, `WEB_ORIGIN=https://tcg.private-0118.nl`, `PRODUCTION_PORT=8190`, `ACCOUNT_CAP=10`). Nightly `pg_dump` task `AnimeTCG-ProductionBackup`.

## Review notes

- Client address: the api keys on the first address from the right of `X-Forwarded-For` that is neither loopback nor unique-local (`trustProxy`). The container Caddy believes any XFF from the host: on acceptance, a request from the host with a forged `X-Forwarded-For: 203.0.113.9` got its own bucket. With a plain `reverse_proxy` the native Caddy replaces XFF with Cloudflare's egress address and every visitor shares Cloudflare's buckets. With `trusted_proxies` alone the api still keys on the egress address. Only the native hop can tell Cloudflare's connections apart, so it sets `X-Forwarded-For` to `CF-Connecting-IP` for peers in Cloudflare's published ranges and to the peer's own address otherwise. To verify after the switch: on loopback, plain, forged-`CF-Connecting-IP` and forged-XFF requests must count down one bucket; from two networks, the counters must be independent.
- Cookies and CSRF: `__Host-session` is set `secure: true` without condition; Cloudflare to origin is Full (strict); `WEB_ORIGIN` is exact. CSP unchanged, correct for the public origin; HSTS added at the native Caddy (`max-age=31536000`).
- Exposure: `caddy-production` is published on `127.0.0.1:8190` only; api and db publish nothing; `production-front`/`-back` on 172.16.20.0/24 and 172.16.21.0/24 (free on the host). Caddy listens on all interfaces and `caddy.exe` is allowed inbound on all profiles, so the origin is assumed reachable without Cloudflare (owner to confirm).
- Backups: nightly custom-format dump (session and throttle rows excluded), archive listed before it is kept, 14 days kept. To verify before the first invite: one restore into a throwaway database on an internal network must match the counts, and `audit-ledger` must print `Ledger consistent`.

## Findings

1. **high:** the planned `reverse_proxy 127.0.0.1:8190` keys every per-address limit (C6) on Cloudflare's egress addresses, so one person can lock sign-in for everyone on the same egress. Fixed by the native Caddy config (M1).
2. **high:** release note v0.1.0 steps 2–3 put the production env file and build in `C:\ProgramData\AnimeTCG\src`, which the acceptance watcher checks out at every app change of `main` (compose project `src`): production could be built from a commit other than the tag. Fixed by a separate checkout and project (M2).
3. **high:** C16 not in place. Fixed by the nightly dump and a tested restore (M6).
4. **medium:** production secrets must differ from acceptance's (#35 S1) and sit in a folder that `BUILTIN\Users` cannot read (#35 S3; the folder inherits Users RX today). Fixed (M3, M4).
5. **medium:** the default `PRODUCTION_PORT` 8081 is Vaultwarden's published port. Set to 8190; to verify with `docker inspect` (M5).
6. **medium:** AAAA records are published, so #42 S1 (per-/128 limits) is live. Open item, fix soon.
7. **medium:** origin reachable without Cloudflare (assumption). Keys cannot be spoofed after M1, but Cloudflare's protections are bypassed. Open item, fix soon.
8. **low:** no HSTS anywhere. Fixed in M1.
9. **low:** Cloudflare features that inject or rewrite scripts conflict with the CSP, and Bot Fight Mode challenges would break JSON calls. The owner confirms them off (M7).
10. **low:** docs/04-deployment.md "Reverse proxy or tunnel", the repo `Caddyfile` comment and release note steps 2–3 describe the tunnel case or the wrong folder. Release note fixed in #63; the rest is an open item (docs PR).
11. **info:** api request logs now carry visitors' real addresses (bounded by the 5 × 10 MB rotation). Accepted, noted for privacy.

## Register edits

- **Threat model, append:** "From v0.1.0 (2026-10-31) production is public at https://tcg.private-0118.nl behind Cloudflare's proxy, the owner's native Caddy on the host's port 443 (router port-forward, Origin CA certificate, Full (strict)) and the production Caddy on `127.0.0.1:8190`. The origin is assumed reachable without Cloudflare, so no control relies on Cloudflare alone: the native Caddy takes the client address from `CF-Connecting-IP` only on connections from Cloudflare's published ranges and otherwise from the peer, and sends it as the only `X-Forwarded-For` entry (C6, C15)."
- **C6 status, append:** "; production (v0.1.0): the native Caddy's `tcg.private-0118.nl` block sets `X-Forwarded-For` to `CF-Connecting-IP` for peers in Cloudflare's published ranges and to `{remote_host}` otherwise, so the api keys on the visitor Cloudflare saw, a direct-to-origin client on its own address, and no client chooses its key; proven by the loopback forged-header probe and the two-network probe (`docs/security-log/2026-10-31-production-release.md`); IPv6 visitors are limited per /128 until the open item lands"
- **C8 status, append:** "; production: `Strict-Transport-Security: max-age=31536000` set by the native Caddy; Cloudflare Rocket Loader, Email Obfuscation, automatic analytics injection and Zaraz off for the host, so nothing rewrites or injects scripts past the CSP"
- **C12 status:** "live (gitleaks)" becomes "live (gitleaks); production's env file is `C:\ProgramData\AnimeTCG\production\.env.production.local`, outside every checkout, under an ACL of SYSTEM, Administrators and the owner only, with its own secrets and one invite code per invitee (none shared with acceptance or the code in docs)"
- **C15 status, append:** "; decided (v0.1.0): Cloudflare proxied DNS plus a router port-forward to the host's native Caddy, no tunnel; `caddy-production` published on `127.0.0.1:8190` only (verified with docker inspect); production runs from its own checkout at the release tag under compose project `anime-tcg-production`, never the watcher's"
- **C16 status:** "planned" becomes "live (v0.1.0): task `AnimeTCG-ProductionBackup` dumps the production database nightly (custom format, `sessions` and `auth_throttle` data excluded, archive listed before it is kept, 14 days kept) to `C:\ProgramData\AnimeTCG\production\backups`; restore tested <date> into a throwaway database on an internal network with matching counts and `audit-ledger` consistent; no off-machine copy yet (open item)"
- **C21 status, append:** "; production never shares the acceptance checkout or compose project (v0.1.0)"
- **Open items, close:** "Decide tunnel vs. port-forward (C15)" (decided above); "With the C15 decision: the api trusts `loopback, uniquelocal`…", replaced by "Residual (accepted): any process on the host that reaches `127.0.0.1:8190` chooses its own rate-limit key (owner's machine out of scope)"; "Acceptance secrets (#35 S1)"; "Acceptance folder ACL (#35 S3)" (record the date applied); "Backups (C16) now matter…".
- **Open items, edit** "Rate limit (#42 S1, low)": "…keys on the full client address. Live since v0.1.0: the domain publishes AAAA records. Until the /64 `keyGenerator` lands, disable Cloudflare IPv6 compatibility or add a Cloudflare rate-limiting rule on `/api/session/login` and `/api/demo/open`."
- **Open items, add:**
  - "Origin bypass (v0.1.0 F7, medium): enable Authenticated Origin Pulls with `client_auth` on the `tcg.private-0118.nl` site, or restrict the 443 forward or firewall rule to Cloudflare's ranges; confirm with the owner whether 443 is open to the internet."
  - "Backups off the machine (C16): copy the newest dump off the host at least weekly."
  - "Cloudflare ranges (C6): re-check the native Caddy's list against cloudflare.com/ips-v4 and /ips-v6 quarterly."
  - "Docs (v0.1.0 F10): correct docs/04-deployment.md 'Reverse proxy or tunnel' for Cloudflare-proxied DNS plus a host Caddy (header_up rewrite, HSTS) and the repo Caddyfile comment."
  - "Privacy (v0.1.0 F11, info): api request logs carry visitors' real addresses; retention is bounded by log rotation."
