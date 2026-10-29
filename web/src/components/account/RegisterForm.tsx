import type { AccountPublic } from "@anime-tcg/shared/api";
import { useEffect, useRef } from "react";
import { useRegisterForm, type RegisterStep } from "../../hooks/useRegisterForm";
import { common, registerCopy } from "../../lib/copy";
import { FormBanner } from "./FormBanner";
import { PasswordField, TextField } from "./fields";
import { BODY_TEXT, BUTTON, HINT_TEXT, PANEL_HEADING } from "./styles";

interface Props {
  onBack: () => void;
  onRegistered: (account: AccountPublic) => void;
}

const STEP_LABEL: Record<RegisterStep, string> = { 1: registerCopy.step1, 2: registerCopy.step2 };

export function RegisterForm({ onBack, onRegistered }: Props) {
  const form = useRegisterForm({ onRegistered });
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The sub-step's heading takes focus on entry (§7 "Account screen").
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const busy = form.checking || form.submitting;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p id="register-step" className={HINT_TEXT}>
          {STEP_LABEL[form.step]}
        </p>
        <h2
          id="account-heading"
          ref={headingRef}
          tabIndex={-1}
          aria-describedby="register-step"
          className={`${PANEL_HEADING} focus:outline-none`}
        >
          {registerCopy.heading}
        </h2>
      </div>

      {form.capReached ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className={BODY_TEXT}>
            {registerCopy.capReached}
          </p>
          <button type="button" onClick={onBack} className={`${BUTTON.secondary} w-full sm:w-auto`}>
            {common.back}
          </button>
        </div>
      ) : form.step === 1 ? (
        <form noValidate onSubmit={(event) => void form.submitStep1(event)} className="flex flex-col gap-4">
          {form.unreachable && <FormBanner />}
          <TextField
            id="invite-code"
            label={registerCopy.inviteLabel}
            hint={registerCopy.inviteHint}
            value={form.values.code}
            onChange={(value) => form.setValue("code", value)}
            state={form.fields.code}
            ref={form.fieldRef("code")}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            inputClassName="font-mono tracking-wide"
          />
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            <button type="submit" disabled={busy} className={`${BUTTON.primary} w-full sm:w-auto`}>
              {form.checking ? registerCopy.checking : registerCopy.continue}
            </button>
            <button
              type="button"
              onClick={onBack}
              disabled={busy}
              className={`${BUTTON.secondary} w-full sm:w-auto`}
            >
              {common.back}
            </button>
          </div>
        </form>
      ) : (
        <form noValidate onSubmit={(event) => void form.submitStep2(event)} className="flex flex-col gap-4">
          {form.unreachable && <FormBanner />}
          <TextField
            id="register-login"
            label={registerCopy.loginLabel}
            hint={registerCopy.loginHint}
            placeholder={registerCopy.loginPlaceholder}
            value={form.values.login}
            onChange={(value) => form.setValue("login", value)}
            state={form.fields.login}
            ref={form.fieldRef("login")}
            disabled={busy}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={24}
          />
          <PasswordField
            id="register-password"
            label={registerCopy.passwordLabel}
            hint={common.passwordRules}
            value={form.values.password}
            onChange={(value) => form.setValue("password", value)}
            state={form.fields.password}
            ref={form.fieldRef("password")}
            disabled={busy}
            autoComplete="new-password"
          />
          <PasswordField
            id="register-confirm"
            label={registerCopy.confirmLabel}
            toggle="confirmation"
            value={form.values.confirm}
            onChange={(value) => form.setValue("confirm", value)}
            state={form.fields.confirm}
            ref={form.fieldRef("confirm")}
            disabled={busy}
            autoComplete="new-password"
          />
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            <button type="submit" disabled={busy} className={`${BUTTON.primary} w-full sm:w-auto`}>
              {form.submitting ? registerCopy.submitting : registerCopy.submit}
            </button>
            <button
              type="button"
              onClick={form.backToStep1}
              disabled={busy}
              className={`${BUTTON.secondary} w-full sm:w-auto`}
            >
              {common.back}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
