import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { createTestApp } from "../support.js";

/**
 * T3: requests Node's HTTP parser refuses (oversized headers, a malformed
 * request line) never reach Fastify's router or the error plugin; Node emits
 * `clientError` and whatever handles that writes the response by hand. The
 * spec (docs/design/backend-foundation.md §5, "Errors") promises one envelope
 * for every non-2xx response and `Cache-Control: no-store` on every response,
 * and `shared/src/errors.ts` types `error` as an object, so these paths have to
 * keep that promise too.
 *
 * KNOWN FAILING on feat/backend-foundation (found 2026-10-28 by the tester):
 * `buildApp` leaves Fastify's default `clientErrorHandler` in place, which
 * answers `{"error":"Request Header Fields Too Large","message":...,"statusCode":431}`
 * (a string `error`, no `code`) with no `cache-control` or
 * `x-content-type-options` header. Fix: pass a `clientErrorHandler` to
 * `fastify()` in `api/src/app.ts` that writes the envelope and the headers.
 */
describe("client errors below the router, adversarial", () => {
  let app: App;
  let port: number;
  beforeAll(async () => {
    app = await createTestApp();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    port = Number(new URL(address).port);
  });
  afterAll(() => app.close());

  interface RawResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
  }

  /** Writes raw bytes and reads until the server closes the socket, which it does after a client error. */
  function raw(payload: string): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      let data = "";
      const socket = connect(port, "127.0.0.1", () => socket.write(payload));
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      socket.on("error", reject);
      socket.on("close", () => {
        const [head = "", ...rest] = data.split("\r\n\r\n");
        const [statusLine = "", ...headerLines] = head.split("\r\n");
        const headers: Record<string, string> = {};
        for (const line of headerLines) {
          const at = line.indexOf(":");
          headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
        }
        resolve({ status: Number(statusLine.split(" ")[1]), headers, body: rest.join("\r\n\r\n") });
      });
    });
  }

  function expectEnvelope(res: RawResponse, status: number, code: string): void {
    expect(res.status).toBe(status);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const parsed = JSON.parse(res.body) as { error: Record<string, unknown> };
    expect(Object.keys(parsed)).toEqual(["error"]);
    expect(Object.keys(parsed.error).sort()).toEqual(["code", "message"]);
    expect(parsed.error.code).toBe(code);
    expect(typeof parsed.error.message).toBe("string");
  }

  it("a request whose headers exceed Node's limit gets the 431 envelope with the api's headers", async () => {
    const res = await raw(
      `GET /api/session HTTP/1.1\r\nHost: localhost\r\nX-Pad: ${"a".repeat(20_000)}\r\n\r\n`,
    );
    expectEnvelope(res, 431, "header_too_large");
  });

  it("a malformed request line gets the 400 envelope with the api's headers", async () => {
    const res = await raw("GET /\u0001 HTTP/1.1\r\nHost: localhost\r\n\r\n");
    expectEnvelope(res, 400, "bad_request");
  });

  it("a header with a bare LF, which smuggling attempts rely on, is refused rather than parsed leniently", async () => {
    const res = await raw(
      "POST /api/session HTTP/1.1\r\nHost: localhost\nOrigin: http://localhost:5173\r\n\r\n",
    );
    expect(res.status).toBe(400);
    expect(res.body).not.toContain("not_found");
  });
});
