import type { AccountPublic } from "@anime-tcg/shared/api";
import { useEffect, useRef } from "react";
import { useLoginForm } from "../../hooks/useLoginForm";
import { common, loginCopy } from "../../lib/copy";
import { FormBanner } from "./FormBanner";
import { PasswordField, SubmitButton, TextField } from "./fields";
import { BUTTON, HINT_TEXT, PANEL_HEADING } from "./styles";

interface Props {
  onBack: () => void;
  onLoggedIn: (account: AccountPublic) => void;
}

export function LoginForm({ onBack, onLoggedIn }: Props) {
  const form = useLoginForm({ onLoggedIn });
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const waiting = form.waitRemaining !== null;
  const submitLabel =
    form.waitRemaining !== null
      ? common.tryAgainIn(form.waitRemaining)
      : form.submitting
        ? loginCopy.submitting
        : loginCopy.submit;

  return (
    <div className="flex flex-col gap-4">
      <h2
        id="account-heading"
        ref={headingRef}
        tabIndex={-1}
        className={`${PANEL_HEADING} focus:outline-none`}
      >
        {loginCopy.heading}
      </h2>
      <form noValidate onSubmit={(event) => void form.submit(event)} className="flex flex-col gap-4">
        {form.unreachable && <FormBanner />}
        <TextField
          id="login-login"
          label={loginCopy.loginLabel}
          value={form.values.login}
          onChange={(value) => form.setValue("login", value)}
          state={form.fields.login}
          ref={form.fieldRef("login")}
          disabled={form.submitting}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={24}
        />
        <PasswordField
          id="login-password"
          label={loginCopy.passwordLabel}
          value={form.values.password}
          onChange={(value) => form.setValue("password", value)}
          state={form.fields.password}
          ref={form.fieldRef("password")}
          disabled={form.submitting}
          autoComplete="current-password"
        />
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <SubmitButton
            blocked={form.submitting || waiting}
            className={`${BUTTON.primary} w-full sm:w-auto ${waiting ? "tabular-nums" : ""}`}
          >
            {submitLabel}
          </SubmitButton>
          <button
            type="button"
            onClick={onBack}
            disabled={form.submitting}
            className={`${BUTTON.secondary} w-full sm:w-auto`}
          >
            {common.back}
          </button>
        </div>
        {form.breather && (
          <p role="status" className={HINT_TEXT}>
            {common.breather}
          </p>
        )}
      </form>
      <p className={HINT_TEXT}>{loginCopy.forgotten}</p>
    </div>
  );
}
