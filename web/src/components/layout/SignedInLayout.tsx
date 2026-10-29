import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useLogoutMutation } from "../../hooks/useAccountMutations";
import { useSetSession } from "../../hooks/useAccountSession";
import { useOptionalGame, type Game } from "../../hooks/useGame";
import { useShellContext } from "../../hooks/useShell";
import { menuCopy } from "../../lib/copy";
import { rethrowUnlessKnown } from "../../lib/failures";
import { headerCopy, poolCopy } from "../../lib/navigationCopy";
import { AccountControl } from "../account/AccountControl";
import { PageFrame } from "./PageFrame";
import { PageLink } from "./PageLink";
import { NAV_GROUP, NAV_LINK } from "./styles";
import { Wordmark } from "./Wordmark";

/**
 * The signed-in frame (navigation-and-landing.md §3.5 step 2, §5.1): the
 * wordmark to `/packs`, the page links and the Account control. Between a
 * sign-out and the page change it causes there is no account to show, so the
 * frame keeps only the wordmark for that moment.
 */
export function SignedInLayout({ children }: { children: ReactNode }) {
  const game = useOptionalGame();
  if (game === null) return <PageFrame header={<Wordmark />} />;
  return <SignedInFrame game={game}>{children}</SignedInFrame>;
}

function SignedInFrame({ game, children }: { game: Game; children: ReactNode }) {
  const { announce, unreachable, clearNotice } = useShellContext();
  const setSession = useSetSession();
  const logoutMutation = useLogoutMutation();
  const navigate = useNavigate();

  /**
   * Log out (accounts.md §3.5.2): the server ends the session; if it cannot be
   * reached the UI still signs out. Either way `/` replaces the page, so Back
   * cannot land on an account page that would only bounce to `/login`
   * (navigation-and-landing.md §3.5 step 7).
   */
  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      clearNotice();
      announce(menuCopy.loggedOut);
    } catch (err) {
      rethrowUnlessKnown(err);
      setSession({ signedIn: false });
      unreachable();
    }
    await navigate({ to: "/", replace: true });
  };

  const { account, pool } = game;
  return (
    <PageFrame
      header={
        <>
          <Wordmark to="/packs" />
          {/* Last in the visual order on phone, its own full-width row (§5.1); in the DOM it comes before the control. */}
          <nav aria-label={headerCopy.navLabel} className={`${NAV_GROUP} order-last sm:order-none`}>
            <PageLink to="/packs" className={NAV_LINK}>
              {headerCopy.packs}
            </PageLink>
            <PageLink to="/collection" className={NAV_LINK}>
              {headerCopy.collection}{" "}
              {/* The count leaves the screen below 400 px and stays in the accessible name. */}
              <span className="sr-only min-[400px]:not-sr-only">({game.stats.total})</span>
            </PageLink>
          </nav>
          <div className="flex min-w-0 justify-end">
            <AccountControl
              login={account.login}
              disabled={game.state.opening || logoutMutation.isPending}
              onLogout={() => void handleLogout()}
            />
          </div>
        </>
      }
      beforeMain={
        pool.status === "error" && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200"
          >
            <span>
              {poolCopy.failed} {pool.error}
            </span>
            <button
              type="button"
              onClick={() => pool.reload(true)}
              className="rounded-lg bg-red-800/60 px-3 py-1 font-medium hover:bg-red-700/60"
            >
              {poolCopy.retry}
            </button>
          </div>
        )
      }
    >
      {children}
    </PageFrame>
  );
}
