import { runMigrations } from "../src/db/migrate.js";
import { migrationsDatabaseUrl } from "./support.js";

/** Runs once per `vitest run`, as the owner: the route tests assume the schema and grants are current. */
export default async function setup(): Promise<void> {
  await runMigrations(migrationsDatabaseUrl());
}
