import { describe, expect, it } from "vitest";
import { makeTheme } from "../test/fixtures";
import { FORBIDDEN_WORDS, walkCopy } from "../test/copyWords";
import { amount, CURRENCY_NAME } from "./copy";
import * as copy from "./economyCopy";
import { actionCopy, balanceCopy, recycleCopy, shopCopy } from "./economyCopy";

const RTL = "‮evil‬";
const { odds } = makeTheme();

/** Every function of the module, called with the arguments the pages give it. */
const CALLS: Record<string, string[]> = {
  "shopCopy.moreSeries": [shopCopy.moreSeries(37)],
  "shopCopy.tierSizes": [shopCopy.tierSizes(odds.tierSizes)],
  "shopCopy.slots": [shopCopy.slots(odds)],
  "shopCopy.radiant": [shopCopy.radiant(odds)],
  "shopCopy.price": [shopCopy.price(400)],
  "shopCopy.tooLittle": [shopCopy.tooLittle(400, 120)],
  "shopCopy.confirmHeading": [shopCopy.confirmHeading("Action")],
  "shopCopy.confirmBody": [shopCopy.confirmBody(400, 5, 1_240)],
  "shopCopy.confirm": [shopCopy.confirm(400)],
  "shopCopy.revealHeading": [shopCopy.revealHeading("Action")],
  "shopCopy.bought": [shopCopy.bought("Action", 400, 840)],
  "shopCopy.tooLittleRefused": [shopCopy.tooLittleRefused(400, 120)],
  "actionCopy.waitButton": [actionCopy.waitButton(12)],
  "recycleCopy.value": [recycleCopy.value(40)],
  "recycleCopy.hint": [recycleCopy.hint(2)],
  "recycleCopy.credit": [recycleCopy.credit(80)],
  "recycleCopy.fieldError": [recycleCopy.fieldError(2)],
  "recycleCopy.confirmHeading": [
    recycleCopy.confirmHeading(1, "Spike"),
    recycleCopy.confirmHeading(2, "Spike"),
  ],
  "recycleCopy.confirmBody": [
    recycleCopy.confirmBody(1, "epic", 40, 2, 0),
    recycleCopy.confirmBody(2, "epic", 80, 1, 1),
  ],
  "recycleCopy.confirm": [recycleCopy.confirm(80)],
  "recycleCopy.recycled": [
    recycleCopy.recycled(1, "Spike", 40, 1_280),
    recycleCopy.recycled(2, "Spike", 80, 1_320),
  ],
  "recycleCopy.valueChanged": [recycleCopy.valueChanged(45)],
};

const { strings, functions } = walkCopy(copy);
const rendered = [...strings, ...Object.values(CALLS).flat()];

describe("economy copy words (collection-overview.md §8, market-and-shop.md §8)", () => {
  it("renders every string of the module and calls every function in it", () => {
    expect(functions.sort()).toEqual(Object.keys(CALLS).sort());
    expect(strings.length).toBeGreaterThan(30);
  });

  it("contains none of the forbidden words, money words or casino nudges", () => {
    expect(rendered.filter((text) => FORBIDDEN_WORDS.some((word) => word.test(text)))).toEqual([]);
  });

  it("names the currency only through the one constant, after a number or in a label", () => {
    expect(CURRENCY_NAME).toBe("Karma");
    expect(balanceCopy.name).toBe(CURRENCY_NAME);
    expect(amount(1_240)).toBe("1,240 Karma");
    expect(amount(0)).toBe("0 Karma");
    for (const text of rendered) {
      for (const match of text.matchAll(/(\S*) Karma\b/g)) {
        expect(match[1], text).toMatch(/^(?:[\d,]+|for|most)$/);
      }
    }
  });
});

describe("shop copy (market-and-shop.md §8)", () => {
  it("is the spec's exact text", () => {
    expect(shopCopy.loading).toBe("Loading the shop…");
    expect(shopCopy.error).toBe("Couldn't load the shop.");
    expect(shopCopy.empty).toBe("No packs in the shop.");
    expect(shopCopy.buy).toBe("Buy…");
    expect(shopCopy.stale).toBe("Buying waits until the game server answers.");
    expect(shopCopy.oddsLead).toBe("At least one per pack:");
    expect(shopCopy.oddsDisclosure).toBe("Odds per card");
    expect(shopCopy.shopRule).toBe("Shop packs don't count toward Enchanted packs or the guarantee.");
    expect(shopCopy.gone).toBe("That pack is no longer in the shop.");
    expect(shopCopy.noCards).toBe("There are no cards to draw from right now. Nothing changed.");
    expect(shopCopy.buying).toBe("Buying…");
    expect(shopCopy.latest).toBe("See your latest shop pack");
    expect(shopCopy.back).toBe("Back to the shop");
  });

  it("writes every amount from the numbers given, grouped", () => {
    expect(shopCopy.price(1_400)).toBe("1,400 Karma");
    expect(shopCopy.tooLittle(400, 120)).toBe("Costs 400 Karma. You have 120.");
    expect(shopCopy.confirmBody(400, 5, 1_240)).toBe(
      "400 Karma for 5 cards from this pack's characters, at the odds shown. You have 1,240 Karma. There is no undo.",
    );
    expect(shopCopy.confirm(400)).toBe("Buy for 400 Karma");
    expect(shopCopy.tooLittleRefused(400, 120)).toBe("This pack costs 400 Karma. You have 120 Karma.");
    expect(shopCopy.moreSeries(1_037)).toBe("and 1,037 more");
  });

  it("isolates the theme's title in the live region's plain string; markup takes it raw", () => {
    expect(shopCopy.bought(RTL, 400, 840)).toBe(
      `Bought the ⁨${RTL}⁩ pack for 400 Karma. You have 840 Karma.`,
    );
    expect(shopCopy.confirmHeading("Action")).toBe("Buy the Action pack?");
    expect(shopCopy.revealHeading("Action")).toBe("Action pack");
  });

  it("words the theme's own tables as the free pack's odds page does", () => {
    expect(shopCopy.tierSizes(odds.tierSizes)).toBe(
      "Drawn from 420 Common, 300 Uncommon, 240 Rare, 140 Epic, 70 Legendary and 25 Mythic characters.",
    );
    expect(shopCopy.slots(odds)).toMatch(/^Cards 1 to \d: Common or better\./);
    expect(shopCopy.radiant(odds)).toMatch(/^About 1 pack in [\d,]+ is Radiant: five cards of /);
  });
});

describe("recycle copy (collection-overview.md §8)", () => {
  it("is the spec's exact text", () => {
    expect(recycleCopy.heading).toBe("Recycle for Karma");
    expect(recycleCopy.label).toBe("Duplicates");
    expect(recycleCopy.button).toBe("Recycle…");
    expect(recycleCopy.oneCopy).toBe("No duplicates. The last copy can't be recycled.");
    expect(recycleCopy.allListed).toBe("Copies on the market can't be recycled.");
    expect(recycleCopy.stale).toBe("Listing and recycling wait until the game server answers.");
    expect(recycleCopy.somethingChanged).toBe(
      "Something changed since you opened this card. Check the numbers and try again.",
    );
    expect(recycleCopy.ceiling).toBe(
      "That would take you past the most Karma you can hold, so nothing was recycled.",
    );
    expect(recycleCopy.recycling).toBe("Recycling…");
  });

  it("counts copies and duplicates in the singular and the plural", () => {
    expect(recycleCopy.value(2_750)).toBe("Each duplicate recycles for 2,750 Karma.");
    expect(recycleCopy.hint(2)).toBe("1 to 2");
    expect(recycleCopy.credit(80)).toBe("You get 80 Karma.");
    expect(recycleCopy.fieldError(1_000)).toBe("Choose a whole number from 1 to 1,000.");
    expect(recycleCopy.confirmHeading(1, "Spike")).toBe("Recycle 1 duplicate of Spike?");
    expect(recycleCopy.confirmHeading(2, "Spike")).toBe("Recycle 2 duplicates of Spike?");
    expect(recycleCopy.confirmBody(1, "epic", 40, 2, 0)).toBe(
      "1 Epic copy become 40 Karma. You keep 2. There is no undo.",
    );
    expect(recycleCopy.confirmBody(2, "mythic", 5_500, 1, 1)).toBe(
      "2 Mythic copies become 5,500 Karma. You keep 1, 1 of them on the market. There is no undo.",
    );
    expect(recycleCopy.confirm(80)).toBe("Recycle for 80 Karma");
    expect(recycleCopy.recycled(1, "Spike", 40, 1_280)).toBe(
      "Recycled 1 copy of Spike for 40 Karma. You have 1,280 Karma.",
    );
    expect(recycleCopy.recycled(2, "Spike", 80, 1_320)).toBe(
      "Recycled 2 copies of Spike for 80 Karma. You have 1,320 Karma.",
    );
    expect(recycleCopy.valueChanged(45)).toBe(" Each duplicate now recycles for 45 Karma.");
  });
});

describe("failures shared by the confirmations (collection-overview.md §8 Failures)", () => {
  it("is the spec's exact text", () => {
    expect(actionCopy.rateLimited).toBe("That was a lot in a short time. Give it a few seconds.");
    expect(actionCopy.serverFailure).toBe(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
    expect(actionCopy.noAnswer).toBe("Couldn't reach the game server, so this may not have gone through.");
    expect(actionCopy.waitButton(12)).toBe("Try again in 12 s");
    expect(actionCopy.waitOver).toBe("You can try again now.");
  });
});
