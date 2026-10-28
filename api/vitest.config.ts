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
    },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts"] },
      },
    ],
  },
});
