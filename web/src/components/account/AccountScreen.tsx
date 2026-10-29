import type { AccountPublic } from "@anime-tcg/shared/api";
import { useRef } from "react";
import { useFocusTarget, useShellContext } from "../../hooks/useShell";
import { accountScreen } from "../../lib/copy";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { BODY_TEXT, BUTTON, PANEL, PANEL_HEADING } from "./styles";

export type AccountView = "choice" | "login" | "register";

export type SignedInVia = "registered" | "loggedIn";

interface Props {
  view: AccountView;
  onView: (view: AccountView) => void;
  onSignedIn: (via: SignedInVia, account: AccountPublic) => void;
}

/** The signed-out main area (accounts.md §3.2, §4.3): the choice panel, or one of its two sub-steps in its place. */
export function AccountScreen({ view, onView, onSignedIn }: Props) {
  const { requestFocus } = useShellContext();
  /** Back returns to the choice with focus on its heading (§7 "Account screen"). */
  const back = () => {
    onView("choice");
    requestFocus("accountHeading");
  };
  return (
    <section aria-labelledby="account-heading" className={`mx-auto w-full max-w-sm ${PANEL}`}>
      {view === "choice" && <Choice onView={onView} />}
      {view === "login" && (
        <LoginForm onBack={back} onLoggedIn={(account) => onSignedIn("loggedIn", account)} />
      )}
      {view === "register" && (
        <RegisterForm onBack={back} onRegistered={(account) => onSignedIn("registered", account)} />
      )}
    </section>
  );
}

function Choice({ onView }: { onView: (view: AccountView) => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusTarget("accountHeading", headingRef);
  return (
    <div className="flex flex-col gap-4">
      <h2
        id="account-heading"
        ref={headingRef}
        tabIndex={-1}
        className={`${PANEL_HEADING} focus:outline-none`}
      >
        {accountScreen.heading}
      </h2>
      <p className={BODY_TEXT}>{accountScreen.intro}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => onView("login")}
          className={`${BUTTON.primary} w-full sm:w-auto`}
        >
          {accountScreen.logIn}
        </button>
        <button
          type="button"
          onClick={() => onView("register")}
          className={`${BUTTON.secondary} w-full sm:w-auto`}
        >
          {accountScreen.register}
        </button>
      </div>
    </div>
  );
}
