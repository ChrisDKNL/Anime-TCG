import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESULTS_ANNOUNCE_DELAY_MS, useResultsAnnouncement } from "./useResultsAnnouncement";
import { ShellContext, type ShellContextValue } from "./useShell";

function setup(initial: string) {
  const announce = vi.fn<ShellContextValue["announce"]>();
  const shell: ShellContextValue = {
    announce,
    sessionEnded: () => undefined,
    unreachable: () => undefined,
    clearNotice: () => undefined,
    notice: "none",
  };
  const line = { current: document.createElement("p") };
  line.current.tabIndex = -1;
  document.body.append(line.current);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ShellContext value={shell}>{children}</ShellContext>
  );
  const hook = renderHook(({ text, asked }) => useResultsAnnouncement(text, asked, line), {
    initialProps: { text: initial, asked: 0 },
    wrapper,
  });
  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  return { ...hook, announce, line, wait };
}

describe("useResultsAnnouncement (collection-overview.md §7 Results line)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("says nothing for the line the view opens with", () => {
    const { announce, wait } = setup("5 results");
    wait(RESULTS_ANNOUNCE_DELAY_MS * 2);
    expect(announce).not.toHaveBeenCalled();
  });

  it("announces once, 500 ms after the last change, never per keystroke", () => {
    const { announce, rerender, wait } = setup("5 results");
    rerender({ text: "3 results", asked: 1 });
    wait(400);
    rerender({ text: "2 results", asked: 2 });
    wait(RESULTS_ANNOUNCE_DELAY_MS - 1);
    expect(announce).not.toHaveBeenCalled();
    wait(1);
    expect(announce).toHaveBeenCalledExactlyOnceWith("2 results");
  });

  it("says nothing when the line changed and changed back before the wait ended", () => {
    const { announce, rerender, wait } = setup("5 results");
    rerender({ text: "1 result", asked: 1 });
    wait(200);
    rerender({ text: "5 results", asked: 2 });
    wait(RESULTS_ANNOUNCE_DELAY_MS * 2);
    expect(announce).not.toHaveBeenCalled();
    // A refetch after that is still not the player's doing.
    rerender({ text: "4 results", asked: 2 });
    wait(RESULTS_ANNOUNCE_DELAY_MS * 2);
    expect(announce).not.toHaveBeenCalled();
  });

  it("says nothing when the line changes without a change by the player, as a refetch changes it (§4.1)", () => {
    const { announce, rerender, wait } = setup("5 results");
    rerender({ text: "4 results", asked: 0 });
    wait(RESULTS_ANNOUNCE_DELAY_MS * 2);
    expect(announce).not.toHaveBeenCalled();
    // The next change the player makes is measured against the line the refetch left.
    rerender({ text: "4 results", asked: 1 });
    wait(RESULTS_ANNOUNCE_DELAY_MS * 2);
    expect(announce).not.toHaveBeenCalled();
    rerender({ text: "1 result", asked: 2 });
    wait(RESULTS_ANNOUNCE_DELAY_MS);
    expect(announce).toHaveBeenCalledExactlyOnceWith("1 result");
  });

  it("announces the line a change settles on a render after the change, as the deferred search does", () => {
    const { announce, rerender, wait } = setup("5 results");
    rerender({ text: "5 results", asked: 1 });
    rerender({ text: "2 results", asked: 1 });
    wait(RESULTS_ANNOUNCE_DELAY_MS);
    expect(announce).toHaveBeenCalledExactlyOnceWith("2 results");
  });

  it("stays quiet while the line itself has focus, since focus reads it", () => {
    const { announce, rerender, wait, line } = setup("130 results · page 1 of 3");
    line.current.focus();
    rerender({ text: "130 results · page 2 of 3", asked: 1 });
    wait(RESULTS_ANNOUNCE_DELAY_MS);
    expect(announce).not.toHaveBeenCalled();
    line.current.blur();
    rerender({ text: "12 results", asked: 2 });
    wait(RESULTS_ANNOUNCE_DELAY_MS);
    expect(announce).toHaveBeenCalledExactlyOnceWith("12 results");
  });
});
