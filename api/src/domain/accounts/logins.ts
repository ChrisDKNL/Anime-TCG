import { characterCount, LOGIN_LENGTH } from "@anime-tcg/shared/api";
import { ApiError } from "../errors.js";

/** The uniqueness and throttle key: trimmed and case-folded, so "Chris" and " chris " name one account. */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/**
 * The display login: trimmed, then held to the schema's limits once more,
 * because "  ab  " satisfied them with its spaces. Any character is allowed
 * except U+0000, which Postgres cannot store in `text` and would turn into a
 * 500. The messages keep the schema's `body/login` prefix so the UI can map
 * them to the same field.
 */
export function validatedLogin(login: string): string {
  const trimmed = login.trim();
  const length = characterCount(trimmed);
  if (length < LOGIN_LENGTH.min || length > LOGIN_LENGTH.max) {
    throw new ApiError(
      400,
      "validation_failed",
      `body/login must be ${LOGIN_LENGTH.min} to ${LOGIN_LENGTH.max} characters after trimming`,
    );
  }
  if (trimmed.includes("\u0000")) {
    throw new ApiError(400, "validation_failed", "body/login must not contain the null character");
  }
  return trimmed;
}
