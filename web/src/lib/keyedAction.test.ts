import type { ErrorCode } from "@anime-tcg/shared/errors";
import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "./api";
import { MAX_WAIT_SECONDS } from "./failures";
import { RATE_LIMIT_FALLBACK_SECONDS } from "./game";
import { failureOutcome, keepsKey } from "./keyedAction";

function apiError(
  status: number,
  code: ErrorCode,
  extra: { retryAfterSeconds?: number; balance?: number } = {},
) {
  return new ApiError(status, { code, message: code, ...extra });
}

describe("failureOutcome (collection-overview.md §3.5 step 9)", () => {
  it("no answer is unknown, never a refusal", () => {
    expect(failureOutcome(new NetworkError("offline"))).toEqual({ kind: "noAnswer" });
  });

  it("unauthenticated ends the session", () => {
    expect(failureOutcome(apiError(401, "unauthenticated"))).toEqual({ kind: "sessionEnded" });
  });

  it("a 429 waits Retry-After's seconds, the fallback without one, MAX_WAIT_SECONDS at most", () => {
    expect(failureOutcome(apiError(429, "rate_limited", { retryAfterSeconds: 12 }))).toEqual({
      kind: "rateLimited",
      seconds: 12,
    });
    expect(failureOutcome(apiError(429, "rate_limited"))).toEqual({
      kind: "rateLimited",
      seconds: RATE_LIMIT_FALLBACK_SECONDS,
    });
    expect(failureOutcome(apiError(429, "rate_limited", { retryAfterSeconds: 86_400 }))).toEqual({
      kind: "rateLimited",
      seconds: MAX_WAIT_SECONDS,
    });
  });

  it("every other envelope is a refusal by code, with the balance insufficient_funds carries", () => {
    expect(failureOutcome(apiError(409, "insufficient_funds", { balance: 120 }))).toEqual({
      kind: "refused",
      code: "insufficient_funds",
      balance: 120,
    });
    for (const [status, code] of [
      [409, "not_enough_copies"],
      [409, "balance_limit"],
      [409, "request_id_reused"],
      [404, "theme_unavailable"],
      [503, "pool_unavailable"],
      [500, "internal"],
    ] as const) {
      expect(failureOutcome(apiError(status, code))).toEqual({ kind: "refused", code, balance: undefined });
    }
  });

  it("rethrows anything that is not an api answer: a bug in this client", () => {
    const bug = new TypeError("bug");
    expect(() => failureOutcome(bug)).toThrow(bug);
  });
});

describe("keepsKey (packs-page.md §3.3)", () => {
  it("keeps the request id on no answer and on a 429, and discards it on every other answer", () => {
    expect(keepsKey({ kind: "noAnswer" })).toBe(true);
    expect(keepsKey({ kind: "rateLimited", seconds: 5 })).toBe(true);
    expect(keepsKey({ kind: "answered", result: {} })).toBe(false);
    expect(keepsKey({ kind: "refused", code: "insufficient_funds", balance: 0 })).toBe(false);
    expect(keepsKey({ kind: "refused", code: "internal", balance: undefined })).toBe(false);
    expect(keepsKey({ kind: "sessionEnded" })).toBe(false);
  });
});
