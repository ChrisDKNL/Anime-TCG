import { describe, expect, it } from "vitest";
import {
  checkConfirmation,
  checkInviteCode,
  checkLogin,
  checkNewPassword,
  checkRequired,
} from "./validation";

describe("checkLogin", () => {
  it("trims and reports empty", () => {
    expect(checkLogin("   ")).toEqual({ value: "", issue: "empty" });
  });

  it("measures the trimmed value in code points", () => {
    expect(checkLogin("  ab  ")).toEqual({ value: "ab", issue: "length" });
    expect(checkLogin("abc")).toEqual({ value: "abc", issue: null });
    expect(checkLogin("a".repeat(24))).toEqual({ value: "a".repeat(24), issue: null });
    expect(checkLogin("a".repeat(25))).toEqual({ value: "a".repeat(25), issue: "length" });
    // 3 astral characters are 6 UTF-16 code units but 3 characters.
    expect(checkLogin("😀😀😀").issue).toBeNull();
  });

  it("keeps internal whitespace as typed", () => {
    expect(checkLogin(" Chris D ").value).toBe("Chris D");
  });
});

describe("checkNewPassword", () => {
  it("never trims", () => {
    expect(checkNewPassword("        ")).toBeNull();
  });

  it("reports empty and length", () => {
    expect(checkNewPassword("")).toBe("empty");
    expect(checkNewPassword("1234567")).toBe("length");
    expect(checkNewPassword("12345678")).toBeNull();
    expect(checkNewPassword("x".repeat(128))).toBeNull();
    expect(checkNewPassword("x".repeat(129))).toBe("length");
  });
});

describe("checkConfirmation", () => {
  it("is exact", () => {
    expect(checkConfirmation("abc", "abc")).toBeNull();
    expect(checkConfirmation("abc", "abc ")).toBe("mismatch");
    expect(checkConfirmation("", "")).toBeNull();
  });
});

describe("checkRequired and checkInviteCode", () => {
  it("only care about emptiness", () => {
    expect(checkRequired("")).toBe("empty");
    expect(checkRequired(" ")).toBeNull();
    expect(checkInviteCode("  ")).toEqual({ value: "", issue: "empty" });
    expect(checkInviteCode(" Local-Dev-Invite ")).toEqual({ value: "Local-Dev-Invite", issue: null });
  });
});
