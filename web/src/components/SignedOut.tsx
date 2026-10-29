import type { AccountPublic } from "@anime-tcg/shared/api";
import { useState } from "react";
import { useShellContext } from "../hooks/useShell";
import { banners, loginCopy, registerCopy } from "../lib/copy";
import { AccountButton } from "./account/AccountControl";
import { AccountScreen, type AccountView, type SignedInVia } from "./account/AccountScreen";
import { PageFrame, type Frame } from "./PageFrame";

interface Props {
  frame: Frame;
  /** True while the boot session check is unanswered: nothing game-related renders (accounts.md §3.1). */
  loading: boolean;
  /** The `Loading…` text, only once the check has taken longer than 300 ms (§4.1). */
  showLoading: boolean;
}

/** Everything the page shows without a session: the title block, the Account button and the Account screen. */
export function SignedOut({ frame, loading, showLoading }: Props) {
  const [view, setView] = useState<AccountView>("choice");
  const { announce, requestFocus, clearNotice } = useShellContext();

  const showChoice = () => {
    setView("choice");
    requestFocus("accountHeading");
  };

  /** Register and Log in both land on the Booster tab with the pack button focused (§3.3.4, §3.4.4). */
  const signedIn = (via: SignedInVia, account: AccountPublic) => {
    clearNotice();
    announce({
      template: via === "registered" ? registerCopy.registered : loginCopy.loggedIn,
      login: account.login,
    });
    requestFocus("packButton");
  };

  return (
    <PageFrame
      frame={frame}
      headerRight={
        loading ? null : (
          <div className="flex justify-end">
            <AccountButton onClick={showChoice} />
          </div>
        )
      }
    >
      <main className="flex flex-col items-center">
        {loading ? (
          showLoading && (
            <p className="text-sm text-zinc-500" aria-live="polite">
              {banners.loading}
            </p>
          )
        ) : (
          <AccountScreen view={view} onView={setView} onSignedIn={signedIn} />
        )}
      </main>
    </PageFrame>
  );
}
