import type { AccountPublic } from "@anime-tcg/shared/api";
import type { ReactNode } from "react";
import { useRegisterForm, type RegisterStep } from "../../hooks/useRegisterForm";
import { common, registerCopy } from "../../lib/copy";
import { pageHeading } from "../../lib/routes";
import { PageHeading } from "../layout/PageHeading";
import { FormBanner } from "./FormBanner";
import { PasswordField, SubmitButton, TextField } from "./fields";
import { BODY_TEXT, BUTTON, HINT_TEXT, PANEL_HEADING } from "./styles";

interface Props {
  onRegistered: (account: AccountPublic) => void;
  /** `Already registered?` and its `Log in` link, under the form in every state (navigation-and-landing.md §3.5 step 6). */
  crossLink?: ReactNode;
}

const STEP_LABEL: Record<RegisterStep, string> = { 1: registerCopy.step1, 2: registerCopy.step2 };

/**
 * The `/register` page's panel (accounts.md §3.3 as amended by
 * navigation-and-landing.md §3.5): both steps are one page and one history
 * entry. Step 1 and the cap message have no `Back` (the browser's Back leaves
 * the page); step 2 keeps its `Back` to step 1.
 */
export function RegisterForm({ onRegistered, crossLink }: Props) {
  const form = useRegisterForm({ onRegistered });

  const busy = form.checking || form.submitting;
  const waiting = form.waitRemaining !== null;
  const countdown = form.waitRemaining === null ? null : common.tryAgainIn(form.waitRemaining);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p id="register-step" className={HINT_TEXT}>
          {STEP_LABEL[form.step]}
        </p>
        <PageHeading
          text={pageHeading("/register")}
          describedBy="register-step"
          className={`${PANEL_HEADING} focus:outline-none`}
        />
      </div>

      {form.capReached ? (
        <p role="alert" className={BODY_TEXT}>
          {registerCopy.capReached}
        </p>
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
          <SubmitButton
            blocked={busy || waiting}
            className={`${BUTTON.primary} w-full sm:w-auto sm:self-start ${waiting ? "tabular-nums" : ""}`}
          >
            {countdown ?? (form.checking ? registerCopy.checking : registerCopy.continue)}
          </SubmitButton>
          {form.waitStatus !== null && (
            <p role="status" className={HINT_TEXT}>
              {form.waitStatus}
            </p>
          )}
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
          <div className="flex flex-col gap-2 sm:flex-row">
            <SubmitButton
              blocked={busy || waiting}
              className={`${BUTTON.primary} w-full sm:w-auto ${waiting ? "tabular-nums" : ""}`}
            >
              {countdown ?? (form.submitting ? registerCopy.submitting : registerCopy.submit)}
            </SubmitButton>
            <button
              type="button"
              onClick={form.backToStep1}
              disabled={busy}
              className={`${BUTTON.secondary} w-full sm:w-auto`}
            >
              {common.back}
            </button>
          </div>
          {form.waitStatus !== null && (
            <p role="status" className={HINT_TEXT}>
              {form.waitStatus}
            </p>
          )}
        </form>
      )}
      {crossLink}
    </div>
  );
}
