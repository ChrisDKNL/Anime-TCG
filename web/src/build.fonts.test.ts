import { dirname, join } from "node:path";
import { build, type Rollup } from "vite";
import { describe, expect, it } from "vitest";

/**
 * The production build's fonts (docs/design/visual-identity.md §4.1), from a real `vite build` held in
 * memory. The e2e suite runs against the dev server, which never inlines an asset, so only the build
 * shows what Caddy will serve.
 *
 * - Every `@font-face` source is a file under `/assets`: the CSP's `font-src 'self'` refuses a `data:`
 *   font (`Caddyfile`), so an inlined subset is a console error on every page and a face that never
 *   loads. Vite inlines any asset under 4 KB unless told not to; Martian Mono's cyrillic-ext file is.
 * - Each family's latin file is emitted, and `licenses/fonts.txt` holds the three OFL texts.
 */

async function buildInMemory(): Promise<Rollup.OutputBundle[number][]> {
  // This file's own path: jsdom gives `import.meta.url` no file scheme. `web/` is the folder above `src/`.
  const root = dirname(dirname(expect.getState().testPath!));
  const result = await build({
    root,
    configFile: join(root, "vite.config.ts"),
    logLevel: "silent",
    build: { write: false },
  });
  const outputs = Array.isArray(result) ? result : [result as Rollup.RollupOutput];
  return outputs.flatMap((output) => output.output);
}

describe("the production build's fonts (§4.1)", () => {
  it("serves every @font-face from /assets, none inlined as data:, and ships the licences", async () => {
    const files = await buildInMemory();
    const css = files
      .filter((file) => file.fileName.endsWith(".css") && file.type === "asset")
      .map((file) => String((file as Rollup.OutputAsset).source))
      .join("\n");
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces.length).toBeGreaterThanOrEqual(9);

    const inlined = faces.flatMap((face) => {
      if (!/url\(\s*["']?data:/.test(face)) return [];
      const family = /font-family:\s*([^;]+)/.exec(face)?.[1] ?? "?";
      const range = /unicode-range:\s*([^;}]+)/.exec(face)?.[1] ?? "?";
      return [`${family} (${range.slice(0, 30)}…)`];
    });
    expect(inlined, "faces the CSP's font-src 'self' will refuse").toEqual([]);

    const sources = faces.map((face) => /url\(\s*["']?([^"')]+)/.exec(face)?.[1] ?? "");
    for (const source of sources) expect(source).toMatch(/^\/assets\/[^/]+\.woff2$/);

    const names = files.map((file) => file.fileName);
    for (const latin of [
      /^assets\/bricolage-grotesque-latin-wdth-normal-[\w-]+\.woff2$/,
      /^assets\/figtree-latin-wght-normal-[\w-]+\.woff2$/,
      /^assets\/martian-mono-latin-wght-normal-[\w-]+\.woff2$/,
    ]) {
      expect(names).toContainEqual(expect.stringMatching(latin));
    }
    const licences = files.find((file) => file.fileName === "licenses/fonts.txt") as Rollup.OutputAsset;
    expect(licences).toBeDefined();
    expect(String(licences.source).match(/SIL OPEN FONT LICENSE Version 1\.1/g)).toHaveLength(3);
  }, 60_000);
});
