import type { DemoControl as Control } from "../../lib/demo";
import { demoCopy } from "../../lib/navigationCopy";
import { BUTTON } from "../account/styles";
import { ignoreRepeat, openOnce } from "../packs/activation";
import { ERROR_LINE, SECONDARY_LINE } from "../packs/styles";
import { JoinOffer } from "./JoinOffer";

interface Props {
  control: Control;
  onOpen: () => void;
}

/**
 * What stands under the lede (navigation-and-landing.md §3.7 items 1.3, 1.6
 * and 1.7, §4.5): `Open a demo pack` with the disclosure under it, or the
 * unavailable line in the button's place, or after the last demo pack of the
 * visit the Join offer. The button is never `disabled` while it shows: it is
 * `aria-disabled`, so focus stays on it while a pack opens or a wait runs. It
 * has the pack button's guards: a double click or a held Enter opens one demo
 * pack, never two (manager decision, 2026-10-30).
 */
export function DemoControl({ control, onOpen }: Props) {
  if (control.kind === "done") {
    return (
      <div className="mt-6">
        <JoinOffer takesFocus />
      </div>
    );
  }
  return (
    <div className="mt-6 flex max-w-xl flex-col items-start gap-2">
      {control.kind === "unavailable" ? (
        <p className={SECONDARY_LINE}>{demoCopy.unavailable}</p>
      ) : (
        <button
          type="button"
          aria-disabled={control.enabled ? undefined : "true"}
          onClick={control.enabled ? (event) => openOnce(event, onOpen) : undefined}
          onKeyDown={ignoreRepeat}
          className={`${BUTTON.primary} w-full tabular-nums sm:w-auto`}
        >
          {label(control.label)}
        </button>
      )}
      <p className={SECONDARY_LINE}>{demoCopy.disclosure}</p>
      {control.kind === "button" && control.line === "failed" && (
        <p role="alert" className={ERROR_LINE}>
          {demoCopy.failed}
        </p>
      )}
      {control.kind === "button" && control.line === "wait" && (
        <p role="status" className="text-xs text-zinc-400">
          {demoCopy.wait}
        </p>
      )}
    </div>
  );
}

function label(of: Extract<Control, { kind: "button" }>["label"]): string {
  switch (of.kind) {
    case "open":
      return demoCopy.open;
    case "opening":
      return demoCopy.opening;
    case "wait":
      return demoCopy.waitButton(of.seconds);
  }
}
