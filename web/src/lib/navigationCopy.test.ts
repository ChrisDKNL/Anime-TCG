import { describe, expect, it } from "vitest";
import { makeDemo, makeUnavailableDemo } from "../test/fixtures";
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

const pagePaths = [
  ...Object.keys(routes.PUBLIC_PAGES),
  ...Object.keys(routes.ACCOUNT_PAGES),
  ...Object.keys(routes.OPENING_PAGES),
];

const { landingCopy, demoCopy, landingText } = navigation;

/** Every function of the landing copy, called with the server's figures, so its output is scanned too. */
const landingFunctions: Array<[string, string]> = [
  ["ledeWithFacts", landingCopy.ledeWithFacts(2_983, 100)],
  ["packsRowWithFacts", landingCopy.packsRowWithFacts(600, 3)],
  ["collectionRowWithFacts", landingCopy.collectionRowWithFacts(2_983)],
  ["stepNumber", landingCopy.stepNumber(4)],
  ["odds.figure", landingCopy.odds.figure(999_704, 1_000_000)],
  ["odds.source", landingCopy.odds.source(2_983, "2026-10-29T08:00:00.000Z")],
  ["demo.waitButton", demoCopy.waitButton(12)],
  ["demo.announce", demoCopy.announce(["common", "common", "common", "uncommon", "mythic"])],
  ...[makeDemo(), makeUnavailableDemo(), undefined].flatMap((facts, i) => {
    const text = landingText(facts);
    return [
      [`landingText[${i}].lede`, text.lede] as [string, string],
      ...text.rows.map((row): [string, string] => [`landingText[${i}].${row.term}`, row.text]),
    ];
  }),
];

const rendered: Array<[string, string]> = [
  ...strings(navigation, "navigation", []),
  ...landingFunctions,
  ...strings(routes, "routes", []).filter(([path]) =>
    /heading|eyebrow|guardLine|title|BOOT_TITLE/.test(path),
  ),
  ...pagePaths.map((path): [string, string] => [`title ${path}`, routes.pageTitle(path)]),
];

describe("navigation copy (§8)", () => {
  it("covers the headings, eyebrows, titles, guard lines, header, landing, profile and not-found strings", () => {
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
      "Every character has one of six tiers, set by how many AniList users favourited them.",
      "Demo pack · Anime TCG",
      "Pack opening · Anime TCG",
      "Shop pack · Anime TCG",
      "Back to the landing page",
      "Five cards",
      "Recycle duplicates for Karma and spend it on themed packs. Karma comes only from playing. It can't be bought.",
      "List cards for other players to buy with Karma, and buy theirs.",
      "Anime character cards",
      "Invite only",
      "Player trades",
      "404",
    ]) {
      expect(texts).toContain(expected);
    }
  });

  it('numbers the steps with two digits, in the order they exist (§8 "Step numbers")', () => {
    expect([1, 2, 3, 4, 10].map(landingCopy.stepNumber)).toEqual(["01", "02", "03", "04", "10"]);
    expect(landingText(makeDemo()).rows.map((row) => row.term)).toEqual([
      "Packs",
      "Rarity",
      "Collection",
      "Karma",
      "Market",
    ]);
  });

  it("contains none of the words §8 forbids", () => {
    const offenders = rendered.filter(
      ([, text]) => ACCOUNTS_WORDS.test(text) || MONEY_AND_NUDGE.some((word) => word.test(text)),
    );
    expect(offenders).toEqual([]);
  });

  it("the landing page holds no number of its own: every number comes from the server's facts", () => {
    const landing = [...strings(landingCopy, "landing", []), ...strings(demoCopy, "demo", [])];
    expect(landing.filter(([, text]) => /\d/.test(text))).toEqual([]);
    expect(landingText(undefined).lede).not.toMatch(/\d/);
    expect(landingText(undefined).rows.filter((row) => /\d/.test(row.text))).toEqual([]);
  });

  it("writes §8's landing strings with the server's figures", () => {
    const text = landingText(makeDemo());
    expect(text.lede).toBe("2,983 characters from the 100 most popular anime on AniList, five to a pack.");
    expect(text.rows).toEqual([
      { term: "Packs", text: "A new pack every 10 minutes, and up to 3 can pile up. Five cards each." },
      {
        term: "Rarity",
        text: "Every character has one of six tiers, set by how many AniList users favourited them. Every pack uses the odds below.",
      },
      {
        term: "Collection",
        text: "See how much of each series you have, and how much of all 2,983 characters.",
      },
      {
        term: "Karma",
        text: "Recycle duplicates for Karma and spend it on themed packs. Karma comes only from playing. It can't be bought.",
      },
      { term: "Market", text: "List cards for other players to buy with Karma, and buy theirs." },
    ]);
    expect(landingCopy.odds.source(2_983, "2026-10-29T08:00:00.000Z")).toBe(
      "Drawn from 2,983 characters, as of 29 Oct 2026.",
    );
    expect(demoCopy.announce(["common", "common", "common", "uncommon", "rare"])).toBe(
      "Demo pack: 1 Rare, 1 Uncommon and 3 Common.",
    );
    const { before, link, after } = demoCopy.keepCards;
    expect(`${before}${link}${after}`).toBe("To keep cards, register with an invite code.");
  });

  it("without a pool keeps the allowance's numbers, which the answer still carries, and drops the rest", () => {
    const text = landingText(makeUnavailableDemo());
    expect(text.lede).toBe("Characters from the most popular anime on AniList, five to a pack.");
    expect(text.rows.map((row) => row.text)).toEqual([
      "A new pack every 10 minutes, and up to 3 can pile up. Five cards each.",
      "Every character has one of six tiers, set by how many AniList users favourited them.",
      "See how much of each series you have, and of the whole pool.",
      "Recycle duplicates for Karma and spend it on themed packs. Karma comes only from playing. It can't be bought.",
      "List cards for other players to buy with Karma, and buy theirs.",
    ]);
    expect(landingText(undefined).rows[0]?.text).toBe(
      "A new pack on a timer, and a few can pile up. Five cards each.",
    );
  });

  it.each([
    [60, "1 minute"],
    [600, "10 minutes"],
    [3_540, "59 minutes"],
    [3_600, "1 hour"],
    [5_400, "90 minutes"],
    [7_200, "2 hours"],
  ])("writes an interval of %i s as `%s`", (seconds, expected) => {
    expect(navigation.interval(seconds)).toBe(expected);
  });

  it("writes the odds as three significant digits, never rounded up", () => {
    const figure = landingCopy.odds.figure;
    expect([999_704, 1_000_000, 800_000, 27_500, 2_500, 500].map((part) => figure(part, 1_000_000))).toEqual([
      "99.9%",
      "100%",
      "80%",
      "2.75%",
      "0.25%",
      "0.05%",
    ]);
  });

  it("writes the footer sentence around its AniList link", () => {
    const { before, link, after } = navigation.footerCopy;
    expect(`${before}${link}${after}`).toBe(
      "Non-commercial fan project. Character images and titles © their respective owners, served via the AniList API.",
    );
  });

  it("names the three fonts and their licence on the footer's second line, the licence as its link", () => {
    const { before, link, after } = navigation.fontsCopy;
    expect(`${before}${link}${after}`).toBe(
      "Fonts: Bricolage Grotesque, Figtree, Martian Mono (SIL Open Font License).",
    );
    expect(link).toBe("SIL Open Font License");
  });
});
