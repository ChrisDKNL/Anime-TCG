import { MAX_ENTRY_AMOUNT } from "@anime-tcg/shared/economy";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

const ID = "6f1c2a4e-1b2c-4d3e-8f90-123456789abc";
const SORTS = ["price_asc", "price_desc", "newest"] as const;
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

describe("the browse cursor (economy.md §8.4)", () => {
  it("round-trips a price position and a time position, each only for its own sort", () => {
    for (const sort of ["price_asc", "price_desc"] as const) {
      const cursor = encodeCursor({ sort, price: 27_500, id: ID });
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeCursor(cursor, sort)).toEqual({ sort, price: 27_500, id: ID });
    }
    const listedAt = new Date("2026-11-10T12:00:00.123Z");
    const cursor = encodeCursor({ sort: "newest", listedAt, id: ID });
    expect(decodeCursor(cursor, "newest")).toEqual({ sort: "newest", listedAt, id: ID });
    expect(() => decodeCursor(cursor, "price_asc")).toThrow(ApiError);
    for (const listedAt of [new Date(0), new Date("9999-12-31T23:59:59.999Z")]) {
      expect(decodeCursor(encodeCursor({ sort: "newest", listedAt, id: ID }), "newest")).toMatchObject({
        listedAt,
      });
    }
    for (const price of [1, MAX_ENTRY_AMOUNT]) {
      expect(decodeCursor(encodeCursor({ sort: "price_desc", price, id: ID }), "price_desc")).toMatchObject({
        price,
      });
    }
    expect(() => decodeCursor(encodeCursor({ sort: "price_asc", price: 5, id: ID }), "price_desc")).toThrow(
      ApiError,
    );
  });

  it("refuses anything it did not make with a 400, never a 500", () => {
    for (const text of [
      "not-base64-json",
      encoded({ sort: "price_asc" }),
      encoded(["price_asc", 5]),
      encoded(["price_asc", 5, ID, "extra"]),
      encoded(["price_asc", "5", ID]),
      encoded(["price_asc", 0, ID]),
      encoded(["price_asc", 1.5, ID]),
      encoded(["price_asc", MAX_ENTRY_AMOUNT + 1, ID]),
      encoded(["price_desc", 2_147_483_648, ID]),
      Buffer.from(`["price_asc",9007199254740993,"${ID}"]`, "utf8").toString("base64url"),
      encoded(["price_asc", 5, "1; drop table market_listings"]),
      encoded(["price_asc", 5, ID.toUpperCase()]),
      encoded(["newest", "yesterday", ID]),
      encoded(["newest", "2026-11-10T12:00:00Z", ID]),
      encoded(["newest", 5, ID]),
      encoded(["newest", new Date(-1).toISOString(), ID]),
      encoded(["newest", new Date(-8.64e15).toISOString(), ID]),
      encoded(["newest", new Date(Date.UTC(10_000, 0, 1)).toISOString(), ID]),
      encoded(["newest", new Date(8.64e15).toISOString(), ID]),
    ]) {
      // Each forgery is decoded for the sort it names, so it is refused for what it holds, not for a sort mismatch.
      const named = Buffer.from(text, "base64url").toString("utf8");
      const sort = SORTS.find((candidate) => named.startsWith(`["${candidate}"`)) ?? "price_asc";
      let thrown: unknown;
      try {
        decodeCursor(text, sort);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, text).toBeInstanceOf(ApiError);
      expect(thrown).toMatchObject({ statusCode: 400, code: "validation_failed" });
    }
  });
});
