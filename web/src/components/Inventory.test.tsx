import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "../test/fixtures";
import type { LegacyRarity as Rarity } from "@anime-tcg/shared/rarity";
import type { Card } from "../types";
import { Inventory } from "./Inventory";

function statsFor(cards: Card[]) {
  const byRarity: Record<Rarity, number> = { common: 0, rare: 0, legendary: 0 };
  for (const c of cards) byRarity[c.rarity] += 1;
  return { total: cards.length, unique: new Set(cards.map((c) => c.characterId)).size, byRarity };
}

const cards: Card[] = [
  makeCard({ uid: "a", characterId: 1, name: "Alpha", rarity: "common" }),
  makeCard({ uid: "b", characterId: 1, name: "Alpha", rarity: "common" }),
  makeCard({ uid: "c", characterId: 1, name: "Alpha", rarity: "legendary" }),
  makeCard({ uid: "d", characterId: 2, name: "Beta", rarity: "rare" }),
];

describe("Inventory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows an empty state when there are no cards", () => {
    render(<Inventory cards={[]} stats={statsFor([])} login="Chris" onClear={() => undefined} />);
    expect(screen.getByText(/collection is empty/i)).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("groups duplicates by character and rarity, sorted rarest first", () => {
    render(<Inventory cards={cards} stats={statsFor(cards)} login="Chris" onClear={() => undefined} />);
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(3);
    expect(articles[0]).toHaveAccessibleName(/Alpha, legendary/);
    expect(articles[1]).toHaveAccessibleName(/Beta, rare/);
    expect(articles[2]).toHaveAccessibleName(/Alpha, common/);
    expect(within(articles[2]!).getByText("×2")).toBeInTheDocument();
    expect(screen.getByText("4 cards")).toBeInTheDocument();
    expect(screen.getByText("2 unique")).toBeInTheDocument();
  });

  it("filters by rarity", async () => {
    const user = userEvent.setup();
    render(<Inventory cards={cards} stats={statsFor(cards)} login="Chris" onClear={() => undefined} />);
    await user.selectOptions(screen.getByLabelText(/filter by rarity/i), "rare");
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(1);
    expect(articles[0]).toHaveAccessibleName(/Beta, rare/);
  });

  it("only clears after the user confirms, and the confirm names the login", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const confirm = vi.spyOn(window, "confirm");
    render(<Inventory cards={cards} stats={statsFor(cards)} login="Chris" onClear={onClear} />);

    confirm.mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: /reset/i }));
    expect(onClear).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith("Delete every card in \u2068Chris\u2069? This cannot be undone.");

    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: /reset/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
