import { useCallback, useMemo, useState } from "react";
import { BoosterPack } from "./components/BoosterPack";
import { CharacterCard } from "./components/CharacterCard";
import { Inventory } from "./components/Inventory";
import { useCharacterPool } from "./hooks/useCharacterPool";
import { useInventory } from "./hooks/useInventory";
import { openPack } from "./lib/pack";
import type { Card } from "./types";

type Tab = "pack" | "collection";

export default function App() {
  const pool = useCharacterPool();
  const inventory = useInventory();

  const [tab, setTab] = useState<Tab>("pack");
  const [opening, setOpening] = useState(false);
  /** The 5 cards from the most recent pack, shown in the reveal grid. */
  const [lastPack, setLastPack] = useState<Card[]>([]);
  /** Character ids the player owned *before* the last pack, to badge "NEW". */
  const [ownedBeforePack, setOwnedBeforePack] = useState<Set<number>>(() => new Set());

  const handleOpen = useCallback(() => {
    if (pool.status !== "ready" || opening) return;
    setOpening(true);

    const cards = openPack(pool.characters);
    const pulledAt = cards[0]?.pulledAt ?? Date.now();

    // Snapshot ownership before appending so "NEW" is computed correctly even
    // if the player opens packs back-to-back.
    setOwnedBeforePack(inventory.ownedBefore(pulledAt));
    setLastPack([]); // clear first so the reveal animation re-triggers

    // Small delay purely for the "ripping the pack" feel.
    window.setTimeout(() => {
      setLastPack(cards);
      inventory.addCards(cards);
      setOpening(false);
    }, 350);
  }, [pool, opening, inventory]);

  const packSummary = useMemo(() => {
    const counts = { legendary: 0, rare: 0, common: 0 };
    for (const c of lastPack) counts[c.rarity] += 1;
    return counts;
  }, [lastPack]);

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_rgb(76_29_149_/_0.25),_transparent_60%)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              <span className="bg-gradient-to-r from-fuchsia-400 via-violet-400 to-sky-400 bg-clip-text text-transparent">
                Anime TCG
              </span>
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Open packs, collect characters. Data from{" "}
              <a
                href="https://anilist.co"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200"
              >
                AniList
              </a>
              .
            </p>
          </div>

          <nav className="flex gap-1 rounded-xl bg-zinc-900 p-1" aria-label="Views">
            {(["pack", "collection"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                  tab === t ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {t === "pack" ? "Booster" : `Collection (${inventory.stats.total})`}
              </button>
            ))}
          </nav>
        </header>

        {pool.status === "error" && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200"
          >
            <span>Couldn't load characters: {pool.error}</span>
            <button
              type="button"
              onClick={() => pool.reload(true)}
              className="rounded-lg bg-red-800/60 px-3 py-1 font-medium hover:bg-red-700/60"
            >
              Retry
            </button>
          </div>
        )}

        {tab === "pack" ? (
          <main className="flex flex-col items-center gap-8">
            <BoosterPack
              disabled={pool.status !== "ready"}
              opening={opening}
              onOpen={handleOpen}
            />

            {pool.status === "loading" && (
              <p className="text-sm text-zinc-500" aria-live="polite">
                Loading character pool from AniList…
              </p>
            )}

            {lastPack.length > 0 && (
              <section className="w-full" aria-live="polite">
                <h2 className="mb-3 text-center text-sm font-medium text-zinc-400">
                  You pulled{" "}
                  {packSummary.legendary > 0 && (
                    <span className="font-bold text-amber-300">{packSummary.legendary} Legendary</span>
                  )}
                  {packSummary.legendary > 0 && packSummary.rare > 0 && ", "}
                  {packSummary.rare > 0 && (
                    <span className="font-bold text-sky-300">{packSummary.rare} Rare</span>
                  )}
                  {(packSummary.legendary > 0 || packSummary.rare > 0) && packSummary.common > 0 && " and "}
                  {packSummary.common > 0 && <span className="font-bold text-zinc-200">{packSummary.common} Common</span>}
                </h2>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {lastPack.map((card, i) => (
                    <CharacterCard
                      key={card.uid}
                      card={card}
                      index={i}
                      isNew={!ownedBeforePack.has(card.characterId)}
                    />
                  ))}
                </div>
              </section>
            )}
          </main>
        ) : (
          <main>
            <Inventory cards={inventory.cards} stats={inventory.stats} onClear={inventory.clear} />
          </main>
        )}

        <footer className="mt-8 text-center text-xs text-zinc-600">
          Non-commercial fan project. Character images and titles © their respective owners, served via the
          AniList API.
        </footer>
      </div>
    </div>
  );
}
