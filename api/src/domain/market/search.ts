import { searchTermsOf } from "@anime-tcg/shared/search";

/**
 * The market's search (economy.md §8.4): the query in the normalisation the
 * stored `search_*` columns hold, split into terms, each matched as a
 * substring through `LIKE ... ESCAPE '\'`. Escaping the three characters
 * `LIKE` gives a meaning (`%`, `_` and the escape itself) makes every term
 * literal text: a term is never a pattern and never SQL.
 */

/** The character `LIKE` patterns here escape with; the queries name it in their `ESCAPE` clause. */
export const LIKE_ESCAPE = "\\";

const LIKE_SPECIAL = /[\\%_]/gu;

/** `%term%` with every `%`, `_` and `\` in the term escaped, so the pattern matches the term as written. */
export function containsPattern(term: string): string {
  return `%${term.replace(LIKE_SPECIAL, (special) => `${LIKE_ESCAPE}${special}`)}%`;
}

/** The query's terms as `LIKE` patterns; none for a query that normalises to nothing, which is no search. */
export function searchPatterns(query: string | undefined): string[] {
  return query === undefined ? [] : searchTermsOf(query).map(containsPattern);
}
