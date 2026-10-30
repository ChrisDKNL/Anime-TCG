import { MAX_RECYCLE_COUNT, RECYCLE_VALUE } from "@anime-tcg/shared/economy";
import { RARITIES } from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import {
  copiesToRecycle,
  type HeldCopy,
  holdingOf,
  newestFirst,
  recycleCredit,
  recycleRequestHash,
} from "./recycle.js";

const copy = (id: string, minute: number, extra: Partial<HeldCopy> = {}): HeldCopy => ({
  id,
  pulledAt: new Date(Date.UTC(2026, 9, 29, 12, minute)),
  listed: false,
  escrowed: false,
  ...extra,
});

describe("recyclable = min(held − 1, available) (economy.md §7)", () => {
  it.each([
    [
      { held: 1, listed: 0, escrowed: 0 },
      { listed: 0, available: 1, recyclable: 0 },
    ],
    [
      { held: 2, listed: 0, escrowed: 0 },
      { listed: 0, available: 2, recyclable: 1 },
    ],
    [
      { held: 6, listed: 0, escrowed: 0 },
      { listed: 0, available: 6, recyclable: 5 },
    ],
    [
      { held: 3, listed: 1, escrowed: 0 },
      { listed: 1, available: 2, recyclable: 2 },
    ],
    [
      { held: 2, listed: 1, escrowed: 0 },
      { listed: 1, available: 1, recyclable: 1 },
    ],
    [
      { held: 2, listed: 2, escrowed: 0 },
      { listed: 2, available: 0, recyclable: 0 },
    ],
    [
      { held: 1, listed: 1, escrowed: 0 },
      { listed: 1, available: 0, recyclable: 0 },
    ],
    [
      { held: 4, listed: 1, escrowed: 2 },
      { listed: 1, available: 1, recyclable: 1 },
    ],
    [
      { held: 0, listed: 0, escrowed: 0 },
      { listed: 0, available: 0, recyclable: 0 },
    ],
  ])("%j has %j", (holding, availability) => {
    expect(holdingOf(holding)).toEqual(availability);
  });
});

describe("which copies a recycle takes", () => {
  it("takes the newest available copies, so the first one pulled stays", () => {
    const copies = [copy("a", 1), copy("c", 3), copy("b", 2), copy("d", 4)];
    expect(copiesToRecycle(copies, 1)).toEqual(["d"]);
    expect(copiesToRecycle(copies, 3)).toEqual(["d", "c", "b"]);
  });

  it("never takes the last held copy, and refuses with not_enough_copies when the count is too high", () => {
    const copies = [copy("a", 1), copy("b", 2)];
    expect(() => copiesToRecycle(copies, 2)).toThrow(
      expect.objectContaining({ statusCode: 409, code: "not_enough_copies" }),
    );
    expect(() => copiesToRecycle([copy("a", 1)], 1)).toThrow(
      expect.objectContaining({ code: "not_enough_copies" }),
    );
  });

  it("refuses an entry the account does not hold the same way", () => {
    expect(() => copiesToRecycle([], 1)).toThrow(expect.objectContaining({ code: "not_enough_copies" }));
  });

  it("never takes a listed or escrowed copy, but recycles a duplicate while another copy is listed", () => {
    const three = [copy("a", 1), copy("b", 2), copy("c", 3, { listed: true })];
    expect(copiesToRecycle(three, 2)).toEqual(["b", "a"]);
    const two = [copy("a", 1), copy("b", 2, { listed: true })];
    expect(copiesToRecycle(two, 1)).toEqual(["a"]);
    const bothListed = [copy("a", 1, { listed: true }), copy("b", 2, { listed: true })];
    expect(() => copiesToRecycle(bothListed, 1)).toThrow(
      expect.objectContaining({ code: "not_enough_copies" }),
    );
    const escrowed = [copy("a", 1), copy("b", 2, { escrowed: true }), copy("c", 3)];
    expect(copiesToRecycle(escrowed, 1)).toEqual(["c"]);
    expect(copiesToRecycle(escrowed, 2)).toEqual(["c", "a"]);
    expect(() => copiesToRecycle(escrowed, 3)).toThrow(
      expect.objectContaining({ code: "not_enough_copies" }),
    );
  });

  it("breaks a tie on the time by the id, so the order never depends on the query", () => {
    const tied = [copy("a", 1), copy("c", 1), copy("b", 1)];
    expect([...tied].sort(newestFirst).map((c) => c.id)).toEqual(["c", "b", "a"]);
    expect(newestFirst(copy("a", 1), copy("a", 1))).toBe(0);
  });

  it.each([0, -1, 1.5, MAX_RECYCLE_COUNT + 1])(
    "refuses a count of %s as a bug the schema already stops",
    (count) => {
      expect(() => copiesToRecycle([copy("a", 1), copy("b", 2)], count)).toThrow(RangeError);
      expect(() => recycleCredit("common", count)).toThrow(RangeError);
    },
  );
});

describe("the credit", () => {
  it.each([...RARITIES])("is count × RECYCLE_VALUE for %s, Mythic included", (tier) => {
    expect(recycleCredit(tier, 1)).toBe(RECYCLE_VALUE[tier]);
    expect(recycleCredit(tier, 7)).toBe(7 * RECYCLE_VALUE[tier]);
  });

  it("stays a whole number within MAX_ENTRY_AMOUNT at 100 Mythic duplicates", () => {
    expect(recycleCredit("mythic", MAX_RECYCLE_COUNT)).toBe(275_000);
  });
});

describe("canonical request matching for a recycle (economy.md §8.8)", () => {
  const body = { characterId: 42, rarity: "rare" as const, count: 3 };

  it("is the SHA-256 of the entry and the count, whatever order the fields arrived in", () => {
    const reordered = { count: 3, rarity: "rare" as const, characterId: 42 };
    expect(recycleRequestHash(body)).toBe(recycleRequestHash(reordered));
    expect(recycleRequestHash(body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for another character, rarity or count", () => {
    const hash = recycleRequestHash(body);
    expect(recycleRequestHash({ ...body, characterId: 43 })).not.toBe(hash);
    expect(recycleRequestHash({ ...body, rarity: "epic" })).not.toBe(hash);
    expect(recycleRequestHash({ ...body, count: 4 })).not.toBe(hash);
  });
});
