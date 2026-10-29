import { useMemo, useState } from "react";
import { RARITIES, RARITY_LABEL, type Rarity } from "@anime-tcg/shared/rarity";
import { inventoryCopy } from "../lib/copy";
import type { Card } from "../types";
import { CharacterCard } from "./CharacterCard";

interface Props {
  cards: readonly Card[];
  stats: { total: number; unique: number; byRarity: Record<Rarity, number> };
  /** Whose collection this is; the Reset confirm names it (accounts.md §8). */
  login: string;
  onClear: () => void;
}

type Filter = Rarity | "all";

const RARITY_RANK: Record<Rarity, number> = { legendary: 0, rare: 1, common: 2 };

/**
 * Collection view. Groups duplicates by (characterId, rarity) so a character
 * pulled three times as Common shows once with "×3", but a Legendary pull of
 * the same character is its own card.
 */
export function Inventory({ cards, stats, login, onClear }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const grouped = useMemo(() => {
    const map = new Map<string, { card: Card; copies: number }>();
    for (const c of cards) {
      const key = `${c.characterId}:${c.rarity}`;
      const existing = map.get(key);
      if (existing) existing.copies += 1;
      else map.set(key, { card: c, copies: 1 });
    }
    return Array.from(map.values())
      .filter((g) => filter === "all" || g.card.rarity === filter)
      .sort(
        (a, b) =>
          RARITY_RANK[a.card.rarity] - RARITY_RANK[b.card.rarity] || a.card.name.localeCompare(b.card.name),
      );
  }, [cards, filter]);

  if (cards.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
        Your collection is empty. Open a pack to get started.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
          <span className="font-semibold text-zinc-200">{stats.total} cards</span>
          <span>·</span>
          <span>{stats.unique} unique</span>
          {RARITIES.map((r) => (
            <span key={r} className="rounded-md bg-zinc-900 px-2 py-0.5 text-xs">
              {RARITY_LABEL[r]} {stats.byRarity[r]}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="rarity-filter">
            Filter by rarity
          </label>
          <select
            id="rarity-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <option value="all">All rarities</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {RARITY_LABEL[r]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(inventoryCopy.resetConfirm(login))) onClear();
            }}
            className="rounded-lg border border-red-900/60 px-3 py-1 text-sm text-red-300 transition hover:bg-red-950/50"
          >
            Reset
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {grouped.map(({ card, copies }) => (
          <CharacterCard key={`${card.characterId}:${card.rarity}`} card={card} copies={copies} />
        ))}
      </div>
    </section>
  );
}
