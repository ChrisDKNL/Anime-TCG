import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import App from "../App";
import { createQueryClient } from "../lib/queryClient";
import { makeAccount, mockFetch, type MockHandler } from "./api";
import { makeAniListResponse } from "./fixtures";

export const ANILIST = "POST https://graphql.anilist.co";

/** Boots the whole app with the api and AniList mocked at `fetch`; extra routes override the defaults. */
export function renderApp(routes: Record<string, MockHandler>, account = makeAccount()) {
  const fetchMock = mockFetch({
    [ANILIST]: { status: 200, body: makeAniListResponse(12) },
    "GET /api/session": { status: 200, body: { signedIn: true, account } },
    ...routes,
  });
  const queryClient = createQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  return { ...result, fetchMock, queryClient };
}

export const signedOutSession: MockHandler = { status: 200, body: { signedIn: false } };

/** The single app-level live region (the one with `aria-live`). */
export function liveRegion(): HTMLElement {
  const region = screen.getAllByRole("status").find((element) => element.hasAttribute("aria-live"));
  if (region === undefined) throw new Error("no live region rendered");
  return region;
}
