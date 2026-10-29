import { useEffect, useState } from "react";

/**
 * True once `active` has been true for `delayMs` without interruption; false
 * again the moment `active` drops. Used for the boot `Loading…` text, which
 * only appears when the session check takes longer than 300 ms (§4.1).
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setElapsed(true), delayMs);
    return () => window.clearTimeout(id);
  }, [active, delayMs]);

  // Reset during render so the next activation waits the full delay again.
  if (!active && elapsed) setElapsed(false);

  return active && elapsed;
}
