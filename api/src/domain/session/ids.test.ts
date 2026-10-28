import { describe, expect, it } from "vitest";
import { hashSessionId, hashUserAgent, isWellFormedSessionId, newSessionId } from "./ids.js";

const SECRET = "unit-test-session-secret-not-for-real-use-0123456789";

describe("newSessionId", () => {
  it("is 32 random bytes as 43 base64url characters, different every time", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSessionId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(id, "base64url")).toHaveLength(32);
    }
  });
});

describe("isWellFormedSessionId", () => {
  it("accepts what newSessionId produces", () => {
    expect(isWellFormedSessionId(newSessionId())).toBe(true);
  });

  it.each([
    ["too short", "a".repeat(42)],
    ["too long", "a".repeat(44)],
    ["empty", ""],
    ["standard base64 characters", `${"a".repeat(41)}+/`],
    ["padding", `${"a".repeat(42)}=`],
    ["whitespace", `${"a".repeat(42)} `],
    ["a newline", `${"a".repeat(42)}\n`],
    ["unicode", `${"a".repeat(42)}é`],
  ])("rejects %s", (_label, value) => {
    expect(isWellFormedSessionId(value)).toBe(false);
  });
});

describe("hashSessionId", () => {
  it("is a deterministic 64-hex-char HMAC that depends on the secret", () => {
    const id = newSessionId();
    const hash = hashSessionId(SECRET, id);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionId(SECRET, id)).toBe(hash);
    expect(hashSessionId(`${SECRET}-other`, id)).not.toBe(hash);
  });

  it("changes completely when a single character of the id changes", () => {
    const id = newSessionId();
    const flipped = `${id.slice(0, -1)}${id.endsWith("A") ? "B" : "A"}`;
    expect(hashSessionId(SECRET, flipped)).not.toBe(hashSessionId(SECRET, id));
  });
});

describe("hashUserAgent", () => {
  it("hashes a missing user agent as the empty string, never the raw value", () => {
    expect(hashUserAgent(undefined)).toBe(hashUserAgent(""));
    expect(hashUserAgent("Mozilla/5.0")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUserAgent("Mozilla/5.0")).not.toContain("Mozilla");
  });
});
