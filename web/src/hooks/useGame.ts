import type { AccountPublic } from "@anime-tcg/shared/api";
import { createContext, useCallback, useContext, useMemo, useReducer } from "react";
import { collectionStats, gameReducer, initialGame, type CollectionStats, type GameState } from "../lib/game";
import { openPack } from "../lib/pack";
import type { CharacterPool } from "./useCharacterPool";

/** The pause between pressing the pack button and the cards landing, for the feel of tearing the pack. */
const REVEAL_DELAY_MS = 350;

export interface Game {
  /** The signed-in account, as the session query last named it (a rename updates it here too). */
  account: AccountPublic;
  state: GameState;
  stats: CollectionStats;
  pool: CharacterPool;
  openPack: () => void;
  clearCollection: () => void;
}

/**
 * The signed-in account's game state, held by the root layout so it survives
 * every page change, the not-found page included (navigation-and-landing.md
 * §3.10). A different account (or none) resets it during render, the way a
 * keyed remount would, but without remounting the pages around it. A pack
 * that is still landing when the account changes is dropped by the reducer.
 */
export function useGameState(account: AccountPublic | null, pool: CharacterPool): Game | null {
  const accountId = account?.id ?? null;
  const [stored, dispatch] = useReducer(gameReducer, accountId, initialGame);
  if (stored.accountId !== accountId) dispatch({ type: "reset", accountId });
  const state = stored.accountId === accountId ? stored : initialGame(accountId);

  const { opening } = state;
  const open = useCallback(() => {
    if (accountId === null || pool.status !== "ready" || opening) return;
    const cards = openPack(pool.characters);
    dispatch({ type: "openStarted", accountId, at: cards[0]?.pulledAt ?? Date.now() });
    // Dispatched whatever page is showing by then: the reveal waits on /packs (§3.5 step 4).
    window.setTimeout(() => dispatch({ type: "packLanded", accountId, cards }), REVEAL_DELAY_MS);
  }, [accountId, pool, opening]);

  const clearCollection = useCallback(() => {
    if (accountId !== null) dispatch({ type: "cleared", accountId });
  }, [accountId]);

  const stats = useMemo(() => collectionStats(state.cards), [state.cards]);

  return useMemo(
    () => (account === null ? null : { account, state, stats, pool, openPack: open, clearCollection }),
    [account, state, stats, pool, open, clearCollection],
  );
}

export const GameContext = createContext<Game | null>(null);

/** The game of the signed-in account; only account pages call it, and they render only with a session. */
export function useGame(): Game {
  const game = useContext(GameContext);
  if (game === null) throw new Error("useGame needs a signed-in GameContext");
  return game;
}

/** The game when someone is signed in, or null: for the parts that render either way (the not-found page). */
export function useOptionalGame(): Game | null {
  return useContext(GameContext);
}
