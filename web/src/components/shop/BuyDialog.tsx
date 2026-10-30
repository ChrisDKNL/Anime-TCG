import type { ShopReceipt, ThemeOffer } from "@anime-tcg/shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { useGame } from "../../hooks/useGame";
import { useKeyedAction, type RateLimitWait } from "../../hooks/useKeyedAction";
import { buyShopPack, isApiError } from "../../lib/api";
import { actionCopy, shopCopy } from "../../lib/economyCopy";
import type { Outcome } from "../../lib/keyedAction";
import { LoginText } from "../account/LoginText";
import { ALERT_BANNER, BODY_TEXT, BUTTON, DIALOG, PANEL_HEADING } from "../account/styles";
import { openOnce, ignoreRepeat } from "../packs/activation";
import { ERROR_LINE, SECONDARY_LINE } from "../packs/styles";

/** The line under the confirmation's buttons (market-and-shop.md §3.3 step 6); at most one shows. */
type Line =
  | { kind: "tooLittle"; balance: number }
  | { kind: "noCards" }
  | { kind: "serverFailure" }
  | { kind: "rateLimited" }
  | null;

interface Props {
  theme: ThemeOffer;
  /** The held balance the body names; the server checks it again. */
  balance: number;
  /** The page's 429 wait, which outlives this dialog. */
  wait: RateLimitWait;
  /** 201, or 200 on a replay: the page closes the dialog and shows the pack. */
  onBought: (receipt: ShopReceipt) => void;
  /** `theme_unavailable`: the page closes the dialog, refetches the shop and says so. */
  onGone: () => void;
  /** The dialog has closed after `Cancel` or Escape, with nothing in flight. */
  onClose: () => void;
}

/**
 * The pack confirmation (market-and-shop.md §3.3 steps 4 to 6): a native
 * modal `<dialog>` in the Manage account shell. The confirm button sends one
 * `POST /api/shop/buy` with the key and the theme and nothing else; the key
 * is kept on no answer and on a 429 (`Try again` resends it, so a lost answer
 * shows the pack that was dealt instead of buying a second) and discarded on
 * every other answer and on `Cancel`. While a purchase is in flight the
 * button, `Cancel` and Escape do nothing, so the dialog cannot close on an
 * unknown outcome. The balance an answer carries reaches the header even if
 * the page was left meanwhile. It mounts per purchase, so it opens on mount.
 */
export function BuyDialog({ theme, balance, wait, onBought, onGone, onClose }: Props) {
  const game = useGame();
  const queryClient = useQueryClient();
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const bodyId = useId();
  const mounted = useRef(true);
  const [noAnswer, setNoAnswer] = useState(false);
  const [line, setLine] = useState<Line>(null);

  const { applyBalance, collectionQuery, walletQuery } = game;
  const send = useCallback(
    async (requestId: string) => {
      try {
        const receipt = await buyShopPack({ requestId, themeId: theme.id });
        applyBalance(receipt.balance);
        void queryClient.invalidateQueries({ queryKey: collectionQuery.queryKey });
        return receipt;
      } catch (err) {
        if (isApiError(err, "insufficient_funds") && err.balance !== undefined) applyBalance(err.balance);
        throw err;
      }
    },
    [applyBalance, queryClient, collectionQuery.queryKey, theme.id],
  );
  const action = useKeyedAction(send, wait);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null || dialog.open) return;
    dialog.showModal();
    headingRef.current?.focus();
  }, []);

  const settle = (outcome: Outcome<ShopReceipt>) => {
    setNoAnswer(outcome.kind === "noAnswer");
    switch (outcome.kind) {
      case "answered":
        setLine(null);
        onBought(outcome.result);
        return;
      case "noAnswer":
      case "sessionEnded":
        setLine(null);
        return;
      case "rateLimited":
        setLine({ kind: "rateLimited" });
        return;
      case "refused":
        switch (outcome.code) {
          case "theme_unavailable":
            onGone();
            return;
          case "insufficient_funds":
            setLine({ kind: "tooLittle", balance: outcome.balance ?? balance });
            return;
          case "pool_unavailable":
            setLine({ kind: "noCards" });
            return;
          default:
            setLine({ kind: "serverFailure" });
        }
    }
  };

  const confirm = async () => {
    const outcome = await action.run();
    if (outcome !== null && mounted.current) settle(outcome);
  };

  /** `Cancel` and Escape: the dialog closes, and its `close` event ends the confirmation. */
  const cancel = () => {
    if (!action.sending) ref.current?.close();
  };

  /** Escape: never while in flight; otherwise the same as `Cancel`. */
  const onCancelEvent = (event: SyntheticEvent) => {
    event.preventDefault();
    cancel();
  };

  /**
   * Every close, however it came: Chromium honours a prevented `cancel` once, and a second Escape
   * closes the dialog with no cancelable event. In flight it opens again at once, so the dialog never
   * closes on an unknown outcome. Otherwise it is `Cancel`: the key goes with the dialog, and after
   * no answer the wallet and the collection are read again.
   */
  const onCloseEvent = () => {
    if (action.sending) {
      ref.current?.showModal();
      headingRef.current?.focus();
      return;
    }
    if (noAnswer) {
      void queryClient.refetchQueries({ queryKey: walletQuery.queryKey });
      void queryClient.invalidateQueries({ queryKey: collectionQuery.queryKey });
    }
    onClose();
  };

  const blocked = action.sending || action.wait !== null || line?.kind === "tooLittle";
  let label = noAnswer ? actionCopy.tryAgain : shopCopy.confirm(theme.price);
  if (action.sending) label = shopCopy.buying;
  else if (action.wait !== null) label = actionCopy.waitButton(action.wait);

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      aria-describedby={bodyId}
      onCancel={onCancelEvent}
      onClose={onCloseEvent}
      className={DIALOG}
    >
      <div className="flex flex-col gap-4">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className={`${PANEL_HEADING} break-words focus:outline-none`}
        >
          <LoginText text={{ template: shopCopy.confirmHeading, login: theme.title }} />
        </h2>
        {noAnswer ? (
          <p id={bodyId} role="alert" className={ALERT_BANNER}>
            {actionCopy.noAnswer}
          </p>
        ) : (
          <p id={bodyId} className={`${BODY_TEXT} tabular-nums`}>
            {shopCopy.confirmBody(theme.price, theme.cards, balance)}
          </p>
        )}
        {line?.kind === "serverFailure" && (
          <p role="alert" className={ALERT_BANNER}>
            {actionCopy.serverFailure}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <button
            type="button"
            aria-disabled={blocked ? "true" : undefined}
            onClick={blocked ? undefined : (event) => openOnce(event, () => void confirm())}
            onKeyDown={ignoreRepeat}
            className={`${BUTTON.primary} tabular-nums`}
          >
            {label}
          </button>
          <button type="button" disabled={action.sending} onClick={cancel} className={BUTTON.secondary}>
            {shopCopy.cancel}
          </button>
        </div>
        <ConfirmLine line={line} price={theme.price} />
      </div>
    </dialog>
  );
}

function ConfirmLine({ line, price }: { line: Line; price: number }) {
  switch (line?.kind) {
    case "tooLittle":
      return (
        <p role="alert" className={`${ERROR_LINE} tabular-nums`}>
          {shopCopy.tooLittleRefused(price, line.balance)}
        </p>
      );
    case "noCards":
      return (
        <p role="alert" className={ERROR_LINE}>
          {shopCopy.noCards}
        </p>
      );
    case "rateLimited":
      return (
        <p role="status" className={SECONDARY_LINE}>
          {actionCopy.rateLimited}
        </p>
      );
    default:
      return null;
  }
}
