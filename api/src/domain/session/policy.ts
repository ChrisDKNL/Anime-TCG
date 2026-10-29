const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Cookie Max-Age and row lifetime; the row slides forward on activity. */
export const SESSION_TTL_MS = 30 * DAY_MS;
/**
 * A session dies this long after `created_at` however active it is. The
 * cookie's Max-Age slides, so this bound exists only on the server.
 */
export const SESSION_ABSOLUTE_LIFETIME_MS = 90 * DAY_MS;
/** `last_seen_at` is written at most this often, so an active user is one write per 5 minutes, not per request. */
export const TOUCH_INTERVAL_MS = 5 * MINUTE_MS;
export const PURGE_INTERVAL_MS = 60 * MINUTE_MS;

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

/** Sessions created at or before this instant have outlived the absolute lifetime. */
export function absoluteCutoff(now: Date): Date {
  return new Date(now.getTime() - SESSION_ABSOLUTE_LIFETIME_MS);
}

export function isDueForTouch(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;
}
