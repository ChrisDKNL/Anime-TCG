import fp from "fastify-plugin";
import { EconomyService } from "../domain/economy/service.js";
import { ShopService } from "../domain/economy/shop.js";
import type { Rng } from "../domain/packs/rng.js";

declare module "fastify" {
  interface FastifyInstance {
    economy: EconomyService;
    shop: ShopService;
  }
}

export interface EconomyPluginOptions {
  rng: Rng;
}

/** Owns the wallet, recycling and the Karma shop (economy.md). The shop deals packs with the same generator as the timer. */
export const economyPlugin = fp<EconomyPluginOptions>(
  async (app, { rng }) => {
    app.decorate("economy", new EconomyService(app.db));
    app.decorate("shop", new ShopService(app.db, rng));
  },
  { name: "economy", dependencies: ["db"] },
);
