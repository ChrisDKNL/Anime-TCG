import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  envelope,
  held,
  makeAccount,
  rateLimited,
  requestIdOf,
  sequence,
  type MockAnswer,
  type MockHandler,
} from "../test/api";
import { callsTo, COLLECTION, LIST, LISTINGS, pageHeading, renderApp, WALLET } from "../test/app";
import { makeOverviewCollection } from "../test/collectionFixtures";
import {
  makeCharacter,
  makeCollection,
  makeEntry,
  makeListing,
  makeListingsPage,
  makeWallet,
} from "../test/fixtures";

const account = makeAccount({ cards: 8 });
const overview: MockAnswer = { status: 200, body: makeOverviewCollection() };
const lostAnswer: MockAnswer = { status: 502, raw: "<html>proxy</html>" };
const NO_ANSWER = "Couldn't reach the game server, so this may not have gone through.";
const SOMETHING_CHANGED = "Something changed since you opened this card. Check the numbers and try again.";
const listed: MockAnswer = {
  status: 201,
  body: makeListing(9, { mine: true, character: makeCharacter(1), rarity: "epic", price: 120, fee: 6 }),
};

const dialog = () => screen.getByRole("dialog");
const section = () => within(dialog()).getByRole("region", { name: "List on the market" });
const listButton = () => within(section()).getByRole("button", { name: "List…" });
const field = () => within(section()).getByRole("textbox", { name: "Price" });
const confirmButton = (name = "List for 120 Karma") => within(dialog()).getByRole("button", { name });
const listIds = (fetchMock: Parameters<typeof callsTo>[0]) =>
  callsTo(fetchMock, LIST).map(([, init]) => requestIdOf(init));

async function openCard(name = "Spike", routes: Record<string, MockHandler> = {}) {
  const rendered = renderApp({ [COLLECTION]: overview, ...routes }, account, "/collection");
  const user = userEvent.setup();
  const grid = await screen.findByRole("list", { name: /results?/ });
  await within(screen.getByRole("banner")).findByText("Karma");
  await user.click(within(grid).getByRole("button", { name: new RegExp(name) }));
  return { ...rendered, user };
}

/** Spike's dialog, a price of 120 typed, and the confirmation open. */
async function confirmList(routes: Record<string, MockHandler> = {}) {
  const rendered = await openCard("Spike", routes);
  await rendered.user.type(field(), "120");
  await rendered.user.click(listButton());
  return rendered;
}

afterEach(() => vi.unstubAllGlobals());

describe("List on the market: the section (collection-overview.md §3.5 steps 1 to 4, §4.6)", () => {
  it("idle: an empty price with the rarity's bounds, the market link, and no fee line yet", async () => {
    await openCard();
    const headings = within(dialog()).getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(["List on the market", "Recycle for Karma"]);
    expect(field()).toHaveValue("");
    expect(field()).toHaveAttribute("inputmode", "numeric");
    expect(field()).toHaveAccessibleDescription("80 to 400 Karma");
    expect(within(section()).queryByText(/^Fee/)).not.toBeInTheDocument();
    expect(listButton()).not.toHaveAttribute("aria-disabled");
    expect(
      within(section()).getByRole("button", { name: "See Spike Spiegel on the market" }),
    ).toBeInTheDocument();
  });

  it("the fee line follows a valid price, from the wallet's published rule", async () => {
    const { user } = await openCard();
    await user.type(field(), "120");
    expect(
      within(section()).getByText("Fee 6 Karma (5%). You get 114 Karma if it sells."),
    ).toBeInTheDocument();
    expect(field()).toHaveAccessibleDescription(
      "80 to 400 Karma Fee 6 Karma (5%). You get 114 Karma if it sells.",
    );
    await user.clear(field());
    await user.type(field(), "79");
    expect(within(section()).queryByText(/^Fee/)).not.toBeInTheDocument();
  });

  it("an invalid price shows the field error, takes focus, and sends nothing", async () => {
    const { user, fetchMock } = await openCard();
    await user.type(field(), "4000");
    await user.click(listButton());
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveFocus();
    expect(within(section()).getByText("Choose a whole number from 80 to 400.")).toBeInTheDocument();
    expect(callsTo(fetchMock, LIST)).toHaveLength(0);
  });

  it("every copy listed: no field, List… disabled with the reason", async () => {
    const all = makeCollection([
      makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), {
        count: 2,
        listed: 2,
        available: 0,
        recyclable: 0,
      }),
    ]);
    const { user, fetchMock } = await openCard("Spike", { [COLLECTION]: { status: 200, body: all } });
    expect(within(section()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(listButton()).toHaveAttribute("aria-disabled", "true");
    expect(listButton()).toHaveAccessibleDescription("Every copy is already on the market.");
    await user.click(listButton());
    expect(callsTo(fetchMock, LIST)).toHaveLength(0);
  });

  it("at the listing cap: List… disabled with the cap line and a My listings link", async () => {
    const { user, history } = await openCard("Spike", {
      [WALLET]: { status: 200, body: { ...makeWallet(), activeListings: 50 } },
    });
    expect(listButton()).toHaveAttribute("aria-disabled", "true");
    expect(within(section()).getByText(/^You have 50 cards on the market/)).toHaveTextContent(
      "You have 50 cards on the market, the most at once. Cancel a listing to list this card. My listings",
    );
    await user.click(within(section()).getByRole("link", { name: "My listings" }));
    expect(await pageHeading("Market")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/market");
    expect(screen.getByRole("button", { name: "My listings", pressed: true })).toBeInTheDocument();
  });

  it("See <name> on the market: the dialog closes and /market shows that character only", async () => {
    const { user, fetchMock, history } = await openCard("Spike", {
      "GET /api/market/listings?characterId=1&sort=price_asc": { status: 200, body: makeListingsPage([]) },
      [LISTINGS]: { status: 200, body: makeListingsPage([makeListing(1)]) },
    });
    await user.click(within(section()).getByRole("button", { name: "See Spike Spiegel on the market" }));
    expect(await pageHeading("Market")).toHaveFocus();
    expect(history.location.pathname).toBe("/market");
    expect(history.location.search).toBe("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const line = await screen.findByText(/^Showing/);
    expect(line).toHaveTextContent("Showing Spike Spiegel only. Show all");
    expect(within(line).getByText("Spike Spiegel", { selector: "bdi" })).toBeInTheDocument();
    expect(callsTo(fetchMock, "GET /api/market/listings?characterId=1&sort=price_asc")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(await screen.findByText("1 listing shown")).toHaveFocus();
    history.back();
    expect(await pageHeading("Collection")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("List on the market: the confirmation and its answers (§3.5 steps 5 to 10)", () => {
  it("names the copy, the time, the net after the fee and that a sale can't be undone", async () => {
    await confirmList();
    const heading = within(dialog()).getByRole("heading", {
      level: 2,
      name: "List Spike Spiegel for 120 Karma?",
    });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAccessibleDescription(
      "One Epic copy goes on the market for 7 days. If someone buys it, you get 114 Karma after the 6 Karma fee. It stays in your collection until it sells, and you can cancel the listing until then. A sale can't be undone.",
    );
  });

  it("the only copy of a character says so", async () => {
    const { user } = await openCard("Pikachu");
    await user.type(field(), "10");
    await user.click(listButton());
    expect(within(dialog()).getByRole("heading", { level: 2 })).toHaveAccessibleDescription(
      /This is your only Pikachu; once it sells, it stops counting toward completion\. A sale can't be undone\.$/,
    );
  });

  it("201: back to the details with the server's listing, the field cleared, the collection and wallet read again", async () => {
    const { user, fetchMock } = await confirmList({ [LIST]: listed });
    const collections = callsTo(fetchMock, COLLECTION).length;
    const wallets = callsTo(fetchMock, WALLET).length;
    await user.click(confirmButton());
    const status = await within(dialog()).findByText(/^Listed for/);
    expect(status).toHaveTextContent(
      /^Listed for 120 Karma until 6 Nov 2026, \d\d:\d\d\. The fee is 6 Karma if it sells\.$/,
    );
    expect(within(dialog()).getByRole("heading", { level: 2, name: "Spike Spiegel" })).toHaveFocus();
    expect(field()).toHaveValue("");
    const [call] = callsTo(fetchMock, LIST);
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      requestId: requestIdOf(call![1]),
      characterId: 1,
      rarity: "epic",
      price: 120,
    });
    await waitFor(() => expect(callsTo(fetchMock, COLLECTION).length).toBeGreaterThan(collections));
    await waitFor(() => expect(callsTo(fetchMock, WALLET).length).toBeGreaterThan(wallets));
  });

  it("Cancel and Escape return to the details with the price kept and focus on List…", async () => {
    const { user } = await confirmList();
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(field()).toHaveValue("120");
    expect(listButton()).toHaveFocus();
    await user.click(listButton());
    fireEvent(dialog(), new Event("cancel", { cancelable: true }));
    expect(listButton()).toHaveFocus();
  });

  it("price_out_of_bounds: the neutral notice, the field kept with its error, the wallet read again", async () => {
    const { user, fetchMock } = await confirmList({
      [LIST]: envelope(400, "price_out_of_bounds"),
      [WALLET]: sequence(
        { status: 200, body: makeWallet() },
        { status: 200, body: makeWallet(1_240, { priceMax: { ...makeWallet().rules.priceMax, epic: 100 } }) },
      ),
    });
    await user.click(confirmButton());
    expect(await within(section()).findByText(SOMETHING_CHANGED)).toBeInTheDocument();
    expect(field()).toHaveValue("120");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(await within(section()).findByText("Choose a whole number from 80 to 100.")).toBeInTheDocument();
    expect(callsTo(fetchMock, WALLET).length).toBeGreaterThanOrEqual(2);
  });

  it.each(["not_enough_copies", "request_id_reused"] as const)(
    "%s: the neutral notice and the collection read again",
    async (code) => {
      const { user, fetchMock } = await confirmList({ [LIST]: envelope(409, code) });
      const reads = callsTo(fetchMock, COLLECTION).length;
      await user.click(confirmButton());
      expect(await within(section()).findByText(SOMETHING_CHANGED)).toBeInTheDocument();
      await waitFor(() => expect(callsTo(fetchMock, COLLECTION).length).toBeGreaterThan(reads));
    },
  );

  it("listing_limit: the cap line as a red line with My listings", async () => {
    const { user } = await confirmList({ [LIST]: envelope(409, "listing_limit") });
    await user.click(confirmButton());
    expect(await within(section()).findByRole("alert")).toHaveTextContent(
      "You have 50 cards on the market, the most at once. Cancel a listing to list this card. My listings",
    );
  });

  it("a server failure keeps the confirmation with the banner and the button enabled", async () => {
    const { user } = await confirmList({ [LIST]: envelope(500, "internal") });
    await user.click(confirmButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
    expect(confirmButton()).not.toHaveAttribute("aria-disabled");
  });

  it("in flight: Listing…, nothing closes the dialog, and a double click sends once", async () => {
    const answer = held(listed);
    const { fetchMock } = await confirmList({ [LIST]: answer.handler });
    fireEvent.click(confirmButton(), { detail: 1 });
    fireEvent.click(confirmButton("Listing…"), { detail: 2 });
    expect(callsTo(fetchMock, LIST)).toHaveLength(1);
    expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent(dialog(), new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    answer.release();
    expect(await within(dialog()).findByText(/^Listed for 120 Karma/)).toHaveAttribute("role", "status");
  });

  it("no answer: the banner, Try again resends the same key; a 429 keeps it too", async () => {
    const { user, fetchMock } = await confirmList({ [LIST]: sequence(lostAnswer, rateLimited("1"), listed) });
    await user.click(confirmButton());
    expect(await within(dialog()).findByText(NO_ANSWER)).toHaveAttribute("role", "alert");
    await user.click(within(dialog()).getByRole("button", { name: "Try again" }));
    expect(
      await within(dialog()).findByText("That was a lot in a short time. Give it a few seconds."),
    ).toBeInTheDocument();
    await waitFor(() => expect(confirmButton()).not.toHaveAttribute("aria-disabled"), { timeout: 3000 });
    await user.click(confirmButton());
    await within(dialog()).findByText(/^Listed for 120 Karma/);
    const ids = listIds(fetchMock);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
  });

  it("Cancel after no answer discards the key: the next confirmation is a new request", async () => {
    const { user, fetchMock } = await confirmList({ [LIST]: sequence(lostAnswer, listed) });
    await user.click(confirmButton());
    await within(dialog()).findByText(NO_ANSWER);
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await user.click(listButton());
    await user.click(confirmButton());
    await within(dialog()).findByText(/^Listed for 120 Karma/);
    const [first, second] = listIds(fetchMock);
    expect(first).not.toBe(second);
  });
});

describe("listed copies in the grid and the dialog (§3.4 step 2, §6.2)", () => {
  it("the tile reads `<L> listed` and the dialog's facts show On the market", async () => {
    const data = makeCollection([
      makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), {
        count: 3,
        listed: 2,
        available: 1,
        recyclable: 1,
      }),
    ]);
    const { user } = await openCard("Spike", { [COLLECTION]: { status: 200, body: data } });
    const facts = dialog().querySelector("dl")!;
    expect([...facts.querySelectorAll("dt, dd")].map((node) => node.textContent).slice(0, 6)).toEqual([
      "Rarity",
      "✦✦✦✦Epic",
      "Copies",
      "3",
      "On the market",
      "2",
    ]);
    await user.click(within(dialog()).getAllByRole("button", { name: "Close" })[0]!);
    const tile = within(screen.getByRole("list", { name: /result/ })).getByRole("button", { name: /Spike/ });
    expect(tile).toHaveAccessibleName(/, 3 copies, 2 listed$/);
    expect(within(tile).getByText("2 listed")).toBeInTheDocument();
    expect(within(tile).getByText("×3")).toBeInTheDocument();
  });
});
