import type {
  CharacterPublic,
  CollectionEntry,
  CollectionResponse,
  FranchiseRef,
  OpenedCard,
  PackAllowance,
  PackKind,
  PackOpened,
  PacksResponse,
  PerRarity,
  PublishedOdds,
  Rarity,
} from "@anime-tcg/shared/api";

/**
 * Server answers for tests, in the shapes of `shared/src/api.ts`. The odds are
 * written out as numbers (the web code may not import the server's tables,
 * ESLint `no-restricted-imports`) and are the published figures of
 * collection-packs.md §5.4 for the first real snapshot's 2 983 characters.
 */

const perRarity = (values: readonly [number, number, number, number, number, number]): PerRarity => ({
  common: values[0],
  uncommon: values[1],
  rare: values[2],
  epic: values[3],
  legendary: values[4],
  mythic: values[5],
});

const UPPER_TIERS = perRarity([0, 0, 0, 850_000, 137_500, 12_500]);

export function makeOdds(overrides: Partial<PublishedOdds> = {}): PublishedOdds {
  return {
    scale: 1_000_000,
    slots: [
      { floor: "common", odds: perRarity([933_334, 66_666, 0, 0, 0, 0]) },
      { floor: "common", odds: perRarity([933_333, 66_667, 0, 0, 0, 0]) },
      { floor: "common", odds: perRarity([933_333, 66_667, 0, 0, 0, 0]) },
      { floor: "uncommon", odds: perRarity([0, 1_000_000, 0, 0, 0, 0]) },
      { floor: "rare", odds: perRarity([0, 0, 800_000, 170_000, 27_500, 2_500]) },
    ],
    share: perRarity([560_000, 240_000, 160_000, 34_000, 5_500, 500]),
    perPack: perRarity([999_704, 1_000_000, 800_000, 170_000, 27_500, 2_500]),
    enchanted: { every: 10, slot: 4, floor: "epic", odds: UPPER_TIERS },
    radiant: { chance: 400, odds: UPPER_TIERS, lastSlot: "mythic" },
    pity: { packs: 300, freePacksOnly: true },
    bandScale: 10_000,
    tierBands: perRarity([3_500, 2_500, 2_000, 1_200, 600, 200]),
    tierSizes: perRarity([1_044, 746, 596, 358, 179, 60]),
    snapshot: { version: 2, takenAt: "2026-10-29T08:00:00.000Z", characterCount: 2_983 },
    ...overrides,
  };
}

export function makeAllowance(overrides: Partial<PackAllowance> = {}): PackAllowance {
  return { available: 3, cap: 3, intervalSeconds: 600, nextPackInSeconds: null, ...overrides };
}

export function makePacks(overrides: Partial<PacksResponse> = {}): PacksResponse {
  return { allowance: makeAllowance(), odds: makeOdds(), packsUntilGuarantee: 300, ...overrides };
}

/** The answer while there is no snapshot: cards unavailable. */
export function makeUnavailablePacks(allowance: Partial<PackAllowance> = {}): PacksResponse {
  return { allowance: makeAllowance(allowance), odds: null, packsUntilGuarantee: null };
}

export function makeFranchise(id: number, overrides: Partial<FranchiseRef> = {}): FranchiseRef {
  return { id, title: `Series ${id}`, titleNative: null, startYear: 2020, ...overrides };
}

export function makeCharacter(id: number, overrides: Partial<CharacterPublic> = {}): CharacterPublic {
  return {
    id,
    name: `Character ${id}`,
    nameNative: null,
    imageUrl: `https://s4.anilist.co/file/anilistcdn/character/large/b${id}.png`,
    franchiseIds: [100 + (id % 3)],
    tier: "common",
    rank: id,
    inCurrentSnapshot: true,
    ...overrides,
  };
}

export const FRANCHISES: FranchiseRef[] = [makeFranchise(100), makeFranchise(101), makeFranchise(102)];

/** A standard pack's usual shape: four Commons and Uncommons, then the fifth card's Rare. */
const STANDARD_RARITIES: readonly Rarity[] = ["common", "common", "common", "uncommon", "rare"];

export function makeOpenedCard(slot: number, overrides: Partial<OpenedCard> = {}): OpenedCard {
  const rarity = overrides.rarity ?? STANDARD_RARITIES[slot] ?? "common";
  return {
    kind: "card",
    slot,
    character: makeCharacter(1000 + slot, { tier: rarity }),
    rarity,
    variant: "standard",
    isNew: true,
    ...overrides,
  };
}

interface PackOptions {
  packKind?: PackKind;
  pityMythic?: boolean;
  cards?: OpenedCard[];
  allowance?: Partial<PackAllowance>;
  packsUntilGuarantee?: number | null;
  openingId?: string;
}

/** A `PackOpened` after the first opening of a full account, unless told otherwise. */
export function makePackOpened(options: PackOptions = {}): PackOpened {
  return {
    openingId: options.openingId ?? "6f9c1a52-4c1e-4b8e-9d3a-0a6d1e2f3b40",
    openedAt: "2026-10-29T09:00:00.000Z",
    packKind: options.packKind ?? "standard",
    pityMythic: options.pityMythic ?? false,
    cards: options.cards ?? [0, 1, 2, 3, 4].map((slot) => makeOpenedCard(slot)),
    franchises: FRANCHISES,
    allowance: makeAllowance({ available: 2, nextPackInSeconds: 600, ...options.allowance }),
    packsUntilGuarantee: options.packsUntilGuarantee === undefined ? 299 : options.packsUntilGuarantee,
  };
}

export function makeEntry(
  character: CharacterPublic,
  overrides: Partial<CollectionEntry> = {},
): CollectionEntry {
  return {
    kind: "card",
    character,
    rarity: character.tier ?? "common",
    variant: "standard",
    count: 1,
    firstObtainedAt: "2026-10-29T09:00:00.000Z",
    lastObtainedAt: "2026-10-29T09:00:00.000Z",
    ...overrides,
  };
}

/** A collection answer over `entries`, with totals summed from them as the server sums them. */
export function makeCollection(entries: CollectionEntry[] = []): CollectionResponse {
  const byRarity = perRarity([0, 0, 0, 0, 0, 0]);
  let cards = 0;
  for (const entry of entries) {
    byRarity[entry.rarity] += entry.count;
    cards += entry.count;
  }
  const duplicates = entries.reduce((sum, entry) => sum + entry.count - 1, 0);
  return {
    snapshot: { version: 2, takenAt: "2026-10-29T08:00:00.000Z", characterCount: 2_983 },
    totals: { cards, duplicates, byRarity },
    completion: { pool: { owned: entries.length, total: 2_983 }, franchises: [] },
    franchises: FRANCHISES,
    entries,
  };
}
