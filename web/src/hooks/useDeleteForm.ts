import { useCallback, useState, type FormEvent } from "react";
import { common, manageCopy } from "../lib/copy";
import { toFailure, type Failure } from "../lib/failures";
import { OK, withMessage } from "../lib/fieldState";
import { useDeleteAccountMutation } from "./useAccountMutations";
import { useFieldFocus } from "./useFieldFocus";
import { useRetryWait } from "./useRetryWait";
import { useShellContext } from "./useShell";

interface Options {
  onDeleted: () => void;
}

/** The delete confirmation panel (accounts.md §3.5.3, §4.6): the password field is focused on entry. */
export function useDeleteForm({ onDeleted }: Options) {
  const [password, setPassword] = useState("");
  const [field, setField] = useState(OK);
  const [unreachable, setUnreachable] = useState(false);
  const [breather, setBreather] = useState(false);
  const { focusField, fieldRef } = useFieldFocus<"password">("password");
  const { announce } = useShellContext();
  const onWaitEnd = useCallback(() => announce(common.waitOver), [announce]);
  const wait = useRetryWait(onWaitEnd);
  const deletion = useDeleteAccountMutation();

  const applyFailure = useCallback(
    (failure: Failure) => {
      if (failure.kind === "network") {
        setUnreachable(true);
        return;
      }
      switch (failure.code) {
        case "wrong_password":
        case "validation_failed":
          setField(withMessage(manageCopy.wrongCurrent));
          setPassword("");
          focusField("password");
          break;
        case "too_many_failures":
          setBreather(true);
          if (failure.retryAfterSeconds !== undefined) wait.start(failure.retryAfterSeconds);
          break;
        case "unauthenticated":
          break;
        default:
          setUnreachable(true);
      }
    },
    [focusField, wait],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length === 0) return;
    setUnreachable(false);
    setBreather(false);
    setField(OK);
    try {
      await deletion.mutateAsync({ password });
      onDeleted();
    } catch (err) {
      applyFailure(toFailure(err));
    }
  };

  return {
    password,
    field,
    unreachable,
    breather,
    waitRemaining: wait.remaining,
    deleting: deletion.isPending,
    setPassword,
    fieldRef,
    submit,
  };
}
