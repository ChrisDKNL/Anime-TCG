import type { ErrorCode, MarketLimit } from "@anime-tcg/shared/errors";
import { ApiError, NetworkError } from "./api";
import { rateLimitWaitSeconds } from "./game";

/**
 * What one answer to a balance-changing request (a shop purchase, a recycle, a listing, a market purchase)
 * means to its confirmation, whatever the request was
 * (collection-overview.md §3.5 step 9, market-and-shop.md §3.3 step 6).
 * Every outcome is the server's; the browser decides none.
 */
export type Outcome<R> =
  /** 201, or 200 on a replay of the key. */
  | { kind: "answered"; result: R }
  /**
   * Any envelope but `rate_limited` and `unauthenticated`: nothing changed, and the caller names it by
   * `code`. `balance` is on `insufficient_funds`; `limit` and `retryAfterSeconds` on `market_limit`.
   */
  | {
      kind: "refused";
      code: ErrorCode;
      balance: number | undefined;
      limit: MarketLimit | undefined;
      retryAfterSeconds: number | undefined;
    }
  /** 429 from the rate limiter: the wait from `Retry-After`, capped at `MAX_WAIT_SECONDS`. */
  | { kind: "rateLimited"; seconds: number }
  /** No answer at all: the request may or may not have arrived. */
  | { kind: "noAnswer" }
  | { kind: "sessionEnded" };

/** A failed request's outcome; anything that is neither an api answer nor no answer is a client bug and is rethrown. */
export function failureOutcome(err: unknown): Outcome<never> {
  if (err instanceof NetworkError) return { kind: "noAnswer" };
  if (!(err instanceof ApiError)) throw err;
  switch (err.code) {
    case "unauthenticated":
      return { kind: "sessionEnded" };
    case "rate_limited":
      return { kind: "rateLimited", seconds: rateLimitWaitSeconds(err.retryAfterSeconds) };
    default:
      return {
        kind: "refused",
        code: err.code,
        balance: err.balance,
        limit: err.limit,
        retryAfterSeconds: err.retryAfterSeconds,
      };
  }
}

/**
 * The idempotency key's rule (packs-page.md §3.3): kept while no answer has
 * arrived, so `Try again` resends the same request and a lost answer is
 * replayed instead of repeated; kept on a 429 too, which the rate limiter
 * sends before the route reads the key; discarded on every other answer.
 */
export function keepsKey(outcome: Outcome<unknown>): boolean {
  return outcome.kind === "noAnswer" || outcome.kind === "rateLimited";
}
