import { describe, expect, it } from "vitest";
import { makeCharacter, makeEntry } from "../test/fixtures";
import { parseDuplicates, recycleRange } from "./recycle";

const spike = makeCharacter(1, { tier: "epic" });

describe("recycleRange (collection-overview.md §3.6 steps 1 and 2)", () => {
  it("offers 1 to the server's recyclable, capped at maxRecycleCount", () => {
    expect(recycleRange(makeEntry(spike, { count: 3 }), 100)).toEqual({ kind: "open", max: 2 });
    expect(recycleRange(makeEntry(spike, { count: 500, recyclable: 499 }), 100)).toEqual({
      kind: "open",
      max: 100,
    });
    expect(recycleRange(makeEntry(spike, { count: 2 }), 100)).toEqual({ kind: "open", max: 1 });
  });

  it("reads the server's number, never count − 1: listed copies are not offered", () => {
    expect(recycleRange(makeEntry(spike, { count: 4, listed: 2, available: 2, recyclable: 2 }), 100)).toEqual(
      {
        kind: "open",
        max: 2,
      },
    );
  });

  it("closes with the reason: one copy, or every duplicate on the market", () => {
    expect(recycleRange(makeEntry(spike, { count: 1 }), 100)).toEqual({ kind: "closed", reason: "oneCopy" });
    expect(recycleRange(makeEntry(spike, { count: 3, listed: 3, available: 0, recyclable: 0 }), 100)).toEqual(
      {
        kind: "closed",
        reason: "allListed",
      },
    );
  });
});

describe("parseDuplicates (§3.6 step 3)", () => {
  it.each([
    ["1", 1],
    ["2", 2],
    [" 2 ", 2],
    ["02", 2],
  ])("%j is %d", (text, n) => {
    expect(parseDuplicates(text, 2)).toBe(n);
  });

  it.each(["", " ", "0", "3", "-1", "1.5", "1e1", "+1", "0x1", "١", "2 2", "9999999999"])(
    "%j is not a number from 1 to the most",
    (text) => {
      expect(parseDuplicates(text, 2)).toBeNull();
    },
  );
});
