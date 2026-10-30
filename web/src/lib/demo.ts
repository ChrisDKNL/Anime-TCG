import type { DemoOpened, DemoResponse } from "@anime-tcg/shared/api";

/**
 * The landing page's demo pack (navigation-and-landing.md §3.7, §4.5) as a
 * page-load's state: the last pack the server dealt, how many have landed,
 * and the one line under the button. It lives in the landing page's
 * component state only; nothing here is stored, sent back or kept for an
 * account, and a reload starts it over. The browser rolls nothing: every card
 * is the server's.
 */
export interface DemoState {
  /** The last demo pack, numbered so a new one's cards enter afresh; earlier ones are not kept. */
  pack: { n: number; opened: DemoOpened } | null;
  /** Demo packs revealed this page load. */
  revealed: number;
  opening: boolean;
  /** A 503: no demo packs until a reload. */
  unavailable: boolean;
  line: "failed" | "wait" | null;
  /** `performance.now()` at which a 429's wait ends. */
  waitUntil: number | null;
  /** Whether the 429 named its wait: only then does the button count it down (§8 "Wait without Retry-After"). */
  waitCounted: boolean;
}

export type DemoAction =
  | { type: "openStarted" }
  | { type: "opened"; opened: DemoOpened }
  | { type: "unavailable" }
  | { type: "rateLimited"; until: number; counted: boolean }
  | { type: "failed" };

export const initialDemo: DemoState = {
  pack: null,
  revealed: 0,
  opening: false,
  unavailable: false,
  line: null,
  waitUntil: null,
  waitCounted: false,
};

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "openStarted":
      // A failure line from the last try goes, so the next one is announced afresh.
      return { ...state, opening: true, line: null };
    case "opened":
      return {
        ...state,
        opening: false,
        line: null,
        pack: { n: state.revealed + 1, opened: action.opened },
        revealed: state.revealed + 1,
      };
    case "unavailable":
      return { ...state, opening: false, line: null, unavailable: true };
    case "rateLimited":
      return { ...state, opening: false, line: "wait", waitUntil: action.until, waitCounted: action.counted };
    case "failed":
      return { ...state, opening: false, line: "failed" };
  }
}

/** What stands where the demo button is (§4.5): the button, the unavailable line, or after the last pack the Join offer. */
export type DemoControl =
  | {
      kind: "button";
      label: DemoLabel;
      enabled: boolean;
      /** The line under the button, at most one. */
      line: "failed" | "wait" | null;
    }
  | { kind: "unavailable" }
  | { kind: "done" };

export type DemoLabel = { kind: "open" } | { kind: "opening" } | { kind: "wait"; seconds: number };

export interface DemoView {
  control: DemoControl;
  /** `To keep cards, register…`: after the first reveal, until the Join offer takes its place. */
  keepCards: boolean;
}

/**
 * The view from the state, the facts (undefined while they load or after
 * they failed) and the 429 wait's seconds left (null when none runs). The
 * page's count of `perVisit` comes from the facts; without them nothing caps
 * the visit, and the server's rate limit is the bound either way (§3.8 item 5).
 */
export function demoView(state: DemoState, facts: DemoResponse | undefined, wait: number | null): DemoView {
  const done = facts !== undefined && state.revealed >= facts.perVisit;
  const keepCards = state.revealed >= 1 && !done;
  if (done) return { control: { kind: "done" }, keepCards };
  if (state.unavailable || facts?.odds === null) return { control: { kind: "unavailable" }, keepCards };
  const waiting = state.line === "wait" && wait !== null && wait > 0;
  const label: DemoLabel = state.opening
    ? { kind: "opening" }
    : waiting && state.waitCounted
      ? { kind: "wait", seconds: wait }
      : { kind: "open" };
  const line = state.line === "wait" ? (waiting ? "wait" : null) : state.line;
  return { control: { kind: "button", label, enabled: !state.opening && !waiting, line }, keepCards };
}
