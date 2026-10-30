import type { PublishedOdds, Rarity } from "@anime-tcg/shared/api";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_WORDS as FORBIDDEN, walkCopy } from "../test/copyWords";
import { makeOdds } from "../test/fixtures";
import {
  cardCopy,
  clock,
  oddsCopy,
  ordinal,
  packControlCopy,
  percent,
  revealCopy,
  sizeWord,
  slotWord,
  summary,
  summaryParts,
} from "./packsCopy";
import * as packs from "./packsCopy";

const odds = makeOdds();
const paidOnly: PublishedOdds = { ...odds, pity: { packs: 300, freePacksOnly: false } };

/** `free` only in the owner's phrase for the timer pack (packs-page.md §9, question 1). */
const LOOSE_FREE = /\bfree\b(?! packs?\b)/i;

const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const PACK: Rarity[] = ["epic", "rare", "common", "common", "common"];

/** Every function of the module, called with the arguments the page gives it. */
const CALLS: Record<string, string[]> = {
  formatCount: [packs.formatCount(2_983)],
  plural: [packs.plural(1, "copy", "copies"), packs.plural(2, "copy", "copies")],
  ordinal: [ordinal(1), ordinal(300)],
  slotWord: [slotWord(5)],
  sizeWord: [sizeWord(5)],
  listSeparator: [packs.listSeparator(1, 3), packs.listSeparator(2, 3)],
  clock: [clock(462)],
  summary: [summary(PACK)],
  // Tiers and counts, no copy: `summary` writes them.
  summaryParts: [],
  percent: [percent(500, 1_000_000)],
  "packControlCopy.count": [packControlCopy.count(0, 3), packControlCopy.count(1, 1)],
  "packControlCopy.waitButton": [packControlCopy.waitButton(3)],
  "packControlCopy.next": [packControlCopy.next(462), packControlCopy.next(3_725)],
  "packControlCopy.nextSpoken": [1, 42, 61, 462, 3_725].map(packControlCopy.nextSpoken),
  "packControlCopy.ready": [packControlCopy.ready(1, 3)],
  "packControlCopy.pity": [
    packControlCopy.pity(300, true),
    packControlCopy.pity(1, true),
    packControlCopy.pity(300, false),
    packControlCopy.pity(1, false),
  ],
  "revealCopy.heading": (["standard", "enchanted", "radiant"] as const).map(revealCopy.heading),
  "revealCopy.newCount": [revealCopy.newCount(2)],
  "revealCopy.enchanted": [revealCopy.enchanted(odds), revealCopy.enchanted(paidOnly)],
  "revealCopy.radiant": [revealCopy.radiant(odds), revealCopy.radiant(paidOnly)],
  "revealCopy.pityMythic": [revealCopy.pityMythic(odds), revealCopy.pityMythic(paidOnly)],
  "revealCopy.announce": [revealCopy.announce("standard", PACK, 2), revealCopy.announce("radiant", PACK, 0)],
  "oddsCopy.slots": [oddsCopy.slots(odds)],
  "oddsCopy.enchanted": [oddsCopy.enchanted(odds), oddsCopy.enchanted(paidOnly)],
  "oddsCopy.radiant": [oddsCopy.radiant(odds)],
  "oddsCopy.pity": [oddsCopy.pity(odds), oddsCopy.pity(paidOnly)],
  "oddsCopy.tiers": [oddsCopy.tiers(odds)],
  "oddsCopy.pool": [oddsCopy.pool(odds)],
  "cardCopy.starGlyphs": RARITIES.map(cardCopy.starGlyphs),
  "cardCopy.stars": RARITIES.map(cardCopy.stars),
  "cardCopy.rank": [cardCopy.rank(12, 2_983), cardCopy.rank(12, null)],
  "cardCopy.rankSpoken": [cardCopy.rankSpoken(12, 2_983), cardCopy.rankSpoken(12, null)],
  "cardCopy.label": [cardCopy.label("Name", "epic", "Series"), cardCopy.label("Name", "epic", null)],
};

const { strings: plain, functions } = walkCopy(packs);
const rendered: Array<[string, string]> = [
  ...plain.map((text): [string, string] => ["string", text]),
  ...Object.entries(CALLS).flatMap(([path, texts]) => texts.map((text): [string, string] => [path, text])),
];

describe("packs copy words (packs-page.md §8)", () => {
  it("renders every string of the module and calls every function in it", () => {
    expect(functions.sort()).toEqual(Object.keys(CALLS).sort());
    expect(plain.length).toBeGreaterThan(20);
  });

  it("contains none of the words navigation-and-landing.md §8 forbids", () => {
    const offenders = rendered.filter(([, text]) => FORBIDDEN.some((word) => word.test(text)));
    expect(offenders).toEqual([]);
  });

  it("uses `free` only as `free pack` or `free packs`", () => {
    expect(rendered.filter(([, text]) => LOOSE_FREE.test(text))).toEqual([]);
    expect(rendered.some(([, text]) => /\bfree packs?\b/.test(text))).toBe(true);
  });
});

describe("pack control copy", () => {
  it("counts packs out of the cap, singular for a cap of one", () => {
    expect(packControlCopy.count(2, 3)).toBe("2 of 3 packs ready");
    expect(packControlCopy.count(0, 1)).toBe("0 of 1 pack ready");
    expect(packControlCopy.ready(1, 3)).toBe("1 of 3 packs ready.");
  });

  it("writes the countdown as M:SS, and H:MM:SS from one hour", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(59)).toBe("0:59");
    expect(clock(462)).toBe("7:42");
    expect(clock(600)).toBe("10:00");
    expect(clock(3_599)).toBe("59:59");
    expect(clock(3_600)).toBe("1:00:00");
    expect(clock(3_725)).toBe("1:02:05");
    expect(packControlCopy.next(462)).toBe("Next pack in 7:42");
  });

  it("speaks the countdown in words, never as a time of day", () => {
    expect(packControlCopy.nextSpoken(462)).toBe("Next pack in 7 minutes 42 seconds");
    expect(packControlCopy.nextSpoken(61)).toBe("Next pack in 1 minute 1 second");
    expect(packControlCopy.nextSpoken(42)).toBe("Next pack in 42 seconds");
    expect(packControlCopy.nextSpoken(1)).toBe("Next pack in 1 second");
    expect(packControlCopy.nextSpoken(3_725)).toBe("Next pack in 1 hour 2 minutes");
    expect(packControlCopy.nextSpoken(7_260)).toBe("Next pack in 2 hours 1 minute");
  });

  it("words the pity line by the server's number and its free-packs flag", () => {
    expect(packControlCopy.pity(300, true)).toBe("Mythic guaranteed within 300 free packs.");
    expect(packControlCopy.pity(1, true)).toBe("Mythic guaranteed within 1 free pack.");
    expect(packControlCopy.pity(2, false)).toBe("Mythic guaranteed within 2 packs.");
    expect(packControlCopy.pity(1, false)).toBe("Mythic guaranteed within 1 pack.");
  });

  it("reuses the accounts wait strings", () => {
    expect(packControlCopy.waitButton(3)).toBe("Try again in 3 s");
    expect(packControlCopy.waitOver).toBe("You can try again now.");
  });
});

describe("ordinals and number words", () => {
  it("writes ordinals with en-GB plural rules", () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111, 300].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "10th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "101st",
      "111th",
      "300th",
    ]);
    expect(ordinal(1_000)).toBe("1,000th");
  });

  it("names a slot and a pack size in words up to five, in digits beyond", () => {
    expect([1, 2, 3, 4, 5].map(slotWord)).toEqual(["first", "second", "third", "fourth", "fifth"]);
    expect(slotWord(6)).toBe("6th");
    expect([1, 2, 3, 4, 5].map(sizeWord)).toEqual(["one", "two", "three", "four", "five"]);
    expect(sizeWord(6)).toBe("6");
  });
});

describe("the pull summary", () => {
  const cases: Array<[Rarity[], string]> = [
    [["common", "common", "common", "common", "common"], "5 Common"],
    [["common", "common", "common", "common", "rare"], "1 Rare and 4 Common"],
    [["common", "common", "common", "rare", "epic"], "1 Epic, 1 Rare and 3 Common"],
    [["common", "uncommon", "common", "rare", "legendary"], "1 Legendary, 1 Rare, 1 Uncommon and 2 Common"],
    [["common", "uncommon", "rare", "epic", "mythic"], "1 Mythic, 1 Epic, 1 Rare, 1 Uncommon and 1 Common"],
    [
      ["uncommon", "rare", "epic", "legendary", "mythic", "common"],
      "1 Mythic, 1 Legendary, 1 Epic, 1 Rare, 1 Uncommon and 1 Common",
    ],
  ];

  it.each(cases)("%j reads %s, rarest first, empty tiers left out", (rarities, expected) => {
    expect(summary(rarities)).toBe(expected);
  });

  it("counts by tier whatever the slot order", () => {
    expect(summaryParts(["rare", "common", "rare"])).toEqual([
      { rarity: "rare", count: 2 },
      { rarity: "common", count: 1 },
    ]);
  });
});

describe("the reveal", () => {
  it("heads each kind of pack from its stored kind", () => {
    expect(revealCopy.heading("standard")).toBe("Your pack");
    expect(revealCopy.heading("enchanted")).toBe("Enchanted pack");
    expect(revealCopy.heading("radiant")).toBe("Radiant pack");
  });

  it("writes the special lines from the server's odds, today's values first", () => {
    expect(revealCopy.enchanted(odds)).toBe(
      "Every 10th free pack is Enchanted: its fifth card is Epic or better.",
    );
    expect(revealCopy.radiant(odds)).toBe(
      "About 1 pack in 2,500 is Radiant: five cards of Epic or better, at least one of them Mythic.",
    );
    expect(revealCopy.pityMythic(odds)).toBe(
      "This Mythic came from the guarantee: a 300th free pack in a row without a Mythic always has one.",
    );
  });

  it("follows other numbers the server publishes", () => {
    const other = makeOdds({
      enchanted: { ...odds.enchanted, every: 12, slot: 3, floor: "legendary" },
      radiant: { ...odds.radiant, chance: 300, lastSlot: "legendary" },
      pity: { packs: 101, freePacksOnly: true },
    });
    expect(revealCopy.enchanted(other)).toBe(
      "Every 12th free pack is Enchanted: its fourth card is Legendary or better.",
    );
    expect(revealCopy.radiant(other)).toBe(
      "About 1 pack in 3,333 is Radiant: five cards of Epic or better, at least one of them Legendary.",
    );
    expect(revealCopy.pityMythic(other)).toContain("a 101st free pack in a row");
  });

  it("leaves `free ` out when the rules count every pack", () => {
    expect(revealCopy.enchanted(paidOnly)).toBe(
      "Every 10th pack is Enchanted: its fifth card is Epic or better.",
    );
    expect(revealCopy.pityMythic(paidOnly)).toBe(
      "This Mythic came from the guarantee: a 300th pack in a row without a Mythic always has one.",
    );
    expect(revealCopy.radiant(paidOnly)).toBe(revealCopy.radiant(odds));
  });

  it("announces the heading, the summary and the new cards once", () => {
    expect(revealCopy.announce("standard", ["common", "common", "common", "rare", "epic"], 2)).toBe(
      "Your pack: 1 Epic, 1 Rare and 3 Common. 2 new.",
    );
    expect(revealCopy.announce("enchanted", ["common", "common", "common", "uncommon", "epic"], 0)).toBe(
      "Enchanted pack: 1 Epic, 1 Uncommon and 3 Common.",
    );
    expect(revealCopy.newCount(2)).toBe(" · 2 new");
  });
});

describe("the odds page (card-and-rarity.md §7.3)", () => {
  it("writes percentages with three significant digits, never rounded up", () => {
    expect(percent(560_000, 1_000_000)).toBe("56%");
    expect(percent(999_704, 1_000_000)).toBe("99.9%");
    expect(percent(500, 1_000_000)).toBe("0.05%");
    expect(percent(5_500, 1_000_000)).toBe("0.55%");
    expect(percent(1_000_000, 1_000_000)).toBe("100%");
    expect(percent(200, 10_000)).toBe("2%");
  });

  it("states the slot floors, the special packs and how tiers are set", () => {
    expect(oddsCopy.slots(odds)).toBe(
      "Cards 1 to 3: Common or better. Card 4: Uncommon or better. Card 5: Rare or better.",
    );
    expect(oddsCopy.pity(odds)).toBe("A 300th free pack in a row without a Mythic always has one.");
    expect(oddsCopy.tiers(odds)).toBe(
      "A character's tier comes from its popularity rank on AniList among the 2,983 characters of the current pool: Mythic is the top 2%, Legendary the next 6%, Epic the next 12%, Rare the next 20%, Uncommon the next 25%, Common the rest.",
    );
    expect(oddsCopy.pool(odds)).toMatch(/^Pool as of \d{1,2} Oct 2026\.$/);
    expect(oddsCopy.shop).toBe(
      "Shop packs can be Radiant. They don't count toward Enchanted packs or the guarantee.",
    );
  });

  it("groups slots by floor whatever the server publishes", () => {
    const floors = makeOdds({
      slots: odds.slots.map((slot, i) => ({ ...slot, floor: i < 1 ? "common" : "rare" })),
    });
    expect(oddsCopy.slots(floors)).toBe("Card 1: Common or better. Cards 2 to 5: Rare or better.");
  });
});

describe("the card's text", () => {
  it("names the tier with its stars", () => {
    expect(cardCopy.stars("common")).toBe("Common, 1 star");
    expect(cardCopy.stars("rare")).toBe("Rare, 3 stars");
    expect(cardCopy.stars("mythic")).toBe("Mythic, 6 stars");
    expect(cardCopy.starGlyphs("legendary")).toBe("✦".repeat(5));
  });

  it("pads the rank to the pool size's digits, or to four without a pool size", () => {
    expect(cardCopy.rank(12, 2_983)).toBe("#0012 / 2983");
    expect(cardCopy.rank(12, 500)).toBe("#012 / 500");
    expect(cardCopy.rank(2_983, 2_983)).toBe("#2983 / 2983");
    expect(cardCopy.rank(12, null)).toBe("#0012");
    expect(cardCopy.rankSpoken(12, 2_983)).toBe("Popularity rank 12 of 2,983");
    expect(cardCopy.rankSpoken(1_204, null)).toBe("Popularity rank 1,204");
  });

  it("labels the card with its name, tier and series, each AniList string isolated with FSI/PDI", () => {
    expect(cardCopy.label("Frieren", "epic", "Frieren: Beyond Journey's End")).toBe(
      "\u2068Frieren\u2069, Epic, \u2068Frieren: Beyond Journey's End\u2069",
    );
    expect(cardCopy.label("Frieren", "epic", null)).toBe("\u2068Frieren\u2069, Epic");
    expect(cardCopy.label("\u202Egnp.exe", "mythic", "\u202Eseires")).toBe(
      "\u2068\u202Egnp.exe\u2069, Mythic, \u2068\u202Eseires\u2069",
    );
  });
});
