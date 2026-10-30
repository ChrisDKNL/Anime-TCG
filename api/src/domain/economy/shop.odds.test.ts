import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { RARITIES, type Rarity, SLOT_ODDS } from "@anime-tcg/shared/rarity";
import { beforeAll, describe, expect, it } from "vitest";
import { shareOfCards } from "../packs/odds.js";
import { drawPack, type PackPlan, planPack } from "../packs/roll.js";
import { cryptoRng, type Rng } from "../packs/rng.js";
import { assignTiers } from "../pool/tiers.js";
import { buildThemes, type GenreMember, type Theme } from "./themes.js";

/**
 * The statistical tests of economy.md §14 on the real `crypto.randomInt`,
 * with the design and failure rule of collection-packs.md §9: Pearson
 * chi-square, each test at α = 0.001 against the chi-square 0.999 quantile.
 * The pick tests draw a pack's characters without replacement, so their
 * counts are less dispersed than the multinomial the statistic assumes and
 * each is conservative: a correct implementation fails a run about 0.2 % of
 * the time or less, not the 7 in a thousand of seven independent tests at
 * α. The same conservatism makes the Mythic pick test (10 characters) weak:
 * it only catches a gross bias. A failure is a finding: read the observed
 * and expected counts it prints; never rerun it to green or change a sample
 * size or α.
 */

const THEMED_PACKS = 400_000;
const DRAWS_PER_CHARACTER = 2_000;
/** The deal of 400 000 packs takes seconds, past vitest's defaults; the bound is generous so only a hang times out. */
const SAMPLING_TIMEOUT_MS = 120_000;

/** Chi-square 0.999 quantiles, by degrees of freedom (§14). */
const CRITICAL: Record<number, number> = {
  5: 20.52,
  9: 27.88,
  29: 58.3,
  59: 98.32,
  99: 148.23,
  124: 178.41,
  174: 237.39,
};

/** The theme's characters per tier, Mythic to Common: the band rule at N = 500 (§14). */
const THEME_SIZES: Record<Rarity, number> = {
  mythic: 10,
  legendary: 30,
  epic: 60,
  rare: 100,
  uncommon: 125,
  common: 175,
};

/**
 * The fixture snapshot of 1c's tests (1 000 characters, 350 / 250 / 200 /
 * 120 / 60 / 20 by the band rule), every character in a "Drama" entry and
 * the first `THEME_SIZES[tier]` of each tier also in an "Action" one, so
 * the theme is built by the shop's own code from a subset of the snapshot.
 */
const FIXTURE = assignTiers(Array.from({ length: 1_000 }, (_, i) => ({ id: i + 1, favourites: 1_000 - i })));
function fixtureTheme(): Theme {
  const genres: GenreMember[] = [];
  for (const tier of RARITIES) {
    FIXTURE.filter((c) => c.tier === tier).forEach((c, index) => {
      genres.push({ characterId: c.id, tier, genre: "Drama" });
      if (index < THEME_SIZES[tier]) genres.push({ characterId: c.id, tier, genre: "Action" });
    });
  }
  const theme = buildThemes(genres, []).find((candidate) => candidate.id === "genre-action");
  if (theme === undefined) throw new Error("the fixture theme is not eligible");
  return theme;
}

function chiSquare(observed: readonly number[], expected: readonly number[]): number {
  return observed.reduce((sum, o, i) => {
    const e = expected[i] ?? 0;
    return sum + (o - e) ** 2 / e;
  }, 0);
}

function expectFits(label: string, keys: readonly string[], observed: number[], expected: number[]): void {
  const degrees = keys.length - 1;
  const critical = CRITICAL[degrees];
  if (critical === undefined) throw new Error(`no critical value for ${degrees} degrees of freedom`);
  const statistic = chiSquare(observed, expected);
  const cells = keys.map((key, i) => `${key} ${observed[i]} vs ${(expected[i] ?? 0).toFixed(1)}`).join(", ");
  expect(
    statistic,
    `${label}: chi-square ${statistic.toFixed(2)} at ${degrees} df (critical ${critical}); ${cells}`,
  ).toBeLessThan(critical);
}

describe("themed packs on crypto.randomInt (economy.md §14)", () => {
  const theme = fixtureTheme();
  const inTheme = new Set(RARITIES.flatMap((tier) => theme.tiers[tier]));

  it("runs on the spec's fixture theme, a subset of the fixture snapshot", () => {
    expect(RARITIES.map((tier) => FIXTURE.filter((c) => c.tier === tier).length)).toEqual([
      350, 250, 200, 120, 60, 20,
    ]);
    expect(theme.tierSizes).toEqual(THEME_SIZES);
  });

  describe(`${THEMED_PACKS} themed packs, counters at the worst case (pity due, Enchanted due)`, () => {
    const all = new Map<Rarity, number>(RARITIES.map((tier) => [tier, 0]));
    const violations: string[] = [];
    let standard = 0;
    let radiant = 0;

    beforeAll(() => {
      const counters = { packsSinceMythic: 299, freePacksOpened: 9 };
      for (let i = 0; i < THEMED_PACKS; i += 1) {
        const plan = planPack(counters, "shop", cryptoRng);
        const pack = drawPack(theme.tiers, plan, cryptoRng);
        if (violations.length < 10) {
          if (plan.pity || plan.kind === "enchanted")
            violations.push(`a ${plan.kind} pack, pity ${plan.pity}`);
          if (pack.length !== PACK_SIZE) violations.push(`a pack of ${pack.length}`);
          for (const card of pack) {
            if (!inTheme.has(card.characterId))
              violations.push(`character ${card.characterId} outside the theme`);
          }
        }
        if (plan.kind === "radiant") {
          radiant += 1;
          continue;
        }
        standard += 1;
        for (const card of pack) all.set(card.tier, (all.get(card.tier) ?? 0) + 1);
      }
    }, SAMPLING_TIMEOUT_MS);

    it("never deals a card outside the theme's set, and is never Enchanted or pity-due (the deterministic half)", () => {
      expect(violations).toEqual([]);
      expect(standard + radiant).toBe(THEMED_PACKS);
    });

    it("draws the six tiers of every card of a standard themed pack at the standard share (5 df)", () => {
      const tiers = [...RARITIES];
      const cards = standard * PACK_SIZE;
      expectFits(
        "themed cards",
        tiers,
        tiers.map((tier) => all.get(tier) ?? 0),
        tiers.map((tier) => (cards * shareOfCards(SLOT_ODDS, tier)) / 1_000_000),
      );
    });
  });

  it.each([...RARITIES].reverse())(
    `picks each %s character of the theme uniformly, ${DRAWS_PER_CHARACTER} draws per character, the tier forced`,
    (tier) => {
      const ids = theme.tiers[tier];
      const plan: PackPlan = {
        kind: "standard",
        pity: false,
        slots: Array(PACK_SIZE).fill({ forced: tier }),
      };
      const forbidden: Rng = () => {
        throw new Error("a forced slot asked for a tier roll");
      };
      const counts = new Map<number, number>(ids.map((id) => [id, 0]));
      const packs = (ids.length * DRAWS_PER_CHARACTER) / PACK_SIZE;
      for (let i = 0; i < packs; i += 1) {
        const pack = drawPack(theme.tiers, plan, cryptoRng, forbidden);
        if (new Set(pack.map((card) => card.characterId)).size !== PACK_SIZE)
          throw new Error("a repeated character");
        for (const card of pack) {
          if (!counts.has(card.characterId))
            throw new Error(`character ${card.characterId} outside the theme`);
          counts.set(card.characterId, (counts.get(card.characterId) ?? 0) + 1);
        }
      }
      expectFits(
        `${tier} picks (expected ${DRAWS_PER_CHARACTER} each)`,
        ids.map(String),
        ids.map((id) => counts.get(id) ?? 0),
        ids.map(() => DRAWS_PER_CHARACTER),
      );
    },
    SAMPLING_TIMEOUT_MS,
  );
});
