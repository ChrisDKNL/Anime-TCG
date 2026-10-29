import { PACK_CAP } from "@anime-tcg/shared/economy";
import { describe, expect, it } from "vitest";
import { allowanceAt, anchorAfterOpening } from "./allowance.js";

const MINUTE = 60_000;
const INTERVAL = 10 * MINUTE;
const t0 = new Date("2026-10-29T12:00:00.000Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

/** Opens `count` packs back to back at `now`, from `anchor`. */
function openMany(anchor: Date | null, now: Date, count: number): Date | null {
  let current = anchor;
  for (let i = 0; i < count; i += 1) current = anchorAfterOpening(current, now);
  return current;
}

describe("pack allowance (collection-packs.md §5.2)", () => {
  it("starts a new account full", () => {
    expect(allowanceAt(null, t0)).toEqual({
      available: PACK_CAP,
      cap: PACK_CAP,
      intervalSeconds: 600,
      nextPackInSeconds: null,
    });
  });

  it("leaves C - 1 after opening from full, with the next pack one interval away", () => {
    const anchor = anchorAfterOpening(null, t0);
    expect(allowanceAt(anchor, t0)).toMatchObject({ available: PACK_CAP - 1, nextPackInSeconds: 600 });
  });

  it("leaves 0 after C openings back to back, then 1 one interval later", () => {
    const anchor = openMany(null, t0, PACK_CAP);
    expect(allowanceAt(anchor, t0)).toMatchObject({ available: 0, nextPackInSeconds: 600 });
    expect(allowanceAt(anchor, at(INTERVAL))).toMatchObject({ available: 1, nextPackInSeconds: 600 });
    expect(allowanceAt(anchor, at(INTERVAL - 1))).toMatchObject({ available: 0, nextPackInSeconds: 1 });
  });

  it("is back to C, not hundreds, after a week away", () => {
    const anchor = openMany(null, t0, PACK_CAP);
    expect(allowanceAt(anchor, at(7 * 24 * 60 * MINUTE))).toMatchObject({
      available: PACK_CAP,
      nextPackInSeconds: null,
    });
    const afterWeek = anchorAfterOpening(anchor, at(7 * 24 * 60 * MINUTE));
    expect(allowanceAt(afterWeek, at(7 * 24 * 60 * MINUTE))).toMatchObject({
      available: PACK_CAP - 1,
      nextPackInSeconds: 600,
    });
  });

  it("keeps the countdown running when a pack is opened while the timer runs", () => {
    const anchor = openMany(null, t0, 2);
    // Four minutes later one pack is still stored and the next is six minutes away.
    expect(allowanceAt(anchor, at(4 * MINUTE))).toMatchObject({ available: 1, nextPackInSeconds: 360 });
    const afterOpening = anchorAfterOpening(anchor, at(4 * MINUTE));
    expect(allowanceAt(afterOpening, at(4 * MINUTE))).toMatchObject({ available: 0, nextPackInSeconds: 360 });
  });

  it("gives 0, never a negative count, and a next pack of at least a second after the clock is set back an hour", () => {
    const anchor = openMany(null, t0, PACK_CAP);
    const setBack = allowanceAt(anchor, at(-60 * MINUTE));
    expect(setBack.available).toBe(0);
    expect(setBack.nextPackInSeconds).toBe(70 * 60);
    expect(allowanceAt(anchorAfterOpening(null, t0), at(-60 * MINUTE)).available).toBe(0);
  });

  it("grants at most C when the clock is set forward a year", () => {
    const anchor = openMany(null, t0, PACK_CAP);
    expect(allowanceAt(anchor, at(365 * 24 * 60 * MINUTE))).toMatchObject({
      available: PACK_CAP,
      nextPackInSeconds: null,
    });
  });

  it("rounds a fraction of a second up", () => {
    const anchor = openMany(null, t0, PACK_CAP);
    expect(allowanceAt(anchor, at(1))).toMatchObject({ available: 0, nextPackInSeconds: 600 });
    expect(allowanceAt(anchor, at(1_001))).toMatchObject({ available: 0, nextPackInSeconds: 599 });
    expect(allowanceAt(anchor, at(INTERVAL - 999))).toMatchObject({ nextPackInSeconds: 1 });
  });
});
