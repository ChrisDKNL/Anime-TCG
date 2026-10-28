import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import { normalizeLogin, validatedLogin } from "./logins.js";

describe("normalizeLogin", () => {
  it("trims and lower-cases", () => {
    expect(normalizeLogin("  Chris ")).toBe("chris");
    expect(normalizeLogin("CHRIS")).toBe("chris");
    expect(normalizeLogin("Ægir")).toBe("ægir");
  });

  it("keeps inner whitespace and unusual characters: any character is allowed in a login", () => {
    expect(normalizeLogin("two words")).toBe("two words");
    expect(normalizeLogin("a\u0000b")).toBe("a\u0000b");
    expect(normalizeLogin("‮abc")).toBe("‮abc");
  });
});

describe("validatedLogin", () => {
  it("returns the trimmed login when it is 3 to 24 characters after the trim", () => {
    expect(validatedLogin("  abc  ")).toBe("abc");
    expect(validatedLogin("x".repeat(24))).toBe("x".repeat(24));
    expect(validatedLogin(` ${"x".repeat(24)} `)).toBe("x".repeat(24));
  });

  it("counts characters, not UTF-16 units: 24 emoji are 24 characters", () => {
    expect(validatedLogin("\u{1F600}".repeat(24))).toBe("\u{1F600}".repeat(24));
    expect(validatedLogin("\u{1F600}\u{1F600}\u{1F600}")).toHaveLength(6);
  });

  it.each([
    ["two characters padded to pass the schema", "  ab  "],
    ["spaces only", "      "],
    ["the empty string", ""],
    ["25 characters", "x".repeat(25)],
    ["25 emoji", "\u{1F600}".repeat(25)],
  ])("rejects %s as 400 validation_failed naming body/login", (_label, login) => {
    let thrown: unknown;
    try {
      validatedLogin(login);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    const error = thrown as ApiError;
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("validation_failed");
    expect(error.message).toBe("body/login must be 3 to 24 characters after trimming");
  });
});
