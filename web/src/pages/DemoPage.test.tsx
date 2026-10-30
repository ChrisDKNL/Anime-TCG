import type { DemoOpened } from "@anime-tcg/shared/api";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { envelope, type MockAnswer, type MockHandler, urlOf } from "../test/api";
import { callsTo, DEMO, DEMO_OPEN, liveRegion, pageHeading, renderApp, signedOutSession } from "../test/app";
import { makeCharacter, makeDemo, makeDemoCard, makeDemoOpened, makeFranchise } from "../test/fixtures";

/*
 * The demo pack's page, `/demo` (navigation-and-landing.md §3.14, §4.9, §5.4,
 * §7, §8), and how `/` reaches it, through the whole app, signed out.
 */

const DISCLOSURE =
  "A demo pack uses the same odds as every pack in the game. Its cards aren't kept: nothing is saved, and they don't go to any account.";
const JOIN = "Playing needs an account, and registering needs an invite code from the owner.";
const WAIT = "Demo packs take a short pause after many in a row. The button comes back by itself.";
const KEEP = "To keep cards, register with an invite code.";

const ok = (body: unknown): MockAnswer => ({ status: 200, body });

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
function held(answer: MockAnswer): { handler: () => Promise<MockAnswer>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { handler: () => gate.then(() => answer), release };
}

/** A demo pack whose characters are numbered from `base`, so two packs can be told apart. */
function demoPack(
  base: number,
  rarities = ["common", "common", "common", "uncommon", "epic"] as const,
): DemoOpened {
  return makeDemoOpened(
    rarities.map((rarity, slot) =>
      makeDemoCard(slot, { rarity, character: makeCharacter(base + slot, { tier: rarity }) }),
    ),
  );
}

function renderAt(path: "/" | "/demo", routes: Record<string, MockHandler> = {}) {
  return renderApp({ "GET /api/session": signedOutSession, ...routes }, undefined, path);
}

const main = () => within(screen.getByRole("main"));
const demoList = () => screen.findByRole("list", { name: "Demo pack" });
const keepLine = () =>
  screen.queryByText((_, element) => element?.tagName === "P" && element.textContent === KEEP);

/** The demo button of the page whose `h1` is `page`. */
async function demoButton(name = "Open a demo pack", page = "Demo pack") {
  await pageHeading(page);
  return main().findByRole("button", { name });
}

/** Boots on `/` and opens a demo pack there; resolves once `/demo` shows. */
async function openFromLanding(routes: Record<string, MockHandler> = {}) {
  const rendered = renderAt("/", routes);
  const user = userEvent.setup();
  await user.click(await demoButton("Open a demo pack", "Anime TCG"));
  await pageHeading("Demo pack");
  return { ...rendered, user };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("from / to /demo (§3.14 step 1)", () => {
  it("one POST, the URL and the title change, the h1 takes focus; Opening… over five empty slots, then the cards, read once", async () => {
    const answer = held(ok(demoPack(2000)));
    const { history, fetchMock } = await openFromLanding({ [DEMO_OPEN]: answer.handler });
    const heading = screen.getByRole("heading", { level: 1, name: "Demo pack" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(history.location.pathname).toBe("/demo");
    expect(history.location.search).toBe("");
    expect(history.length).toBe(2);
    expect(document.title).toBe("Demo pack · Anime TCG");
    expect(callsTo(fetchMock, DEMO_OPEN)).toHaveLength(1);
    const opening = main().getByRole("button", { name: "Opening…" });
    expect(opening).toHaveAttribute("aria-disabled", "true");
    expect(main().getByRole("link", { name: "Back to the landing page" })).toHaveAttribute("href", "/");
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(document.querySelectorAll("main .aspect-\\[5\\/7\\]")).toHaveLength(5);

    answer.release();
    const list = await demoList();
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.dataset.slot)).toEqual(["0", "1", "2", "3", "4"]);
    for (const item of items) expect(item).toHaveClass("animate-card-enter");
    expect(within(items[4]!).getByRole("article")).toHaveAccessibleName(
      "⁨Character 2004⁩, Epic, ⁨Series 100⁩",
    );
    expect(screen.getByText(/^Demo pack: /)).toHaveTextContent("Demo pack: 1 Epic, 1 Uncommon and 3 Common");
    expect(liveRegion()).toHaveTextContent("Demo pack: 1 Epic, 1 Uncommon and 3 Common.");
    expect(heading).toHaveFocus();
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    // The demo card plays none of the frame's effects (owner, 2026-10-29): the tier frame alone.
    const epic = within(items[4]!).getByRole("article");
    expect(epic).toHaveClass("card-frame-epic");
    expect(epic.className).not.toMatch(/glow|glint|pearl/);
    expect(within(keepLine()!).getByRole("link", { name: "register" })).toHaveAttribute("href", "/register");
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    // There is no count line (§9.2): nothing counts up or down on the way.
    expect(main().queryByText(/\b(of 10|remaining|last one|used up|tries)\b/i)).not.toBeInTheDocument();
  });

  it("a double click on / sends one POST and pushes once; a held Enter the same", async () => {
    const first = renderAt("/");
    const user = userEvent.setup();
    await user.dblClick(await demoButton("Open a demo pack", "Anime TCG"));
    await demoList();
    expect(callsTo(first.fetchMock, DEMO_OPEN)).toHaveLength(1);
    expect(first.history.length).toBe(2);
    first.unmount();
    vi.unstubAllGlobals();

    const second = renderAt("/");
    const button = await demoButton("Open a demo pack", "Anime TCG");
    button.focus();
    await userEvent.setup().keyboard("{Enter>5/}");
    await demoList();
    expect(callsTo(second.fetchMock, DEMO_OPEN)).toHaveLength(1);
    expect(second.history.length).toBe(2);
  });

  it("an answer that lands after going back to /: counted and held, not announced; Forward shows the cards without the entrance", async () => {
    const answer = held(ok(demoPack(2000)));
    const { history } = await openFromLanding({ [DEMO_OPEN]: answer.handler });
    act(() => history.back());
    expect(await demoButton("Opening…", "Anime TCG")).toHaveAttribute("aria-disabled", "true");
    answer.release();
    expect(await demoButton("Open a demo pack", "Anime TCG")).toBeInTheDocument();
    expect(liveRegion()).not.toHaveTextContent("Demo pack:");

    act(() => history.forward());
    const items = within(await demoList()).getAllByRole("listitem");
    for (const item of items) expect(item).not.toHaveClass("animate-card-enter");
  });
});

describe("on /demo (§3.14 steps 2 to 9, §4.9)", () => {
  it("the button opens the next pack in place: no URL change, focus kept, the previous cards busy until the answer", async () => {
    const second = held(ok(demoPack(3000)));
    const { user, history } = await openFromLanding({
      [DEMO_OPEN]: sequence(ok(demoPack(2000)), second.handler),
    });
    await screen.findByRole("article", { name: /Character 2000/ });
    const button = main().getByRole("button", { name: "Open a demo pack" });
    await user.click(button);
    expect(await demoList()).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveFocus();
    expect(screen.getByRole("article", { name: /Character 2000/ })).toBeInTheDocument();
    second.release();
    expect(await screen.findByRole("article", { name: /Character 3000/ })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Character 2000/ })).not.toBeInTheDocument();
    expect(await demoList()).not.toHaveAttribute("aria-busy");
    expect(button).toHaveFocus();
    expect(history.location.pathname).toBe("/demo");
    expect(history.length).toBe(2);
    expect(
      screen.getAllByText((_, element) => element?.tagName === "P" && element.textContent === KEEP),
    ).toHaveLength(1);
  });

  it("after the perVisit-th pack: the Join offer in the button's place, focused, Back to the landing page after it; on / too, unfocused", async () => {
    let n = 0;
    const { user, history, fetchMock } = await openFromLanding({
      [DEMO]: ok(makeDemo({ perVisit: 3 })),
      [DEMO_OPEN]: () => ok(demoPack(4000 + 10 * (n += 1))),
    });
    await screen.findByRole("article", { name: /Character 4010\b/ });
    for (let i = 2; i <= 3; i += 1) {
      await user.click(main().getByRole("button", { name: "Open a demo pack" }));
      await screen.findByRole("article", { name: new RegExp(`Character ${4000 + 10 * i}\\b`) });
    }
    await waitFor(() => expect(document.activeElement?.textContent).toBe(JOIN));
    expect(main().queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(DISCLOSURE)).not.toBeInTheDocument();
    expect(keepLine()).not.toBeInTheDocument();
    expect(main().getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register");
    const back = main().getByRole("link", { name: "Back to the landing page" });
    expect(
      main().getByText(JOIN).compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("article", { name: /Character 4030/ })).toBeInTheDocument();
    expect(callsTo(fetchMock, DEMO_OPEN)).toHaveLength(3);

    // `Back to the landing page` pushes `/`, which shows the Join offer in the button's place; its h1 keeps the focus.
    await user.click(back);
    const landing = await pageHeading("Anime TCG");
    await waitFor(() => expect(landing).toHaveFocus());
    expect(history.length).toBe(3);
    const hero = screen.getByRole("region", { name: "Anime TCG" });
    expect(within(hero).queryByRole("button")).not.toBeInTheDocument();
    expect(within(hero).getByText(JOIN)).toBeInTheDocument();
  });

  it("Back returns to / with its h1 focused; Forward shows the held cards without the entrance", async () => {
    const { history } = await openFromLanding();
    await demoList();
    act(() => history.back());
    const landing = await pageHeading("Anime TCG");
    await waitFor(() => expect(landing).toHaveFocus());
    expect(history.location.pathname).toBe("/");
    act(() => history.forward());
    const heading = await pageHeading("Demo pack");
    await waitFor(() => expect(heading).toHaveFocus());
    const items = within(await demoList()).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    for (const item of items) expect(item).not.toHaveClass("animate-card-enter");
    expect(keepLine()).toBeInTheDocument();
  });

  it("a direct load shows the page ready: the button enabled, five empty slots, the disclosure; the facts are asked for", async () => {
    const { fetchMock, history } = renderAt("/demo");
    const button = await demoButton();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(history.location.pathname).toBe("/demo");
    expect(history.length).toBe(1);
    await waitFor(() => expect(document.title).toBe("Demo pack · Anime TCG"));
    expect(document.body).toHaveFocus();
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
    expect(document.querySelectorAll("main .aspect-\\[5\\/7\\]")).toHaveLength(5);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(keepLine()).not.toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, DEMO)).toHaveLength(1));
    expect(callsTo(fetchMock, DEMO_OPEN)).toHaveLength(0);

    // Its own button opens in place.
    await userEvent.setup().click(button);
    expect(await demoList()).toBeInTheDocument();
    expect(history.length).toBe(1);
  });

  it("the cap holds without the facts: ten packs and then the Join offer", async () => {
    const { fetchMock, user } = await openFromLanding({ [DEMO]: { status: 502, raw: "bad gateway" } });
    await waitFor(() => expect(callsTo(fetchMock, DEMO_OPEN)).toHaveLength(1));
    for (let i = 1; i < 10; i += 1) {
      await user.click(await demoButton());
      await waitFor(() => expect(callsTo(fetchMock, DEMO_OPEN)).toHaveLength(i + 1));
    }
    await waitFor(() => expect(main().queryByRole("button")).not.toBeInTheDocument());
    expect(callsTo(fetchMock, DEMO_OPEN)).toHaveLength(10);
  });

  it("the visit outlives a page change: count, cards and the 429's wait stay for the page load", async () => {
    const { user, history } = await openFromLanding({
      [DEMO]: ok(makeDemo({ perVisit: 3 })),
      [DEMO_OPEN]: sequence(ok(demoPack(2000)), {
        ...envelope(429, "rate_limited"),
        headers: { "Retry-After": "30" },
      }),
    });
    await screen.findByRole("article", { name: /Character 2000/ });
    await user.click(main().getByRole("button", { name: "Open a demo pack" }));
    expect(await demoButton("Try again in 30 s")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(WAIT)).toHaveAttribute("role", "status");

    act(() => history.push("/login"));
    await pageHeading("Log in");
    act(() => history.back());
    const waiting = await main().findByRole("button", { name: /^Try again in \d+ s$/ });
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("article", { name: /Character 2000/ })).toBeInTheDocument();
    expect(keepLine()).toBeInTheDocument();
  });

  it("a 503: the unavailable line in the button's place, on /demo, the cards already shown stay", async () => {
    const { user, history } = await openFromLanding({
      [DEMO_OPEN]: sequence(ok(demoPack(2000)), envelope(503, "pool_unavailable")),
    });
    await screen.findByRole("article", { name: /Character 2000/ });
    await user.click(main().getByRole("button", { name: "Open a demo pack" }));
    expect(await screen.findByText("Demo packs are unavailable right now.")).toBeInTheDocument();
    expect(main().queryByRole("button")).not.toBeInTheDocument();
    expect(main().getByRole("link", { name: "Back to the landing page" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Character 2000/ })).toBeInTheDocument();
    expect(history.location.pathname).toBe("/demo");
  });

  it.each([
    ["no answer", { status: 502, raw: "bad gateway" }],
    ["a 403", envelope(403, "bad_origin")],
    ["a 400", envelope(400, "validation_failed")],
    ["a 500", envelope(500, "internal")],
  ] as const)(
    "%s: the failure alert under the button on /demo, the cards kept, and Try again opens",
    async (_label, failure) => {
      const { user, history } = await openFromLanding({
        [DEMO_OPEN]: sequence(ok(demoPack(2000)), failure, ok(demoPack(3000))),
      });
      await screen.findByRole("article", { name: /Character 2000/ });
      await user.click(main().getByRole("button", { name: "Open a demo pack" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Couldn't reach the game server. Try again.",
      );
      expect(history.location.pathname).toBe("/demo");
      expect(screen.getByRole("article", { name: /Character 2000/ })).toBeInTheDocument();
      const again = await demoButton();
      expect(again).not.toHaveAttribute("aria-disabled");
      await user.click(again);
      expect(await screen.findByRole("article", { name: /Character 3000/ })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("a first answer without cards shows on /demo, over the empty slots; nothing navigates back to /", async () => {
    const { history } = await openFromLanding({ [DEMO_OPEN]: envelope(500, "internal") });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the game server. Try again.");
    expect(history.location.pathname).toBe("/demo");
    expect(document.querySelectorAll("main .aspect-\\[5\\/7\\]")).toHaveLength(5);
  });

  it("a 429 with Retry-After: the button counts down, aria-disabled, the wait line once; then `You can try again now.`", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
    });
    const { fetchMock } = renderAt("/demo", {
      [DEMO_OPEN]: { ...envelope(429, "rate_limited"), headers: { "Retry-After": "2" } },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.click(await demoButton());
    const waiting = await demoButton("Try again in 2 s");
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(WAIT)).toHaveAttribute("role", "status");
    await user.click(waiting);
    expect(callsTo(fetchMock, DEMO_OPEN)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(main().getByRole("button", { name: "Try again in 1 s" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(main().getByRole("button", { name: "Open a demo pack" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(WAIT)).not.toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("You can try again now.");
  });

  it("a 429 without Retry-After: `Open a demo pack` stays aria-disabled for 60 s with the wait line", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
    });
    renderAt("/demo", { [DEMO_OPEN]: envelope(429, "rate_limited") });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.click(await demoButton());
    await screen.findByText(WAIT);
    expect(main().getByRole("button", { name: "Open a demo pack" })).toHaveAttribute("aria-disabled", "true");
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(main().getByRole("button", { name: "Open a demo pack" })).toHaveAttribute("aria-disabled", "true");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(main().getByRole("button", { name: "Open a demo pack" })).not.toHaveAttribute("aria-disabled");
    expect(liveRegion()).toHaveTextContent("You can try again now.");
  });

  it("keeps the cards in memory only: no storage, no query string, and nothing sent but the two demo calls", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { fetchMock, history } = await openFromLanding();
    await demoList();
    expect(setItem).not.toHaveBeenCalled();
    expect(history.location.search).toBe("");
    expect(history.location.hash).toBe("");
    const keys = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${urlOf(url)}`);
    expect(new Set(keys)).toEqual(new Set(["GET /api/session", DEMO, DEMO_OPEN]));
    expect(callsTo(fetchMock, DEMO_OPEN)[0]?.[1]?.body).toBeUndefined();
    setItem.mockRestore();
  });

  it("renders hostile names and series titles of a demo card as text (T1)", async () => {
    const hostile = makeDemoOpened([
      makeDemoCard(0, {
        character: makeCharacter(7, { name: "<script>alert(1)</script>", franchiseIds: [900] }),
      }),
      ...[1, 2, 3, 4].map((slot) => makeDemoCard(slot)),
    ]);
    await openFromLanding({
      [DEMO_OPEN]: ok({
        ...hostile,
        franchises: [...hostile.franchises, makeFranchise(900, { title: "<img src=x onerror=alert(1)>" })],
      }),
    });
    expect(await screen.findByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelectorAll("main script, main img[onerror]")).toHaveLength(0);
  });

  it("the header marks no link on /demo", async () => {
    renderAt("/demo");
    await pageHeading("Demo pack");
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    expect(nav.queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  });
});
