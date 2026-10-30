import fp from "fastify-plugin";
import { CollectionService } from "../domain/collection/service.js";
import { DemoService } from "../domain/demo/service.js";
import { PackService } from "../domain/packs/service.js";
import type { Rng } from "../domain/packs/rng.js";
import { TierPoolCache } from "../domain/pool/catalog.js";

declare module "fastify" {
  interface FastifyInstance {
    packs: PackService;
    collection: CollectionService;
    /** The landing page's public demo: reads the current snapshot only. */
    demo: DemoService;
    /** The server clock the pack allowance runs on (collection-packs.md §5.2); the client's time is never read. */
    clock: () => Date;
  }
}

export interface PacksPluginOptions {
  rng: Rng;
  clock: () => Date;
}

/**
 * Owns the pack, collection and demo services. The pool they read is the
 * owner's snapshot: no AniList client lives here. Packs and the demo roll on
 * one generator and one copy of the snapshot's tier lists.
 */
export const packsPlugin = fp<PacksPluginOptions>(
  async (app, { rng, clock }) => {
    const pools = new TierPoolCache();
    app.decorate("packs", new PackService(app.db, rng, pools));
    app.decorate("collection", new CollectionService(app.db));
    app.decorate("demo", new DemoService(app.db, rng, pools));
    app.decorate("clock", clock);
  },
  { name: "packs", dependencies: ["db"] },
);
