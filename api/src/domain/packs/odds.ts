import type { PerRarity, PublishedOdds, SnapshotInfo } from "@anime-tcg/shared/api";
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
import { perRarity } from "../pool/tiers.js";
import { LAST_SLOT } from "./roll.js";

const PARTS_PER_MILLION = 1_000_000n;

/** `numerator / denominator` in parts per million, rounded half up, exactly. */
function toPartsPerMillion(numerator: bigint, denominator: bigint): number {
  return Number((2n * numerator * PARTS_PER_MILLION + denominator) / (2n * denominator));
}

/** The lowest tier a table can roll: what the odds page names as its floor. */
export function floorOf(table: OddsTable): Rarity {
  const floor = RARITIES.find((tier) => table[tier] > 0);
  if (floor === undefined) throw new RangeError("a table that rolls nothing has no floor");
  return floor;
}

/** A slot forced to `tier` without a roll, as a table: the whole scale on that tier. */
export function certain(tier: Rarity): OddsTable {
  return perRarity((candidate) => (candidate === tier ? ODDS_SCALE : 0));
}

/**
 * The chance that a pack whose slots roll `tables` holds at least one card
 * of `tier`, in parts per million: `1 − Π (1 − odds / scale)`, computed
 * exactly in BigInt and rounded half up (spec §5.4.2).
 */
export function atLeastOnePerPack(tables: readonly OddsTable[], tier: Rarity): number {
  const scale = BigInt(ODDS_SCALE);
  const all = scale ** BigInt(tables.length);
  const none = tables.reduce((product, table) => product * (scale - BigInt(table[tier])), 1n);
  return toPartsPerMillion(all - none, all);
}

/** The share of a pack's cards that is `tier`, in parts per million: the slot tables' sum over the pack size. */
export function shareOfCards(tables: readonly OddsTable[], tier: Rarity): number {
  const sum = tables.reduce((total, table) => total + BigInt(table[tier]), 0n);
  return toPartsPerMillion(sum, BigInt(ODDS_SCALE) * BigInt(tables.length));
}

/** A standard pack's five tables, an Enchanted pack's and a Radiant pack's, in slot order. */
export const PACK_TABLES = {
  standard: SLOT_ODDS,
  enchanted: SLOT_ODDS.map((table, slot) => (slot === LAST_SLOT ? ENCHANTED_SLOT_ODDS : table)),
  radiant: SLOT_ODDS.map((_, slot) => (slot === LAST_SLOT ? certain("mythic") : RADIANT_SLOT_ODDS)),
} as const satisfies Record<string, readonly OddsTable[]>;

/**
 * What `GET /api/packs` publishes (spec §5.4.8, §6.2): the integers the roll
 * applies, the special rules, the tier bands, and what the tables mean for a
 * standard pack's cards, for the current snapshot's tier sizes.
 */
export function publishedOdds(tierSizes: PerRarity, snapshot: SnapshotInfo): PublishedOdds {
  return {
    scale: ODDS_SCALE,
    slots: SLOT_ODDS.map((table, slot) => {
      const floor = SLOT_FLOOR[slot];
      if (floor === undefined || SLOT_ODDS.length !== PACK_SIZE) {
        throw new RangeError("there must be one slot floor and one slot table per card");
      }
      return { floor, odds: perRarity((tier) => table[tier]) };
    }),
    share: perRarity((tier) => shareOfCards(PACK_TABLES.standard, tier)),
    perPack: perRarity((tier) => atLeastOnePerPack(PACK_TABLES.standard, tier)),
    enchanted: {
      every: ENCHANTED_INTERVAL,
      slot: LAST_SLOT,
      floor: floorOf(ENCHANTED_SLOT_ODDS),
      odds: perRarity((tier) => ENCHANTED_SLOT_ODDS[tier]),
    },
    radiant: {
      chance: RADIANT_ODDS,
      odds: perRarity((tier) => RADIANT_SLOT_ODDS[tier]),
      lastSlot: "mythic",
    },
    pity: { packs: PITY_PACKS, freePacksOnly: true },
    bandScale: SHARE_SCALE,
    tierBands: perRarity((tier) => TIER_BAND[tier]),
    tierSizes,
    snapshot,
  };
}
