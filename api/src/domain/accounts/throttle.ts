/**
 * The sign-in breather (docs/design/accounts-api.md §6.3) as a pure state
 * machine. The store in throttle-store.ts persists it per normalised login
 * so a reload, a second tab or a restarted api does not reset it.
 */

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;

/** The miss that starts the breather; the count starts over once it does. */
export const THROTTLE_MAX_FAILURES = 5;
export const THROTTLE_BLOCK_MS = 10 * SECOND_MS;
/** A row nobody has touched for this long is noise and is swept by the hourly purge. */
export const THROTTLE_ROW_TTL_MS = HOUR_MS;

export interface ThrottleState {
  /** Wrong passwords since the last success or breather, 0..4. */
  failures: number;
  blockedUntil: Date | null;
}

export const NO_FAILURES: ThrottleState = { failures: 0, blockedUntil: null };

/**
 * How many whole seconds a blocked login still has to wait, or null when it
 * may try. Rounded up so a remainder of 0.2 s is reported as 1, never 0, and
 * capped at the breather's own length whatever the clocks say.
 */
export function retryAfterSeconds(state: ThrottleState, now: Date): number | null {
  if (state.blockedUntil === null) return null;
  const remainingMs = state.blockedUntil.getTime() - now.getTime();
  if (remainingMs <= 0) return null;
  return Math.min(Math.ceil(remainingMs / SECOND_MS), THROTTLE_BLOCK_MS / SECOND_MS);
}

/** The state after one more wrong password: the fifth miss in a row starts the breather and resets the count. */
export function recordFailure(state: ThrottleState, now: Date): ThrottleState {
  const failures = state.failures + 1;
  if (failures >= THROTTLE_MAX_FAILURES) {
    return { failures: 0, blockedUntil: new Date(now.getTime() + THROTTLE_BLOCK_MS) };
  }
  return { failures, blockedUntil: null };
}

/** Rows last updated at or before this instant are stale. */
export function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - THROTTLE_ROW_TTL_MS);
}
