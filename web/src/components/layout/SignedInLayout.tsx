import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useLogoutMutation } from "../../hooks/useAccountMutations";
import { useSetSession } from "../../hooks/useAccountSession";
import { useOptionalGame, type Game } from "../../hooks/useGame";
import { useShellContext } from "../../hooks/useShell";
import { formatCount, menuCopy } from "../../lib/copy";
import { balanceCopy } from "../../lib/economyCopy";
import { rethrowUnlessKnown } from "../../lib/failures";
import { headerCopy } from "../../lib/navigationCopy";
import { AccountControl } from "../account/AccountControl";
import { PageFrame } from "./PageFrame";
import { PageLink } from "./PageLink";
import { NAV_GROUP, NAV_LINK } from "./styles";
import { Wordmark } from "./Wordmark";

/**
 * The signed-in frame (navigation-and-landing.md §3.5 step 2, §5.1,
 * market-and-shop.md §5.1): the wordmark to `/packs`, the page links, the
 * balance and the Account control. Between a sign-out and the page
 * change it causes there is no account to show, so the frame keeps only the
 * wordmark for that moment.
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

  const { account } = game;
  return (
    <PageFrame
      header={
        // market-and-shop.md §5.1: on a phone the wordmark, then the balance and the Account control, then the
        // links; from 640 px the links share a row with them; from 1024 px everything is one row.
        <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Wordmark to="/packs" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
            {/* Last in the visual order on phone, its own full-width row; in the DOM it comes before the balance. */}
            <nav aria-label={headerCopy.navLabel} className={`${NAV_GROUP} order-last sm:order-none`}>
              <PageLink to="/packs" className={NAV_LINK}>
                {headerCopy.packs}
              </PageLink>
              <PageLink to="/shop" className={NAV_LINK}>
                {headerCopy.shop}
              </PageLink>
              <PageLink to="/collection" className={NAV_LINK}>
                {headerCopy.collection}{" "}
                {/* The count leaves the screen below 400 px and stays in the accessible name. */}
                <span className="sr-only min-[400px]:not-sr-only">({formatCount(game.cardCount)})</span>
              </PageLink>
            </nav>
            <div className="flex min-w-0 items-center gap-3">
              <Balance balance={game.balance} />
              <div className="ml-auto flex min-w-0 justify-end">
                <AccountControl
                  login={account.login}
                  disabled={game.state.opening || logoutMutation.isPending}
                  onLogout={() => void handleLogout()}
                />
              </div>
            </div>
          </div>
        </div>
      }
    >
      {children}
    </PageFrame>
  );
}

/**
 * The balance (market-and-shop.md §3.1, §6, §7): plain text, not live, no
 * icon; nothing at all before the server's first answer, so it reserves no
 * space. The status line of the action that changed it carries the change.
 */
function Balance({ balance }: { balance: number | null }) {
  if (balance === null) return null;
  return (
    <p className="text-sm whitespace-nowrap">
      <span className="font-medium text-zinc-100 tabular-nums">{formatCount(balance)}</span>{" "}
      <span className="text-zinc-400">{balanceCopy.name}</span>
    </p>
  );
}
