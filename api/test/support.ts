import { Type } from "@sinclair/typebox";
import { type App, type BuildAppOptions, buildApp } from "../src/app.js";
import { type Config, parseConfig } from "../src/config.js";
import { createDb, type Db } from "../src/db/client.js";
import { sessions } from "../src/db/schema.js";

/** Obviously fake; only has to be 32+ bytes and not the .env.example placeholder. */
export const TEST_SESSION_SECRET = "route-test-session-secret-not-for-real-use-0123456789";
export const WEB_ORIGIN = "http://localhost:5173";
export const FOREIGN_ORIGIN = "http://evil.example";

/** The app role, as the api runs it. CI points this at its service container; locally the compose `test` profile. */
export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://anime_app:anime_app@127.0.0.1:5432/anime";
}

/** The owner role: migrations and anything a test must read that the app role is not granted. */
export function migrationsDatabaseUrl(): string {
  return process.env.MIGRATIONS_DATABASE_URL ?? "postgres://anime:anime@127.0.0.1:5432/anime";
}

export function testConfig(overrides: Partial<Record<keyof Config, string>> = {}): Config {
  return parseConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: testDatabaseUrl(),
    MIGRATIONS_DATABASE_URL: migrationsDatabaseUrl(),
    SESSION_SECRET: TEST_SESSION_SECRET,
    API_ORIGIN: "http://localhost:3000",
    WEB_ORIGIN,
    ...overrides,
  });
}

export interface TestAppOptions extends Partial<Omit<BuildAppOptions, "config" | "db">> {
  config?: Config;
  db?: Db;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<App> {
  const { config = testConfig(), db = createDb(config.DATABASE_URL), ...rest } = options;
  return buildApp({ config, db, ...rest });
}

/** DELETE rather than TRUNCATE: the app role has row access only, so the cleanup runs on the same pool the app uses. */
export async function clearSessions(db: Db): Promise<void> {
  await db.delete(sessions);
}

const EchoBody = Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false });
const EchoReply = Type.Object({ name: Type.String() }, { additionalProperties: false });
const SessionProbe = Type.Object(
  {
    session: Type.Union([
      Type.Null(),
      Type.Object({ id: Type.String(), accountId: Type.Union([Type.String(), Type.Null()]) }),
    ]),
  },
  { additionalProperties: false },
);

/**
 * Routes that exist only in tests, so the cross-cutting behaviour (schemas,
 * CSRF, sessions, error mapping) can be exercised before 1b adds real ones.
 */
export function registerProbeRoutes(app: App): void {
  app.post("/test/echo", { schema: { body: EchoBody, response: { 200: EchoReply } } }, (req) => ({
    name: req.body.name,
  }));
  app.post("/test/sessions", { schema: { response: { 200: SessionProbe } } }, async (_req, reply) => {
    const session = await reply.createSession(null);
    return { session: { id: session.id, accountId: session.accountId } };
  });
  app.delete("/test/sessions", { schema: { response: { 200: SessionProbe } } }, async (_req, reply) => {
    await reply.destroySession();
    return { session: null };
  });
  app.get("/test/whoami", { schema: { response: { 200: SessionProbe } } }, (req) => ({
    session: req.session ? { id: req.session.id, accountId: req.session.accountId } : null,
  }));
  app.get("/test/boom", () => {
    throw new Error("connection to postgres://anime:hunter2@db failed");
  });
}

/** The cookie value out of a `Set-Cookie` line, or undefined when the line clears it. */
export function sessionCookieFrom(setCookie: string | string[] | undefined): string | undefined {
  const lines = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  const line = lines.find((entry) => entry.startsWith("__Host-session="));
  if (line === undefined || /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(line)) return undefined;
  return line.slice("__Host-session=".length).split(";")[0];
}

export function cookieHeader(value: string): string {
  return `__Host-session=${value}`;
}
