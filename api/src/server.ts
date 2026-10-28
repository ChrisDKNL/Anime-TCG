import { type Config, ConfigError, parseConfig } from "./config.js";
import { createLogger } from "./plugins/logging.js";
import { startServer } from "./start.js";

// The only module that reads the environment, listens on a port and talks to
// the process: everything else takes what it needs as arguments.

function loadConfig(): Config {
  try {
    return parseConfig(process.env);
  } catch (err) {
    const log = createLogger("info");
    if (err instanceof ConfigError) log.fatal({ variable: err.variable }, err.message);
    else log.fatal({ err }, "configuration could not be read");
    process.exit(1);
  }
}

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const server = await startServer(config, logger);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    logger.info({ signal }, "shutting down");
    // A drain that timed out dropped connections; exit non-zero so the supervisor can tell.
    void server.shutdown().then((drained) => process.exit(drained ? 0 : 1));
  });
}
