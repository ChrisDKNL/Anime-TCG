import type { AccountPublic } from "@anime-tcg/shared/api";
import type { ReactNode } from "react";
import { useLoginForm } from "../../hooks/useLoginForm";
import { common, loginCopy } from "../../lib/copy";
import { pageHeading } from "../../lib/routes";
import { PageHeading } from "../layout/PageHeading";
import { FormBanner } from "./FormBanner";
import { PasswordField, SubmitButton, TextField } from "./fields";
import { BODY_TEXT, BUTTON, HINT_TEXT, PANEL_HEADING } from "./styles";

interface Props {
  onLoggedIn: (account: AccountPublic) => void;
  /** Where the guard sent the visitor from, as a sentence (navigation-and-landing.md §3.3 step 4). */
  guardLine?: string | null;
  /** `No account yet?` and its `Register` link, between the form and the forgotten-password line (§3.5 step 5). */
  crossLink?: ReactNode;
}

/**
 * The `/login` page's panel (accounts.md §3.4 as amended by
 * navigation-and-landing.md §3.5): no `Back`, the browser's Back and the header
 * links go everywhere it went. Its `h1` takes focus from the page change, not
 * from the form.
 */
export function LoginForm({ onLoggedIn, guardLine = null, crossLink }: Props) {
  const form = useLoginForm({ onLoggedIn });

  const waiting = form.waitRemaining !== null;
  const submitLabel =
    form.waitRemaining !== null
      ? common.tryAgainIn(form.waitRemaining)
      : form.submitting
        ? loginCopy.submitting
        : loginCopy.submit;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <PageHeading text={pageHeading("/login")} className={`${PANEL_HEADING} focus:outline-none`} />
        {guardLine !== null && <p className={`mt-1 ${BODY_TEXT}`}>{guardLine}</p>}
      </div>
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
        <SubmitButton
          blocked={form.submitting || waiting}
          className={`${BUTTON.primary} w-full sm:w-auto sm:self-start ${waiting ? "tabular-nums" : ""}`}
        >
          {submitLabel}
        </SubmitButton>
        {form.waitStatus !== null && (
          <p role="status" className={HINT_TEXT}>
            {form.waitStatus}
          </p>
        )}
      </form>
      {crossLink}
      <p className={HINT_TEXT}>{loginCopy.forgotten}</p>
    </div>
  );
}
