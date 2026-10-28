import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/plugins/logging.js";
import { type RunningServer, startServer } from "../src/start.js";
import { testConfig } from "./support.js";

describe("startServer", () => {
  let running: RunningServer | undefined;
  afterEach(async () => {
    await running?.shutdown();
    running = undefined;
  });

  it("migrates, listens on the configured host and port, and serves the api", async () => {
    running = await startServer(testConfig({ HOST: "127.0.0.1", PORT: "0" }), createLogger("silent"));
    const [address] = running.app.addresses();
    expect(address?.address).toBe("127.0.0.1");
    const res = await fetch(`http://127.0.0.1:${address?.port}/api/session`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: false });
  });

  it("shutdown drains, ends the pool and reports success", async () => {
    running = await startServer(testConfig({ HOST: "127.0.0.1", PORT: "0" }), createLogger("silent"));
    const server = running;
    running = undefined;
    const [address] = server.app.addresses();
    expect(await server.shutdown()).toBe(true);
    expect(server.app.db.$client.ended).toBe(true);
    await expect(fetch(`http://127.0.0.1:${address?.port}/healthz`)).rejects.toThrow();
  });
});
