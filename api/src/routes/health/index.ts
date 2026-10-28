import { HealthResponse } from "@anime-tcg/shared/api";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { sql } from "drizzle-orm";

/** Liveness for the image healthcheck and compose. Not rate-limited, not under /api, says nothing about versions or hosts. */
export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/healthz",
    {
      schema: { response: { 200: HealthResponse, 503: HealthResponse } },
      config: { rateLimit: false },
      // Probed every 30 s by the image healthcheck; only failures are worth a line.
      logLevel: "warn",
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
