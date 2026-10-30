import { DEMO_PACKS_PER_VISIT } from "@anime-tcg/shared/economy";
import { describe, expect, it } from "vitest";
import { AUTH_RATE_LIMIT, DEMO_RATE_LIMIT, PACK_RATE_LIMIT, RENAME_RATE_LIMIT } from "./limits.js";

const MINUTE_MS = 60_000;

describe("per-route rate limits", () => {
  it("are per minute, as the specs size them", () => {
    for (const limit of [AUTH_RATE_LIMIT, RENAME_RATE_LIMIT, PACK_RATE_LIMIT, DEMO_RATE_LIMIT]) {
      expect(limit.timeWindow).toBe(MINUTE_MS);
    }
  });

  it("let a visit's demo packs, opened as fast as the button allows, plus a reload's, through (navigation-and-landing.md §3.8 item 5)", () => {
    expect(DEMO_RATE_LIMIT.max).toBeGreaterThanOrEqual(2 * DEMO_PACKS_PER_VISIT);
    expect(DEMO_RATE_LIMIT).toEqual({ max: 20, timeWindow: MINUTE_MS });
  });
});
