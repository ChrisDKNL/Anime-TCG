import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "./api";
import { toFailure } from "./failures";

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
