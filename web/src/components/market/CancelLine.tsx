import type { RefObject } from "react";
import type { CancelResult } from "../../hooks/useMarketActions";
import { actionCopy } from "../../lib/economyCopy";
import { cancelCopy } from "../../lib/marketCopy";
import { LoginText } from "../account/LoginText";
import { ALERT_BANNER } from "../account/styles";
import { ERROR_LINE, SECONDARY_LINE } from "../packs/styles";

interface Props {
  result: CancelResult | null;
  name: string;
  /** The status line as a focus target (My listings moves focus to it after a cancel, §7). */
  statusRef?: RefObject<HTMLParagraphElement | null>;
}

/**
 * What a cancel's answer says (market-and-shop.md §3.6 step 3, §8): a status
 * line for the answers that end the listing, the no-answer line, the server
 * failure banner, or the rate-limit line read once.
 */
export function CancelLine({ result, name, statusRef }: Props) {
  if (result === null) return null;
  switch (result.kind) {
    case "cancelled":
      return (
        <p
          ref={statusRef}
          role="status"
          tabIndex={-1}
          className="self-stretch text-sm [overflow-wrap:anywhere] text-zinc-200 focus:outline-none"
        >
          <LoginText text={{ template: cancelCopy.cancelled, login: name }} />
        </p>
      );
    case "alreadyEnded":
    case "soldFirst":
    case "gone":
      return (
        <p ref={statusRef} role="status" tabIndex={-1} className="text-sm text-zinc-200 focus:outline-none">
          {cancelCopy[result.kind]}
        </p>
      );
    case "noAnswer":
      return (
        <p role="alert" className={ERROR_LINE}>
          {actionCopy.noAnswer}
        </p>
      );
    case "serverFailure":
      return (
        <p role="alert" className={ALERT_BANNER}>
          {actionCopy.serverFailure}
        </p>
      );
    case "rateLimited":
      return (
        <p role="status" className={SECONDARY_LINE}>
          {actionCopy.rateLimited}
        </p>
      );
  }
}
