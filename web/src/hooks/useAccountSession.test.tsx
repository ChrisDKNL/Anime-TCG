import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import { envelope, makeAccount, mockFetch } from "../test/api";
import { useAccountSession, useSetSession } from "./useAccountSession";

function withClient() {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useAccountSession", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is loading, then signed out", async () => {
    mockFetch({ "GET /api/session": { status: 200, body: { signedIn: false } } });
    const { result } = renderHook(() => useAccountSession(), withClient());
    expect(result.current.session).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.session).toEqual({ status: "signedOut" }));
  });

  it("is signed in with the account the server returned", async () => {
    const account = makeAccount();
    mockFetch({ "GET /api/session": { status: 200, body: { signedIn: true, account } } });
    const { result } = renderHook(() => useAccountSession(), withClient());
    await waitFor(() => expect(result.current.session).toEqual({ status: "signedIn", account }));
  });

  it("is unreachable on no answer and recovers on retry", async () => {
    const fetchMock = mockFetch({ "GET /api/session": { status: 502, raw: "bad gateway" } });
    const { result } = renderHook(() => useAccountSession(), withClient());
    await waitFor(() => expect(result.current.session).toEqual({ status: "unreachable", retrying: false }));

    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ signedIn: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.session).toEqual({ status: "signedOut" }));
  });

  it("treats an api error envelope on the session check as unreachable too", async () => {
    mockFetch({ "GET /api/session": envelope(500, "internal") });
    const { result } = renderHook(() => useAccountSession(), withClient());
    await waitFor(() => expect(result.current.session.status).toBe("unreachable"));
  });

  it("useSetSession writes straight into the same query", async () => {
    mockFetch({ "GET /api/session": { status: 200, body: { signedIn: false } } });
    const account = makeAccount();
    const { result } = renderHook(
      () => ({ session: useAccountSession(), set: useSetSession() }),
      withClient(),
    );
    await waitFor(() => expect(result.current.session.session.status).toBe("signedOut"));
    act(() => result.current.set({ signedIn: true, account }));
    await waitFor(() => expect(result.current.session.session).toEqual({ status: "signedIn", account }));
  });
});
