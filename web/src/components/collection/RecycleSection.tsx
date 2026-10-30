import type { CollectionEntry, KarmaRules } from "@anime-tcg/shared/api";
import { useId, type FormEvent, type RefObject } from "react";
import type { Recycle } from "../../hooks/useRecycle";
import { actionCopy, recycleCopy } from "../../lib/economyCopy";
import { parseDuplicates } from "../../lib/recycle";
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
import { openOnce, ignoreRepeat } from "../packs/activation";
import { ERROR_LINE, SECONDARY_LINE } from "../packs/styles";

interface SectionProps {
  entry: CollectionEntry;
  rules: KarmaRules | null;
  /** The collection or the wallet is stale (or the wallet never answered): nothing can be sent. */
  stale: boolean;
  recycle: Recycle;
  buttonRef: RefObject<HTMLButtonElement | null>;
  fieldRef: RefObject<HTMLInputElement | null>;
  /** `Recycle…` with a valid number: the dialog shows the confirmation. */
  onAsk: () => void;
}

/**
 * The details' Recycle for Karma section (collection-overview.md §3.6 steps
 * 1 to 3, §4.7, §5.4, §6.4): the value per duplicate from the wallet's rules,
 * the `Duplicates` field from 1 to the entry's `recyclable` (at most
 * `maxRecycleCount`), the exact credit under it, and `Recycle…`, which is
 * `aria-disabled` with its reason when nothing can be recycled. After a
 * confirmation it shows the receipt's line or the neutral notice above it.
 */
export function RecycleSection({ entry, rules, stale, recycle, buttonRef, fieldRef, onAsk }: SectionProps) {
  const headingId = useId();
  const fieldId = useId();
  const hintId = useId();
  const creditId = useId();
  const errorId = useId();
  const reasonId = useId();
  const valueId = useId();
  const { range, field, fieldError, result } = recycle;
  const value = rules?.recycleValues[entry.rarity] ?? null;
  const open = range?.kind === "open" ? range : null;
  const valid = open === null ? null : parseDuplicates(field, open.max);

  let reason: string | null = null;
  if (stale) reason = recycleCopy.stale;
  else if (range?.kind === "closed") reason = recycleCopy[range.reason];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason !== null) return;
    if (recycle.submit()) onAsk();
    else fieldRef.current?.focus();
  };

  const described = [hintId, valid !== null && value !== null ? creditId : null, fieldError ? errorId : null]
    .filter((id) => id !== null)
    .join(" ");

  return (
    <section aria-labelledby={headingId} className="mt-1 border-t border-zinc-800 pt-5">
      {result?.kind === "somethingChanged" && (
        <p role="status" className={`${STATUS_BANNER} mb-4`}>
          {recycleCopy.somethingChanged}
        </p>
      )}
      <h3 id={headingId} className="text-sm font-semibold text-zinc-200">
        {recycleCopy.heading}
      </h3>
      {result?.kind === "recycled" && <RecycledLine entry={entry} rules={rules} recycle={recycle} />}
      {value !== null && (
        <p id={valueId} className={`mt-2 ${BODY_TEXT} tabular-nums`}>
          {recycleCopy.value(value)}
        </p>
      )}
      <form noValidate onSubmit={submit} className="mt-3 flex flex-col gap-1">
        <div className="flex items-end gap-2">
          {open !== null && (
            <div className="flex w-20 flex-col gap-1">
              <label htmlFor={fieldId} className="text-xs text-zinc-400">
                {recycleCopy.label}
              </label>
              <input
                id={fieldId}
                ref={fieldRef}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={field}
                onChange={(event) => recycle.setField(event.target.value)}
                aria-invalid={fieldError || undefined}
                aria-describedby={described}
                className={`${INPUT} ${INPUT_BORDER[fieldError ? "invalid" : "valid"]} tabular-nums`}
              />
            </div>
          )}
          <button
            ref={buttonRef}
            type="submit"
            aria-disabled={reason === null ? undefined : "true"}
            aria-describedby={
              [value === null ? null : valueId, reason === null ? null : reasonId]
                .filter((id) => id !== null)
                .join(" ") || undefined
            }
            className={BUTTON.primary}
          >
            {recycleCopy.button}
          </button>
        </div>
        {open !== null && (
          <p id={hintId} className="text-xs text-zinc-400 tabular-nums">
            {recycleCopy.hint(open.max)}
          </p>
        )}
        {valid !== null && value !== null && (
          <p id={creditId} className="text-xs text-zinc-400 tabular-nums">
            {recycleCopy.credit(valid * value)}
          </p>
        )}
        {fieldError && open !== null && (
          <p id={errorId} className={ERROR_TEXT}>
            {recycleCopy.fieldError(open.max)}
          </p>
        )}
        {reason !== null && (
          <p id={reasonId} className="text-xs text-zinc-400">
            {reason}
          </p>
        )}
      </form>
    </section>
  );
}

/**
 * §3.6 step 7: the receipt's count, credit and balance; when the credit is
 * not the total the confirmation named, the value now in force, once the
 * wallet read again has it.
 */
function RecycledLine({
  entry,
  rules,
  recycle,
}: {
  entry: CollectionEntry;
  rules: KarmaRules | null;
  recycle: Recycle;
}) {
  if (recycle.result?.kind !== "recycled") return null;
  const { receipt, ask } = recycle.result;
  const now = rules?.recycleValues[entry.rarity] ?? null;
  const changed = receipt.credited !== ask.total && now !== null && now !== ask.value;
  return (
    <p role="status" className="mt-2 text-sm break-words text-zinc-200 tabular-nums">
      <LoginText
        text={{
          template: (name) =>
            recycleCopy.recycled(receipt.recycled.count, name, receipt.credited, receipt.balance),
          login: entry.character.name,
        }}
      />
      {changed && recycleCopy.valueChanged(now)}
    </p>
  );
}

interface ConfirmationProps {
  entry: CollectionEntry;
  recycle: Recycle;
  /** `Cancel`: the dialog returns to the details and moves focus. */
  onBack: () => void;
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

/**
 * The recycle confirmation (§3.6 steps 4 to 8, §4.7), in place of the
 * details. Its heading takes focus and is described by the body, which
 * names the number, the rarity, the exact amount and the copies kept. In
 * flight the button reads `Recycling…` and keeps focus; `Cancel` and Escape
 * do nothing until the answer. After no answer the body is the red banner
 * and the button resends the same request.
 */
export function RecycleConfirmation({ entry, recycle, onBack, headingId, headingRef }: ConfirmationProps) {
  const bodyId = useId();
  const { asking, action, line, noAnswer } = recycle;
  if (asking === null) return null;
  const { sending, wait } = action;
  const blocked = sending || wait !== null || line === "ceiling";
  let label = noAnswer ? actionCopy.tryAgain : recycleCopy.confirm(asking.total);
  if (sending) label = recycleCopy.recycling;
  else if (wait !== null) label = actionCopy.waitButton(wait);

  return (
    <div className="mt-2 flex flex-col gap-4">
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        aria-describedby={bodyId}
        className={`${PANEL_HEADING} break-words focus:outline-none`}
      >
        <LoginText
          text={{
            template: (name) => recycleCopy.confirmHeading(asking.count, name),
            login: entry.character.name,
          }}
        />
      </h2>
      {noAnswer ? (
        <p id={bodyId} role="alert" className={ALERT_BANNER}>
          {actionCopy.noAnswer}
        </p>
      ) : (
        <p id={bodyId} className={`${BODY_TEXT} tabular-nums`}>
          {recycleCopy.confirmBody(
            asking.count,
            entry.rarity,
            asking.total,
            entry.count - asking.count,
            entry.listed,
          )}
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
          onClick={blocked ? undefined : (event) => openOnce(event, () => void recycle.confirm())}
          onKeyDown={ignoreRepeat}
          className={`${BUTTON.primary} tabular-nums`}
        >
          {label}
        </button>
        <button type="button" disabled={sending} onClick={onBack} className={BUTTON.secondary}>
          {recycleCopy.cancel}
        </button>
      </div>
      {line === "ceiling" && (
        <p role="alert" className={ERROR_LINE}>
          {recycleCopy.ceiling}
        </p>
      )}
      {line === "rateLimited" && (
        <p role="status" className={SECONDARY_LINE}>
          {actionCopy.rateLimited}
        </p>
      )}
    </div>
  );
}
