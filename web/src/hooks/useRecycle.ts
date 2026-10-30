import type { CollectionEntry, KarmaRules, RecycleReceipt } from "@anime-tcg/shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { recycleDuplicates } from "../lib/api";
import type { Outcome } from "../lib/keyedAction";
import { parseDuplicates, recycleRange, type RecycleRange } from "../lib/recycle";
import { useGame } from "./useGame";
import { useKeyedAction, type KeyedAction } from "./useKeyedAction";

/** What the confirmation shows and sends: the number, and the value and total it named. */
export interface RecycleAsk {
  count: number;
  value: number;
  total: number;
}

/** The line under the confirmation's buttons; at most one shows (collection-overview.md §3.6 step 7). */
export type RecycleLine = "ceiling" | "serverFailure" | "rateLimited" | null;

/** What the details show after a confirmation ended: the receipt's line, or the neutral notice. */
export type RecycleResult =
  { kind: "recycled"; receipt: RecycleReceipt; ask: RecycleAsk } | { kind: "somethingChanged" } | null;

export interface Recycle {
  /** What the section offers for this entry, or null without the wallet's rules. */
  range: RecycleRange | null;
  /** The field's text; it starts at the most the entry can recycle. */
  field: string;
  setField: (text: string) => void;
  /** The last submit found the field invalid; it shows until the next submit (§3.6 step 3). */
  fieldError: boolean;
  /** The confirmation open, or null on the details. */
  asking: RecycleAsk | null;
  /** `Recycle…`: checks the field and opens the confirmation; false when the field is invalid. */
  submit: () => boolean;
  /** The confirm button and `Try again`. Settles once the answer is applied. */
  confirm: () => Promise<void>;
  /** `Cancel` and Escape on the confirmation: the key goes; after no answer the server is asked again. */
  back: () => void;
  noAnswer: boolean;
  line: RecycleLine;
  result: RecycleResult;
  action: Pick<KeyedAction<RecycleReceipt>, "sending" | "wait">;
}

/**
 * The card dialog's Recycle for Karma (collection-overview.md §3.6, §4.7):
 * the number field, the confirmation and its one request. The request names
 * the entry and the number and never an amount; the server credits its own
 * value and the receipt's `credited` and `balance` are what the UI then
 * shows. Nothing changes on screen before the answer, which refetches the
 * collection; its balance reaches the header even if the dialog is gone.
 */
export function useRecycle(entry: CollectionEntry | null, rules: KarmaRules | null): Recycle {
  const game = useGame();
  const queryClient = useQueryClient();
  const { balanceFrom, collectionQuery, walletQuery } = game;
  const range = rules === null || entry === null ? null : recycleRange(entry, rules.maxRecycleCount);
  const [fieldText, setFieldText] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState(false);
  const [asking, setAsking] = useState<RecycleAsk | null>(null);
  const [noAnswer, setNoAnswer] = useState(false);
  const [line, setLine] = useState<RecycleLine>(null);
  const [result, setResult] = useState<RecycleResult>(null);
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

  const characterId = entry?.character.id;
  const rarity = entry?.rarity;
  const count = asking?.count;
  const send = useCallback(
    async (requestId: string) => {
      if (count === undefined || characterId === undefined || rarity === undefined) {
        throw new Error("a recycle needs an entry and a confirmed number");
      }
      const takeBalance = balanceFrom();
      const receipt = await recycleDuplicates({ requestId, characterId, rarity, count });
      takeBalance(receipt.balance);
      refetchCollection();
      return receipt;
    },
    [count, balanceFrom, characterId, rarity, refetchCollection],
  );
  const action = useKeyedAction(send);

  const field = fieldText ?? (range?.kind === "open" ? String(range.max) : "");

  const submit = () => {
    if (range?.kind !== "open" || rules === null || rarity === undefined) return false;
    const parsed = parseDuplicates(field, range.max);
    setFieldError(parsed === null);
    if (parsed === null) return false;
    const value = rules.recycleValues[rarity];
    setAsking({ count: parsed, value, total: parsed * value });
    setResult(null);
    setLine(null);
    setNoAnswer(false);
    return true;
  };

  const settle = (outcome: Outcome<RecycleReceipt>, ask: RecycleAsk) => {
    setNoAnswer(outcome.kind === "noAnswer");
    setLine(null);
    switch (outcome.kind) {
      case "answered":
        // A deploy changed the value since the wallet was read: the wallet is read again for the new one.
        if (outcome.result.credited !== ask.total)
          void queryClient.refetchQueries({ queryKey: walletQuery.queryKey });
        setAsking(null);
        setFieldText(null);
        setResult({ kind: "recycled", receipt: outcome.result, ask });
        return;
      case "noAnswer":
      case "sessionEnded":
        return;
      case "rateLimited":
        setLine("rateLimited");
        return;
      case "refused":
        switch (outcome.code) {
          case "not_enough_copies":
          case "request_id_reused":
            refetchCollection();
            setAsking(null);
            setFieldText(null);
            setResult({ kind: "somethingChanged" });
            return;
          case "balance_limit":
            setLine("ceiling");
            return;
          default:
            setLine("serverFailure");
        }
    }
  };

  const confirm = async () => {
    if (asking === null) return;
    const ask = asking;
    setLine(null);
    const outcome = await action.run();
    if (outcome !== null && mounted.current) settle(outcome, ask);
  };

  const back = () => {
    if (action.sending) return;
    // Cancel discards the key whatever came before, a 429 included: the next confirmation is a new request.
    action.discard();
    if (noAnswer) {
      // The outcome is unknown: the details show what the server now holds.
      refetchCollection();
      void queryClient.refetchQueries({ queryKey: walletQuery.queryKey });
      setNoAnswer(false);
    }
    setLine(null);
    setAsking(null);
  };

  return {
    range,
    field,
    setField: setFieldText,
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
