import type { Listing, ListingsPage, PurchaseReceipt } from "@anime-tcg/shared/api";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { buyListing, cancelListing, isApiError } from "../lib/api";
import { failureOutcome, type Outcome } from "../lib/keyedAction";
import { blocksEveryListing, limitBlock, withoutListing, type LimitBlock } from "../lib/market";
import { useGame } from "./useGame";
import { useKeyedAction, type KeyedAction, type RateLimitWait } from "./useKeyedAction";
import { useShellContext } from "./useShell";

/** The market's reads after an action: the listing leaves every browse page held, and the rest is read again. */
function useMarketRefresh() {
  const { marketKey, collectionQuery, walletQuery } = useGame();
  const queryClient = useQueryClient();
  return {
    /** The listing sold, was bought here or is gone: no held page shows it any more (§3.5 step 4). */
    drop: useCallback(
      (listingId: string) =>
        queryClient.setQueriesData<InfiniteData<ListingsPage>>(
          { queryKey: [...marketKey, "listings"] },
          (data) => (data === undefined ? data : { ...data, pages: withoutListing(data.pages, listingId) }),
        ),
      [queryClient, marketKey],
    ),
    mine: useCallback(
      () => void queryClient.invalidateQueries({ queryKey: [...marketKey, "mine"] }),
      [queryClient, marketKey],
    ),
    listings: useCallback(
      () => void queryClient.invalidateQueries({ queryKey: [...marketKey, "listings"] }),
      [queryClient, marketKey],
    ),
    collection: useCallback(
      () => void queryClient.invalidateQueries({ queryKey: collectionQuery.queryKey }),
      [queryClient, collectionQuery.queryKey],
    ),
    wallet: useCallback(
      () => void queryClient.refetchQueries({ queryKey: walletQuery.queryKey }),
      [queryClient, walletQuery.queryKey],
    ),
  };
}

/**
 * The `market_limit` refusals the Market page holds (market-and-shop.md §3.5
 * step 4), so closing a confirmation and opening it again keeps the confirm
 * button disabled until the limit frees up: the buyer's own limits for every
 * listing, a seller's or a pair's for the listing that hit it.
 */
export interface MarketBlocks {
  /** The block that holds for this listing, if any; whether it still runs is the caller's countdown. */
  blockFor: (listingId: string) => LimitBlock | null;
  record: (listingId: string, block: LimitBlock) => void;
}

export function useMarketBlocks(): MarketBlocks {
  const [blocks, setBlocks] = useState<{ every: LimitBlock | null; one: ReadonlyMap<string, LimitBlock> }>({
    every: null,
    one: new Map(),
  });
  const blockFor = useCallback(
    (listingId: string) => {
      const own = blocks.one.get(listingId) ?? null;
      const { every } = blocks;
      if (every === null || own === null) return every ?? own;
      return own.until > every.until ? own : every;
    },
    [blocks],
  );
  const record = useCallback(
    (listingId: string, block: LimitBlock) =>
      setBlocks((previous) =>
        blocksEveryListing(block.limit)
          ? { ...previous, every: block }
          : { ...previous, one: new Map(previous.one).set(listingId, block) },
      ),
    [],
  );
  return { blockFor, record };
}

/** Where the listing dialog is (§3.4 step 7, §3.5): the details, the confirmation, the result, or gone. */
export type BuyStage = "details" | "confirm" | "bought" | "gone";

/** The line under the buy confirmation's buttons; at most one shows (§3.5 step 4). */
export type BuyLine =
  { kind: "tooLittle"; balance: number } | { kind: "serverFailure" } | { kind: "rateLimited" } | null;

export interface BuyListing {
  stage: BuyStage;
  receipt: PurchaseReceipt | null;
  /** `Buy…`: the confirmation. */
  ask: () => void;
  /** The confirm button and `Try again`. Settles once the answer is applied. */
  confirm: () => Promise<void>;
  /** `Cancel` and Escape on the confirmation: the key goes; after no answer the server is asked again. */
  back: () => void;
  noAnswer: boolean;
  line: BuyLine;
  action: Pick<KeyedAction<PurchaseReceipt>, "sending" | "wait">;
}

/**
 * One listing's purchase (market-and-shop.md §3.5): one `POST
 * /api/market/listings/{listingId}/buy` with the key and nothing else, so no
 * request carries a price; the number on the button is display. The key
 * follows `useKeyedAction`, the page's 429 wait outlives the confirmation,
 * and a `market_limit` is recorded on the page. The receipt's balance reaches
 * the header, the listing leaves the browse list and the collection is marked
 * stale, even if the dialog is gone by then.
 */
export function useBuyListing(
  listing: Listing,
  { wait, blocks, balance }: { wait: RateLimitWait; blocks: MarketBlocks; balance: number | null },
): BuyListing {
  const { applyBalance } = useGame();
  const refresh = useMarketRefresh();
  const [stage, setStage] = useState<BuyStage>("details");
  const [receipt, setReceipt] = useState<PurchaseReceipt | null>(null);
  const [noAnswer, setNoAnswer] = useState(false);
  const [line, setLine] = useState<BuyLine>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { listingId } = listing;
  const { drop, collection, mine } = refresh;
  const send = useCallback(
    async (requestId: string) => {
      try {
        const bought = await buyListing(listingId, requestId);
        applyBalance(bought.balance);
        drop(listingId);
        collection();
        mine();
        return bought;
      } catch (err) {
        if (isApiError(err, "insufficient_funds") && err.balance !== undefined) applyBalance(err.balance);
        throw err;
      }
    },
    [listingId, applyBalance, drop, collection, mine],
  );
  const action = useKeyedAction(send, wait);

  const settle = (outcome: Outcome<PurchaseReceipt>) => {
    setNoAnswer(outcome.kind === "noAnswer");
    setLine(null);
    switch (outcome.kind) {
      case "answered":
        setReceipt(outcome.result);
        setStage("bought");
        return;
      case "noAnswer":
      case "sessionEnded":
        return;
      case "rateLimited":
        setLine({ kind: "rateLimited" });
        return;
      case "refused":
        switch (outcome.code) {
          case "listing_unavailable":
          case "listing_not_found":
            drop(listingId);
            setStage("gone");
            return;
          case "insufficient_funds":
            setLine({ kind: "tooLittle", balance: outcome.balance ?? balance ?? 0 });
            return;
          case "market_limit": {
            const block = limitBlock(outcome.limit, outcome.retryAfterSeconds, {
              wall: Date.now(),
              monotonic: performance.now(),
            });
            if (block === null) setLine({ kind: "serverFailure" });
            else blocks.record(listingId, block);
            return;
          }
          default:
            // `own_listing` and `request_id_reused` are never expected here: the server failure.
            setLine({ kind: "serverFailure" });
        }
    }
  };

  const confirm = async () => {
    const outcome = await action.run();
    if (outcome !== null && mounted.current) settle(outcome);
  };

  const ask = () => {
    setLine(null);
    setNoAnswer(false);
    setStage("confirm");
  };

  const back = () => {
    if (action.sending) return;
    action.discard();
    if (noAnswer) {
      // The outcome is unknown: the wallet, the first page and the collection are read again.
      refresh.wallet();
      refresh.listings();
      refresh.collection();
      setNoAnswer(false);
    }
    setLine(null);
    setStage("details");
  };

  return {
    stage,
    receipt,
    ask,
    confirm,
    back,
    noAnswer,
    line,
    action: { sending: action.sending, wait: action.wait },
  };
}

/** What a cancel's answer leaves (§3.6 step 3); null when the session ended. */
export type CancelResult =
  | { kind: "cancelled"; listing: Listing }
  | { kind: "alreadyEnded" }
  | { kind: "soldFirst" }
  | { kind: "gone" }
  | { kind: "noAnswer" }
  | { kind: "serverFailure" }
  | { kind: "rateLimited" };

/** An answer after which the listing is no longer the player's to cancel: no `Cancel listing` any more. */
export function cancelEnded(result: CancelResult): boolean {
  return (
    result.kind === "cancelled" ||
    result.kind === "alreadyEnded" ||
    result.kind === "soldFirst" ||
    result.kind === "gone"
  );
}

export interface CancelListing {
  /** Sends the cancel once per listing at a time; null for a second press while one is in flight. */
  cancel: (listing: Listing) => Promise<CancelResult | null>;
  /** The listings whose cancel is in flight. */
  cancelling: ReadonlySet<string>;
}

/**
 * `Cancel listing` (§3.6 step 3): `POST .../cancel` with `{}`, no
 * confirmation. The cancel is idempotent on the server, so it carries no key
 * and `Try again` after no answer simply sends it again. Each answer reads
 * `mine` again; a cancel also the wallet (its `activeListings`) and the
 * collection, whose card is available again.
 */
export function useCancelListing(wait: RateLimitWait): CancelListing {
  const refresh = useMarketRefresh();
  const { sessionEnded, unreachable, clearNotice } = useShellContext();
  const [cancelling, setCancelling] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());

  const settle = useCallback(
    (outcome: Outcome<Listing>, listing: Listing): CancelResult | null => {
      switch (outcome.kind) {
        case "answered":
          clearNotice();
          refresh.mine();
          if (outcome.result.status === "cancelled") {
            refresh.drop(listing.listingId);
            refresh.collection();
            refresh.wallet();
            return { kind: "cancelled", listing: outcome.result };
          }
          return { kind: "alreadyEnded" };
        case "noAnswer":
          unreachable();
          return { kind: "noAnswer" };
        case "sessionEnded":
          sessionEnded();
          return null;
        case "rateLimited":
          wait.start(outcome.seconds);
          return { kind: "rateLimited" };
        case "refused":
          switch (outcome.code) {
            case "listing_unavailable":
              refresh.drop(listing.listingId);
              refresh.mine();
              refresh.wallet();
              return { kind: "soldFirst" };
            case "listing_not_found":
              refresh.drop(listing.listingId);
              refresh.mine();
              return { kind: "gone" };
            default:
              return { kind: "serverFailure" };
          }
      }
    },
    [refresh, wait, clearNotice, unreachable, sessionEnded],
  );

  const cancel = useCallback(
    async (listing: Listing) => {
      const { listingId } = listing;
      if (inFlight.current.has(listingId)) return null;
      inFlight.current.add(listingId);
      setCancelling(new Set(inFlight.current));
      let outcome: Outcome<Listing>;
      try {
        outcome = { kind: "answered", result: await cancelListing(listingId) };
      } catch (err) {
        outcome = failureOutcome(err);
      } finally {
        inFlight.current.delete(listingId);
        setCancelling(new Set(inFlight.current));
      }
      return settle(outcome, listing);
    },
    [settle],
  );

  return { cancel, cancelling };
}
