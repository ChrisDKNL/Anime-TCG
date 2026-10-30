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
import { perRarity } from "../pool/tiers.js";
import { LAST_SLOT, planPack } from "./roll.js";

/**
 * The exact model of what packs deal on average (collection-packs.md
 * §5.4.6, economy.md §9): the figures the specs publish are recomputed from
 * the parameters by tests, so a parameter change that moves them fails
 * until the specs follow. Nothing here rolls a pack.
 */

/** A standard pack's five tables, an Enchanted pack's and a Radiant pack's (its last slot a certain Mythic), in slot order. */
export const PACK_TABLES = {
  standard: SLOT_ODDS,
  enchanted: SLOT_ODDS.map((table, slot) => (slot === LAST_SLOT ? ENCHANTED_SLOT_ODDS : table)),
  radiant: SLOT_ODDS.map((_, slot) =>
    slot === LAST_SLOT ? perRarity((tier) => (tier === "mythic" ? ODDS_SCALE : 0)) : RADIANT_SLOT_ODDS,
  ),
} satisfies Record<string, readonly OddsTable[]>;

/** Expected cards of each tier in a pack whose slots roll `tables`. */
export function expectedCards(tables: readonly OddsTable[]): Record<Rarity, number> {
  return perRarity((tier) => tables.reduce((sum, table) => sum + table[tier] / ODDS_SCALE, 0));
}

export interface LongRun {
  mythicPackShare: number;
  mythicCardsPerPack: number;
  pityShareOfMythicPacks: number;
  pityShareOfPacks: number;
  enchantedShare: number;
  /** Expected cards of each tier per free pack. */
  cardsPerPack: Record<Rarity, number>;
  /** Each tier's share of all free-pack cards. */
  cardShare: Record<Rarity, number>;
}

/**
 * The long run of one account's free packs (§5.4.6), exactly: a run of
 * packs starts after a Mythic with `free_packs_opened mod 10` at some phase
 * and ends at the next Mythic (by pity at the latest), so the phases at the
 * starts of runs form a 10-state chain. Its stationary weights, times each
 * run's survival curve, give the long-run share of every state of the two
 * counters, and so every per-pack average.
 */
export function longRun(): LongRun {
  type PackFigures = {
    cards: Record<Rarity, number>;
    mythicPack: number;
    pityPack: number;
    enchanted: number;
  };
  const radiantChance = RADIANT_ODDS / ODDS_SCALE;
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
    const normal = expectedCards(tables);
    const radiant = expectedCards(PACK_TABLES.radiant);
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
    cardsPerPack: perRarity((tier) => cards[tier] / packs),
    cardShare: perRarity((tier) => cards[tier] / packs / PACK_SIZE),
  };
}
