import { describe, expect, it } from "vitest";
import { makeCard } from "../test/fixtures";
import { collectionStats, gameReducer, initialGame, ownedBefore, type GameState } from "./game";

const CHRIS = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const KRIS = "9b2d7c1e-0000-4000-8000-000000000002";

function opened(state: GameState, cards: ReturnType<typeof makeCard>[], accountId = CHRIS): GameState {
  const started = gameReducer(state, { type: "openStarted", accountId, at: cards[0]?.pulledAt ?? 0 });
  return gameReducer(started, { type: "packLanded", accountId, cards });
}

describe("gameReducer", () => {
  it("starts empty for the account", () => {
    expect(initialGame(CHRIS)).toEqual({
      accountId: CHRIS,
      cards: [],
      lastPack: [],
      ownedBeforePack: new Set(),
      opening: false,
      reveals: 0,
    });
  });

  it("opening clears the reveal and marks the opening; landing appends without replacing earlier cards", () => {
    let state = opened(initialGame(CHRIS), [makeCard({ uid: "a", pulledAt: 100 })]);
    state = gameReducer(state, { type: "openStarted", accountId: CHRIS, at: 200 });
    expect(state.opening).toBe(true);
    expect(state.lastPack).toEqual([]);

    state = gameReducer(state, {
      type: "packLanded",
      accountId: CHRIS,
      cards: [makeCard({ uid: "b", rarity: "rare", pulledAt: 200 })],
    });
    expect(state.opening).toBe(false);
    expect(state.cards.map((c) => c.uid)).toEqual(["a", "b"]);
    expect(state.lastPack.map((c) => c.uid)).toEqual(["b"]);
    expect(state.reveals).toBe(2);
  });

  it("takes the owned set before the new cards land, so New is right for back-to-back packs", () => {
    let state = opened(initialGame(CHRIS), [makeCard({ uid: "a", characterId: 1, pulledAt: 100 })]);
    state = gameReducer(state, { type: "openStarted", accountId: CHRIS, at: 200 });
    expect([...state.ownedBeforePack]).toEqual([1]);
  });

  it("ignores a pack that lands for another account (an account switch mid-opening)", () => {
    const started = gameReducer(initialGame(CHRIS), { type: "openStarted", accountId: CHRIS, at: 100 });
    const switched = gameReducer(started, { type: "reset", accountId: KRIS });
    const late = gameReducer(switched, { type: "packLanded", accountId: CHRIS, cards: [makeCard()] });
    expect(late).toBe(switched);
    expect(late.cards).toEqual([]);
    expect(gameReducer(late, { type: "cleared", accountId: CHRIS })).toBe(late);
  });

  it("a reset drops everything, and signed out there is no account to act for", () => {
    const state = opened(initialGame(CHRIS), [makeCard()]);
    const signedOut = gameReducer(state, { type: "reset", accountId: null });
    expect(signedOut).toEqual(initialGame(null));
    expect(gameReducer(signedOut, { type: "openStarted", accountId: CHRIS, at: 1 })).toBe(signedOut);
  });

  it("cleared empties the collection and keeps the last reveal", () => {
    const state = gameReducer(opened(initialGame(CHRIS), [makeCard()]), {
      type: "cleared",
      accountId: CHRIS,
    });
    expect(state.cards).toEqual([]);
    expect(state.lastPack).toHaveLength(1);
  });

  it("neither reads nor writes the pre-accounts localStorage key", () => {
    localStorage.setItem("anime-tcg:inventory:v1", JSON.stringify([makeCard({ uid: "old" })]));
    const state = opened(initialGame(CHRIS), [makeCard({ uid: "fresh" })]);
    expect(state.cards.map((c) => c.uid)).toEqual(["fresh"]);
    expect(JSON.parse(localStorage.getItem("anime-tcg:inventory:v1") ?? "[]")).toMatchObject([
      { uid: "old" },
    ]);
    expect(localStorage.length).toBe(1);
  });
});

describe("collectionStats", () => {
  it("derives total, unique and per-rarity counts", () => {
    expect(
      collectionStats([
        makeCard({ uid: "a", characterId: 1 }),
        makeCard({ uid: "b", characterId: 1, rarity: "legendary" }),
        makeCard({ uid: "c", characterId: 2, rarity: "rare" }),
      ]),
    ).toEqual({ total: 3, unique: 2, byRarity: { common: 1, rare: 1, legendary: 1 } });
    expect(collectionStats([])).toEqual({
      total: 0,
      unique: 0,
      byRarity: { common: 0, rare: 0, legendary: 0 },
    });
  });
});

describe("ownedBefore", () => {
  it("only reports characters pulled strictly before the timestamp", () => {
    const owned = ownedBefore(
      [
        makeCard({ uid: "old", characterId: 1, pulledAt: 100 }),
        makeCard({ uid: "new", characterId: 2, pulledAt: 200 }),
      ],
      200,
    );
    expect(owned.has(1)).toBe(true);
    expect(owned.has(2)).toBe(false);
  });
});
