import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  envelope,
  makeAccount,
  rateLimited,
  requestIdOf,
  type MockAnswer,
  type MockHandler,
} from "../test/api";
import { BUY, callsTo, COLLECTION, liveRegion, pageHeading, renderApp, SHOP, WALLET } from "../test/app";
import {
  FRANCHISES,
  makeFranchise,
  makePackOpened,
  makeShop,
  makeShopReceipt,
  makeTheme,
  makeWallet,
} from "../test/fixtures";

const account = makeAccount();
const UNREACHABLE = "Couldn't reach the game server. Check your connection and try again.";
const NO_ANSWER = "Couldn't reach the game server, so this may not have gone through.";

/** Answers in turn; the last one keeps answering. */
function sequence(...answers: MockHandler[]): MockHandler {
  let call = 0;
  return (init, url) => {
    const answer = answers[Math.min(call, answers.length - 1)]!;
    call += 1;
    return typeof answer === "function" ? answer(init, url) : answer;
  };
}

/** A request held in flight until the test lets it answer. */
function held(answer: MockAnswer): { handler: MockHandler; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { handler: () => gate.then(() => answer), release };
}

const lostAnswer: MockAnswer = { status: 502, raw: "<html>proxy</html>" };
const header = () => within(screen.getByRole("banner"));
const main = () => within(screen.getByRole("main"));
const theme = (name = "Action") => main().getByRole("article", { name });
/** The series line: the theme's first paragraph that starts with a series title. */
const seriesLine = (article: HTMLElement) =>
  within(article).getByText((_, node) => node?.tagName === "P" && /^Series 100/.test(node.textContent ?? ""));
const confirmation = () => screen.getByRole("dialog", { name: "Buy the Action pack?" });

async function openShop(routes: Record<string, MockHandler> = {}) {
  const rendered = renderApp(routes, account, "/shop");
  await pageHeading("Shop");
  return { ...rendered, user: userEvent.setup() };
}

/** Opens the shop, waits for the theme and the balance, and opens the confirmation. */
async function confirmBuy(routes: Record<string, MockHandler> = {}) {
  const rendered = await openShop(routes);
  await main().findByRole("article", { name: "Action" });
  await header().findByText("Karma");
  await rendered.user.click(within(theme()).getByRole("button", { name: "Buy…" }));
  return rendered;
}

const buyIds = (fetchMock: Parameters<typeof callsTo>[0]) =>
  callsTo(fetchMock, BUY).map(([, init]) => requestIdOf(init));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/shop and the header (market-and-shop.md §3.1 to §3.3)", () => {
  it("shows the balance in the header as plain text, and each theme with its series, odds and price", async () => {
    await openShop();
    expect(document.title).toBe("Shop · Anime TCG");
    const balance = await header().findByText("1,240");
    expect(balance.closest("p")).toHaveTextContent(/^1,240 Karma$/);
    expect(balance.closest("p")).not.toHaveAttribute("aria-live");
    expect(balance.closest("p")).not.toHaveAttribute("role");

    const action = await main().findByRole("article", { name: "Action" });
    expect(within(action).getByRole("heading", { level: 2, name: "Action" })).toHaveAttribute("dir", "auto");
    expect(within(action).getByText("400 Karma")).toBeInTheDocument();
    expect(seriesLine(action)).toHaveTextContent(/^Series 100, Series 101 and Series 102$/);
    expect(
      within(action).getByText(
        (_, node) =>
          node?.tagName === "P" &&
          node.textContent ===
            "At least one per pack: Common 99.9% · Uncommon 100% · Rare 80% · Epic 17% · Legendary 2.75% · Mythic 0.25%",
      ),
    ).toBeInTheDocument();
    expect(within(action).getByText("Odds per card")).toBeInTheDocument();
    expect(
      within(action).getByText(
        "Drawn from 420 Common, 300 Uncommon, 240 Rare, 140 Epic, 70 Legendary and 25 Mythic characters.",
      ),
    ).toBeInTheDocument();
    expect(
      within(action).getByText(
        "About 1 pack in 2,500 is Radiant: five cards of Epic or better, at least one of them Mythic.",
      ),
    ).toBeInTheDocument();
    expect(
      within(action).getByText("Shop packs don't count toward Enchanted packs or the guarantee."),
    ).toBeInTheDocument();
    const buy = within(action).getByRole("button", { name: "Buy…" });
    expect(buy).not.toHaveAttribute("aria-disabled");
    expect(buy).toHaveAccessibleDescription("400 Karma");
  });

  it("links Packs, Shop, Market and Collection; the free pack page never mentions the shop", async () => {
    await openShop();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Shop" })).toHaveAttribute("aria-current", "page");
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/packs", "/shop", "/market", "/collection"]);
  });

  it("the first three series, then `and <N> more`, which shows the rest in place", async () => {
    const franchises = [...FRANCHISES, makeFranchise(103), makeFranchise(104, { title: "‮evil" })];
    const { user } = await openShop({
      [SHOP]: {
        status: 200,
        body: makeShop([makeTheme("genre-action", { franchiseIds: franchises.map((f) => f.id) })], {
          franchises,
        }),
      },
    });
    const action = await main().findByRole("article", { name: "Action" });
    expect(seriesLine(action)).toHaveTextContent(/^Series 100, Series 101, Series 102 and 2 more$/);
    await user.click(within(action).getByRole("button", { name: "and 2 more" }));
    const line = seriesLine(action);
    expect(line).toHaveTextContent(/^Series 100, Series 101, Series 102, Series 103 and ‮evil$/);
    expect(line.querySelectorAll("bdi")).toHaveLength(5);
  });

  it("several themes in the server's order", async () => {
    await openShop({
      [SHOP]: {
        status: 200,
        body: makeShop([makeTheme("genre-romance", { title: "Romance" }), makeTheme("genre-action")]),
      },
    });
    await main().findByRole("article", { name: "Romance" });
    expect(
      main()
        .getAllByRole("article")
        .map((article) => article.querySelector("h2")?.textContent),
    ).toEqual(["Romance", "Action"]);
  });

  it("too little Karma: Buy… is disabled with the reason, and opens nothing", async () => {
    const { user } = await openShop({ [WALLET]: { status: 200, body: makeWallet(120) } });
    const action = await main().findByRole("article", { name: "Action" });
    await header().findByText("120");
    const buy = within(action).getByRole("button", { name: "Buy…" });
    expect(buy).toHaveAttribute("aria-disabled", "true");
    expect(within(action).getByText("Costs 400 Karma. You have 120.")).toBeInTheDocument();
    expect(buy).toHaveAccessibleDescription("400 Karma Costs 400 Karma. You have 120.");
    await user.click(buy);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["no themes", makeShop([])],
    ["no snapshot", makeShop([], { snapshot: null })],
  ])("empty (%s): `No packs in the shop.`", async (_, body) => {
    await openShop({ [SHOP]: { status: 200, body } });
    expect(await main().findByText("No packs in the shop.")).toBeInTheDocument();
    expect(main().queryByRole("article")).not.toBeInTheDocument();
  });

  it("loading: the h1 at once, then three static rows and the hidden status", async () => {
    const shop = held({ status: 200, body: makeShop() });
    renderApp({ [SHOP]: shop.handler }, account, "/shop");
    expect(await pageHeading("Shop")).toBeInTheDocument();
    expect(await screen.findByText("Loading the shop…")).toHaveClass("sr-only");
    shop.release();
    await main().findByRole("article", { name: "Action" });
    expect(screen.queryByText("Loading the shop…")).not.toBeInTheDocument();
  });

  it("error with nothing held: the line and Try again, which asks once more", async () => {
    const { user, fetchMock } = await openShop({
      [SHOP]: sequence(envelope(500, "internal"), { status: 200, body: makeShop() }),
    });
    expect(await main().findByText("Couldn't load the shop.")).toBeInTheDocument();
    await user.click(main().getByRole("button", { name: "Try again" }));
    await main().findByRole("article", { name: "Action" });
    expect(callsTo(fetchMock, SHOP)).toHaveLength(2);
  });

  it("stale: the wallet did not answer, so no balance shows and Buy… waits", async () => {
    await openShop({ [WALLET]: envelope(500, "internal") });
    const action = await main().findByRole("article", { name: "Action" });
    await waitFor(() =>
      expect(within(action).getByText("Buying waits until the game server answers.")).toBeInTheDocument(),
    );
    expect(within(action).getByRole("button", { name: "Buy…" })).toHaveAttribute("aria-disabled", "true");
    expect(header().queryByText(/Karma/)).not.toBeInTheDocument();
  });

  it("showing the page reads the shop and the wallet again", async () => {
    const { fetchMock, history } = await openShop();
    await main().findByRole("article", { name: "Action" });
    const before = [callsTo(fetchMock, SHOP).length, callsTo(fetchMock, WALLET).length];
    act(() => history.push("/packs"));
    await pageHeading("Packs");
    act(() => history.push("/shop"));
    await pageHeading("Shop");
    await waitFor(() => expect(callsTo(fetchMock, SHOP).length).toBe(before[0]! + 1));
    expect(callsTo(fetchMock, WALLET).length).toBeGreaterThan(before[1]!);
  });

  it("never reads or writes browser storage or the address", async () => {
    const { user, history } = await confirmBuy();
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    await main().findByRole("heading", { level: 2, name: "Action pack" });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    // The bought pack has its own page; no query string or hash is ever written.
    expect(history.location.href).toBe("/shop/open");
  });
});

describe("buying a pack (§3.3 steps 4 to 6)", () => {
  it("the confirmation names the price, the cards and the balance; the heading has focus", async () => {
    await confirmBuy();
    const dialog = confirmation();
    const heading = within(dialog).getByRole("heading", { name: "Buy the Action pack?" });
    expect(heading).toHaveFocus();
    expect(heading.querySelector("bdi")).toHaveTextContent("Action");
    expect(dialog).toHaveAccessibleDescription(
      "400 Karma for 5 cards from this pack's characters, at the odds shown. You have 1,240 Karma. There is no undo.",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("201: one request with the key and the theme only; /shop/open, the header and the live region take the receipt", async () => {
    const { user, fetchMock, history } = await confirmBuy();
    const collectionsBefore = callsTo(fetchMock, COLLECTION).length;
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));

    const page = await pageHeading("Shop pack");
    await waitFor(() => expect(page).toHaveFocus());
    expect(history.location.pathname).toBe("/shop/open");
    expect(history.length).toBe(2);
    expect(document.title).toBe("Shop pack · Anime TCG");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(main().getByRole("heading", { level: 2, name: "Action pack" })).toBeInTheDocument();
    const items = within(main().getByRole("list", { name: "Action pack" })).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    for (const item of items) expect(item).toHaveClass("animate-card-enter");
    expect(header().getByText("840")).toBeInTheDocument();
    await waitFor(() =>
      expect(liveRegion()).toHaveTextContent("Bought the ⁨Action⁩ pack for 400 Karma. You have 840 Karma."),
    );
    const [[, init]] = callsTo(fetchMock, BUY) as [[unknown, RequestInit]];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["requestId", "themeId"]);
    expect(body.themeId).toBe("genre-action");
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(callsTo(fetchMock, COLLECTION).length).toBeGreaterThan(collectionsBefore));
    // No buy button on /shop/open: a spend always starts from the shop, its price and its odds.
    expect(main().queryByRole("button")).not.toBeInTheDocument();
    expect(main().queryByRole("article", { name: "Action" })).not.toBeInTheDocument();
    expect(main().getByRole("link", { name: "Back to the shop" })).toHaveAttribute("href", "/shop");
  });

  it("a Radiant shop pack says so under the summary; never Enchanted or the guarantee", async () => {
    const { user } = await confirmBuy({
      [BUY]: { status: 201, body: makeShopReceipt({ pack: makePackOpened({ packKind: "radiant" }) }) },
    });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    const section = await main().findByRole("region", { name: "Action pack" });
    expect(
      within(section).getByText(
        "About 1 pack in 2,500 is Radiant: five cards of Epic or better, at least one of them Mythic.",
      ),
    ).toBeInTheDocument();
    expect(within(section).queryByText(/Enchanted|guarantee/)).not.toBeInTheDocument();
  });

  it("in flight: Buying…, Cancel and Escape do nothing, and a double click sends one request", async () => {
    const buy = held({ status: 201, body: makeShopReceipt() });
    const { user, fetchMock } = await confirmBuy({ [BUY]: buy.handler });
    await user.dblClick(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    const busy = within(confirmation()).getByRole("button", { name: "Buying…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(within(confirmation()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    const escape = new Event("cancel", { cancelable: true });
    fireEvent(confirmation(), escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(confirmation()).toBeInTheDocument();
    buy.release();
    await main().findByRole("heading", { level: 2, name: "Action pack" });
    expect(callsTo(fetchMock, BUY)).toHaveLength(1);
  });

  it("a held Enter buys once", async () => {
    const { user, fetchMock } = await confirmBuy();
    within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }).focus();
    await user.keyboard("{Enter>3/}");
    await main().findByRole("heading", { level: 2, name: "Action pack" });
    expect(callsTo(fetchMock, BUY)).toHaveLength(1);
  });

  it("insufficient_funds: the red line with the server's balance, which the header takes; confirm disabled", async () => {
    const { user } = await confirmBuy({
      [BUY]: {
        status: 409,
        body: { error: { code: "insufficient_funds", message: "insufficient_funds", balance: 120 } },
      },
    });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    expect(await within(confirmation()).findByRole("alert")).toHaveTextContent(
      "This pack costs 400 Karma. You have 120 Karma.",
    );
    expect(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(header().getByText("120")).toBeInTheDocument();
  });

  it("theme_unavailable: the dialog closes, the shop is read again and the notice says so", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY]: envelope(404, "theme_unavailable"),
      [SHOP]: sequence({ status: 200, body: makeShop() }, { status: 200, body: makeShop([]) }),
    });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    const notice = await main().findByText("That pack is no longer in the shop.");
    expect(notice).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await main().findByText("No packs in the shop.")).toBeInTheDocument();
    expect(callsTo(fetchMock, SHOP)).toHaveLength(2);
  });

  it("503 pool_unavailable: the red line, nothing changed; the next try is a new request", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY]: sequence(envelope(503, "pool_unavailable"), { status: 201, body: makeShopReceipt() }),
    });
    const button = () => within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" });
    await user.click(button());
    expect(await within(confirmation()).findByRole("alert")).toHaveTextContent(
      "There are no cards to draw from right now. Nothing changed.",
    );
    expect(button()).not.toHaveAttribute("aria-disabled");
    await user.click(button());
    await main().findByRole("heading", { level: 2, name: "Action pack" });
    const [first, second] = buyIds(fetchMock);
    expect(second).not.toBe(first);
  });

  it("any other answer (500): the red banner, the button enabled again, and a new key for the next try", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY]: sequence(envelope(500, "internal"), envelope(403, "bad_origin")),
    });
    const button = () => within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" });
    await user.click(button());
    expect(await within(confirmation()).findByRole("alert")).toHaveTextContent(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
    await user.click(button());
    await waitFor(() => expect(callsTo(fetchMock, BUY)).toHaveLength(2));
    const [first, second] = buyIds(fetchMock);
    expect(second).not.toBe(first);
  });

  it("429: the countdown from Retry-After, the status line once; then the same key again", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY]: sequence(rateLimited("1"), { status: 201, body: makeShopReceipt() }),
    });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    const waiting = await within(confirmation()).findByRole("button", { name: "Try again in 1 s" });
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    expect(
      within(confirmation()).getByText("That was a lot in a short time. Give it a few seconds."),
    ).toBeInTheDocument();
    expect(within(confirmation()).getByRole("button", { name: "Cancel" })).toBeEnabled();
    await within(confirmation()).findByRole("button", { name: "Buy for 400 Karma" }, { timeout: 3_000 });
    await waitFor(() => expect(liveRegion()).toHaveTextContent("You can try again now."));
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    await main().findByRole("heading", { level: 2, name: "Action pack" });
    const [first, second] = buyIds(fetchMock);
    expect(second).toBe(first);
  });

  it("the 429's wait lives on the page: it survives Cancel and a new confirmation, and the next try is a new key", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY]: sequence(rateLimited("2"), { status: 201, body: makeShopReceipt() }),
    });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    await within(confirmation()).findByRole("button", { name: /^Try again in [12] s$/ });
    await user.click(within(confirmation()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(within(theme()).getByRole("button", { name: "Buy…" }));
    expect(within(confirmation()).getByRole("button", { name: /^Try again in [12] s$/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await within(confirmation()).findByRole("button", { name: "Buy for 400 Karma" }, { timeout: 4_000 });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    await main().findByRole("heading", { level: 2, name: "Action pack" });
    const [first, second] = buyIds(fetchMock);
    expect(second).not.toBe(first);
  });

  it("a close while in flight (a second Escape) opens the confirmation again; Buy… works afterwards", async () => {
    const buy = held(lostAnswer);
    const { user } = await confirmBuy({ [BUY]: sequence(buy.handler, envelope(500, "internal")) });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    const dialog = confirmation() as HTMLDialogElement;
    act(() => dialog.close());
    expect(dialog).toHaveAttribute("open");
    expect(confirmation()).toBeInTheDocument();
    buy.release();
    expect(await within(confirmation()).findByRole("button", { name: "Try again" })).toBeInTheDocument();
    await user.click(within(confirmation()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(within(theme()).getByRole("button", { name: "Buy…" }));
    expect(confirmation()).toHaveAttribute("open");
  });

  it("no answer: the red banner and Try again, which resends the same key and shows the pack that was dealt", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY]: sequence(lostAnswer, { status: 200, body: makeShopReceipt() }),
    });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    expect(await within(confirmation()).findByRole("alert")).toHaveTextContent(NO_ANSWER);
    expect(screen.getAllByText(UNREACHABLE).length).toBeGreaterThan(0);
    expect(header().getByText("1,240")).toBeInTheDocument();

    await user.click(within(confirmation()).getByRole("button", { name: "Try again" }));
    await main().findByRole("heading", { level: 2, name: "Action pack" });
    const [first, second] = buyIds(fetchMock);
    expect(second).toBe(first);
    expect(header().getByText("840")).toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE)).not.toBeInTheDocument();
  });

  it("Cancel after no answer discards the key, reads the wallet and the collection again", async () => {
    const { user, fetchMock } = await confirmBuy({
      [BUY]: sequence(lostAnswer, { status: 201, body: makeShopReceipt() }),
      [WALLET]: sequence({ status: 200, body: makeWallet() }, { status: 200, body: makeWallet(840) }),
    });
    const collectionsBefore = callsTo(fetchMock, COLLECTION).length;
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    await within(confirmation()).findByRole("alert");
    await user.click(within(confirmation()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await header().findByText("840")).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, COLLECTION).length).toBeGreaterThan(collectionsBefore));

    await user.click(within(theme()).getByRole("button", { name: "Buy…" }));
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    await main().findByRole("heading", { level: 2, name: "Action pack" });
    const [first, second] = buyIds(fetchMock);
    expect(second).not.toBe(first);
  });

  it("Cancel and Escape close the confirmation with nothing sent; focus goes back to Buy…", async () => {
    const { user, fetchMock } = await confirmBuy();
    await user.click(within(confirmation()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(theme()).getByRole("button", { name: "Buy…" })).toHaveFocus();

    await user.click(within(theme()).getByRole("button", { name: "Buy…" }));
    const escape = new Event("cancel", { cancelable: true });
    fireEvent(confirmation(), escape);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(callsTo(fetchMock, BUY)).toHaveLength(0);
  });

  it("unauthenticated: the session ends, with /shop as the return path", async () => {
    const { user, history } = await confirmBuy({ [BUY]: envelope(401, "unauthenticated") });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    expect(await pageHeading("Log in")).toBeInTheDocument();
    expect(history.location.state).toMatchObject({ returnTo: "/shop" });
  });

  it("a second purchase replaces the reveal", async () => {
    const second = makeShopReceipt({
      pack: makePackOpened({ openingId: "6f9c1a52-4c1e-4b8e-9d3a-0a6d1e2f3b41" }),
      balance: 440,
    });
    const { user } = await confirmBuy({
      [BUY]: sequence({ status: 201, body: makeShopReceipt() }, { status: 201, body: second }),
    });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    await main().findByRole("heading", { level: 2, name: "Action pack" });
    await user.click(main().getByRole("link", { name: "Back to the shop" }));
    await pageHeading("Shop");
    await user.click(
      within(await main().findByRole("article", { name: "Action" })).getByRole("button", { name: "Buy…" }),
    );
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    expect(await header().findByText("440")).toBeInTheDocument();
    await pageHeading("Shop pack");
    expect(main().getAllByRole("region", { name: "Action pack" })).toHaveLength(1);
    // The new pack's cards, with their entrance: it is the first showing of this pack.
    const items = within(main().getByRole("list", { name: "Action pack" })).getAllByRole("listitem");
    expect(items[0]).toHaveClass("animate-card-enter");
  });
});

describe("/shop/open (market-and-shop.md §3.3 step 6; navigation-and-landing.md §3.13)", () => {
  async function bought(routes: Record<string, MockHandler> = {}) {
    const rendered = await confirmBuy(routes);
    await rendered.user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    await pageHeading("Shop pack");
    await main().findByRole("list", { name: "Action pack" });
    return rendered;
  }

  it("Back returns to /shop with `See your latest shop pack`; Forward and the link show the cards without the entrance", async () => {
    const { user, history } = await bought();
    act(() => history.back());
    const shopHeading = await pageHeading("Shop");
    await waitFor(() => expect(shopHeading).toHaveFocus());
    const latest = main().getByRole("link", { name: "See your latest shop pack" });
    expect(latest).toHaveAttribute("href", "/shop/open");

    act(() => history.forward());
    await pageHeading("Shop pack");
    for (const item of within(main().getByRole("list", { name: "Action pack" })).getAllByRole("listitem")) {
      expect(item).not.toHaveClass("animate-card-enter");
    }

    await user.click(main().getByRole("link", { name: "Back to the shop" }));
    await pageHeading("Shop");
    expect(history.length).toBe(3);
    await user.click(main().getByRole("link", { name: "See your latest shop pack" }));
    await pageHeading("Shop pack");
    for (const item of within(main().getByRole("list", { name: "Action pack" })).getAllByRole("listitem")) {
      expect(item).not.toHaveClass("animate-card-enter");
    }
  });

  it('the header\'s Shop link keeps the current fill and reads aria-current="true"; it pushes /shop', async () => {
    const { user, history } = await bought();
    const shop = header().getByRole("link", { name: "Shop" });
    expect(shop).toHaveAttribute("aria-current", "true");
    expect(shop).toHaveClass("bg-zinc-700");
    await user.click(shop);
    await pageHeading("Shop");
    expect(history.location.pathname).toBe("/shop");
    expect(header().getByRole("link", { name: "Shop" })).toHaveAttribute("aria-current", "page");
  });

  it("a purchase answered after /shop was left: held, no page change; the link shows it without the entrance", async () => {
    const answer = held({ status: 201, body: makeShopReceipt() });
    const { user, history, fetchMock } = await confirmBuy({ [BUY]: answer.handler });
    await user.click(within(confirmation()).getByRole("button", { name: "Buy for 400 Karma" }));
    await waitFor(() => expect(callsTo(fetchMock, BUY)).toHaveLength(1));
    act(() => history.push("/collection"));
    await pageHeading("Collection");
    answer.release();
    await waitFor(() => expect(header().getByText("840")).toBeInTheDocument());
    expect(history.location.pathname).toBe("/collection");
    expect(liveRegion()).not.toHaveTextContent("Bought");

    act(() => history.push("/shop"));
    await pageHeading("Shop");
    const latest = await main().findByRole("link", { name: "See your latest shop pack" });
    await user.click(latest);
    await pageHeading("Shop pack");
    const items = within(main().getByRole("list", { name: "Action pack" })).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    // Its first showing, but it did not land while its page showed (§3.10 item 2).
    for (const item of items) expect(item).not.toHaveClass("animate-card-enter");
    expect(callsTo(fetchMock, BUY)).toHaveLength(1);
  });

  it("an address typed after the first render, with nothing held: replaced by /shop, whose h1 takes focus", async () => {
    const { history } = await openShop();
    act(() => history.push("/shop/open"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Shop" })).toHaveFocus());
    expect(history.location.pathname).toBe("/shop");
    expect(history.length).toBe(2);
  });

  it("a load or a reload with nothing held: replaced by /shop, no focus move, nothing bought", async () => {
    const { history, fetchMock } = renderApp({}, account, "/shop/open");
    expect(await pageHeading("Shop")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/shop");
    expect(history.length).toBe(1);
    await waitFor(() => expect(document.title).toBe("Shop · Anime TCG"));
    expect(document.body).toHaveFocus();
    expect(callsTo(fetchMock, BUY)).toHaveLength(0);
    expect(main().queryByRole("link", { name: "See your latest shop pack" })).not.toBeInTheDocument();
  });
});
