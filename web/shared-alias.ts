import { fileURLToPath } from "node:url";

/**
 * Vite and Vitest read `@anime-tcg/shared/*` straight from its TypeScript
 * source, so neither the dev server nor the unit tests depend on `shared/dist`
 * having been built. `tsc` keeps resolving the package through its `exports`
 * (and builds it first via the project reference), which is what checks the
 * contract.
 */
export const sharedSourceAlias = {
  find: /^@anime-tcg\/shared\/(.+)$/,
  replacement: `${fileURLToPath(new URL("../shared/src/", import.meta.url))}$1.ts`,
};
