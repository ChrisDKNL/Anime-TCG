import type {
  CharacterPublic,
  CollectionEntry,
  CollectionResponse,
  FranchiseRef,
  KarmaRules,
  OpenedCard,
  PackAllowance,
  PackKind,
  PackOpened,
  PacksResponse,
  PerRarity,
  PublishedOdds,
  Rarity,
  RecycleReceipt,
  ShopReceipt,
  ShopResponse,
  ThemeOffer,
  Wallet,
} from "@anime-tcg/shared/api";

/**
 * Server answers for tests, in the shapes of `shared/src/api.ts`. The odds and
 * the Karma rules are written out as numbers (the web code may not import the
 * server's tables, ESLint `no-restricted-imports`): the published figures of
 * collection-packs.md §5.4 for the first real snapshot's 2 983 characters, and
 * economy.md §5's parameters.
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

/** Nothing listed or escrowed unless told otherwise, so `available` is `count` and every copy but the last is recyclable. */
export function makeEntry(
  character: CharacterPublic,
  overrides: Partial<CollectionEntry> = {},
): CollectionEntry {
  const count = overrides.count ?? 1;
  return {
    kind: "card",
    character,
    rarity: character.tier ?? "common",
    variant: "standard",
    count,
    listed: 0,
    available: count,
    recyclable: count - 1,
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

/** economy.md §5's parameters as `GET /api/wallet` publishes them. */
export function makeRules(overrides: Partial<KarmaRules> = {}): KarmaRules {
  return {
    referenceValues: perRarity([10, 23, 35, 160, 1_000, 11_000]),
    recycleValues: perRarity([2, 5, 8, 40, 250, 2_750]),
    priceMin: perRarity([5, 12, 18, 80, 500, 5_500]),
    priceMax: perRarity([25, 57, 87, 400, 2_500, 27_500]),
    feeBps: 500,
    feeMin: 1,
    listingTtlSeconds: 604_800,
    maxListings: 50,
    maxRecycleCount: 100,
    themedPackPrice: 400,
    window: { seconds: 604_800, purchases: 100, spend: 55_000, proceeds: 55_000, pair: 27_500 },
    ...overrides,
  };
}

export function makeWallet(balance = 1_240, rules: Partial<KarmaRules> = {}): Wallet {
  return { balance, activeListings: 0, rules: makeRules(rules) };
}

/** A genre theme drawing from the three fixture series, at the free pack's odds and the shop's price. */
export function makeTheme(id = "genre-action", overrides: Partial<ThemeOffer> = {}): ThemeOffer {
  const odds = makeOdds();
  return {
    id,
    title: "Action",
    cards: 5,
    franchiseIds: FRANCHISES.map((franchise) => franchise.id),
    price: 400,
    odds: {
      scale: odds.scale,
      perSlot: odds.slots,
      perPack: odds.perPack,
      tierSizes: perRarity([420, 300, 240, 140, 70, 25]),
      radiant: odds.radiant,
    },
    ...overrides,
  };
}

export function makeShop(
  themes: ThemeOffer[] = [makeTheme()],
  overrides: Partial<ShopResponse> = {},
): ShopResponse {
  return {
    themes,
    franchises: FRANCHISES,
    snapshot: { version: 2, takenAt: "2026-10-29T08:00:00.000Z", characterCount: 2_983 },
    ...overrides,
  };
}

export function makeShopReceipt(overrides: Partial<ShopReceipt> = {}): ShopReceipt {
  return { pack: makePackOpened(), themeId: "genre-action", price: 400, balance: 840, ...overrides };
}

export function makeRecycleReceipt(overrides: Partial<RecycleReceipt> = {}): RecycleReceipt {
  return {
    recycleId: "0b8a6c1e-2f3d-4e5f-8a9b-0c1d2e3f4a5b",
    recycledAt: "2026-10-30T09:00:00.000Z",
    recycled: { characterId: 1, rarity: "epic", count: 2 },
    credited: 80,
    balance: 1_320,
    ...overrides,
  };
}
