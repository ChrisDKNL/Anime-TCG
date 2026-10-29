import { DrizzleQueryError } from "drizzle-orm";
import { type DestinationStream, type Logger, pino } from "pino";
import type { LogLevel } from "../config.js";

/**
 * Keys whose values never belong in a log line, wherever pino finds them in
 * the first three levels of a logged object. Cookies and Authorization carry
 * credentials; the next five are the fields of the account request bodies
 * (shared/src/api.ts) and the column a logged account row would carry;
 * `secret`/`token` and the config names cover a logged config or env object
 * (`INVITE_CODES` is a list of secrets like `SESSION_SECRET` is one).
 * Redaction is by exact key, so every new credential field is added here.
 */
const SENSITIVE_KEYS = [
  "password",
  "currentPassword",
  "newPassword",
  "inviteCode",
  "inviteCodes",
  "passwordHash",
  "secret",
  "token",
  "SESSION_SECRET",
  "INVITE_CODES",
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

const STACK_FRAME = /^\s+at /;

/**
 * drizzle's DrizzleQueryError carries the failed statement's parameters, as
 * an enumerable `params` array and inside its message ("Failed query: <sql>
 * params: <values>") and therefore its stack. For an accounts insert or a
 * rehash those values are a password hash and the invite digest, so only the
 * first line of the message (the statement, with `$n` placeholders), the
 * frames and the driver's cause survive. Every other error is serialised as
 * pino does by default.
 */
function serializeError(err: Error): object {
  if (!(err instanceof DrizzleQueryError)) return pino.stdSerializers.err(err);
  const [statement = ""] = err.message.split("\n");
  const frames = (err.stack ?? "").split("\n").filter((line) => STACK_FRAME.test(line));
  // The class leaves `name` at "Error"; the constructor's name is what pino's own serializer would report.
  const type = DrizzleQueryError.name;
  return {
    type,
    message: statement,
    stack: [`${type}: ${statement}`, ...frames].join("\n"),
    ...(err.cause instanceof Error ? { cause: pino.stdSerializers.err(err.cause) } : {}),
  };
}

/** JSON lines with the pid but not the hostname: a container id tells an attacker more than it tells us. */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { pid: process.pid },
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
      serializers: { err: serializeError },
    },
    destination,
  );
}
