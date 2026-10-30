import type { PublishedOdds } from "@anime-tcg/shared/api";
import { controlRow, type Held, type OpeningLine, type Row } from "./game";
import { packControlCopy } from "./packsCopy";

/** What the page knows when it renders the pack control (packs-page.md §4.1). */
export interface ControlInput {
  held: Held | null;
  odds: PublishedOdds | null;
  /** The first `GET /api/packs` failed and nothing is held. */
  loadFailed: boolean;
  /** The first `GET` has taken longer than 300 ms. */
  showLoading: boolean;
  opening: boolean;
  keyHeld: boolean;
  /** Seconds to the next pack, from the held answer's countdown. */
  countdown: number | null;
  /** The countdown's zero-time `GET` got no answer or an error envelope, and no newer answer is held since. */
  checkFailed: boolean;
  /** Seconds left of a 429's wait; 0 or null when none runs. */
  wait: number | null;
  line: OpeningLine["kind"] | null;
}

export type CountdownView = { kind: "time"; seconds: number } | { kind: "checkFailed" };

export interface ControlShown {
  kind: "control";
  row: Row;
  count: string;
  button: { label: string; enabled: boolean };
  /** Waiting for a pack: the button is described by the countdown, which says why and for how long. */
  describedByCountdown: boolean;
  line: OpeningLine["kind"] | null;
  /** Cards unavailable: the line and `Check again` under the button. */
  unavailable: boolean;
  /** Null at the cap: no countdown line and no timer. */
  countdown: CountdownView | null;
  pity: string | null;
  showOdds: boolean;
}

export type ControlView = { kind: "blank" } | { kind: "loading" } | { kind: "loadFailed" } | ControlShown;

type ButtonInput = Pick<ControlInput, "odds" | "opening" | "keyHeld" | "wait">;

function buttonFor(input: ButtonInput, held: Held | null): ControlShown["button"] {
  const waiting = input.wait !== null && input.wait > 0;
  const hasPack = input.odds !== null && held !== null && held.allowance.available >= 1;
  const enabled = !input.opening && !waiting && (input.keyHeld || hasPack);
  let label: string = packControlCopy.open;
  if (input.opening) label = packControlCopy.opening;
  else if (waiting && input.wait !== null) label = packControlCopy.waitButton(input.wait);
  else if (input.keyHeld) label = packControlCopy.tryAgain;
  return { label, enabled };
}

/** The pack control for every row of §4.1, from the held answer and the page's own state. */
export function packControlView(input: ControlInput): ControlView {
  const { held, odds } = input;
  if (held === null) {
    if (input.loadFailed) return { kind: "loadFailed" };
    return input.showLoading ? { kind: "loading" } : { kind: "blank" };
  }
  const row = controlRow(held, odds);
  const { available, cap, nextPackInSeconds } = held.allowance;
  let countdown: CountdownView | null = null;
  if (nextPackInSeconds !== null) {
    countdown = input.checkFailed
      ? { kind: "checkFailed" }
      : { kind: "time", seconds: input.countdown ?? nextPackInSeconds };
  }
  const pity =
    odds === null || held.packsUntilGuarantee === null
      ? null
      : packControlCopy.pity(held.packsUntilGuarantee, odds.pity.freePacksOnly);
  return {
    kind: "control",
    row,
    count: packControlCopy.count(available, cap),
    button: buttonFor(input, held),
    describedByCountdown: row === "waiting" && countdown?.kind === "time",
    line: input.line,
    unavailable: row === "unavailable",
    countdown,
    pity,
    showOdds: odds !== null,
  };
}

/** `/packs/open`'s action row (packs-page.md §3.7 steps 2 to 5): the count line and `Open pack`. */
export interface OpeningControlView {
  /** Null until an allowance is held. */
  count: string | null;
  button: { label: string; enabled: boolean };
  /** No pack ready: the button is described by the count line, and `Back to packs` beside it leads to the countdown. */
  describedByCount: boolean;
}

/**
 * The opening page's control: `Open pack` under the same rules as on `/packs`
 * (§3.3), with no countdown, pity line or odds. A line under the button never
 * shows here, since an answer without cards replaces the page with `/packs`.
 */
export function openingControlView(input: ButtonInput & { held: Held | null }): OpeningControlView {
  const { held } = input;
  const button = buttonFor(input, held);
  return {
    count: held === null ? null : packControlCopy.count(held.allowance.available, held.allowance.cap),
    button,
    describedByCount: held !== null && !input.opening && held.allowance.available === 0,
  };
}
