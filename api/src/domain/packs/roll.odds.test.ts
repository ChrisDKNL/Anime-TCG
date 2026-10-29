import { PACK_SIZE } from "@anime-tcg/shared/economy";
import {
  ENCHANTED_SLOT_ODDS,
  ODDS_SCALE,
  type OddsTable,
  RADIANT_ODDS,
  RADIANT_SLOT_ODDS,
  RARITIES,
  type Rarity,
  SLOT_FLOOR,
  SLOT_ODDS,
} from "@anime-tcg/shared/rarity";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTiers, perRarity } from "../pool/tiers.js";
import { shareOfCards } from "./odds.js";
import { type DealtSlot, drawPack, type PackPlan, planPack, type TierPool } from "./roll.js";
import { cryptoRng, type Rng } from "./rng.js";

/**
 * The statistical tests of collection-packs.md §9 on the real
 * `crypto.randomInt`, against a fixture of 1 000 characters split by the
 * band rule. Pearson chi-square, each test at α = 0.001 against the
 * chi-square 0.999 quantile. Sample sizes, α and critical values are the
 * spec's: a correct implementation fails one of these twelve tests about
 * 12 times in a thousand runs. A failure is a finding: read the observed and
 * expected counts it prints; never rerun it to green or change a sample
 * size or α to make it pass.
 */

const STANDARD_PACKS = 400_000;
const ENCHANTED_PACKS = 80_000;
const RADIANT_PACKS = 20_000;
const DRAWS_PER_CHARACTER = 2_000;

/** Chi-square 0.999 quantiles, by degrees of freedom. */
const CRITICAL: Record<number, number> = {
  1: 10.83,
  2: 13.82,
  3: 16.27,
  5: 20.52,
  19: 43.82,
  59: 98.32,
  119: 172.42,
  199: 266.39,
  249: 323.69,
  349: 436.37,
};

/** 1 000 characters with distinct favourites: 350 / 250 / 200 / 120 / 60 / 20 by the band rule. */
const FIXTURE = assignTiers(Array.from({ length: 1_000 }, (_, i) => ({ id: i + 1, favourites: 1_000 - i })));
const POOL: TierPool = perRarity((tier) => FIXTURE.filter((c) => c.tier === tier).map((c) => c.id));
const TIER_OF = new Map(FIXTURE.map((c) => [c.id, c.tier]));
const rank = (tier: Rarity) => RARITIES.indexOf(tier);
const atLeastEpic = (tier: Rarity) => rank(tier) >= rank("epic");

function chiSquare(observed: readonly number[], expected: readonly number[]): number {
  return observed.reduce((sum, o, i) => {
    const e = expected[i] ?? 0;
    return sum + (o - e) ** 2 / e;
  }, 0);
}

/** Asserts the statistic is below the critical value for `tiers.length - 1` degrees of freedom, printing every cell. */
function expectFits(label: string, tiers: readonly string[], observed: number[], expected: number[]): void {
  const degrees = tiers.length - 1;
  const critical = CRITICAL[degrees];
  if (critical === undefined) throw new Error(`no critical value for ${degrees} degrees of freedom`);
  const statistic = chiSquare(observed, expected);
  const cells = tiers
    .map((tier, i) => `${tier} ${observed[i]} vs ${(expected[i] ?? 0).toFixed(1)}`)
    .join(", ");
  expect(
    statistic,
    `${label}: chi-square ${statistic.toFixed(2)} at ${degrees} df (critical ${critical}); ${cells}`,
  ).toBeLessThan(critical);
}

/** Expected counts of `tiers` over `n` rolls of each table in `tables`. */
function expectedOver(tables: readonly OddsTable[], n: number, tiers: readonly Rarity[]): number[] {
  return tiers.map((tier) => tables.reduce((sum, table) => sum + (n * table[tier]) / ODDS_SCALE, 0));
}

class Tally {
  readonly counts = new Map<string, number>();
  add(key: string, by = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + by);
  }
  get(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}

/** The deterministic checks of §9 on one pack; returns what it found wrong, if anything. */
function wellFormed(pack: DealtSlot[], plan: PackPlan): string | null {
  if (pack.length !== PACK_SIZE) return `a pack had ${pack.length} cards`;
  if (new Set(pack.map((card) => card.characterId)).size !== PACK_SIZE) return `a pack repeated a character`;
  for (const [slot, card] of pack.entries()) {
    if (TIER_OF.get(card.characterId) !== card.tier)
      return `character ${card.characterId} in a ${card.tier} slot`;
    const floor = SLOT_FLOOR[slot];
    if (floor === undefined || rank(card.tier) < rank(floor))
      return `slot ${slot + 1} below its floor: ${card.tier}`;
  }
  const tiers = pack.map((card) => card.tier);
  if (plan.kind === "radiant") {
    if (!tiers.every(atLeastEpic) || tiers[4] !== "mythic") return `a Radiant pack ${tiers.join(" ")}`;
    return null;
  }
  if (tiers[3] !== "uncommon") return `slot 4 was ${tiers[3]}`;
  if (tiers.slice(0, 3).some((tier) => rank(tier) > rank("uncommon"))) return `slots 1-3 ${tiers.join(" ")}`;
  if (plan.kind === "enchanted" && !atLeastEpic(tiers[4] ?? "common"))
    return `an Enchanted slot 5 of ${tiers[4]}`;
  return null;
}

describe("pack odds on crypto.randomInt (collection-packs.md §9)", () => {
  it("runs on the spec's fixture split", () => {
    expect(RARITIES.map((tier) => POOL[tier].length)).toEqual([350, 250, 200, 120, 60, 20]);
  });

  it("has a statistic that flags slot 5's Mythic at 1.25 times as published, so the tests are not vacuous", () => {
    const tiers: Rarity[] = ["rare", "epic", "legendary", "mythic"];
    const expected = expectedOver([SLOT_ODDS[4]], STANDARD_PACKS, tiers);
    const extra = 0.25 * (expected[3] ?? 0);
    const skewed = expected.map((e, i) => (i === 3 ? e + extra : i === 0 ? e - extra : e));
    expect(chiSquare(expected, expected)).toBe(0);
    expect(chiSquare(skewed, expected)).toBeGreaterThan(CRITICAL[3] ?? Infinity);
  });

  describe(`standard packs, natural, counters held at 0: ${STANDARD_PACKS} packs`, () => {
    const slots123 = new Tally();
    const slot5 = new Tally();
    const all = new Tally();
    const violations: string[] = [];
    let radiant = 0;
    let standard = 0;
    let pity = 0;

    beforeAll(() => {
      const counters = { packsSinceMythic: 0, freePacksOpened: 0 };
      for (let i = 0; i < STANDARD_PACKS; i += 1) {
        const plan = planPack(counters, "free", cryptoRng);
        const pack = drawPack(POOL, plan, cryptoRng);
        const wrong = wellFormed(pack, plan);
        if (wrong !== null && violations.length < 10) violations.push(wrong);
        if (plan.pity) pity += 1;
        if (plan.kind === "radiant") {
          radiant += 1;
          continue;
        }
        standard += 1;
        for (const card of pack) all.add(card.tier);
        for (const card of pack.slice(0, 3)) slots123.add(card.tier);
        slot5.add(pack[4]?.tier ?? "none");
      }
    });

    it("deals well-formed packs and never a pity pack (the deterministic half)", () => {
      expect(violations).toEqual([]);
      expect(pity).toBe(0);
      expect(standard + radiant).toBe(STANDARD_PACKS);
    });

    it("test 1: slots 1-3 pooled against Common / Uncommon (1 df)", () => {
      const tiers: Rarity[] = ["common", "uncommon"];
      expect(
        slots123.get("rare") + slots123.get("epic") + slots123.get("legendary") + slots123.get("mythic"),
      ).toBe(0);
      expectFits(
        "slots 1-3",
        tiers,
        tiers.map((t) => slots123.get(t)),
        expectedOver(SLOT_ODDS.slice(0, 3), standard, tiers),
      );
    });

    it("test 2: slot 5 against Rare / Epic / Legendary / Mythic (3 df)", () => {
      const tiers: Rarity[] = ["rare", "epic", "legendary", "mythic"];
      expect(slot5.get("common") + slot5.get("uncommon")).toBe(0);
      expectFits(
        "slot 5",
        tiers,
        tiers.map((t) => slot5.get(t)),
        expectedOver([SLOT_ODDS[4]], standard, tiers),
      );
    });

    it("test 3: all six tiers of every card against the published share (5 df)", () => {
      const tiers = [...RARITIES];
      const cards = standard * PACK_SIZE;
      const expected = tiers.map((tier) => (cards * shareOfCards(SLOT_ODDS, tier)) / 1_000_000);
      expectFits(
        "all cards",
        tiers,
        tiers.map((t) => all.get(t)),
        expected,
      );
    });

    it("test 4: Radiant against not Radiant over the plan rolls (1 df)", () => {
      const p = RADIANT_ODDS / ODDS_SCALE;
      expectFits(
        "Radiant",
        ["radiant", "not"],
        [radiant, standard],
        [STANDARD_PACKS * p, STANDARD_PACKS * (1 - p)],
      );
    });
  });

  it(`test 5: Enchanted forced (free_packs_opened = 9), ${ENCHANTED_PACKS} packs, slot 5 against ENCHANTED_SLOT_ODDS (2 df)`, () => {
    const counters = { packsSinceMythic: 0, freePacksOpened: 9 };
    const slot5 = new Tally();
    let enchanted = 0;
    for (let i = 0; i < ENCHANTED_PACKS; i += 1) {
      const plan = planPack(counters, "free", cryptoRng);
      const pack = drawPack(POOL, plan, cryptoRng);
      const wrong = wellFormed(pack, plan);
      if (wrong !== null) throw new Error(wrong);
      if (plan.kind !== "enchanted") {
        expect(plan.kind).toBe("radiant");
        continue;
      }
      enchanted += 1;
      slot5.add(pack[4]?.tier ?? "none");
    }
    const tiers: Rarity[] = ["epic", "legendary", "mythic"];
    expect(slot5.get("rare") + slot5.get("uncommon") + slot5.get("common")).toBe(0);
    expectFits(
      "Enchanted slot 5",
      tiers,
      tiers.map((t) => slot5.get(t)),
      expectedOver([ENCHANTED_SLOT_ODDS], enchanted, tiers),
    );
  });

  it(`test 6: Radiant forced (a scripted first call), ${RADIANT_PACKS} packs, slots 1-4 against RADIANT_SLOT_ODDS (2 df)`, () => {
    const counters = { packsSinceMythic: 0, freePacksOpened: 0 };
    const slots = new Tally();
    for (let i = 0; i < RADIANT_PACKS; i += 1) {
      const plan = planPack(counters, "free", () => 0);
      expect(plan.kind).toBe("radiant");
      const pack = drawPack(POOL, plan, cryptoRng);
      const wrong = wellFormed(pack, plan);
      if (wrong !== null) throw new Error(wrong);
      for (const card of pack.slice(0, 4)) slots.add(card.tier);
    }
    const tiers: Rarity[] = ["epic", "legendary", "mythic"];
    expectFits(
      "Radiant slots 1-4",
      tiers,
      tiers.map((t) => slots.get(t)),
      expectedOver([RADIANT_SLOT_ODDS], RADIANT_PACKS * 4, tiers),
    );
  });

  it.each([...RARITIES].reverse().map((tier, index) => [index + 7, tier] as const))(
    `test %i: picks each %s character uniformly, ${DRAWS_PER_CHARACTER} draws per character, the tier forced`,
    (_test, tier) => {
      const ids = POOL[tier];
      const plan: PackPlan = {
        kind: "standard",
        pity: false,
        slots: Array(PACK_SIZE).fill({ forced: tier }),
      };
      const counts = new Map<number, number>(ids.map((id) => [id, 0]));
      const forbidden: Rng = () => {
        throw new Error("a forced slot asked for a tier roll");
      };
      const packs = (ids.length * DRAWS_PER_CHARACTER) / PACK_SIZE;
      for (let i = 0; i < packs; i += 1) {
        const pack = drawPack(POOL, plan, cryptoRng, forbidden);
        if (new Set(pack.map((card) => card.characterId)).size !== PACK_SIZE)
          throw new Error("a repeated character");
        for (const card of pack) counts.set(card.characterId, (counts.get(card.characterId) ?? 0) + 1);
      }
      const observed = ids.map((id) => counts.get(id) ?? 0);
      expectFits(
        `${tier} picks (expected ${DRAWS_PER_CHARACTER} each)`,
        ids.map(String),
        observed,
        ids.map(() => DRAWS_PER_CHARACTER),
      );
    },
  );
});
