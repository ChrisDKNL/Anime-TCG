import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "./api";
import { RATE_LIMITED_FALLBACK_SECONDS, rethrowUnlessKnown, serverWait, toFailure } from "./failures";

describe("toFailure", () => {
  it("classifies the two failure families", () => {
    expect(toFailure(new NetworkError("down"))).toEqual({ kind: "network" });
    expect(
      toFailure(new ApiError(429, { code: "too_many_failures", message: "m", retryAfterSeconds: 4 })),
    ).toEqual({ kind: "api", code: "too_many_failures", retryAfterSeconds: 4 });
  });

  it("rethrows anything that is not an api outcome", () => {
    const bug = new TypeError("undefined is not a function");
    expect(() => toFailure(bug)).toThrow(bug);
  });
});

describe("rethrowUnlessKnown", () => {
  it("lets api answers and network failures through", () => {
    expect(() => rethrowUnlessKnown(new NetworkError("down"))).not.toThrow();
    expect(() => rethrowUnlessKnown(new ApiError(500, { code: "internal", message: "m" }))).not.toThrow();
  });

  it("rethrows anything else", () => {
    const bug = new TypeError("undefined is not a function");
    expect(() => rethrowUnlessKnown(bug)).toThrow(bug);
  });
});

describe("serverWait", () => {
  it("the breather waits the envelope's seconds, and invents none when it names none", () => {
    expect(serverWait({ kind: "api", code: "too_many_failures", retryAfterSeconds: 7 })).toEqual({
      reason: "misses",
      seconds: 7,
    });
    expect(serverWait({ kind: "api", code: "too_many_failures", retryAfterSeconds: undefined })).toEqual({
      reason: "misses",
      seconds: undefined,
    });
  });

  it("the rate limiter waits Retry-After's seconds, or 60 without the header", () => {
    expect(serverWait({ kind: "api", code: "rate_limited", retryAfterSeconds: 42 })).toEqual({
      reason: "rateLimited",
      seconds: 42,
    });
    expect(serverWait({ kind: "api", code: "rate_limited", retryAfterSeconds: undefined })).toEqual({
      reason: "rateLimited",
      seconds: RATE_LIMITED_FALLBACK_SECONDS,
    });
    expect(RATE_LIMITED_FALLBACK_SECONDS).toBe(60);
  });

  it("asks for no wait on any other outcome", () => {
    expect(serverWait({ kind: "network" })).toBeNull();
    expect(serverWait({ kind: "api", code: "bad_credentials", retryAfterSeconds: undefined })).toBeNull();
    expect(serverWait({ kind: "api", code: "no_pack_available", retryAfterSeconds: 30 })).toBeNull();
  });
});
