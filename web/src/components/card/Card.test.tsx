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
      expect(card).toHaveAccessibleName(`\u2068Frieren\u2069, ${label}, \u2068Sousou no Frieren\u2069`);
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
    expect(screen.getByRole("article")).toHaveAccessibleName("\u2068Character 2\u2069, Rare");
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

  it("starts the art over at a new image address, and never retries the address that failed (collection-overview.md §5.6 rule 7)", () => {
    const OLD = "https://s4.anilist.co/file/anilistcdn/character/large/old.png";
    const NEW = "https://s4.anilist.co/file/anilistcdn/character/large/new.png";
    const card = (imageUrl: string) => (
      <Card
        character={makeCharacter(1_234, { name: "Frieren", imageUrl })}
        rarity="rare"
        series={null}
        poolSize={null}
        effects="full"
      />
    );
    const { rerender } = render(card(OLD));
    const article = screen.getByRole("article");
    fireEvent.error(article.querySelector("img")!);
    expect(within(article).getByText("No image")).toBeInTheDocument();

    // The same address again, as a refetch that changed something else brings it: no retry.
    rerender(card(OLD));
    expect(within(article).getByText("No image")).toBeInTheDocument();
    expect(article.querySelector("img")).toBeNull();

    // A new address: the art is asked for again, on the placeholder until it loads.
    rerender(card(NEW));
    const art = article.querySelector("img");
    expect(art).toHaveAttribute("src", NEW);
    expect(art).toHaveClass("invisible");
    expect(within(article).queryByText("No image")).not.toBeInTheDocument();
    fireEvent.load(art!);
    expect(art).not.toHaveClass("invisible");
  });

  it('keeps the full name and series in `title` for the truncated lines, isolated, each in a `dir="auto"` element', () => {
    const card = renderCard("common");
    const name = within(card).getByText("Frieren");
    const series = within(card).getByText("Sousou no Frieren");
    expect(name).toHaveAttribute("title", "\u2068Frieren\u2069");
    expect(series).toHaveAttribute("title", "\u2068Sousou no Frieren\u2069");
    expect(name).toHaveAttribute("dir", "auto");
    expect(series).toHaveAttribute("dir", "auto");
  });

  it("isolates an RTL override in the label and the titles, so it cannot reorder the tier or the series (C9)", () => {
    const name = "\u202Egnp.exe";
    const series = "\u202Eseires";
    render(
      <Card
        character={makeCharacter(9, { name })}
        rarity="epic"
        series={series}
        poolSize={null}
        effects="full"
      />,
    );
    const card = screen.getByRole("article");
    expect(card).toHaveAttribute("aria-label", `\u2068${name}\u2069, Epic, \u2068${series}\u2069`);
    expect(within(card).getByText(name)).toHaveAttribute("title", `\u2068${name}\u2069`);
    expect(within(card).getByText(series)).toHaveAttribute("title", `\u2068${series}\u2069`);
  });

  it("without a series, no series title", () => {
    render(<Card character={makeCharacter(2)} rarity="rare" series={null} poolSize={null} effects="full" />);
    expect(screen.getByRole("article").querySelectorAll("[title]")).toHaveLength(1);
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

  it("inside a control it is part of it: no article, no name of its own, phrasing elements only", () => {
    const { container } = render(
      <button type="button" aria-label="The tile's own name">
        <Card
          character={makeCharacter(3, { name: "Frieren" })}
          rarity="mythic"
          series="Sousou no Frieren"
          poolSize={2_983}
          effects="hover"
          standalone={false}
        />
      </button>,
    );
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAccessibleName("The tile's own name");
    const frame = container.querySelector(".card-frame-mythic");
    expect(frame?.tagName).toBe("SPAN");
    expect(frame).not.toHaveAttribute("aria-label");
    expect(frame).toHaveClass("shadow-glow-mythic", "card-pearl-hover");
    expect(container.querySelectorAll("button div, button p, button article")).toHaveLength(0);
  });

  it("at dialog size: the larger frame, face and type of §3.2", () => {
    render(
      <Card
        character={makeCharacter(4, { name: "Frieren", rank: 12 })}
        rarity="epic"
        series="Sousou no Frieren"
        poolSize={2_983}
        effects="full"
        size="dialog"
      />,
    );
    const card = screen.getByRole("article");
    expect(card).toHaveClass("rounded-[14px]", "p-[6px]", "card-glint");
    expect(within(card).getByText("Frieren")).toHaveClass("text-[17px]");
    expect(within(card).getByText("Sousou no Frieren")).toHaveClass("text-[15px]");
    expect(within(card).getByText("#0012 / 2983").parentElement).toHaveClass("text-[13px]");
    expect(within(card).getByText("✦✦✦✦").parentElement).toHaveClass("text-[14px]");
  });
});
