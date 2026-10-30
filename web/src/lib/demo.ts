import type { DemoOpened, DemoResponse } from "@anime-tcg/shared/api";

/**
 * The demo pack of `/` and `/demo` (navigation-and-landing.md §3.7, §3.14,
 * §4.5, §4.9). The browser rolls nothing: every card is the server's, and
 * nothing here is stored, sent back or kept for an account.
 *
 * The **visit** is everything the demo holds: how many demo packs this page
 * load has revealed, a 429 wait, the current cards, an opening in flight and
 * the last answer's state. It lasts for the document's lifetime (manager
 * decision, 2026-10-30; §3.14 step 6), so moving between `/`, `/demo` and the
 * other public pages with links, Back or Forward keeps it; a reload or a
 * sign-in starts it over. The root layout holds it in memory, never in storage.
 */
export interface DemoVisit {
  /** Demo packs revealed this page load. */
  revealed: number;
  /** `performance.now()` at which a 429's wait ends. */
  waitUntil: number | null;
  /** Whether the 429 named its wait: only then does the button count it down (§8 "Wait without Retry-After"). */
  waitCounted: boolean;
  /** The current demo pack; earlier ones are not kept. */
  pack: DemoPack | null;
  opening: boolean;
  /** A 503: no demo packs this page load. */
  unavailable: boolean;
  /** The last try got no answer, or a 400, 403 or other envelope: the failure line until the next try. */
  failed: boolean;
}

export interface DemoPack {
  /** Numbered by the visit's count, so a new pack's cards are told from the last one's. */
  n: number;
  opened: DemoOpened;
  /** Whether it landed while `/demo` was showing or about to: only then do its cards enter (§3.14 step 6). */
  landedShowing: boolean;
}

export type DemoVisitAction =
  /** `clearCards`: opened from `/`, so `/demo` shows five empty slots until the answer (§3.14 step 3). */
  | { type: "openStarted"; clearCards: boolean }
  | { type: "opened"; opened: DemoOpened; landedShowing: boolean }
  | { type: "unavailable" }
  | { type: "rateLimited"; until: number; counted: boolean }
  | { type: "failed" };

export const initialVisit: DemoVisit = {
  revealed: 0,
  waitUntil: null,
  waitCounted: false,
  pack: null,
  opening: false,
  unavailable: false,
  failed: false,
};

export function visitReducer(visit: DemoVisit, action: DemoVisitAction): DemoVisit {
  switch (action.type) {
    case "openStarted":
      // A failure line from the last try goes, so the next one is announced afresh.
      return { ...visit, opening: true, failed: false, pack: action.clearCards ? null : visit.pack };
    case "opened":
      // The visit counts every pack the server dealt, even one that lands after the page was left.
      return {
        ...visit,
        opening: false,
        revealed: visit.revealed + 1,
        pack: { n: visit.revealed + 1, opened: action.opened, landedShowing: action.landedShowing },
      };
    case "unavailable":
      return { ...visit, opening: false, unavailable: true };
    case "rateLimited":
      return { ...visit, opening: false, waitUntil: action.until, waitCounted: action.counted };
    case "failed":
      return { ...visit, opening: false, failed: true };
  }
}

/**
 * The visit's cap while the facts have not answered (loading or failed): the
 * owner's 10 (§9 decision 3), so the cap holds without them (manager
 * decision, 2026-10-30). The answer's `perVisit` wins once it arrives; the web
 * app may not import the server's `DEMO_PACKS_PER_VISIT`.
 */
export const DEMO_PACKS_PER_VISIT_FALLBACK = 10;

/** What stands where the demo button is (§4.5, §4.9): the button, the unavailable line, or after the last pack the Join offer. */
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
  /** `To keep cards, register…`: under the cards on `/demo`, until the Join offer takes its place. */
  keepCards: boolean;
}

/** The visit's cap: the facts' `perVisit`, or the fallback until they answer. */
export function perVisit(facts: DemoResponse | undefined): number {
  return facts?.perVisit ?? DEMO_PACKS_PER_VISIT_FALLBACK;
}

/**
 * The view from the visit, the facts (undefined while they load or after they
 * failed) and the 429 wait's seconds left (null when none runs). The server's
 * rate limit is the real bound either way (§3.8 item 5).
 */
export function demoView(visit: DemoVisit, facts: DemoResponse | undefined, wait: number | null): DemoView {
  const done = visit.revealed >= perVisit(facts);
  const keepCards = visit.pack !== null && !done;
  if (done) return { control: { kind: "done" }, keepCards };
  if (visit.unavailable || facts?.odds === null) return { control: { kind: "unavailable" }, keepCards };
  const waiting = wait !== null && wait > 0;
  const label: DemoLabel = visit.opening
    ? { kind: "opening" }
    : waiting && visit.waitCounted
      ? { kind: "wait", seconds: wait }
      : { kind: "open" };
  const line = visit.failed ? "failed" : waiting ? "wait" : null;
  return { control: { kind: "button", label, enabled: !visit.opening && !waiting, line }, keepCards };
}
