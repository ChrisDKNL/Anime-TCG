import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** The placeholder shipped in `api/.env.example`; the api refuses to run with it. */
export const EXAMPLE_SESSION_SECRET = "replace-with-32-plus-random-bytes-see-api/.env.example";
export const MIN_SESSION_SECRET_BYTES = 32;

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const Origin = Type.String({ pattern: "^https?://[^/\\s]+$" });

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
    PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
    DATABASE_URL: Type.String({ pattern: "^postgres(ql)?://" }),
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
  return Object.freeze(candidate);
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
