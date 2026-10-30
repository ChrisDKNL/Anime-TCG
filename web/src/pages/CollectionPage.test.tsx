import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { envelope, makeAccount, type MockAnswer, type MockHandler } from "../test/api";
import { callsTo, COLLECTION, liveRegion, pageHeading, renderApp } from "../test/app";
import { makeLargeCollection, makeOverviewCollection } from "../test/collectionFixtures";
import { makeCharacter, makeCollection, makeEntry } from "../test/fixtures";

const ASYNC_TIMEOUT = 5_000;
const account = makeAccount({ cards: 8 });
const overview: MockAnswer = { status: 200, body: makeOverviewCollection() };

function sequence(...answers: MockAnswer[]): MockHandler {
  let call = 0;
  return () => answers[Math.min(call++, answers.length - 1)]!;
}

/** The results line itself; the live region can hold the same text. */
const results = () => screen.getByText(/^[\d,]+ results?/, { selector: "#collection-results" });
const grid = () => screen.getByRole("list", { name: /results?/ });
const tileNames = () =>
  within(grid())
    .getAllByRole("button")
    .map((tile) =>
      tile
        .getAttribute("aria-label")
        ?.split(",")[0]
        ?.replace(/[\u2068\u2069]/g, ""),
    );

async function openCollection(answer: MockHandler = overview, start = "/collection") {
  const rendered = renderApp({ [COLLECTION]: answer }, account, start);
  if (start === "/collection") {
    await screen.findByRole("list", { name: /results?/ }, { timeout: ASYNC_TIMEOUT });
  }
  return { ...rendered, user: userEvent.setup() };
}

afterEach(() => vi.unstubAllGlobals());

describe("/collection: entering and the header link (collection-overview.md §3.1)", () => {
  it("before the first answer the header counts AccountPublic.cards, then totals.cards", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderApp({ [COLLECTION]: () => gate.then(() => overview) }, makeAccount({ cards: 4 }), "/packs");
    expect(
      await screen.findByRole("link", { name: "Collection (4)" }, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    release();
    expect(
      await screen.findByRole("link", { name: "Collection (8)" }, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
  });

  it("refetches silently each time the page is shown: no skeleton, no spinner", async () => {
    const { fetchMock, user } = await openCollection(overview, "/packs");
    await waitFor(() => expect(callsTo(fetchMock, COLLECTION)).toHaveLength(1));
    await user.click(await screen.findByRole("link", { name: "Collection (8)" }, { timeout: ASYNC_TIMEOUT }));
    await pageHeading("Collection");
    await waitFor(() => expect(callsTo(fetchMock, COLLECTION)).toHaveLength(2));
    expect(screen.queryByText("Loading your collection…")).not.toBeInTheDocument();
    expect(grid()).toBeInTheDocument();
  });

  it("the h1 heads one section holding the whole view", async () => {
    await openCollection();
    const heading = await pageHeading("Collection");
    expect(screen.getByRole("region", { name: "Collection" })).toContainElement(grid());
    expect(heading).toHaveAttribute("tabindex", "-1");
  });
});

describe("stats (§3.2)", () => {
  it("shows pool completion rounded down, the totals and every tier lowest first, even at 0", async () => {
    await openCollection();
    expect(screen.getByText("4 of 2,983 characters")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("8 cards · 3 duplicates")).toBeInTheDocument();
    const totals = screen.getByText("8 cards · 3 duplicates").parentElement!;
    expect(totals).toHaveTextContent("Common 1Uncommon 1Rare 2Epic 3Legendary 1Mythic 0");
    expect(within(totals).getByText("Mythic")).toHaveClass("text-rarity-mythic-text");
  });

  it("without a snapshot, entries held: no completion figure, percentage or bar; the totals stay (§4.1)", async () => {
    const data = makeOverviewCollection();
    data.snapshot = null;
    data.completion = { pool: { owned: 0, total: 0 }, franchises: [] };
    await openCollection({ status: 200, body: data });
    expect(screen.queryByText(/characters$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    const totals = screen.getByText("8 cards · 3 duplicates").parentElement!;
    expect(totals.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(totals).toHaveTextContent("Common 1Uncommon 1Rare 2Epic 3Legendary 1Mythic 0");
  });

  it("no search, filter or view changes a stat", async () => {
    const { user } = await openCollection();
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "spike");
    await user.click(screen.getByRole("button", { name: "Series" }));
    expect(screen.getByText("4 of 2,983 characters")).toBeInTheDocument();
    expect(screen.getByText("8 cards · 3 duplicates")).toBeInTheDocument();
  });
});

describe("the Cards view: toolbar, results and grid (§3.3, §4.2)", () => {
  it("defaults: search empty, All pressed, All series, duplicates off, rarest first; no Clear filters", async () => {
    await openCollection();
    // jsdom gives `<search>` no role; the browser's `search` landmark is checked in e2e.
    expect(document.querySelector("search")).toHaveAttribute("aria-label", "Collection filters");
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("");
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveAttribute("maxlength", "100");
    const chips = within(screen.getByRole("group", { name: "Rarity" })).getAllByRole("button");
    expect(chips.map((chip) => [chip.textContent, chip.getAttribute("aria-pressed")])).toEqual([
      ["All", "true"],
      ["Common", "false"],
      ["Uncommon", "false"],
      ["Rare", "false"],
      ["Epic", "false"],
      ["Legendary", "false"],
      ["Mythic", "false"],
    ]);
    expect(screen.getByRole("combobox", { name: "Series" })).toHaveDisplayValue("All series");
    expect(screen.getByRole("checkbox", { name: "Duplicates only" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveDisplayValue("Rarity, rarest first");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    expect(results()).toHaveTextContent("5 results");
    expect(tileNames()).toEqual(["Moved Star", "Spike Spiegel", "Gon Freecss", "Old Hero", "Pikachu"]);
  });

  it("each tile is a dialog button named by the card, with the copies under the card", async () => {
    await openCollection();
    const spike = within(grid()).getByRole("button", { name: /Spike/ });
    expect(spike).toHaveAccessibleName("\u2068Spike Spiegel\u2069, Epic, \u2068Cowboy Bebop\u2069, 3 copies");
    expect(spike).toHaveAttribute("aria-haspopup", "dialog");
    expect(within(spike).getByText("×3")).toBeInTheDocument();
    expect(within(grid()).getByRole("button", { name: /Pikachu/ })).toHaveAccessibleName(
      "\u2068Pikachu\u2069, Common, \u2068Pokémon\u2069, 1 copy",
    );
    expect(within(grid()).getByRole("button", { name: /Pikachu/ })).not.toHaveTextContent("×");
    // The card inside is part of the button, not an article of its own.
    expect(within(grid()).queryAllByRole("article")).toHaveLength(0);
    expect(within(spike).getByText("#0012 / 2983")).toBeInTheDocument();
    // Dropped from the snapshot: no rank chip.
    expect(within(within(grid()).getByRole("button", { name: /Old Hero/ })).queryByText(/^#/)).toBeNull();
    expect(spike.querySelector(".card-frame-epic")).toHaveClass("shadow-glow-epic", "card-glint-hover");
  });

  it("a refetch that changes the results line announces nothing (§4.1 refreshing)", async () => {
    const fewer = makeOverviewCollection();
    fewer.entries = fewer.entries.filter((entry) => entry.character.id !== 3);
    const { user, queryClient } = await openCollection(sequence(overview, { status: 200, body: fewer }));
    const announced: string[] = [];
    const observer = new MutationObserver(() => announced.push(liveRegion().textContent ?? ""));
    observer.observe(liveRegion(), { childList: true, characterData: true, subtree: true });
    await queryClient.refetchQueries({ queryKey: ["collection"] });
    await waitFor(() => expect(results()).toHaveTextContent("4 results"), { timeout: ASYNC_TIMEOUT });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(announced.filter((text) => /results?$/.test(text))).toEqual([]);
    // A change the player makes is still heard.
    await user.click(screen.getByRole("button", { name: "Epic", pressed: false }));
    await waitFor(() => expect(liveRegion()).toHaveTextContent(/^\d+ results?$/), { timeout: 2_000 });
    observer.disconnect();
  });

  it("search updates per keystroke without a request, and the live region hears the line after 500 ms", async () => {
    const { fetchMock, user } = await openCollection();
    const asked = callsTo(fetchMock, COLLECTION).length;
    const search = screen.getByRole("searchbox", { name: "Search" });
    await user.type(search, "pok");
    expect(tileNames()).toEqual(["Moved Star", "Pikachu"]);
    expect(results()).toHaveTextContent("2 results");
    expect(liveRegion()).not.toHaveTextContent("2 results");
    await waitFor(() => expect(liveRegion()).toHaveTextContent("2 results"), { timeout: 2_000 });
    // Native titles match too.
    await user.clear(search);
    await user.type(search, "ビバップ");
    expect(tileNames()).toEqual(["Spike Spiegel", "Pikachu"]);
    expect(callsTo(fetchMock, COLLECTION)).toHaveLength(asked);
  });

  it("Escape in a non-empty search clears it and keeps focus there; Enter does nothing more", async () => {
    const { user } = await openCollection();
    const search = screen.getByRole("searchbox", { name: "Search" });
    await user.type(search, "spike{Enter}");
    expect(tileNames()).toEqual(["Spike Spiegel"]);
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(tileNames()).toHaveLength(5);
  });

  it("rarity chips: several at once, All releases them, releasing the last presses All; focus stays", async () => {
    const { user } = await openCollection();
    const group = screen.getByRole("group", { name: "Rarity" });
    const chip = (name: string) => within(group).getByRole("button", { name });
    await user.click(chip("Epic"));
    await user.click(chip("Rare"));
    expect(chip("All")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Epic")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Epic")).toHaveClass("bg-rarity-epic/15");
    expect(tileNames()).toEqual(["Spike Spiegel", "Gon Freecss"]);
    await user.click(chip("All"));
    expect(chip("All")).toHaveAttribute("aria-pressed", "true");
    expect(tileNames()).toHaveLength(5);
    await user.click(chip("Mythic"));
    expect(screen.getByText("No cards match these filters.")).toBeInTheDocument();
    await user.click(chip("Mythic"));
    expect(chip("All")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Mythic")).toHaveFocus();
  });

  it("series: options by title with their figures, years for shared titles, no figure once out of the snapshot", async () => {
    const { user } = await openCollection();
    const select = screen.getByRole("combobox", { name: "Series" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "All series",
      "\u2068Cowboy Bebop\u2069 · 2/4",
      "\u2068Hunter x Hunter, 1999\u2069 · 1/9",
      "\u2068Hunter x Hunter, 2011\u2069 · 1/9",
      "\u2068Lost Saga\u2069",
      "\u2068Pokémon\u2069 · 2/9",
    ]);
    await user.selectOptions(select, "100");
    // Any of the character's series counts, not only the primary one.
    expect(tileNames()).toEqual(["Spike Spiegel", "Pikachu"]);
    expect(screen.getByText(/: 2 of 4 characters$/)).toHaveTextContent("Cowboy Bebop: 2 of 4 characters");
    await user.selectOptions(select, "105");
    expect(tileNames()).toEqual(["Old Hero"]);
    expect(screen.queryByText(/: \d+ of \d+ characters$/)).not.toBeInTheDocument();
  });

  it("duplicates only shows entries with two or more copies", async () => {
    const { user } = await openCollection();
    await user.click(screen.getByRole("checkbox", { name: "Duplicates only" }));
    expect(tileNames()).toEqual(["Spike Spiegel", "Gon Freecss"]);
  });

  it("sort: the four orders", async () => {
    const { user } = await openCollection();
    const sort = screen.getByRole("combobox", { name: "Sort" });
    await user.selectOptions(sort, "name");
    expect(tileNames()).toEqual(["Gon Freecss", "Moved Star", "Old Hero", "Pikachu", "Spike Spiegel"]);
    await user.selectOptions(sort, "newest");
    expect(tileNames()).toEqual(["Moved Star", "Gon Freecss", "Old Hero", "Pikachu", "Spike Spiegel"]);
    await user.selectOptions(sort, "copies");
    expect(tileNames().slice(0, 2)).toEqual(["Spike Spiegel", "Gon Freecss"]);
  });

  it("Clear filters resets the search and filters, not the sort, and leaves focus on the results line", async () => {
    const { user } = await openCollection();
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "name");
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "o");
    await user.click(screen.getByRole("checkbox", { name: "Duplicates only" }));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Duplicates only" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveDisplayValue("Name, A to Z");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    expect(results()).toHaveFocus();
  });

  it("no matches: the query as typed, or the filters line, and Clear filters in place of the grid", async () => {
    const { user } = await openCollection();
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "zoro");
    expect(screen.getByText(/No cards match/)).toHaveTextContent('No cards match "zoro".');
    expect(screen.getByText("zoro", { selector: "bdi" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /results?/ })).not.toBeInTheDocument();
    expect(results()).toHaveTextContent("0 results");
    await waitFor(() => expect(liveRegion()).toHaveTextContent("No results"), { timeout: 2_000 });
    const clears = screen.getAllByRole("button", { name: "Clear filters" });
    await user.click(clears.at(-1)!);
    expect(tileNames()).toHaveLength(5);
  });

  it("the controls survive a page change and reset with the next session", async () => {
    const { user } = await openCollection();
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "spike");
    await user.click(screen.getByRole("link", { name: "Packs" }));
    await pageHeading("Packs");
    await user.click(screen.getByRole("link", { name: "Collection (8)" }));
    await pageHeading("Collection");
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("spike");
    expect(tileNames()).toEqual(["Spike Spiegel"]);
  });
});

describe("pages (§3.3, §5.3, §5.5)", () => {
  const big = { status: 200, body: makeLargeCollection(130) };

  it("60 per page; Previous, the page select and Next; focus to the results line after a change", async () => {
    const { user } = await openCollection(big);
    expect(results()).toHaveTextContent("130 results · page 1 of 3");
    expect(within(grid()).getAllByRole("listitem")).toHaveLength(60);
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(within(pages).getByRole("button", { name: "Previous page" })).toBeDisabled();
    const select = within(pages).getByRole("combobox", { name: "Page" });
    expect(select).toHaveAccessibleDescription("of 3");

    await user.click(within(pages).getByRole("button", { name: "Next page" }));
    expect(results()).toHaveTextContent("130 results · page 2 of 3");
    expect(results()).toHaveFocus();
    expect(tileNames()[0]).toBe("Card 0061");

    await user.selectOptions(select, "3");
    expect(within(grid()).getAllByRole("listitem")).toHaveLength(10);
    expect(within(pages).getByRole("button", { name: "Next page" })).toBeDisabled();
    await user.click(within(pages).getByRole("button", { name: "Previous page" }));
    expect(results()).toHaveTextContent("130 results · page 2 of 3");
    // A filter change returns to page 1.
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "card");
    expect(results()).toHaveTextContent("130 results · page 1 of 3");
  });

  it("a refetch keeps the page and clamps it when the page no longer exists", async () => {
    const { user, queryClient } = await openCollection(
      sequence(big, { status: 200, body: makeLargeCollection(70) }),
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Page" }), "3");
    await queryClient.refetchQueries({ queryKey: ["collection"] });
    await waitFor(() => expect(results()).toHaveTextContent("70 results · page 2 of 2"));
  });

  it("no page controls with one page", async () => {
    await openCollection();
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
  });

  it("3,000 entries: at most 60 tiles in the DOM (§5.5)", async () => {
    await openCollection({ status: 200, body: makeLargeCollection(3_000) });
    expect(results()).toHaveTextContent("3,000 results · page 1 of 50");
    // §8: numbers use Intl.NumberFormat("en-GB"), the card count too.
    expect(screen.getByText("3,000 cards · No duplicates")).toBeInTheDocument();
    expect(document.querySelectorAll("button[data-entry]")).toHaveLength(60);
    expect(document.querySelectorAll("img")).toHaveLength(60);
  });
});

describe("the Series view (§3.2 step 5, §4.3)", () => {
  it("every series in the server's order with its figure; 0 of N has no button; the source line", async () => {
    const { user } = await openCollection();
    const cards = screen.getByRole("button", { name: "Cards" });
    expect(cards).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Series" }));
    expect(screen.getByRole("button", { name: "Series" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Series" })).toHaveFocus();
    expect(document.querySelector("search")).toBeNull();

    const section = screen.getByRole("region", { name: "Series completion" });
    const rows = within(section).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Bleach0 of 12",
      "Cowboy Bebop2 of 4Show cards",
      "Pokémon2 of 9Show cards",
      "Hunter x Hunter, 20111 of 9Show cards",
      "Hunter x Hunter, 19991 of 9Show cards",
    ]);
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
    expect(within(rows[1]!).getByRole("button")).toHaveAccessibleName(
      "Show cards from \u2068Cowboy Bebop\u2069",
    );
    expect(within(section).getByText(/series from the 100 most popular/)).toHaveTextContent(
      "5 series from the 100 most popular anime on AniList, as of 29 Oct 2026.",
    );

    await user.selectOptions(within(section).getByRole("combobox", { name: "Sort" }), "title");
    expect(within(section).getAllByRole("listitem")[0]).toHaveTextContent(/^Bleach/);
    expect(within(section).getAllByRole("listitem")[1]).toHaveTextContent(/^Cowboy Bebop/);
  });

  it("Show cards: the Cards view filtered to that series alone, the sort kept, focus on the results line", async () => {
    const { user } = await openCollection();
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "name");
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "spike");
    await user.click(screen.getByRole("button", { name: "Series" }));
    await user.click(screen.getByRole("button", { name: "Show cards from \u2068Pokémon\u2069" }));

    expect(screen.getByRole("button", { name: "Cards" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Series" })).toHaveValue("101");
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveDisplayValue("Name, A to Z");
    expect(tileNames()).toEqual(["Moved Star", "Pikachu"]);
    expect(results()).toHaveFocus();
  });
});

describe("the card dialog (§3.4, §3.7, §4.5)", () => {
  it("opens on the tile: the dialog has focus and shows the details", async () => {
    const { user } = await openCollection();
    await user.click(within(grid()).getByRole("button", { name: /Spike/ }));
    const dialog = screen.getByRole("dialog", { name: "Spike Spiegel" });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByRole("heading", { level: 2, name: "Spike Spiegel" })).toHaveAttribute(
      "dir",
      "auto",
    );
    expect(within(dialog).getByText("スパイク・スピーゲル")).toHaveAttribute("lang", "ja");
    expect(within(dialog).getByText("カウボーイビバップ")).toHaveAttribute("lang", "ja");
    expect(within(dialog).getByRole("article")).toHaveClass("card-glint");
    const facts = dialog.querySelector("dl")!;
    expect([...facts.querySelectorAll("dt, dd")].map((node) => node.textContent)).toEqual([
      "Rarity",
      "✦✦✦✦Epic",
      "Copies",
      "3",
      "First obtained",
      "1 Oct 2026",
      "Last obtained",
      "20 Oct 2026",
    ]);
    expect(within(dialog).queryByText(/Packs now give|No longer in packs/)).toBeNull();
    expect(within(dialog).queryByText(/market|Recycle|Karma/i)).toBeNull();
  });

  it("one copy: no last obtained; another series: Also in, with the year where titles are shared", async () => {
    const { user } = await openCollection();
    await user.click(within(grid()).getByRole("button", { name: /Gon/ }));
    const gon = screen.getByRole("dialog", { name: "Gon Freecss" });
    expect(
      within(gon).getAllByText("Hunter x Hunter", { selector: "bdi" })[0]!.parentElement,
    ).toHaveTextContent("Hunter x Hunter, 2011");
    expect(within(gon).getByText("Also in").parentElement).toHaveTextContent("Also in Hunter x Hunter, 1999");
    await user.click(within(gon).getByRole("button", { name: "Close" }));

    await user.click(within(grid()).getByRole("button", { name: /Pikachu/ }));
    const pikachu = screen.getByRole("dialog", { name: "Pikachu" });
    expect(within(pikachu).queryByText("Last obtained")).toBeNull();
    expect(within(pikachu).getByText("Also in").parentElement).toHaveTextContent("Also in Cowboy Bebop");
  });

  it("notes: the tier moved, or out of the pool", async () => {
    const { user } = await openCollection();
    await user.click(within(grid()).getByRole("button", { name: /Moved Star/ }));
    const moved = screen.getByRole("dialog", { name: "Moved Star" });
    expect(within(moved).getByText(/Packs now give/)).toHaveTextContent("Packs now give Moved Star as Rare.");
    expect(within(moved).getByText("Moved Star", { selector: "bdi" })).toBeInTheDocument();
    // The card keeps its granted rarity.
    expect(within(moved).getByRole("article")).toHaveClass("card-frame-legendary");
    await user.click(within(moved).getByRole("button", { name: "Close" }));

    await user.click(within(grid()).getByRole("button", { name: /Old Hero/ }));
    const old = screen.getByRole("dialog", { name: "Old Hero" });
    expect(within(old).getByText("No longer in packs. Doesn't count toward completion.")).toBeInTheDocument();
    expect(within(old).queryByText(/Packs now give/)).toBeNull();
  });

  it("more than five other series: five, then `and <N> more`, which shows the rest in place", async () => {
    const data = makeOverviewCollection();
    const ids = [200, 201, 202, 203, 204, 205, 206, 207];
    data.franchises.push(
      ...ids.map((id) => ({ id, title: `Saga ${id}`, titleNative: null, startYear: 2000 })),
    );
    data.entries[0] = makeEntry(makeCharacter(1, { name: "Spike Spiegel", franchiseIds: [100, ...ids] }), {
      rarity: "epic",
    });
    const { user } = await openCollection({ status: 200, body: data });
    await user.click(within(grid()).getByRole("button", { name: /Spike/ }));
    const dialog = screen.getByRole("dialog", { name: "Spike Spiegel" });
    const alsoIn = within(dialog).getByText("Also in").parentElement!;
    expect(alsoIn).toHaveTextContent("Also in Saga 200, Saga 201, Saga 202, Saga 203, Saga 204 and 3 more");
    await user.click(within(alsoIn).getByRole("button", { name: "and 3 more" }));
    expect(alsoIn).toHaveTextContent("Saga 205, Saga 206, Saga 207");
    expect(within(alsoIn).queryByRole("button")).toBeNull();
  });

  it("Close returns focus to the tile it opened from", async () => {
    const { user } = await openCollection();
    const tile = within(grid()).getByRole("button", { name: /Gon/ });
    await user.click(tile);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(grid()).getByRole("button", { name: /Gon/ })).toHaveFocus();
  });

  it("the grid keeps its order while open; a refetch that drops the entry says so; close focuses the tile now there", async () => {
    const fewer = makeOverviewCollection();
    fewer.entries = fewer.entries.filter((entry) => entry.character.id !== 3);
    const { user, queryClient } = await openCollection(sequence(overview, { status: 200, body: fewer }));
    await user.click(within(grid()).getByRole("button", { name: /Gon/ }));
    await queryClient.refetchQueries({ queryKey: ["collection"] });
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("You no longer have this card.", {}, { timeout: ASYNC_TIMEOUT });
    expect(dialog).toHaveAccessibleName("You no longer have this card.");
    await user.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    // Gon was third: the tile now in third place takes focus.
    expect(within(grid()).getAllByRole("button")[2]).toHaveFocus();
    expect(tileNames()[2]).toBe("Old Hero");
  });

  it("an entry that goes with focus inside the details: focus moves to `You no longer have this card.` (§3.7, §4.5)", async () => {
    const data = makeOverviewCollection();
    const ids = [200, 201, 202, 203, 204, 205, 206];
    data.franchises.push(
      ...ids.map((id) => ({ id, title: `Saga ${id}`, titleNative: null, startYear: 2000 })),
    );
    data.entries[0] = makeEntry(makeCharacter(1, { name: "Spike Spiegel", franchiseIds: [100, ...ids] }), {
      rarity: "epic",
    });
    const fewer = structuredClone(data);
    fewer.entries = fewer.entries.filter((entry) => entry.character.id !== 1);
    const { user, queryClient } = await openCollection(
      sequence({ status: 200, body: data }, { status: 200, body: fewer }),
    );
    await user.click(within(grid()).getByRole("button", { name: /Spike/ }));
    const dialog = screen.getByRole("dialog", { name: "Spike Spiegel" });
    within(dialog).getByRole("button", { name: "and 2 more" }).focus();
    await queryClient.refetchQueries({ queryKey: ["collection"] });
    const gone = await within(dialog).findByText(
      "You no longer have this card.",
      {},
      { timeout: ASYNC_TIMEOUT },
    );
    expect(gone).toHaveAttribute("tabindex", "-1");
    expect(gone).toHaveFocus();
    // The next Tab goes on to the Close under it.
    await user.tab();
    expect(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)).toHaveFocus();
  });

  it("an entry that goes with focus on the top Close: focus stays there", async () => {
    const fewer = makeOverviewCollection();
    fewer.entries = fewer.entries.filter((entry) => entry.character.id !== 3);
    const { user, queryClient } = await openCollection(sequence(overview, { status: 200, body: fewer }));
    await user.click(within(grid()).getByRole("button", { name: /Gon/ }));
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Close" });
    close.focus();
    await queryClient.refetchQueries({ queryKey: ["collection"] });
    await within(dialog).findByText("You no longer have this card.", {}, { timeout: ASYNC_TIMEOUT });
    expect(close).toHaveFocus();
  });

  it("a refetch that empties the collection: the dialog stays with the gone message over the empty state; close focuses its heading", async () => {
    const { user, queryClient } = await openCollection(
      sequence(overview, { status: 200, body: makeCollection() }),
    );
    await user.click(within(grid()).getByRole("button", { name: /Gon/ }));
    const dialog = screen.getByRole("dialog");
    await queryClient.refetchQueries({ queryKey: ["collection"] });
    await within(dialog).findByText("You no longer have this card.", {}, { timeout: ASYNC_TIMEOUT });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName("You no longer have this card.");
    // Focus was on the dialog itself, which stays.
    expect(dialog).toHaveFocus();
    // The empty state is already under it.
    const heading = screen.getByRole("heading", { level: 2, name: "No cards yet", hidden: true });
    expect(screen.queryByRole("list", { name: /results?/, hidden: true })).not.toBeInTheDocument();
    await user.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveFocus();
    expect(screen.getByRole("link", { name: "Open a pack" })).toBeInTheDocument();
  });

  it("closing on a page that got shorter focuses the last tile", async () => {
    const onlyOne = makeOverviewCollection();
    onlyOne.entries = onlyOne.entries.filter((entry) => entry.character.id === 1);
    const { user, queryClient } = await openCollection(sequence(overview, { status: 200, body: onlyOne }));
    // Pikachu is the fifth tile; after the refetch there is one.
    await user.click(within(grid()).getByRole("button", { name: /Pikachu/ }));
    await queryClient.refetchQueries({ queryKey: ["collection"] });
    await within(screen.getByRole("dialog")).findByText(
      "You no longer have this card.",
      {},
      { timeout: ASYNC_TIMEOUT },
    );
    await user.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: "Close" })[0]!);
    expect(within(grid()).getByRole("button", { name: /Spike/ })).toHaveFocus();
  });

  it("closing with no tile left focuses the results line", async () => {
    const withoutPikachu = makeOverviewCollection();
    withoutPikachu.entries = withoutPikachu.entries.filter((entry) => entry.character.id !== 2);
    const { user, queryClient } = await openCollection(
      sequence(overview, { status: 200, body: withoutPikachu }),
    );
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "pikachu");
    await user.click(within(grid()).getByRole("button", { name: /Pikachu/ }));
    await queryClient.refetchQueries({ queryKey: ["collection"] });
    await within(screen.getByRole("dialog")).findByText(
      "You no longer have this card.",
      {},
      { timeout: ASYNC_TIMEOUT },
    );
    await user.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: "Close" })[0]!);
    expect(screen.getByText("pikachu", { selector: "bdi" }).parentElement).toHaveTextContent(
      'No cards match "pikachu".',
    );
    expect(results()).toHaveFocus();
  });

  it("the native close (Escape) closes it and returns focus the same way", async () => {
    const { user } = await openCollection();
    await user.click(within(grid()).getByRole("button", { name: /Pikachu/ }));
    screen.getByRole<HTMLDialogElement>("dialog").close();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(grid()).getByRole("button", { name: /Pikachu/ })).toHaveFocus();
  });
});

describe("states (§4.1)", () => {
  it("empty: `No cards yet` and a link to open a pack; no stats, view switch or toolbar", async () => {
    const user = userEvent.setup();
    const { history } = renderApp(
      { [COLLECTION]: { status: 200, body: makeCollection() } },
      makeAccount(),
      "/collection",
    );
    expect(
      await screen.findByRole("heading", { level: 2, name: "No cards yet" }, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    expect(document.querySelector("search")).toBeNull();
    expect(screen.queryByRole("group", { name: "View" })).not.toBeInTheDocument();
    expect(screen.queryByText(/characters$/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Open a pack" }));
    await pageHeading("Packs");
    expect(history.location.pathname).toBe("/packs");
  });

  it("loading over 300 ms: the skeleton, the view switch and toolbar disabled, the hidden status", async () => {
    renderApp({ [COLLECTION]: () => new Promise<MockAnswer>(() => undefined) }, account, "/collection");
    await pageHeading("Collection");
    expect(screen.queryByText("Loading your collection…")).not.toBeInTheDocument();
    expect(
      await screen.findByText("Loading your collection…", {}, { timeout: ASYNC_TIMEOUT }),
    ).toHaveAttribute("role", "status");
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Series" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cards" })).toBeDisabled();
    expect(
      within(screen.getByRole("group", { name: "Rarity" })).getByRole("button", { name: "All" }),
    ).toBeDisabled();
  });

  it("error with nothing held: the line and Try again, which asks once", async () => {
    const { fetchMock } = renderApp(
      { [COLLECTION]: sequence(envelope(500, "internal"), overview) },
      account,
      "/collection",
    );
    const user = userEvent.setup();
    expect(
      await screen.findByText("Couldn't load your collection.", {}, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    const before = callsTo(fetchMock, COLLECTION).length;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("8 cards · 3 duplicates", {}, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, COLLECTION)).toHaveLength(before + 1);
  });

  it("stale: a refetch with no answer keeps the held data, with its time and the banner", async () => {
    renderApp({ [COLLECTION]: sequence(overview, { status: 502, raw: "" }) }, account, "/packs");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Collection (8)" }, { timeout: ASYNC_TIMEOUT }));
    await pageHeading("Collection");
    expect(
      await screen.findByText(/^Showing your collection as of \d\d:\d\d\.$/, {}, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    expect(screen.getByText("8 cards · 3 duplicates")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the game server.");
    // Browsing and opening cards still work.
    await user.click(within(grid()).getByRole("button", { name: /Spike/ }));
    expect(screen.getByRole("dialog", { name: "Spike Spiegel" })).toBeInTheDocument();
  });

  it("an unauthenticated answer ends the session with /collection as the return path", async () => {
    const { history } = renderApp({ [COLLECTION]: envelope(401, "unauthenticated") }, account, "/collection");
    expect(await pageHeading("Log in")).toBeInTheDocument();
    expect(history.location.state).toMatchObject({ returnTo: "/collection" });
  });

  it("never reads or writes browser storage or the address", async () => {
    const { user, history } = await openCollection();
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "spike");
    await user.click(screen.getByRole("button", { name: "Series" }));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.getItem("anime-tcg:collection")).toBeNull();
    expect(history.location.href).toBe("/collection");
  });
});
