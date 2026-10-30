import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { envelope, makeAccount, type MockAnswer, type MockHandler } from "../test/api";
import { callsTo, COLLECTION, pageHeading, renderApp } from "../test/app";
import { makeCharacter, makeCollection, makeEntry, makeFranchise } from "../test/fixtures";

const ASYNC_TIMEOUT = 5_000;
const account = makeAccount({ cards: 9 });

const entries = [
  makeEntry(makeCharacter(1, { name: "Mythic One", tier: "mythic", rank: 12 })),
  makeEntry(makeCharacter(2, { name: "Epic Two", tier: "epic" }), { count: 3 }),
  makeEntry(makeCharacter(3, { name: "Common Three", tier: "common" }), { count: 5 }),
];
const collection: MockAnswer = { status: 200, body: makeCollection(entries) };

function sequence(...answers: MockAnswer[]): MockHandler {
  let call = 0;
  return () => answers[Math.min(call++, answers.length - 1)]!;
}

afterEach(() => vi.unstubAllGlobals());

describe("/collection, the interim view (packs-page.md §3.6)", () => {
  it("before the first answer the header counts AccountPublic.cards, then totals.cards", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderApp({ [COLLECTION]: () => gate.then(() => collection) }, makeAccount({ cards: 4 }), "/packs");
    expect(await screen.findByRole("link", { name: "Collection (4)" })).toBeInTheDocument();
    release();
    expect(await screen.findByRole("link", { name: "Collection (9)" })).toBeInTheDocument();
  });

  it("shows the totals, the per-tier totals, the filter and the server's entries in its order", async () => {
    renderApp({ [COLLECTION]: collection }, account, "/collection");
    expect(await screen.findByText("9 cards · 6 duplicates")).toBeInTheDocument();
    const mythic = screen.getByText("Mythic", { selector: ".text-rarity-mythic-text" });
    expect(mythic.parentElement).toHaveTextContent("Mythic 1");
    expect(screen.getByText("Epic", { selector: "span" })).toHaveClass("text-rarity-epic-text");

    const select = screen.getByRole("combobox", { name: "Rarity" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All rarities", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"]);
    const grid = screen.getByRole("list", { name: "Your cards" });
    expect(
      within(grid)
        .getAllByRole("article")
        .map((card) => card.getAttribute("aria-label")),
    ).toEqual([
      "\u2068Mythic One\u2069, Mythic, \u2068Series 101\u2069",
      "\u2068Epic Two\u2069, Epic, \u2068Series 102\u2069",
      "\u2068Common Three\u2069, Common, \u2068Series 100\u2069",
    ]);
    expect(within(grid).getByText("#0012 / 2983")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("captions duplicates under the card, ×N hidden and N copies spoken; grid cards glint on hover only", async () => {
    renderApp({ [COLLECTION]: collection }, account, "/collection");
    const grid = await screen.findByRole("list", { name: "Your cards" }, { timeout: ASYNC_TIMEOUT });
    const [mythic, epic, common] = within(grid).getAllByRole("listitem");
    expect(within(epic!).getByText("×3")).toHaveAttribute("aria-hidden", "true");
    expect(within(epic!).getByText("3 copies")).toHaveClass("sr-only");
    expect(within(common!).getByText("5 copies")).toBeInTheDocument();
    expect(within(mythic!).queryByText(/copies|×/)).not.toBeInTheDocument();
    expect(within(epic!).getByRole("article")).toHaveClass("shadow-glow-epic", "card-glint-hover");
    expect(within(mythic!).getByRole("article")).toHaveClass("card-pearl-hover");
    expect(within(grid).queryAllByRole("button")).toHaveLength(0);
  });

  it("the filter is a view: no request, a no-match line, and it survives a page change", async () => {
    const { fetchMock } = renderApp({ [COLLECTION]: collection }, account, "/collection");
    const user = userEvent.setup();
    const select = await screen.findByRole("combobox", { name: "Rarity" }, { timeout: ASYNC_TIMEOUT });
    const asked = callsTo(fetchMock, COLLECTION).length;

    await user.selectOptions(select, "epic");
    expect(within(screen.getByRole("list", { name: "Your cards" })).getAllByRole("article")).toHaveLength(1);
    await user.selectOptions(select, "legendary");
    expect(screen.getByText("No Legendary cards in your collection.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your cards" })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, COLLECTION)).toHaveLength(asked);

    await user.click(screen.getByRole("link", { name: "Packs" }));
    await pageHeading("Packs");
    await user.click(screen.getByRole("link", { name: "Collection (9)" }));
    await pageHeading("Collection");
    expect(screen.getByRole("combobox", { name: "Rarity" })).toHaveValue("legendary");
  });

  it("refetches silently each time the page is shown", async () => {
    const { fetchMock } = renderApp({ [COLLECTION]: collection }, account, "/packs");
    const user = userEvent.setup();
    await waitFor(() => expect(callsTo(fetchMock, COLLECTION)).toHaveLength(1));
    await user.click(await screen.findByRole("link", { name: "Collection (9)" }));
    await pageHeading("Collection");
    await waitFor(() => expect(callsTo(fetchMock, COLLECTION)).toHaveLength(2));
    expect(screen.queryByText("Loading your collection…")).not.toBeInTheDocument();
  });

  it("empty: `No cards yet` and a link to open a pack, no totals or filter", async () => {
    const user = userEvent.setup();
    const { history } = renderApp({}, makeAccount(), "/collection");
    expect(await screen.findByRole("heading", { level: 2, name: "No cards yet" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Open a pack" }));
    await pageHeading("Packs");
    expect(history.location.pathname).toBe("/packs");
  });

  it("loading over 300 ms: the skeleton, the select disabled, the hidden status", async () => {
    renderApp({ [COLLECTION]: () => new Promise<MockAnswer>(() => undefined) }, account, "/collection");
    await pageHeading("Collection");
    expect(screen.queryByText("Loading your collection…")).not.toBeInTheDocument();
    expect(
      await screen.findByText("Loading your collection…", {}, { timeout: ASYNC_TIMEOUT }),
    ).toHaveAttribute("role", "status");
    expect(screen.getByRole("combobox", { name: "Rarity" })).toBeDisabled();
  });

  it("error with nothing held: the line and Try again, which asks once", async () => {
    const { fetchMock } = renderApp(
      { [COLLECTION]: sequence(envelope(500, "internal"), collection) },
      account,
      "/collection",
    );
    const user = userEvent.setup();
    expect(
      await screen.findByText("Couldn't load your collection.", {}, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    const before = callsTo(fetchMock, COLLECTION).length;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("9 cards · 6 duplicates")).toBeInTheDocument();
    expect(callsTo(fetchMock, COLLECTION)).toHaveLength(before + 1);
  });

  it("stale: a refetch with no answer keeps the held data, with its time and the banner", async () => {
    renderApp({ [COLLECTION]: sequence(collection, { status: 502, raw: "" }) }, account, "/packs");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Collection (9)" }));
    await pageHeading("Collection");
    expect(await screen.findByText(/^Showing your collection as of \d\d:\d\d\.$/)).toBeInTheDocument();
    expect(screen.getByText("9 cards · 6 duplicates")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the game server.");
  });

  it("an unauthenticated answer ends the session with /collection as the return path", async () => {
    const { history } = renderApp({ [COLLECTION]: envelope(401, "unauthenticated") }, account, "/collection");
    expect(await pageHeading("Log in")).toBeInTheDocument();
    expect(history.location.state).toMatchObject({ returnTo: "/collection" });
  });

  it("renders hostile names and series titles as text (T1)", async () => {
    const hostile = makeCollection([
      makeEntry(makeCharacter(5, { name: "<img src=x onerror=alert(1)>", franchiseIds: [7] })),
    ]);
    hostile.franchises.push(makeFranchise(7, { title: "\u202E<script>alert(1)</script>" }));
    renderApp({ [COLLECTION]: { status: 200, body: hostile } }, account, "/collection");
    const name = await screen.findByText("<img src=x onerror=alert(1)>");
    const series = screen.getByText("\u202E<script>alert(1)</script>");
    expect(document.querySelectorAll("script")).toHaveLength(0);
    // Each in its own `dir="auto"` element, and isolated in the plain strings (collection-overview.md §5.6).
    expect(name).toHaveAttribute("dir", "auto");
    expect(series).toHaveAttribute("dir", "auto");
    expect(name).toHaveAttribute("title", "\u2068<img src=x onerror=alert(1)>\u2069");
    expect(series).toHaveAttribute("title", "\u2068\u202E<script>alert(1)</script>\u2069");
    expect(screen.getByRole("article").getAttribute("aria-label")).toMatch(
      /^\u2068<img src=x onerror=alert\(1\)>\u2069, \w+, \u2068\u202E<script>alert\(1\)<\/script>\u2069$/,
    );
  });
});
