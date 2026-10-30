import type { CollectionResponse } from "@anime-tcg/shared/api";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeAccount } from "../test/api";
import { COLLECTION, renderApp } from "../test/app";
import { makeCharacter, makeCollection, makeEntry, makeFranchise } from "../test/fixtures";

/** collection-overview.md §5.6, the T1 test: each kind of hostile AniList string, and the same as a search. */
const HOSTILE: Array<[string, string]> = [
  ["markup", "<img src=x onerror=alert(1)>"],
  ["an RTL override", "\u202Eevil name\u202C"],
  ["200 characters without a space", "W".repeat(200)],
  ["a stack of 50 combining marks", `Z${"\u0301".repeat(50)}`],
];

const isolated = (text: string) => `\u2068${text}\u2069`;

function hostileCollection(text: string): CollectionResponse {
  const data = makeCollection([
    makeEntry(
      makeCharacter(1, {
        name: text,
        nameNative: `ネ${text}`,
        franchiseIds: [100, 101],
        tier: "epic",
        rank: 7,
      }),
      { rarity: "epic", count: 3 },
    ),
  ]);
  data.franchises = [
    makeFranchise(100, { title: `T${text}`, titleNative: `N${text}` }),
    makeFranchise(101, { title: `S${text}` }),
  ];
  data.completion.franchises = [
    { franchiseId: 100, owned: 1, total: 4 },
    { franchiseId: 101, owned: 1, total: 4 },
  ];
  return data;
}

describe("AniList strings and the search are text, isolated, and never reorder what is beside them (T1)", () => {
  it.each(HOSTILE)("%s", async (_, text) => {
    renderApp({ [COLLECTION]: { status: 200, body: hostileCollection(text) } }, makeAccount(), "/collection");
    const user = userEvent.setup();
    const grid = await screen.findByRole("list", { name: "1 result" }, { timeout: 5_000 });

    // The tile: its own name element holds the name and nothing else; the count is beside it.
    const tile = within(grid).getByRole("button");
    expect(tile.getAttribute("aria-label")).toBe(
      `${isolated(text)}, Epic, ${isolated(`T${text}`)}, 3 copies`,
    );
    const name = [...tile.querySelectorAll('[dir="auto"]')].find((node) => node.textContent === text);
    expect(name).toBeDefined();
    expect(name).toHaveAttribute("title", isolated(text));
    const count = within(tile).getByText("×3");
    expect(name?.contains(count)).toBe(false);
    expect(name?.textContent).not.toMatch(/✦|#0007/);

    // The series option: isolated, cut at 60 grapheme clusters.
    const options = within(screen.getByRole("combobox", { name: "Series" })).getAllByRole("option");
    for (const option of options.slice(1)) {
      expect(option.textContent).toMatch(/^\u2068[TS]/);
      expect(option.textContent).toMatch(/\u2069 · 1\/4$/);
    }

    // The dialog: the heading, the native name, the series, its native title and `Also in`.
    await user.click(tile);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe(text);
    expect(within(dialog).getByText(`ネ${text}`)).toHaveAttribute("dir", "auto");
    expect(within(dialog).getByText(`T${text}`, { selector: "bdi" })).toBeInTheDocument();
    expect(within(dialog).getByText(`N${text}`)).toHaveAttribute("dir", "auto");
    const alsoIn = within(dialog).getByText(`S${text}`, { selector: "bdi" });
    expect(alsoIn).toHaveAttribute("title", isolated(`S${text}`));
    expect(within(dialog).getByRole("heading", { level: 2 }).querySelector("*")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    // No markup was injected, and the only images are card art.
    expect(document.querySelectorAll("[onerror]")).toHaveLength(0);
    expect(document.querySelectorAll("script")).toHaveLength(0);
    for (const img of document.querySelectorAll("img")) {
      expect(img.getAttribute("src")).toBe("https://s4.anilist.co/file/anilistcdn/character/large/b1.png");
    }

    // The no-match message: the query as typed, in a <bdi>.
    const search = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(search, { target: { value: `${text} nothing` } });
    const echoed = screen.getByText(`${text} nothing`, { selector: "bdi" });
    expect(echoed.parentElement?.textContent).toBe(`No cards match "${text} nothing".`);

    // A Series view row.
    fireEvent.change(search, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Series" }));
    const rows = within(screen.getByRole("region", { name: "Series completion" })).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("bdi")?.textContent)).toEqual([`T${text}`, `S${text}`]);
    expect(within(rows[0]!).getByRole("button")).toHaveAccessibleName(
      `Show cards from ${isolated(`T${text}`)}`,
    );
    expect(document.querySelectorAll("[onerror]")).toHaveLength(0);
  });
});
