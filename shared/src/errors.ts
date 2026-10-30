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
  "price_out_of_bounds",
  "listing_limit",
  "listing_not_found",
  "listing_unavailable",
  "own_listing",
  "market_limit",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * The market's window limits (economy.md §10), in the order a purchase
 * checks them; `market_limit` names the first one it hit.
 */
export const MARKET_LIMITS = ["buyer_purchases", "buyer_spend", "seller_proceeds", "pair"] as const;
export type MarketLimit = (typeof MARKET_LIMITS)[number];

export const ErrorEnvelope = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.Union(ERROR_CODES.map((code) => Type.Literal(code))),
        message: Type.String(),
        /**
         * Only on `too_many_failures` (how long the sign-in breather still lasts),
         * `no_pack_available` (seconds until the next pack) and `market_limit` (when
         * enough of the limit's oldest purchases leave the window for this one to fit);
         * matches the `Retry-After` header.
         */
        retryAfterSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Only on `insufficient_funds`: the acting account's balance under the lock, so the UI needs no second request. */
        balance: Type.Optional(Type.Integer({ minimum: 0 })),
        /** Only on `market_limit`: which window limit the purchase hit, so the UI says whose room ran out. */
        limit: Type.Optional(Type.Union(MARKET_LIMITS.map((name) => Type.Literal(name)))),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ErrorEnvelope = Static<typeof ErrorEnvelope>;
