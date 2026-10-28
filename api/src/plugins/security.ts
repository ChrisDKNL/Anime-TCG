import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { Config } from "../config.js";
import { needsOriginCheck, originAllowed } from "../domain/csrf.js";
import { ApiError } from "../domain/errors.js";

export interface SecurityPluginOptions {
  config: Config;
}

type RouteLimiter = ReturnType<FastifyInstance["rateLimit"]>;

/**
 * Where a route's own limiter is kept once `onRoute` has built it from the
 * route's `config.rateLimit`. A symbol rather than a named field so route
 * authors cannot hand one in through `config`.
 */
export const routeLimiter: unique symbol = Symbol("security.routeLimiter");

declare module "fastify" {
  interface FastifyContextConfig {
    [routeLimiter]?: RouteLimiter;
  }
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
    // reaches the database.
    //
    // A route with its own `config.rateLimit` object (auth in 1b) is limited
    // by that object instead of the global bucket, never by both: the plugin
    // keys on one per-request "already ran" marker, so whichever limiter
    // runs first for a request is the only one that counts, and the hook
    // below runs before the route-level one the plugin still attaches. That
    // is why the override's limiter is built per route in `onRoute` and
    // chosen here, rather than left to the plugin, which would run it after
    // CSRF and the session lookup.
    await app.register(rateLimit, {
      global: false,
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW_MS,
      errorResponseBuilder: () => new ApiError(429, "rate_limited", "Too many requests; slow down"),
    });
    const globalLimiter = app.rateLimit();
    app.addHook("onRoute", (routeOptions) => {
      const override = routeOptions.config?.rateLimit;
      if (override === null || typeof override !== "object" || routeOptions.config === undefined) {
        return;
      }
      // `app.rateLimit(options)` merges `options` over the global settings
      // (same key generator and error envelope) and gives it a child store,
      // so the bucket is the route's own.
      routeOptions.config[routeLimiter] = app.rateLimit(override);
    });
    app.addHook("onRequest", async (req, reply) => {
      const routeConfig = req.routeOptions.config;
      if (routeConfig.rateLimit === false) return;
      await (routeConfig[routeLimiter] ?? globalLimiter).call(app, req, reply);
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
