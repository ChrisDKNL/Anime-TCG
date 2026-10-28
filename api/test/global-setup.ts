import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { testDatabaseUrl } from "./support.js";

/** Runs once per `vitest run`: the route tests assume the schema is current. */
export default async function setup(): Promise<void> {
  const db = createDb(testDatabaseUrl());
  await runMigrations(db);
  await db.$client.end();
}
