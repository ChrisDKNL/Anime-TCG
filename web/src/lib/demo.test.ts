import { describe, expect, it } from "vitest";
import { makeDemo, makeDemoOpened, makeUnavailableDemo } from "../test/fixtures";
import { type DemoAction, type DemoState, demoReducer, demoView, initialDemo } from "./demo";

const facts = makeDemo();
const run = (...actions: DemoAction[]): DemoState => actions.reduce(demoReducer, initialDemo);
const opened = (n: number): DemoAction[] =>
  Array.from(
    { length: n },
    () => [{ type: "openStarted" }, { type: "opened", opened: makeDemoOpened() }] as const,
  ).flat();

describe("demo state (navigation-and-landing.md §3.7, §4.5)", () => {
  it("idle: the open button, enabled, no line and no keep-cards line, before and after the facts", () => {
    for (const answer of [undefined, facts]) {
      expect(demoView(initialDemo, answer, null)).toEqual({
        control: { kind: "button", label: { kind: "open" }, enabled: true, line: null },
        keepCards: false,
      });
    }
  });

  it("opening: `Opening…`, aria-disabled, the previous pack kept until the answer", () => {
    const state = run(...opened(1), { type: "openStarted" });
    expect(state.pack?.n).toBe(1);
    expect(demoView(state, facts, null).control).toEqual({
      kind: "button",
      label: { kind: "opening" },
      enabled: false,
      line: null,
    });
  });

  it("each answer replaces the pack under a new number, counts it, and shows the keep-cards line", () => {
    const state = run(...opened(3));
    expect(state).toMatchObject({ revealed: 3, opening: false, pack: { n: 3, opened: makeDemoOpened() } });
    expect(demoView(state, facts, null)).toMatchObject({ control: { kind: "button" }, keepCards: true });
  });

  it("the perVisit-th pack: the Join offer in the button's place and no keep-cards line; the pack stays", () => {
    const ninth = run(...opened(facts.perVisit - 1));
    expect(demoView(ninth, facts, null).control.kind).toBe("button");
    const tenth = run(...opened(facts.perVisit));
    expect(demoView(tenth, facts, null)).toEqual({ control: { kind: "done" }, keepCards: false });
    expect(tenth.pack?.n).toBe(facts.perVisit);
    expect(demoView(run(...opened(2)), makeDemo({ perVisit: 2 }), null).control.kind).toBe("done");
  });

  it("without the facts nothing caps the visit: the server's rate limit is the bound", () => {
    expect(demoView(run(...opened(25)), undefined, null).control.kind).toBe("button");
  });

  it("no pool in the facts: the unavailable line in the button's place", () => {
    expect(demoView(initialDemo, makeUnavailableDemo(), null)).toEqual({
      control: { kind: "unavailable" },
      keepCards: false,
    });
  });

  it("a 503: the unavailable line for the rest of the visit; the cards already shown stay", () => {
    const state = run(...opened(2), { type: "openStarted" }, { type: "unavailable" });
    expect(state.pack?.n).toBe(2);
    expect(demoView(state, facts, null)).toEqual({ control: { kind: "unavailable" }, keepCards: true });
  });

  it("a 429 with Retry-After: the button counts down, aria-disabled, the wait line under it; at 0 it is back", () => {
    const state = run({ type: "openStarted" }, { type: "rateLimited", until: 5_000, counted: true });
    expect(demoView(state, facts, 3).control).toEqual({
      kind: "button",
      label: { kind: "wait", seconds: 3 },
      enabled: false,
      line: "wait",
    });
    expect(demoView(state, facts, 0).control).toEqual({
      kind: "button",
      label: { kind: "open" },
      enabled: true,
      line: null,
    });
  });

  it("a 429 without Retry-After: `Open a demo pack`, aria-disabled, with the wait line, for the whole wait", () => {
    const state = run({ type: "openStarted" }, { type: "rateLimited", until: 60_000, counted: false });
    expect(demoView(state, facts, 42).control).toEqual({
      kind: "button",
      label: { kind: "open" },
      enabled: false,
      line: "wait",
    });
  });

  it("a failure: the failure line under an enabled button, kept cards; the next try clears it", () => {
    const failed = run(...opened(1), { type: "openStarted" }, { type: "failed" });
    expect(failed.pack?.n).toBe(1);
    expect(demoView(failed, facts, null)).toEqual({
      control: { kind: "button", label: { kind: "open" }, enabled: true, line: "failed" },
      keepCards: true,
    });
    expect(demoView(demoReducer(failed, { type: "openStarted" }), facts, null).control).toMatchObject({
      line: null,
    });
  });
});
