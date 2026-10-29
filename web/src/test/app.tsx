import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import App from "../App";
import { createQueryClient } from "../lib/queryClient";
import { createAppRouter } from "../router";
import { makeAccount, mockFetch, type MockHandler } from "./api";
import { makeAniListResponse } from "./fixtures";

export const ANILIST = "POST https://graphql.anilist.co";

/**
 * Boots the whole app at `path` (a memory history) with the api and AniList
 * mocked at `fetch`; extra routes override the defaults. The router is the
 * app's own, so the guards, titles and focus rules are the real ones.
 */
export function renderApp(routes: Record<string, MockHandler>, account = makeAccount(), path = "/") {
  const fetchMock = mockFetch({
    [ANILIST]: { status: 200, body: makeAniListResponse(12) },
    "GET /api/session": { status: 200, body: { signedIn: true, account } },
    ...routes,
  });
  const queryClient = createQueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ queryClient, history });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>,
  );
  return { ...result, fetchMock, queryClient, router, history };
}

export const signedOutSession: MockHandler = { status: 200, body: { signedIn: false } };

/** The single app-level live region (the one with `aria-live`). */
export function liveRegion(): HTMLElement {
  const region = screen.getAllByRole("status").find((element) => element.hasAttribute("aria-live"));
  if (region === undefined) throw new Error("no live region rendered");
  return region;
}

/** The page's `h1`, once the router has rendered it. */
export function pageHeading(name: string) {
  return screen.findByRole("heading", { level: 1, name });
}
