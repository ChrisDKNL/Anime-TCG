import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSingleFlight } from "./useSingleFlight";

function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("useSingleFlight", () => {
  it("ignores a second call made in the same task while the first is pending", async () => {
    const { result } = renderHook(() => useSingleFlight());
    const hold = deferred();
    const task = vi.fn(() => hold.promise);

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current(task);
      second = result.current(task);
    });
    expect(task).toHaveBeenCalledTimes(1);

    hold.release();
    await act(() => Promise.all([first, second]));
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs again once the previous task has settled, also after it threw", async () => {
    const { result } = renderHook(() => useSingleFlight());
    const failing = vi.fn(() => Promise.reject(new Error("boom")));
    await expect(result.current(failing)).rejects.toThrow("boom");

    const next = vi.fn(() => Promise.resolve());
    await result.current(next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
