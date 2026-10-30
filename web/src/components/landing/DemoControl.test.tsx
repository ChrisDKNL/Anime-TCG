import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DemoControl as Control } from "../../lib/demo";
import { DemoControl } from "./DemoControl";

const ready: Control = { kind: "button", label: { kind: "open" }, enabled: true, line: null };

function renderControl(control: Control = ready) {
  const onOpen = vi.fn();
  render(<DemoControl control={control} finishedHere={false} onOpen={onOpen} />);
  return { onOpen, button: screen.getByRole("button") };
}

/** The pack button's guards on the demo button (navigation-and-landing.md §3.7 item 1.3, manager decision 2026-10-30). */
describe("DemoControl activation", () => {
  it("a double click opens one demo pack; a later single click opens the next", async () => {
    const { onOpen, button } = renderControl();
    await userEvent.setup().dblClick(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(button, { detail: 2 });
    fireEvent.click(button, { detail: 3 });
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(button, { detail: 1 });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("a held Enter opens one demo pack: its auto-repeats do not click; Enter, Space and a keyboard click still open", async () => {
    const { onOpen, button } = renderControl();
    button.focus();
    const user = userEvent.setup();
    await user.keyboard("{Enter>4/}");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(button, { key: "Enter", repeat: true })).toBe(false);
    expect(fireEvent.keyDown(button, { key: "Enter", repeat: false })).toBe(true);
    expect(fireEvent.keyDown(button, { key: "Tab", repeat: true })).toBe(true);
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    fireEvent.click(button, { detail: 0 });
    expect(onOpen).toHaveBeenCalledTimes(4);
  });

  it("an aria-disabled button opens nothing, whatever the click", () => {
    const { onOpen } = renderControl({
      kind: "button",
      label: { kind: "opening" },
      enabled: false,
      line: null,
    });
    const opening = screen.getByRole("button", { name: "Opening…" });
    expect(opening).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(opening, { detail: 1 });
    fireEvent.click(opening, { detail: 0 });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
