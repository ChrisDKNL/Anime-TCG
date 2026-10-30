import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { envelope, makeAccount, type MockAnswer, type MockHandler } from "../test/api";
import { callsTo, gameServer, liveRegion, OPEN, PACKS, pageHeading, renderApp } from "../test/app";
import { makeAllowance, makePackOpened, makePacks } from "../test/fixtures";

/*
 * `/packs/open` through the whole app (packs-page.md §3.7, §4.4, §5.5, §10
 * item 17; navigation-and-landing.md §3.13): the push from `/packs`, the
 * page itself, Back and Forward, the replaces to `/packs`, the guard and the
 * header link.
 */

const account = makeAccount();
const ASYNC_TIMEOUT = 5_000;

/** A request held in flight until the test lets it answer. */
function held(answer: MockAnswer | (() => MockAnswer)): {
  handler: () => Promise<MockAnswer>;
  release: () => void;
} {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    handler: () => gate.then(() => (typeof answer === "function" ? answer() : answer)),
    release,
  };
}

const main = () => within(screen.getByRole("main"));
const nav = () => within(screen.getByRole("navigation", { name: "Main" }));
const cards = () => within(screen.getByRole("list", { name: "Your pack" })).getAllByRole("listitem");

/** Boots on `/packs` and opens a pack there; resolves once `/packs/open` shows its cards. */
async function openFromPacks(routes: Record<string, MockHandler> = gameServer().routes) {
  const rendered = renderApp(routes, account, "/packs");
  const user = userEvent.setup();
  await pageHeading("Packs");
  await user.click(await main().findByRole("button", { name: "Open pack" }, { timeout: ASYNC_TIMEOUT }));
  await pageHeading("Pack opening");
  await screen.findByRole("list", { name: "Your pack" }, { timeout: ASYNC_TIMEOUT });
  return { ...rendered, user };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("arriving from /packs", () => {
  it("pushes /packs/open with its title and focus on its h1; in flight, Opening… over five empty slots", async () => {
    const answer = held({ status: 201, body: makePackOpened() });
    const { history, fetchMock } = renderApp({ [OPEN]: answer.handler }, account, "/packs");
    const user = userEvent.setup();
    await pageHeading("Packs");
    await user.click(await main().findByRole("button", { name: "Open pack" }, { timeout: ASYNC_TIMEOUT }));

    const heading = await pageHeading("Pack opening");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(document.title).toBe("Pack opening · Anime TCG");
    expect(history.location.pathname).toBe("/packs/open");
    expect(history.length).toBe(2);
    expect(main().getByRole("button", { name: "Opening…" })).toHaveAttribute("aria-disabled", "true");
    expect(main().getByText("3 of 3 packs ready")).toBeInTheDocument();
    expect(main().getByRole("link", { name: "Back to packs" })).toHaveAttribute("href", "/packs");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(document.querySelectorAll("main .aspect-\\[5\\/7\\]")).toHaveLength(5);
    // The opening's answer will carry the allowance: no GET goes out beside it (manager decision, 2026-10-30).
    expect(callsTo(fetchMock, PACKS)).toHaveLength(1);

    answer.release();
    const items = await screen.findAllByRole("listitem", {}, { timeout: ASYNC_TIMEOUT });
    expect(items).toHaveLength(5);
    for (const item of items) expect(item).toHaveClass("animate-card-enter");
    expect(main().getByText("2 of 3 packs ready")).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Your pack: 1 Rare, 1 Uncommon and 3 Common. 5 new.");
    expect(heading).toHaveFocus();
  });

  it("shows no countdown, pity line or Pack odds: they stay on /packs", async () => {
    await openFromPacks();
    expect(screen.queryByText(/Next pack in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mythic guaranteed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pack odds" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("the last pack: Open pack stays, aria-disabled and described by the count line, beside Back to packs", async () => {
    const { user, fetchMock } = await openFromPacks(gameServer({ available: 1 }).routes);
    const button = main().getByRole("button", { name: "Open pack" });
    expect(main().getByText("0 of 3 packs ready")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("0 of 3 packs ready");
    button.focus();
    await user.click(button);
    expect(button).toHaveFocus();
    expect(callsTo(fetchMock, OPEN)).toHaveLength(1);
  });
});

describe("leaving and coming back", () => {
  it("Back returns to /packs with its h1 focused and `See your latest pack`; Forward shows the cards without the entrance and asks once", async () => {
    const { history, fetchMock } = await openFromPacks();
    act(() => history.back());
    const packs = await pageHeading("Packs");
    await waitFor(() => expect(packs).toHaveFocus());
    const latest = main().getByRole("link", { name: "See your latest pack" });
    expect(latest).toHaveAttribute("href", "/packs/open");

    const before = callsTo(fetchMock, PACKS).length;
    act(() => history.forward());
    const heading = await pageHeading("Pack opening");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(cards()).toHaveLength(5);
    for (const item of cards()) expect(item).not.toHaveClass("animate-card-enter");
    await waitFor(() => expect(callsTo(fetchMock, PACKS)).toHaveLength(before + 1));
  });

  it("`See your latest pack` and `Back to packs` push, and the held cards show without the entrance", async () => {
    const { user, history } = await openFromPacks();
    await user.click(main().getByRole("link", { name: "Back to packs" }));
    await pageHeading("Packs");
    await user.click(main().getByRole("link", { name: "See your latest pack" }));
    await pageHeading("Pack opening");
    expect(history.length).toBe(4);
    for (const item of cards()) expect(item).not.toHaveClass("animate-card-enter");
  });

  it("an answer that lands while another page shows: nothing is announced there, and Back shows the cards without the entrance", async () => {
    const { routes } = gameServer();
    const open = routes[OPEN] as () => MockAnswer;
    const answer = held(() => open());
    const { history } = renderApp({ ...routes, [OPEN]: answer.handler }, account, "/packs");
    const user = userEvent.setup();
    await pageHeading("Packs");
    await user.click(await main().findByRole("button", { name: "Open pack" }, { timeout: ASYNC_TIMEOUT }));
    await pageHeading("Pack opening");
    await user.click(nav().getByRole("link", { name: "Collection (0)" }));
    await pageHeading("Collection");
    answer.release();
    expect(
      await nav().findByRole("link", { name: "Collection (5)" }, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    expect(liveRegion()).not.toHaveTextContent("Your pack");

    act(() => history.back());
    await pageHeading("Pack opening");
    expect(cards()).toHaveLength(5);
    for (const item of cards()) expect(item).not.toHaveClass("animate-card-enter");
  });

  it("Forward onto an entry whose opening ended without cards replaces it with /packs", async () => {
    const second = held(envelope(409, "no_pack_available", 600));
    let opened = 0;
    const { history, user } = await openFromPacks({
      [OPEN]: () => {
        opened += 1;
        return opened === 1 ? { status: 201, body: makePackOpened() } : second.handler();
      },
      // Another device took the last two packs while the second opening was on its way.
      [PACKS]: () => ({
        status: 200,
        body: makePacks({
          allowance: makeAllowance({ available: [3, 2][opened] ?? 0, nextPackInSeconds: 600 }),
        }),
      }),
    });
    await user.click(main().getByRole("button", { name: "Open pack" }));
    act(() => history.back());
    await pageHeading("Packs");
    second.release();
    expect(await main().findByText("There was no pack left to open.")).toBeInTheDocument();
    // On another page the answer moves nothing and reads nothing (§3.3 step 5).
    expect(liveRegion()).not.toHaveTextContent("There was no pack left to open.");
    expect(main().queryByRole("link", { name: "See your latest pack" })).not.toBeInTheDocument();

    act(() => history.forward());
    // The /packs heading read before the replace may be the page being left; read it once it has landed.
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Packs" })).toHaveFocus());
    expect(history.location.pathname).toBe("/packs");
    expect(document.title).toBe("Packs · Anime TCG");
  });
});

describe("nothing held", () => {
  it("a load or a reload of /packs/open: replaced by /packs, no focus move, no opening", async () => {
    const { history, fetchMock } = renderApp({}, account, "/packs/open");
    expect(await pageHeading("Packs")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/packs");
    expect(history.length).toBe(1);
    await waitFor(() => expect(document.title).toBe("Packs · Anime TCG"));
    expect(document.body).toHaveFocus();
    expect(callsTo(fetchMock, OPEN)).toHaveLength(0);
    expect(main().queryByRole("link", { name: "See your latest pack" })).not.toBeInTheDocument();
  });

  it("/packs/open/ is the same page: its trailing slash goes, then the replace", async () => {
    const { history } = renderApp({}, account, "/packs/open/");
    expect(await pageHeading("Packs")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/packs");
  });

  it("a typed address after the first render, with nothing held: replaced by /packs, whose h1 takes focus", async () => {
    const { history } = renderApp({}, account, "/collection");
    await pageHeading("Collection");
    act(() => history.push("/packs/open"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Packs" })).toHaveFocus());
    expect(history.location.pathname).toBe("/packs");
    expect(history.length).toBe(2);
  });
});

describe("the header and the session (§3.13 steps 6 and 8)", () => {
  it('the Packs link keeps the current fill and reads aria-current="true" on /packs/open; it pushes /packs', async () => {
    const { user, history } = await openFromPacks();
    const packs = nav().getByRole("link", { name: "Packs" });
    expect(packs).toHaveAttribute("aria-current", "true");
    expect(packs).toHaveClass("bg-zinc-700");
    expect(nav().getByRole("link", { name: "Shop" })).not.toHaveAttribute("aria-current");
    await user.click(packs);
    await pageHeading("Packs");
    expect(history.location.pathname).toBe("/packs");
    expect(history.length).toBe(3);
    expect(nav().getByRole("link", { name: "Packs" })).toHaveAttribute("aria-current", "page");
  });

  it("a session that ends on /packs/open goes to /login with /packs as the return path", async () => {
    let opened = 0;
    const { history, user } = await openFromPacks({
      [OPEN]: () => {
        opened += 1;
        return opened === 1 ? { status: 201, body: makePackOpened() } : envelope(401, "unauthenticated");
      },
      [PACKS]: { status: 200, body: makePacks({ allowance: makeAllowance({ available: 3 }) }) },
    });
    await user.click(main().getByRole("button", { name: "Open pack" }));
    expect(await pageHeading("Log in")).toBeInTheDocument();
    expect(history.location.state).toMatchObject({ returnTo: "/packs" });
    expect(screen.getByText("You were logged out. Log in again to continue.")).toBeInTheDocument();
  });
});
