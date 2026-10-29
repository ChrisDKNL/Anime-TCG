import type { PerRarity, PublishedOdds, SnapshotInfo } from "@anime-tcg/shared/api";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { ODDS_SCALE, SLOT_ODDS } from "@anime-tcg/shared/rarity";
import { perRarity } from "../pool/tiers.js";

const PARTS_PER_MILLION = 1_000_000n;

/**
 * The chance that a pack holds at least one card of a tier whose slot odds
 * are `slotOdds` out of `ODDS_SCALE`, in parts per million:
 * `1 - (1 - n / S)^5`, computed exactly in BigInt and rounded half up.
 */
export function atLeastOnePerPack(slotOdds: number): number {
  const scale = BigInt(ODDS_SCALE);
  const size = BigInt(PACK_SIZE);
  const denominator = scale ** size;
  const numerator = (denominator - (scale - BigInt(slotOdds)) ** size) * PARTS_PER_MILLION;
  return Number((2n * numerator + denominator) / (2n * denominator));
}

/** What `GET /api/packs` publishes: the integers the roll applies, and what they mean per pack and per character. */
export function publishedOdds(tierSizes: PerRarity, snapshot: SnapshotInfo): PublishedOdds {
  return {
    scale: ODDS_SCALE,
    perSlot: perRarity((tier) => SLOT_ODDS[tier]),
    perPack: perRarity((tier) => atLeastOnePerPack(SLOT_ODDS[tier])),
    tierSizes,
    snapshot,
  };
}
