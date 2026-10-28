import { type Static, Type } from "@sinclair/typebox";

/** `GET /api/session`. Sprint 1a has no accounts, so the only state is signed out. */
export const SessionResponse = Type.Object(
  { signedIn: Type.Literal(false) },
  { additionalProperties: false },
);
export type SessionResponse = Static<typeof SessionResponse>;

const UpOrDown = Type.Union([Type.Literal("ok"), Type.Literal("down")]);

/** `GET /healthz`: 200 when the database answers `SELECT 1`, 503 otherwise. */
export const HealthResponse = Type.Object(
  { status: UpOrDown, db: UpOrDown },
  { additionalProperties: false },
);
export type HealthResponse = Static<typeof HealthResponse>;
