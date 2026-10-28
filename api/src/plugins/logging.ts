import { type DestinationStream, type Logger, pino } from "pino";
import type { LogLevel } from "../config.js";

/**
 * Keys whose values never belong in a log line, wherever pino finds them in
 * the first three levels of a logged object. Cookies and Authorization carry
 * credentials; the named keys are what a future account payload would use.
 */
export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "res.headers.set-cookie",
  "password",
  "secret",
  "token",
  "*.password",
  "*.secret",
  "*.token",
  "*.*.password",
  "*.*.secret",
  "*.*.token",
];

/** JSON lines with the pid but not the hostname: a container id tells an attacker more than it tells us. */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    { level, base: { pid: process.pid }, redact: { paths: REDACT_PATHS, censor: "[redacted]" } },
    destination,
  );
}
