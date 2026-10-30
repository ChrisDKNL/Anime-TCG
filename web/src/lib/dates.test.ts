import { describe, expect, it } from "vitest";
import { clockTime, dayMonth } from "./dates";

describe("dates (market-and-shop.md §8)", () => {
  it("writes D Mon and HH:MM in the viewer's time zone, with §8's fixed month names", () => {
    const at = new Date(2026, 8, 5, 7, 4);
    expect(dayMonth(at)).toBe("5 Sep");
    expect(dayMonth(at.toISOString())).toBe("5 Sep");
    expect(clockTime(at)).toBe("07:04");
    expect(clockTime(new Date(2026, 11, 31, 23, 59).toISOString())).toBe("23:59");
  });
});
