import { connect } from "node:net";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/plugins/logging.js";
import { DRAIN_TIMEOUT_MS, type RunningServer, startServer } from "../src/start.js";
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

describe("startServer drain timeout", () => {
  it("gives up after DRAIN_TIMEOUT_MS when an in-flight request will not finish: resolves false and warns", async () => {
    const logged: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logged.push(chunk.toString());
        done();
      },
    });
    const server = await startServer(
      testConfig({ HOST: "127.0.0.1", PORT: "0" }),
      createLogger("warn", sink),
    );
    const [address] = server.app.addresses();

    // A request whose body never completes keeps its connection active, so `app.close()` waits for it.
    const socket = connect(address?.port ?? 0, "127.0.0.1");
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write("POST /api/session HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nabc");
    // The 403 proves the server has this request in flight before the shutdown starts.
    const first = await new Promise<string>((resolve) =>
      socket.once("data", (chunk: Buffer) => resolve(chunk.toString())),
    );
    expect(first.startsWith("HTTP/1.1 403")).toBe(true);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const shutdown = server.shutdown();
      await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS - 1);
      expect(server.app.db.$client.ended).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await shutdown).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    const warning = logged
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.level === 40);
    expect(warning).toMatchObject({
      drainTimeoutMs: DRAIN_TIMEOUT_MS,
      msg: "drain timed out; exiting with connections open",
    });

    // Once the stuck client goes away the close that was started completes and the pool ends.
    socket.destroy();
    await vi.waitFor(() => expect(server.app.db.$client.ended).toBe(true));
  });
});
