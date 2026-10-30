import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { LiveRegion } from "../components/LiveRegion";
import { SESSION_QUERY_KEY } from "./useAccountSession";
import { ShellContext, useShell, useShellContext } from "./useShell";

function Controls() {
  const shell = useShellContext();
  return (
    <>
      <button type="button" onClick={() => shell.announce("Hello")}>
        announce
      </button>
      <button type="button" onClick={() => shell.sessionEnded()}>
        end session
      </button>
      <button type="button" onClick={() => shell.unreachable()}>
        unreachable
      </button>
      <button type="button" onClick={() => shell.serverAnswered()}>
        answered
      </button>
      <p>notice: {shell.notice}</p>
    </>
  );
}

/** A shell of its own, so the test can hand it the session-ended navigation. */
function Shell({ onSessionEnded }: { onSessionEnded: () => void }) {
  const { state, context } = useShell({ onSessionEnded });
  return (
    <ShellContext value={context}>
      <LiveRegion announcement={state.announcement} />
      <Controls />
    </ShellContext>
  );
}

describe("useShell", () => {
  it("announces into the live region", () => {
    renderWithProviders(<Controls />);
    act(() => screen.getByRole("button", { name: "announce" }).click());
    expect(screen.getByRole("status")).toHaveTextContent("Hello");
  });

  it("announcing the same text again writes it again, so a screen reader repeats it", () => {
    renderWithProviders(<Controls />);
    const region = screen.getByRole("status");
    const announceButton = screen.getByRole("button", { name: "announce" });
    act(() => announceButton.click());
    const first = region.firstChild;
    expect(first).toHaveTextContent("Hello");

    const observer = new MutationObserver(() => undefined);
    observer.observe(region, { childList: true, subtree: true, characterData: true });
    act(() => announceButton.click());
    const added = observer.takeRecords().flatMap((record) => [...record.addedNodes]);
    observer.disconnect();

    expect(region).toHaveTextContent("Hello");
    expect(added).toHaveLength(1);
    expect(region.firstChild).not.toBe(first);
  });

  it("sessionEnded signs the query out first, then sets the notice and hands over to the navigation", () => {
    let sessionWhenNavigating: unknown;
    const onSessionEnded = vi.fn(() => {
      sessionWhenNavigating = queryClient.getQueryData(SESSION_QUERY_KEY);
    });
    const { queryClient } = renderWithProviders(<Shell onSessionEnded={onSessionEnded} />);
    queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true });
    act(() => screen.getAllByRole("button", { name: "end session" })[0]?.click());
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ signedIn: false });
    // The /login guard must already see a signed-out visitor when the navigation runs.
    expect(sessionWhenNavigating).toEqual({ signedIn: false });
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("notice: sessionEnded")).toHaveLength(1);
  });

  it("serverAnswered clears the unreachable banner and leaves a session-ended one", () => {
    renderWithProviders(<Shell onSessionEnded={() => undefined} />);
    act(() => screen.getByRole("button", { name: "unreachable" }).click());
    expect(screen.getByText("notice: unreachable")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "answered" }).click());
    expect(screen.getByText("notice: none")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "end session" }).click());
    act(() => screen.getByRole("button", { name: "answered" }).click());
    expect(screen.getByText("notice: sessionEnded")).toBeInTheDocument();
  });
});
