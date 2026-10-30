import fp from "fastify-plugin";
import { MarketService } from "../domain/market/service.js";
import { PURGE_INTERVAL_MS } from "../domain/session/policy.js";

declare module "fastify" {
  interface FastifyInstance {
    market: MarketService;
  }
}

/**
 * Owns the player market (economy.md §8.3 to §8.5) and its hourly sweep,
 * on the session purge's cadence, which marks lapsed listings expired.
 * Expiry itself is a property of time: every read treats a lapsed listing
 * as expired whether or not the sweep has run, so the sweep only tidies.
 */
export const marketPlugin = fp(
  async (app) => {
    const market = new MarketService(app.db);
    app.decorate("market", market);

    let purgeTimer: NodeJS.Timeout | undefined;
    const purge = async () => {
      try {
        const expired = await market.expireLapsed(app.log, app.clock());
        app.log.info({ expired }, "lapsed listings expired");
      } catch (err) {
        // A failed sweep must not take the process down; the next tick retries, and reads never depend on it.
        app.log.error({ err }, "listing purge failed");
      }
    };
    app.addHook("onReady", async () => {
      purgeTimer = setInterval(() => void purge(), PURGE_INTERVAL_MS);
      purgeTimer.unref();
    });
    app.addHook("onClose", async () => {
      clearInterval(purgeTimer);
    });
  },
  { name: "market", dependencies: ["db", "packs"] },
);
