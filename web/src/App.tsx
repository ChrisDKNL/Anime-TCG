import { RouterProvider } from "@tanstack/react-router";
import { BootFrame } from "./components/layout/BootFrame";
import { useAccountSession } from "./hooks/useAccountSession";
import { useDelayedFlag } from "./hooks/useDelayedFlag";
import type { AppRouter } from "./router";

/** `Loading…` only appears when the session check takes longer than this (accounts.md §4.1). */
const LOADING_DELAY_MS = 300;

/**
 * Boot (navigation-and-landing.md §3.2): the session check runs first,
 * whatever the path, and the router starts only once it has answered, so its
 * guards decide every page from that answer and no page (the landing page
 * included) renders before it. An unreachable server counts as signed out.
 */
export default function App({ router }: { router: AppRouter }) {
  const { session } = useAccountSession();
  const showLoading = useDelayedFlag(session.status === "loading", LOADING_DELAY_MS);

  if (session.status === "loading") return <BootFrame showLoading={showLoading} />;
  return <RouterProvider router={router} />;
}
