import { LEGACY_RARITIES as RARITIES, type LegacyRarity as Rarity } from "@anime-tcg/shared/rarity";
import type { Card } from "../types";

/**
 * The signed-in account's game state (navigation-and-landing.md §3.10): the
 * in-memory collection, the last pack's reveal and whether a pack is opening.
 * It belongs to one session of one account: every action names the account
 * and the session it was started in, and an action for any other (a pack that
 * lands after a log-out, a session end or an account switch, even once the
 * same account has signed in again) changes nothing. Held in memory only until roadmap 1c moves
 * the collection to the server (ADR 0008); the pre-accounts
 * `anime-tcg:inventory:v1` key is neither read nor touched (accounts.md §3.1.3).
 */
export interface GameState {
  accountId: string | null;
  /** Counts the resets: each sign-in, sign-out and account change starts a new session of the game. */
  session: number;
  /** Flat and append-only: every pull is its own entry with its own `uid`. */
  cards: readonly Card[];
  /** The five cards of the most recent pack, shown on `/packs` until the next one. */
  lastPack: readonly Card[];
  /** Character ids owned before the last pack, to badge `New`. */
  ownedBeforePack: ReadonlySet<number>;
  opening: boolean;
  /** How many packs have landed; a reveal that lands while `/packs` is showing animates, one found on return does not. */
  reveals: number;
}

/** Whose game an action is for: the account and the session it was started in. */
export interface GameOwner {
  accountId: string;
  session: number;
}

export type GameAction =
  | { type: "reset"; accountId: string | null }
  | ({ type: "openStarted"; at: number } & GameOwner)
  | ({ type: "packLanded"; cards: readonly Card[] } & GameOwner)
  | ({ type: "cleared" } & GameOwner);

export function initialGame(accountId: string | null, session = 0): GameState {
  return {
    accountId,
    session,
    cards: [],
    lastPack: [],
    ownedBeforePack: new Set(),
    opening: false,
    reveals: 0,
  };
}

/** The state a reset leads to: empty, for `accountId`, in the next session. */
export function nextGame(state: GameState, accountId: string | null): GameState {
  return initialGame(accountId, state.session + 1);
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  if (action.type === "reset") return nextGame(state, action.accountId);
  if (action.accountId !== state.accountId || action.session !== state.session) return state;
  switch (action.type) {
    case "openStarted":
      // Ownership is taken before the cards are appended, so `New` stays right for back-to-back packs.
      return { ...state, opening: true, lastPack: [], ownedBeforePack: ownedBefore(state.cards, action.at) };
    case "packLanded":
      return {
        ...state,
        opening: false,
        cards: [...state.cards, ...action.cards],
        lastPack: action.cards,
        reveals: state.reveals + 1,
      };
    case "cleared":
      return { ...state, cards: [] };
  }
}

export interface CollectionStats {
  total: number;
  unique: number;
  byRarity: Record<Rarity, number>;
}

export function collectionStats(cards: readonly Card[]): CollectionStats {
  const byRarity = Object.fromEntries(RARITIES.map((r) => [r, 0])) as Record<Rarity, number>;
  const uniqueIds = new Set<number>();
  for (const c of cards) {
    byRarity[c.rarity] += 1;
    uniqueIds.add(c.characterId);
  }
  return { total: cards.length, unique: uniqueIds.size, byRarity };
}

/** Character ids pulled strictly before `timestamp`. */
export function ownedBefore(cards: readonly Card[], timestamp: number): Set<number> {
  return new Set(cards.filter((c) => c.pulledAt < timestamp).map((c) => c.characterId));
}
