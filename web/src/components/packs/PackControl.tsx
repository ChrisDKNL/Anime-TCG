import type { PublishedOdds } from "@anime-tcg/shared/api";
import { useId, useRef, useState } from "react";
import type { ControlShown, ControlView, CountdownView } from "../../lib/packControl";
import { packControlCopy } from "../../lib/packsCopy";
import { BUTTON } from "../account/styles";
import { OddsDialog } from "./OddsDialog";
import { ERROR_LINE, SECONDARY_LINE, TEXT_BUTTON_SM } from "./styles";

interface Props {
  view: ControlView;
  odds: PublishedOdds | null;
  onOpen: () => void;
  /** `Check again` after the countdown's check failed: the one `GET` it stands for. */
  onCheckNextPack: () => void;
  /** `Try again` after the first load failed, `Check again` while cards are unavailable: one `GET`. */
  onReload: () => void;
}

/**
 * The pack control (packs-page.md §4.1, §5.1, §6.1): the count, `Open pack`,
 * the line under it, the countdown, the pity line and `Pack odds`. It shows
 * what the server last said and never says what the next pack will be.
 * `Open pack` is never removed while the control shows: when it cannot be
 * used it is `aria-disabled`, so focus stays on it (§7).
 */
export function PackControl({ view, odds, onOpen, onCheckNextPack, onReload }: Props) {
  if (view.kind === "blank") return <div className="max-w-md" />;
  if (view.kind === "loadFailed") {
    return (
      <div className="flex max-w-md flex-col items-start gap-2">
        <p className="text-sm text-zinc-300">{packControlCopy.loadFailed}</p>
        <button type="button" onClick={onReload} className={BUTTON.secondary}>
          {packControlCopy.tryAgain}
        </button>
      </div>
    );
  }
  if (view.kind === "loading") {
    return (
      <div className="flex max-w-md flex-col items-start gap-2">
        <div className="h-4 w-36 rounded bg-zinc-800" />
        <button type="button" aria-disabled="true" className={`${BUTTON.primary} w-full sm:w-auto`}>
          {packControlCopy.open}
        </button>
        <p role="status" className="sr-only">
          {packControlCopy.loading}
        </p>
      </div>
    );
  }
  return (
    <Control view={view} odds={odds} onOpen={onOpen} onCheckNextPack={onCheckNextPack} onReload={onReload} />
  );
}

function Control({
  view,
  odds,
  onOpen,
  onCheckNextPack,
  onReload,
}: Omit<Props, "view"> & { view: ControlShown }) {
  const countdownId = useId();
  const [oddsOpen, setOddsOpen] = useState(false);
  const oddsButton = useRef<HTMLButtonElement>(null);
  const { button } = view;

  return (
    <div className="flex max-w-md flex-col items-start gap-2">
      <p className="text-sm font-medium text-zinc-200 tabular-nums">{view.count}</p>
      <button
        type="button"
        aria-disabled={button.enabled ? undefined : "true"}
        aria-describedby={view.describedByCountdown ? countdownId : undefined}
        onClick={button.enabled ? onOpen : undefined}
        className={`${BUTTON.primary} w-full tabular-nums sm:w-auto`}
      >
        {button.label}
      </button>
      <OpeningLine kind={view.line} />
      {view.unavailable && (
        <>
          <p className={SECONDARY_LINE}>{packControlCopy.unavailable}</p>
          <button type="button" onClick={onReload} className={BUTTON.secondary}>
            {packControlCopy.checkAgain}
          </button>
        </>
      )}
      {view.countdown !== null && (
        <Countdown id={countdownId} countdown={view.countdown} onCheckAgain={onCheckNextPack} />
      )}
      {(view.pity !== null || view.showOdds) && (
        <div className="mt-2 flex w-full flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          {view.pity !== null && <p className="text-xs text-zinc-400 tabular-nums">{view.pity}</p>}
          {view.showOdds && odds !== null && (
            <>
              <button
                ref={oddsButton}
                type="button"
                onClick={() => setOddsOpen(true)}
                className={TEXT_BUTTON_SM}
              >
                {packControlCopy.odds}
              </button>
              <OddsDialog
                odds={odds}
                open={oddsOpen}
                onClose={() => {
                  setOddsOpen(false);
                  oddsButton.current?.focus();
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The line under the button; at most one shows (§4.1). */
function OpeningLine({ kind }: { kind: ControlShown["line"] }) {
  switch (kind) {
    case null:
      return null;
    case "noneLeft":
      return (
        <p role="status" className={SECONDARY_LINE}>
          {packControlCopy.noneLeft}
        </p>
      );
    case "wait":
      return (
        <p role="status" className={SECONDARY_LINE}>
          {packControlCopy.wait}
        </p>
      );
    case "failed":
      return (
        <p role="alert" className={ERROR_LINE}>
          {packControlCopy.failed}
        </p>
      );
    // Plain text: the app's unreachable banner is already the alert.
    case "noAnswer":
      return <p className={ERROR_LINE}>{packControlCopy.noAnswer}</p>;
  }
}

/**
 * Not a live region: a screen reader reads the current value when the player
 * reaches it, in words, so it is not taken for a time of day (§7).
 */
function Countdown({
  id,
  countdown,
  onCheckAgain,
}: {
  id: string;
  countdown: CountdownView;
  onCheckAgain: () => void;
}) {
  if (countdown.kind === "checkFailed") {
    return (
      <>
        <p id={id} className={SECONDARY_LINE}>
          {packControlCopy.checkFailed}
        </p>
        <button type="button" onClick={onCheckAgain} className={BUTTON.secondary}>
          {packControlCopy.checkAgain}
        </button>
      </>
    );
  }
  return (
    <p id={id} className={`${SECONDARY_LINE} tabular-nums`}>
      <span aria-hidden="true">{packControlCopy.next(countdown.seconds)}</span>
      <span className="sr-only">{packControlCopy.nextSpoken(countdown.seconds)}</span>
    </p>
  );
}
