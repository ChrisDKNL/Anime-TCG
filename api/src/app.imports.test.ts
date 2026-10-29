import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { parseConfig } from "./config.js";
import { createDb } from "./db/client.js";

const srcDir = new URL("./", import.meta.url);

/** Every module under src/ that `entry` reaches through relative imports. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(new URL(file, srcDir), "utf8");
    for (const [, specifier] of text.matchAll(/(?:from|import)\s+"(\.{1,2}\/[^"]+)"/g)) {
      if (specifier === undefined) continue;
      const resolved = new URL(specifier.replace(/\.js$/, ".ts"), new URL(file, srcDir));
      pending.push(resolved.href.slice(srcDir.href.length));
    }
  }
  return seen;
}

/**
 * collection-packs.md §5.1.9: the snapshot command is the only outbound call
 * the system makes, and the api server process holds no AniList client.
 */
describe("the api server and AniList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never imports the AniList client, the fetch or a CLI from buildApp or the server entry", () => {
    for (const entry of ["app.ts", "server.ts"]) {
      const modules = [...reachable(entry)];
      expect(modules).toContain("domain/packs/service.ts");
      expect(
        modules.filter((file) => /^(domain\/pool\/(anilist|fetch|queries)\.ts|cli\/)/.test(file)),
      ).toEqual([]);
    }
  });

  it("sends no outbound request while building and answering", async () => {
    const outbound = vi.spyOn(globalThis, "fetch");
    const config = parseConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgres://anime_app:x@127.0.0.1:1/anime",
      MIGRATIONS_DATABASE_URL: "postgres://anime:x@127.0.0.1:1/anime",
      SESSION_SECRET: "unit-test-session-secret-not-for-real-use-0123456789",
      API_ORIGIN: "http://localhost:3000",
      WEB_ORIGIN: "http://localhost:5173",
      INVITE_CODES: "",
    });
    const app = await buildApp({ config, db: createDb(config.DATABASE_URL) });
    try {
      for (const url of ["/api/packs", "/api/collection"]) {
        expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      }
    } finally {
      await app.close();
    }
    expect(outbound).not.toHaveBeenCalled();
  });
});
