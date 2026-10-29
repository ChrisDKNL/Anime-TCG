import type { ErrorCode } from "@anime-tcg/shared/errors";
import { ApiError, NetworkError } from "./api";

/**
 * What a failed api call means to a form (accounts.md §3.7): either a typed
 * decision the server made, or no decision because the server could not be
 * reached. Anything else is a bug in this client and is rethrown so a test or
 * the console sees it instead of a misleading banner.
 */
export type Failure =
  { kind: "api"; code: ErrorCode; retryAfterSeconds: number | undefined } | { kind: "network" };

/** For a caller that treats every api answer and every network failure alike: a client bug still surfaces. */
export function rethrowUnlessKnown(err: unknown): void {
  if (!(err instanceof NetworkError) && !(err instanceof ApiError)) throw err;
}

export function toFailure(err: unknown): Failure {
  if (err instanceof NetworkError) return { kind: "network" };
  if (err instanceof ApiError)
    return { kind: "api", code: err.code, retryAfterSeconds: err.retryAfterSeconds };
  throw err;
}
