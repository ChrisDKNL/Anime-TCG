import { type DestinationStream, type Logger, pino } from "pino";
import type { LogLevel } from "../config.js";

/**
 * Keys whose values never belong in a log line, wherever pino finds them in
 * the first three levels of a logged object. Cookies and Authorization carry
 * credentials; `password`/`secret`/`token` are what a future account payload
 * would use; the config names cover a logged config or env object.
 */
const SENSITIVE_KEYS = [
  "password",
  "secret",
  "token",
  "SESSION_SECRET",
  "DATABASE_URL",
  "MIGRATIONS_DATABASE_URL",
];

export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "res.headers.set-cookie",
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

/** Higher means fewer lines; pino's own numeric levels, with `silent` above everything. */
const QUIETNESS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 70,
};

/** The more restrictive of two levels, so a per-route quieting never overrides an operator's `LOG_LEVEL=error`. */
export function quieterOf(a: LogLevel, b: LogLevel): LogLevel {
  return QUIETNESS[a] >= QUIETNESS[b] ? a : b;
}

/** JSON lines with the pid but not the hostname: a container id tells an attacker more than it tells us. */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    { level, base: { pid: process.pid }, redact: { paths: REDACT_PATHS, censor: "[redacted]" } },
    destination,
  );
}
