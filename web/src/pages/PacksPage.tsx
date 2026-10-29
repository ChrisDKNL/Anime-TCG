import { useMemo, useState } from "react";
import { BoosterPack } from "../components/BoosterPack";
import { CharacterCard } from "../components/CharacterCard";
import { PageHeading } from "../components/layout/PageHeading";
import { useGame } from "../hooks/useGame";
import { packsCopy, poolCopy } from "../lib/navigationCopy";
import { pageHeading } from "../lib/routes";

/**
 * `/packs`, today's Booster tab under its `h1` (navigation-and-landing.md
 * §3.1). The opening and its reveal live in the root layout's game state, so a
 * pack opened here lands even if the player has moved on, and coming back
 * shows the last reveal without its entrance (§3.10 step 2).
 */
export function PacksPage() {
  const { state, pool, openPack } = useGame();
  // Reveals that land while this page is showing animate; the one already there when it mounted does not.
  const [revealsAtMount] = useState(state.reveals);
  const animate = state.reveals !== revealsAtMount;
  const { lastPack, ownedBeforePack, opening } = state;

  const packSummary = useMemo(() => {
    const counts = { legendary: 0, rare: 0, common: 0 };
    for (const c of lastPack) counts[c.rarity] += 1;
    return counts;
  }, [lastPack]);

  return (
    <>
      <PageHeading text={pageHeading("/packs")} />
      <div className="flex flex-col items-center gap-8">
        <BoosterPack disabled={pool.status !== "ready"} opening={opening} onOpen={openPack} />

        {pool.status === "loading" && (
          <p className="text-sm text-zinc-500" aria-live="polite">
            {poolCopy.loading}
          </p>
        )}

        {lastPack.length > 0 && (
          <section className="w-full" aria-live="polite">
            <h2 className="mb-3 text-center text-sm font-medium text-zinc-400">
              {packsCopy.pulled}{" "}
              {packSummary.legendary > 0 && (
                <span className="font-bold text-amber-300">{packSummary.legendary} Legendary</span>
              )}
              {packSummary.legendary > 0 && packSummary.rare > 0 && ", "}
              {packSummary.rare > 0 && (
                <span className="font-bold text-sky-300">{packSummary.rare} Rare</span>
              )}
              {(packSummary.legendary > 0 || packSummary.rare > 0) && packSummary.common > 0 && " and "}
              {packSummary.common > 0 && (
                <span className="font-bold text-zinc-200">{packSummary.common} Common</span>
              )}
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {lastPack.map((card, i) => (
                <CharacterCard
                  key={card.uid}
                  card={card}
                  index={i}
                  isNew={!ownedBeforePack.has(card.characterId)}
                  animate={animate}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
