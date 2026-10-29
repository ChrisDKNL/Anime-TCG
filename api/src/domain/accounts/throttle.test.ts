import { describe, expect, it } from "vitest";
import {
  NO_FAILURES,
  purgeCutoff,
  recordFailure,
  retryAfterSeconds,
  THROTTLE_BLOCK_MS,
  THROTTLE_MAX_FAILURES,
  THROTTLE_ROW_TTL_MS,
  type ThrottleState,
} from "./throttle.js";

const T0 = new Date("2026-10-28T12:00:00.000Z");
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

/** `n` misses in a row starting from nothing, all at T0. */
function afterMisses(n: number): ThrottleState {
  let state = NO_FAILURES;
  for (let i = 0; i < n; i += 1) state = recordFailure(state, T0);
  return state;
}

describe("the sign-in breather", () => {
  it("is 5 misses and 10 seconds, per the spec", () => {
    expect(THROTTLE_MAX_FAILURES).toBe(5);
    expect(THROTTLE_BLOCK_MS).toBe(10_000);
    expect(THROTTLE_ROW_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("counts four misses without blocking", () => {
    for (let n = 1; n <= 4; n += 1) {
      const state = afterMisses(n);
      expect(state).toEqual({ failures: n, blockedUntil: null });
      expect(retryAfterSeconds(state, T0)).toBeNull();
    }
  });

  it("blocks on the fifth miss for exactly 10 s and resets the count", () => {
    const state = afterMisses(5);
    expect(state).toEqual({ failures: 0, blockedUntil: at(THROTTLE_BLOCK_MS) });
    expect(retryAfterSeconds(state, T0)).toBe(10);
  });

  it("reports the remaining wait rounded up, from 10 down to 1, and never 0 while blocked", () => {
    const state = afterMisses(5);
    expect(retryAfterSeconds(state, at(1))).toBe(10);
    expect(retryAfterSeconds(state, at(1000))).toBe(9);
    expect(retryAfterSeconds(state, at(5500))).toBe(5);
    expect(retryAfterSeconds(state, at(9001))).toBe(1);
    expect(retryAfterSeconds(state, at(9999))).toBe(1);
  });

  it("unblocks the instant the breather is over", () => {
    const state = afterMisses(5);
    expect(retryAfterSeconds(state, at(THROTTLE_BLOCK_MS))).toBeNull();
    expect(retryAfterSeconds(state, at(THROTTLE_BLOCK_MS + 1))).toBeNull();
    expect(retryAfterSeconds(state, at(24 * 60 * 60 * 1000))).toBeNull();
  });

  it("never reports more than 10 s, even if a stored blocked_until lies in the far future", () => {
    const skewed: ThrottleState = { failures: 0, blockedUntil: at(60 * 60 * 1000) };
    expect(retryAfterSeconds(skewed, T0)).toBe(10);
    expect(retryAfterSeconds(skewed, at(-1000))).toBe(10);
  });

  it("starts over after an expired block: the next miss is the first of a new series", () => {
    const expired = afterMisses(5);
    const later = at(THROTTLE_BLOCK_MS + 1);
    const next = recordFailure(expired, later);
    expect(next).toEqual({ failures: 1, blockedUntil: null });
    expect(retryAfterSeconds(next, later)).toBeNull();
    // Four more and it blocks again, from the later instant.
    let state = next;
    for (let i = 0; i < 4; i += 1) state = recordFailure(state, later);
    expect(state.blockedUntil).toEqual(new Date(later.getTime() + THROTTLE_BLOCK_MS));
  });

  it("a success is represented by no state at all, which is not blocked", () => {
    expect(retryAfterSeconds(NO_FAILURES, T0)).toBeNull();
    expect(NO_FAILURES).toEqual({ failures: 0, blockedUntil: null });
  });

  it("does not mutate the state it is given", () => {
    const before: ThrottleState = { failures: 2, blockedUntil: null };
    const frozen = Object.freeze({ ...before });
    expect(recordFailure(frozen, T0)).toEqual({ failures: 3, blockedUntil: null });
    expect(frozen).toEqual(before);
  });

  it("purgeCutoff is one hour before now", () => {
    expect(purgeCutoff(T0)).toEqual(at(-THROTTLE_ROW_TTL_MS));
  });
});
