import type { AccountPublic, CollectionResponse, PackOpened, ShopResponse } from "@anime-tcg/shared/api";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  getCollection,
  getPacks,
  getShop,
  getWallet,
  isApiError,
  NetworkError,
  openPack,
} from "../lib/api";
import {
  gameReducer,
  heldBalance,
  initialGame,
  nextGame,
  rateLimitWaitSeconds,
  type GameOwner,
  type GameState,
  type PacksAnswer,
  type Row,
  type WalletAnswer,
} from "../lib/game";
import type { ControlsAction } from "../lib/collectionView";
import { rethrowUnlessKnown } from "../lib/failures";
import { revealCopy } from "../lib/packsCopy";
import type { ShellActions } from "./useShell";
import { useSingleFlight } from "./useSingleFlight";

const SECOND_MS = 1000;

/**
 * Account-scoped answers are keyed by the account and the game session, so a
 * log out, a session end or an account switch never shows one account's
 * cached packs or cards to the next session.
 */
const packsKey = (owner: GameOwner | null) =>
  ["packs", owner?.accountId ?? null, owner?.session ?? 0] as const;
const collectionKey = (owner: GameOwner | null) =>
  ["collection", owner?.accountId ?? null, owner?.session ?? 0] as const;
const walletKey = (owner: GameOwner | null) =>
  ["wallet", owner?.accountId ?? null, owner?.session ?? 0] as const;
const shopKey = (owner: GameOwner | null) => ["shop", owner?.accountId ?? null, owner?.session ?? 0] as const;

function packsQueryOptions(owner: GameOwner | null, nextSeq: () => number, report: (err: unknown) => void) {
  return queryOptions({
    queryKey: packsKey(owner),
    queryFn: async (): Promise<PacksAnswer> => {
      const seq = nextSeq();
      try {
        const answer = await getPacks();
        return { seq, answer, receivedAt: performance.now() };
      } catch (err) {
        report(err);
        throw err;
      }
    },
  });
}

function collectionQueryOptions(owner: GameOwner | null, report: (err: unknown) => void) {
  return queryOptions({
    queryKey: collectionKey(owner),
    queryFn: async (): Promise<CollectionResponse> => {
      try {
        return await getCollection();
      } catch (err) {
        report(err);
        throw err;
      }
    },
  });
}

function walletQueryOptions(
  owner: GameOwner | null,
  nextSeq: () => number,
  report: (err: unknown) => void,
  answered: () => void,
) {
  return queryOptions({
    queryKey: walletKey(owner),
    queryFn: async (): Promise<WalletAnswer> => {
      // Numbered when sent: a receipt that arrives while this read is in flight is newer than it.
      const seq = nextSeq();
      try {
        const wallet = await getWallet();
        // The server answered: a banner a lost answer raised no longer holds (manager decision, 2026-10-30).
        answered();
        return { seq, wallet };
      } catch (err) {
        report(err);
        throw err;
      }
    },
  });
}

function shopQueryOptions(owner: GameOwner | null, report: (err: unknown) => void) {
  return queryOptions({
    queryKey: shopKey(owner),
    queryFn: async (): Promise<ShopResponse> => {
      try {
        return await getShop();
      } catch (err) {
        report(err);
        throw err;
      }
    },
  });
}

export type PacksQueryOptions = ReturnType<typeof packsQueryOptions>;
export type CollectionQueryOptions = ReturnType<typeof collectionQueryOptions>;
export type WalletQueryOptions = ReturnType<typeof walletQueryOptions>;
export type ShopQueryOptions = ReturnType<typeof shopQueryOptions>;

export interface Game {
  /** The signed-in account, as the session query last named it (a rename updates it here too). */
  account: AccountPublic;
  state: GameState;
  /** `Collection (<N>)`: the last collection answer's total, or the session's count before one (§9, question 4). */
  cardCount: number;
  /** For the packs page's own observer: it fetches each time the page is shown, and only then. */
  packsQuery: PacksQueryOptions;
  collectionQuery: CollectionQueryOptions;
  collection: UseQueryResult<CollectionResponse>;
  /** Fetched at sign-in; the Shop and Collection pages observe it too, so showing them reads it again. */
  walletQuery: WalletQueryOptions;
  wallet: UseQueryResult<WalletAnswer>;
  /** The balance the header shows: the newest the server sent, or null before the first (market-and-shop.md §3.1). */
  balance: number | null;
  /** For the Shop page's own observer: it fetches each time the page is shown, and only then. */
  shopQuery: ShopQueryOptions;
  /**
   * Applies the balance an answer carried (a receipt, `insufficient_funds`), numbered when it arrives:
   * it is newer than every wallet read sent before then, so a read in flight cannot step it back, and
   * older than every read sent after (manager decision, 2026-10-30).
   */
  applyBalance: (balance: number) => void;
  /**
   * Opens a pack; `row` is the control's row now, which a generic failure's line stays tied to.
   * Settles once the answer is applied, and rejects only on a bug in this client (not an api answer).
   */
  openPack: (row: Row) => Promise<void>;
  /** Changes the collection overview's controls (`state.overview`). */
  changeOverview: (action: ControlsAction) => void;
}

interface Options {
  account: AccountPublic | null;
  shell: ShellActions;
  /** Whether `/packs` is on screen: a reveal that lands on another page is not announced (§3.3 step 5). */
  packsShowing: () => boolean;
}

/** Numbers requests in the order they are sent, for the newest-answer-wins rule (packs-page.md §3.1 step 5). */
function requestCounter(): () => number {
  let sent = 0;
  return () => (sent += 1);
}

function newCards(pack: PackOpened): number {
  return pack.cards.filter((card) => card.isNew).length;
}

/**
 * The signed-in account's game, held by the root layout so it survives every
 * page change, the not-found page included (navigation-and-landing.md §3.10).
 * A different account (or none) resets it during render, the way a keyed
 * remount would, without remounting the pages around it. The layout fetches
 * the collection at sign-in and after every opening answer; the packs page
 * fetches the allowance itself. An answer that lands after its session ended
 * changes nothing.
 */
export function useGameState({ account, shell, packsShowing }: Options): Game | null {
  const accountId = account?.id ?? null;
  const [stored, dispatch] = useReducer(gameReducer, accountId, initialGame);
  if (stored.accountId !== accountId) dispatch({ type: "reset", accountId });
  const state = stored.accountId === accountId ? stored : nextGame(stored, accountId);
  const { session, key } = state;
  const owner = useMemo(() => (accountId === null ? null : { accountId, session }), [accountId, session]);

  const queryClient = useQueryClient();
  const [nextSeq] = useState(requestCounter);
  const current = useRef(owner);
  useEffect(() => {
    const previous = current.current;
    current.current = owner;
    if (previous === owner) return;
    // A reset leaves nothing of the previous session's answers in the cache, not even until `gcTime`.
    queryClient.removeQueries({ queryKey: packsKey(previous), exact: true });
    queryClient.removeQueries({ queryKey: collectionKey(previous), exact: true });
    queryClient.removeQueries({ queryKey: walletKey(previous), exact: true });
    queryClient.removeQueries({ queryKey: shopKey(previous), exact: true });
  }, [owner, queryClient]);
  const isCurrent = useCallback(
    (of: GameOwner) => current.current?.accountId === of.accountId && current.current.session === of.session,
    [],
  );

  const { sessionEnded, unreachable, announce, clearNotice } = shell;
  /** A read that failed: an ended session goes to `/login`, no answer shows the banner, anything else is the page's to show. */
  const report = useCallback(
    (err: unknown) => {
      if (isApiError(err, "unauthenticated")) sessionEnded();
      else if (err instanceof NetworkError) unreachable();
    },
    [sessionEnded, unreachable],
  );

  const packsQuery = useMemo(() => packsQueryOptions(owner, nextSeq, report), [owner, nextSeq, report]);
  const collectionQuery = useMemo(() => collectionQueryOptions(owner, report), [owner, report]);
  const walletQuery = useMemo(
    () => walletQueryOptions(owner, nextSeq, report, clearNotice),
    [owner, nextSeq, report, clearNotice],
  );
  const shopQuery = useMemo(() => shopQueryOptions(owner, report), [owner, report]);
  // Observed here but never fetched from here: the held answer stays in the cache for the whole
  // session, so returning to `/packs` shows it at once (§3.1 step 2) while the page's observer refetches.
  useQuery({ ...packsQuery, enabled: false });
  const collection = useQuery({ ...collectionQuery, enabled: owner !== null });
  const wallet = useQuery({ ...walletQuery, enabled: owner !== null });

  const { mutateAsync } = useMutation({ mutationFn: openPack });
  const singleFlight = useSingleFlight();

  const settleFailure = useCallback(
    (err: unknown, of: GameOwner, seq: number, row: Row) => {
      if (err instanceof NetworkError) {
        dispatch({ type: "noAnswer", ...of });
        unreachable();
        return;
      }
      if (!(err instanceof ApiError)) {
        // A bug in this client, not an answer: the generic failure, so the button never stays on
        // `Opening…`, and the error is rethrown so a test or the console sees it.
        dispatch({ type: "failed", ...of, row });
        throw err;
      }
      switch (err.code) {
        case "unauthenticated":
          sessionEnded();
          return;
        case "no_pack_available":
          dispatch({
            type: "noneLeft",
            ...of,
            seq,
            receivedAt: performance.now(),
            retryAfterSeconds: err.retryAfterSeconds ?? null,
          });
          // Another tab or device spent the packs: one `GET` corrects the allowance, and the collection changed.
          void queryClient.refetchQueries({ queryKey: packsKey(of) });
          void queryClient.refetchQueries({ queryKey: collectionKey(of) });
          return;
        case "pool_unavailable":
          dispatch({ type: "unavailable", ...of, seq });
          return;
        case "rate_limited": {
          const seconds = rateLimitWaitSeconds(err.retryAfterSeconds);
          dispatch({ type: "rateLimited", ...of, until: performance.now() + seconds * SECOND_MS });
          return;
        }
        default:
          dispatch({ type: "failed", ...of, row });
      }
    },
    [queryClient, sessionEnded, unreachable],
  );

  const open = useCallback(
    async (row: Row) => {
      if (owner === null) return;
      await singleFlight(async () => {
        // A key held from an opening that got no answer is sent again, so the retry shows that pack.
        const requestId = key ?? crypto.randomUUID();
        dispatch({ type: "openStarted", ...owner, key: requestId });
        const seq = nextSeq();
        try {
          const pack = await mutateAsync({ requestId });
          dispatch({ type: "opened", ...owner, seq, receivedAt: performance.now(), pack });
          if (!isCurrent(owner)) return;
          // The server answered: a banner a lost answer raised no longer holds (packs-page.md §4.1).
          clearNotice();
          if (packsShowing()) {
            announce(
              revealCopy.announce(
                pack.packKind,
                pack.cards.map((card) => card.rarity),
                newCards(pack),
              ),
            );
          }
          void queryClient.refetchQueries({ queryKey: collectionKey(owner) });
        } catch (err) {
          if (isCurrent(owner)) settleFailure(err, owner, seq, row);
          else rethrowUnlessKnown(err);
        }
      });
    },
    [
      owner,
      singleFlight,
      key,
      nextSeq,
      mutateAsync,
      isCurrent,
      packsShowing,
      clearNotice,
      announce,
      queryClient,
      settleFailure,
    ],
  );

  const changeOverview = useCallback(
    (action: ControlsAction) => {
      if (owner !== null) dispatch({ type: "overview", ...owner, action });
    },
    [owner],
  );

  const applyBalance = useCallback(
    (value: number) => {
      if (owner !== null) dispatch({ type: "balance", ...owner, balance: { seq: nextSeq(), value } });
    },
    [nextSeq, owner],
  );

  const cardCount = collection.data?.totals.cards ?? account?.cards ?? 0;
  const balance = heldBalance(wallet.data, state);
  return useMemo(
    () =>
      account === null
        ? null
        : {
            account,
            state,
            cardCount,
            packsQuery,
            collectionQuery,
            collection,
            walletQuery,
            wallet,
            balance,
            shopQuery,
            applyBalance,
            openPack: open,
            changeOverview,
          },
    [
      account,
      state,
      cardCount,
      packsQuery,
      collectionQuery,
      collection,
      walletQuery,
      wallet,
      balance,
      shopQuery,
      applyBalance,
      open,
      changeOverview,
    ],
  );
}

export const GameContext = createContext<Game | null>(null);

/** The game of the signed-in account; only account pages call it, and they render only with a session. */
export function useGame(): Game {
  const game = useContext(GameContext);
  if (game === null) throw new Error("useGame needs a signed-in GameContext");
  return game;
}

/** The game when someone is signed in, or null: for the parts that render either way (the not-found page). */
export function useOptionalGame(): Game | null {
  return useContext(GameContext);
}
