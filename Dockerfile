# syntax=docker/dockerfile:1

# Stage 1: build the static bundle. `tsc -b && vite build` needs the dev
# dependencies, so this stage has all of them and the final image has none.
FROM node:22-alpine AS build
WORKDIR /app
# `npm ci` runs the `prepare` script, which installs Husky hooks. There is no
# .git in the build context (.dockerignore) and hooks are meaningless in an
# image, so tell Husky to skip.
ENV HUSKY=0
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: serve dist/ with Caddy as an unprivileged user.
FROM caddy:2-alpine
# The base image runs Caddy as root so it can bind 80/443. We listen on 8080
# instead, which an unprivileged user can bind without capabilities; TLS and
# the public port are the host proxy's job (docs/04-deployment.md).
RUN addgroup -S web && adduser -S -G web -H web \
	&& chown -R web:web /data /config
COPY --from=build --chown=web:web /app/dist /srv
COPY --chown=web:web Caddyfile /etc/caddy/Caddyfile
USER web
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget -qO- http://127.0.0.1:8080/healthz
