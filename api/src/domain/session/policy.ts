const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Cookie Max-Age and row lifetime; the row slides forward on activity. */
export const SESSION_TTL_MS = 30 * DAY_MS;
/** `last_seen_at` is written at most this often, so an active user is one write per 5 minutes, not per request. */
export const TOUCH_INTERVAL_MS = 5 * MINUTE_MS;
export const PURGE_INTERVAL_MS = 60 * MINUTE_MS;

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

export function isDueForTouch(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;
}
