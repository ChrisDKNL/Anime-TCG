import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { publicPath, signInDestination } from "../lib/routes";

/**
 * Once the session names an account, a visitor on `/`, `/login` or
 * `/register` is replaced by the return path held in that page's history
 * state, or `/packs` (navigation-and-landing.md §3.3 step 6, §3.2 step 4).
 * It reads the location at the moment the session arrived, not when the
 * request left, so a log in that completes after the visitor moved on to
 * another public page still lands them in the game (§4.3). On any other page
 * (not-found) nothing moves: its header follows the session by itself.
 */
export function useSignedInNavigation(): () => void {
  const router = useRouter();
  return useCallback(() => {
    const { pathname, state } = router.state.location;
    if (publicPath(pathname) === null) return;
    void router.navigate({ to: signInDestination(state.returnTo), replace: true });
  }, [router]);
}
