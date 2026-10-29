import { describe, expect, it } from "vitest";
import { retryAfterMs } from "./anilist.js";
import { ANILIST_DEFAULT_RETRY_AFTER_MS, ANILIST_MAX_RETRY_AFTER_MS } from "./limits.js";

describe("retryAfterMs", () => {
  const now = Date.parse("2026-10-29T12:00:00.000Z");

  it("reads seconds and HTTP dates", () => {
    expect(retryAfterMs("7", now)).toBe(7_000);
    expect(retryAfterMs(" 30 ", now)).toBe(30_000);
    expect(retryAfterMs("Thu, 29 Oct 2026 12:01:00 GMT", now)).toBe(60_000);
  });

  it("waits the default without a header or with one it cannot read", () => {
    expect(retryAfterMs(null, now)).toBe(ANILIST_DEFAULT_RETRY_AFTER_MS);
    expect(retryAfterMs("soon", now)).toBe(ANILIST_DEFAULT_RETRY_AFTER_MS);
    expect(retryAfterMs("-5", now)).toBe(ANILIST_DEFAULT_RETRY_AFTER_MS);
  });

  it("never waits less than nothing nor more than the cap", () => {
    expect(retryAfterMs("Thu, 29 Oct 2026 11:00:00 GMT", now)).toBe(0);
    expect(retryAfterMs("999999", now)).toBe(ANILIST_MAX_RETRY_AFTER_MS);
  });
});
