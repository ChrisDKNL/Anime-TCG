import { PACK_SIZE } from "@anime-tcg/shared/economy";
import {
  ENCHANTED_INTERVAL,
  ENCHANTED_SLOT_ODDS,
  ODDS_SCALE,
  type OddsTable,
  PITY_PACKS,
  RADIANT_ODDS,
  RADIANT_SLOT_ODDS,
  RARITIES,
  type Rarity,
  SLOT_ODDS,
} from "@anime-tcg/shared/rarity";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTiers, perRarity } from "../pool/tiers.js";
import { countersAfter, drawPack, type PackCounters, planPack, type TierPool } from "./roll.js";
import type { Rng } from "./rng.js";

/**
 * Tester's hunt (T3, PR #28): the special rules of collection-packs.md
 * §5.4.3-§5.4.6 run end to end through the real `planPack`, `drawPack` and
 * `countersAfter` over one account's long run of free packs, and the figures
 * that come out are held against the numbers the spec prints.
 *
 * The engineer's `roll.odds.test.ts` tests each table where it is forced, on
 * `crypto.randomInt`, at α = 0.001, and `odds.test.ts` recomputes §5.4.6 from
 * the Markov chain. Neither runs the counters, the plan and the deal together,
 * so neither would catch pity firing at the wrong count, the Enchanted cadence
 * drifting, a Radiant pack shifting the cadence, or a counter that is not reset
 * by a Mythic: this file does.
 *
 * Determinism: the code takes an injectable `Rng`, so this file runs on a
 * seeded generator (sfc32, rejection-sampled to an exact uniform integer).
 * The same seed gives the same run on every machine, so this file cannot
 * flake. The tolerances are still set as if the seed were random, so a seed
 * was not picked to pass: every rate is held to 6 binomial standard
 * deviations (times 1.5 for the dependence between cards of one pack and
 * between packs of one run) plus half a unit of the last digit the spec
 * prints; a chi-square is held to the 1 - 10^-6 quantile. At those bounds a
 * random seed would fail any one check about once in 10^6 to 10^9 runs.
 */

const PACKS = 1_000_000;
const SEED = 0x7e57_2028;

/** sfc32 (Chris Doty-Humphrey's Small Fast Counting generator), 32-bit output. */
function sfc32(seed: number): () => number {
  let a = 0;
  let b = seed >>> 0;
  let c = 0x243f_6a88;
  let d = 1;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 20; i += 1) next();
  return next;
}

/** A uniform integer in `[min, max)`, exactly: values past the last whole multiple of the range are redrawn. */
function seededRng(seed: number): Rng {
  const next = sfc32(seed);
  const SPAN = 2 ** 32;
  return (min, max) => {
    const range = max - min;
    if (!Number.isInteger(range) || range < 1 || range > SPAN) throw new RangeError(`range ${range}`);
    const limit = SPAN - (SPAN % range);
    let x = next();
    while (x >= limit) x = next();
    return min + (x % range);
  };
}

/** Chi-square 1 - 10^-6 quantiles by degrees of freedom (computed from the regularized gamma function). */
const CRITICAL_1E6: Record<number, number> = { 1: 23.928, 2: 27.631, 3: 30.665, 5: 35.888 };

/** The spec's fixture of §9: 1 000 characters split 20 / 60 / 120 / 200 / 250 / 350 by the band rule. */
const FIXTURE = assignTiers(Array.from({ length: 1_000 }, (_, i) => ({ id: i + 1, favourites: 1_000 - i })));
const POOL: TierPool = perRarity((tier) => FIXTURE.filter((c) => c.tier === tier).map((c) => c.id));

const zeroes = () => Object.fromEntries(RARITIES.map((tier) => [tier, 0])) as Record<Rarity, number>;

interface LongRun {
  packs: number;
  byKind: Record<"standard" | "enchanted" | "radiant", number>;
  pityPacks: number;
  /** Packs whose position (free_packs_opened after it) is a multiple of 10 but that came out Radiant. */
  radiantOnTenth: number;
  /** Packs that were the 10th, 20th ... and came out neither Enchanted nor Radiant: must be none. */
  missedEnchanted: number;
  /** Packs that came out Enchanted off the cadence: must be none. */
  strayEnchanted: number;
  mythicPacks: number;
  mythicCards: number;
  cards: Record<Rarity, number>;
  /** Longest run of free packs without a Mythic card. */
  longestDrought: number;
  /** A pity pack that was not the 300th pack in a row without a Mythic, or a 300th that was not pity: must be none. */
  pityOffCount: number;
  /** A pity pack whose fifth card was not Mythic, or that held more than one Mythic: must be none. */
  badPityPacks: number;
  /** Runs that ended with a Mythic, and those of them that reached the 300th pack. */
  runs: number;
  runsReaching300: number;
  /** Per slot, tier counts in the packs where that slot rolled the standard table. */
  standardSlots: Record<Rarity, number>[];
  /** Slot 5 of Enchanted packs that were not pity-forced. */
  enchantedSlot5: Record<Rarity, number>;
  /** Slots 1-4 of Radiant packs, and slot 5 (all must be Mythic). */
  radiantSlots: Record<Rarity, number>;
  radiantSlot5NotMythic: number;
  /** The counters the run ended on, and what an audit of the openings recomputes. */
  counters: PackCounters;
  recomputed: PackCounters;
}

function simulate(packs: number, seed: number): LongRun {
  const rng = seededRng(seed);
  const run: LongRun = {
    packs,
    byKind: { standard: 0, enchanted: 0, radiant: 0 },
    pityPacks: 0,
    radiantOnTenth: 0,
    missedEnchanted: 0,
    strayEnchanted: 0,
    mythicPacks: 0,
    mythicCards: 0,
    cards: zeroes(),
    longestDrought: 0,
    pityOffCount: 0,
    badPityPacks: 0,
    runs: 0,
    runsReaching300: 0,
    standardSlots: SLOT_ODDS.map(zeroes),
    enchantedSlot5: zeroes(),
    radiantSlots: zeroes(),
    radiantSlot5NotMythic: 0,
    counters: { packsSinceMythic: 0, freePacksOpened: 0 },
    recomputed: { packsSinceMythic: 0, freePacksOpened: 0 },
  };
  let counters: PackCounters = { packsSinceMythic: 0, freePacksOpened: 0 };
  let drought = 0;
  let lastMythicAt = 0;
  for (let n = 1; n <= packs; n += 1) {
    const plan = planPack(counters, "free", rng);
    const dealt = drawPack(POOL, plan, rng);
    const tiers = dealt.map((card) => card.tier);
    const mythics = tiers.filter((tier) => tier === "mythic").length;

    run.byKind[plan.kind] += 1;
    const tenth = n % ENCHANTED_INTERVAL === 0;
    if (tenth && plan.kind === "radiant") run.radiantOnTenth += 1;
    if (tenth && plan.kind === "standard") run.missedEnchanted += 1;
    if (!tenth && plan.kind === "enchanted") run.strayEnchanted += 1;
    if (plan.pity) run.pityPacks += 1;
    if (plan.pity !== (drought === PITY_PACKS - 1 && plan.kind !== "radiant")) run.pityOffCount += 1;
    if (plan.pity && (tiers[PACK_SIZE - 1] !== "mythic" || mythics !== 1)) run.badPityPacks += 1;

    for (const tier of tiers) run.cards[tier] += 1;
    run.mythicCards += mythics;
    for (const [slot, rule] of plan.slots.entries()) {
      const tier = tiers[slot];
      if (tier === undefined) throw new Error("a slot without a card");
      if (plan.kind === "radiant") {
        if (slot === PACK_SIZE - 1) {
          if (tier !== "mythic") run.radiantSlot5NotMythic += 1;
        } else run.radiantSlots[tier] += 1;
      } else if (slot === PACK_SIZE - 1 && plan.kind === "enchanted") {
        if (!plan.pity) run.enchantedSlot5[tier] += 1;
      } else if ("roll" in rule) {
        const counts = run.standardSlots[slot];
        if (counts !== undefined) counts[tier] += 1;
      }
    }

    if (mythics > 0) {
      run.mythicPacks += 1;
      run.runs += 1;
      if (drought === PITY_PACKS - 1) run.runsReaching300 += 1;
      drought = 0;
      lastMythicAt = n;
    } else {
      drought += 1;
      run.longestDrought = Math.max(run.longestDrought, drought);
    }
    counters = countersAfter(counters, "free", tiers);
  }
  run.counters = counters;
  run.recomputed = { freePacksOpened: packs, packsSinceMythic: packs - lastMythicAt };
  return run;
}

/** 6 binomial standard deviations, inflated 1.5 times for dependence, plus `rounding` (in the same unit). */
function band(n: number, p: number, rounding: number): number {
  return 6 * 1.5 * Math.sqrt(n * p * (1 - p)) + rounding;
}

function expectNear(label: string, observed: number, expected: number, tolerance: number): void {
  expect(
    Math.abs(observed - expected),
    `${label}: observed ${observed}, expected ${expected.toFixed(1)} +/- ${tolerance.toFixed(1)}`,
  ).toBeLessThanOrEqual(tolerance);
}

function chiSquare(label: string, observed: Record<Rarity, number>, table: OddsTable): void {
  const tiers = RARITIES.filter((tier) => table[tier] > 0);
  const n = RARITIES.reduce((sum, tier) => sum + observed[tier], 0);
  const outside = RARITIES.filter((tier) => table[tier] === 0 && observed[tier] > 0);
  expect(outside, `${label}: tiers the table cannot deal`).toEqual([]);
  if (tiers.length < 2) {
    expect(observed[tiers[0] ?? "common"], `${label}: a one-tier table`).toBe(n);
    return;
  }
  const statistic = tiers.reduce((sum, tier) => {
    const e = (n * table[tier]) / ODDS_SCALE;
    return sum + (observed[tier] - e) ** 2 / e;
  }, 0);
  const critical = CRITICAL_1E6[tiers.length - 1];
  if (critical === undefined) throw new Error(`no critical value for ${tiers.length - 1} df`);
  const cells = tiers
    .map((tier) => `${tier} ${observed[tier]} vs ${((n * table[tier]) / ODDS_SCALE).toFixed(1)}`)
    .join(", ");
  expect(
    statistic,
    `${label}: chi-square ${statistic.toFixed(2)} (critical ${critical}); ${cells}`,
  ).toBeLessThan(critical);
}

describe(`one account's ${PACKS} free packs through planPack, drawPack and countersAfter (seeded)`, () => {
  let run: LongRun;
  const cardsDealt = PACKS * PACK_SIZE;
  // About 6 s on the dev station: the deal, not the generator, is the cost.
  beforeAll(() => {
    run = simulate(PACKS, SEED);
  }, 120_000);

  it("is reproducible: the same seed deals the same run", () => {
    const again = simulate(20_000, SEED);
    expect(simulate(20_000, SEED)).toEqual(again);
    expect(simulate(20_000, SEED + 1)).not.toEqual(again);
  });

  describe("deterministic rules, every pack", () => {
    it("never lets 300 free packs in a row pass without a Mythic: the longest drought is at most 299", () => {
      expect(run.longestDrought).toBeLessThanOrEqual(PITY_PACKS - 1);
      // Over this many packs a 299-pack drought happens hundreds of times, so the bound is reached, not just respected.
      expect(run.longestDrought).toBe(PITY_PACKS - 1);
    });

    it("forces pity exactly on the 300th pack in a row without a Mythic, unless that pack is Radiant", () => {
      expect(run.pityOffCount).toBe(0);
      expect(run.badPityPacks).toBe(0);
    });

    it("makes every 10th free pack Enchanted unless it is Radiant, and no other pack Enchanted", () => {
      expect(run.missedEnchanted).toBe(0);
      expect(run.strayEnchanted).toBe(0);
      expect(run.byKind.enchanted + run.radiantOnTenth).toBe(PACKS / ENCHANTED_INTERVAL);
    });

    it("deals every Radiant fifth card as Mythic", () => {
      expect(run.radiantSlot5NotMythic).toBe(0);
    });

    it("ends on counters equal to their recomputation from the openings (§5.4.5 audit)", () => {
      expect(run.counters).toEqual(run.recomputed);
    });
  });

  describe("rates against §5.4.6's printed figures", () => {
    it("Radiant: 0.04 % of packs, 1 in 2 500", () => {
      const p = RADIANT_ODDS / ODDS_SCALE;
      expectNear("Radiant packs", run.byKind.radiant, PACKS * p, band(PACKS, p, 0));
    });

    it("Enchanted: 10 % of free packs (less the Radiant ones that fall on a 10th)", () => {
      const p = 1 / ENCHANTED_INTERVAL;
      expectNear(
        "Enchanted packs",
        run.byKind.enchanted,
        PACKS * p * (1 - RADIANT_ODDS / ODDS_SCALE),
        band(PACKS, p, 0),
      );
    });

    it("free packs with at least one Mythic: 0.5645 %, 1 in 177 (0.390 % without pity lies outside the band)", () => {
      const p = 0.005645;
      const tolerance = band(PACKS, p, PACKS * 0.000_000_5);
      expectNear("Mythic packs", run.mythicPacks, PACKS * p, tolerance);
      expect(Math.abs(PACKS * 0.0039 - PACKS * p), "the band would not tell pity from none").toBeGreaterThan(
        tolerance,
      );
    });

    it("Mythic cards per free pack: 0.005665", () => {
      const p = 0.005665;
      expectNear("Mythic cards", run.mythicCards, PACKS * p, band(PACKS, p, PACKS * 0.000_000_5));
    });

    it("pity packs: 0.176 % of all free packs and 31 % of Mythic packs", () => {
      const p = 0.00176;
      expectNear("pity packs", run.pityPacks, PACKS * p, band(PACKS, p, PACKS * 0.000_005));
      const share = 0.31;
      expectNear(
        "pity share of Mythic packs",
        run.pityPacks,
        run.mythicPacks * share,
        band(run.mythicPacks, share, run.mythicPacks * 0.005),
      );
    });

    it("about 31 % of the runs that start after a Mythic reach the 300th pack", () => {
      const share = 0.31;
      expectNear(
        "runs reaching 300",
        run.runsReaching300,
        run.runs * share,
        band(run.runs, share, run.runs * 0.005),
      );
      // Every pity pack ends a run that reached the 300th pack; a Radiant 300th ends one without pity.
      expect(run.runsReaching300 - run.pityPacks).toBeGreaterThanOrEqual(0);
      expect(run.runsReaching300 - run.pityPacks).toBeLessThan(10);
    });

    it.each([
      ["common", 0.5598, 0.000_05],
      ["uncommon", 0.2399, 0.000_05],
      ["rare", 0.1438, 0.000_05],
      ["epic", 0.0477, 0.000_05],
      ["legendary", 0.00772, 0.000_005],
      ["mythic", 0.00113, 0.000_005],
    ] as const)("share of all free-pack cards, every rule on: %s %f", (tier, share, rounding) => {
      expectNear(
        `${tier} cards`,
        run.cards[tier],
        cardsDealt * share,
        band(cardsDealt, share, cardsDealt * rounding),
      );
    });
  });

  describe("each slot's table where the run rolled it (chi-square at 1 - 10^-6)", () => {
    it.each([0, 1, 2, 3, 4])("standard slot %i (0-based) against SLOT_ODDS", (slot) => {
      const table = SLOT_ODDS[slot];
      const observed = run.standardSlots[slot];
      if (table === undefined || observed === undefined) throw new Error(`no slot ${slot}`);
      chiSquare(`slot ${slot + 1}`, observed, table);
    });

    it("Enchanted slot 5 against ENCHANTED_SLOT_ODDS", () => {
      chiSquare("Enchanted slot 5", run.enchantedSlot5, ENCHANTED_SLOT_ODDS);
    });

    it("Radiant slots 1-4 against RADIANT_SLOT_ODDS", () => {
      chiSquare("Radiant slots 1-4", run.radiantSlots, RADIANT_SLOT_ODDS);
    });
  });
});

describe("the pity counter at its boundaries, through planPack and countersAfter", () => {
  const rng = seededRng(SEED ^ 0x55);
  const deal = (packsSinceMythic: number, freePacksOpened = 0) => {
    const counters = { packsSinceMythic, freePacksOpened };
    const plan = planPack(counters, "free", rng);
    const tiers = drawPack(POOL, plan, rng).map((card) => card.tier);
    return { plan, tiers, after: countersAfter(counters, "free", tiers) };
  };

  it("at 298 (threshold - 1): never pity; without a Mythic the counter reaches 299, never 300", () => {
    for (let i = 0; i < 5_000; i += 1) {
      const { plan, tiers, after } = deal(PITY_PACKS - 2);
      expect(plan.pity).toBe(false);
      expect(after.packsSinceMythic).toBe(tiers.includes("mythic") ? 0 : PITY_PACKS - 1);
    }
  });

  it("at 299 (the threshold): always a Mythic, so the counter always returns to 0, whatever the plan roll", () => {
    for (let i = 0; i < 5_000; i += 1) {
      for (const freePacksOpened of [0, 9]) {
        const { plan, tiers, after } = deal(PITY_PACKS - 1, freePacksOpened);
        expect(tiers[PACK_SIZE - 1]).toBe("mythic");
        expect(plan.pity).toBe(plan.kind !== "radiant");
        expect(after.packsSinceMythic).toBe(0);
      }
    }
  });

  it("from every reachable count 0..299, the next count stays in 0..299, the range the database check allows", () => {
    for (let since = 0; since < PITY_PACKS; since += 1) {
      for (let i = 0; i < 20; i += 1) {
        const { after } = deal(since, since);
        expect(after.packsSinceMythic).toBeGreaterThanOrEqual(0);
        expect(after.packsSinceMythic).toBeLessThanOrEqual(PITY_PACKS - 1);
      }
    }
  });
});
