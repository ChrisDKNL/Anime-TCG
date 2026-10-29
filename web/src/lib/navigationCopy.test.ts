import { describe, expect, it } from "vitest";
import * as navigation from "./navigationCopy";
import * as routes from "./routes";

/**
 * navigation-and-landing.md §8 "Words": the accounts words, the money and
 * nudge words of collection-overview.md §8, and no exclamation mark, across
 * every string the navigation shows (the route list's titles, headings and
 * guard lines included).
 */
const ACCOUNTS_WORDS = /secure|verif|protect|safe|privat|attempt|locked|blocked/i;
const MONEY_AND_NUDGE = [
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
  /[$€£¥]/,
  /!/,
  /\bhurry\b/i,
  /\bact now\b/i,
  /\btoday only\b/i,
  /\bending soon\b/i,
  /\blast chance\b/i,
  /\bdon't miss\b/i,
  /\bonly \d+ left\b/i,
  /\blimited\b/i,
  /\bfree\b/i,
  /\blucky\b/i,
  /\bjackpot\b/i,
  /\bwin\b/i,
  /\bprize\b/i,
  /\byou could get\b/i,
  /\btry your luck\b/i,
  /\bone more\b/i,
  /\banother\b/i,
];

/** Every string reachable in a module's exports, however deeply nested. */
function strings(value: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, i) => strings(item, `${path}[${i}]`, out));
  else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) strings(child, `${path}.${key}`, out);
  }
  return out;
}

const pagePaths = [...Object.keys(routes.PUBLIC_PAGES), ...Object.keys(routes.ACCOUNT_PAGES)];

const rendered: Array<[string, string]> = [
  ...strings(navigation, "navigation", []),
  ...strings(routes, "routes", []).filter(([path]) => /heading|guardLine|title|BOOT_TITLE/.test(path)),
  ...pagePaths.map((path): [string, string] => [`title ${path}`, routes.pageTitle(path)]),
];

describe("navigation copy (§8)", () => {
  it("covers the headings, titles, guard lines, header, landing, profile and not-found strings", () => {
    const texts = rendered.map(([, text]) => text);
    for (const expected of [
      "Packs",
      "Manage account",
      "Manage account · Anime TCG",
      "Page not found · Anime TCG",
      "Log in to open your packs.",
      "Skip to content",
      "How it plays",
      "Your profile isn't here yet.",
      "There's no page at this address.",
    ]) {
      expect(texts).toContain(expected);
    }
  });

  it("contains none of the words §8 forbids", () => {
    const offenders = rendered.filter(
      ([, text]) => ACCOUNTS_WORDS.test(text) || MONEY_AND_NUDGE.some((word) => word.test(text)),
    );
    expect(offenders).toEqual([]);
  });

  it("the landing page holds no number of its own: the facts come from the server in the demo PR", () => {
    const landing = strings(navigation.landingCopy, "landing", []);
    expect(landing.filter(([, text]) => /\d/.test(text))).toEqual([]);
  });

  it("writes the footer sentence around its AniList link", () => {
    const { before, link, after } = navigation.footerCopy;
    expect(`${before}${link}${after}`).toBe(
      "Non-commercial fan project. Character images and titles © their respective owners, served via the AniList API.",
    );
  });
});
