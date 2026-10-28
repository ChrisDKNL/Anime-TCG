import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";

// Resolved next to this module so it works from src/ (tsx, tests) and from
// dist/ (the image), where the build copies the SQL alongside the JS.
const migrationsFolder = fileURLToPath(new URL("./migrations/", import.meta.url));

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}
