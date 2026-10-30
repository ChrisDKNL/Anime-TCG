import type { DemoOpened, DemoResponse } from "@anime-tcg/shared/api";

/**
 * The landing page's demo pack (navigation-and-landing.md §3.7, §4.5) in two
 * parts. The browser rolls nothing: every card is the server's, and nothing
 * here is stored, sent back or kept for an account.
 *
 * - The **visit**: how many demo packs this page load has revealed and any
 *   429 wait. It lasts for the document's lifetime (manager decision,
 *   2026-10-30), so a link out of `/` and Back, Forward or the wordmark keep
 *   it; a reload starts it over. The root layout holds it, never storage.
 * - The **page**: the cards on screen, an opening in flight, a 503 and the
 *   failure line. It goes when `/` is left, so the cards are not kept.
 */
export interface DemoVisit {
  /** Demo packs revealed this page load. */
  revealed: number;
  /** `performance.now()` at which a 429's wait ends. */
  waitUntil: number | null;
  /** Whether the 429 named its wait: only then does the button count it down (§8 "Wait without Retry-After"). */
  waitCounted: boolean;
}

export type DemoVisitAction = { type: "revealed" } | { type: "rateLimited"; until: number; counted: boolean };

export const initialVisit: DemoVisit = { revealed: 0, waitUntil: null, waitCounted: false };

export function visitReducer(visit: DemoVisit, action: DemoVisitAction): DemoVisit {
  switch (action.type) {
    case "revealed":
      return { ...visit, revealed: visit.revealed + 1 };
    case "rateLimited":
      return { ...visit, waitUntil: action.until, waitCounted: action.counted };
  }
}

export interface DemoPage {
  /** The last demo pack, numbered so a new one's cards enter afresh; earlier ones are not kept. */
  pack: { n: number; opened: DemoOpened } | null;
  opening: boolean;
  /** A 503: no demo packs while the page shows. */
  unavailable: boolean;
  failed: boolean;
}

export type DemoPageAction =
  | { type: "openStarted" }
  | { type: "opened"; opened: DemoOpened }
  | { type: "unavailable" }
  | { type: "settled" }
  | { type: "failed" };

export const initialPage: DemoPage = { pack: null, opening: false, unavailable: false, failed: false };

export function pageReducer(page: DemoPage, action: DemoPageAction): DemoPage {
  switch (action.type) {
    case "openStarted":
      // A failure line from the last try goes, so the next one is announced afresh.
      return { ...page, opening: true, failed: false };
    case "opened":
      return { ...page, opening: false, pack: { n: (page.pack?.n ?? 0) + 1, opened: action.opened } };
    case "unavailable":
      return { ...page, opening: false, unavailable: true };
    case "settled":
      return { ...page, opening: false };
    case "failed":
      return { ...page, opening: false, failed: true };
  }
}

/**
 * The visit's cap while the facts have not answered (loading or failed): the
 * owner's 10 (§9 decision 3), so the cap holds without them (manager
 * decision, 2026-10-30). The answer's `perVisit` wins once it arrives; the web
 * app may not import the server's `DEMO_PACKS_PER_VISIT`.
 */
export const DEMO_PACKS_PER_VISIT_FALLBACK = 10;

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
  /** `To keep cards, register…`: under the cards on screen, until the Join offer takes its place. */
  keepCards: boolean;
}

/** The visit's cap: the facts' `perVisit`, or the fallback until they answer. */
export function perVisit(facts: DemoResponse | undefined): number {
  return facts?.perVisit ?? DEMO_PACKS_PER_VISIT_FALLBACK;
}

/**
 * The view from the page, the visit, the facts (undefined while they load or
 * after they failed) and the 429 wait's seconds left (null when none runs).
 * The server's rate limit is the real bound either way (§3.8 item 5).
 */
export function demoView(
  page: DemoPage,
  visit: DemoVisit,
  facts: DemoResponse | undefined,
  wait: number | null,
): DemoView {
  const done = visit.revealed >= perVisit(facts);
  const keepCards = page.pack !== null && !done;
  if (done) return { control: { kind: "done" }, keepCards };
  if (page.unavailable || facts?.odds === null) return { control: { kind: "unavailable" }, keepCards };
  const waiting = wait !== null && wait > 0;
  const label: DemoLabel = page.opening
    ? { kind: "opening" }
    : waiting && visit.waitCounted
      ? { kind: "wait", seconds: wait }
      : { kind: "open" };
  const line = page.failed ? "failed" : waiting ? "wait" : null;
  return { control: { kind: "button", label, enabled: !page.opening && !waiting, line }, keepCards };
}
