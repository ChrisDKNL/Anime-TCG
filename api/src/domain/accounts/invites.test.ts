import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashInviteCode, InviteList, isCapReached, normalizeInviteCode } from "./invites.js";

describe("normalizeInviteCode", () => {
  it("trims and case-folds, and leaves inner characters alone", () => {
    expect(normalizeInviteCode("  Anime-TCG-2026 ")).toBe("anime-tcg-2026");
    expect(normalizeInviteCode("\tCODE WITH SPACE\n")).toBe("code with space");
    expect(normalizeInviteCode("déjà-VU")).toBe("déjà-vu");
  });

  it("is idempotent", () => {
    const once = normalizeInviteCode(" MiXeD ");
    expect(normalizeInviteCode(once)).toBe(once);
  });
});

describe("hashInviteCode", () => {
  it("is the sha256 hex of the normalised code, so variants share one audit value", () => {
    const expected = createHash("sha256").update("anime-tcg-2026", "utf8").digest("hex");
    expect(hashInviteCode("ANIME-TCG-2026")).toBe(expected);
    expect(hashInviteCode("  anime-tcg-2026\n")).toBe(expected);
    expect(hashInviteCode("anime-tcg-2026")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for a code that differs by one character", () => {
    expect(hashInviteCode("anime-tcg-2026")).not.toBe(hashInviteCode("anime-tcg-2027"));
  });
});

describe("InviteList", () => {
  const list = new InviteList(["Alpha-Code-1", "  beta-code-22 "]);

  it("accepts every configured code, not just the first", () => {
    expect(list.accepts("Alpha-Code-1")).toBe(true);
    expect(list.accepts("beta-code-22")).toBe(true);
  });

  it("accepts case and whitespace variants of a configured code", () => {
    expect(list.accepts("alpha-code-1")).toBe(true);
    expect(list.accepts("ALPHA-CODE-1")).toBe(true);
    expect(list.accepts("  Alpha-Code-1\t")).toBe(true);
    expect(list.accepts("BETA-code-22")).toBe(true);
  });

  it.each([
    ["a trailing character", "Alpha-Code-1x"],
    ["a missing character", "Alpha-Code-"],
    ["an inner space", "Alpha-Code- 1"],
    ["a prefix of a code", "Alpha"],
    ["the empty string", ""],
    ["whitespace only", "   "],
    ["a code's hash", createHash("sha256").update("alpha-code-1").digest("hex")],
    ["a visually similar code (Cyrillic а)", "Alphа-Code-1"],
  ])("rejects %s", (_label, candidate) => {
    expect(list.accepts(candidate)).toBe(false);
  });

  it("is empty with no codes, and then rejects everything", () => {
    const closed = new InviteList([]);
    expect(closed.isEmpty).toBe(true);
    expect(closed.accepts("")).toBe(false);
    expect(closed.accepts("Alpha-Code-1")).toBe(false);
    expect(list.isEmpty).toBe(false);
  });

  it("compares digests of equal length whatever the candidate's length, so timingSafeEqual never throws", () => {
    expect(() => list.accepts("x".repeat(10_000))).not.toThrow();
    expect(list.accepts("x".repeat(10_000))).toBe(false);
  });
});

describe("isCapReached", () => {
  it("is reached at the cap and beyond, not below it", () => {
    expect(isCapReached(0, 1)).toBe(false);
    expect(isCapReached(9, 10)).toBe(false);
    expect(isCapReached(10, 10)).toBe(true);
    expect(isCapReached(11, 10)).toBe(true);
  });
});
