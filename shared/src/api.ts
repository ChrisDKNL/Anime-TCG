import { type Static, Type } from "@sinclair/typebox";
import { PACK_CAP, PACK_SIZE } from "./economy.js";
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

/** The cards an account holds of one character at one rarity and variant; cards are named this way, never by id. */
export const CollectionEntry = Type.Object(
  {
    kind: Type.Literal("card"),
    character: CharacterPublic,
    rarity: Rarity,
    variant: CardVariant,
    count: Type.Integer({ minimum: 1 }),
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
