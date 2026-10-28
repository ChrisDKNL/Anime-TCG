import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Read `@anime-tcg/shared/*` from source so the tests never depend on a prior build.
    alias: [
      {
        find: /^@anime-tcg\/shared\/(.+)$/,
        replacement: fileURLToPath(new URL("../shared/src/$1.ts", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "html"],
      reportOnFailure: true,
      // Spec §8: at least 85 % of api/src statements; `npm run test:coverage -w api` fails below it.
      thresholds: { statements: 85 },
    },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts"] },
      },
      {
        // Needs a real Postgres (DATABASE_URL, or the compose `test` profile's defaults). Files share one
        // `sessions` table and truncate it, so they run one at a time.
        extends: true,
        test: {
          name: "routes",
          include: ["test/**/*.test.ts"],
          globalSetup: ["./test/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 15_000,
          hookTimeout: 15_000,
        },
      },
    ],
  },
});
