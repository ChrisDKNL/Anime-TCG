import { type Static, Type } from "@sinclair/typebox";

/**
 * Every code the API can put in an error envelope. Stable and snake_case so
 * the UI can switch on them; adding one here is part of adding the behaviour.
 */
export const ERROR_CODES = [
  "validation_failed",
  "bad_origin",
  "not_found",
  "payload_too_large",
  "header_too_large",
  "unsupported_media_type",
  "rate_limited",
  "bad_request",
  "internal",
  "invite_invalid",
  "cap_reached",
  "login_taken",
  "bad_credentials",
  "wrong_password",
  "too_many_failures",
  "unauthenticated",
  "no_pack_available",
  "pool_unavailable",
  "not_enough_copies",
  "balance_limit",
  "insufficient_funds",
  "request_id_reused",
  "theme_unavailable",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorEnvelope = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.Union(ERROR_CODES.map((code) => Type.Literal(code))),
        message: Type.String(),
        /**
         * Only on `too_many_failures` (how long the sign-in breather still lasts) and
         * `no_pack_available` (seconds until the next pack); matches the `Retry-After` header.
         */
        retryAfterSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Only on `insufficient_funds`: the acting account's balance under the lock, so the UI needs no second request. */
        balance: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ErrorEnvelope = Static<typeof ErrorEnvelope>;
