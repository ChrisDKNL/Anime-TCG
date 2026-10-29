import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRetryWait } from "./useRetryWait";

describe("useRetryWait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts down from the server's seconds to 1, then ends once", () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useRetryWait(onEnd));
    expect(result.current.remaining).toBeNull();

    act(() => {
      result.current.start(3);
    });
    expect(result.current.remaining).toBe(3);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.remaining).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.remaining).toBe(1);
    expect(onEnd).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.remaining).toBeNull();
    expect(onEnd).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("calls the latest onEnd without restarting the interval", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ onEnd }) => useRetryWait(onEnd), {
      initialProps: { onEnd: first },
    });
    act(() => {
      result.current.start(2);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rerender({ onEnd: second });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops ticking when unmounted", () => {
    const onEnd = vi.fn();
    const { result, unmount } = renderHook(() => useRetryWait(onEnd));
    act(() => {
      result.current.start(1);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onEnd).not.toHaveBeenCalled();
  });
});
