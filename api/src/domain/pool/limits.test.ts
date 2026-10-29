import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IMAGE_HOST } from "./limits.js";

describe("IMAGE_HOST", () => {
  it("is the one remote host the Caddyfile's img-src allows (C8)", () => {
    const caddyfile = readFileSync(new URL("../../../../Caddyfile", import.meta.url), "utf8");
    const imgSrc = /Content-Security-Policy "[^"]*?img-src ([^;"]+)/
      .exec(caddyfile)?.[1]
      ?.trim()
      .split(/\s+/);
    expect(imgSrc).toEqual(["'self'", `https://${IMAGE_HOST}`]);
  });
});
