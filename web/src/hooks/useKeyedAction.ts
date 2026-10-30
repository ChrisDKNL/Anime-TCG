import { useCallback, useRef, useState } from "react";
import { actionCopy } from "../lib/economyCopy";
import { failureOutcome, keepsKey, type Outcome } from "../lib/keyedAction";
import { useCountdown } from "./useCountdown";
import { useShellContext } from "./useShell";
import { useSingleFlight } from "./useSingleFlight";

const SECOND_MS = 1000;

export interface KeyedAction<R> {
  /**
   * Sends the request once: with the held key after an answer that kept it,
   * else with a new `crypto.randomUUID()`. Resolves with the outcome, or null
   * when a request was already in flight (a double click, a held Enter).
   */
  run: () => Promise<Outcome<R> | null>;
  /** `Cancel`: the key goes, so the next confirmation is a new request. */
  discard: () => void;
  sending: boolean;
  /** Seconds left of a 429's wait, or null when none runs. */
  wait: number | null;
}

/** A 429's wait: whoever outlives the confirmation holds it, so Cancel and re-opening keep it running. */
export interface RateLimitWait {
  /** Seconds left, or null when none runs. */
  seconds: number | null;
  start: (seconds: number) => void;
}

/** The wait from `Retry-After` on `performance.now()`; its end is announced once (collection-overview.md §8). */
export function useRateLimitWait(): RateLimitWait {
  const { announce } = useShellContext();
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const left = useCountdown(
    waitUntil,
    useCallback(() => announce(actionCopy.waitOver), [announce]),
  );
  const start = useCallback((seconds: number) => setWaitUntil(performance.now() + seconds * SECOND_MS), []);
  return { seconds: left !== null && left > 0 ? left : null, start };
}

/**
 * One balance-changing request behind a confirmation (a shop purchase, a
 * recycle) with its idempotency key, as 1c's pack opening holds its own
 * (packs-page.md §3.3, collection-overview.md §3.8 "Request ids"). The key is
 * a ref, created on the first press and kept only on no answer and on a 429
 * (`keepsKey`). A 429 starts `wait`, which the caller holds where it outlives
 * the confirmation (the Shop page, the card dialog), and which announces its end;
 * no answer raises the app's unreachable banner, which the next 201 or 200
 * clears; `unauthenticated` ends the session. Everything else is the caller's
 * to show from the outcome.
 */
export function useKeyedAction<R>(
  send: (requestId: string) => Promise<R>,
  wait: RateLimitWait,
): KeyedAction<R> {
  const { sessionEnded, unreachable, clearNotice } = useShellContext();
  const singleFlight = useSingleFlight();
  const key = useRef<string | null>(null);
  const [sending, setSending] = useState(false);

  const attempt = useCallback(async (): Promise<Outcome<R>> => {
    const requestId = key.current ?? crypto.randomUUID();
    key.current = requestId;
    setSending(true);
    try {
      return { kind: "answered", result: await send(requestId) };
    } catch (err) {
      return failureOutcome(err);
    } finally {
      setSending(false);
    }
  }, [send]);

  const { start: startWait } = wait;
  const run = useCallback(async () => {
    let outcome: Outcome<R> | null = null;
    await singleFlight(async () => {
      const settled = await attempt();
      outcome = settled;
      if (!keepsKey(settled)) key.current = null;
      switch (settled.kind) {
        case "answered":
          // The server answered: a banner a lost answer raised no longer holds (packs-page.md §4.1).
          clearNotice();
          break;
        case "noAnswer":
          unreachable();
          break;
        case "sessionEnded":
          sessionEnded();
          break;
        case "rateLimited":
          startWait(settled.seconds);
          break;
        case "refused":
          break;
      }
    });
    return outcome;
  }, [singleFlight, attempt, clearNotice, unreachable, sessionEnded, startWait]);

  const discard = useCallback(() => {
    key.current = null;
  }, []);

  return { run, discard, sending, wait: wait.seconds };
}
