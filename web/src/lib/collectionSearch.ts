/**
 * The collection's search match rule (collection-overview.md §3.3), the same
 * normalisation `economy.md` §8.4 applies on the server for the market. It is
 * for matching only: everything on screen is the original string (§5.6 rule 8).
 */

/** §3.3 step 4: the search field accepts at most this many characters. */
export const SEARCH_MAX_LENGTH = 100;

/** U+0300–U+036F, the Latin accents; the kana voiced marks (U+3099, U+309A) are outside it on purpose. */
const COMBINING_ACCENTS = /[̀-ͯ]/g;
const WHITESPACE_RUN = /\s+/g;

/** §3.3 step 1, in this order: NFKC, lower case, NFD, accents removed, NFC, trim, whitespace runs to one space. */
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_ACCENTS, "")
    .normalize("NFC")
    .trim()
    .replace(WHITESPACE_RUN, " ");
}

/** §3.3 step 2: the normalised query split on spaces; an empty query has no terms and is no search. */
export function searchTerms(query: string): string[] {
  const normalised = normalise(query);
  return normalised === "" ? [] : normalised.split(" ");
}

/** §3.3 step 3: every term is a substring of at least one of the (already normalised) fields. */
export function matchesTerms(fields: readonly string[], terms: readonly string[]): boolean {
  return terms.every((term) => fields.some((field) => field.includes(term)));
}
