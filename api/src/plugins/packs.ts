import fp from "fastify-plugin";
import { CollectionService } from "../domain/collection/service.js";
import { PackService } from "../domain/packs/service.js";
import type { Rng } from "../domain/packs/rng.js";

declare module "fastify" {
  interface FastifyInstance {
    packs: PackService;
    collection: CollectionService;
    /** The server clock the pack allowance runs on (collection-packs.md §5.2); the client's time is never read. */
    clock: () => Date;
  }
}

export interface PacksPluginOptions {
  rng: Rng;
  clock: () => Date;
}

/** Owns the pack and collection services. The pool they read is the owner's snapshot: no AniList client lives here. */
export const packsPlugin = fp<PacksPluginOptions>(
  async (app, { rng, clock }) => {
    app.decorate("packs", new PackService(app.db, rng));
    app.decorate("collection", new CollectionService(app.db));
    app.decorate("clock", clock);
  },
  { name: "packs", dependencies: ["db"] },
);
