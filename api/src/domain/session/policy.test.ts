import { describe, expect, it } from "vitest";
import {
  absoluteCutoff,
  expiryFrom,
  isDueForTouch,
  PURGE_INTERVAL_MS,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_TTL_MS,
  TOUCH_INTERVAL_MS,
} from "./policy.js";

const now = new Date("2026-10-28T12:00:00.000Z");

describe("session policy", () => {
  it("uses a 30-day sliding lifetime, a 5-minute touch interval and an hourly purge", () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(TOUCH_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(PURGE_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  it("bounds every session at 90 days from creation, longer than the sliding lifetime", () => {
    expect(SESSION_ABSOLUTE_LIFETIME_MS).toBe(90 * 24 * 60 * 60 * 1000);
    expect(SESSION_ABSOLUTE_LIFETIME_MS).toBeGreaterThan(SESSION_TTL_MS);
  });

  it("expires exactly one lifetime after now", () => {
    expect(expiryFrom(now).toISOString()).toBe("2026-11-27T12:00:00.000Z");
  });

  it("cuts off exactly 90 days before now", () => {
    expect(absoluteCutoff(now).toISOString()).toBe("2026-07-30T12:00:00.000Z");
    expect(now.getTime() - absoluteCutoff(now).getTime()).toBe(SESSION_ABSOLUTE_LIFETIME_MS);
  });

  it("is due for a touch at or after the interval, not before", () => {
    expect(isDueForTouch(now, now)).toBe(false);
    expect(isDueForTouch(new Date(now.getTime() - TOUCH_INTERVAL_MS + 1), now)).toBe(false);
    expect(isDueForTouch(new Date(now.getTime() - TOUCH_INTERVAL_MS), now)).toBe(true);
    expect(isDueForTouch(new Date(now.getTime() - 2 * TOUCH_INTERVAL_MS), now)).toBe(true);
  });

  it("is not due when last_seen_at is in the future (clock skew)", () => {
    expect(isDueForTouch(new Date(now.getTime() + 60_000), now)).toBe(false);
  });
});
