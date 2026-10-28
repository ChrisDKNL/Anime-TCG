import { describe, expect, it } from "vitest";
import { needsOriginCheck, originAllowed } from "./csrf.js";

const WEB = "http://localhost:5173";

describe("needsOriginCheck", () => {
  it.each(["GET", "HEAD", "get", "head"])("exempts %s", (method) => {
    expect(needsOriginCheck(method)).toBe(false);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "post"])("requires it for %s", (method) => {
    expect(needsOriginCheck(method)).toBe(true);
  });
});

describe("originAllowed", () => {
  it("accepts an Origin that equals the web origin exactly", () => {
    expect(originAllowed({ origin: WEB }, WEB)).toBe(true);
  });

  it.each([
    ["a different host", "http://evil.example"],
    ["a different port", "http://localhost:5174"],
    ["a different scheme", "https://localhost:5173"],
    ["a trailing slash", "http://localhost:5173/"],
    ["a path", "http://localhost:5173/app"],
    ["a subdomain", "http://localhost.evil.example:5173"],
    ["a prefix match", "http://localhost:51730"],
    ["the opaque origin", "null"],
    ["an empty value", ""],
    ["a CRLF payload", "http://localhost:5173\r\nX-Injected: 1"],
    ["different case", "http://LOCALHOST:5173"],
  ])("rejects an Origin with %s", (_label, origin) => {
    expect(originAllowed({ origin }, WEB)).toBe(false);
  });

  it("rejects a duplicated Origin header even when one copy matches, and does not fall back to Referer", () => {
    expect(originAllowed({ origin: [WEB, "http://evil.example"], referer: `${WEB}/` }, WEB)).toBe(false);
  });

  it("does not fall back to Referer when Origin is present but wrong", () => {
    expect(originAllowed({ origin: "http://evil.example", referer: `${WEB}/page` }, WEB)).toBe(false);
  });

  it("falls back to the origin of Referer when Origin is absent", () => {
    expect(originAllowed({ referer: `${WEB}/collection?tab=rare#top` }, WEB)).toBe(true);
    expect(originAllowed({ referer: "http://evil.example/page" }, WEB)).toBe(false);
  });

  it("rejects a Referer that is not a URL or is duplicated", () => {
    expect(originAllowed({ referer: "not a url" }, WEB)).toBe(false);
    expect(originAllowed({ referer: [`${WEB}/a`, `${WEB}/b`] }, WEB)).toBe(false);
  });

  it("rejects a request with neither header", () => {
    expect(originAllowed({}, WEB)).toBe(false);
  });
});
