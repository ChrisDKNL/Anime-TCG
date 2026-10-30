import type { AccountPublic } from "@anime-tcg/shared/api";
import { useCallback, useState, type FormEvent } from "react";
import { common, registerCopy } from "../lib/copy";
import { serverWait, toFailure, type Failure } from "../lib/failures";
import { OK, withMessage } from "../lib/fieldState";
import { checkLogin } from "../lib/validation";
import { useRenameMutation } from "./useAccountMutations";
import { useFieldFocus } from "./useFieldFocus";
import { useServerWait } from "./useServerWait";
import { useSingleFlight } from "./useSingleFlight";

interface Options {
  login: string;
  onRenamed: (account: AccountPublic) => void;
}

/** The Manage dialog's Login section (accounts.md §3.5.3, §4.6): same rules as Register, Save only when changed, and the rate limiter's wait. */
export function useRenameForm({ login, onRenamed }: Options) {
  const [value, setValue] = useState(login);
  const [field, setField] = useState(OK);
  const [unreachable, setUnreachable] = useState(false);
  const { focusField, fieldRef } = useFieldFocus<"login">();
  const {
    remaining: waitRemaining,
    statusLine: waitStatus,
    begin: beginWait,
    clear: clearWait,
  } = useServerWait();
  const rename = useRenameMutation();
  const singleFlight = useSingleFlight();
  const changed = value.trim() !== login;

  const applyFailure = useCallback(
    (failure: Failure, attempted: string) => {
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
        case "login_taken":
          setField(withMessage({ template: common.loginTaken, login: attempted }));
          focusField("login");
          break;
        case "validation_failed":
          setField(withMessage(common.loginLength));
          focusField("login");
          break;
        case "unauthenticated":
          // The mutation already ended the session; the dialog is on its way out.
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
      if (!changed || waitRemaining !== null) return;
      setUnreachable(false);
      clearWait();
      const check = checkLogin(value);
      if (check.issue !== null) {
        setField(withMessage(check.issue === "empty" ? registerCopy.emptyLogin : common.loginLength));
        focusField("login");
        return;
      }
      setField(OK);
      try {
        const { account } = await rename.mutateAsync({ login: check.value });
        onRenamed(account);
      } catch (err) {
        applyFailure(toFailure(err), check.value);
      }
    });
  };

  return {
    value,
    field,
    unreachable,
    changed,
    waitStatus,
    waitRemaining,
    saving: rename.isPending,
    setValue,
    fieldRef,
    submit,
  };
}
