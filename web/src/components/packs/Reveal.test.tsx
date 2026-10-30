import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FRANCHISES, makeCharacter, makeFranchise, makeOpenedCard } from "../../test/fixtures";
import { Reveal, type RevealPack } from "./Reveal";

const cards = [
  makeOpenedCard(4, { rarity: "epic", isNew: true }),
  makeOpenedCard(0, { isNew: false }),
  makeOpenedCard(2, { isNew: true }),
  makeOpenedCard(1, { isNew: false }),
  makeOpenedCard(3, { isNew: false }),
];

const pack = (overrides: Partial<RevealPack> = {}): RevealPack => ({
  id: "opening-1",
  heading: "Your pack",
  cards,
  franchises: FRANCHISES,
  lines: [],
  ...overrides,
});

const props = { poolSize: 2_983, entering: false, effects: "full", showNew: true, busy: false } as const;

describe("Reveal (packs-page.md §3.4)", () => {
  it("before the first pack: five empty slots hidden from assistive tech, no heading, no list", () => {
    const { container } = render(<Reveal pack={null} {...props} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    const slots = container.querySelector('[aria-hidden="true"]');
    expect(slots?.children).toHaveLength(5);
    expect(container).not.toHaveTextContent(/./);
  });

  it("lists the five cards in slot order, never by rarity, each named and marked with its slot", () => {
    render(<Reveal pack={pack()} {...props} />);
    const section = screen.getByRole("region", { name: "Your pack" });
    const list = within(section).getByRole("list", { name: "Your pack" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.dataset.slot)).toEqual(["0", "1", "2", "3", "4"]);
    expect(within(items[4]!).getByRole("article")).toHaveAccessibleName(
      "\u2068Character 1004\u2069, Epic, \u2068Series 102\u2069",
    );
  });

  it("marks exactly the new cards, under the card, and adds `· <k> new` to the summary", () => {
    render(<Reveal pack={pack()} {...props} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => within(item).queryByText("New") !== null)).toEqual([
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(screen.getByText(/new$/).closest("p")).toHaveTextContent(
      "1 Epic, 1 Uncommon and 3 Common · 2 new",
    );
  });

  it("colours each tier word of the summary with its text token, and leaves `· new` out with none", () => {
    render(<Reveal pack={pack({ cards: cards.map((card) => ({ ...card, isNew: false })) })} {...props} />);
    expect(screen.getByText("Epic")).toHaveClass("text-rarity-epic-text");
    expect(screen.getByText("Uncommon")).toHaveClass("text-rarity-uncommon-text");
    expect(screen.getByText("Epic").closest("p")).toHaveTextContent(/^1 Epic, 1 Uncommon and 3 Common$/);
  });

  it("shows the special lines under the summary, in order", () => {
    render(
      <Reveal pack={pack({ heading: "Enchanted pack", lines: ["first line", "second line"] })} {...props} />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Enchanted pack" })).toBeInTheDocument();
    const first = screen.getByText("first line");
    expect(first.nextElementSibling).toHaveTextContent("second line");
  });

  it("runs the entrance on each slot, delayed by its slot, only for a pack that just landed", () => {
    const { rerender } = render(<Reveal pack={pack()} {...props} entering />);
    const items = screen.getAllByRole("listitem");
    for (const item of items) expect(item).toHaveClass("animate-card-enter", "motion-reduce:animate-none");
    expect(items.map((item) => item.style.getPropertyValue("--slot"))).toEqual(["0", "1", "2", "3", "4"]);
    rerender(<Reveal pack={pack()} {...props} entering={false} />);
    for (const item of screen.getAllByRole("listitem")) expect(item).not.toHaveClass("animate-card-enter");
  });

  it("marks the list busy while the next opening is in flight", () => {
    const { rerender } = render(<Reveal pack={pack()} {...props} busy />);
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");
    rerender(<Reveal pack={pack()} {...props} />);
    expect(screen.getByRole("list")).not.toHaveAttribute("aria-busy");
  });

  it("the demo's form: no New markers, no lines, no effects", () => {
    render(<Reveal pack={pack()} {...props} effects="none" showNew={false} />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.getByText("Epic").closest("p")).not.toHaveTextContent("new");
    expect(screen.getAllByRole("article")[4]).not.toHaveClass("shadow-glow-epic");
  });

  it("renders hostile names and series titles as text (T1)", () => {
    const hostile = makeOpenedCard(0, {
      character: makeCharacter(7, { name: "<script>alert(1)</script>", franchiseIds: [900] }),
    });
    render(
      <Reveal
        pack={pack({
          cards: [hostile, ...cards.slice(1)],
          franchises: [...FRANCHISES, makeFranchise(900, { title: '<img src=x onerror="alert(1)">' })],
        })}
        {...props}
      />,
    );
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });
});
