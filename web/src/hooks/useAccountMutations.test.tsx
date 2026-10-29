import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import { envelope, makeAccount, mockFetch, noContent } from "../test/api";
import { SESSION_QUERY_KEY } from "./useAccountSession";
import {
  useChangePasswordMutation,
  useDeleteAccountMutation,
  useLoginMutation,
  useLogoutMutation,
  useRegisterMutation,
  useRenameMutation,
} from "./useAccountMutations";
import { ShellContext, type ShellContextValue } from "./useShell";

function harness() {
  const queryClient = createQueryClient();
  const shell: ShellContextValue = {
    announce: vi.fn(),
    sessionEnded: vi.fn(() => queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: false })),
    unreachable: vi.fn(),
    clearNotice: vi.fn(),
    notice: "none",
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ShellContext value={shell}>{children}</ShellContext>
    </QueryClientProvider>
  );
  return { queryClient, shell, wrapper };
}

describe("account mutations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("register and login write the signed-in answer into the session query", async () => {
    const account = makeAccount();
    mockFetch({
      "POST /api/accounts/register": { status: 201, body: { signedIn: true, account } },
      "POST /api/session/login": { status: 200, body: { signedIn: true, account } },
    });
    const h = harness();
    const reg = renderHook(() => useRegisterMutation(), h);
    await act(() =>
      reg.result.current.mutateAsync({ inviteCode: "c", login: "Chris", password: "longenough" }),
    );
    expect(h.queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ signedIn: true, account });

    h.queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: false });
    const log = renderHook(() => useLoginMutation(), h);
    await act(() => log.result.current.mutateAsync({ login: "Chris", password: "longenough" }));
    expect(h.queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ signedIn: true, account });
  });

  it("logout and delete sign the query out", async () => {
    mockFetch({ "POST /api/session/logout": noContent, "POST /api/account/delete": noContent });
    const h = harness();
    h.queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true, account: makeAccount() });
    const out = renderHook(() => useLogoutMutation(), h);
    await act(() => out.result.current.mutateAsync());
    expect(h.queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ signedIn: false });

    h.queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true, account: makeAccount() });
    const del = renderHook(() => useDeleteAccountMutation(), h);
    await act(() => del.result.current.mutateAsync({ password: "x" }));
    expect(h.queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ signedIn: false });
  });

  it("rename replaces the account in the session query", async () => {
    const account = makeAccount({ login: "Chris2" });
    mockFetch({ "PATCH /api/account/login": { status: 200, body: { account } } });
    const h = harness();
    h.queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true, account: makeAccount() });
    const { result } = renderHook(() => useRenameMutation(), h);
    await act(() => result.current.mutateAsync({ login: "Chris2" }));
    expect(h.queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ signedIn: true, account });
  });

  it("an unauthenticated answer from a signed-in route ends the session", async () => {
    mockFetch({
      "PATCH /api/account/login": envelope(401, "unauthenticated"),
      "POST /api/account/change-password": envelope(401, "unauthenticated"),
      "POST /api/account/delete": envelope(401, "unauthenticated"),
    });
    const h = harness();
    const rename = renderHook(() => useRenameMutation(), h);
    const change = renderHook(() => useChangePasswordMutation(), h);
    const del = renderHook(() => useDeleteAccountMutation(), h);
    await act(() => rename.result.current.mutateAsync({ login: "abc" }).catch(() => undefined));
    await act(() =>
      change.result.current
        .mutateAsync({ currentPassword: "a", newPassword: "longenough" })
        .catch(() => undefined),
    );
    await act(() => del.result.current.mutateAsync({ password: "a" }).catch(() => undefined));
    await waitFor(() => expect(h.shell.sessionEnded).toHaveBeenCalledTimes(3));
  });

  it("other failures leave the session alone", async () => {
    mockFetch({ "PATCH /api/account/login": envelope(409, "login_taken") });
    const h = harness();
    const { result } = renderHook(() => useRenameMutation(), h);
    await expect(result.current.mutateAsync({ login: "abc" })).rejects.toMatchObject({ code: "login_taken" });
    expect(h.shell.sessionEnded).not.toHaveBeenCalled();
  });
});
