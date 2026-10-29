import type { AccountPublic } from "@anime-tcg/shared/api";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAccount } from "../test/api";
import { makeCharacters } from "../test/fixtures";
import type { CharacterPool } from "./useCharacterPool";
import { useGameState } from "./useGame";

const account = makeAccount({ login: "Chris" });
const pool: CharacterPool = { status: "ready", characters: makeCharacters(12), reload: () => undefined };

afterEach(() => vi.useRealTimers());

describe("useGameState", () => {
  it("a pack opened before the session ended is dropped when the same account is back before it lands", () => {
    vi.useFakeTimers();
    const signedIn: { current: AccountPublic | null } = { current: account };
    const { result, rerender } = renderHook(({ current }) => useGameState(current, pool), {
      initialProps: signedIn,
    });
    act(() => result.current?.openPack());
    expect(result.current?.state.opening).toBe(true);

    // The session ends and the same account signs in again, all within the pack's landing delay.
    rerender({ current: null });
    expect(result.current).toBeNull();
    rerender({ current: account });
    act(() => {
      vi.runAllTimers();
    });

    expect(result.current?.state).toMatchObject({ opening: false, cards: [], lastPack: [], reveals: 0 });
    expect(result.current?.stats.total).toBe(0);
  });

  it("a pack opened in the current session lands", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGameState(account, pool));
    act(() => result.current?.openPack());
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current?.state.cards).toHaveLength(5);
    expect(result.current?.stats.total).toBe(5);
  });
});
