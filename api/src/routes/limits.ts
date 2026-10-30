const MINUTE_MS = 60_000;

/**
 * Per-route overrides from docs/design/accounts-api.md §6.6, per client
 * address, replacing the global bucket for that route. Only `max` and
 * `timeWindow`: the security plugin builds the limiter from exactly these.
 */
export const AUTH_RATE_LIMIT = { max: 10, timeWindow: MINUTE_MS } as const;
export const RENAME_RATE_LIMIT = { max: 30, timeWindow: MINUTE_MS } as const;
/**
 * Opening a pack (collection-packs.md §6.3). The allowance is the real limit;
 * this bounds lock contention from a script and leaves room for a full
 * allowance, retries and a second tab.
 */
export const PACK_RATE_LIMIT = { max: 20, timeWindow: MINUTE_MS } as const;
/**
 * Opening a demo pack (navigation-and-landing.md §3.8 item 5), the real bound
 * on demo packs: the page's count of `DEMO_PACKS_PER_VISIT` lives in the
 * browser and a reload resets it. At least twice that a minute, so one visit
 * opened as fast as the button allows, plus a reload, is never refused; the
 * limit bounds what a script costs a public route that reads the database.
 */
export const DEMO_RATE_LIMIT = { max: 20, timeWindow: MINUTE_MS } as const;
