import { useCallback, useEffect, useMemo, useState } from "react";
import type { Card, Rarity } from "../types";
import { RARITIES } from "../types";

const STORAGE_KEY = "anime-tcg:inventory:v1";

function loadInventory(): Card[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Card[]) : [];
  } catch {
    return [];
  }
}

/**
 * The inventory is a flat, append-only array of `Card` instances. Every pull
 * is its own entry (duplicates are real duplicates with distinct `uid`s), which
 * keeps the state model trivial and lets us derive anything else — counts per
 * character, per rarity, "new vs. dupe" — with `useMemo` instead of keeping
 * multiple sources of truth in sync.
 *
 * Persisted to localStorage so a refresh doesn't wipe the collection.
 */
export function useInventory() {
  const [cards, setCards] = useState<Card[]>(loadInventory);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
    } catch {
      // Ignore quota / private-mode errors; the in-memory state still works.
    }
  }, [cards]);

  /** Append newly opened cards. Functional update so rapid pack-opens never clobber each other. */
  const addCards = useCallback((newCards: Card[]) => {
    setCards((prev) => [...prev, ...newCards]);
  }, []);

  const clear = useCallback(() => setCards([]), []);

  const stats = useMemo(() => {
    const byRarity = Object.fromEntries(RARITIES.map((r) => [r, 0])) as Record<Rarity, number>;
    const uniqueIds = new Set<number>();
    for (const c of cards) {
      byRarity[c.rarity] += 1;
      uniqueIds.add(c.characterId);
    }
    return { total: cards.length, unique: uniqueIds.size, byRarity };
  }, [cards]);

  /** Set of character ids owned *before* a given timestamp — used to badge "NEW!" pulls. */
  const ownedBefore = useCallback(
    (timestamp: number) => new Set(cards.filter((c) => c.pulledAt < timestamp).map((c) => c.characterId)),
    [cards],
  );

  return { cards, addCards, clear, stats, ownedBefore };
}
