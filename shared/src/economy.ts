/**
 * The game's numbers, in one file as ADR 0004 asks (docs/design/collection-packs.md
 * §4.2; the economy adds its own here). The server applies them; the web app
 * may not import this module (ESLint `no-restricted-imports`) and shows what
 * the api answers instead.
 */

/** Cards per pack, all different characters. */
export const PACK_SIZE = 5;
/** One pack accrues per interval. */
export const PACK_INTERVAL_MINUTES = 10;
/** Packs stored at most; a new account starts with this many. */
export const PACK_CAP = 3;
