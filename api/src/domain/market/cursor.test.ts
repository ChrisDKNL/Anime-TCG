import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

const ID = "6f1c2a4e-1b2c-4d3e-8f90-123456789abc";
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
      Buffer.from(`["price_asc",9007199254740993,"${ID}"]`, "utf8").toString("base64url"),
      encoded(["price_asc", 5, "1; drop table market_listings"]),
      encoded(["price_asc", 5, ID.toUpperCase()]),
      encoded(["newest", "yesterday", ID]),
      encoded(["newest", "2026-11-10T12:00:00Z", ID]),
      encoded(["newest", 5, ID]),
    ]) {
      const sort = text.length > 0 && decodeURIComponent(text).includes("newest") ? "newest" : "price_asc";
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
