import fp from "fastify-plugin";
import type { Db } from "../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

export interface DbPluginOptions {
  db: Db;
}

/** Owns the pool for the app's lifetime: logs idle-client errors instead of crashing, ends it on close. */
export const dbPlugin = fp<DbPluginOptions>(
  async (app, { db }) => {
    app.decorate("db", db);
    db.$client.on("error", (err) => app.log.error({ err }, "idle database client error"));
    app.addHook("onClose", async () => {
      await db.$client.end();
    });
  },
  { name: "db" },
);
