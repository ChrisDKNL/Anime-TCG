import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

/** Bounded so a dead database turns into a 503 from /healthz instead of a hang. */
const CONNECT_TIMEOUT_MS = 3_000;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
