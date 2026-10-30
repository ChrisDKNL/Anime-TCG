import type { ListingSort } from "@anime-tcg/shared/api";
import { MAX_ENTRY_AMOUNT } from "@anime-tcg/shared/economy";
import { ApiError } from "../errors.js";

/**
 * The browse cursor (economy.md §8.4): keyset pagination on (sort key, id).
 * Opaque to the client, which only hands back the `nextCursor` it was
 * given; the server re-checks everything it decodes, since the client can
 * send anything.
 */

/** The last listing of a page, as far as the next page needs it: the sort key (a price, or the listing time) and the id. */
export type CursorPosition =
  | { sort: "price_asc" | "price_desc"; price: number; id: string }
  | { sort: "newest"; listedAt: Date; id: string };

/**
 * The times a listing can carry: from the epoch to the last millisecond of
 * year 9999, well inside Postgres's `timestamptz`; JavaScript dates reach far
 * beyond it either way, which the database refuses as an error.
 */
const EARLIEST_LISTING_MS = 0;
const LATEST_LISTING_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function encodeCursor(position: CursorPosition): string {
  const key = position.sort === "newest" ? position.listedAt.toISOString() : position.price;
  return Buffer.from(JSON.stringify([position.sort, key, position.id]), "utf8").toString("base64url");
}

function invalidCursor(): ApiError {
  return new ApiError(400, "validation_failed", "querystring/cursor is not a cursor of this sort");
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    // Anything that does not decode is a client's malformed cursor, answered like any invalid parameter.
    throw invalidCursor();
  }
}

/** The position `text` names, valid only for the `sort` it was made for; anything else is a 400. */
export function decodeCursor(text: string, sort: ListingSort): CursorPosition {
  const value = parsed(text);
  if (!Array.isArray(value) || value.length !== 3) throw invalidCursor();
  const [named, key, id] = value as unknown[];
  if (named !== sort || typeof id !== "string" || !UUID.test(id)) throw invalidCursor();
  if (sort === "newest") {
    if (typeof key !== "string") throw invalidCursor();
    const listedAt = new Date(key);
    const ms = listedAt.getTime();
    if (Number.isNaN(ms) || listedAt.toISOString() !== key) throw invalidCursor();
    if (ms < EARLIEST_LISTING_MS || ms > LATEST_LISTING_MS) throw invalidCursor();
    return { sort, listedAt, id };
  }
  // No listing is ever priced outside 1..MAX_ENTRY_AMOUNT (its check), so no page can follow such a price.
  if (typeof key !== "number" || !Number.isSafeInteger(key) || key < 1 || key > MAX_ENTRY_AMOUNT)
    throw invalidCursor();
  return { sort, price: key, id };
}
