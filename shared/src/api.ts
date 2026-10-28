import { type Static, Type } from "@sinclair/typebox";

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

/** What the api says about an account; `cards` is 0 until the collection moves server-side in 1c. */
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
