import type { CollectionEntry } from "@anime-tcg/shared/api";

/**
 * What the card dialog's Recycle for Karma offers for an entry
 * (collection-overview.md §3.6 steps 1 and 2), from the server's
 * `recyclable` (at most copies − 1, never a listed copy) and its
 * `maxRecycleCount`. Neither is authoritative: the server checks again.
 */
export type RecycleRange =
  | { kind: "open"; max: number }
  /** Nothing to recycle: one copy only, or every duplicate is on the market. */
  | { kind: "closed"; reason: "oneCopy" | "allListed" };

export function recycleRange(entry: CollectionEntry, maxRecycleCount: number): RecycleRange {
  if (entry.recyclable >= 1) return { kind: "open", max: Math.min(entry.recyclable, maxRecycleCount) };
  return { kind: "closed", reason: entry.count <= 1 ? "oneCopy" : "allListed" };
}

/**
 * The `Duplicates` field's number, checked on submit (§3.6 step 3): digits
 * only after trimming, from 1 to `max`; anything else is null. The value sent
 * is the parsed integer, never the text.
 */
export function parseDuplicates(text: string, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 && n <= max ? n : null;
}
