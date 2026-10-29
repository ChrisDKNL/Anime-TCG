const MINUTE_MS = 60_000;

/**
 * Per-route overrides from docs/design/accounts-api.md §6.6, per client
 * address, replacing the global bucket for that route. Only `max` and
 * `timeWindow`: the security plugin builds the limiter from exactly these.
 */
export const AUTH_RATE_LIMIT = { max: 10, timeWindow: MINUTE_MS } as const;
export const RENAME_RATE_LIMIT = { max: 30, timeWindow: MINUTE_MS } as const;
