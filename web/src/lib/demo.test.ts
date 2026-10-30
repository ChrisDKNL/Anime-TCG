import { describe, expect, it } from "vitest";
import { makeDemo, makeDemoOpened, makeUnavailableDemo } from "../test/fixtures";
import {
  DEMO_PACKS_PER_VISIT_FALLBACK,
  type DemoPage,
  type DemoPageAction,
  type DemoVisit,
  type DemoVisitAction,
  demoView,
  initialPage,
  initialVisit,
  pageReducer,
  perVisit,
  visitReducer,
} from "./demo";

const facts = makeDemo();
const page = (...actions: DemoPageAction[]): DemoPage => actions.reduce(pageReducer, initialPage);
const visit = (...actions: DemoVisitAction[]): DemoVisit => actions.reduce(visitReducer, initialVisit);
const revealed = (n: number): DemoVisit => ({ ...initialVisit, revealed: n });
const opened: DemoPageAction[] = [{ type: "openStarted" }, { type: "opened", opened: makeDemoOpened() }];
const shown = page(...opened);

describe("the demo's visit (manager decision, 2026-10-30)", () => {
  it("counts every revealed pack and holds the last 429's wait", () => {
    const state = visit(
      { type: "revealed" },
      { type: "revealed" },
      { type: "rateLimited", until: 5_000, counted: true },
    );
    expect(state).toEqual({ revealed: 2, waitUntil: 5_000, waitCounted: true });
    expect(visitReducer(state, { type: "rateLimited", until: 9_000, counted: false })).toEqual({
      revealed: 2,
      waitUntil: 9_000,
      waitCounted: false,
    });
  });

  it("caps at the facts' perVisit, and at the fallback of 10 while the facts are loading or failed", () => {
    expect(DEMO_PACKS_PER_VISIT_FALLBACK).toBe(10);
    expect(perVisit(undefined)).toBe(10);
    expect(perVisit(makeDemo({ perVisit: 3 }))).toBe(3);
    expect(demoView(initialPage, revealed(9), undefined, null).control.kind).toBe("button");
    expect(demoView(shown, revealed(10), undefined, null)).toEqual({
      control: { kind: "done" },
      keepCards: false,
    });
    expect(demoView(initialPage, revealed(3), makeDemo({ perVisit: 3 }), null).control.kind).toBe("done");
    expect(demoView(initialPage, revealed(12), makeDemo({ perVisit: 20 }), null).control.kind).toBe("button");
  });
});

describe("the demo's page (navigation-and-landing.md §3.7, §4.5)", () => {
  it("idle: the open button, enabled, no line and no keep-cards line, before and after the facts", () => {
    for (const answer of [undefined, facts]) {
      expect(demoView(initialPage, initialVisit, answer, null)).toEqual({
        control: { kind: "button", label: { kind: "open" }, enabled: true, line: null },
        keepCards: false,
      });
    }
  });

  it("opening: `Opening…`, aria-disabled, the previous pack kept until the answer", () => {
    const state = pageReducer(shown, { type: "openStarted" });
    expect(state.pack?.n).toBe(1);
    expect(demoView(state, revealed(1), facts, null).control).toEqual({
      kind: "button",
      label: { kind: "opening" },
      enabled: false,
      line: null,
    });
  });

  it("each answer replaces the pack under a new number; the keep-cards line shows under cards on screen only", () => {
    const state = page(...opened, ...opened, ...opened);
    expect(state).toMatchObject({ opening: false, pack: { n: 3, opened: makeDemoOpened() } });
    expect(demoView(state, revealed(3), facts, null)).toMatchObject({
      control: { kind: "button" },
      keepCards: true,
    });
    // Back on `/` after a link out: the count goes on, the cards and their line do not.
    expect(demoView(initialPage, revealed(3), facts, null).keepCards).toBe(false);
  });

  it("the perVisit-th pack: the Join offer in the button's place and no keep-cards line; the pack stays", () => {
    expect(demoView(shown, revealed(facts.perVisit - 1), facts, null).control.kind).toBe("button");
    expect(demoView(shown, revealed(facts.perVisit), facts, null)).toEqual({
      control: { kind: "done" },
      keepCards: false,
    });
  });

  it("no pool in the facts: the unavailable line in the button's place", () => {
    expect(demoView(initialPage, initialVisit, makeUnavailableDemo(), null)).toEqual({
      control: { kind: "unavailable" },
      keepCards: false,
    });
  });

  it("a 503: the unavailable line; the cards already shown stay", () => {
    const state = page(...opened, { type: "openStarted" }, { type: "unavailable" });
    expect(state.pack?.n).toBe(1);
    expect(demoView(state, revealed(1), facts, null)).toEqual({
      control: { kind: "unavailable" },
      keepCards: true,
    });
  });

  it("a 429 with Retry-After: the button counts down, aria-disabled, the wait line under it; at 0 it is back", () => {
    const state = page({ type: "openStarted" }, { type: "settled" });
    const waiting = visit({ type: "rateLimited", until: 5_000, counted: true });
    expect(demoView(state, waiting, facts, 3).control).toEqual({
      kind: "button",
      label: { kind: "wait", seconds: 3 },
      enabled: false,
      line: "wait",
    });
    expect(demoView(state, waiting, facts, 0).control).toEqual({
      kind: "button",
      label: { kind: "open" },
      enabled: true,
      line: null,
    });
  });

  it("a 429 without Retry-After: `Open a demo pack`, aria-disabled, with the wait line, for the whole wait", () => {
    const waiting = visit({ type: "rateLimited", until: 60_000, counted: false });
    expect(demoView(initialPage, waiting, facts, 42).control).toEqual({
      kind: "button",
      label: { kind: "open" },
      enabled: false,
      line: "wait",
    });
  });

  it("a failure: the failure line under an enabled button, kept cards; the next try clears it", () => {
    const failed = page(...opened, { type: "openStarted" }, { type: "failed" });
    expect(failed.pack?.n).toBe(1);
    expect(demoView(failed, revealed(1), facts, null)).toEqual({
      control: { kind: "button", label: { kind: "open" }, enabled: true, line: "failed" },
      keepCards: true,
    });
    expect(
      demoView(pageReducer(failed, { type: "openStarted" }), revealed(1), facts, null).control,
    ).toMatchObject({
      line: null,
    });
  });
});
