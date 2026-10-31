import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/** The self-hosted fonts (docs/design/visual-identity.md §4.1); main.tsx imports their CSS. */
const FONT_PACKAGES = [
  "@fontsource-variable/bricolage-grotesque",
  "@fontsource-variable/figtree",
  "@fontsource-variable/martian-mono",
] as const;

/** Where the footer links to (§11.1). */
const PUBLIC_PATH = "/licenses/fonts.txt";

/** Each package's own LICENSE file, read from the installed package, so a Dependabot update carries its licence along. */
function fontLicences(): string {
  const require = createRequire(import.meta.url);
  return FONT_PACKAGES.map((name) => {
    const text = readFileSync(require.resolve(`${name}/LICENSE`), "utf8").trim();
    return `${name}\n\n${text}\n`;
  }).join(`\n${"=".repeat(72)}\n\n`);
}

/**
 * The OFL (§2) wants the licence to travel with the fonts: the build writes the three LICENSE files into
 * one `/licenses/fonts.txt`, and the dev server answers the same path, so the footer's link works in both.
 */
export function fontLicensesPlugin(): Plugin {
  return {
    name: "anime-tcg:font-licenses",
    configureServer(server) {
      server.middlewares.use(PUBLIC_PATH, (_request, response) => {
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end(fontLicences());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: PUBLIC_PATH.slice(1), source: fontLicences() });
    },
  };
}
