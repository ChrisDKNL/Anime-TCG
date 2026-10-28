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
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorEnvelope = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.Union(ERROR_CODES.map((code) => Type.Literal(code))),
        message: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ErrorEnvelope = Static<typeof ErrorEnvelope>;
