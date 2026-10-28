import { characterCount, LOGIN_LENGTH } from "@anime-tcg/shared/api";
import { ApiError } from "../errors.js";

/** The uniqueness and throttle key: trimmed and case-folded, so "Chris" and " chris " name one account. */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/**
 * Any character is allowed in a login except U+0000, which Postgres cannot
 * put in `text`: not in a stored row and not in a query parameter, so even a
 * sign-in lookup for it would be a 500. No account can hold one, so refusing
 * it up front, before any database read or password work, reveals nothing.
 * Every path that takes a login from a body (register, rename, login) goes
 * through here; the message keeps the schema's `body/login` prefix so the UI
 * maps it to the same field.
 */
export function storableLogin(login: string): string {
  if (login.includes("\u0000")) {
    throw new ApiError(400, "validation_failed", "body/login must not contain the null character");
  }
  return login;
}

/**
 * The display login for register and rename: storable, trimmed, then held to
 * the schema's limits once more, because "  ab  " satisfied them with its
 * spaces. Sign-in does not use this: its body allows 1..24 on purpose.
 */
export function validatedLogin(login: string): string {
  const trimmed = storableLogin(login).trim();
  const length = characterCount(trimmed);
  if (length < LOGIN_LENGTH.min || length > LOGIN_LENGTH.max) {
    throw new ApiError(
      400,
      "validation_failed",
      `body/login must be ${LOGIN_LENGTH.min} to ${LOGIN_LENGTH.max} characters after trimming`,
    );
  }
  return trimmed;
}
