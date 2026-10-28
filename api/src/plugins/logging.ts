import { type DestinationStream, type Logger, pino } from "pino";
import type { LogLevel } from "../config.js";

/**
 * Keys whose values never belong in a log line, wherever pino finds them in
 * the first three levels of a logged object. Cookies and Authorization carry
 * credentials; `password`/`secret`/`token` are what a future account payload
 * would use; the two config names cover a logged config or env object.
 */
const SENSITIVE_KEYS = ["password", "secret", "token", "SESSION_SECRET", "DATABASE_URL"];

export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "res.headers.set-cookie",
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

/** JSON lines with the pid but not the hostname: a container id tells an attacker more than it tells us. */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    { level, base: { pid: process.pid }, redact: { paths: REDACT_PATHS, censor: "[redacted]" } },
    destination,
  );
}
