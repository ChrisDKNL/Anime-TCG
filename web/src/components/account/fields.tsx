import { useState, type ComponentPropsWithoutRef, type Ref } from "react";
import type { FieldState } from "../../lib/fieldState";
import { common } from "../../lib/copy";
import { BUTTON, ERROR_TEXT, HINT_TEXT, INPUT, INPUT_BORDER } from "./styles";

interface FieldShellProps {
  id: string;
  label: string;
  /** `sr-only` for the Manage dialog's `New login` field, whose section heading already says "Login". */
  labelHidden?: boolean;
  hint?: string;
  state: FieldState;
  children: (describedBy: string | undefined) => React.ReactNode;
}

/** Label, optional hint, the control, and the error line, wired with `aria-describedby`. */
function FieldShell({ id, label, labelHidden = false, hint, state, children }: FieldShellProps) {
  const hintId = hint === undefined ? null : `${id}-hint`;
  const errorId = state.message === null ? null : `${id}-error`;
  const describedBy = [hintId, errorId].filter((part) => part !== null).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelHidden ? "sr-only" : "text-sm text-zinc-200"}>
        {label}
      </label>
      {children(describedBy)}
      {hint !== undefined && (
        <p id={hintId ?? undefined} className={HINT_TEXT}>
          {hint}
        </p>
      )}
      {state.message !== null && (
        <p id={errorId ?? undefined} role="alert" className={ERROR_TEXT}>
          {state.message}
        </p>
      )}
    </div>
  );
}

type InputAttributes = Omit<
  ComponentPropsWithoutRef<"input">,
  "id" | "value" | "onChange" | "className" | "type"
>;

interface TextFieldProps extends InputAttributes {
  id: string;
  label: string;
  labelHidden?: boolean;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  state: FieldState;
  /** Extra classes for the control, e.g. `font-mono tracking-wide` on the invite code. */
  inputClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  id,
  label,
  labelHidden,
  hint,
  value,
  onChange,
  state,
  inputClassName = "",
  ref,
  ...attributes
}: TextFieldProps) {
  return (
    <FieldShell id={id} label={label} labelHidden={labelHidden} hint={hint} state={state}>
      {(describedBy) => (
        <input
          {...attributes}
          ref={ref}
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={state.invalid || undefined}
          aria-describedby={describedBy}
          className={`${INPUT} ${INPUT_BORDER[state.invalid ? "invalid" : "valid"]} ${inputClassName}`}
        />
      )}
    </FieldShell>
  );
}

type ToggleKind = "password" | "confirmation";

const TOGGLE_NAME: Record<ToggleKind, Record<"show" | "hide", string>> = {
  password: { show: common.showPassword, hide: common.hidePassword },
  confirmation: { show: common.showConfirmation, hide: common.hideConfirmation },
};

interface PasswordFieldProps extends Omit<TextFieldProps, "inputClassName"> {
  /** Names the Show/Hide toggle for assistive tech (§7 "Password fields"). */
  toggle?: ToggleKind;
}

/**
 * A password input with its own Show/Hide text toggle inside the right edge.
 * Never `font-mono`, never `maxLength` (§6, §7): the value is validated on
 * submit, not cut off while typing.
 */
export function PasswordField({
  id,
  label,
  labelHidden,
  hint,
  value,
  onChange,
  state,
  toggle = "password",
  disabled,
  ref,
  ...attributes
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const names = TOGGLE_NAME[toggle];
  return (
    <FieldShell id={id} label={label} labelHidden={labelHidden} hint={hint} state={state}>
      {(describedBy) => (
        <div className="relative">
          <input
            {...attributes}
            ref={ref}
            id={id}
            type={shown ? "text" : "password"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={state.invalid || undefined}
            aria-describedby={describedBy}
            className={`${INPUT} ${INPUT_BORDER[state.invalid ? "invalid" : "valid"]} pr-16`}
          />
          <button
            type="button"
            onClick={() => setShown((previous) => !previous)}
            disabled={disabled}
            aria-pressed={shown}
            aria-label={shown ? names.hide : names.show}
            className={`absolute inset-y-0 right-2 my-auto h-7 ${BUTTON.text}`}
          >
            {shown ? common.hide : common.show}
          </button>
        </div>
      )}
    </FieldShell>
  );
}
