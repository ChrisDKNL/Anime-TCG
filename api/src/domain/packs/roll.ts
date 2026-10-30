import type { PackKind } from "@anime-tcg/shared/api";
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
import type { Rng } from "./rng.js";

/**
 * The pack roll of collection-packs.md §5.4.4, pure: a plan from the
 * account's counters and one generator call, then each slot's tier from its
 * table (or forced) and a character of that tier. The order of generator
 * calls is fixed, so a scripted `Rng` gives a known pack.
 */

/** Rarest first, so each threshold is the running sum of the tiers above it. */
const ROLL_ORDER: readonly Rarity[] = [...RARITIES].reverse();

/** The slot the special rules act on: the fifth card, `slot: 4`. */
export const LAST_SLOT = PACK_SIZE - 1;

/** The tier a roll `r` in `[0, ODDS_SCALE)` lands on in `table`; for standard slot 5, Mythic below 2 500, Legendary below 30 000, and so on. */
export function tierForRoll(table: OddsTable, r: number): Rarity {
  if (!Number.isInteger(r) || r < 0 || r >= ODDS_SCALE)
    throw new RangeError(`roll ${r} is outside the scale`);
  let threshold = 0;
  for (const tier of ROLL_ORDER) {
    threshold += table[tier];
    if (r < threshold) return tier;
  }
  throw new RangeError(`roll ${r} fell past every tier of a table that does not sum to the scale`);
}

/** Where a pack comes from: the allowance (`free`) or, later, the shop. Only free packs count towards pity and Enchanted (§5.4.7). */
export type PackSource = "free" | "shop";

/**
 * What a plan can be made for: a pack dealt to an account, or the landing
 * page's demo (navigation-and-landing.md §3.8 item 3), which has no account and
 * so no counters: never Enchanted or pity-due, Radiant like every pack.
 */
export type PlanSource = PackSource | "demo";

/** The two counters on the account row (§5.4.5). */
export interface PackCounters {
  /** Free packs opened since the last Mythic card; 0 to `PITY_PACKS - 1`. */
  packsSinceMythic: number;
  /** Free packs opened since registration or the last reset. */
  freePacksOpened: number;
}

/** A slot either rolls a table or is forced to a tier without a roll. */
export type SlotRule = { readonly roll: OddsTable } | { readonly forced: Rarity };

export interface PackPlan {
  kind: PackKind;
  /** The last slot's Mythic is forced by pity; never true for a Radiant pack, which holds a Mythic already. */
  pity: boolean;
  slots: readonly SlotRule[];
}

const FORCED_MYTHIC: SlotRule = { forced: "mythic" };

/**
 * Step 1 of §5.4.4. The Radiant roll is made for every pack, whatever else
 * is due, so the generator's stream does not depend on the counters. Then
 * the precedence of §5.4.3: Radiant, then pity, then Enchanted; a rule lower
 * down is not lost but already met.
 */
export function planPack(counters: PackCounters, source: PlanSource, rng: Rng): PackPlan {
  const radiant = rng(0, ODDS_SCALE) < RADIANT_ODDS;
  const free = source === "free";
  const enchanted = free && (counters.freePacksOpened + 1) % ENCHANTED_INTERVAL === 0;
  // `>=`: the database holds the counter in 0..PITY_PACKS - 1, and a counter past that bound is still owed its Mythic.
  const pityDue = free && counters.packsSinceMythic >= PITY_PACKS - 1;
  if (radiant) {
    return {
      kind: "radiant",
      pity: false,
      slots: SLOT_ODDS.map((_, slot) => (slot === LAST_SLOT ? FORCED_MYTHIC : { roll: RADIANT_SLOT_ODDS })),
    };
  }
  const lastRule: SlotRule | null = pityDue
    ? FORCED_MYTHIC
    : enchanted
      ? { roll: ENCHANTED_SLOT_ODDS }
      : null;
  return {
    kind: enchanted ? "enchanted" : "standard",
    pity: pityDue,
    slots: SLOT_ODDS.map((table, slot) =>
      slot === LAST_SLOT && lastRule !== null ? lastRule : { roll: table },
    ),
  };
}

/**
 * The counters after a pack whose cards have `tiers` (§5.4.5): a free pack
 * adds one to both, and any Mythic card, from any source, sets
 * `packsSinceMythic` to 0. A shop pack moves neither otherwise.
 */
export function countersAfter(
  counters: PackCounters,
  source: PackSource,
  tiers: readonly Rarity[],
): PackCounters {
  const step = source === "free" ? 1 : 0;
  return {
    freePacksOpened: counters.freePacksOpened + step,
    packsSinceMythic: tiers.includes("mythic") ? 0 : counters.packsSinceMythic + step,
  };
}

/** What the pack page shows: the free pack that many openings from now has a Mythic at the latest (1 to `PITY_PACKS`). */
export function packsUntilGuarantee(counters: Pick<PackCounters, "packsSinceMythic">): number {
  return PITY_PACKS - counters.packsSinceMythic;
}

/** The characters packs may deal, per tier, each list ordered by character id. */
export type TierPool = Readonly<Record<Rarity, readonly number[]>>;

export interface DealtSlot {
  slot: number;
  characterId: number;
  tier: Rarity;
}

/**
 * A partial Fisher–Yates shuffle over one tier's list that never copies it:
 * only the positions a draw swapped are remembered, so a pack costs
 * `PACK_SIZE` steps whatever the tier's size.
 */
class TierDeck {
  private readonly swapped = new Map<number, number>();
  private drawn = 0;

  constructor(private readonly ids: readonly number[]) {}

  draw(rng: Rng): number {
    if (this.drawn >= this.ids.length) throw new Error("a tier ran out of characters within one pack");
    const pick = rng(this.drawn, this.ids.length);
    const chosen = this.at(pick);
    this.swapped.set(pick, this.at(this.drawn));
    this.drawn += 1;
    return chosen;
  }

  private at(position: number): number {
    const id = this.swapped.get(position) ?? this.ids[position];
    if (id === undefined) throw new RangeError(`position ${position} is outside the tier`);
    return id;
  }
}

/**
 * Steps 2 and 3 of §5.4.4: slot by slot, the tier (rolled from the slot's
 * table, or forced without a roll), then a character of that tier drawn
 * uniformly among those this pack has not drawn yet, so no pack repeats a
 * character. `tierRng` is the seam the statistical test uses to force tiers
 * while the pick stays on the real generator; the game passes one `Rng`.
 */
export function drawPack(pool: TierPool, plan: PackPlan, rng: Rng, tierRng: Rng = rng): DealtSlot[] {
  if (plan.slots.length !== PACK_SIZE) throw new RangeError(`a plan of ${plan.slots.length} slots`);
  const decks = new Map<Rarity, TierDeck>();
  return plan.slots.map((rule, slot) => {
    const tier = "forced" in rule ? rule.forced : tierForRoll(rule.roll, tierRng(0, ODDS_SCALE));
    let deck = decks.get(tier);
    if (deck === undefined) {
      deck = new TierDeck(pool[tier]);
      decks.set(tier, deck);
    }
    return { slot, characterId: deck.draw(rng), tier };
  });
}
