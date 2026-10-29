import { describe, expect, it } from "vitest";
import { toPublic } from "./service.js";

describe("toPublic", () => {
  it("exposes id, login, an ISO created-at and a zero card count, and nothing else", () => {
    const createdAt = new Date("2026-10-28T20:15:00.000Z");
    const account = { id: "3f2c9a2e-5f67-4c5a-9a2a-1b2c3d4e5f60", login: "Chris", createdAt };
    expect(toPublic(account)).toEqual({
      id: "3f2c9a2e-5f67-4c5a-9a2a-1b2c3d4e5f60",
      login: "Chris",
      createdAt: "2026-10-28T20:15:00.000Z",
      cards: 0,
    });
    expect(Object.keys(toPublic(account))).toEqual(["id", "login", "createdAt", "cards"]);
  });

  it("does not carry over fields the row may have", () => {
    const row = { id: "x", login: "y", createdAt: new Date(0), passwordHash: "$argon2id$leak" };
    expect(JSON.stringify(toPublic(row))).not.toContain("argon2");
  });
});
