import { randomUUID } from "node:crypto";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import fastify from "fastify";
import type { Logger } from "pino";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { dbPlugin } from "./plugins/db.js";
import { errorsPlugin } from "./plugins/errors.js";
import { createLogger } from "./plugins/logging.js";
import { securityPlugin } from "./plugins/security.js";
import { sessionPlugin } from "./plugins/session.js";
import { healthRoutes } from "./routes/health/index.js";
import { sessionRoutes } from "./routes/session/index.js";

export interface BuildAppOptions {
  config: Config;
  db: Db;
  logger?: Logger;
  /** Socket inactivity limit; a client that opens a connection and stalls is cut off after this. */
  connectionTimeout?: number;
  /** Limit for receiving a whole request, headers included. */
  requestTimeout?: number;
}

/** Request bodies here are a few hundred bytes; anything near this is not a client we serve. */
const BODY_LIMIT_BYTES = 64 * 1024;
const CONNECTION_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** Wires plugins and routes; never listens, never touches the network, so tests can `inject()`. */
export async function buildApp({
  config,
  db,
  logger = createLogger("silent"),
  connectionTimeout = CONNECTION_TIMEOUT_MS,
  requestTimeout = REQUEST_TIMEOUT_MS,
}: BuildAppOptions) {
  const app = fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
    // Caddy (compose) and Vite (dev) sit in front on a private network; anything further away is not a proxy we trust.
    trustProxy: "loopback, uniquelocal",
    bodyLimit: BODY_LIMIT_BYTES,
    connectionTimeout,
    requestTimeout,
    ajv: {
      customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false, allErrors: false },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(dbPlugin, { db });
  await app.register(securityPlugin, { config });
  await app.register(sessionPlugin, { config });
  await app.register(errorsPlugin);
  await app.register(healthRoutes);
  await app.register(sessionRoutes, { prefix: "/api" });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
