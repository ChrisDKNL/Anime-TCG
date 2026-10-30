import type { QueryClient } from "@tanstack/react-query";
import {
  createBrowserHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { PublicLayout } from "./components/layout/PublicLayout";
import { RootLayout } from "./components/layout/RootLayout";
import { SignedInLayout } from "./components/layout/SignedInLayout";
import { isSignedIn } from "./hooks/useAccountSession";
import { focusPageHeading } from "./lib/pageFocus";
import {
  HOME_PATH,
  OPENING_PAGES,
  pageTitle,
  returnPathFor,
  withoutTrailingSlash,
  type OpeningPath,
} from "./lib/routes";
import { AccountPage } from "./pages/AccountPage";
import { CollectionPage } from "./pages/CollectionPage";
import { DemoPage } from "./pages/DemoPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PackOpeningPage } from "./pages/PackOpeningPage";
import { PacksPage } from "./pages/PacksPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RegisterPage } from "./pages/RegisterPage";
import { ShopOpenPage } from "./pages/ShopOpenPage";
import { ShopPage } from "./pages/ShopPage";

/**
 * The route tree (ADR 0012: TanStack Router, code-based, no generated files),
 * built from the route list in lib/routes.ts; router.test.tsx checks the two
 * hold the same paths. The guards read the session query the boot check
 * filled, so the router and the data layer share one answer.
 */

interface RouterContext {
  queryClient: QueryClient;
  /** True until the router has resolved its first location: a redirect then is part of the load (§3.2 step 3). */
  booting: () => boolean;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: RootLayout });

/** `/`, `/demo`, `/login`, `/register`: a signed-in visitor is replaced to `/packs`, return path or not (§3.3 step 7). */
const publicLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "public",
  beforeLoad: ({ context }) => {
    if (isSignedIn(context.queryClient)) redirect({ to: HOME_PATH, replace: true, throw: true });
  },
  component: () => (
    <PublicLayout>
      <Outlet />
    </PublicLayout>
  ),
});

/**
 * The guard (§3.3): a signed-out visitor is replaced by `/login`, the page
 * they asked for in that entry's history state, checked against the route
 * list before it is written. The address bar reads `/login` and nothing else.
 */
const accountLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "account",
  beforeLoad: ({ context, location }) => {
    if (isSignedIn(context.queryClient)) return;
    // An opening page's return path is its section page (§3.13 step 7).
    const returnTo = returnPathFor(location.pathname);
    redirect({ to: "/login", replace: true, state: returnTo === null ? {} : { returnTo }, throw: true });
  },
  component: () => (
    <SignedInLayout>
      <Outlet />
    </SignedInLayout>
  ),
});

/**
 * An opening page (§3.13). A load or a reload holds nothing, so it is replaced
 * by its section page there and then, as a boot replace: no focus move and
 * nothing announced (step 3). Later, the page itself replaces when it holds
 * nothing, which is a page change like any other.
 */
function replaceOnLoad(path: OpeningPath) {
  return ({ context }: { context: RouterContext }) => {
    if (context.booting()) redirect({ to: OPENING_PAGES[path].section, replace: true, throw: true });
  };
}

const routeTree = rootRoute.addChildren([
  publicLayout.addChildren([
    createRoute({ getParentRoute: () => publicLayout, path: "/", component: LandingPage }),
    createRoute({ getParentRoute: () => publicLayout, path: "/demo", component: DemoPage }),
    createRoute({ getParentRoute: () => publicLayout, path: "/login", component: LoginPage }),
    createRoute({ getParentRoute: () => publicLayout, path: "/register", component: RegisterPage }),
  ]),
  accountLayout.addChildren([
    createRoute({ getParentRoute: () => accountLayout, path: "/packs", component: PacksPage }),
    createRoute({
      getParentRoute: () => accountLayout,
      path: "/packs/open",
      beforeLoad: replaceOnLoad("/packs/open"),
      component: PackOpeningPage,
    }),
    createRoute({ getParentRoute: () => accountLayout, path: "/shop", component: ShopPage }),
    createRoute({
      getParentRoute: () => accountLayout,
      path: "/shop/open",
      beforeLoad: replaceOnLoad("/shop/open"),
      component: ShopOpenPage,
    }),
    createRoute({ getParentRoute: () => accountLayout, path: "/collection", component: CollectionPage }),
    createRoute({ getParentRoute: () => accountLayout, path: "/profile", component: ProfilePage }),
    createRoute({ getParentRoute: () => accountLayout, path: "/account", component: AccountPage }),
  ]),
  // Everything else, `/market` included until its PR (§3.1 rule 1).
  createRoute({ getParentRoute: () => rootRoute, path: "$", component: NotFoundPage }),
]);

interface Options {
  queryClient: QueryClient;
  /** The browser's history in the app; a memory history in tests. */
  history?: RouterHistory;
}

export function createAppRouter({ queryClient, history = createBrowserHistory() }: Options) {
  // §3.1 rule 2 at load, the only way a trailing slash arrives: the app never builds one. The router
  // matches `/packs/` to `/packs` and treats a redirect between them as the same location, so the
  // address is fixed before it starts; this replace is part of the first render (§3.2 step 3).
  const canonical = withoutTrailingSlash(history.location.pathname);
  if (canonical !== null) history.replace(canonical, history.location.state);

  const router = createRouter({
    routeTree,
    history,
    context: { queryClient, booting: () => router.state.resolvedLocation === undefined },
    // `/Packs` is not `/packs` (§3.1 rule 2).
    caseSensitive: true,
    // §3.11: the top on a new page, the entry's own position on Back and Forward, without smooth scrolling.
    scrollRestoration: true,
    scrollRestorationBehavior: "instant",
    // The entry's key, never its href: a query string from a link must not end up in session storage.
    getScrollRestorationKey: (location) => location.state.__TSR_key ?? location.pathname,
  });
  router.subscribe("onRendered", ({ fromLocation }) => {
    // From the route that rendered, not the address, so the title always names the page on screen. It
    // comes first, so a screen reader that reads it on the focus change reads the new one (§7 "Titles").
    const rendered: unknown = router.state.matches.at(-1)?.fullPath;
    document.title = pageTitle(typeof rendered === "string" ? rendered : "");
    // The first render of a load (a boot replace included) leaves focus where the browser put it (§3.6 step 2).
    if (fromLocation !== undefined) focusPageHeading({ preventScroll: true });
  });
  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
  interface HistoryState {
    /**
     * The guard's return path (§3.3 step 2). Typed `unknown` on purpose: an
     * entry's state can come from an older build or any script on this
     * origin, so it is only ever read through `toReturnPath`.
     */
    returnTo?: unknown;
  }
}
