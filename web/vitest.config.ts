import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { sharedSourceAlias } from "./shared-alias.ts";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [sharedSourceAlias] },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/test/**", "src/**/*.test.{ts,tsx}"],
      reporter: ["text", "html"],
    },
  },
});
