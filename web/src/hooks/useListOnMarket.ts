import type { CollectionEntry, Listing, Wallet } from "@anime-tcg/shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { listCard } from "../lib/api";
import type { Outcome } from "../lib/keyedAction";
import { feePreview, lastCopy, listRange, parsePrice, type LastCopy, type ListRange } from "../lib/market";
import { useGame } from "./useGame";
import { useKeyedAction, useRateLimitWait, type KeyedAction } from "./useKeyedAction";

/** What the confirmation shows and sends: the asking price, the fee preview and net it named, its last-copy sentence. */
export interface ListAsk {
  price: number;
  fee: number;
  net: number;
  /** `rules.listingTtlSeconds` when the price was confirmed. */
  ttlSeconds: number;
  lastCopy: LastCopy;
}

/** The line under the confirmation's buttons; at most one shows (collection-overview.md §3.5 step 9). */
export type ListLine = "serverFailure" | "rateLimited" | null;

/** What the details show after a confirmation ended: the listing's line, the neutral notice, or the cap line. */
export type ListResult =
  | { kind: "listed"; listing: Listing }
  | { kind: "somethingChanged" }
  /** `listing_limit`: the red line naming `rules.maxListings`, with `My listings`. */
  | { kind: "cap" }
  | null;

export interface ListOnMarket {
  /** What the section offers for this entry, or null without the wallet. */
  range: ListRange | null;
  /** The `Price` field's text; empty at first (§3.5 step 1). */
  field: string;
  setField: (text: string) => void;
  /** The last submit, or `price_out_of_bounds`, found the price outside the bounds; it shows until the next submit. */
  fieldError: boolean;
  asking: ListAsk | null;
  /** `List…`: checks the price and opens the confirmation; false when the price is invalid. */
  submit: () => boolean;
  /** The confirm button and `Try again`. Settles once the answer is applied. */
  confirm: () => Promise<void>;
  /** `Cancel` and Escape on the confirmation: the key goes; after no answer the server is asked again. */
  back: () => void;
  noAnswer: boolean;
  line: ListLine;
  result: ListResult;
  action: Pick<KeyedAction<Listing>, "sending" | "wait">;
}

/**
 * The card dialog's List on the market (collection-overview.md §3.5, §4.6):
 * the price field with the wallet's bounds, the fee preview, the confirmation
 * and its one `POST /api/market/listings`, which names the entry and the
 * asking price, the only number any request of this view carries. The key
 * follows `useKeyedAction`. Nothing changes on screen before the answer; then
 * the collection, the wallet (its `activeListings`) and the market's reads are
 * read again, and the details show the server's listing.
 */
export function useListOnMarket(
  entry: CollectionEntry | null,
  wallet: Wallet | null,
  entries: readonly CollectionEntry[],
): ListOnMarket {
  const game = useGame();
  const queryClient = useQueryClient();
  const { collectionQuery, walletQuery, marketKey } = game;
  const range =
    wallet === null || entry === null ? null : listRange(entry, wallet.activeListings, wallet.rules);
  const [field, setField] = useState("");
  const [fieldError, setFieldError] = useState(false);
  const [asking, setAsking] = useState<ListAsk | null>(null);
  const [noAnswer, setNoAnswer] = useState(false);
  const [line, setLine] = useState<ListLine>(null);
  const [result, setResult] = useState<ListResult>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refetchCollection = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: collectionQuery.queryKey }),
    [queryClient, collectionQuery.queryKey],
  );
  const refetchWallet = useCallback(
    () => void queryClient.refetchQueries({ queryKey: walletQuery.queryKey }),
    [queryClient, walletQuery.queryKey],
  );

  const characterId = entry?.character.id;
  const rarity = entry?.rarity;
  const price = asking?.price;
  const send = useCallback(
    async (requestId: string) => {
      if (price === undefined || characterId === undefined || rarity === undefined) {
        throw new Error("a listing needs an entry and a confirmed price");
      }
      const listing = await listCard({ requestId, characterId, rarity, price });
      refetchCollection();
      refetchWallet();
      void queryClient.invalidateQueries({ queryKey: marketKey });
      return listing;
    },
    [price, characterId, rarity, refetchCollection, refetchWallet, queryClient, marketKey],
  );
  // Held by the dialog's hook, so a 429's wait survives Cancel and a new confirmation.
  const wait = useRateLimitWait();
  const action = useKeyedAction(send, wait);

  const submit = () => {
    if (range?.kind !== "open" || wallet === null || entry === null) return false;
    const parsed = parsePrice(field, range.min, range.max);
    setFieldError(parsed === null);
    if (parsed === null) return false;
    const fee = feePreview(parsed, wallet.rules);
    setAsking({
      price: parsed,
      fee,
      net: parsed - fee,
      ttlSeconds: wallet.rules.listingTtlSeconds,
      lastCopy: lastCopy(entry, entries),
    });
    setResult(null);
    setLine(null);
    setNoAnswer(false);
    return true;
  };

  /** Back to the details with the price kept, the server read again and the neutral notice. */
  const changed = (refetch: () => void) => {
    refetch();
    setAsking(null);
    setResult({ kind: "somethingChanged" });
  };

  const settle = (outcome: Outcome<Listing>) => {
    setNoAnswer(outcome.kind === "noAnswer");
    setLine(null);
    switch (outcome.kind) {
      case "answered":
        setAsking(null);
        setField("");
        setFieldError(false);
        setResult({ kind: "listed", listing: outcome.result });
        return;
      case "noAnswer":
      case "sessionEnded":
        return;
      case "rateLimited":
        setLine("rateLimited");
        return;
      case "refused":
        switch (outcome.code) {
          case "price_out_of_bounds":
            // The bounds changed since the wallet was read: the field error names the new ones once it is read again.
            setFieldError(true);
            changed(refetchWallet);
            return;
          case "not_enough_copies":
          case "request_id_reused":
            changed(refetchCollection);
            return;
          case "listing_limit":
            refetchWallet();
            setAsking(null);
            setResult({ kind: "cap" });
            return;
          default:
            setLine("serverFailure");
        }
    }
  };

  const confirm = async () => {
    if (asking === null) return;
    setLine(null);
    const outcome = await action.run();
    if (outcome !== null && mounted.current) settle(outcome);
  };

  const back = () => {
    if (action.sending) return;
    // Cancel discards the key whatever came before, a 429 included: the next confirmation is a new request.
    action.discard();
    if (noAnswer) {
      // The outcome is unknown: the details show what the server now holds.
      refetchCollection();
      refetchWallet();
      void queryClient.invalidateQueries({ queryKey: marketKey });
      setNoAnswer(false);
    }
    setLine(null);
    setAsking(null);
  };

  return {
    range,
    field,
    setField,
    fieldError,
    asking,
    submit,
    confirm,
    back,
    noAnswer,
    line,
    result,
    action: { sending: action.sending, wait: action.wait },
  };
}
