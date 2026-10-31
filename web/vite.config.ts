import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fontLicensesPlugin } from "./font-licenses.ts";
import { sharedSourceAlias } from "./shared-alias.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), fontLicensesPlugin()],
  resolve: { alias: [sharedSourceAlias] },
  // One origin in development too: the browser talks to Vite, Vite forwards /api to `npm run dev -w api`.
  server: { proxy: { "/api": "http://localhost:3000" } },
});
