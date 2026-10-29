import { Link, useLocation } from "@tanstack/react-router";
import { BODY_TEXT, PANEL } from "../components/account/styles";
import { RegisterForm } from "../components/account/RegisterForm";
import { TEXT_LINK } from "../components/layout/styles";
import { useShellContext } from "../hooks/useShell";
import { useSignedInNavigation } from "../hooks/useSignedInNavigation";
import { registerCopy } from "../lib/copy";
import { crossLinkCopy, headerCopy } from "../lib/navigationCopy";
import { PAGE_HEADING_ID } from "../lib/pageFocus";
import { toReturnPath } from "../lib/routes";

/** `/register` (navigation-and-landing.md §3.5 step 6). */
export function RegisterPage() {
  const returnTo = toReturnPath(useLocation({ select: (location) => location.state.returnTo }));
  const { announce, clearNotice } = useShellContext();
  const goSignedIn = useSignedInNavigation();

  return (
    <section aria-labelledby={PAGE_HEADING_ID} className={`mx-auto w-full max-w-sm ${PANEL}`}>
      <RegisterForm
        onRegistered={(account) => {
          clearNotice();
          announce({ template: registerCopy.registered, login: account.login });
          goSignedIn();
        }}
        crossLink={
          <p className={BODY_TEXT}>
            {crossLinkCopy.toLogIn}{" "}
            <Link to="/login" state={returnTo === null ? {} : { returnTo }} className={TEXT_LINK}>
              {headerCopy.logIn}
            </Link>
          </p>
        }
      />
    </section>
  );
}
