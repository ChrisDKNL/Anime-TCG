# Deployment

How to run the static build as a container on the NAS. The files this covers (`Dockerfile`, `Caddyfile`, `compose.yml`, `.dockerignore`, the `docker` job in `.github/workflows/ci.yml`) are security tier **T3** per `docs/05-security.md`.

## What the image is

Multi-stage `Dockerfile`: `node:22-alpine` runs `npm ci` (`HUSKY=0`, no `.git` in the build context) and `npm run build`; `caddy:2-alpine` serves the resulting `dist/` from `/srv` on port **8080** as an unprivileged user. Nothing else is in the final image. There is no backend: the browser calls AniList directly.

`compose.yml` runs that image under one of two profiles. Nothing starts without a profile.

| Profile      | Container              | Published on                         | Restart          |
| ------------ | ---------------------- | ------------------------------------ | ---------------- |
| `acceptance` | `anime-tcg-acceptance` | `127.0.0.1:${ACCEPTANCE_PORT:-8080}` | no               |
| `production` | `anime-tcg-production` | `127.0.0.1:${PRODUCTION_PORT:-8081}` | `unless-stopped` |

Both run with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, a 16 MB `noexec,nosuid` tmpfs for each of Caddy's `/data` and `/config`, a 128 MB memory limit and a 64-process limit.

Variables are read from the shell or from a file passed with `--env-file`. Use `.env.local` for that: it is gitignored (`*.local`, and `.env` / `.env.*` for good measure). The file is read by compose only, to substitute the variables above; `.dockerignore` excludes `.env*` and `*.local` from the build context, so it never enters the image. There is no `.env` in the repo.

## Acceptance

```bash
docker compose --profile acceptance up -d --build
curl -fsS http://127.0.0.1:8080/healthz        # prints: ok
```

Open http://127.0.0.1:8080, open a few packs, check the collection persists across a reload. Then:

```bash
docker compose --profile acceptance down
```

Acceptance is bound to loopback and cannot be changed through a variable. It is for the owner's own checks on the host, never for the LAN.

## Production

Bake the tag into the image name so you can roll back to it later:

```bash
TAG=2026-10-28 docker compose --profile production up -d --build
```

This builds `anime-tcg-web:2026-10-28` and starts `anime-tcg-production` on `127.0.0.1:8081`. Later runs with the same `TAG` and no `--build` reuse that image. `docker image ls anime-tcg-web` lists what you have.

### Network exposure

Production is published on loopback only and is reached through a reverse proxy or Cloudflare Tunnel on the same host. There is no variable to widen the bind address, on purpose: Docker's published ports bypass `ufw` / `firewalld` unless the `DOCKER-USER` chain is configured, so a `0.0.0.0` binding would be reachable from the LAN (or the internet, if the host is) regardless of the host firewall's rules. If the proxy runs as a container, attach it to this compose project's network (`docker network connect <project>_default <proxy>`, where `<project>` is the checkout's directory name in lowercase, or declare that network as `external` in the proxy's own compose file) and reference the service by name, `http://web-production:8080`, instead of publishing any port.

### Reverse proxy or tunnel

Point the proxy at `http://127.0.0.1:8081` (or your `PRODUCTION_PORT`). The proxy owns TLS, HSTS, any authentication, rate limiting and access logs; the container does none of that.

Caddy on the host:

```
anime.example.com {
	reverse_proxy 127.0.0.1:8081
}
```

Cloudflare Tunnel (`cloudflared` config ingress):

```yaml
ingress:
  - hostname: anime.example.com
    service: http://127.0.0.1:8081
  - service: http_status:404
```

## Headers the container sets

On every response:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://s4.anilist.co; connect-src 'self' https://graphql.anilist.co; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- No `Server` header.

`style-src` is `'self'` with no `'unsafe-inline'`: React applies the `style` prop (`CharacterCard`'s `animationDelay`) through the CSSOM, which CSP does not govern, and the production build links its CSS via `<link>` with no inline `<style>`. The dev server, which does inject `<style>` elements, never runs behind this `Caddyfile`. If SSR or a `?inline` CSS import is ever introduced, this must be revisited (a nonce or hash, not `'unsafe-inline'`). `script-src` stays strict; Vite emits no inline scripts. `img-src` and `connect-src` name the only remote hosts the app uses (`src/lib/anilist.ts`), with no `data:` scheme; adding a new remote host means updating `Caddyfile`, `docs/04-deployment.md` and `EXPECTED_CSP` in `.github/workflows/ci.yml` together.

Caching: `/assets/*` is content-hashed by Vite and served with `Cache-Control: public, max-age=31536000, immutable`; everything else (`index.html` included) is `no-cache`, so a new deploy is picked up on the next load.

Left to the proxy: TLS, `Strict-Transport-Security`, and anything that needs to know the public hostname.

## Rollback

Re-run production with the previous tag and without a build:

```bash
TAG=2026-10-21 docker compose --profile production up -d --no-build
```

Compose recreates `anime-tcg-production` from the older image. Nothing persists in the container (collection state lives in the browser's `localStorage`), so there is no data migration to undo.

## CI

The `docker` job in `.github/workflows/ci.yml` builds the image, starts it on `127.0.0.1:8080` of the runner, waits up to 30 s for `/healthz`, checks that `/` serves the app's `<title>` and that the `Content-Security-Policy` header equals `EXPECTED_CSP` (declared once at the top of the job and kept identical to the `Caddyfile`), prints the container logs on failure, and removes the container. The checkout step uses `persist-credentials: false` so the workflow token is never in the build context. The job is one of the four required checks in the ruleset (`docs/01-github-flow.md`), so a broken image or a drifted CSP blocks merges.
