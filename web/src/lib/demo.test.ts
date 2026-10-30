import { describe, expect, it } from "vitest";
import { makeDemo, makeDemoOpened, makeUnavailableDemo } from "../test/fixtures";
import {
  DEMO_PACKS_PER_VISIT_FALLBACK,
  type DemoVisit,
  type DemoVisitAction,
  demoView,
  initialVisit,
  perVisit,
  visitReducer,
} from "./demo";

const facts = makeDemo();
const visit = (...actions: DemoVisitAction[]): DemoVisit => actions.reduce(visitReducer, initialVisit);
const revealed = (n: number): DemoVisit => ({ ...initialVisit, revealed: n });
const fromDemo: DemoVisitAction = { type: "openStarted", clearCards: false };
const fromLanding: DemoVisitAction = { type: "openStarted", clearCards: true };
const opened: DemoVisitAction[] = [
  fromDemo,
  { type: "opened", opened: makeDemoOpened(), landedShowing: true },
];
const shown = visit(...opened);
/** A visit with cards on screen and `n` packs revealed. */
const shownAfter = (n: number): DemoVisit => ({ ...shown, revealed: n });

describe("the demo's visit (manager decision, 2026-10-30; §3.14 step 6)", () => {
  it("counts every revealed pack, numbers each by the count, and holds the last 429's wait", () => {
    const state = visit(...opened, ...opened, { type: "rateLimited", until: 5_000, counted: true });
    expect(state).toMatchObject({ revealed: 2, waitUntil: 5_000, waitCounted: true, opening: false });
    expect(state.pack?.n).toBe(2);
    expect(visitReducer(state, { type: "rateLimited", until: 9_000, counted: false })).toMatchObject({
      revealed: 2,
      waitUntil: 9_000,
      waitCounted: false,
    });
  });

  it("caps at the facts' perVisit, and at the fallback of 10 while the facts are loading or failed", () => {
    expect(DEMO_PACKS_PER_VISIT_FALLBACK).toBe(10);
    expect(perVisit(undefined)).toBe(10);
    expect(perVisit(makeDemo({ perVisit: 3 }))).toBe(3);
    expect(demoView(revealed(9), undefined, null).control.kind).toBe("button");
    expect(demoView(shownAfter(10), undefined, null)).toEqual({
      control: { kind: "done" },
      keepCards: false,
    });
    expect(demoView(revealed(3), makeDemo({ perVisit: 3 }), null).control.kind).toBe("done");
    expect(demoView(revealed(12), makeDemo({ perVisit: 20 }), null).control.kind).toBe("button");
  });
});

describe("the demo's control and cards (navigation-and-landing.md §3.7, §3.14, §4.5, §4.9)", () => {
  it("idle: the open button, enabled, no line and no keep-cards line, before and after the facts", () => {
    for (const answer of [undefined, facts]) {
      expect(demoView(initialVisit, answer, null)).toEqual({
        control: { kind: "button", label: { kind: "open" }, enabled: true, line: null },
        keepCards: false,
      });
    }
  });

  it("opening on `/demo`: `Opening…`, aria-disabled, the previous pack kept until the answer", () => {
    const state = visitReducer(shown, fromDemo);
    expect(state.pack?.n).toBe(1);
    expect(demoView(state, facts, null).control).toEqual({
      kind: "button",
      label: { kind: "opening" },
      enabled: false,
      line: null,
    });
  });

  it("opening from `/`: the held cards go at once, so `/demo` starts from five empty slots", () => {
    const state = visitReducer(shown, fromLanding);
    expect(state).toMatchObject({ opening: true, pack: null, revealed: 1 });
    expect(demoView(state, facts, null).keepCards).toBe(false);
  });

  it("each answer replaces the pack under a new number; the keep-cards line shows under held cards only", () => {
    const state = visit(...opened, ...opened, ...opened);
    expect(state).toMatchObject({
      opening: false,
      revealed: 3,
      pack: { n: 3, opened: makeDemoOpened(), landedShowing: true },
    });
    expect(demoView(state, facts, null)).toMatchObject({ control: { kind: "button" }, keepCards: true });
    expect(demoView(revealed(3), facts, null).keepCards).toBe(false);
  });

  it("the perVisit-th pack: the Join offer in the button's place and no keep-cards line; the pack stays", () => {
    expect(demoView(shownAfter(facts.perVisit - 1), facts, null).control.kind).toBe("button");
    const done = shownAfter(facts.perVisit);
    expect(demoView(done, facts, null)).toEqual({ control: { kind: "done" }, keepCards: false });
    expect(done.pack).not.toBeNull();
  });

  it("no pool in the facts: the unavailable line in the button's place", () => {
    expect(demoView(initialVisit, makeUnavailableDemo(), null)).toEqual({
      control: { kind: "unavailable" },
      keepCards: false,
    });
  });

  it("a 503: the unavailable line; the cards already shown stay", () => {
    const state = visit(...opened, fromDemo, { type: "unavailable" });
    expect(state.pack?.n).toBe(1);
    expect(demoView(state, facts, null)).toEqual({ control: { kind: "unavailable" }, keepCards: true });
  });

  it("a 429 with Retry-After: the button counts down, aria-disabled, the wait line under it; at 0 it is back", () => {
    const waiting = visit(fromDemo, { type: "rateLimited", until: 5_000, counted: true });
    expect(waiting.opening).toBe(false);
    expect(demoView(waiting, facts, 3).control).toEqual({
      kind: "button",
      label: { kind: "wait", seconds: 3 },
      enabled: false,
      line: "wait",
    });
    expect(demoView(waiting, facts, 0).control).toEqual({
      kind: "button",
      label: { kind: "open" },
      enabled: true,
      line: null,
    });
  });

  it("a 429 without Retry-After: `Open a demo pack`, aria-disabled, with the wait line, for the whole wait", () => {
    const waiting = visit({ type: "rateLimited", until: 60_000, counted: false });
    expect(demoView(waiting, facts, 42).control).toEqual({
      kind: "button",
      label: { kind: "open" },
      enabled: false,
      line: "wait",
    });
  });

  it("a failure: the failure line under an enabled button, kept cards; the next try clears it", () => {
    const failed = visit(...opened, fromDemo, { type: "failed" });
    expect(failed.pack?.n).toBe(1);
    expect(demoView(failed, facts, null)).toEqual({
      control: { kind: "button", label: { kind: "open" }, enabled: true, line: "failed" },
      keepCards: true,
    });
    expect(demoView(visitReducer(failed, fromDemo), facts, null).control).toMatchObject({ line: null });
  });
});
