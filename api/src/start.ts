import type { Logger } from "pino";
import { type App, buildApp } from "./app.js";
import type { Config } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

/** How long in-flight requests get after SIGTERM before the process gives up waiting. */
export const DRAIN_TIMEOUT_MS = 10_000;

export interface RunningServer {
  app: App;
  /** Stops accepting, drains in-flight requests, closes the pool. Resolves `true` when the drain finished in time. */
  shutdown(): Promise<boolean>;
}

/** Migrates, builds and listens. Everything the process does, minus reading the environment and handling signals. */
export async function startServer(config: Config, logger: Logger): Promise<RunningServer> {
  const db = createDb(config.DATABASE_URL);
  const app = await buildApp({ config, db, logger });
  await runMigrations(config.MIGRATIONS_DATABASE_URL);
  app.log.info("migrations applied");
  await app.listen({ host: config.HOST, port: config.PORT });

  return {
    app,
    shutdown: () =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          app.log.warn(
            { drainTimeoutMs: DRAIN_TIMEOUT_MS },
            "drain timed out; exiting with connections open",
          );
          resolve(false);
        }, DRAIN_TIMEOUT_MS);
        void app.close().then(() => {
          clearTimeout(timer);
          resolve(true);
        });
      }),
  };
}
