import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import type { Socket } from "node:net";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import fastify from "fastify";
import type { Logger } from "pino";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import type { ErrorEnvelope } from "@anime-tcg/shared/errors";
import { cryptoRng, type Rng } from "./domain/packs/rng.js";
import { accountsPlugin } from "./plugins/accounts.js";
import { dbPlugin } from "./plugins/db.js";
import { economyPlugin } from "./plugins/economy.js";
import { errorsPlugin } from "./plugins/errors.js";
import { createLogger, quieterOf } from "./plugins/logging.js";
import { packsPlugin } from "./plugins/packs.js";
import { securityPlugin } from "./plugins/security.js";
import { sessionPlugin } from "./plugins/session.js";
import { accountRoutes } from "./routes/accounts/index.js";
import { collectionRoutes } from "./routes/collection/index.js";
import { demoRoutes } from "./routes/demo/index.js";
import { healthRoutes } from "./routes/health/index.js";
import { packRoutes } from "./routes/packs/index.js";
import { sessionRoutes } from "./routes/session/index.js";
import { shopRoutes } from "./routes/shop/index.js";
import { walletRoutes } from "./routes/wallet/index.js";

export interface BuildAppOptions {
  config: Config;
  db: Db;
  logger?: Logger;
  /** Socket inactivity limit; a client that opens a connection and stalls is cut off after this. */
  connectionTimeout?: number;
  /** Limit for receiving a whole request, headers included. */
  requestTimeout?: number;
  /** The generator every roll with stakes uses; `crypto.randomInt` unless a test scripts the outcome. */
  rng?: Rng;
  /** The server clock the pack allowance runs on; a test can fix it. */
  clock?: () => Date;
}

/** Request bodies here are a few hundred bytes; anything near this is not a client we serve. */
const BODY_LIMIT_BYTES = 64 * 1024;
const CONNECTION_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

type ClientError = { statusCode: number } & ErrorEnvelope["error"];

const CLIENT_ERRORS: Record<string, ClientError> = {
  HPE_HEADER_OVERFLOW: {
    statusCode: 431,
    code: "header_too_large",
    message: "Request headers are too large",
  },
  ERR_HTTP_REQUEST_TIMEOUT: { statusCode: 408, code: "bad_request", message: "Request timed out" },
};
const MALFORMED_REQUEST: ClientError = { statusCode: 400, code: "bad_request", message: "Malformed request" };

/**
 * Requests Node's parser refuses (oversized headers, a malformed request
 * line) never reach the router or the error plugin, so the envelope and the
 * api's headers are written by hand here. Mirrors Fastify's default in how
 * it treats the socket; only the body and headers differ.
 */
function clientErrorHandler(logger: Logger) {
  return (err: NodeJS.ErrnoException, socket: Socket): void => {
    if (err.code === "ECONNRESET" || socket.destroyed) return;
    const { statusCode, code, message } = CLIENT_ERRORS[err.code ?? ""] ?? MALFORMED_REQUEST;
    const payload = JSON.stringify({ error: { code, message } } satisfies ErrorEnvelope);
    logger.trace({ err }, "client error");
    if (socket.writable) {
      socket.write(
        `HTTP/1.1 ${statusCode} ${STATUS_CODES[statusCode] ?? ""}\r\n` +
          "Content-Type: application/json; charset=utf-8\r\n" +
          "Cache-Control: no-store\r\n" +
          "X-Content-Type-Options: nosniff\r\n" +
          `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
          "Connection: close\r\n\r\n" +
          payload,
      );
    }
    socket.destroy(err);
  };
}

/** Wires plugins and routes; never listens, never touches the network, so tests can `inject()`. */
export async function buildApp({
  config,
  db,
  logger = createLogger("silent"),
  connectionTimeout = CONNECTION_TIMEOUT_MS,
  requestTimeout = REQUEST_TIMEOUT_MS,
  rng = cryptoRng,
  clock = () => new Date(),
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
    clientErrorHandler: clientErrorHandler(logger),
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(dbPlugin, { db });
  await app.register(securityPlugin, { config });
  await app.register(sessionPlugin, { config });
  await app.register(accountsPlugin, { config });
  await app.register(packsPlugin, { rng, clock });
  await app.register(economyPlugin, { rng });
  await app.register(errorsPlugin);
  // Probed every 30 s by the image healthcheck: only failures are worth a line, unless the operator asked for less.
  await app.register(healthRoutes, { logLevel: quieterOf(config.LOG_LEVEL, "warn") });
  await app.register(sessionRoutes, { prefix: "/api" });
  await app.register(accountRoutes, { prefix: "/api" });
  await app.register(packRoutes, { prefix: "/api" });
  await app.register(collectionRoutes, { prefix: "/api" });
  await app.register(demoRoutes, { prefix: "/api" });
  await app.register(walletRoutes, { prefix: "/api" });
  await app.register(shopRoutes, { prefix: "/api" });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
