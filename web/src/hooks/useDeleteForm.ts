import { useCallback, useState, type FormEvent } from "react";
import { manageCopy } from "../lib/copy";
import { serverWait, toFailure, type Failure } from "../lib/failures";
import { OK, withMessage } from "../lib/fieldState";
import { useDeleteAccountMutation } from "./useAccountMutations";
import { useFieldFocus } from "./useFieldFocus";
import { useServerWait } from "./useServerWait";
import { useSingleFlight } from "./useSingleFlight";

interface Options {
  onDeleted: () => void;
}

/** The delete confirmation panel (accounts.md §3.5.3, §4.6): the password field is focused on entry. */
export function useDeleteForm({ onDeleted }: Options) {
  const [password, setPassword] = useState("");
  const [field, setField] = useState(OK);
  const [unreachable, setUnreachable] = useState(false);
  const { focusField, fieldRef } = useFieldFocus<"password">("password");
  const {
    remaining: waitRemaining,
    statusLine: waitStatus,
    begin: beginWait,
    clear: clearWait,
  } = useServerWait();
  const deletion = useDeleteAccountMutation();
  const singleFlight = useSingleFlight();

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
        case "validation_failed":
          setField(withMessage(manageCopy.wrongCurrent));
          setPassword("");
          focusField("password");
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
      if (password.length === 0 || waitRemaining !== null) return;
      setUnreachable(false);
      clearWait();
      setField(OK);
      try {
        await deletion.mutateAsync({ password });
        onDeleted();
      } catch (err) {
        applyFailure(toFailure(err));
      }
    });
  };

  return {
    password,
    field,
    unreachable,
    waitStatus,
    waitRemaining,
    deleting: deletion.isPending,
    setPassword,
    fieldRef,
    submit,
  };
}
