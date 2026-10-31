import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { useAccountSession } from "../../hooks/useAccountSession";
import { DEMO_FACTS_KEY, DemoVisitContext, useDemoVisitStore } from "../../hooks/useDemoVisit";
import { FrameContext, type Frame } from "../../hooks/useFrame";
import { GameContext, useGameState } from "../../hooks/useGame";
import { NavigatedContext } from "../../hooks/usePageEnter";
import { useSignedInNavigation } from "../../hooks/useSignedInNavigation";
import { ShellContext, useShell, type Notice } from "../../hooks/useShell";
import { returnPathFor } from "../../lib/routes";
import { LiveRegion } from "../LiveRegion";

/**
 * The root route's component (navigation-and-landing.md §3.9 item 1): mounted
 * once the session check has answered and never again, so the live region,
 * the app-level banner and the signed-in account's game state outlive every
 * page change. The pages' own frames (public or signed in) render inside the
 * outlet. The demo's visit lives here too, so its count, wait and cards last
 * for the page load.
 */
export function RootLayout() {
  const { session, retry } = useAccountSession();
  const router = useRouter();
  const goSignedIn = useSignedInNavigation();
  const queryClient = useQueryClient();

  // §3.5 step 8: the page that answered `unauthenticated` becomes the return path, an opening page's section page.
  const toLogin = useCallback(() => {
    const returnTo = returnPathFor(router.state.location.pathname);
    void router.navigate({ to: "/login", replace: true, state: returnTo === null ? {} : { returnTo } });
  }, [router]);
  const shell = useShell({ onSessionEnded: toLogin });

  const account = session.status === "signedIn" ? session.account : null;
  // The location being shown or navigated to: an answer can land before the page it opened has mounted.
  const openingShowing = useCallback(() => router.latestLocation.pathname === "/packs/open", [router]);
  const leaveOpening = useCallback(() => void router.navigate({ to: "/packs", replace: true }), [router]);
  const game = useGameState({ account, shell: shell.context, openingShowing, leaveOpening });
  const demoShowing = useCallback(() => router.latestLocation.pathname === "/demo", [router]);
  const demoVisit = useDemoVisitStore({ signedIn: account !== null, shell: shell.context, demoShowing });
  // The router sets the resolved location after a page has rendered, so while the first page of a load
  // renders it is unset, and while a later one renders it is the page being left.
  const navigated = useCallback(() => router.state.resolvedLocation !== undefined, [router]);

  /**
   * `Try again` repeats the session check; an answer that names a session leaves `/login` (§3.2 step 4).
   * On the landing page it asks for the pool facts again too, which the banner may have stood for (§4.5).
   */
  const retryCheck = async () => {
    shell.context.clearNotice();
    void queryClient.refetchQueries({ queryKey: DEMO_FACTS_KEY, type: "active" });
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
          <DemoVisitContext value={demoVisit}>
            <NavigatedContext value={navigated}>
              <Outlet />
            </NavigatedContext>
          </DemoVisitContext>
        </GameContext>
      </FrameContext>
      {/* Outside the pages, so every sign-in, sign-out and page change writes into the same node (accounts.md §7). */}
      <LiveRegion announcement={shell.state.announcement} />
    </ShellContext>
  );
}
