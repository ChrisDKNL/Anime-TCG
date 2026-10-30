import type { AccountPublic } from "@anime-tcg/shared/api";
import { useCallback, useState, type FormEvent } from "react";
import { loginCopy } from "../lib/copy";
import { serverWait, toFailure, type Failure } from "../lib/failures";
import { firstInvalid, FLAGGED, OK, withMessage, type FieldState } from "../lib/fieldState";
import { checkRequired } from "../lib/validation";
import { useLoginMutation } from "./useAccountMutations";
import { useFieldFocus } from "./useFieldFocus";
import { useServerWait } from "./useServerWait";
import { useSingleFlight } from "./useSingleFlight";

export type LoginField = "login" | "password";

const ALL_OK: Record<LoginField, FieldState> = { login: OK, password: OK };
const ORDER: readonly LoginField[] = ["login", "password"];

interface Options {
  onLoggedIn: (account: AccountPublic) => void;
}

/** Log in (accounts.md §3.4, §4.4-B), including the server-enforced wait after repeated misses or the rate limiter. */
export function useLoginForm({ onLoggedIn }: Options) {
  const [values, setValues] = useState<Record<LoginField, string>>({ login: "", password: "" });
  const [fields, setFields] = useState(ALL_OK);
  const [unreachable, setUnreachable] = useState(false);
  const { focusField, fieldRef } = useFieldFocus<LoginField>();
  const {
    remaining: waitRemaining,
    statusLine: waitStatus,
    begin: beginWait,
    clear: clearWait,
  } = useServerWait();
  const loginMutation = useLoginMutation();
  const singleFlight = useSingleFlight();

  const setValue = useCallback((field: LoginField, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
  }, []);

  /** One failure message whatever the server knew (§3.4.2); the password is cleared, focus goes to Login. */
  const incorrect = useCallback(() => {
    setFields({ login: FLAGGED, password: withMessage(loginCopy.incorrect) });
    setValues((previous) => ({ ...previous, password: "" }));
    focusField("login");
  }, [focusField]);

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
        case "bad_credentials":
        case "validation_failed":
          incorrect();
          break;
        default:
          setUnreachable(true);
      }
    },
    [incorrect, beginWait],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    return singleFlight(async () => {
      if (waitRemaining !== null) return;
      setUnreachable(false);
      clearWait();
      const next: Record<LoginField, FieldState> = {
        login: checkRequired(values.login.trim()) === null ? OK : withMessage(loginCopy.emptyLogin),
        password: checkRequired(values.password) === null ? OK : withMessage(loginCopy.emptyPassword),
      };
      setFields(next);
      const invalid = firstInvalid(next, ORDER);
      if (invalid !== null) {
        focusField(invalid);
        return;
      }
      try {
        const signedIn = await loginMutation.mutateAsync({
          login: values.login.trim(),
          password: values.password,
        });
        onLoggedIn(signedIn.account);
      } catch (err) {
        applyFailure(toFailure(err));
      }
    });
  };

  return {
    values,
    fields,
    unreachable,
    waitStatus,
    waitRemaining,
    submitting: loginMutation.isPending,
    setValue,
    fieldRef,
    submit,
  };
}
