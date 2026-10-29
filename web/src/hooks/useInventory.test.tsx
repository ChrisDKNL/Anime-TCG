import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeCard } from "../test/fixtures";
import { useInventory } from "./useInventory";

describe("useInventory", () => {
  it("starts empty and appends cards without replacing earlier ones", () => {
    const { result } = renderHook(() => useInventory());
    expect(result.current.cards).toEqual([]);

    act(() => result.current.addCards([makeCard({ uid: "a" })]));
    act(() => result.current.addCards([makeCard({ uid: "b", rarity: "rare" })]));

    expect(result.current.cards.map((c) => c.uid)).toEqual(["a", "b"]);
  });

  it("derives total, unique and per-rarity stats", () => {
    const { result } = renderHook(() => useInventory());
    act(() =>
      result.current.addCards([
        makeCard({ uid: "a", characterId: 1 }),
        makeCard({ uid: "b", characterId: 1, rarity: "legendary" }),
        makeCard({ uid: "c", characterId: 2, rarity: "rare" }),
      ]),
    );
    expect(result.current.stats).toEqual({
      total: 3,
      unique: 2,
      byRarity: { common: 1, rare: 1, legendary: 1 },
    });
  });

  it("neither reads nor writes the pre-accounts localStorage key", () => {
    localStorage.setItem("anime-tcg:inventory:v1", JSON.stringify([makeCard({ uid: "old" })]));
    const { result } = renderHook(() => useInventory());
    expect(result.current.cards).toEqual([]);

    act(() => result.current.addCards([makeCard({ uid: "fresh" })]));
    expect(JSON.parse(localStorage.getItem("anime-tcg:inventory:v1") ?? "[]")).toMatchObject([
      { uid: "old" },
    ]);
    expect(localStorage.length).toBe(1);
  });

  it("clear() empties the collection", () => {
    const { result } = renderHook(() => useInventory());
    act(() => result.current.addCards([makeCard()]));
    act(() => result.current.clear());
    expect(result.current.cards).toEqual([]);
    expect(result.current.stats.total).toBe(0);
  });

  it("ownedBefore() only reports characters pulled strictly before the timestamp", () => {
    const { result } = renderHook(() => useInventory());
    act(() =>
      result.current.addCards([
        makeCard({ uid: "old", characterId: 1, pulledAt: 100 }),
        makeCard({ uid: "new", characterId: 2, pulledAt: 200 }),
      ]),
    );
    const owned = result.current.ownedBefore(200);
    expect(owned.has(1)).toBe(true);
    expect(owned.has(2)).toBe(false);
  });
});
