import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeCard } from "../test/fixtures";
import { CharacterCard } from "./CharacterCard";

describe("CharacterCard", () => {
  it("shows name, anime origin, native title and the rarity badge", () => {
    render(<CharacterCard card={makeCard({ rarity: "legendary" })} />);
    expect(screen.getByRole("heading", { name: "Character 0" })).toBeInTheDocument();
    expect(screen.getByText("Anime 0")).toBeInTheDocument();
    expect(screen.getByText("アニメ 0")).toBeInTheDocument();
    expect(screen.getByText("Legendary")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Character 0" })).toHaveAttribute(
      "src",
      "https://s4.anilist.co/fixture/0.png",
    );
  });

  it("hides the native title when it equals the display title", () => {
    render(<CharacterCard card={makeCard({ animeTitle: "ONE PIECE", animeTitleNative: "ONE PIECE" })} />);
    expect(screen.getAllByText("ONE PIECE")).toHaveLength(1);
  });

  it("renders the NEW badge and copy count only when asked", () => {
    const { rerender } = render(<CharacterCard card={makeCard()} />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();

    rerender(<CharacterCard card={makeCard()} isNew copies={3} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("×3")).toBeInTheDocument();

    rerender(<CharacterCard card={makeCard()} copies={1} />);
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });
});
