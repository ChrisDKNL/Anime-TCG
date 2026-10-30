import { type Static, Type } from "@sinclair/typebox";
import { MARKET_PAGE_SIZE, MAX_ENTRY_AMOUNT, MAX_RECYCLE_COUNT, PACK_CAP, PACK_SIZE } from "./economy.js";
import { PITY_PACKS } from "./rarity.js";

/**
 * Length limits as character counts (TypeBox `minLength`/`maxLength` count
 * code points, not bytes). The api trims `login` and `inviteCode` and re-checks
 * the login after the trim; passwords are never trimmed.
 */
export const LOGIN_LENGTH = { min: 3, max: 24 } as const;
export const PASSWORD_LENGTH = { min: 8, max: 128 } as const;
/** `min` binds the configured codes (`INVITE_CODES`); a submitted code may be any length up to `max`. */
export const INVITE_CODE_LENGTH = { min: 8, max: 64 } as const;

/** The length the limits above are measured in: code points, as Ajv counts them for `minLength`/`maxLength`. */
export function characterCount(text: string): number {
  return [...text].length;
}

/** What the api says about an account; `cards` is how many cards its collection holds, duplicates included. */
export const AccountPublic = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    login: Type.String(),
    createdAt: Type.String({ format: "date-time" }),
    cards: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type AccountPublic = Static<typeof AccountPublic>;

export const SignedOut = Type.Object({ signedIn: Type.Literal(false) }, { additionalProperties: false });
export const SignedIn = Type.Object(
  { signedIn: Type.Literal(true), account: AccountPublic },
  { additionalProperties: false },
);
export type SignedIn = Static<typeof SignedIn>;

/** `GET /api/session`, and the body of a successful register or login. */
export const SessionResponse = Type.Union([SignedOut, SignedIn]);
export type SessionResponse = Static<typeof SessionResponse>;

/** `PATCH /api/account/login`. */
export const AccountResponse = Type.Object({ account: AccountPublic }, { additionalProperties: false });
export type AccountResponse = Static<typeof AccountResponse>;

const InviteCode = Type.String({ minLength: 1, maxLength: INVITE_CODE_LENGTH.max });
const Login = Type.String({ minLength: LOGIN_LENGTH.min, maxLength: LOGIN_LENGTH.max });
/** A password being set: the full policy. */
const NewPassword = Type.String({ minLength: PASSWORD_LENGTH.min, maxLength: PASSWORD_LENGTH.max });
/** A password being checked: anything up to the maximum, so a wrong one is a 401/403, never a 400 that reveals the policy. */
const GivenPassword = Type.String({ minLength: 1, maxLength: PASSWORD_LENGTH.max });

export const InviteBody = Type.Object({ inviteCode: InviteCode }, { additionalProperties: false });
export type InviteBody = Static<typeof InviteBody>;

export const RegisterBody = Type.Object(
  { inviteCode: InviteCode, login: Login, password: NewPassword },
  { additionalProperties: false },
);
export type RegisterBody = Static<typeof RegisterBody>;

export const LoginBody = Type.Object(
  { login: Type.String({ minLength: 1, maxLength: LOGIN_LENGTH.max }), password: GivenPassword },
  { additionalProperties: false },
);
export type LoginBody = Static<typeof LoginBody>;

export const RenameBody = Type.Object({ login: Login }, { additionalProperties: false });
export type RenameBody = Static<typeof RenameBody>;

export const ChangePasswordBody = Type.Object(
  { currentPassword: GivenPassword, newPassword: NewPassword },
  { additionalProperties: false },
);
export type ChangePasswordBody = Static<typeof ChangePasswordBody>;

export const DeleteBody = Type.Object({ password: GivenPassword }, { additionalProperties: false });
export type DeleteBody = Static<typeof DeleteBody>;

const UpOrDown = Type.Union([Type.Literal("ok"), Type.Literal("down")]);

/** `GET /healthz`: 200 when the database answers `SELECT 1`, 503 otherwise. */
export const HealthResponse = Type.Object(
  { status: UpOrDown, db: UpOrDown },
  { additionalProperties: false },
);
export type HealthResponse = Static<typeof HealthResponse>;

const Count = Type.Integer({ minimum: 0 });
const DateTime = Type.String({ format: "date-time" });
const AniListId = Type.Integer({ minimum: 1 });

/**
 * A card's or a tier's rarity, `RARITIES` in rank order. Spelled out as a
 * tuple so route handlers see the literal union (a mapped array widens to
 * `never` there); `shared/test/contract.test.ts` holds it to `RARITIES`.
 */
export const Rarity = Type.Union([
  Type.Literal("common"),
  Type.Literal("uncommon"),
  Type.Literal("rare"),
  Type.Literal("epic"),
  Type.Literal("legendary"),
  Type.Literal("mythic"),
]);
export type Rarity = Static<typeof Rarity>;

/** Reserved (collection-packs.md §2): `"masterwork"` joins as a second member later; every card is standard today. */
export const CardVariant = Type.Union([Type.Literal("standard")]);
export type CardVariant = Static<typeof CardVariant>;

/** Which rules a pack was dealt under (collection-packs.md §5.4.3). */
export const PackKind = Type.Union([
  Type.Literal("standard"),
  Type.Literal("enchanted"),
  Type.Literal("radiant"),
]);
export type PackKind = Static<typeof PackKind>;

/** One integer per tier. */
export const PerRarity = Type.Object(
  { common: Count, uncommon: Count, rare: Count, epic: Count, legendary: Count, mythic: Count },
  { additionalProperties: false },
);
export type PerRarity = Static<typeof PerRarity>;

/**
 * The pool snapshot an answer was computed against: its version, when
 * AniList was read, and its character count, the pool size a card's rank
 * is shown against (`#0012 / 2983`).
 */
export const SnapshotInfo = Type.Object(
  { version: Type.Integer({ minimum: 1 }), takenAt: DateTime, characterCount: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type SnapshotInfo = Static<typeof SnapshotInfo>;

/** One slot's table out of `scale`: zero below `floor`, summing to the scale. */
export const SlotOdds = Type.Object({ floor: Rarity, odds: PerRarity }, { additionalProperties: false });
export type SlotOdds = Static<typeof SlotOdds>;

/**
 * The rules and tables the server applies, published as it applies them
 * (collection-packs.md §5.4.8): every chance is an integer out of `scale`.
 * `slots` are a standard pack's tables in slot order; `share` is the share
 * of a standard pack's cards per tier and `perPack` the chance of at least
 * one per standard pack, both in parts per million; `enchanted` replaces
 * slot `slot`'s table every `every`th free pack; a Radiant pack (`chance`
 * of any pack) rolls `odds` in every slot but the last, which is
 * `lastSlot`; `pity` guarantees a Mythic in the last slot of the
 * `packs`th pack in a row without one. `tierBands` out of `bandScale` is
 * the pool share of each tier by favourites rank, `tierSizes` the current
 * snapshot's characters per tier.
 */
export const PublishedOdds = Type.Object(
  {
    scale: Type.Integer({ minimum: 1 }),
    slots: Type.Array(SlotOdds, { minItems: PACK_SIZE, maxItems: PACK_SIZE }),
    share: PerRarity,
    perPack: PerRarity,
    enchanted: Type.Object(
      {
        every: Type.Integer({ minimum: 1 }),
        slot: Type.Integer({ minimum: 0, maximum: PACK_SIZE - 1 }),
        floor: Rarity,
        odds: PerRarity,
      },
      { additionalProperties: false },
    ),
    radiant: Type.Object(
      { chance: Count, odds: PerRarity, lastSlot: Rarity },
      { additionalProperties: false },
    ),
    pity: Type.Object(
      { packs: Type.Integer({ minimum: 1 }), freePacksOnly: Type.Boolean() },
      { additionalProperties: false },
    ),
    bandScale: Type.Integer({ minimum: 1 }),
    tierBands: PerRarity,
    tierSizes: PerRarity,
    snapshot: SnapshotInfo,
  },
  { additionalProperties: false },
);
export type PublishedOdds = Static<typeof PublishedOdds>;

/**
 * Free packs until the guarantee: the free pack that many openings from now
 * holds a Mythic at the latest (1 means the next one does). Null only while
 * there is no current snapshot.
 */
const PacksUntilGuarantee = Type.Union([Type.Integer({ minimum: 1, maximum: PITY_PACKS }), Type.Null()]);

/** `nextPackInSeconds` is null when the allowance is full, else rounded up so a countdown that ends finds the pack there. */
export const PackAllowance = Type.Object(
  {
    available: Type.Integer({ minimum: 0, maximum: PACK_CAP }),
    cap: Type.Integer({ minimum: 1 }),
    intervalSeconds: Type.Integer({ minimum: 1 }),
    nextPackInSeconds: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type PackAllowance = Static<typeof PackAllowance>;

/** `GET /api/packs`; `odds` and `packsUntilGuarantee` are null while there is no snapshot (cards unavailable). */
export const PacksResponse = Type.Object(
  {
    allowance: PackAllowance,
    odds: Type.Union([PublishedOdds, Type.Null()]),
    packsUntilGuarantee: PacksUntilGuarantee,
  },
  { additionalProperties: false },
);
export type PacksResponse = Static<typeof PacksResponse>;

/** A franchise, named by its anchor entry: the smallest AniList id among its entries. */
export const FranchiseRef = Type.Object(
  {
    id: AniListId,
    title: Type.String(),
    titleNative: Type.Union([Type.String(), Type.Null()]),
    startYear: Type.Union([Type.Integer(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type FranchiseRef = Static<typeof FranchiseRef>;

/**
 * A character as the game shows it now: the newest name and image, its
 * franchises with the primary one first, and the tier packs deal it as and
 * its favourites rank in the current snapshot (both null, with
 * `inCurrentSnapshot: false`, once a snapshot dropped it). Strings are
 * AniList's and are rendered as text.
 */
export const CharacterPublic = Type.Object(
  {
    id: AniListId,
    name: Type.String(),
    nameNative: Type.Union([Type.String(), Type.Null()]),
    imageUrl: Type.String(),
    franchiseIds: Type.Array(AniListId, { minItems: 1 }),
    tier: Type.Union([Rarity, Type.Null()]),
    rank: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    inCurrentSnapshot: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type CharacterPublic = Static<typeof CharacterPublic>;

/** `POST /api/packs/open`: the client's idempotency key and nothing else; the server decides every outcome. */
export const OpenPackBody = Type.Object(
  { requestId: Type.String({ format: "uuid", maxLength: 36 }) },
  { additionalProperties: false },
);
export type OpenPackBody = Static<typeof OpenPackBody>;

/** `kind` is the discriminator a Relic will join; `rarity` is the card's as granted, which `character.tier` can differ from. */
export const OpenedCard = Type.Object(
  {
    kind: Type.Literal("card"),
    slot: Type.Integer({ minimum: 0, maximum: PACK_SIZE - 1 }),
    character: CharacterPublic,
    rarity: Rarity,
    variant: CardVariant,
    isNew: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type OpenedCard = Static<typeof OpenedCard>;

/**
 * 201 for a new opening, 200 with the same body for a replay of its
 * `requestId`. `packKind` and `pityMythic` (the last card's Mythic was
 * forced by pity) are as stored; `packsUntilGuarantee` is the count after
 * this opening, or the current one on a replay.
 */
export const PackOpened = Type.Object(
  {
    openingId: Type.String({ format: "uuid" }),
    openedAt: DateTime,
    packKind: PackKind,
    pityMythic: Type.Boolean(),
    cards: Type.Array(OpenedCard, { minItems: PACK_SIZE, maxItems: PACK_SIZE }),
    franchises: Type.Array(FranchiseRef),
    allowance: PackAllowance,
    packsUntilGuarantee: PacksUntilGuarantee,
  },
  { additionalProperties: false },
);
export type PackOpened = Static<typeof PackOpened>;

/**
 * The cards an account holds of one character at one rarity and variant;
 * cards are named this way, never by id. `count` is every held copy, listed
 * and escrowed ones included (economy.md §7); `available` is `count − listed
 * − escrowed`, and `recyclable` is `min(count − 1, available)`, so the last
 * copy and a listed or escrowed one are never offered for recycling.
 */
export const CollectionEntry = Type.Object(
  {
    kind: Type.Literal("card"),
    character: CharacterPublic,
    rarity: Rarity,
    variant: CardVariant,
    count: Type.Integer({ minimum: 1 }),
    listed: Count,
    available: Count,
    recyclable: Count,
    firstObtainedAt: DateTime,
    lastObtainedAt: DateTime,
  },
  { additionalProperties: false },
);
export type CollectionEntry = Static<typeof CollectionEntry>;

/** Distinct characters owned over the total; counts `kind: "card"` entries only. */
export const Completion = Type.Object({ owned: Count, total: Count }, { additionalProperties: false });
export type Completion = Static<typeof Completion>;

/** One franchise of the current snapshot; counts `kind: "card"` entries only, each character once. */
export const FranchiseCompletion = Type.Object(
  { franchiseId: AniListId, owned: Count, total: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type FranchiseCompletion = Static<typeof FranchiseCompletion>;

/** Counts `kind: "card"` entries only; `cards` is the number `AccountPublic.cards` reports. */
export const CollectionTotals = Type.Object(
  { cards: Count, duplicates: Count, byRarity: PerRarity },
  { additionalProperties: false },
);
export type CollectionTotals = Static<typeof CollectionTotals>;

/**
 * `GET /api/collection`. Completion is against the current snapshot and
 * empty without one; `franchises` holds the current snapshot's franchises
 * plus any an entry names, and a `franchiseId` without a completion row is
 * a franchise no longer in the current snapshot.
 */
export const CollectionResponse = Type.Object(
  {
    snapshot: Type.Union([SnapshotInfo, Type.Null()]),
    totals: CollectionTotals,
    completion: Type.Object(
      { pool: Completion, franchises: Type.Array(FranchiseCompletion) },
      { additionalProperties: false },
    ),
    franchises: Type.Array(FranchiseRef),
    entries: Type.Array(CollectionEntry),
  },
  { additionalProperties: false },
);
export type CollectionResponse = Static<typeof CollectionResponse>;

/** The timer pack's rules, without any account's position in them: what the landing page states. */
export const AllowanceRules = Type.Object(
  { intervalSeconds: Type.Integer({ minimum: 1 }), cap: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type AllowanceRules = Static<typeof AllowanceRules>;

/** The current snapshot's size: its characters and its anime entries. */
export const PoolFacts = Type.Object(
  { characters: Type.Integer({ minimum: 1 }), entries: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type PoolFacts = Static<typeof PoolFacts>;

/**
 * `GET /api/demo`, public (navigation-and-landing.md §3.8 item 1): the odds
 * every pack uses and the pool's size, both null with no snapshot, the
 * timer-pack rules, and how many demo packs one page load may open.
 */
export const DemoResponse = Type.Object(
  {
    odds: Type.Union([PublishedOdds, Type.Null()]),
    pool: Type.Union([PoolFacts, Type.Null()]),
    allowance: AllowanceRules,
    perVisit: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type DemoResponse = Static<typeof DemoResponse>;

/** A demo card: no `isNew` (there is no collection to compare with) and nothing that names an opening. */
export const DemoCard = Type.Object(
  {
    slot: Type.Integer({ minimum: 0, maximum: PACK_SIZE - 1 }),
    character: CharacterPublic,
    rarity: Rarity,
  },
  { additionalProperties: false },
);
export type DemoCard = Static<typeof DemoCard>;

/**
 * `POST /api/demo/open`, public, no body (§3.8 item 2): five cards in slot
 * order, rolled exactly as a pack is, and the franchises they name. Nothing is
 * stored, so there is no opening id, key or allowance to answer with.
 */
export const DemoOpened = Type.Object(
  {
    cards: Type.Array(DemoCard, { minItems: PACK_SIZE, maxItems: PACK_SIZE }),
    franchises: Type.Array(FranchiseRef),
  },
  { additionalProperties: false },
);
export type DemoOpened = Static<typeof DemoOpened>;

/** The largest id a request may name: a Postgres `integer`, so no id reaches the database out of range. */
const MAX_ID = 2_147_483_647;
const RequestId = Type.String({ format: "uuid", maxLength: 36 });

/**
 * The Karma rules the server applies (economy.md §5, §11.2), published so
 * the UI never holds a number of its own. `fee(price) = max(feeMin,
 * ceil(price × feeBps / 10 000))`: rounded up, at least `feeMin`.
 */
export const KarmaRules = Type.Object(
  {
    referenceValues: PerRarity,
    recycleValues: PerRarity,
    priceMin: PerRarity,
    priceMax: PerRarity,
    feeBps: Count,
    feeMin: Count,
    listingTtlSeconds: Type.Integer({ minimum: 1 }),
    maxListings: Type.Integer({ minimum: 1 }),
    maxRecycleCount: Type.Integer({ minimum: 1 }),
    themedPackPrice: Type.Integer({ minimum: 1 }),
    window: Type.Object(
      {
        seconds: Type.Integer({ minimum: 1 }),
        purchases: Type.Integer({ minimum: 1 }),
        spend: Type.Integer({ minimum: 1 }),
        proceeds: Type.Integer({ minimum: 1 }),
        pair: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type KarmaRules = Static<typeof KarmaRules>;

/** `GET /api/wallet`; `activeListings` is the caller's active, unexpired listings, 0 until the market exists. */
export const Wallet = Type.Object(
  { balance: Count, activeListings: Count, rules: KarmaRules },
  { additionalProperties: false },
);
export type Wallet = Static<typeof Wallet>;

/**
 * A themed pack on offer (economy.md §8.6): `id` is `genre-<slug>`, `title`
 * the genre as AniList names it (rendered as text), `franchiseIds` every
 * franchise with a character in the theme's set, in popularity order. The
 * odds are the free pack's tables and the Radiant rule; a shop pack is never
 * Enchanted or pity-due. `tierSizes` are the theme's characters per tier.
 */
export const ThemeOffer = Type.Object(
  {
    id: Type.String(),
    title: Type.String(),
    cards: Type.Integer({ minimum: 1 }),
    franchiseIds: Type.Array(AniListId),
    price: Type.Integer({ minimum: 1 }),
    odds: Type.Object(
      {
        scale: Type.Integer({ minimum: 1 }),
        perSlot: Type.Array(SlotOdds, { minItems: PACK_SIZE, maxItems: PACK_SIZE }),
        perPack: PerRarity,
        tierSizes: PerRarity,
        radiant: Type.Object(
          { chance: Count, odds: PerRarity, lastSlot: Rarity },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ThemeOffer = Static<typeof ThemeOffer>;

/** `GET /api/shop`: no themes and `snapshot: null` while there is no snapshot; `franchises` covers every theme's ids. */
export const ShopResponse = Type.Object(
  {
    themes: Type.Array(ThemeOffer),
    franchises: Type.Array(FranchiseRef),
    snapshot: Type.Union([SnapshotInfo, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ShopResponse = Static<typeof ShopResponse>;

/** `POST /api/shop/buy`: the idempotency key and the theme; the price is the server's. */
export const ShopBuyBody = Type.Object(
  { requestId: RequestId, themeId: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false },
);
export type ShopBuyBody = Static<typeof ShopBuyBody>;

/** 201 for a purchase, 200 with the same pack and price and the current balance on a replay. */
export const ShopReceipt = Type.Object(
  { pack: PackOpened, themeId: Type.String(), price: Type.Integer({ minimum: 1 }), balance: Count },
  { additionalProperties: false },
);
export type ShopReceipt = Static<typeof ShopReceipt>;

/** `POST /api/collection/recycle`: which entry and how many duplicates; never an amount, which is the server's. */
export const RecycleBody = Type.Object(
  {
    requestId: RequestId,
    characterId: Type.Integer({ minimum: 1, maximum: MAX_ID }),
    rarity: Rarity,
    count: Type.Integer({ minimum: 1, maximum: MAX_RECYCLE_COUNT }),
  },
  { additionalProperties: false },
);
export type RecycleBody = Static<typeof RecycleBody>;

/** 201 for a recycle, 200 with the same receipt and the current balance on a replay; nothing is produced, so no card. */
export const RecycleReceipt = Type.Object(
  {
    recycleId: Type.String({ format: "uuid" }),
    recycledAt: DateTime,
    recycled: Type.Object(
      { characterId: AniListId, rarity: Rarity, count: Type.Integer({ minimum: 1 }) },
      { additionalProperties: false },
    ),
    credited: Type.Integer({ minimum: 1 }),
    balance: Count,
  },
  { additionalProperties: false },
);
export type RecycleReceipt = Static<typeof RecycleReceipt>;

/**
 * `POST /api/market/listings` (economy.md §8.3): which entry, and the
 * seller's asking price, the one price a request ever carries; the server
 * bounds it per rarity and picks the card. The fee and the expiry are the
 * server's.
 */
export const ListBody = Type.Object(
  {
    requestId: RequestId,
    characterId: Type.Integer({ minimum: 1, maximum: MAX_ID }),
    rarity: Rarity,
    price: Type.Integer({ minimum: 1, maximum: MAX_ENTRY_AMOUNT }),
  },
  { additionalProperties: false },
);
export type ListBody = Static<typeof ListBody>;

export const ListingStatus = Type.Union([
  Type.Literal("active"),
  Type.Literal("sold"),
  Type.Literal("cancelled"),
  Type.Literal("expired"),
]);
export type ListingStatus = Static<typeof ListingStatus>;

const listingFields = {
  listingId: Type.String({ format: "uuid" }),
  kind: Type.Literal("card"),
  character: CharacterPublic,
  rarity: Rarity,
  variant: CardVariant,
  price: Type.Integer({ minimum: 1 }),
  /** `fee(price)`, fixed when the card was listed: the seller receives `price − fee` on a sale. */
  fee: Type.Integer({ minimum: 1 }),
  listedAt: DateTime,
  expiresAt: DateTime,
  /** When it sold, was cancelled or expired (its `expiresAt` for an expired one); null while active. */
  closedAt: Type.Union([DateTime, Type.Null()]),
  status: ListingStatus,
  /** The caller's own listing: the UI offers no buy for it, and the server refuses one (`own_listing`). */
  mine: Type.Boolean(),
};

/** One card on the market (economy.md §11.2); a listing past its `expiresAt` is `expired` whether or not the purge has run. */
export const Listing = Type.Object(listingFields, { additionalProperties: false });
export type Listing = Static<typeof Listing>;

/** A listing of `GET /api/market/mine`'s `closed`: `proceeds` is `price − fee` for a sale, null otherwise. */
export const ClosedListing = Type.Object(
  { ...listingFields, proceeds: Type.Union([Count, Type.Null()]) },
  { additionalProperties: false },
);
export type ClosedListing = Static<typeof ClosedListing>;

/** The `{listingId}` of the market's listing paths: a uuid, anything else is a 400. */
export const ListingParams = Type.Object(
  { listingId: Type.String({ format: "uuid", maxLength: 36 }) },
  { additionalProperties: false },
);
export type ListingParams = Static<typeof ListingParams>;

/**
 * An id in a query string: digits only, no sign, no leading zero, no
 * exponent and no whitespace, since query values arrive as text and the api
 * coerces nothing (manager decision, 2026-10-30). The api range-checks it.
 */
const QueryId = Type.String({ pattern: "^[1-9][0-9]{0,9}$" });

/**
 * A search text: 1 to 100 characters with no control character (`\p{Cc}`,
 * U+0000 to U+001F and U+007F to U+009F). A name or title never holds one,
 * and Postgres cannot take U+0000 as text at all (manager decision, 2026-10-30).
 */
const SearchText = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f]*$",
});

export const ListingSort = Type.Union([
  Type.Literal("price_asc"),
  Type.Literal("price_desc"),
  Type.Literal("newest"),
]);
export type ListingSort = Static<typeof ListingSort>;

/**
 * `GET /api/market/listings` (economy.md §8.4), every parameter optional:
 * `q` is matched term by term against the normalised names and franchise
 * titles, `cursor` is the previous page's `nextCursor` and only valid with
 * the same `sort`.
 */
export const ListingsQuery = Type.Object(
  {
    rarity: Type.Optional(Rarity),
    franchiseId: Type.Optional(QueryId),
    characterId: Type.Optional(QueryId),
    q: Type.Optional(SearchText),
    sort: Type.Optional(ListingSort),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9_-]+$" })),
  },
  { additionalProperties: false },
);
export type ListingsQuery = Static<typeof ListingsQuery>;

/**
 * A page of active, unexpired listings of every account. `filterFranchiseIds`
 * is on the first page only (null on later ones): every franchise with an
 * active listing, whatever the other parameters, in popularity order.
 * `franchises` covers the listings and `filterFranchiseIds`.
 */
export const ListingsPage = Type.Object(
  {
    listings: Type.Array(Listing, { maxItems: MARKET_PAGE_SIZE }),
    filterFranchiseIds: Type.Union([Type.Array(AniListId), Type.Null()]),
    franchises: Type.Array(FranchiseRef),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ListingsPage = Static<typeof ListingsPage>;

/** `POST /api/market/listings/{listingId}/buy`: the idempotency key and nothing else; the price is the listing's. */
export const BuyBody = Type.Object({ requestId: RequestId }, { additionalProperties: false });
export type BuyBody = Static<typeof BuyBody>;

/** `POST /api/market/listings/{listingId}/cancel` carries nothing. */
export const CancelBody = Type.Object({}, { additionalProperties: false });
export type CancelBody = Static<typeof CancelBody>;

/** The card a purchase delivered: a new card of the buyer's, of the listed card's character, rarity and variant. */
export const ReceivedCard = Type.Object(
  {
    kind: Type.Literal("card"),
    character: CharacterPublic,
    rarity: Rarity,
    variant: CardVariant,
    isNew: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ReceivedCard = Static<typeof ReceivedCard>;

/**
 * 201 for a purchase, 200 with the same receipt and the current balance on
 * a replay. `listingId` is null once the seller's account is deleted, which
 * deletes its listings (manager decision, 2026-10-30).
 */
export const PurchaseReceipt = Type.Object(
  {
    purchaseId: Type.String({ format: "uuid" }),
    boughtAt: DateTime,
    listingId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    price: Type.Integer({ minimum: 1 }),
    card: ReceivedCard,
    franchises: Type.Array(FranchiseRef),
    balance: Count,
  },
  { additionalProperties: false },
);
export type PurchaseReceipt = Static<typeof PurchaseReceipt>;

/** What the caller's window limits have left (economy.md §10): purchases and Karma spent as a buyer, Karma received as a seller. */
export const WindowLeft = Type.Object(
  { purchases: Count, spend: Count, proceeds: Count },
  { additionalProperties: false },
);
export type WindowLeft = Static<typeof WindowLeft>;

/**
 * `GET /api/market/mine`: the caller's active, unexpired listings, those
 * closed in the last 30 days (an unpurged expired one among them), its
 * purchases of the last 30 days, and its window limits' room.
 */
export const MarketMine = Type.Object(
  {
    active: Type.Array(Listing),
    closed: Type.Array(ClosedListing),
    purchases: Type.Array(PurchaseReceipt),
    left: WindowLeft,
    franchises: Type.Array(FranchiseRef),
  },
  { additionalProperties: false },
);
export type MarketMine = Static<typeof MarketMine>;
