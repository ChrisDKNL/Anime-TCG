import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// Resolved next to this module so it works from src/ (tsx, tests) and from
// dist/ (the image), where the build copies the SQL alongside the JS.
const migrationsFolder = fileURLToPath(new URL("./migrations/", import.meta.url));

/**
 * Applies pending migrations over one dedicated connection as the database
 * owner (`MIGRATIONS_DATABASE_URL`), closed before this resolves. The app
 * pool never sees these credentials: it runs as `anime_app`, which cannot
 * create or alter anything.
 */
export async function runMigrations(ownerConnectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerConnectionString });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
