import type { AccountPublic } from "@anime-tcg/shared/api";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as api from "../lib/api";
import { openPack } from "../lib/api";
import { createQueryClient } from "../lib/queryClient";
import { makeAccount, mockFetch, type MockHandler } from "../test/api";
import { signedInRoutes, WALLET } from "../test/app";
import { makeWallet } from "../test/fixtures";
import { useGameState } from "./useGame";

// The real client, so only the one opening a test scripts rejects with something no api call can produce.
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return { ...actual, openPack: vi.fn(actual.openPack) };
});

const account = makeAccount();
const other = makeAccount({ id: "9a7b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", login: "Alex" });

function renderGame(routes: Record<string, MockHandler> = {}) {
  mockFetch({ ...signedInRoutes(account), ...routes });
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

/** The keys of the cached queries that name `accountId`: its packs, collection and wallet answers. */
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
        ["wallet", account.id, next],
      ]),
    );
    expect(cachedFor(queryClient, account.id)).toHaveLength(3);
  });

  it("an account switch removes the previous account's answers", async () => {
    const { rerender, queryClient } = await withAnswersCached();
    rerender({ signedIn: other });
    expect(cachedFor(queryClient, account.id)).toEqual([]);
  });
});

describe("useGameState: the balance a receipt carries against wallet reads (manager decision, 2026-10-30)", () => {
  /** Signs in with the first wallet read answered, then holds every later one until released. */
  async function withHeldWalletReads() {
    let release: (balance: number) => void = () => undefined;
    let reads = 0;
    const game = renderGame({
      [WALLET]: () => {
        reads += 1;
        if (reads === 1) return { status: 200, body: makeWallet(1_240) };
        return new Promise((resolve) => {
          release = (balance) => resolve({ status: 200, body: makeWallet(balance) });
        });
      },
    });
    await waitFor(() => expect(game.result.current!.balance).toBe(1_240));
    /** Releases the held read once its request has gone out. */
    const answer = async (balance: number) => {
      await waitFor(() => expect(reads).toBe(2));
      release(balance);
    };
    return { ...game, answer };
  }

  it("a receipt that arrives while a read is in flight is newer than that read", async () => {
    const { result, answer } = await withHeldWalletReads();
    let read!: Promise<unknown>;
    act(() => {
      read = result.current!.wallet.refetch();
    });
    act(() => result.current!.applyBalance(840));
    expect(result.current!.balance).toBe(840);
    await act(async () => {
      await answer(1_240);
      await read;
    });
    // The read has landed (a later seq than the first), and the receipt's balance still stands.
    await waitFor(() => expect(result.current!.wallet.data?.seq).toBeGreaterThan(1));
    expect(result.current!.balance).toBe(840);
  });

  it("a read sent after the receipt arrived replaces it", async () => {
    const { result, answer } = await withHeldWalletReads();
    act(() => result.current!.applyBalance(840));
    let read!: Promise<unknown>;
    act(() => {
      read = result.current!.wallet.refetch();
    });
    await act(async () => {
      await answer(900);
      await read;
    });
    await waitFor(() => expect(result.current!.wallet.data?.wallet.balance).toBe(900));
    expect(result.current!.balance).toBe(900);
  });

  it("a wallet answer clears the unreachable banner", async () => {
    const { shell } = await withHeldWalletReads();
    expect(shell.clearNotice).toHaveBeenCalled();
  });
});
