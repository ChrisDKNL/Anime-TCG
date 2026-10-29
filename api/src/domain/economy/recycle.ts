import { createHash } from "node:crypto";
import { MAX_RECYCLE_COUNT, RECYCLE_VALUE } from "@anime-tcg/shared/economy";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { ApiError } from "../errors.js";

/**
 * The rules of recycling duplicates for Karma (economy.md §6, §7, §8.2),
 * pure. A copy is *held* until it is removed, *available* while held and
 * neither listed nor escrowed, and an entry's *recyclable* copies are
 * `min(held − 1, available)`: never the last held copy, never a listed or
 * escrowed one.
 */

/** One entry's held copies, and how many of them are listed or in escrow. */
export interface Holding {
  held: number;
  listed: number;
  escrowed: number;
}

export interface Availability {
  listed: number;
  available: number;
  recyclable: number;
}

export function holdingOf({ held, listed, escrowed }: Holding): Availability {
  const available = Math.max(0, held - listed - escrowed);
  return { listed, available, recyclable: Math.max(0, Math.min(held - 1, available)) };
}

/** A held copy as the recycle locked it. */
export interface HeldCopy {
  id: string;
  pulledAt: Date;
  listed: boolean;
  escrowed: boolean;
}

/** Newest first; a tie on the time falls back to the id, so the order never depends on the query plan. */
export function newestFirst(a: HeldCopy, b: HeldCopy): number {
  const byTime = b.pulledAt.getTime() - a.pulledAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function notEnoughCopies(): ApiError {
  return new ApiError(409, "not_enough_copies", "Not enough duplicates of that card");
}

/**
 * The ids of the `count` copies a recycle removes from `copies` (every held
 * copy of one entry): the newest available ones, so the copy that stays is
 * the first one pulled. More than the entry's recyclable copies is a 409
 * and nothing is taken, which is also the answer for an entry the account
 * does not hold at all.
 */
export function copiesToRecycle(copies: readonly HeldCopy[], count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_RECYCLE_COUNT)
    throw new RangeError(`count ${count} is outside 1..${MAX_RECYCLE_COUNT}`);
  const { recyclable } = holdingOf({
    held: copies.length,
    listed: copies.filter((copy) => copy.listed).length,
    escrowed: copies.filter((copy) => copy.escrowed).length,
  });
  if (count > recyclable) throw notEnoughCopies();
  return copies
    .filter((copy) => !copy.listed && !copy.escrowed)
    .sort(newestFirst)
    .slice(0, count)
    .map((copy) => copy.id);
}

/** Karma for `count` duplicates of `rarity`, at the value in force now (§6). */
export function recycleCredit(rarity: Rarity, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_RECYCLE_COUNT)
    throw new RangeError(`count ${count} is outside 1..${MAX_RECYCLE_COUNT}`);
  return count * RECYCLE_VALUE[rarity];
}

/** What makes two recycles "the same request" (§8.8): the entry and the count, never the key. */
export interface RecycleRequest {
  characterId: number;
  rarity: Rarity;
  count: number;
}

/** SHA-256 of the canonical body: the three fields in a fixed order, as JSON. */
export function recycleRequestHash({ characterId, rarity, count }: RecycleRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([characterId, rarity, count]))
    .digest("hex");
}
