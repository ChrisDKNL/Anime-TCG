import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDelayedFlag } from "./useDelayedFlag";

describe("useDelayedFlag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays false until the delay has elapsed, then true while active", () => {
    const { result } = renderHook(({ active }) => useDelayedFlag(active, 300), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it("never turns true when active ends before the delay, and resets for the next activation", () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 300), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);

    rerender({ active: true });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);
  });
});
