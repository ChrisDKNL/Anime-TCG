import type { Card, Character } from "../types";
import { assignRarity } from "./rarity";

export const PACK_SIZE = 5;

/**
 * Picks `count` distinct characters from the pool using a partial
 * Fisher-Yates shuffle (O(count) rather than shuffling the whole pool).
 */
export function sampleDistinct<T>(pool: readonly T[], count: number): T[] {
  const copy = pool.slice();
  const n = Math.min(count, copy.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    const a = copy[i];
    const b = copy[j];
    if (a !== undefined && b !== undefined) {
      copy[i] = b;
      copy[j] = a;
    }
  }
  return copy.slice(0, n);
}

function newUid(): string {
  // crypto.randomUUID is available in all evergreen browsers (secure contexts).
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Opens one booster: 5 distinct characters, each rolled for rarity. */
export function openPack(pool: Character[], size: number = PACK_SIZE): Card[] {
  const picks = sampleDistinct(pool, size);
  const pulledAt = Date.now();
  return picks.map((c) => ({
    uid: newUid(),
    characterId: c.id,
    name: c.name,
    imageUrl: c.imageUrl,
    animeTitle: c.animeTitle,
    animeTitleNative: c.animeTitleNative,
    rarity: assignRarity(c, pool),
    pulledAt,
  }));
}
