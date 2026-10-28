import { HealthResponse } from "@anime-tcg/shared/api";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { sql } from "drizzle-orm";
import type { LogLevel } from "../../config.js";
import { NoQuery } from "../schemas.js";

/** Liveness for the image healthcheck and compose. Not rate-limited, not under /api, says nothing about versions or hosts. */
export const healthRoutes: FastifyPluginAsyncTypebox<{ logLevel: LogLevel }> = async (app, { logLevel }) => {
  app.get(
    "/healthz",
    {
      schema: { querystring: NoQuery, response: { 200: HealthResponse, 503: HealthResponse } },
      config: { rateLimit: false },
      logLevel,
    },
    async (req, reply) => {
      try {
        await app.db.execute(sql`select 1`);
      } catch (err) {
        req.log.warn({ err }, "database health check failed");
        return reply.code(503).send({ status: "down", db: "down" } satisfies HealthResponse);
      }
      return { status: "ok", db: "ok" } satisfies HealthResponse;
    },
  );
};
