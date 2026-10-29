import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { ODDS_SCALE, RARITIES, type Rarity, SLOT_ODDS } from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import { assignTiers } from "../pool/tiers.js";
import { drawPack, type TierPool } from "./roll.js";
import { cryptoRng, type Rng } from "./rng.js";

/**
 * The statistical test of collection-packs.md §9 against the published odds,
 * on the real `crypto.randomInt`. Sample sizes, α = 0.001 and the critical
 * values are the spec's; a correct implementation fails one of these six
 * tests about six times in a thousand runs. A failure is a finding: read the
 * observed and expected counts it prints, never rerun it to green or change
 * the sample size or α to make it pass.
 */

const PACKS = 200_000;
const DRAWS_PER_CHARACTER = 2_000;

/** Chi-square upper critical values at α = 0.001, by degrees of freedom. */
const CRITICAL: Record<number, number> = {
  4: 18.47,
  9: 27.88,
  39: 72.05,
  99: 148.23,
  249: 323.69,
  599: 711.68,
};

/** 1 000 characters with distinct favourites, split by the tier rule into 10 / 40 / 100 / 250 / 600. */
const FIXTURE = assignTiers(Array.from({ length: 1_000 }, (_, i) => ({ id: i + 1, favourites: 1_000 - i })));
const POOL: TierPool = {
  common: FIXTURE.filter((c) => c.tier === "common").map((c) => c.id),
  rare: FIXTURE.filter((c) => c.tier === "rare").map((c) => c.id),
  epic: FIXTURE.filter((c) => c.tier === "epic").map((c) => c.id),
  legendary: FIXTURE.filter((c) => c.tier === "legendary").map((c) => c.id),
  mythic: FIXTURE.filter((c) => c.tier === "mythic").map((c) => c.id),
};
const TIER_OF = new Map(FIXTURE.map((c) => [c.id, c.tier]));

/** The smallest roll of each tier, so a tier can be forced through the tier seam. */
const FORCED_ROLL: Record<Rarity, number> = {
  mythic: 0,
  legendary: SLOT_ODDS.mythic,
  epic: SLOT_ODDS.mythic + SLOT_ODDS.legendary,
  rare: SLOT_ODDS.mythic + SLOT_ODDS.legendary + SLOT_ODDS.epic,
  common: ODDS_SCALE - SLOT_ODDS.common,
};

function chiSquare(observed: readonly number[], expected: readonly number[]): number {
  return observed.reduce((sum, o, i) => {
    const e = expected[i] ?? 0;
    return sum + (o - e) ** 2 / e;
  }, 0);
}

/** The deterministic half of the test, on every pack the statistical half draws. */
function assertWellFormed(pack: ReturnType<typeof drawPack>): void {
  if (pack.length !== PACK_SIZE) throw new Error(`a pack had ${pack.length} cards`);
  if (new Set(pack.map((card) => card.characterId)).size !== PACK_SIZE) {
    throw new Error(`a pack repeated a character: ${JSON.stringify(pack)}`);
  }
  for (const card of pack) {
    if (TIER_OF.get(card.characterId) !== card.tier) {
      throw new Error(`character ${card.characterId} was dealt in a ${card.tier} slot`);
    }
  }
}

describe("pack odds on crypto.randomInt", () => {
  it("checks the fixture is the spec's split", () => {
    expect(RARITIES.map((tier) => POOL[tier].length)).toEqual([600, 250, 100, 40, 10]);
  });

  it("has a statistic that flags Mythic dealt 1.3 times as often as published, so the test is not vacuous", () => {
    const slots = PACKS * PACK_SIZE;
    const expected = RARITIES.map((tier) => (slots * SLOT_ODDS[tier]) / ODDS_SCALE);
    const extra = 0.3 * (expected[4] ?? 0);
    const skewed = expected.map((e, i) => (i === 4 ? e + extra : i === 0 ? e - extra : e));
    expect(chiSquare(expected, expected)).toBe(0);
    expect(chiSquare(skewed, expected)).toBeGreaterThan(CRITICAL[4] ?? Infinity);
  });

  it(`draws tiers at the published SLOT_ODDS over ${PACKS} packs (chi-square, 4 df, α = 0.001)`, () => {
    const counts = new Map<Rarity, number>(RARITIES.map((tier) => [tier, 0]));
    for (let i = 0; i < PACKS; i += 1) {
      const pack = drawPack(POOL, cryptoRng);
      assertWellFormed(pack);
      for (const card of pack) counts.set(card.tier, (counts.get(card.tier) ?? 0) + 1);
    }
    const slots = PACKS * PACK_SIZE;
    const observed = RARITIES.map((tier) => counts.get(tier) ?? 0);
    const expected = RARITIES.map((tier) => (slots * SLOT_ODDS[tier]) / ODDS_SCALE);
    const statistic = chiSquare(observed, expected);
    const report = RARITIES.map((tier, i) => `${tier} ${observed[i]} vs ${expected[i]}`).join(", ");
    expect(statistic, `chi-square ${statistic.toFixed(2)}; ${report}`).toBeLessThan(CRITICAL[4] ?? 0);
  });

  it.each(RARITIES.map((tier) => [tier]))(
    `picks each %s character uniformly, ${DRAWS_PER_CHARACTER} draws per character, with the tier forced`,
    (tier) => {
      const ids = POOL[tier];
      const forced: Rng = () => FORCED_ROLL[tier];
      const counts = new Map<number, number>(ids.map((id) => [id, 0]));
      const packs = (ids.length * DRAWS_PER_CHARACTER) / PACK_SIZE;
      for (let i = 0; i < packs; i += 1) {
        const pack = drawPack(POOL, cryptoRng, forced);
        assertWellFormed(pack);
        for (const card of pack) counts.set(card.characterId, (counts.get(card.characterId) ?? 0) + 1);
      }
      const observed = ids.map((id) => counts.get(id) ?? 0);
      const expected = ids.map(() => DRAWS_PER_CHARACTER);
      const statistic = chiSquare(observed, expected);
      const degrees = ids.length - 1;
      const critical = CRITICAL[degrees];
      if (critical === undefined) throw new Error(`no critical value for ${degrees} degrees of freedom`);
      const report = `observed per character (expected ${DRAWS_PER_CHARACTER} each): ${observed.join(" ")}`;
      expect(statistic, `chi-square ${statistic.toFixed(2)} at ${degrees} df; ${report}`).toBeLessThan(
        critical,
      );
    },
  );
});
