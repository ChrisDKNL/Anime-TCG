import { MARKET_SEARCH_TERMS } from "@anime-tcg/shared/economy";
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

/**
 * The query's first `MARKET_SEARCH_TERMS` distinct terms as `LIKE` patterns;
 * none for a query that normalises to nothing, which is no search. Terms
 * past the cap are dropped rather than refused: every term only narrows the
 * match, so dropping one can only widen the results, never fail a search
 * (manager decision, 2026-10-30).
 */
export function searchPatterns(query: string | undefined): string[] {
  if (query === undefined) return [];
  return [...new Set(searchTermsOf(query))].slice(0, MARKET_SEARCH_TERMS).map(containsPattern);
}
