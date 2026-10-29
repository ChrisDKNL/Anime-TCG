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
  SHARE_SCALE,
  SLOT_FLOOR,
  SLOT_ODDS,
  TIER_BAND,
} from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import { perRarity, tierCounts } from "../pool/tiers.js";
import { atLeastOnePerPack, floorOf, publishedOdds, shareOfCards } from "./odds.js";
import { LAST_SLOT, planPack, tierForRoll } from "./roll.js";

/** A standard pack's five tables, an Enchanted pack's and a Radiant pack's (its last slot a certain Mythic), in slot order. */
const PACK_TABLES = {
  standard: SLOT_ODDS,
  enchanted: SLOT_ODDS.map((table, slot) => (slot === LAST_SLOT ? ENCHANTED_SLOT_ODDS : table)),
  radiant: SLOT_ODDS.map((_, slot) =>
    slot === LAST_SLOT ? perRarity((tier) => (tier === "mythic" ? ODDS_SCALE : 0)) : RADIANT_SLOT_ODDS,
  ),
} satisfies Record<string, readonly OddsTable[]>;

const below = (floor: Rarity) => RARITIES.slice(0, RARITIES.indexOf(floor));
const asRecord = (table: OddsTable) => perRarity((tier) => table[tier]);

const TABLES: [string, OddsTable, Rarity][] = [
  ...SLOT_ODDS.map((table, slot): [string, OddsTable, Rarity] => [
    `standard slot ${slot + 1}`,
    table,
    SLOT_FLOOR[slot] ?? "mythic",
  ]),
  ["ENCHANTED_SLOT_ODDS", ENCHANTED_SLOT_ODDS, "epic"],
  ["RADIANT_SLOT_ODDS", RADIANT_SLOT_ODDS, "epic"],
];

describe("every table, exhaustively (collection-packs.md §9)", () => {
  it.each(TABLES)(
    "maps every roll of the scale through %s to exactly its counts, nothing below its floor",
    (_label, table, floor) => {
      const counts = new Map<Rarity, number>(RARITIES.map((tier) => [tier, 0]));
      for (let r = 0; r < ODDS_SCALE; r += 1) {
        const tier = tierForRoll(table, r);
        counts.set(tier, (counts.get(tier) ?? 0) + 1);
      }
      expect(Object.fromEntries(counts)).toEqual(asRecord(table));
      for (const tier of below(floor)) expect(counts.get(tier), tier).toBe(0);
      expect(RARITIES.reduce((sum, tier) => sum + table[tier], 0)).toBe(ODDS_SCALE);
      expect(floorOf(table)).toBe(floor);
    },
  );

  it("takes the tiers rarest first by running sums: standard slot 5 is Mythic below 2 500, Legendary below 30 000, Epic below 200 000", () => {
    const slot5 = SLOT_ODDS[4];
    expect(
      [0, 2_499, 2_500, 29_999, 30_000, 199_999, 200_000, 999_999].map((r) => tierForRoll(slot5, r)),
    ).toEqual(["mythic", "mythic", "legendary", "legendary", "epic", "epic", "rare", "rare"]);
    const slot1 = SLOT_ODDS[0];
    expect([0, 66_665, 66_666, 999_999].map((r) => tierForRoll(slot1, r))).toEqual([
      "uncommon",
      "uncommon",
      "common",
      "common",
    ]);
    expect([0, 12_499, 12_500, 149_999, 150_000].map((r) => tierForRoll(ENCHANTED_SLOT_ODDS, r))).toEqual([
      "mythic",
      "mythic",
      "legendary",
      "legendary",
      "epic",
    ]);
  });

  it.each([-1, ODDS_SCALE, 0.5, Number.NaN])("refuses a roll of %s instead of guessing a tier", (r) => {
    expect(() => tierForRoll(SLOT_ODDS[4], r)).toThrow(RangeError);
  });

  it("refuses a table that does not reach the scale rather than falling through to a tier", () => {
    const short = { ...asRecord(SLOT_ODDS[4]), rare: 0 };
    expect(() => tierForRoll(short, 999_999)).toThrow(RangeError);
  });

  it("plans a Radiant pack for exactly RADIANT_ODDS of the million plan rolls", () => {
    const counters = { packsSinceMythic: 0, freePacksOpened: 0 };
    let radiant = 0;
    for (let r = 0; r < ODDS_SCALE; r += 1) {
      if (planPack(counters, "free", () => r).kind === "radiant") radiant += 1;
    }
    expect(radiant).toBe(RADIANT_ODDS);
    expect(planPack(counters, "free", () => RADIANT_ODDS - 1).kind).toBe("radiant");
    expect(planPack(counters, "free", () => RADIANT_ODDS).kind).toBe("standard");
  });
});

const ppm = (tables: readonly OddsTable[]) => perRarity((tier) => atLeastOnePerPack(tables, tier));

describe("figures recomputed from the tables (§5.4.1, §5.4.2)", () => {
  it("sums the five slots to 2 800 000 / 1 200 000 / 800 000 / 170 000 / 27 500 / 2 500", () => {
    const sums = perRarity((tier) => SLOT_ODDS.reduce((sum, table) => sum + table[tier], 0));
    expect(sums).toEqual({
      common: 2_800_000,
      uncommon: 1_200_000,
      rare: 800_000,
      epic: 170_000,
      legendary: 27_500,
      mythic: 2_500,
    });
  });

  it("gives a standard pack's cards the owner's shares exactly: 56 / 24 / 16 / 3.4 / 0.55 / 0.05 %", () => {
    const share = perRarity((tier) => shareOfCards(SLOT_ODDS, tier));
    expect(share).toEqual({
      common: 560_000,
      uncommon: 240_000,
      rare: 160_000,
      epic: 34_000,
      legendary: 5_500,
      mythic: 500,
    });
    expect(RARITIES.reduce((sum, tier) => sum + share[tier], 0)).toBe(1_000_000);
  });

  it("computes at least one per standard pack in BigInt: 999 704, 1 000 000, 800 000, 170 000, 27 500, 2 500", () => {
    expect(ppm(PACK_TABLES.standard)).toEqual({
      common: 999_704,
      uncommon: 1_000_000,
      rare: 800_000,
      epic: 170_000,
      legendary: 27_500,
      mythic: 2_500,
    });
  });

  it("computes the Enchanted and Radiant columns of §5.4.2's table", () => {
    expect(ppm(PACK_TABLES.enchanted)).toEqual({
      common: 999_704,
      uncommon: 1_000_000,
      rare: 0,
      epic: 850_000,
      legendary: 137_500,
      mythic: 12_500,
    });
    expect(ppm(PACK_TABLES.radiant)).toEqual({
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 999_494,
      legendary: 446_603,
      mythic: 1_000_000,
    });
    // A Radiant pack holds 1.05 Mythics on average: one forced, 4 × 12 500 / 1 000 000 rolled.
    expect(PACK_TABLES.radiant.reduce((sum, table) => sum + table.mythic, 0) / ODDS_SCALE).toBe(1.05);
  });

  it("is 0 for a tier no slot rolls and the whole million for one a slot always holds", () => {
    expect(atLeastOnePerPack(SLOT_ODDS, "rare")).toBe(800_000);
    expect(atLeastOnePerPack([SLOT_ODDS[0]], "mythic")).toBe(0);
    expect(atLeastOnePerPack([SLOT_ODDS[3]], "uncommon")).toBe(1_000_000);
  });
});

describe("published odds (§5.4.8, §6.2)", () => {
  it("publish the tables, shares, per-pack figures, special rules, bands, tier sizes and snapshot as applied", () => {
    const tierSizes = tierCounts(2_983);
    const snapshot = { version: 3, takenAt: "2026-10-29T12:52:00.000Z", characterCount: 2_983 };
    const odds = publishedOdds(tierSizes, snapshot);
    expect(odds).toEqual({
      scale: ODDS_SCALE,
      slots: SLOT_ODDS.map((table, slot) => ({ floor: SLOT_FLOOR[slot], odds: asRecord(table) })),
      share: {
        common: 560_000,
        uncommon: 240_000,
        rare: 160_000,
        epic: 34_000,
        legendary: 5_500,
        mythic: 500,
      },
      perPack: {
        common: 999_704,
        uncommon: 1_000_000,
        rare: 800_000,
        epic: 170_000,
        legendary: 27_500,
        mythic: 2_500,
      },
      enchanted: {
        every: ENCHANTED_INTERVAL,
        slot: PACK_SIZE - 1,
        floor: "epic",
        odds: asRecord(ENCHANTED_SLOT_ODDS),
      },
      radiant: { chance: RADIANT_ODDS, odds: asRecord(RADIANT_SLOT_ODDS), lastSlot: "mythic" },
      pity: { packs: PITY_PACKS, freePacksOnly: true },
      bandScale: SHARE_SCALE,
      tierBands: asRecord(TIER_BAND),
      tierSizes,
      snapshot,
    });
    expect(odds.slots.map((slot) => slot.floor)).toEqual(["common", "common", "common", "uncommon", "rare"]);
  });
});

describe("one given character's chance (§5.4.2)", () => {
  const share = perRarity((tier) => shareOfCards(SLOT_ODDS, tier) / 1_000_000);
  const perCard = (sizes: Record<Rarity, number>) => RARITIES.map((tier) => share[tier] / sizes[tier]);

  it("falls strictly from Common to Mythic at every N from 225 to 6 000, Rare at least 1.175 times rarer than Uncommon", () => {
    let closest = Infinity;
    for (let n = 225; n <= 6_000; n += 1) {
      const rates = perCard(tierCounts(n));
      for (let i = 1; i < rates.length; i += 1) {
        expect(rates[i], `N = ${n}, ${RARITIES[i]}`).toBeLessThan(rates[i - 1] ?? 0);
      }
      closest = Math.min(closest, (rates[1] ?? 0) / (rates[2] ?? 1));
    }
    expect(closest).toBeGreaterThanOrEqual(1.175);
  });

  it("is §5.4.2's table at the real snapshot (N = 2 983), 1.198 times between Uncommon and Rare", () => {
    const sizes = tierCounts(2_983);
    const oneIn = RARITIES.map((tier) => Math.round(sizes[tier] / share[tier]));
    const oneInPerPack = RARITIES.map((tier) => Math.round(sizes[tier] / (PACK_SIZE * share[tier])));
    expect(oneIn).toEqual([1_864, 3_108, 3_725, 10_529, 32_545, 120_000]);
    expect(oneInPerPack).toEqual([373, 622, 745, 2_106, 6_509, 24_000]);
    const rates = perCard(sizes);
    expect(((rates[1] ?? 0) / (rates[2] ?? 1)).toFixed(3)).toBe("1.198");
  });
});

/**
 * The long run of one account's free packs (§5.4.6), exactly: a run of
 * packs starts after a Mythic with `free_packs_opened mod 10` at some phase
 * and ends at the next Mythic (by pity at the latest), so the phases at the
 * starts of runs form a 10-state chain. Its stationary weights, times each
 * run's survival curve, give the long-run share of every state of the two
 * counters, and so every per-pack average.
 */
function longRun() {
  type PackFigures = {
    cards: Record<Rarity, number>;
    mythicPack: number;
    pityPack: number;
    enchanted: number;
  };
  const radiantChance = RADIANT_ODDS / ODDS_SCALE;
  const expected = (tables: readonly OddsTable[]) =>
    perRarity((tier) => tables.reduce((sum, table) => sum + table[tier] / ODDS_SCALE, 0));
  const packAt = (sinceMythic: number, opened: number): PackFigures => {
    const pity = sinceMythic === PITY_PACKS - 1;
    const enchanted = (opened + 1) % ENCHANTED_INTERVAL === 0;
    const plan = planPack(
      { packsSinceMythic: sinceMythic, freePacksOpened: opened },
      "free",
      () => RADIANT_ODDS,
    );
    const tables = plan.slots.map((rule) =>
      "roll" in rule ? rule.roll : perRarity((tier) => (tier === rule.forced ? ODDS_SCALE : 0)),
    );
    const normal = expected(tables);
    const radiant = expected(PACK_TABLES.radiant);
    const lastMythic = (tables.at(-1)?.mythic ?? 0) / ODDS_SCALE;
    return {
      cards: perRarity((tier) => radiantChance * radiant[tier] + (1 - radiantChance) * normal[tier]),
      mythicPack: radiantChance + (1 - radiantChance) * lastMythic,
      pityPack: pity ? 1 - radiantChance : 0,
      enchanted: enchanted ? 1 : 0,
    };
  };

  const runs = Array.from({ length: ENCHANTED_INTERVAL }, (_, phase) => {
    let survival = 1;
    const steps: { weight: number; pack: PackFigures }[] = [];
    const nextPhase = Array<number>(ENCHANTED_INTERVAL).fill(0);
    for (let k = 0; k < PITY_PACKS; k += 1) {
      const pack = packAt(k, phase + k);
      steps.push({ weight: survival, pack });
      const to = (phase + k + 1) % ENCHANTED_INTERVAL;
      nextPhase[to] = (nextPhase[to] ?? 0) + survival * pack.mythicPack;
      survival *= 1 - pack.mythicPack;
    }
    return { steps, nextPhase };
  });
  let phases = Array<number>(ENCHANTED_INTERVAL).fill(1 / ENCHANTED_INTERVAL);
  for (let round = 0; round < 2_000; round += 1) {
    const next = Array<number>(ENCHANTED_INTERVAL).fill(0);
    runs.forEach((run, from) =>
      run.nextPhase.forEach((p, to) => (next[to] = (next[to] ?? 0) + (phases[from] ?? 0) * p)),
    );
    phases = next;
  }

  let packs = 0;
  let mythicPacks = 0;
  let pityPacks = 0;
  let enchanted = 0;
  const cards = perRarity(() => 0);
  runs.forEach((run, phase) => {
    for (const { weight, pack } of run.steps) {
      const w = (phases[phase] ?? 0) * weight;
      packs += w;
      mythicPacks += w * pack.mythicPack;
      pityPacks += w * pack.pityPack;
      enchanted += w * pack.enchanted;
      for (const tier of RARITIES) cards[tier] += w * pack.cards[tier];
    }
  });
  return {
    mythicPackShare: mythicPacks / packs,
    mythicCardsPerPack: cards.mythic / packs,
    pityShareOfMythicPacks: pityPacks / mythicPacks,
    pityShareOfPacks: pityPacks / packs,
    enchantedShare: enchanted / packs,
    cardShare: perRarity((tier) => cards[tier] / packs / PACK_SIZE),
  };
}

describe("the long run with every rule on (§5.4.6), from the Markov chain over the two counters", () => {
  const run = longRun();
  const percent = (value: number, digits: number) => (value * 100).toFixed(digits);

  it("has a Mythic in 0.5645 % of free packs, 1 in 177, against 0.390 %, 1 in 256, without pity", () => {
    expect(percent(run.mythicPackShare, 4)).toBe("0.5645");
    expect(Math.round(1 / run.mythicPackShare)).toBe(177);
    const radiant = RADIANT_ODDS / ODDS_SCALE;
    const withoutPity =
      radiant +
      (1 - radiant) *
        ((SLOT_ODDS[4].mythic / ODDS_SCALE) * (1 - 1 / ENCHANTED_INTERVAL) +
          ENCHANTED_SLOT_ODDS.mythic / ODDS_SCALE / ENCHANTED_INTERVAL);
    expect(percent(withoutPity, 3)).toBe("0.390");
    expect(Math.floor(1 / withoutPity)).toBe(256);
  });

  it("deals 0.005665 Mythic cards per free pack, 31 % of Mythic packs from pity, 0.176 % of all packs", () => {
    expect(run.mythicCardsPerPack.toFixed(6)).toBe("0.005665");
    expect(percent(run.pityShareOfMythicPacks, 0)).toBe("31");
    expect(percent(run.pityShareOfPacks, 3)).toBe("0.176");
  });

  it("makes 10 % of free packs Enchanted", () => {
    expect(run.enchantedShare).toBeCloseTo(1 / ENCHANTED_INTERVAL, 12);
  });

  it("gives all free-pack cards 55.98 / 23.99 / 14.38 / 4.77 / 0.772 / 0.113 %", () => {
    const share = run.cardShare;
    expect([
      percent(share.common, 2),
      percent(share.uncommon, 2),
      percent(share.rare, 2),
      percent(share.epic, 2),
      percent(share.legendary, 3),
      percent(share.mythic, 3),
    ]).toEqual(["55.98", "23.99", "14.38", "4.77", "0.772", "0.113"]);
  });
});
