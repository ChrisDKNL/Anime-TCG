import type { CopyText } from "./loginText";

/** A form field's validity after a submit: invalid with a message under it, invalid without one (the login field on "incorrect"), or fine. */
export interface FieldState {
  invalid: boolean;
  message: CopyText | null;
}

export const OK: FieldState = { invalid: false, message: null };
export const FLAGGED: FieldState = { invalid: true, message: null };

export function withMessage(message: CopyText): FieldState {
  return { invalid: true, message };
}

/** The first invalid field in the DOM order given, which is where focus goes (accounts.md §7). */
export function firstInvalid<F extends string>(fields: Record<F, FieldState>, order: readonly F[]): F | null {
  return order.find((field) => fields[field].invalid) ?? null;
}
