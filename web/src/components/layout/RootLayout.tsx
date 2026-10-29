import { Outlet, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { useAccountSession } from "../../hooks/useAccountSession";
import { usePool } from "../../hooks/useCharacterPool";
import { FrameContext, type Frame } from "../../hooks/useFrame";
import { GameContext, useGameState } from "../../hooks/useGame";
import { useSignedInNavigation } from "../../hooks/useSignedInNavigation";
import { ShellContext, useShell, type Notice } from "../../hooks/useShell";
import { toReturnPath } from "../../lib/routes";
import { LiveRegion } from "../LiveRegion";

/**
 * The root route's component (navigation-and-landing.md §3.9 item 1): mounted
 * once the session check has answered and never again, so the live region,
 * the app-level banner and the signed-in account's game state outlive every
 * page change. The pages' own frames (public or signed in) render inside the
 * outlet.
 */
export function RootLayout() {
  const { session, retry } = useAccountSession();
  const router = useRouter();
  const goSignedIn = useSignedInNavigation();

  // §3.5 step 8: the page that answered `unauthenticated` becomes the return path.
  const toLogin = useCallback(() => {
    const returnTo = toReturnPath(router.state.location.pathname);
    void router.navigate({ to: "/login", replace: true, state: returnTo === null ? {} : { returnTo } });
  }, [router]);
  const shell = useShell({ onSessionEnded: toLogin });

  const account = session.status === "signedIn" ? session.account : null;
  const game = useGameState(account, usePool());

  /** `Try again` repeats the session check; an answer that names a session leaves `/login` (§3.2 step 4). */
  const retryCheck = async () => {
    shell.context.clearNotice();
    const answer = await retry();
    if (answer?.signedIn === true) goSignedIn();
  };

  // The boot check failing and a later call failing show the same banner.
  const notice: Notice = session.status === "unreachable" ? "unreachable" : shell.state.notice;
  const frame: Frame = {
    notice,
    retrying: session.status === "unreachable" && session.retrying,
    onRetry: () => void retryCheck(),
  };

  return (
    <ShellContext value={shell.context}>
      <FrameContext value={frame}>
        <GameContext value={game}>
          <Outlet />
        </GameContext>
      </FrameContext>
      {/* Outside the pages, so every sign-in, sign-out and page change writes into the same node (accounts.md §7). */}
      <LiveRegion announcement={shell.state.announcement} />
    </ShellContext>
  );
}
