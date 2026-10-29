import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

const SECOND_MS = 1000;

/** Whole seconds left until `endsAt`, rounded up; 0 once it has passed. */
function secondsLeft(endsAt: number): number {
  return Math.max(0, Math.ceil((endsAt - performance.now()) / SECOND_MS));
}

/**
 * A countdown to `endsAt`, a `performance.now()` time, so a wrong or changed
 * device clock does not move it (packs-page.md §3.2 step 1). The value is the
 * remaining time in whole seconds, rounded up, and changes once a second, on
 * the second; null without a deadline.
 *
 * `onEnd` runs once, when the countdown is seen to reach zero while this hook
 * is mounted. A deadline that has already passed when the hook mounts reads 0
 * and does not call it: whoever mounts the hook asks the server anyway, and a
 * second request for the same moment would be a poll.
 */
export function useCountdown(endsAt: number | null, onEnd?: () => void): number | null {
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const subscribe = useCallback(
    (notify: () => void) => {
      if (endsAt === null) return () => undefined;
      let timer: number | undefined;
      const schedule = () => {
        const left = endsAt - performance.now();
        if (left <= 0) return;
        // To the next whole second of the remaining time, so the display turns over exactly at zero.
        timer = window.setTimeout(
          () => {
            notify();
            if (endsAt - performance.now() <= 0) onEndRef.current?.();
            else schedule();
          },
          left % SECOND_MS || SECOND_MS,
        );
      };
      schedule();
      return () => window.clearTimeout(timer);
    },
    [endsAt],
  );

  const read = useCallback(() => (endsAt === null ? null : secondsLeft(endsAt)), [endsAt]);
  return useSyncExternalStore(subscribe, read);
}
