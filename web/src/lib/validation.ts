import { characterCount, LOGIN_LENGTH, PASSWORD_LENGTH } from "@anime-tcg/shared/api";

/**
 * Client-side checks run on submit, before the server is asked, so a typo does
 * not cost a round trip. The server checks the same limits again; the UI maps
 * its answer to the same messages (accounts.md §3.3).
 */

export type LengthIssue = "empty" | "length";

/** The login is trimmed; the trimmed value is what is sent and shown. */
export function checkLogin(raw: string): { value: string; issue: LengthIssue | null } {
  const value = raw.trim();
  if (value.length === 0) return { value, issue: "empty" };
  const count = characterCount(value);
  return { value, issue: count < LOGIN_LENGTH.min || count > LOGIN_LENGTH.max ? "length" : null };
}

/** A password being set. Never trimmed. */
export function checkNewPassword(password: string): LengthIssue | null {
  if (password.length === 0) return "empty";
  const count = characterCount(password);
  return count < PASSWORD_LENGTH.min || count > PASSWORD_LENGTH.max ? "length" : null;
}

/** The confirmation must match byte for byte; two empty strings match, which the password check reports instead. */
export function checkConfirmation(password: string, confirmation: string): "mismatch" | null {
  return password === confirmation ? null : "mismatch";
}

/** A field that only has to be filled in (a login or password being checked, not set). */
export function checkRequired(raw: string): "empty" | null {
  return raw.length === 0 ? "empty" : null;
}

/** The invite code is trimmed; case is the server's business. */
export function checkInviteCode(raw: string): { value: string; issue: "empty" | null } {
  const value = raw.trim();
  return { value, issue: value.length === 0 ? "empty" : null };
}
