import type { PackAllowance } from "@anime-tcg/shared/api";
import { describe, expect, it } from "vitest";
import { makeAllowance, makeOdds } from "../test/fixtures";
import type { Held } from "./game";
import { packControlView, type ControlInput, type ControlShown } from "./packControl";

const odds = makeOdds();

function held(allowance: Partial<PackAllowance>, packsUntilGuarantee: number | null = 300): Held {
  return { seq: 1, receivedAt: 0, allowance: makeAllowance(allowance), packsUntilGuarantee };
}

const IDLE: ControlInput = {
  held: held({ available: 2, nextPackInSeconds: 462 }),
  odds,
  loadFailed: false,
  showLoading: false,
  opening: false,
  keyHeld: false,
  countdown: 462,
  checkFailed: false,
  wait: null,
  line: null,
};

function shown(input: Partial<ControlInput>): ControlShown {
  const view = packControlView({ ...IDLE, ...input });
  if (view.kind !== "control") throw new Error(`expected the control, got ${view.kind}`);
  return view;
}

describe("packControlView: every row of packs-page.md §4.1", () => {
  it("first GET under 300 ms: blank; over 300 ms: loading; failed with nothing held: the load failure", () => {
    expect(packControlView({ ...IDLE, held: null })).toEqual({ kind: "blank" });
    expect(packControlView({ ...IDLE, held: null, showLoading: true })).toEqual({ kind: "loading" });
    expect(packControlView({ ...IDLE, held: null, showLoading: true, loadFailed: true })).toEqual({
      kind: "loadFailed",
    });
  });

  it("ready below the cap: the count, Open pack, the countdown, the pity line and Pack odds", () => {
    expect(shown({})).toEqual({
      kind: "control",
      row: "ready",
      count: "2 of 3 packs ready",
      button: { label: "Open pack", enabled: true },
      describedByCountdown: false,
      line: null,
      unavailable: false,
      countdown: { kind: "time", seconds: 462 },
      pity: "Mythic guaranteed within 300 free packs.",
      showOdds: true,
    });
  });

  it("at the cap: no countdown line and no timer", () => {
    const view = shown({ held: held({ available: 3, nextPackInSeconds: null }), countdown: null });
    expect(view).toMatchObject({ row: "atCap", count: "3 of 3 packs ready", countdown: null });
    expect(view.button).toEqual({ label: "Open pack", enabled: true });
  });

  it("waiting: Open pack aria-disabled and described by the countdown", () => {
    const view = shown({ held: held({ available: 0, nextPackInSeconds: 600 }), countdown: 599 });
    expect(view).toMatchObject({
      row: "waiting",
      count: "0 of 3 packs ready",
      button: { label: "Open pack", enabled: false },
      describedByCountdown: true,
      countdown: { kind: "time", seconds: 599 },
    });
  });

  it("countdown at zero, checking: still reads 0:00 and the button stays as it was", () => {
    const view = shown({ held: held({ available: 0, nextPackInSeconds: 600 }), countdown: 0 });
    expect(view.countdown).toEqual({ kind: "time", seconds: 0 });
    expect(view.button.enabled).toBe(false);
  });

  it("before the countdown hook has a value, the held answer's seconds show", () => {
    expect(shown({ countdown: null }).countdown).toEqual({ kind: "time", seconds: 462 });
  });

  it("countdown check failed: the check-failed line in place of the countdown", () => {
    const view = shown({ held: held({ available: 0, nextPackInSeconds: 600 }), checkFailed: true });
    expect(view.countdown).toEqual({ kind: "checkFailed" });
    expect(view.describedByCountdown).toBe(false);
    expect(view.count).toBe("0 of 3 packs ready");
  });

  it("opening: Opening…, unusable; count, countdown and pity unchanged", () => {
    const view = shown({ opening: true });
    expect(view.button).toEqual({ label: "Opening…", enabled: false });
    expect(view).toMatchObject({ count: "2 of 3 packs ready", countdown: { seconds: 462 } });
    expect(view.pity).toBe("Mythic guaranteed within 300 free packs.");
  });

  it("none left (409): no pack ready, the countdown, the line", () => {
    const view = shown({
      held: held({ available: 0, nextPackInSeconds: 420 }),
      countdown: 420,
      line: "noneLeft",
    });
    expect(view).toMatchObject({ row: "waiting", line: "noneLeft", button: { enabled: false } });
  });

  it("no answer with a key held: Try again, enabled even with no pack left or cards unavailable", () => {
    expect(shown({ keyHeld: true, line: "noAnswer" })).toMatchObject({
      button: { label: "Try again", enabled: true },
      line: "noAnswer",
    });
    expect(shown({ keyHeld: true, held: held({ available: 0, nextPackInSeconds: 60 }) }).button).toEqual({
      label: "Try again",
      enabled: true,
    });
    expect(shown({ keyHeld: true, odds: null }).button).toEqual({ label: "Try again", enabled: true });
  });

  it("cards unavailable: the unavailable line, the button unusable, no pity line and no Pack odds", () => {
    const view = shown({ odds: null, held: held({ available: 2, nextPackInSeconds: 120 }, null) });
    expect(view).toMatchObject({
      row: "unavailable",
      unavailable: true,
      pity: null,
      showOdds: false,
      count: "2 of 3 packs ready",
      countdown: { kind: "time" },
    });
    expect(view.button.enabled).toBe(false);
  });

  it("rate limited (429): Try again in <S> s, unusable, then Open pack (or Try again with a key)", () => {
    expect(shown({ wait: 3, line: "wait" })).toMatchObject({
      button: { label: "Try again in 3 s", enabled: false },
      line: "wait",
    });
    expect(shown({ wait: 3, keyHeld: true }).button).toEqual({ label: "Try again in 3 s", enabled: false });
    expect(shown({ wait: 0 }).button).toEqual({ label: "Open pack", enabled: true });
    expect(shown({ wait: 0, keyHeld: true }).button).toEqual({ label: "Try again", enabled: true });
  });

  it("generic failure: the failure line, the button as the allowance gives", () => {
    expect(shown({ line: "failed" })).toMatchObject({
      line: "failed",
      button: { label: "Open pack", enabled: true },
    });
  });

  it("the pity line follows the server's free-packs flag and is absent on null", () => {
    expect(shown({ held: held({ available: 1, nextPackInSeconds: 30 }, 1) }).pity).toBe(
      "Mythic guaranteed within 1 free pack.",
    );
    expect(shown({ odds: makeOdds({ pity: { packs: 300, freePacksOnly: false } }) }).pity).toBe(
      "Mythic guaranteed within 300 packs.",
    );
    expect(shown({ held: held({ available: 1 }, null) }).pity).toBeNull();
  });

  it("a cap of one reads `pack`", () => {
    expect(shown({ held: held({ available: 1, cap: 1, nextPackInSeconds: null }) }).count).toBe(
      "1 of 1 pack ready",
    );
  });
});
