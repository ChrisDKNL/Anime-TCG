import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { ODDS_SCALE, type Rarity, SLOT_ODDS } from "@anime-tcg/shared/rarity";
import type { Rng } from "./rng.js";

/** Rarest first, so each threshold is the running sum of the tiers above it (collection-packs.md §5.4). */
const ROLL_ORDER: readonly Rarity[] = ["mythic", "legendary", "epic", "rare", "common"];

/** The tier a slot roll `r` in `[0, ODDS_SCALE)` lands on: Mythic below 661, Legendary below 4 693, and so on. */
export function tierForRoll(r: number): Rarity {
  if (!Number.isInteger(r) || r < 0 || r >= ODDS_SCALE)
    throw new RangeError(`roll ${r} is outside the scale`);
  let threshold = 0;
  for (const tier of ROLL_ORDER) {
    threshold += SLOT_ODDS[tier];
    if (r < threshold) return tier;
  }
  // SLOT_ODDS sums to ODDS_SCALE, so the last threshold is the scale itself.
  throw new RangeError(`roll ${r} fell past every tier`);
}

export function rollTier(rng: Rng): Rarity {
  return tierForRoll(rng(0, ODDS_SCALE));
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
 * Rolls each slot's tier, then draws a character of that tier uniformly
 * among those this pack has not drawn yet, so no pack repeats a character.
 * `tierRng` is a seam for the statistical test, which forces the tier and
 * leaves the pick on the real generator; the game passes one `Rng` for both.
 */
export function drawPack(pool: TierPool, rng: Rng, tierRng: Rng = rng): DealtSlot[] {
  const decks = new Map<Rarity, TierDeck>();
  return Array.from({ length: PACK_SIZE }, (_, slot) => {
    const tier = rollTier(tierRng);
    let deck = decks.get(tier);
    if (deck === undefined) {
      deck = new TierDeck(pool[tier]);
      decks.set(tier, deck);
    }
    return { slot, characterId: deck.draw(rng), tier };
  });
}
