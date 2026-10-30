/**
 * The collection's search match rule (collection-overview.md §3.3). The
 * normalisation itself is `@anime-tcg/shared/search`, the one the api applies
 * to the market's search (economy.md §8.4), so a query finds the same cards
 * in both. It is for matching only: everything on screen is the original
 * string (§5.6 rule 8).
 */

/** §3.3 step 4: the search field accepts at most this many characters (the market's too, `ListingsQuery.q`). */
export const SEARCH_MAX_LENGTH = 100;

/** §3.3 step 3: every term is a substring of at least one of the (already normalised) fields. */
export function matchesTerms(fields: readonly string[], terms: readonly string[]): boolean {
  return terms.every((term) => fields.some((field) => field.includes(term)));
}
