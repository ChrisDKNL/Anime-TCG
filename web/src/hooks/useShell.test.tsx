import { act, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/render";
import { SESSION_QUERY_KEY } from "./useAccountSession";
import { useFocusTarget, useShellContext, type FocusTarget } from "./useShell";

function Target({ target, label }: { target: FocusTarget; label: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useFocusTarget(target, ref);
  return (
    <h2 ref={ref} tabIndex={-1}>
      {label}
    </h2>
  );
}

function Controls() {
  const shell = useShellContext();
  return (
    <>
      <button type="button" onClick={() => shell.requestFocus("accountHeading")}>
        focus heading
      </button>
      <button type="button" onClick={() => shell.announce("Hello")}>
        announce
      </button>
      <button type="button" onClick={() => shell.sessionEnded()}>
        end session
      </button>
    </>
  );
}

describe("useShell", () => {
  it("focuses a mounted target immediately", () => {
    renderWithProviders(
      <>
        <Target target="accountHeading" label="Heading" />
        <Controls />
      </>,
    );
    act(() => screen.getByRole("button", { name: "focus heading" }).click());
    expect(screen.getByRole("heading", { name: "Heading" })).toHaveFocus();
  });

  it("holds a request for a target that mounts later and honours it once", () => {
    const { rerender } = renderWithProviders(<Controls />);
    act(() => screen.getByRole("button", { name: "focus heading" }).click());

    rerender(
      <>
        <Controls />
        <Target target="accountHeading" label="Heading" />
      </>,
    );
    expect(screen.getByRole("heading", { name: "Heading" })).toHaveFocus();

    // A remount of the same target does not steal focus again.
    rerender(<Controls />);
    rerender(
      <>
        <Controls />
        <Target target="accountHeading" label="Heading" />
      </>,
    );
    expect(screen.getByRole("heading", { name: "Heading" })).not.toHaveFocus();
  });

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

  it("sessionEnded signs the query out, sets the notice and requests the heading", () => {
    const { queryClient } = renderWithProviders(
      <>
        <Controls />
        <Target target="accountHeading" label="Heading" />
      </>,
    );
    queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true });
    act(() => screen.getByRole("button", { name: "end session" }).click());
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ signedIn: false });
    expect(screen.getByRole("status")).toHaveAttribute("data-notice", "sessionEnded");
    expect(screen.getByRole("heading", { name: "Heading" })).toHaveFocus();
  });
});
