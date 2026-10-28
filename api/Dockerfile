# Build context is the repository root (compose.yml: `dockerfile: api/Dockerfile`)
# because the api depends on the `shared` workspace and the root lockfile.
# Stage 1 compiles TypeScript with the dev dependencies, then reinstalls
# production-only modules so the final image carries no compiler or test tool.
# Base images are pinned to their multi-arch index digest; Dependabot
# (package-ecosystem: docker) proposes bumps.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
# `npm ci` runs the `prepare` script, which installs Husky hooks. There is no
# .git in the build context (.dockerignore) and hooks are meaningless in an
# image, so tell Husky to skip.
ENV HUSKY=0
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY api/package.json api/
RUN npm ci --workspace shared --workspace api
COPY shared shared
COPY api api
RUN npm run build --workspace shared --workspace api \
	&& npm ci --workspace shared --workspace api --omit=dev

# Stage 2: the compiled service, its production modules and nothing else,
# owned by root and run by an unprivileged user so the process cannot modify
# its own code even if the root filesystem were writable.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S api && adduser -S -G api -H api
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/api/package.json api/
COPY --from=build /app/api/dist api/dist
USER api
EXPOSE 3000
# The api's own /healthz runs `SELECT 1`, so "healthy" means the database is
# reachable too; compose waits on it before starting Caddy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
	CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "api/dist/server.js"]
