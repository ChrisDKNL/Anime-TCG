import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createQueryClient } from "../lib/queryClient";
import { TestShell } from "./TestShell";

/**
 * Renders a component that holds links under a minimal router at `path`, with
 * the query client and test shell around it. Every path renders `ui`, so a
 * link click changes the location without unmounting what is under test.
 * The router renders after a tick: query with `findBy…`.
 */
export function renderInRouter(ui: ReactElement, path = "/") {
  const queryClient = createQueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <TestShell>
          {ui}
          <Outlet />
        </TestShell>
      </QueryClientProvider>
    ),
  });
  const splat = createRoute({ getParentRoute: () => rootRoute, path: "$" });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree: rootRoute.addChildren([splat]), history });
  const result = render(<RouterProvider router={router} />);
  return { ...result, router, history, queryClient };
}
