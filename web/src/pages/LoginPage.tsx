import { Link, useLocation } from "@tanstack/react-router";
import { PANEL, BODY_TEXT } from "../components/account/styles";
import { LoginForm } from "../components/account/LoginForm";
import { TEXT_LINK } from "../components/layout/styles";
import { useShellContext } from "../hooks/useShell";
import { useSignedInNavigation } from "../hooks/useSignedInNavigation";
import { loginCopy } from "../lib/copy";
import { crossLinkCopy, headerCopy } from "../lib/navigationCopy";
import { PAGE_HEADING_ID } from "../lib/pageFocus";
import { ACCOUNT_PAGES, toReturnPath } from "../lib/routes";

/** `/login` (navigation-and-landing.md §3.5 step 5). */
export function LoginPage() {
  // Checked again on use (§3.3 step 3): history state is whatever the entry holds.
  const returnTo = toReturnPath(useLocation({ select: (location) => location.state.returnTo }));
  const { announce, clearNotice, notice } = useShellContext();
  const goSignedIn = useSignedInNavigation();
  const guardLine = returnTo !== null && notice !== "sessionEnded" ? ACCOUNT_PAGES[returnTo].guardLine : null;

  return (
    <section aria-labelledby={PAGE_HEADING_ID} className={`mx-auto w-full max-w-sm ${PANEL}`}>
      <LoginForm
        guardLine={guardLine}
        onLoggedIn={(account) => {
          clearNotice();
          announce({ template: loginCopy.loggedIn, login: account.login });
          goSignedIn();
        }}
        crossLink={
          <p className={BODY_TEXT}>
            {crossLinkCopy.toRegister}{" "}
            {/* The return path goes along, so switching forms still returns to the page asked for (§3.3 step 5). */}
            <Link to="/register" state={returnTo === null ? {} : { returnTo }} className={TEXT_LINK}>
              {headerCopy.register}
            </Link>
          </p>
        }
      />
    </section>
  );
}
