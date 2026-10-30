import type { AccountPublic } from "@anime-tcg/shared/api";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
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
const other = makeAccount({ id: "9a7b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", login: "Alex" });

function renderGame() {
  mockFetch(signedInRoutes(account));
  const queryClient = createQueryClient();
  const shell = { announce: vi.fn(), sessionEnded: vi.fn(), unreachable: vi.fn(), clearNotice: vi.fn() };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const initialProps: { signedIn: AccountPublic | null } = { signedIn: account };
  const { result, rerender } = renderHook(
    ({ signedIn }) => useGameState({ account: signedIn, shell, packsShowing: () => true }),
    { wrapper, initialProps },
  );
  return { result, rerender, shell, queryClient };
}

/** The keys of the cached queries that name `accountId`: its packs and collection answers. */
function cachedFor(queryClient: QueryClient, accountId: string) {
  return queryClient
    .getQueryCache()
    .findAll({ predicate: (query) => query.queryKey[1] === accountId })
    .map((query) => query.queryKey);
}

/** Signs in `account`, with its collection and packs answered and cached. */
async function withAnswersCached() {
  const game = renderGame();
  await waitFor(() => expect(game.result.current!.collection.isSuccess).toBe(true));
  await act(() => game.queryClient.fetchQuery(game.result.current!.packsQuery));
  const session = game.result.current!.state.session;
  expect(cachedFor(game.queryClient, account.id)).toEqual(
    expect.arrayContaining([
      ["packs", account.id, session],
      ["collection", account.id, session],
    ]),
  );
  return { ...game, session };
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

describe("useGameState: a reset drops the previous session's answers from the cache", () => {
  it("log out (or a session end) removes them, and signing in again caches only the new session's", async () => {
    const { result, rerender, queryClient, session } = await withAnswersCached();

    rerender({ signedIn: null });
    expect(cachedFor(queryClient, account.id)).toEqual([]);

    rerender({ signedIn: account });
    await waitFor(() => expect(result.current!.collection.isSuccess).toBe(true));
    const next = result.current!.state.session;
    expect(next).toBeGreaterThan(session);
    expect(cachedFor(queryClient, account.id)).toEqual(
      expect.arrayContaining([
        ["packs", account.id, next],
        ["collection", account.id, next],
      ]),
    );
    expect(cachedFor(queryClient, account.id)).toHaveLength(2);
  });

  it("an account switch removes the previous account's answers", async () => {
    const { rerender, queryClient } = await withAnswersCached();
    rerender({ signedIn: other });
    expect(cachedFor(queryClient, account.id)).toEqual([]);
  });
});
