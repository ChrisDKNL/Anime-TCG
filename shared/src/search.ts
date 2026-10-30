/**
 * The search normalisation of collection-overview.md §3.3, which the
 * market's search applies on the server (economy.md §8.4): the api stores
 * every searched name and title in this form (`characters.search_name`,
 * `series.search_title` and their native twins) and normalises a query the
 * same way, so a query finds the same cards on the market as in the
 * collection. For matching only: what is shown is always the original.
 */

/** U+0300–U+036F, the Latin accents; the kana voiced marks (U+3099, U+309A) are outside it on purpose. */
const COMBINING_ACCENTS = /[\u0300-\u036f]/gu;
const WHITESPACE_RUN = /\s+/gu;

/** §3.3 step 1, in this order: NFKC, lower case, NFD, accents removed, NFC, trim, whitespace runs to one space. */
export function normaliseSearchText(text: string): string {
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
export function searchTermsOf(query: string): string[] {
  const normalised = normaliseSearchText(query);
  return normalised === "" ? [] : normalised.split(" ");
}
