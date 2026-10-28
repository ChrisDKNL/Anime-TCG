import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";
import type { Config } from "../config.js";
import { needsOriginCheck, originAllowed } from "../domain/csrf.js";
import { ApiError } from "../domain/errors.js";

export interface SecurityPluginOptions {
  config: Config;
}

/**
 * Helmet, the rate limiter, the CSRF origin check and `Cache-Control: no-store`.
 * The site-wide headers (CSP, referrer policy, ...) are Caddy's job; the api
 * only adds what matters for JSON responses. CORS is deliberately absent: the
 * api is same-origin behind Caddy and behind Vite's dev proxy.
 */
export const securityPlugin = fp<SecurityPluginOptions>(
  async (app, { config }) => {
    await app.register(helmet, { contentSecurityPolicy: false, strictTransportSecurity: false });

    await app.register(rateLimit, {
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW_MS,
      errorResponseBuilder: () => new ApiError(429, "rate_limited", "Too many requests; slow down"),
    });

    // Registered after the limiter so a flood of rejected cross-site requests still counts.
    app.addHook("onRequest", async (req) => {
      if (needsOriginCheck(req.method) && !originAllowed(req.headers, config.WEB_ORIGIN)) {
        throw new ApiError(403, "bad_origin", "Cross-origin request rejected");
      }
    });

    app.addHook("onSend", async (_req, reply) => {
      reply.header("cache-control", "no-store");
    });
  },
  { name: "security" },
);
