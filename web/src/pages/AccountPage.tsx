import { useNavigate } from "@tanstack/react-router";
import { ManageAccount } from "../components/account/ManageAccount";
import { useGame } from "../hooks/useGame";
import { useShellContext } from "../hooks/useShell";
import { manageCopy } from "../lib/copy";

/** `/account`, Manage account as a page (navigation-and-landing.md §3.4). */
export function AccountPage() {
  const { account } = useGame();
  const { announce } = useShellContext();
  const navigate = useNavigate();
  return (
    <ManageAccount
      account={account}
      onRenamed={(renamed) => announce({ template: manageCopy.loginChanged, login: renamed.login })}
      onDeleted={(login) => {
        announce({ template: manageCopy.deleted, login });
        // §3.4 step 5: the session is gone, so Back must not return to an account page.
        void navigate({ to: "/", replace: true });
      }}
    />
  );
}
