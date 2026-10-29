import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ControlShown, ControlView } from "../../lib/packControl";
import { makeOdds } from "../../test/fixtures";
import { PackControl } from "./PackControl";

const odds = makeOdds();

const control = (overrides: Partial<ControlShown> = {}): ControlView => ({
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
  ...overrides,
});

function renderControl(view: ControlView) {
  const handlers = { onOpen: vi.fn(), onCheckNextPack: vi.fn(), onReload: vi.fn() };
  const result = render(<PackControl view={view} odds={odds} {...handlers} />);
  return { ...result, ...handlers };
}

describe("PackControl (packs-page.md §4.1, §7)", () => {
  it("blank for the first 300 ms: nothing but an empty block", () => {
    const { container } = renderControl({ kind: "blank" });
    expect(container).not.toHaveTextContent(/./);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("loading: a static skeleton, Open pack unusable, the hidden status text, no pity line or odds", async () => {
    const { onOpen } = renderControl({ kind: "loading" });
    const button = screen.getByRole("button", { name: "Open pack" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.setup().click(button);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your packs…");
    expect(screen.queryByText(/Mythic guaranteed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pack odds" })).not.toBeInTheDocument();
  });

  it("load failed: the line and Try again, which asks once", async () => {
    const { onReload } = renderControl({ kind: "loadFailed" });
    expect(screen.getByText("Couldn't load your packs.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("ready: the count, an enabled Open pack named by its text only, the countdown, the pity line and Pack odds", async () => {
    const { onOpen } = renderControl(control());
    expect(screen.getByText("2 of 3 packs ready")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Open pack" });
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAccessibleDescription();
    await userEvent.setup().click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    const pity = screen.getByText("Mythic guaranteed within 300 free packs.");
    expect(pity.tagName).toBe("P");
    expect(pity).not.toHaveAttribute("role");
    expect(pity).not.toHaveAttribute("aria-live");
  });

  it("the countdown is plain text: the clock hidden, the words for a screen reader", () => {
    renderControl(control());
    const visible = screen.getByText("Next pack in 7:42");
    expect(visible).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Next pack in 7 minutes 42 seconds")).toHaveClass("sr-only");
    expect(visible.closest("p")).not.toHaveAttribute("role");
    expect(visible.closest("p")).not.toHaveAttribute("aria-live");
  });

  it("waiting: Open pack aria-disabled, keeps focus, does nothing, and is described by the countdown alone", async () => {
    const { onOpen } = renderControl(
      control({
        row: "waiting",
        count: "0 of 3 packs ready",
        button: { label: "Open pack", enabled: false },
        describedByCountdown: true,
        countdown: { kind: "time", seconds: 599 },
      }),
    );
    const button = screen.getByRole("button", { name: "Open pack" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription("Next pack in 9 minutes 59 seconds");
    const user = userEvent.setup();
    button.focus();
    await user.keyboard("{Enter}");
    await user.click(button);
    expect(onOpen).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it("at the cap: no countdown line", () => {
    renderControl(control({ row: "atCap", count: "3 of 3 packs ready", countdown: null }));
    expect(screen.queryByText(/Next pack in/)).not.toBeInTheDocument();
  });

  it("countdown check failed: the line and Check again in its place", async () => {
    const { onCheckNextPack } = renderControl(control({ countdown: { kind: "checkFailed" } }));
    expect(screen.getByText("Couldn't check for the next pack.")).toBeInTheDocument();
    expect(screen.queryByText(/Next pack in/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Check again" }));
    expect(onCheckNextPack).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["noneLeft", "status", "There was no pack left to open."],
    [
      "wait",
      "status",
      "Packs take a short pause after many requests in a row. The button comes back by itself.",
    ],
    ["failed", "alert", "Couldn't open the pack. Try again."],
  ] as const)("the %s line under the button is a %s", (line, role, text) => {
    renderControl(control({ line }));
    expect(screen.getByRole(role)).toHaveTextContent(text);
  });

  it("the no-answer line is plain text: the app banner is already the alert", () => {
    renderControl(control({ line: "noAnswer", button: { label: "Try again", enabled: true } }));
    const line = screen.getByText(
      "Couldn't reach the game server. Trying again opens this same pack, never a second one.",
    );
    expect(line).not.toHaveAttribute("role");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).not.toHaveAttribute("aria-disabled");
  });

  it("cards unavailable: the button stays (unusable), the line and Check again; no pity line, no Pack odds", async () => {
    const { onReload } = renderControl(
      control({
        row: "unavailable",
        unavailable: true,
        button: { label: "Open pack", enabled: false },
        pity: null,
        showOdds: false,
      }),
    );
    expect(screen.getByRole("button", { name: "Open pack" })).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Cards are unavailable right now. Your packs are kept until they're back."),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Check again" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Mythic guaranteed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pack odds" })).not.toBeInTheDocument();
  });

  it("the keyboard order: Open pack, then Check again, then Pack odds", async () => {
    renderControl(control({ countdown: { kind: "checkFailed" } }));
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "Open pack" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Check again" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Pack odds" })).toHaveFocus();
  });
});

describe("the odds dialog (card-and-rarity.md §7.3)", () => {
  it("opens on Pack odds with focus on the dialog, reads the held odds whole, and Close returns focus", async () => {
    renderControl(control());
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Pack odds" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Pack odds" });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveAttribute("closedby", "any");
    expect(within(dialog).getByRole("heading", { level: 2, name: "Pack odds" })).toBeInTheDocument();

    const table = within(dialog).getByRole("table", { name: "Pack odds" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Tier", "Characters", "Share of cards", "At least one per pack"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent?.replace(/✦/g, ""))).toEqual([
      "Common",
      "Uncommon",
      "Rare",
      "Epic",
      "Legendary",
      "Mythic",
    ]);
    expect(
      within(rows[0]!)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["1,044", "56%", "99.9%"]);
    expect(
      within(rows[5]!)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["60", "0.05%", "0.25%"]);
    expect(within(rows[3]!).getByRole("rowheader")).toHaveClass("text-rarity-epic-text");

    for (const text of [
      "Shares and chances are for a standard pack; the special packs below add to the rarer tiers.",
      "Cards 1 to 3: Common or better. Card 4: Uncommon or better. Card 5: Rare or better.",
      "Every 10th free pack is Enchanted: its fifth card is Epic or better.",
      "About 1 pack in 2,500 is Radiant: five cards of Epic or better, at least one of them Mythic.",
      "A 300th free pack in a row without a Mythic always has one.",
      "Shop packs can be Radiant. They don't count toward Enchanted packs or the guarantee.",
    ]) {
      expect(within(dialog).getByText(text)).toBeInTheDocument();
    }
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Close"]);

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("Escape closes it and returns focus to Pack odds", async () => {
    renderControl(control());
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Pack odds" });
    await user.click(trigger);
    const dialog = screen.getByRole<HTMLDialogElement>("dialog", { name: "Pack odds" });
    // jsdom has no native Escape handling for <dialog>; the browser's is a `close`, as here.
    act(() => dialog.close());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens while a pack is opening", async () => {
    renderControl(control({ button: { label: "Opening…", enabled: false } }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Pack odds" }));
    expect(screen.getByRole("dialog", { name: "Pack odds" })).toBeInTheDocument();
  });
});
