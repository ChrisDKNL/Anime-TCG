import type { AccountPublic } from "@anime-tcg/shared/api";
import { useCallback, useMemo, useRef, useState } from "react";
import { useLogoutMutation } from "../hooks/useAccountMutations";
import { useSetSession } from "../hooks/useAccountSession";
import type { useCharacterPool } from "../hooks/useCharacterPool";
import { useInventory } from "../hooks/useInventory";
import { useFocusTarget, useShellContext } from "../hooks/useShell";
import { manageCopy, menuCopy } from "../lib/copy";
import { toFailure } from "../lib/failures";
import { openPack } from "../lib/pack";
import type { Card } from "../types";
import { AccountControl } from "./account/AccountControl";
import { ManageAccountDialog } from "./account/ManageAccountDialog";
import { BoosterPack } from "./BoosterPack";
import { CharacterCard } from "./CharacterCard";
import { Inventory } from "./Inventory";
import { PageFrame, type Frame } from "./PageFrame";

type Tab = "pack" | "collection";

interface Props {
  frame: Frame;
  account: AccountPublic;
  pool: ReturnType<typeof useCharacterPool>;
}

/**
 * The signed-in app (accounts.md §3.6): the pack and collection views as
 * before, plus the Account control, the Manage dialog and log-out. Mounted
 * only while the server reports a session, so signing out drops the reveal
 * grid and the in-memory collection with it.
 */
export function Game({ frame, account, pool }: Props) {
  const inventory = useInventory();
  const { announce, requestFocus, unreachable, clearNotice } = useShellContext();
  const setSession = useSetSession();
  const logoutMutation = useLogoutMutation();

  const [tab, setTab] = useState<Tab>("pack");
  const [opening, setOpening] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  /** The 5 cards from the most recent pack, shown in the reveal grid. */
  const [lastPack, setLastPack] = useState<Card[]>([]);
  /** Character ids the player owned *before* the last pack, to badge "NEW". */
  const [ownedBeforePack, setOwnedBeforePack] = useState<Set<number>>(() => new Set());

  const packButtonRef = useRef<HTMLButtonElement>(null);
  useFocusTarget("packButton", packButtonRef);

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

  /** Log out (§3.5.2): the server ends the session; if it cannot be reached the UI still drops to the Account screen. */
  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      clearNotice();
      announce(menuCopy.loggedOut);
    } catch (err) {
      toFailure(err);
      setSession({ signedIn: false });
      unreachable();
    }
    requestFocus("accountHeading");
  };

  const packSummary = useMemo(() => {
    const counts = { legendary: 0, rare: 0, common: 0 };
    for (const c of lastPack) counts[c.rarity] += 1;
    return counts;
  }, [lastPack]);

  return (
    <PageFrame
      frame={frame}
      headerRight={
        <div className="flex items-center justify-between gap-3 sm:items-end">
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
          <AccountControl
            login={account.login}
            disabled={opening || logoutMutation.isPending}
            onManage={() => setManageOpen(true)}
            onLogout={() => void handleLogout()}
          />
        </div>
      }
    >
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
            ref={packButtonRef}
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
                  />
                ))}
              </div>
            </section>
          )}
        </main>
      ) : (
        <main>
          <Inventory
            cards={inventory.cards}
            stats={inventory.stats}
            login={account.login}
            onClear={inventory.clear}
          />
        </main>
      )}

      <ManageAccountDialog
        open={manageOpen}
        account={account}
        onClose={() => {
          setManageOpen(false);
          requestFocus("accountControl");
        }}
        onRenamed={(renamed) => announce(manageCopy.loginChanged(renamed.login))}
        onDeleted={(login) => {
          announce(manageCopy.deleted(login));
          requestFocus("accountHeading");
        }}
      />
    </PageFrame>
  );
}
