import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCountdown } from "./useCountdown";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"],
  });
});
afterEach(() => vi.useRealTimers());

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("useCountdown", () => {
  it("is null without a deadline and starts no timer", () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts whole seconds down from the deadline, rounded up, on the second", () => {
    const endsAt = performance.now() + 2_500;
    const { result } = renderHook(() => useCountdown(endsAt));
    expect(result.current).toBe(3);
    advance(499);
    expect(result.current).toBe(3);
    advance(1);
    expect(result.current).toBe(2);
    advance(1_000);
    expect(result.current).toBe(1);
    advance(1_000);
    expect(result.current).toBe(0);
  });

  it("calls onEnd once at zero and then runs no timer at all", () => {
    const onEnd = vi.fn();
    const endsAt = performance.now() + 3_000;
    renderHook(() => useCountdown(endsAt, onEnd));
    advance(2_999);
    expect(onEnd).not.toHaveBeenCalled();
    advance(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    advance(60 * 60 * 1_000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("does not move when the device clock is changed: it reads the monotonic clock only", () => {
    const endsAt = performance.now() + 10_000;
    const { result } = renderHook(() => useCountdown(endsAt));
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1_000);
    advance(1_000);
    expect(result.current).toBe(9);
  });

  it("reads 0 and calls nothing for a deadline already past when it mounts", () => {
    const onEnd = vi.fn();
    const endsAt = performance.now() - 5;
    const { result } = renderHook(() => useCountdown(endsAt, onEnd));
    expect(result.current).toBe(0);
    advance(5_000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts from a new deadline, and an unmount stops it", () => {
    const onEnd = vi.fn();
    const { result, rerender, unmount } = renderHook(({ endsAt }) => useCountdown(endsAt, onEnd), {
      initialProps: { endsAt: performance.now() + 5_000 },
    });
    advance(2_000);
    expect(result.current).toBe(3);
    rerender({ endsAt: performance.now() + 10_000 });
    expect(result.current).toBe(10);
    unmount();
    advance(20_000);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("calls the newest onEnd", () => {
    const first = vi.fn();
    const second = vi.fn();
    const endsAt = performance.now() + 1_000;
    const { rerender } = renderHook(({ onEnd }) => useCountdown(endsAt, onEnd), {
      initialProps: { onEnd: first },
    });
    rerender({ onEnd: second });
    advance(1_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
