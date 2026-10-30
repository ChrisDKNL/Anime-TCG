import { describe, expect, it } from "vitest";
import { isolate } from "./bidi";

describe("isolate", () => {
  it("wraps the text in FSI and PDI and leaves it unaltered", () => {
    expect(isolate("Frieren")).toBe("\u2068Frieren\u2069");
    expect(isolate("\u202Egnp.exe")).toBe("\u2068\u202Egnp.exe\u2069");
    expect(isolate("")).toBe("\u2068\u2069");
  });
});
