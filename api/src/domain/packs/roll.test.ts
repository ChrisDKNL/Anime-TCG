import { PACK_SIZE } from "@anime-tcg/shared/economy";
import {
  ENCHANTED_INTERVAL,
  ENCHANTED_SLOT_ODDS,
  ODDS_SCALE,
  PITY_PACKS,
  RADIANT_SLOT_ODDS,
  RARITIES,
  type Rarity,
  SLOT_FLOOR,
  SLOT_ODDS,
} from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import {
  countersAfter,
  drawPack,
  type PackCounters,
  type PackPlan,
  packsUntilGuarantee,
  planPack,
  type TierPool,
} from "./roll.js";
import { cryptoRng, type Rng } from "./rng.js";

/** Answers each call with the next scripted value, checking it is inside the range asked for. */
function scripted(values: number[]): Rng & { calls: [number, number][] } {
  const calls: [number, number][] = [];
  const rng = (min: number, max: number) => {
    calls.push([min, max]);
    const value = values.shift();
    if (value === undefined) throw new Error("script ran out");
    if (value < min || value >= max) throw new Error(`scripted ${value} outside [${min}, ${max})`);
    return value;
  };
  return Object.assign(rng, { calls });
}

const pool: TierPool = {
  common: [100, 101, 102, 103, 104, 105, 106, 107],
  uncommon: [150, 151, 152, 153, 154, 155],
  rare: [200, 201, 202, 203, 204, 205],
  epic: [300, 301, 302, 303, 304],
  legendary: [400, 401, 402, 403, 404],
  mythic: [500, 501, 502, 503, 504],
};
const TIER_OF = new Map(RARITIES.flatMap((tier) => pool[tier].map((id) => [id, tier] as const)));

const NOT_RADIANT = ODDS_SCALE - 1;
const RADIANT = 0;
const fresh: PackCounters = { packsSinceMythic: 0, freePacksOpened: 0 };
const tablesOf = (plan: PackPlan) => plan.slots.map((rule) => ("roll" in rule ? rule.roll : rule.forced));

describe("planPack: §5.4.3's precedence, every row", () => {
  it("makes the Radiant roll first, one call in [0, ODDS_SCALE), even when pity is due", () => {
    for (const counters of [fresh, { packsSinceMythic: PITY_PACKS - 1, freePacksOpened: 9 }]) {
      const rng = scripted([NOT_RADIANT]);
      planPack(counters, "free", rng);
      expect(rng.calls).toEqual([[0, ODDS_SCALE]]);
    }
  });

  it.each([0, 8, 10, 18, 298])("free_packs_opened %i: a standard pack of the five slot tables", (opened) => {
    const plan = planPack({ packsSinceMythic: 0, freePacksOpened: opened }, "free", scripted([NOT_RADIANT]));
    expect(plan).toMatchObject({ kind: "standard", pity: false });
    expect(tablesOf(plan)).toEqual([...SLOT_ODDS]);
  });

  it.each([9, 19, 299])(
    "free_packs_opened %i: the next is the 10th, 20th, 300th: Enchanted, slot 5 on ENCHANTED_SLOT_ODDS",
    (opened) => {
      const plan = planPack(
        { packsSinceMythic: 0, freePacksOpened: opened },
        "free",
        scripted([NOT_RADIANT]),
      );
      expect(plan).toMatchObject({ kind: "enchanted", pity: false });
      expect(tablesOf(plan)).toEqual([...SLOT_ODDS.slice(0, 4), ENCHANTED_SLOT_ODDS]);
    },
  );

  it("packs_since_mythic 298: not pity-due", () => {
    const plan = planPack({ packsSinceMythic: 298, freePacksOpened: 0 }, "free", scripted([NOT_RADIANT]));
    expect(plan.pity).toBe(false);
    expect(tablesOf(plan).at(-1)).toBe(SLOT_ODDS[4]);
  });

  it("packs_since_mythic 299: slot 5 is Mythic without a roll, pity true, slots 1-4 standard", () => {
    const plan = planPack({ packsSinceMythic: 299, freePacksOpened: 0 }, "free", scripted([NOT_RADIANT]));
    expect(plan).toMatchObject({ kind: "standard", pity: true });
    expect(tablesOf(plan)).toEqual([...SLOT_ODDS.slice(0, 4), "mythic"]);
  });

  it("Enchanted and pity both due: an enchanted pack whose fifth card is the pity Mythic", () => {
    const plan = planPack({ packsSinceMythic: 299, freePacksOpened: 9 }, "free", scripted([NOT_RADIANT]));
    expect(plan).toMatchObject({ kind: "enchanted", pity: true });
    expect(tablesOf(plan)).toEqual([...SLOT_ODDS.slice(0, 4), "mythic"]);
  });

  it.each([
    ["nothing else", fresh],
    ["Enchanted", { packsSinceMythic: 0, freePacksOpened: 9 }],
    ["pity", { packsSinceMythic: 299, freePacksOpened: 0 }],
    ["Enchanted and pity", { packsSinceMythic: 299, freePacksOpened: 19 }],
  ])(
    "a Radiant first roll with %s due: radiant, pity false, slots 1-4 on RADIANT_SLOT_ODDS, slot 5 Mythic",
    (_label, counters) => {
      const plan = planPack(counters, "free", scripted([RADIANT]));
      expect(plan).toMatchObject({ kind: "radiant", pity: false });
      expect(tablesOf(plan)).toEqual([
        RADIANT_SLOT_ODDS,
        RADIANT_SLOT_ODDS,
        RADIANT_SLOT_ODDS,
        RADIANT_SLOT_ODDS,
        "mythic",
      ]);
    },
  );

  it("a shop pack is never Enchanted or pity-due, and still rolls Radiant", () => {
    const due = { packsSinceMythic: 299, freePacksOpened: 9 };
    expect(planPack(due, "shop", scripted([NOT_RADIANT]))).toMatchObject({ kind: "standard", pity: false });
    expect(tablesOf(planPack(due, "shop", scripted([NOT_RADIANT])))).toEqual([...SLOT_ODDS]);
    expect(planPack(due, "shop", scripted([RADIANT]))).toMatchObject({ kind: "radiant", pity: false });
  });
});

describe("drawPack", () => {
  const standard = planPack(fresh, "free", () => NOT_RADIANT);

  it("rolls each slot's own table, then picks from that tier's list by partial Fisher–Yates", () => {
    // Slots 1-3: Uncommon (roll 0), Common (999 999), Common; slot 4 Uncommon; slot 5 Mythic (roll 0).
    // Picks: uncommon 5 (155); common 7 (107); common from [1, 8) index 7, whose slot now holds 100;
    // uncommon from [1, 6) index 5, now holding 150; mythic 2 (502).
    const rng = scripted([0, 5, 999_999, 7, 999_999, 7, 0, 5, 0, 2]);
    expect(drawPack(pool, standard, rng)).toEqual([
      { slot: 0, characterId: 155, tier: "uncommon" },
      { slot: 1, characterId: 107, tier: "common" },
      { slot: 2, characterId: 100, tier: "common" },
      { slot: 3, characterId: 150, tier: "uncommon" },
      { slot: 4, characterId: 502, tier: "mythic" },
    ]);
    expect(rng.calls.filter((_, index) => index % 2 === 0)).toEqual(Array(PACK_SIZE).fill([0, ODDS_SCALE]));
  });

  it("takes no tier roll for a forced slot: a pity pack asks for four tier rolls and five picks", () => {
    const pity = planPack(
      { packsSinceMythic: PITY_PACKS - 1, freePacksOpened: 0 },
      "free",
      () => NOT_RADIANT,
    );
    const tiers = scripted([999_999, 999_999, 999_999, 0]);
    const picks = scripted([0, 1, 2, 0, 3]);
    const pack = drawPack(pool, pity, picks, tiers);
    expect(pack.map((card) => card.tier)).toEqual(["common", "common", "common", "uncommon", "mythic"]);
    expect(pack.at(-1)?.characterId).toBe(503);
    expect(tiers.calls).toHaveLength(4);
    expect(picks.calls).toHaveLength(PACK_SIZE);
  });

  it("always deals PACK_SIZE different characters, each of its slot's tier and at or above its floor", () => {
    for (let i = 0; i < 2_000; i += 1) {
      const plan = planPack({ packsSinceMythic: 0, freePacksOpened: i }, "free", cryptoRng);
      const pack = drawPack(pool, plan, cryptoRng);
      expect(pack.map((card) => card.slot)).toEqual([0, 1, 2, 3, 4]);
      expect(new Set(pack.map((card) => card.characterId)).size).toBe(PACK_SIZE);
      pack.forEach((card, slot) => {
        expect(TIER_OF.get(card.characterId)).toBe(card.tier);
        expect(RARITIES.indexOf(card.tier)).toBeGreaterThanOrEqual(
          RARITIES.indexOf(SLOT_FLOOR[slot] ?? "mythic"),
        );
      });
    }
  });

  it("draws five different Mythics from a tier of exactly PACK_SIZE in a Radiant pack whose slots all land on Mythic", () => {
    const radiant = planPack(fresh, "free", () => RADIANT);
    for (let i = 0; i < 200; i += 1) {
      const pack = drawPack(pool, radiant, cryptoRng, scripted([0, 0, 0, 0]));
      expect(pack.map((card) => card.tier)).toEqual(Array(PACK_SIZE).fill("mythic"));
      expect(pack.map((card) => card.characterId).sort()).toEqual([500, 501, 502, 503, 504]);
    }
  });

  it("keeps the tier roll and the pick on separate generators when told to", () => {
    const radiant = planPack(fresh, "free", () => RADIANT);
    const tiers = scripted([0, 0, 0, 0]);
    const picks = scripted([4, 4, 4, 4, 4]);
    expect(drawPack(pool, radiant, picks, tiers).map((card) => card.characterId)).toEqual([
      504, 500, 501, 502, 503,
    ]);
    expect(picks.calls).toEqual([
      [0, 5],
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
    ]);
  });

  it("refuses to repeat a character when a tier is smaller than the pack", () => {
    const thin: TierPool = { ...pool, mythic: [500, 501] };
    const radiant = planPack(fresh, "free", () => RADIANT);
    expect(() => drawPack(thin, radiant, cryptoRng, scripted([0, 0, 0, 0]))).toThrow("ran out of characters");
  });

  it("refuses a plan that is not one rule per card", () => {
    expect(() => drawPack(pool, { ...standard, slots: standard.slots.slice(1) }, cryptoRng)).toThrow(
      RangeError,
    );
  });
});

describe("the counters (§5.4.5)", () => {
  const withMythic: Rarity[] = ["common", "common", "uncommon", "uncommon", "mythic"];
  const without: Rarity[] = ["common", "common", "common", "uncommon", "legendary"];

  it("a free pack adds one to both; a Mythic in any slot sets packs_since_mythic to 0", () => {
    expect(countersAfter({ packsSinceMythic: 41, freePacksOpened: 99 }, "free", without)).toEqual({
      packsSinceMythic: 42,
      freePacksOpened: 100,
    });
    expect(countersAfter({ packsSinceMythic: 41, freePacksOpened: 99 }, "free", withMythic)).toEqual({
      packsSinceMythic: 0,
      freePacksOpened: 100,
    });
    const firstSlot: Rarity[] = ["mythic", "epic", "epic", "epic", "epic"];
    expect(
      countersAfter({ packsSinceMythic: 7, freePacksOpened: 7 }, "free", firstSlot).packsSinceMythic,
    ).toBe(0);
  });

  it("a shop pack moves neither, but its Mythic still resets packs_since_mythic", () => {
    expect(countersAfter({ packsSinceMythic: 41, freePacksOpened: 99 }, "shop", without)).toEqual({
      packsSinceMythic: 41,
      freePacksOpened: 99,
    });
    expect(countersAfter({ packsSinceMythic: 41, freePacksOpened: 99 }, "shop", withMythic)).toEqual({
      packsSinceMythic: 0,
      freePacksOpened: 99,
    });
  });

  it("publishes packsUntilGuarantee = 300 - packs_since_mythic, from 300 down to 1, never 0 or 301", () => {
    expect(packsUntilGuarantee({ packsSinceMythic: 0 })).toBe(300);
    expect(packsUntilGuarantee({ packsSinceMythic: 1 })).toBe(299);
    expect(packsUntilGuarantee({ packsSinceMythic: PITY_PACKS - 1 })).toBe(1);
  });

  it("over 30 000 free packs on the real generator: no run of 300 without a Mythic, every 10th Enchanted unless Radiant, counters equal to their recomputation", () => {
    const real: TierPool = {
      ...pool,
      mythic: [500, 501, 502, 503, 504, 505],
      legendary: [400, 401, 402, 403, 404, 405],
      epic: [300, 301, 302, 303, 304, 305],
    };
    let counters = fresh;
    let longestRun = 0;
    const wrong: string[] = [];
    const openings: { kind: string; pity: boolean; mythic: boolean }[] = [];
    for (let n = 1; n <= 30_000; n += 1) {
      const plan = planPack(counters, "free", cryptoRng);
      const tiers = drawPack(real, plan, cryptoRng).map((card) => card.tier);
      const tenth = n % ENCHANTED_INTERVAL === 0;
      if (tenth !== (plan.kind === "enchanted") && plan.kind !== "radiant")
        wrong.push(`pack ${n} was ${plan.kind}`);
      if (plan.kind === "enchanted" && !["epic", "legendary", "mythic"].includes(tiers[4] ?? "")) {
        wrong.push(`Enchanted pack ${n} ended in ${tiers[4]}`);
      }
      if (plan.pity && tiers.filter((tier) => tier === "mythic").length !== 1)
        wrong.push(`pity pack ${n}: ${tiers.join(" ")}`);
      openings.push({ kind: plan.kind, pity: plan.pity, mythic: tiers.includes("mythic") });
      counters = countersAfter(counters, "free", tiers);
      // packs_since_mythic counts the run so far; a run of 300 packs without a Mythic would reach 300.
      longestRun = Math.max(longestRun, counters.packsSinceMythic);
    }
    expect(wrong).toEqual([]);
    expect(longestRun).toBeLessThanOrEqual(PITY_PACKS - 1);
    const lastMythic = openings.findLastIndex((opening) => opening.mythic);
    expect(counters).toEqual({
      freePacksOpened: openings.length,
      packsSinceMythic: openings.length - 1 - lastMythic,
    });
    // A pity pack comes exactly after 299 packs without a Mythic.
    let since = 0;
    for (const opening of openings) {
      expect(opening.pity).toBe(since === PITY_PACKS - 1 && opening.kind !== "radiant");
      since = opening.mythic ? 0 : since + 1;
    }
  });
});
