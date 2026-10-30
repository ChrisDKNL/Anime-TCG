import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as api from "../lib/api";
import { openPack } from "../lib/api";
import { createQueryClient } from "../lib/queryClient";
import { makeAccount, mockFetch } from "../test/api";
import { signedInRoutes } from "../test/app";
import { useGameState } from "./useGame";

// The real client, so only the one opening a test scripts rejects with something no api call can produce.
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return { ...actual, openPack: vi.fn(actual.openPack) };
});

const account = makeAccount();

function renderGame() {
  mockFetch(signedInRoutes(account));
  const queryClient = createQueryClient();
  const shell = { announce: vi.fn(), sessionEnded: vi.fn(), unreachable: vi.fn(), clearNotice: vi.fn() };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useGameState({ account, shell, packsShowing: () => true }), {
    wrapper,
  });
  return { result, shell };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useGameState: an opening that rejects with a client bug", () => {
  it("settles on the generic failure, never stays opening, and the error reaches the caller", async () => {
    const bug = new TypeError("a bug in this client");
    vi.mocked(openPack).mockRejectedValueOnce(bug);
    const { result, shell } = renderGame();

    await act(async () => {
      await expect(result.current!.openPack("ready")).rejects.toBe(bug);
    });
    await waitFor(() => expect(result.current!.state.opening).toBe(false));
    expect(result.current!.state.line).toEqual({ kind: "failed", row: "ready" });
    expect(result.current!.state.key).toBeNull();
    expect(shell.unreachable).not.toHaveBeenCalled();
    expect(shell.sessionEnded).not.toHaveBeenCalled();

    // The next activation opens a pack as usual.
    await act(() => result.current!.openPack("ready"));
    expect(result.current!.state.reveal).not.toBeNull();
    expect(result.current!.state.line).toBeNull();
  });
});
