# Stage 1: build the static bundle. `tsc -b && vite build` needs the dev
# dependencies, so this stage has all of them and the final image has none.
# Both base images are pinned to their multi-arch index digest; Dependabot
# (package-ecosystem: docker) proposes bumps.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
# `npm ci` runs the `prepare` script, which installs Husky hooks. There is no
# .git in the build context (.dockerignore) and hooks are meaningless in an
# image, so tell Husky to skip.
ENV HUSKY=0
# Manifests first so the dependency layer is cached until a manifest changes.
# Only the `web` workspace is installed; `api` has its own image.
COPY package.json package-lock.json tsconfig.base.json ./
COPY web/package.json web/
RUN npm ci --workspace web
COPY web web
RUN npm run build --workspace web

# Stage 2: serve dist/ with Caddy as an unprivileged user.
FROM caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
# The base image runs Caddy as root so it can bind 80/443. We listen on 8080
# instead, which an unprivileged user can bind without capabilities; TLS and
# the public port are the host proxy's job (docs/04-deployment.md).
RUN addgroup -S web && adduser -S -G web -H web \
	&& chown -R web:web /data /config
# caddy:2-alpine ships /usr/bin/caddy with the file capability
# cap_net_bind_service=ep. compose.yml drops every capability, and the kernel
# refuses to exec a binary whose file capabilities cannot be granted
# ("operation not permitted"), so strip it: the service binds an unprivileged
# port and the capability is dead weight. The base image already ships libcap
# (it ran setcap itself); the add keeps this layer working should a future base
# drop it, and the del removes libcap afterwards since nothing else needs it.
RUN apk add --no-cache libcap && setcap -r /usr/bin/caddy && apk del libcap
COPY --from=build --chown=web:web /app/web/dist /srv
COPY --chown=web:web Caddyfile /etc/caddy/Caddyfile
USER web
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget -qO- http://127.0.0.1:8080/healthz
