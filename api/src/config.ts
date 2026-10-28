import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** The placeholder shipped in `api/.env.example`; the api refuses to run with it. */
export const EXAMPLE_SESSION_SECRET = "replace-with-32-plus-random-bytes-see-api/.env.example";
export const MIN_SESSION_SECRET_BYTES = 32;

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const Origin = Type.String({ pattern: "^https?://[^/\\s]+$" });
const PostgresUrl = Type.String({ pattern: "^postgres(ql)?://" });

const ConfigSchema = Type.Object(
  {
    NODE_ENV: Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")], {
      default: "production",
    }),
    LOG_LEVEL: Type.Union(
      LOG_LEVELS.map((level) => Type.Literal(level)),
      { default: "info" },
    ),
    HOST: Type.String({ minLength: 1, default: "127.0.0.1" }),
    // 0 lets the OS pick a free port, which the start-up test relies on.
    PORT: Type.Integer({ minimum: 0, maximum: 65535, default: 3000 }),
    /** The app role (`anime_app`, row access only): the pool every request runs on. */
    DATABASE_URL: PostgresUrl,
    /** The owner role (`anime`): one connection for `runMigrations` at start-up, closed afterwards. */
    MIGRATIONS_DATABASE_URL: PostgresUrl,
    SESSION_SECRET: Type.String(),
    API_ORIGIN: Origin,
    WEB_ORIGIN: Origin,
    RATE_LIMIT_MAX: Type.Integer({ minimum: 1, default: 100 }),
    RATE_LIMIT_WINDOW_MS: Type.Integer({ minimum: 1000, default: 60_000 }),
  },
  { additionalProperties: false },
);

export type Config = Readonly<Static<typeof ConfigSchema>>;

/** Names the offending variable and what is wrong with it; never its value. */
export class ConfigError extends Error {
  constructor(
    readonly variable: string,
    detail: string,
  ) {
    super(`${variable} ${detail}`);
    this.name = "ConfigError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `Value.Convert` is lenient with numeric strings ("3000.5" becomes 3000,
 * "1e3" becomes 1), so integers are checked as text first.
 */
const INTEGER_VARIABLES = ["PORT", "RATE_LIMIT_MAX", "RATE_LIMIT_WINDOW_MS"] as const;
const WHOLE_NUMBER = /^\d+$/;

/**
 * Builds the typed config from an environment map. Unknown variables are
 * ignored and empty strings count as unset, so a compose file that passes
 * `FOO=${FOO:-}` behaves like one that omits FOO.
 */
export function parseConfig(env: Env): Config {
  const present = Object.fromEntries(
    Object.keys(ConfigSchema.properties)
      .filter((name) => env[name] !== undefined && env[name] !== "")
      .map((name) => [name, env[name]]),
  );
  for (const name of INTEGER_VARIABLES) {
    const raw = present[name];
    if (raw !== undefined && !WHOLE_NUMBER.test(raw))
      throw new ConfigError(name, "must be a whole number (digits only)");
  }
  const candidate: unknown = Value.Default(ConfigSchema, Value.Convert(ConfigSchema, present));
  if (!Value.Check(ConfigSchema, candidate)) {
    const first = Value.Errors(ConfigSchema, candidate).First();
    throw new ConfigError(
      first?.path.slice(1) || "configuration",
      first?.message.toLowerCase() ?? "is invalid",
    );
  }
  assertStrongSessionSecret(candidate.SESSION_SECRET);
  assertExactOrigin("API_ORIGIN", candidate.API_ORIGIN);
  assertExactOrigin("WEB_ORIGIN", candidate.WEB_ORIGIN);
  assertDistinctDatabaseRoles(candidate.DATABASE_URL, candidate.MIGRATIONS_DATABASE_URL);
  return Object.freeze(candidate);
}

/** The user part of a `postgres://user:password@host/db` URL, before any decoding; empty when there is no userinfo. */
export function databaseUser(url: string): string {
  return /^postgres(?:ql)?:\/\/([^:@/?#]*)(?::[^@/?#]*)?@/.exec(url)?.[1] ?? "";
}

/**
 * The split in docs/design/accounts-api.md §4.1 only protects anything if the
 * two URLs really are two roles: the same name in both means every request
 * runs with the owner's rights and the migration grants are theatre.
 */
function assertDistinctDatabaseRoles(appUrl: string, migrationsUrl: string): void {
  const app = databaseUser(appUrl);
  const owner = databaseUser(migrationsUrl);
  if (app === "") throw new ConfigError("DATABASE_URL", "must name the app role (postgres://<role>:...)");
  if (owner === "") {
    throw new ConfigError("MIGRATIONS_DATABASE_URL", "must name the owner role (postgres://<role>:...)");
  }
  if (app === owner) {
    throw new ConfigError(
      "MIGRATIONS_DATABASE_URL",
      "must name a different role than DATABASE_URL (owner for migrations, app role for requests)",
    );
  }
}

function assertStrongSessionSecret(secret: string): void {
  if (Buffer.byteLength(secret) < MIN_SESSION_SECRET_BYTES) {
    throw new ConfigError("SESSION_SECRET", `must be at least ${MIN_SESSION_SECRET_BYTES} bytes`);
  }
  if (secret === EXAMPLE_SESSION_SECRET) {
    throw new ConfigError("SESSION_SECRET", "is the placeholder from .env.example; generate a real one");
  }
}

/**
 * An origin is compared byte for byte against the browser's `Origin` header,
 * which never carries a path, a trailing slash or a default port, so the
 * configured value must not either.
 */
function assertExactOrigin(variable: string, value: string): void {
  if (!URL.canParse(value) || new URL(value).origin !== value) {
    throw new ConfigError(
      variable,
      "must be a bare origin such as https://example.com (no path, no default port)",
    );
  }
}
