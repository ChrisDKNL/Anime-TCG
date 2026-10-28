import { defineConfig } from "drizzle-kit";

// `npm run db:generate -w api` diffs src/db/schema.ts against the committed
// SQL and writes the next migration; it never talks to a database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
});
