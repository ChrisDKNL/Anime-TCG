# Deployment

How to run the static build as a container on the NAS. The files this covers (`Dockerfile`, `Caddyfile`, `compose.yml`, `.dockerignore`, the `docker` job in `.github/workflows/ci.yml`) are security tier **T3** per `docs/05-security.md`.

## What the image is

Multi-stage `Dockerfile`: `node:22-alpine` runs `npm ci` (`HUSKY=0`, no `.git` in the build context) and `npm run build`; `caddy:2-alpine` serves the resulting `dist/` from `/srv` on port **8080** as an unprivileged user. Nothing else is in the final image. There is no backend: the browser calls AniList directly.

`compose.yml` runs that image under one of two profiles. Nothing starts without a profile.

| Profile      | Container              | Published on                                          | Restart          |
| ------------ | ---------------------- | ----------------------------------------------------- | ---------------- |
| `acceptance` | `anime-tcg-acceptance` | `127.0.0.1:${ACCEPTANCE_PORT:-8080}`                  | no               |
| `production` | `anime-tcg-production` | `${BIND_ADDRESS:-127.0.0.1}:${PRODUCTION_PORT:-8081}` | `unless-stopped` |

Both run with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, a tmpfs for Caddy's `/data` and `/config`, and a 128 MB memory limit.

Variables are read from the shell or from a file passed with `--env-file`. Use `.env.local` for that: it is gitignored (`*.local`). There is no `.env` in the repo.

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

Production defaults to loopback because a reverse proxy or Cloudflare Tunnel on the same host is the only client it should have. `BIND_ADDRESS=0.0.0.0` publishes it on every interface; do that only when the host firewall is the intended boundary and you have checked that it is.

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

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://s4.anilist.co data:; connect-src 'self' https://graphql.anilist.co; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- No `Server` header.

`style-src` carries `'unsafe-inline'` because `CharacterCard` sets an inline `style` attribute (`animationDelay`) and Vite's tooling can inject `<style>` elements. `script-src` stays strict; Vite emits no inline scripts. `img-src` and `connect-src` name the only remote hosts the app uses (`src/lib/anilist.ts`); adding a new remote host means updating `Caddyfile`.

Caching: `/assets/*` is content-hashed by Vite and served with `Cache-Control: public, max-age=31536000, immutable`; everything else (`index.html` included) is `no-cache`, so a new deploy is picked up on the next load.

Left to the proxy: TLS, `Strict-Transport-Security`, and anything that needs to know the public hostname.

## Rollback

Re-run production with the previous tag and without a build:

```bash
TAG=2026-10-21 docker compose --profile production up -d --no-build
```

Compose recreates `anime-tcg-production` from the older image. Nothing persists in the container (collection state lives in the browser's `localStorage`), so there is no data migration to undo.

## CI

The `docker` job in `.github/workflows/ci.yml` builds the image, starts it, waits up to 30 s for `/healthz`, checks that `/` serves the app's `<title>` with a `Content-Security-Policy` header, prints the container logs on failure, and removes the container. It is not in the ruleset's required checks (`docs/01-github-flow.md`); add it there if a broken image should block merges.
