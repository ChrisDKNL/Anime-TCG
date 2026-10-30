/**
 * The words the copy specs forbid, for the copy tests: navigation-and-landing.md
 * §8 "Words", the accounts words (accounts.md §8), and collection-overview.md
 * §8's money words and casino nudges.
 */
export const FORBIDDEN_WORDS: readonly RegExp[] = [
  /secure|verif|protect|safe|privat|attempt|locked|blocked/i,
  /\bpay\b/i,
  /\bpaid\b/i,
  /\bcash\b/i,
  /\bmoney\b/i,
  /\bcoins?\b/i,
  /\bearn/i,
  /\bprofit/i,
  /\bworth\b/i,
  /\bvalue\b/i,
  /\bbalance\b/i,
  /\bwallet\b/i,
  /\bstore\b/i,
  /\bcheckout\b/i,
  /\bpurchase/i,
  /\bfranchise/i,
  /[$€£¥]/,
  /!/,
  /\bhurry\b/i,
  /\bact now\b/i,
  /\btoday only\b/i,
  /\bending soon\b/i,
  /\blast chance\b/i,
  /\bbefore it's gone\b/i,
  /\bdon't miss\b/i,
  /\bonly \d+ left\b/i,
  /\brare find\b/i,
  /\bfew on the market\b/i,
  /\bselling fast\b/i,
  /\blimited\b/i,
  /\blucky\b/i,
  /\bjackpot\b/i,
  /\bwin\b/i,
  /\bprize\b/i,
  /\byou could get\b/i,
  /\btry your luck\b/i,
  /\bone more\b/i,
  /\banother\b/i,
  /\bdeal\b/i,
  /\bbargain\b/i,
  /\bdiscount\b/i,
  /\bsave\b/i,
  /\bcheap\b/i,
  /\bsteal\b/i,
  /\bstreak/i,
  /\balmost\b/i,
  /\bsoon\b/i,
];

/** A copy module's plain strings and the paths of its functions, however deeply nested. */
export function walkCopy(value: unknown, path = ""): { strings: string[]; functions: string[] } {
  const strings: string[] = [];
  const functions: string[] = [];
  const visit = (node: unknown, at: string) => {
    if (typeof node === "string") strings.push(node);
    else if (typeof node === "function") functions.push(at);
    else if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node)) visit(child, at === "" ? key : `${at}.${key}`);
    }
  };
  visit(value, path);
  return { strings, functions };
}
