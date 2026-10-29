import { useCallback, useRef } from "react";

/**
 * One submit at a time per form (accounts.md §7 "Forms"). The flag is a ref,
 * not state, so a second activation in the same task (two `click()` calls
 * before React re-renders) already sees the first one and does nothing.
 */
export function useSingleFlight(): (task: () => Promise<void>) => Promise<void> {
  const running = useRef(false);
  return useCallback(async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    try {
      await task();
    } finally {
      running.current = false;
    }
  }, []);
}
