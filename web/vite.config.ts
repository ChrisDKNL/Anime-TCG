import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sharedSourceAlias } from "./shared-alias.ts";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: [sharedSourceAlias] },
});
