import type {
  AccountPublic,
  CollectionResponse,
  ListingsPage,
  ListingsQuery,
  MarketMine,
  PackOpened,
  ShopResponse,
} from "@anime-tcg/shared/api";
import {
  infiniteQueryOptions,
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
  getListings,
  getMarketMine,
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
  type ShopPack,
  type WalletAnswer,
} from "../lib/game";
import type { ControlsAction } from "../lib/collectionView";
import type { MarketAction } from "../lib/market";
import { rethrowUnlessKnown } from "../lib/failures";
import { packControlCopy, revealCopy } from "../lib/packsCopy";
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
/** The market's reads, the listings pages and `mine`, under one prefix so an action can mark them all stale. */
const marketKey = (owner: GameOwner | null) =>
  ["market", owner?.accountId ?? null, owner?.session ?? 0] as const;

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

function marketMineQueryOptions(owner: GameOwner | null, report: (err: unknown) => void) {
  return queryOptions({
    queryKey: [...marketKey(owner), "mine"] as const,
    queryFn: async (): Promise<MarketMine> => {
      try {
        return await getMarketMine();
      } catch (err) {
        report(err);
        throw err;
      }
    },
  });
}

/**
 * The browse list for one set of parameters (market-and-shop.md §3.4): keyset pages through the
 * server's `nextCursor`. A change of parameters is a new query, and the old one's request is aborted
 * once nothing observes it, so an answer to older parameters never shows (§3.4 step 4).
 */
function listingsQueryOptions(
  owner: GameOwner | null,
  report: (err: unknown) => void,
  params: ListingsQuery,
) {
  return infiniteQueryOptions({
    queryKey: [...marketKey(owner), "listings", params] as const,
    queryFn: async ({ pageParam, signal }): Promise<ListingsPage> => {
      try {
        return await getListings(pageParam === null ? params : { ...params, cursor: pageParam }, signal);
      } catch (err) {
        report(err);
        throw err;
      }
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last: ListingsPage) => last.nextCursor,
  });
}

export type PacksQueryOptions = ReturnType<typeof packsQueryOptions>;
export type CollectionQueryOptions = ReturnType<typeof collectionQueryOptions>;
export type WalletQueryOptions = ReturnType<typeof walletQueryOptions>;
export type ShopQueryOptions = ReturnType<typeof shopQueryOptions>;
export type MarketMineQueryOptions = ReturnType<typeof marketMineQueryOptions>;
export type ListingsQueryOptions = ReturnType<typeof listingsQueryOptions>;

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
   * Opens a pack; `row` is the control's row now, which a generic failure's line stays tied to, and
   * `from` the page it was opened on: from `/packs` the previous cards go at once, from `/packs/open`
   * they stay until the answer (packs-page.md §3.3 step 2). Settles once the answer is applied, and
   * rejects only on a bug in this client (not an api answer).
   */
  openPack: (row: Row, from: OpenedFrom) => Promise<void>;
  /**
   * Holds the pack a purchase dealt, for `/shop/open`, until the next purchase (market-and-shop.md §3.3
   * step 6); `landedShowing` is whether `/shop` still showed its confirmation, so that the page change
   * to `/shop/open` follows and the cards enter there.
   */
  holdShopPack: (pack: ShopPack, landedShowing: boolean) => void;
  /**
   * The shop packs `/shop/open` has already shown: the purchase pushes that page with its pack already
   * held, so only this tells its first showing, which runs the entrance, from a return to it.
   */
  shownShopPacks: WeakSet<ShopPack>;
  /** The free packs `/packs/open` has already shown, for the same reason: Back and Forward show them without the entrance. */
  shownReveals: WeakSet<PackOpened>;
  /** Changes the collection overview's controls (`state.overview`). */
  changeOverview: (action: ControlsAction) => void;
  /** The prefix of every market read of this session: an action that changes the market marks them stale. */
  marketKey: readonly unknown[];
  /** For the My listings view's own observer: it fetches each time the view is shown. */
  marketMineQuery: MarketMineQueryOptions;
  /** The Browse view's pages for a set of parameters. */
  listingsQuery: (params: ListingsQuery) => ListingsQueryOptions;
  /** Changes the market's controls (`state.market`). */
  changeMarket: (action: MarketAction) => void;
}

export type OpenedFrom = "packs" | "opening";

interface Options {
  account: AccountPublic | null;
  shell: ShellActions;
  /**
   * Whether `/packs/open` is on screen or being navigated to: a reveal that lands on another page is
   * neither announced nor entered (§3.3 step 5).
   */
  openingShowing: () => boolean;
  /** Replaces `/packs/open` with `/packs`, after an answer without cards (packs-page.md §3.7 step 6). */
  leaveOpening: () => void;
}

/** The line under the pack button that an answer without cards leaves, as the live region reads it after the replace. */
const NO_CARDS_LINE = {
  noneLeft: packControlCopy.noneLeft,
  unavailable: packControlCopy.unavailable,
  wait: packControlCopy.wait,
  failed: packControlCopy.failed,
  noAnswer: packControlCopy.noAnswer,
} as const;

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
export function useGameState({ account, shell, openingShowing, leaveOpening }: Options): Game | null {
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
    queryClient.removeQueries({ queryKey: marketKey(previous) });
  }, [owner, queryClient]);
  const isCurrent = useCallback(
    (of: GameOwner) => current.current?.accountId === of.accountId && current.current.session === of.session,
    [],
  );

  const { sessionEnded, unreachable, announce, clearNotice, serverAnswered } = shell;
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
    () => walletQueryOptions(owner, nextSeq, report, serverAnswered),
    [owner, nextSeq, report, serverAnswered],
  );
  const shopQuery = useMemo(() => shopQueryOptions(owner, report), [owner, report]);
  const marketMineQuery = useMemo(() => marketMineQueryOptions(owner, report), [owner, report]);
  const listingsQuery = useCallback(
    (params: ListingsQuery) => listingsQueryOptions(owner, report, params),
    [owner, report],
  );
  const marketPrefix = useMemo(() => marketKey(owner), [owner]);
  // Observed here but never fetched from here: the held answer stays in the cache for the whole
  // session, so returning to `/packs` shows it at once (§3.1 step 2) while the page's observer refetches.
  useQuery({ ...packsQuery, enabled: false });
  const collection = useQuery({ ...collectionQuery, enabled: owner !== null });
  const wallet = useQuery({ ...walletQuery, enabled: owner !== null });

  const { mutateAsync } = useMutation({ mutationFn: openPack });
  const singleFlight = useSingleFlight();

  /** Applies an answer without cards; returns the line it leaves under the button, or null (401). */
  const settleFailure = useCallback(
    (err: unknown, of: GameOwner, seq: number, row: Row): keyof typeof NO_CARDS_LINE | null => {
      if (err instanceof NetworkError) {
        dispatch({ type: "noAnswer", ...of });
        unreachable();
        return "noAnswer";
      }
      if (!(err instanceof ApiError)) {
        // A bug in this client, not an answer: the generic failure, so the button never stays on
        // `Opening…`; the caller rethrows the error so a test or the console sees it.
        dispatch({ type: "failed", ...of, row });
        return "failed";
      }
      switch (err.code) {
        case "unauthenticated":
          sessionEnded();
          return null;
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
          return "noneLeft";
        case "pool_unavailable":
          dispatch({ type: "unavailable", ...of, seq });
          return "unavailable";
        case "rate_limited": {
          const seconds = rateLimitWaitSeconds(err.retryAfterSeconds);
          dispatch({ type: "rateLimited", ...of, until: performance.now() + seconds * SECOND_MS });
          return "wait";
        }
        default:
          dispatch({ type: "failed", ...of, row });
          return "failed";
      }
    },
    [queryClient, sessionEnded, unreachable],
  );

  /**
   * An answer without cards while `/packs/open` shows: `/packs` replaces it and shows the answer's row,
   * and its line is read once, since a status line already there when a page renders is not reliably
   * read (packs-page.md §3.7 step 6). On any other page nothing moves (§3.3 step 5).
   */
  const leaveWithLine = useCallback(
    (line: keyof typeof NO_CARDS_LINE) => {
      if (!openingShowing()) return;
      leaveOpening();
      announce(NO_CARDS_LINE[line]);
    },
    [openingShowing, leaveOpening, announce],
  );

  const open = useCallback(
    async (row: Row, from: OpenedFrom) => {
      if (owner === null) return;
      await singleFlight(async () => {
        // A key held from an opening that got no answer is sent again, so the retry shows that pack.
        const requestId = key ?? crypto.randomUUID();
        dispatch({ type: "openStarted", ...owner, key: requestId, keepReveal: from === "opening" });
        const seq = nextSeq();
        try {
          const pack = await mutateAsync({ requestId });
          const landedShowing = openingShowing();
          dispatch({ type: "opened", ...owner, seq, receivedAt: performance.now(), pack, landedShowing });
          if (!isCurrent(owner)) return;
          // The server answered: a banner a lost answer raised no longer holds (packs-page.md §4.1).
          clearNotice();
          if (landedShowing) {
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
          if (!isCurrent(owner)) {
            rethrowUnlessKnown(err);
            return;
          }
          const line = settleFailure(err, owner, seq, row);
          if (line !== null) leaveWithLine(line);
          rethrowUnlessKnown(err);
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
      openingShowing,
      clearNotice,
      announce,
      queryClient,
      settleFailure,
      leaveWithLine,
    ],
  );

  const holdShopPack = useCallback(
    (pack: ShopPack, landedShowing: boolean) => {
      if (owner !== null) dispatch({ type: "shopBought", ...owner, pack, landedShowing });
    },
    [owner],
  );
  const [shownShopPacks] = useState(() => new WeakSet<ShopPack>());
  const [shownReveals] = useState(() => new WeakSet<PackOpened>());

  const changeOverview = useCallback(
    (action: ControlsAction) => {
      if (owner !== null) dispatch({ type: "overview", ...owner, action });
    },
    [owner],
  );

  const changeMarket = useCallback(
    (action: MarketAction) => {
      if (owner !== null) dispatch({ type: "market", ...owner, action });
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
            holdShopPack,
            shownShopPacks,
            shownReveals,
            changeOverview,
            marketKey: marketPrefix,
            marketMineQuery,
            listingsQuery,
            changeMarket,
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
      holdShopPack,
      shownShopPacks,
      shownReveals,
      changeOverview,
      marketPrefix,
      marketMineQuery,
      listingsQuery,
      changeMarket,
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
