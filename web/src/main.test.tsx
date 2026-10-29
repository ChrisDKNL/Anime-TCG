import { afterEach, describe, expect, it, vi } from "vitest";

describe("main", () => {
  afterEach(() => vi.resetModules());

  it("refuses to start without the #root element instead of failing later", async () => {
    document.body.replaceChildren();
    await expect(import("./main")).rejects.toThrow("index.html has no #root element");
  });
});
