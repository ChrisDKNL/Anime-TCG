import type { DemoOpened } from "@anime-tcg/shared/api";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { envelope, type MockAnswer, type MockHandler, urlOf } from "../test/api";
import { callsTo, DEMO, DEMO_OPEN, liveRegion, pageHeading, renderApp, signedOutSession } from "../test/app";
import {
  makeCharacter,
  makeDemo,
  makeDemoCard,
  makeDemoOpened,
  makeFranchise,
  makeUnavailableDemo,
} from "../test/fixtures";

/*
 * The landing page's demo (navigation-and-landing.md §3.7, §4.5, §7, §8)
 * through the whole app, signed out, with the api mocked at `fetch`.
 */

const UNREACHABLE = "Couldn't reach the game server. Check your connection and try again.";
const LEDE = "2,983 characters from the 100 most popular anime on AniList, five to a pack.";
const LEDE_WITHOUT_FACTS = "Characters from the most popular anime on AniList, five to a pack.";
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
function held(answer: MockAnswer): { handler: MockHandler; release: () => void } {
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

function renderLanding(routes: Record<string, MockHandler> = {}) {
  return renderApp({ "GET /api/session": signedOutSession, ...routes }, undefined, "/");
}

const main = () => within(screen.getByRole("main"));
/** The demo button, once the page (not the boot frame, which has a `main` of its own) has rendered. */
async function demoButton(name = "Open a demo pack") {
  await pageHeading("Anime TCG");
  return main().findByRole("button", { name });
}
const demoList = () => screen.findByRole("list", { name: "Demo pack" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("landing page with the server's facts", () => {
  it("writes the lede and the rows from the facts, the odds table lowest tier first, the disclosure and five empty slots", async () => {
    const { container } = renderLanding();
    await pageHeading("Anime TCG");
    expect(await screen.findByText(LEDE)).toBeInTheDocument();
    expect(
      screen.getByText("A new pack every 10 minutes, and up to 3 can pile up. Five cards each."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Every pack uses the odds below\.$/)).toBeInTheDocument();
    expect(
      screen.getByText("See how much of each series you have, and how much of all 2,983 characters."),
    ).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Pack odds" });
    expect(screen.getByRole("heading", { level: 3, name: "Pack odds" })).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Tier", "At least one per pack", "Each card"]);
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => [
        within(row).getByRole("rowheader").textContent,
        ...within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ]);
    expect(rows).toEqual([
      ["Common", "99.9%", "56%"],
      ["Uncommon", "100%", "24%"],
      ["Rare", "80%", "16%"],
      ["Epic", "17%", "3.4%"],
      ["Legendary", "2.75%", "0.55%"],
      ["Mythic", "0.25%", "0.05%"],
    ]);
    expect(within(table).getByRole("rowheader", { name: "Mythic" })).toHaveClass("text-rarity-mythic-text");
    expect(screen.getByText("Drawn from 2,983 characters, as of 29 Oct 2026.")).toBeInTheDocument();

    expect(await demoButton()).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
    expect(screen.queryByText(KEEP)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Demo pack" })).not.toBeInTheDocument();
    const slots = container.querySelector('main [aria-hidden="true"]');
    expect(slots?.children).toHaveLength(5);
  });

  it("before the facts arrive: every line in its no-facts form, no odds block, and the button already works", async () => {
    const facts = held(ok(makeDemo()));
    const { fetchMock } = renderLanding({ [DEMO]: facts.handler });
    await pageHeading("Anime TCG");
    expect(screen.getByText(LEDE_WITHOUT_FACTS)).toBeInTheDocument();
    expect(
      screen.getByText("A new pack on a timer, and a few can pile up. Five cards each."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await userEvent.setup().click(await demoButton());
    expect(await demoList()).toBeInTheDocument();
    expect(callsTo(fetchMock, DEMO_OPEN)).toHaveLength(1);
    facts.release();
    expect(await screen.findByText(LEDE)).toBeInTheDocument();
  });

  it("no pool: the unavailable line in the button's place, no odds block, the rows without the pool's numbers", async () => {
    renderLanding({ [DEMO]: ok(makeUnavailableDemo()) });
    expect(await screen.findByText("Demo packs are unavailable right now.")).toBeInTheDocument();
    expect(main().queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(LEDE_WITHOUT_FACTS)).toBeInTheDocument();
    expect(
      screen.getByText("See how much of each series you have, and of the whole pool."),
    ).toBeInTheDocument();
  });

  it("facts with no answer: the unreachable banner over the no-facts page; a demo pack that answers clears it and brings the facts", async () => {
    const { fetchMock } = renderLanding({
      [DEMO]: sequence({ status: 502, raw: "bad gateway" }, ok(makeDemo())),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(UNREACHABLE);
    expect(screen.getByText(LEDE_WITHOUT_FACTS)).toBeInTheDocument();
    await userEvent.setup().click(await demoButton());
    expect(await demoList()).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText(LEDE)).toBeInTheDocument();
    expect(callsTo(fetchMock, DEMO)).toHaveLength(2);
  });

  it("facts answered with an error envelope: the no-facts page, no banner", async () => {
    renderLanding({ [DEMO]: envelope(429, "rate_limited") });
    await pageHeading("Anime TCG");
    expect(await demoButton()).toBeInTheDocument();
    expect(screen.getByText(LEDE_WITHOUT_FACTS)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("opening demo packs", () => {
  it("opening: `Opening…`, aria-disabled and focused; then five cards in slot order with the summary, read once, and the keep-cards line", async () => {
    const answer = held(ok(demoPack(2000)));
    renderLanding({ [DEMO_OPEN]: answer.handler });
    const user = userEvent.setup();
    await user.click(await demoButton());
    const opening = await demoButton("Opening…");
    expect(opening).toHaveAttribute("aria-disabled", "true");
    expect(opening).toHaveFocus();
    await user.click(opening);
    answer.release();

    const list = await demoList();
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.dataset.slot)).toEqual(["0", "1", "2", "3", "4"]);
    expect(within(items[4]!).getByRole("article")).toHaveAccessibleName(
      "\u2068Character 2004\u2069, Epic, \u2068Series 100\u2069",
    );
    expect(screen.getByText(/^Demo pack: /)).toHaveTextContent("Demo pack: 1 Epic, 1 Uncommon and 3 Common");
    expect(liveRegion()).toHaveTextContent("Demo pack: 1 Epic, 1 Uncommon and 3 Common.");
    expect(await demoButton()).toHaveFocus();
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    // The landing card plays none of the frame's effects (owner, 2026-10-29): the tier frame alone.
    const epic = within(items[4]!).getByRole("article");
    expect(epic).toHaveClass("card-frame-epic");
    expect(epic.className).not.toMatch(/glow|glint|pearl/);

    const keep = screen.getByText((_, element) => element?.tagName === "P" && element.textContent === KEEP);
    expect(within(keep).getByRole("link", { name: "register" })).toHaveAttribute("href", "/register");
    expect(screen.queryByRole("heading", { level: 2, name: /demo/i })).not.toBeInTheDocument();
  });

  it("opening again keeps the previous cards, busy, until the next answer replaces them; the keep-cards line stays one line", async () => {
    const second = held(ok(demoPack(3000)));
    renderLanding({ [DEMO_OPEN]: sequence(ok(demoPack(2000)), second.handler) });
    const user = userEvent.setup();
    await user.click(await demoButton());
    await screen.findByRole("article", { name: /Character 2000/ });
    await user.click(await demoButton());
    expect(await demoList()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("article", { name: /Character 2000/ })).toBeInTheDocument();
    second.release();
    expect(await screen.findByRole("article", { name: /Character 3000/ })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Character 2000/ })).not.toBeInTheDocument();
    expect(await demoList()).not.toHaveAttribute("aria-busy");
    expect(
      screen.getAllByText((_, element) => element?.tagName === "P" && element.textContent === KEEP),
    ).toHaveLength(1);
  });

  it("after the perVisit-th pack: the Join offer in the button's place, focused, the last cards kept, no keep-cards line and no count anywhere", async () => {
    let n = 0;
    const { fetchMock } = renderLanding({
      [DEMO]: ok(makeDemo({ perVisit: 3 })),
      [DEMO_OPEN]: () => ok(demoPack(4000 + 10 * (n += 1))),
    });
    await screen.findByText(LEDE);
    const user = userEvent.setup();
    for (let i = 0; i < 2; i += 1) {
      await user.click(await demoButton());
      await screen.findByRole("article", { name: new RegExp(`Character ${4000 + 10 * (i + 1)}\\b`) });
    }
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
    await user.click(await demoButton());

    const join = await waitFor(() => {
      const focused = document.activeElement;
      expect(focused?.textContent).toBe(JOIN);
      return focused;
    });
    expect(main().getAllByText(JOIN)).toHaveLength(2);
    expect(
      within(join?.parentElement ?? document.body).getByRole("link", { name: "Register" }),
    ).toHaveAttribute("href", "/register");
    expect(main().queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(DISCLOSURE)).not.toBeInTheDocument();
    expect(screen.queryByText(KEEP)).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Character 4030/ })).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent(/^Demo pack: /);
    expect(callsTo(fetchMock, DEMO_OPEN)).toHaveLength(3);
    expect(main().queryByText(/\b(remaining|last one|used up|tries)\b/i)).not.toBeInTheDocument();
  });

  it("a 503: the unavailable line in the button's place, the cards already shown stay", async () => {
    renderLanding({ [DEMO_OPEN]: sequence(ok(demoPack(2000)), envelope(503, "pool_unavailable")) });
    const user = userEvent.setup();
    await user.click(await demoButton());
    await screen.findByRole("article", { name: /Character 2000/ });
    await user.click(await demoButton());
    expect(await screen.findByText("Demo packs are unavailable right now.")).toBeInTheDocument();
    expect(main().queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Character 2000/ })).toBeInTheDocument();
  });

  it.each([
    ["no answer", { status: 502, raw: "bad gateway" }],
    ["a 403", envelope(403, "bad_origin")],
    ["a 400", envelope(400, "validation_failed")],
    ["a 500", envelope(500, "internal")],
  ] as const)(
    "%s: the failure alert under the button, the cards kept, and Try again opens",
    async (_label, failure) => {
      renderLanding({ [DEMO_OPEN]: sequence(ok(demoPack(2000)), failure, ok(demoPack(3000))) });
      const user = userEvent.setup();
      await user.click(await demoButton());
      await screen.findByRole("article", { name: /Character 2000/ });
      await user.click(await demoButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Couldn't reach the game server. Try again.",
      );
      expect(screen.getByRole("article", { name: /Character 2000/ })).toBeInTheDocument();
      const again = await demoButton();
      expect(again).not.toHaveAttribute("aria-disabled");
      await user.click(again);
      expect(await screen.findByRole("article", { name: /Character 3000/ })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("a 429 with Retry-After: the button counts down, aria-disabled, the wait line once; then `You can try again now.`", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
    });
    const { fetchMock } = renderLanding({
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
    renderLanding({ [DEMO_OPEN]: envelope(429, "rate_limited") });
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

  it("keeps the cards in the page only: no storage, no query string, and nothing sent but the two demo calls", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { fetchMock, history } = renderLanding();
    const user = userEvent.setup();
    await user.click(await demoButton());
    await demoList();
    expect(setItem).not.toHaveBeenCalled();
    expect(history.location.pathname).toBe("/");
    expect(history.location.search).toBe("");
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
    renderLanding({
      [DEMO_OPEN]: ok({
        ...hostile,
        franchises: [...hostile.franchises, makeFranchise(900, { title: "<img src=x onerror=alert(1)>" })],
      }),
    });
    await userEvent.setup().click(await demoButton());
    expect(await screen.findByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelectorAll("main script, main img[onerror]")).toHaveLength(0);
  });
});
