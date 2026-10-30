import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The server-enforced wait after repeated password misses (§3.4.3) or the
 * rate limiter (§4.4-D). The UI never invents one: `start(seconds)` is only
 * called with the server's seconds (or §4.4-D's 60 when a 429 names none),
 * counts down to 1 and then calls `onEnd` once. On the next submit the server
 * is asked again and answers with fresh seconds.
 */
export function useRetryWait(onEnd: () => void): {
  remaining: number | null;
  start: (seconds: number) => void;
} {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const onEndRef = useRef(onEnd);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    if (deadline === null) return;
    const id = window.setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left > 0) {
        setRemaining(left);
        return;
      }
      setDeadline(null);
      setRemaining(null);
      onEndRef.current();
    }, 1000);
    return () => window.clearInterval(id);
  }, [deadline]);

  const start = useCallback((seconds: number) => {
    setDeadline(Date.now() + seconds * 1000);
    setRemaining(seconds);
  }, []);

  return { remaining, start };
}
