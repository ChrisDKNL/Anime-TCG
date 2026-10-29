import { defineConfig, devices } from "@playwright/test";

// Vite's default port. Override it with E2E_PORT when something else already answers on it: with
// reuseExistingServer, Playwright would otherwise run the whole suite against that other server. On the
// owner's station a homelab container holds 127.0.0.1:5173, so run e.g. `E2E_PORT=5174 npm run test:e2e -w web`.
const PORT = Number(process.env.E2E_PORT ?? 5173);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
