import type { AccountPublic } from "@anime-tcg/shared/api";
import { useCallback, useState, type FormEvent } from "react";
import { common, registerCopy } from "../lib/copy";
import { toFailure, type Failure } from "../lib/failures";
import { firstInvalid, OK, withMessage, type FieldState } from "../lib/fieldState";
import { checkConfirmation, checkInviteCode, checkLogin, checkNewPassword } from "../lib/validation";
import { useCheckInviteMutation, useRegisterMutation } from "./useAccountMutations";
import { useFieldFocus } from "./useFieldFocus";

export type RegisterField = "code" | "login" | "password" | "confirm";
export type RegisterStep = 1 | 2;

const ALL_OK: Record<RegisterField, FieldState> = { code: OK, login: OK, password: OK, confirm: OK };
const STEP2_ORDER: readonly RegisterField[] = ["login", "password", "confirm"];

interface Options {
  onRegistered: (account: AccountPublic) => void;
}

/** Register in two steps (accounts.md §3.3, §4.4-A): the invite code first, then login and password. */
export function useRegisterForm({ onRegistered }: Options) {
  const [step, setStep] = useState<RegisterStep>(1);
  const [values, setValues] = useState<Record<RegisterField, string>>({
    code: "",
    login: "",
    password: "",
    confirm: "",
  });
  const [fields, setFields] = useState(ALL_OK);
  const [capReached, setCapReached] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const { focusField, fieldRef } = useFieldFocus<RegisterField>();
  const checkInvite = useCheckInviteMutation();
  const registration = useRegisterMutation();

  const setValue = useCallback((field: RegisterField, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
  }, []);

  const codeRejected = useCallback(() => {
    setStep(1);
    setFields({ ...ALL_OK, code: withMessage(registerCopy.invalidCode) });
    focusField("code");
  }, [focusField]);

  /** Every answer the server can give step 1 (§4.4-A); `validation_failed` is the same as an invalid code. */
  const applyStep1Failure = useCallback(
    (failure: Failure) => {
      if (failure.kind === "network") {
        setUnreachable(true);
        return;
      }
      switch (failure.code) {
        case "invite_invalid":
        case "validation_failed":
          codeRejected();
          break;
        case "cap_reached":
          setCapReached(true);
          break;
        default:
          setUnreachable(true);
      }
    },
    [codeRejected],
  );

  const applyStep2Failure = useCallback(
    (failure: Failure, login: string) => {
      if (failure.kind === "network") {
        setUnreachable(true);
        return;
      }
      switch (failure.code) {
        case "login_taken":
          setFields({ ...ALL_OK, login: withMessage(common.loginTaken(login)) });
          focusField("login");
          break;
        case "validation_failed":
          // The client checked first, so only the post-trim login length can still differ.
          setFields({ ...ALL_OK, login: withMessage(common.loginLength) });
          focusField("login");
          break;
        case "invite_invalid":
          codeRejected();
          break;
        case "cap_reached":
          setCapReached(true);
          break;
        default:
          setUnreachable(true);
      }
    },
    [codeRejected, focusField],
  );

  const submitStep1 = async (event: FormEvent) => {
    event.preventDefault();
    setUnreachable(false);
    const code = checkInviteCode(values.code);
    if (code.issue !== null) {
      setFields({ ...ALL_OK, code: withMessage(registerCopy.emptyCode) });
      focusField("code");
      return;
    }
    setFields(ALL_OK);
    try {
      await checkInvite.mutateAsync({ inviteCode: code.value });
      setStep(2);
      focusField("login");
    } catch (err) {
      applyStep1Failure(toFailure(err));
    }
  };

  const submitStep2 = async (event: FormEvent) => {
    event.preventDefault();
    setUnreachable(false);
    const login = checkLogin(values.login);
    const password = checkNewPassword(values.password);
    const confirmation = checkConfirmation(values.password, values.confirm);
    const next: Record<RegisterField, FieldState> = {
      code: OK,
      login:
        login.issue === "empty"
          ? withMessage(registerCopy.emptyLogin)
          : login.issue === "length"
            ? withMessage(common.loginLength)
            : OK,
      password:
        password === "empty"
          ? withMessage(registerCopy.emptyPassword)
          : password === "length"
            ? withMessage(common.passwordLength)
            : OK,
      confirm: confirmation === null ? OK : withMessage(common.mismatch),
    };
    setFields(next);
    const invalid = firstInvalid(next, STEP2_ORDER);
    if (invalid !== null) {
      focusField(invalid);
      return;
    }
    try {
      const signedIn = await registration.mutateAsync({
        inviteCode: checkInviteCode(values.code).value,
        login: login.value,
        password: values.password,
      });
      onRegistered(signedIn.account);
    } catch (err) {
      applyStep2Failure(toFailure(err), login.value);
    }
  };

  /** Step 2's Back: to step 1 with the code kept (§3.3.2). */
  const backToStep1 = () => {
    setStep(1);
    setFields(ALL_OK);
    setUnreachable(false);
    focusField("code");
  };

  return {
    step,
    values,
    fields,
    capReached,
    unreachable,
    checking: checkInvite.isPending,
    submitting: registration.isPending,
    setValue,
    fieldRef,
    submitStep1,
    submitStep2,
    backToStep1,
  };
}
