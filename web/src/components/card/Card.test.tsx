import type { Rarity } from "@anime-tcg/shared/api";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeCharacter } from "../../test/fixtures";
import { Card, type CardEffects } from "./Card";

const TIERS: Array<[Rarity, number, string]> = [
  ["common", 1, "Common"],
  ["uncommon", 2, "Uncommon"],
  ["rare", 3, "Rare"],
  ["epic", 4, "Epic"],
  ["legendary", 5, "Legendary"],
  ["mythic", 6, "Mythic"],
];

function renderCard(rarity: Rarity, effects: CardEffects = "full", overrides = {}) {
  const character = makeCharacter(1_234, { name: "Frieren", rank: 12, ...overrides });
  render(
    <Card
      character={character}
      rarity={rarity}
      series="Sousou no Frieren"
      poolSize={2_983}
      effects={effects}
    />,
  );
  return screen.getByRole("article");
}

describe("Card (card-and-rarity.md)", () => {
  it.each(TIERS)(
    "%s: its frame, %i stars in the tier's text colour, and the tier named for a screen reader",
    (rarity, n, label) => {
      const card = renderCard(rarity);
      expect(card).toHaveAccessibleName(`Frieren, ${label}, Sousou no Frieren`);
      expect(card).toHaveClass(`card-frame-${rarity}`);
      const stars = within(card).getByText("✦".repeat(n));
      expect(stars).toHaveAttribute("aria-hidden", "true");
      expect(stars.parentElement).toHaveClass(`text-rarity-${rarity}-text`);
      expect(within(card).getByText(`${label}, ${n} ${n === 1 ? "star" : "stars"}`)).toHaveClass("sr-only");
    },
  );

  it("glows only for Epic, Legendary and Mythic, glints Epic and Legendary, drifts Mythic (the owner's §5.4 exception)", () => {
    const classes = (rarity: Rarity, effects: CardEffects) => {
      const { unmount } = render(
        <Card character={makeCharacter(1)} rarity={rarity} series={null} poolSize={null} effects={effects} />,
      );
      const value = screen.getByRole("article").className;
      unmount();
      return value;
    };
    for (const rarity of ["common", "uncommon", "rare"] as const) {
      expect(classes(rarity, "full")).not.toMatch(/shadow-glow|card-glint|card-pearl/);
    }
    expect(classes("epic", "full")).toMatch(/\bshadow-glow-epic\b.*\bcard-glint\b/);
    expect(classes("legendary", "full")).toMatch(/\bshadow-glow-legendary\b.*\bcard-glint\b/);
    expect(classes("mythic", "full")).toMatch(/\bshadow-glow-mythic\b.*\bcard-pearl\b/);

    // In the grids the glow stays and the motion waits for hover.
    expect(classes("epic", "hover")).toMatch(/\bshadow-glow-epic\b.*\bcard-glint-hover\b/);
    expect(classes("mythic", "hover")).toMatch(/\bshadow-glow-mythic\b.*\bcard-pearl-hover\b/);

    // The demo card: the tier frame and nothing else.
    for (const rarity of ["epic", "legendary", "mythic"] as const) {
      const none = classes(rarity, "none");
      expect(none).toContain(`card-frame-${rarity}`);
      expect(none).not.toMatch(/shadow-glow|card-glint|card-pearl/);
    }
  });

  it("carries none of the old card's treatment: no hover lift or scale, no rounded-2xl, no blur, no scrim", () => {
    const card = renderCard("legendary");
    const all = [card, ...card.querySelectorAll("*")]
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ");
    expect(all).not.toMatch(
      /hover:|group-hover|translate|scale|rounded-2xl|backdrop-blur|bg-gradient|(^|\s)glow-legendary/,
    );
  });

  it("starts each character's loop at its own point, stable per id", () => {
    renderCard("epic");
    expect(screen.getByRole("article").style.getPropertyValue("--card-phase")).toBe(
      String((1_234 % 11) * 0.5),
    );
  });

  it("shows the rank against the pool size, zero-padded to its digits", () => {
    const card = renderCard("rare");
    expect(within(card).getByText("#0012 / 2983")).toHaveAttribute("aria-hidden", "true");
    expect(within(card).getByText("Popularity rank 12 of 2,983")).toHaveClass("sr-only");
  });

  it("shows the rank alone without a pool size", () => {
    render(
      <Card
        character={makeCharacter(2, { rank: 7 })}
        rarity="rare"
        series={null}
        poolSize={null}
        effects="full"
      />,
    );
    expect(screen.getByText("#0007")).toBeInTheDocument();
    expect(screen.getByText("Popularity rank 7")).toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveAccessibleName("Character 2, Rare");
  });

  it("draws no rank chip for a character the current snapshot dropped", () => {
    const dropped = renderCard("rare", "full", { rank: null, inCurrentSnapshot: false, tier: null });
    expect(within(dropped).queryByText(/Popularity rank|#\d/)).not.toBeInTheDocument();
  });

  it("the art is decorative, top-aligned, on the placeholder until it loads, and `No image` when it fails", () => {
    const card = renderCard("common");
    const art = card.querySelector("img");
    expect(art).not.toBeNull();
    expect(art).toHaveAttribute("alt", "");
    expect(art).toHaveAttribute("src", "https://s4.anilist.co/file/anilistcdn/character/large/b1234.png");
    expect(art).toHaveClass("object-cover", "object-top", "invisible");
    fireEvent.load(art!);
    expect(art).not.toHaveClass("invisible");
    fireEvent.error(art!);
    expect(within(card).getByText("No image")).toBeInTheDocument();
    expect(card.querySelector("img")).toBeNull();
  });

  it("keeps the full name and series in `title` for the truncated lines", () => {
    const card = renderCard("common");
    expect(within(card).getByText("Frieren")).toHaveAttribute("title", "Frieren");
    expect(within(card).getByText("Sousou no Frieren")).toHaveAttribute("title", "Sousou no Frieren");
  });

  it("renders hostile AniList strings as text (T1)", () => {
    const name = '<img src=x onerror="window.__pwned=1">‮gnp.exe';
    render(
      <Card
        character={makeCharacter(9, { name })}
        rarity="epic"
        series="<script>alert(1)</script>"
        poolSize={2_983}
        effects="full"
      />,
    );
    const card = screen.getByRole("article");
    expect(within(card).getByText(name)).toBeInTheDocument();
    expect(within(card).getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(card.querySelectorAll("script")).toHaveLength(0);
    expect(card.querySelectorAll("img")).toHaveLength(1);
  });
});
