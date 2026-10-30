import type { CollectionEntry, KarmaRules } from "@anime-tcg/shared/api";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, type FormEvent, type RefObject } from "react";
import { useGame } from "../../hooks/useGame";
import type { ListOnMarket } from "../../hooks/useListOnMarket";
import { actionCopy, recycleCopy } from "../../lib/economyCopy";
import { feePreview, parsePrice } from "../../lib/market";
import { listCopy } from "../../lib/marketCopy";
import { LoginText } from "../account/LoginText";
import {
  ALERT_BANNER,
  BODY_TEXT,
  BUTTON,
  ERROR_TEXT,
  INPUT,
  INPUT_BORDER,
  PANEL_HEADING,
  STATUS_BANNER,
} from "../account/styles";
import { ignoreRepeat, openOnce } from "../packs/activation";
import { ERROR_LINE, SECONDARY_LINE, TEXT_BUTTON_SM, TEXT_LINK_SM } from "../packs/styles";

interface SectionProps {
  entry: CollectionEntry;
  rules: KarmaRules | null;
  /** The collection or the wallet is stale (or the wallet never answered): nothing can be sent. */
  stale: boolean;
  list: ListOnMarket;
  buttonRef: RefObject<HTMLButtonElement | null>;
  fieldRef: RefObject<HTMLInputElement | null>;
  /** `List…` with a valid price: the dialog shows the confirmation. */
  onAsk: () => void;
}

/**
 * The details' List on the market section (collection-overview.md §3.5 steps
 * 1 to 4, §4.6, §5.4): the `Price` field, empty at first, with the wallet's
 * bounds for the entry's rarity; the fee preview from the wallet's published
 * rule while the price is valid; `List…`, `aria-disabled` with its reason
 * when nothing can be listed; and `See <name> on the market`, which sets the
 * market's character filter in the layout's state and pushes `/market`.
 */
export function ListSection({ entry, rules, stale, list, buttonRef, fieldRef, onAsk }: SectionProps) {
  const game = useGame();
  const navigate = useNavigate();
  const headingId = useId();
  const fieldId = useId();
  const hintId = useId();
  const feeId = useId();
  const errorId = useId();
  const reasonId = useId();
  const { range, field, fieldError, result } = list;
  const open = range?.kind === "open" ? range : null;
  const valid = open === null ? null : parsePrice(field, open.min, open.max);
  const fee = valid === null || rules === null ? null : feePreview(valid, rules);
  const capped = range?.kind === "closed" && range.reason === "cap";

  let reason: string | null = null;
  if (stale) reason = recycleCopy.stale;
  else if (range?.kind === "closed" && range.reason === "noneAvailable") reason = listCopy.noneAvailable;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason !== null || capped) return;
    if (list.submit()) onAsk();
    else fieldRef.current?.focus();
  };

  const seeOnMarket = () => {
    game.changeMarket({
      type: "showCharacter",
      character: { id: entry.character.id, name: entry.character.name },
    });
    void navigate({ to: "/market" });
  };

  const described = [hintId, fee === null ? null : feeId, fieldError ? errorId : null]
    .filter((id) => id !== null)
    .join(" ");
  // `listing_limit` shows the cap line as the answer; the same line as the reason would repeat it.
  const showCapReason = capped && !stale && result?.kind !== "cap";

  return (
    <section aria-labelledby={headingId} className="mt-1 border-t border-zinc-800 pt-5">
      {result?.kind === "somethingChanged" && (
        <p role="status" className={`${STATUS_BANNER} mb-4`}>
          {recycleCopy.somethingChanged}
        </p>
      )}
      <h3 id={headingId} className="text-sm font-semibold text-zinc-200">
        {listCopy.heading}
      </h3>
      {result?.kind === "listed" && (
        <p role="status" className="mt-2 text-sm break-words text-zinc-200 tabular-nums">
          {listCopy.listed(result.listing.price, result.listing.fee, result.listing.expiresAt)}
        </p>
      )}
      {result?.kind === "cap" && rules !== null && <CapLine max={rules.maxListings} alert />}
      <form noValidate onSubmit={submit} className="mt-3 flex flex-col gap-1">
        <div className="flex items-end gap-2">
          {open !== null && (
            <>
              <div className="flex w-24 flex-col gap-1">
                <label htmlFor={fieldId} className="text-xs text-zinc-400">
                  {listCopy.priceLabel}
                </label>
                <input
                  id={fieldId}
                  ref={fieldRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={field}
                  onChange={(event) => list.setField(event.target.value)}
                  aria-invalid={fieldError || undefined}
                  aria-describedby={described}
                  className={`${INPUT} ${INPUT_BORDER[fieldError ? "invalid" : "valid"]} tabular-nums`}
                />
              </div>
              <span className="pb-2 text-sm text-zinc-400">{listCopy.afterField}</span>
            </>
          )}
          <button
            ref={buttonRef}
            type="submit"
            aria-disabled={reason === null && !capped ? undefined : "true"}
            aria-describedby={
              [fee === null ? null : feeId, reason === null && !showCapReason ? null : reasonId]
                .filter((id) => id !== null)
                .join(" ") || undefined
            }
            className={`${BUTTON.primary} ml-1`}
          >
            {listCopy.button}
          </button>
        </div>
        {open !== null && (
          <p id={hintId} className="text-xs text-zinc-400 tabular-nums">
            {listCopy.hint(open.min, open.max)}
          </p>
        )}
        {fee !== null && valid !== null && rules !== null && (
          <p id={feeId} className="text-xs text-zinc-400 tabular-nums">
            {listCopy.fee(fee, rules.feeBps, valid - fee)}
          </p>
        )}
        {fieldError && open !== null && (
          <p id={errorId} className={ERROR_TEXT}>
            {listCopy.priceError(open.min, open.max)}
          </p>
        )}
        {reason !== null && (
          <p id={reasonId} className="text-xs text-zinc-400">
            {reason}
          </p>
        )}
        {showCapReason && rules !== null && <CapLine id={reasonId} max={rules.maxListings} alert={false} />}
      </form>
      <button type="button" onClick={seeOnMarket} className={`${TEXT_BUTTON_SM} mt-2 -ml-1 break-words`}>
        <LoginText text={{ template: listCopy.marketLink, login: entry.character.name }} />
      </button>
    </section>
  );
}

/** The listing cap (§3.5 steps 3 and 9): the line naming `rules.maxListings` and the `My listings` link. */
function CapLine({ id, max, alert }: { id?: string; max: number; alert: boolean }) {
  const game = useGame();
  return (
    <p
      id={id}
      role={alert ? "alert" : undefined}
      className={`mt-2 ${alert ? ERROR_LINE : "text-xs text-zinc-400"}`}
    >
      {listCopy.cap(max)}{" "}
      <Link
        to="/market"
        onClick={() => game.changeMarket({ type: "view", view: "mine" })}
        className={TEXT_LINK_SM}
      >
        {listCopy.myListings}
      </Link>
    </p>
  );
}

interface ConfirmationProps {
  entry: CollectionEntry;
  list: ListOnMarket;
  /** `Cancel`: the dialog returns to the details and moves focus. */
  onBack: () => void;
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

/**
 * The listing confirmation (§3.5 steps 5 to 10, §4.6), in place of the
 * details. Its heading takes focus and is described by the body, which says
 * what goes on the market for how long, what the player gets after the fee,
 * the last-copy sentence it needs and that a sale cannot be undone. In flight
 * the button reads `Listing…` and keeps focus; `Cancel` and Escape do nothing
 * until the answer. After no answer the body is the red banner and the button
 * resends the same request.
 */
export function ListConfirmation({ entry, list, onBack, headingId, headingRef }: ConfirmationProps) {
  const bodyId = useId();
  const { asking, action, line, noAnswer } = list;
  if (asking === null) return null;
  const { sending, wait } = action;
  const blocked = sending || wait !== null;
  let label = noAnswer ? actionCopy.tryAgain : listCopy.confirm(asking.price);
  if (sending) label = listCopy.listing;
  else if (wait !== null) label = actionCopy.waitButton(wait);
  const name = entry.character.name;

  return (
    <div className="mt-2 flex flex-col gap-4">
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        aria-describedby={bodyId}
        className={`${PANEL_HEADING} break-words focus:outline-none`}
      >
        <LoginText text={{ template: (n) => listCopy.confirmHeading(n, asking.price), login: name }} />
      </h2>
      {noAnswer ? (
        <p id={bodyId} role="alert" className={ALERT_BANNER}>
          {actionCopy.noAnswer}
        </p>
      ) : (
        <p id={bodyId} className={`${BODY_TEXT} break-words tabular-nums`}>
          <LoginText
            text={{
              template: (n) =>
                listCopy.confirmBody(n, {
                  rarity: entry.rarity,
                  ttlSeconds: asking.ttlSeconds,
                  net: asking.net,
                  fee: asking.fee,
                  lastCopy: asking.lastCopy,
                }),
              login: name,
            }}
          />
        </p>
      )}
      {line === "serverFailure" && (
        <p role="alert" className={ALERT_BANNER}>
          {actionCopy.serverFailure}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <button
          type="button"
          aria-disabled={blocked ? "true" : undefined}
          onClick={blocked ? undefined : (event) => openOnce(event, () => void list.confirm())}
          onKeyDown={ignoreRepeat}
          className={`${BUTTON.primary} tabular-nums`}
        >
          {label}
        </button>
        <button type="button" disabled={sending} onClick={onBack} className={BUTTON.secondary}>
          {listCopy.cancel}
        </button>
      </div>
      {line === "rateLimited" && (
        <p role="status" className={SECONDARY_LINE}>
          {actionCopy.rateLimited}
        </p>
      )}
    </div>
  );
}
