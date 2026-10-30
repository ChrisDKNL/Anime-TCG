import { useCallback, useState, type FormEvent } from "react";
import { common, loginCopy, manageCopy, registerCopy } from "../lib/copy";
import { serverWait, toFailure, type Failure } from "../lib/failures";
import { firstInvalid, OK, withMessage, type FieldState } from "../lib/fieldState";
import { checkConfirmation, checkNewPassword, checkRequired } from "../lib/validation";
import { useChangePasswordMutation } from "./useAccountMutations";
import { useFieldFocus } from "./useFieldFocus";
import { useServerWait } from "./useServerWait";
import { useShellContext } from "./useShell";
import { useSingleFlight } from "./useSingleFlight";

export type PasswordField = "current" | "next" | "confirm";

const ALL_OK: Record<PasswordField, FieldState> = { current: OK, next: OK, confirm: OK };
const EMPTY: Record<PasswordField, string> = { current: "", next: "", confirm: "" };
const ORDER: readonly PasswordField[] = ["current", "next", "confirm"];

/** The Manage dialog's Password section (accounts.md §4.4-C), with the same server-enforced wait as Log in. */
export function useChangePasswordForm() {
  const [values, setValues] = useState(EMPTY);
  const [fields, setFields] = useState(ALL_OK);
  const [unreachable, setUnreachable] = useState(false);
  const [changed, setChanged] = useState(false);
  const { focusField, fieldRef } = useFieldFocus<PasswordField>();
  const { announce } = useShellContext();
  const {
    remaining: waitRemaining,
    statusLine: waitStatus,
    begin: beginWait,
    clear: clearWait,
  } = useServerWait();
  const change = useChangePasswordMutation();
  const singleFlight = useSingleFlight();

  const setValue = useCallback((field: PasswordField, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
  }, []);

  const applyFailure = useCallback(
    (failure: Failure) => {
      if (failure.kind === "network") {
        setUnreachable(true);
        return;
      }
      const wait = serverWait(failure);
      if (wait !== null) {
        beginWait(wait);
        return;
      }
      switch (failure.code) {
        case "wrong_password":
          setFields({ ...ALL_OK, current: withMessage(manageCopy.wrongCurrent) });
          setValues((previous) => ({ ...previous, current: "" }));
          focusField("current");
          break;
        case "validation_failed":
          setFields({ ...ALL_OK, next: withMessage(common.passwordLength) });
          focusField("next");
          break;
        case "unauthenticated":
          break;
        default:
          setUnreachable(true);
      }
    },
    [focusField, beginWait],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    return singleFlight(async () => {
      if (waitRemaining !== null) return;
      setUnreachable(false);
      setChanged(false);
      clearWait();
      const next = checkNewPassword(values.next);
      const fieldsAfterCheck: Record<PasswordField, FieldState> = {
        current: checkRequired(values.current) === null ? OK : withMessage(loginCopy.emptyPassword),
        next:
          next === "empty"
            ? withMessage(registerCopy.emptyPassword)
            : next === "length"
              ? withMessage(common.passwordLength)
              : OK,
        confirm: checkConfirmation(values.next, values.confirm) === null ? OK : withMessage(common.mismatch),
      };
      setFields(fieldsAfterCheck);
      const invalid = firstInvalid(fieldsAfterCheck, ORDER);
      if (invalid !== null) {
        focusField(invalid);
        return;
      }
      try {
        await change.mutateAsync({ currentPassword: values.current, newPassword: values.next });
        setValues(EMPTY);
        setChanged(true);
        announce(manageCopy.passwordChanged);
      } catch (err) {
        applyFailure(toFailure(err));
      }
    });
  };

  return {
    values,
    fields,
    unreachable,
    changed,
    waitStatus,
    waitRemaining,
    submitting: change.isPending,
    setValue,
    fieldRef,
    submit,
  };
}
