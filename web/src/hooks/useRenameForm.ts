import type { AccountPublic } from "@anime-tcg/shared/api";
import { useCallback, useState, type FormEvent } from "react";
import { common, registerCopy } from "../lib/copy";
import { toFailure, type Failure } from "../lib/failures";
import { OK, withMessage } from "../lib/fieldState";
import { checkLogin } from "../lib/validation";
import { useRenameMutation } from "./useAccountMutations";
import { useFieldFocus } from "./useFieldFocus";

interface Options {
  login: string;
  onRenamed: (account: AccountPublic) => void;
}

/** The Manage dialog's Login section (accounts.md §3.5.3, §4.6): same rules as Register, Save only when changed. */
export function useRenameForm({ login, onRenamed }: Options) {
  const [value, setValue] = useState(login);
  const [field, setField] = useState(OK);
  const [unreachable, setUnreachable] = useState(false);
  const { focusField, fieldRef } = useFieldFocus<"login">();
  const rename = useRenameMutation();

  const applyFailure = useCallback(
    (failure: Failure, attempted: string) => {
      if (failure.kind === "network") {
        setUnreachable(true);
        return;
      }
      switch (failure.code) {
        case "login_taken":
          setField(withMessage(common.loginTaken(attempted)));
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
    [focusField],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setUnreachable(false);
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
  };

  return {
    value,
    field,
    unreachable,
    changed: value.trim() !== login,
    saving: rename.isPending,
    setValue,
    fieldRef,
    submit,
  };
}
