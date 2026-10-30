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

/**
 * Why a form must wait before its next submit: repeated password misses (the
 * sign-in breather) or the route rate limiter. Each has its own status line.
 */
export type WaitReason = "misses" | "rateLimited";

export interface ServerWait {
  reason: WaitReason;
  /** `undefined` only for a breather that named no seconds: then no countdown is invented. */
  seconds: number | undefined;
}

/** A `rate_limited` answer without `Retry-After` waits this long (manager decision, 2026-10-30). */
export const RATE_LIMITED_FALLBACK_SECONDS = 60;

/** The server-enforced wait a failure asks for (accounts.md §3.4.3, §4.4), or `null` when it asks for none. */
export function serverWait(failure: Failure): ServerWait | null {
  if (failure.kind !== "api") return null;
  switch (failure.code) {
    case "too_many_failures":
      return { reason: "misses", seconds: failure.retryAfterSeconds };
    case "rate_limited":
      return { reason: "rateLimited", seconds: failure.retryAfterSeconds ?? RATE_LIMITED_FALLBACK_SECONDS };
    default:
      return null;
  }
}
