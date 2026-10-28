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

    // `global: false` keeps the plugin from attaching itself per route; the
    // limiter is mounted once here, as the first instance-wide hook, so the
    // order for every request, unknown routes included, is rate limit, then
    // CSRF, then the session lookup: a flood of rejected cross-site requests
    // still spends the quota, and a request that CSRF will reject never
    // reaches the database. Routes carrying their own `config.rateLimit`
    // (auth in 1b) get a second, tighter bucket from the plugin on top.
    await app.register(rateLimit, {
      global: false,
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW_MS,
      errorResponseBuilder: () => new ApiError(429, "rate_limited", "Too many requests; slow down"),
    });
    const limiter = app.rateLimit();
    app.addHook("onRequest", async (req, reply) => {
      if (req.routeOptions.config.rateLimit === false) return;
      await limiter.call(app, req, reply);
    });

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
