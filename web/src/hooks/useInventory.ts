import { useCallback, useMemo, useState } from "react";
import { LEGACY_RARITIES as RARITIES, type LegacyRarity as Rarity } from "@anime-tcg/shared/rarity";
import type { Card } from "../types";

/**
 * The inventory is a flat, append-only array of `Card` instances. Every pull
 * is its own entry (duplicates are real duplicates with distinct `uid`s), which
 * keeps the state model trivial and lets us derive anything else — counts per
 * character, per rarity, "new vs. dupe" — with `useMemo` instead of keeping
 * multiple sources of truth in sync.
 *
 * Held in memory for the signed-in session only. The collection moves to the
 * server in roadmap item 1c (ADR 0008); until then nothing account-scoped is
 * kept in the browser (accounts.md §3.7), and the pre-accounts
 * `anime-tcg:inventory:v1` key is neither read nor touched (§3.1.3).
 */
export function useInventory() {
  const [cards, setCards] = useState<Card[]>([]);

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
