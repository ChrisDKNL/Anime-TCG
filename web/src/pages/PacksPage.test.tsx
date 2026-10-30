import type { PacksResponse } from "@anime-tcg/shared/api";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { envelope, makeAccount, requestIdOf, type MockAnswer, type MockHandler } from "../test/api";
import { callsTo, liveRegion, OPEN, PACKS, pageHeading, renderApp } from "../test/app";
import {
  makeAllowance,
  makeOpenedCard,
  makePackOpened,
  makePacks,
  makeUnavailablePacks,
} from "../test/fixtures";

const ASYNC_TIMEOUT = 5_000;
const UNREACHABLE = "Couldn't reach the game server. Check your connection and try again.";
const account = makeAccount();

const packs = (allowance: Parameters<typeof makeAllowance>[0], overrides: Partial<PacksResponse> = {}) => ({
  status: 200,
  body: makePacks({ allowance: makeAllowance(allowance), ...overrides }),
});

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

/** The pack button, in the page: the unreachable banner has a `Try again` of its own. */
const main = () => within(screen.getByRole("main"));
async function openButton(name = "Open pack") {
  await pageHeading("Packs");
  return main().findByRole("button", { name }, { timeout: ASYNC_TIMEOUT });
}
/** The `requestId` of every opening sent, in order. */
const requestIds = (fetchMock: Parameters<typeof callsTo>[0]) =>
  callsTo(fetchMock, OPEN).map(([, init]) => requestIdOf(init));

/** Lets answers already released reach the page. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("/packs: arriving", () => {
  it("asks GET /api/packs once and shows the count, the pity line and Pack odds; focus is not moved on load", async () => {
    const { fetchMock } = renderApp({}, account, "/packs");
    expect(await screen.findByText("3 of 3 packs ready")).toBeInTheDocument();
    expect(screen.getByText("Mythic guaranteed within 300 free packs.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pack odds" })).toBeInTheDocument();
    expect(screen.queryByText(/Next pack in/)).not.toBeInTheDocument();
    expect(callsTo(fetchMock, PACKS)).toHaveLength(1);
    expect(document.body).toHaveFocus();
  });

  it("shows the loading state only after 300 ms", async () => {
    const answer = held(packs({ available: 3 }));
    renderApp({ [PACKS]: answer.handler }, account, "/packs");
    await pageHeading("Packs");
    expect(screen.queryByText("Loading your packs…")).not.toBeInTheDocument();
    expect(
      await screen.findByText("Loading your packs…", {}, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open pack" })).toHaveAttribute("aria-disabled", "true");
    answer.release();
    expect(await screen.findByText("3 of 3 packs ready")).toBeInTheDocument();
    expect(screen.queryByText("Loading your packs…")).not.toBeInTheDocument();
  });

  it("a first load with no answer: the failure line, the banner, and Try again asks once more", async () => {
    const { fetchMock } = renderApp(
      { [PACKS]: sequence({ status: 502, raw: "bad gateway" }, packs({ available: 3 })) },
      account,
      "/packs",
    );
    expect(
      await screen.findByText("Couldn't load your packs.", {}, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the game server.");
    await userEvent.setup().click(main().getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("3 of 3 packs ready")).toBeInTheDocument();
    expect(callsTo(fetchMock, PACKS)).toHaveLength(2);
  });

  it("no snapshot: cards unavailable, no pity line, no Pack odds", async () => {
    renderApp(
      { [PACKS]: { status: 200, body: makeUnavailablePacks({ available: 2, nextPackInSeconds: 90 }) } },
      account,
      "/packs",
    );
    expect(
      await screen.findByText("Cards are unavailable right now. Your packs are kept until they're back."),
    ).toBeInTheDocument();
    expect(screen.getByText("2 of 3 packs ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open pack" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText(/Mythic guaranteed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pack odds" })).not.toBeInTheDocument();
  });

  it("an unauthenticated answer ends the session with /packs as the return path", async () => {
    const { history } = renderApp({ [PACKS]: envelope(401, "unauthenticated") }, account, "/packs");
    expect(await pageHeading("Log in")).toBeInTheDocument();
    expect(history.location.state).toMatchObject({ returnTo: "/packs" });
    expect(screen.getByText("You were logged out. Log in again to continue.")).toBeInTheDocument();
  });
});

describe("/packs: opening", () => {
  it("one request in flight: a double click sends one POST; the button reads Opening…, keeps focus, the reveal is busy", async () => {
    const first = held({ status: 201, body: makePackOpened() });
    const { fetchMock } = renderApp(
      {
        [OPEN]: sequence(first.handler, {
          status: 201,
          body: makePackOpened({
            openingId: "6f9c1a52-4c1e-4b8e-9d3a-000000000002",
            allowance: { available: 1 },
          }),
        }),
      },
      account,
      "/packs",
    );
    const user = userEvent.setup();
    const button = await openButton();
    await user.dblClick(button);
    expect(callsTo(fetchMock, OPEN)).toHaveLength(1);
    expect(button).toHaveTextContent("Opening…");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    first.release();
    expect(await screen.findByText("2 of 3 packs ready")).toBeInTheDocument();
    expect(button).toHaveFocus();

    // The next opening: the previous reveal stays, busy, until the answer replaces it.
    await user.click(button);
    expect(screen.getByRole("list", { name: "Your pack" })).toBeInTheDocument();
    expect(await screen.findByText("1 of 3 packs ready")).toBeInTheDocument();
    const ids = requestIds(fetchMock);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("the pity line takes the opening's number, and an Enchanted pack with a pity Mythic shows both lines in order", async () => {
    const cards = [0, 1, 2, 3]
      .map((slot) => makeOpenedCard(slot))
      .concat(makeOpenedCard(4, { rarity: "mythic" }));
    renderApp(
      {
        [OPEN]: {
          status: 201,
          body: makePackOpened({ packKind: "enchanted", pityMythic: true, cards, packsUntilGuarantee: 300 }),
        },
        [PACKS]: packs({ available: 3 }, { packsUntilGuarantee: 1 }),
      },
      account,
      "/packs",
    );
    expect(await screen.findByText("Mythic guaranteed within 1 free pack.")).toBeInTheDocument();
    await userEvent.setup().click(await openButton());
    expect(await screen.findByRole("heading", { level: 2, name: "Enchanted pack" })).toBeInTheDocument();
    const enchanted = screen.getByText(
      "Every 10th free pack is Enchanted: its fifth card is Epic or better.",
    );
    expect(enchanted.nextElementSibling).toHaveTextContent(
      "This Mythic came from the guarantee: a 300th free pack in a row without a Mythic always has one.",
    );
    expect(screen.getByText("Mythic guaranteed within 300 free packs.")).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Enchanted pack: 1 Mythic, 1 Uncommon and 3 Common. 5 new.");
  });

  it("a Radiant pack: its heading and its line, from packKind", async () => {
    const cards = [0, 1, 2, 3].map((slot) => makeOpenedCard(slot, { rarity: "epic" }));
    renderApp(
      {
        [OPEN]: {
          status: 201,
          body: makePackOpened({
            packKind: "radiant",
            cards: [...cards, makeOpenedCard(4, { rarity: "mythic" })],
          }),
        },
      },
      account,
      "/packs",
    );
    await userEvent.setup().click(await openButton());
    expect(await screen.findByRole("heading", { level: 2, name: "Radiant pack" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "About 1 pack in 2,500 is Radiant: five cards of Epic or better, at least one of them Mythic.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Enchanted:/)).not.toBeInTheDocument();
  });

  it("no answer: the banner, the line and Try again, which resends the same requestId and shows the pack the server dealt", async () => {
    const replay = makePackOpened({ allowance: { available: 2 } });
    const { fetchMock } = renderApp(
      { [OPEN]: sequence({ status: 502, raw: "<html>proxy</html>" }, { status: 200, body: replay }) },
      account,
      "/packs",
    );
    const user = userEvent.setup();
    await user.click(await openButton());
    expect(
      await screen.findByText(
        "Couldn't reach the game server. Trying again opens this same pack, never a second one.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the game server.");
    expect(screen.getByText("3 of 3 packs ready")).toBeInTheDocument();

    await user.click(main().getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Your pack" })).toBeInTheDocument();
    expect(screen.getByText("2 of 3 packs ready")).toBeInTheDocument();
    const [first, second] = requestIds(fetchMock);
    expect(second).toBe(first);
    expect(screen.queryByText(/Trying again opens this same pack/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open pack" })).toBeInTheDocument();
  });

  it.each([201, 200])(
    "a %i to the retry clears the unreachable banner the lost answer raised",
    async (status) => {
      renderApp(
        { [OPEN]: sequence({ status: 502, raw: "" }, { status, body: makePackOpened() }) },
        account,
        "/packs",
      );
      const user = userEvent.setup();
      await user.click(await openButton());
      await openButton("Try again");
      expect(screen.getByRole("alert")).toHaveTextContent(UNREACHABLE);

      await user.click(main().getByRole("button", { name: "Try again" }));
      await screen.findByRole("list", { name: "Your pack" });
      expect(screen.queryByText(UNREACHABLE)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("the held key survives a page change", async () => {
    const { fetchMock } = renderApp(
      { [OPEN]: sequence({ status: 502, raw: "" }, { status: 200, body: makePackOpened() }) },
      account,
      "/packs",
    );
    const user = userEvent.setup();
    await user.click(await openButton());
    await openButton("Try again");
    await user.click(screen.getByRole("link", { name: "Collection (0)" }));
    await pageHeading("Collection");
    await user.click(screen.getByRole("link", { name: "Packs" }));
    await user.click(await openButton("Try again"));
    await screen.findByRole("list", { name: "Your pack" });
    const [first, second] = requestIds(fetchMock);
    expect(second).toBe(first);
  });

  it("409: no pack left, a countdown from retryAfterSeconds, one GET that corrects the allowance", async () => {
    const { fetchMock } = renderApp(
      {
        [PACKS]: sequence(
          packs({ available: 1, nextPackInSeconds: 30 }),
          packs({ available: 0, nextPackInSeconds: 419 }),
        ),
        [OPEN]: envelope(409, "no_pack_available", 420),
      },
      account,
      "/packs",
    );
    await userEvent.setup().click(await openButton());
    expect(await screen.findByText("There was no pack left to open.")).toHaveAttribute("role", "status");
    expect(screen.getByText("0 of 3 packs ready")).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, PACKS)).toHaveLength(2));
    expect(await screen.findByText("Next pack in 6:59")).toBeInTheDocument();
    expect(screen.getByText("There was no pack left to open.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open pack" })).toHaveAttribute("aria-disabled", "true");
    // Another tab or device opened the packs, so the collection is asked again too.
    await waitFor(() => expect(callsTo(fetchMock, "GET /api/collection").length).toBeGreaterThanOrEqual(2));
  });

  it("503: cards unavailable until Check again brings odds back; the key is discarded", async () => {
    const { fetchMock } = renderApp(
      {
        [OPEN]: sequence(envelope(503, "pool_unavailable"), { status: 201, body: makePackOpened() }),
      },
      account,
      "/packs",
    );
    const user = userEvent.setup();
    await user.click(await openButton());
    expect(
      await screen.findByText("Cards are unavailable right now. Your packs are kept until they're back."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pack odds" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open pack" })).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("button", { name: "Pack odds" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open pack" }));
    await screen.findByRole("list", { name: "Your pack" });
    const [first, second] = requestIds(fetchMock);
    expect(second).not.toBe(first);
  });

  it("429: the wait from Retry-After, the line once, then Open pack and `You can try again now.`; the key is kept", async () => {
    const { fetchMock } = renderApp(
      {
        [OPEN]: sequence(
          { status: 502, raw: "" },
          { ...envelope(429, "rate_limited"), headers: { "Retry-After": "1" } },
          { status: 200, body: makePackOpened() },
        ),
      },
      account,
      "/packs",
    );
    const user = userEvent.setup();
    await user.click(await openButton());
    await user.click(await openButton("Try again"));
    const waiting = await openButton("Try again in 1 s");
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(
        "Packs take a short pause after many requests in a row. The button comes back by itself.",
      ),
    ).toHaveAttribute("role", "status");

    // A key held: the button comes back as Try again, and the retry is the same opening.
    const back = await main().findByRole("button", { name: "Try again" }, { timeout: 3_000 });
    expect(liveRegion()).toHaveTextContent("You can try again now.");
    await user.click(back);
    await screen.findByRole("list", { name: "Your pack" });
    const ids = requestIds(fetchMock);
    expect(new Set(ids).size).toBe(1);
    expect(ids).toHaveLength(3);
  });

  it("429 without Retry-After waits 60 s; at its end the kept key's Try again comes back, announced", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
    });
    renderApp({ [OPEN]: envelope(429, "rate_limited") }, account, "/packs");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.click(await openButton());
    expect(await openButton("Try again in 60 s")).toHaveAttribute("aria-disabled", "true");
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(main().getByRole("button", { name: "Try again in 1 s" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // The rate limiter answered before the route read the key, so the key is kept (§9, question 2).
    expect(main().getByRole("button", { name: "Try again" })).not.toHaveAttribute("aria-disabled");
    expect(liveRegion()).toHaveTextContent("You can try again now.");
    expect(screen.queryByText(/short pause/)).not.toBeInTheDocument();
  });

  it("a generic failure (500): the alert, the key discarded", async () => {
    const { fetchMock } = renderApp(
      { [OPEN]: sequence(envelope(500, "internal"), { status: 201, body: makePackOpened() }) },
      account,
      "/packs",
    );
    const user = userEvent.setup();
    await user.click(await openButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open the pack. Try again.");
    await user.click(screen.getByRole("button", { name: "Open pack" }));
    await screen.findByRole("list", { name: "Your pack" });
    expect(screen.queryByText("Couldn't open the pack. Try again.")).not.toBeInTheDocument();
    const [first, second] = requestIds(fetchMock);
    expect(second).not.toBe(first);
  });

  it("401 on the opening: /login with the banner; after logging in, /packs with no reveal and no key", async () => {
    const { history } = renderApp(
      {
        [OPEN]: envelope(401, "unauthenticated"),
        "POST /api/session/login": { status: 200, body: { signedIn: true, account } },
      },
      account,
      "/packs",
    );
    const user = userEvent.setup();
    await user.click(await openButton());
    expect(await pageHeading("Log in")).toBeInTheDocument();
    expect(history.location.state).toMatchObject({ returnTo: "/packs" });
    await user.type(screen.getByLabelText("Login"), "chris");
    await user.type(screen.getByLabelText("Password"), "a password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await pageHeading("Packs")).toBeInTheDocument();
    expect(await openButton()).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your pack" })).not.toBeInTheDocument();
  });
});

describe("/packs: the newest answer wins (§3.1 step 5)", () => {
  it("a GET sent before an opening that answers after it does not step the count back", async () => {
    const stale = held(packs({ available: 2, nextPackInSeconds: 300 }));
    renderApp(
      {
        [PACKS]: sequence(packs({ available: 2, nextPackInSeconds: 300 }), stale.handler),
        [OPEN]: {
          status: 201,
          body: makePackOpened({ allowance: { available: 1, nextPackInSeconds: 300 } }),
        },
      },
      account,
      "/packs",
    );
    const user = userEvent.setup();
    expect(await screen.findByText("2 of 3 packs ready")).toBeInTheDocument();
    // Leaving and returning sends a GET; it is held while a pack opens and answers last.
    await user.click(screen.getByRole("link", { name: "Collection (0)" }));
    await pageHeading("Collection");
    await user.click(screen.getByRole("link", { name: "Packs" }));
    await user.click(await openButton());
    expect(await screen.findByText("1 of 3 packs ready")).toBeInTheDocument();
    stale.release();
    await settle();
    expect(screen.getByText("1 of 3 packs ready")).toBeInTheDocument();
  });
});

describe("/packs: the countdown (§3.2)", () => {
  const FAKE = {
    shouldAdvanceTime: true,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"],
  } as const;

  it("counts down, sends exactly one GET at zero, announces the first pack, and polls nothing after", async () => {
    vi.useFakeTimers({ ...FAKE, toFake: [...FAKE.toFake] });
    const { fetchMock } = renderApp(
      {
        [PACKS]: sequence(
          packs({ available: 0, nextPackInSeconds: 3 }),
          packs({ available: 1, nextPackInSeconds: 600 }),
        ),
      },
      account,
      "/packs",
    );
    expect(await screen.findByText("Next pack in 0:03")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Open pack" });
    expect(button).toHaveAccessibleDescription("Next pack in 3 seconds");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("Next pack in 0:02")).toBeInTheDocument();
    expect(callsTo(fetchMock, PACKS)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    await waitFor(() => expect(callsTo(fetchMock, PACKS)).toHaveLength(2));
    expect(await screen.findByText("1 of 3 packs ready")).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("1 of 3 packs ready.");
    expect(screen.getByRole("button", { name: "Open pack" })).not.toHaveAttribute("aria-disabled");

    // Nine more minutes: the countdown runs, nothing is asked.
    act(() => {
      vi.advanceTimersByTime(9 * 60 * 1_000);
    });
    expect(callsTo(fetchMock, PACKS)).toHaveLength(2);
    expect(document.title).toBe("Packs · Anime TCG");
  });

  it("at the cap no timer runs and nothing is asked, however long the page shows", async () => {
    vi.useFakeTimers({ ...FAKE, toFake: [...FAKE.toFake] });
    const { fetchMock } = renderApp({}, account, "/packs");
    expect(await screen.findByText("3 of 3 packs ready")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1_000);
    });
    expect(callsTo(fetchMock, PACKS)).toHaveLength(1);
  });

  it("a zero-time check with no answer: the line, the banner and Check again, which asks once", async () => {
    vi.useFakeTimers({ ...FAKE, toFake: [...FAKE.toFake] });
    const { fetchMock } = renderApp(
      {
        [PACKS]: sequence(
          packs({ available: 0, nextPackInSeconds: 1 }),
          { status: 502, raw: "" },
          packs({ available: 1, nextPackInSeconds: 599 }),
        ),
      },
      account,
      "/packs",
    );
    expect(await screen.findByText("Next pack in 0:01")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(await screen.findByText("Couldn't check for the next pack.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the game server.");
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1_000);
    });
    expect(callsTo(fetchMock, PACKS)).toHaveLength(2);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("1 of 3 packs ready")).toBeInTheDocument();
    expect(callsTo(fetchMock, PACKS)).toHaveLength(3);
    expect(screen.queryByText("Couldn't check for the next pack.")).not.toBeInTheDocument();
  });

  it("a failed check belongs to the answer it failed after: an opening's 201 brings its countdown back", async () => {
    vi.useFakeTimers({ ...FAKE, toFake: [...FAKE.toFake] });
    renderApp(
      {
        [PACKS]: sequence(packs({ available: 1, nextPackInSeconds: 1 }), { status: 502, raw: "" }),
        [OPEN]: {
          status: 201,
          body: makePackOpened({ allowance: { available: 1, nextPackInSeconds: 600 } }),
        },
      },
      account,
      "/packs",
    );
    expect(await screen.findByText("Next pack in 0:01")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(await screen.findByText("Couldn't check for the next pack.")).toBeInTheDocument();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.click(main().getByRole("button", { name: "Open pack" }));
    await screen.findByRole("list", { name: "Your pack" });
    expect(screen.getByText("Next pack in 10:00")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't check for the next pack.")).not.toBeInTheDocument();
    expect(main().queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });

  it("no countdown runs and nothing is asked while another page shows; returning asks once", async () => {
    vi.useFakeTimers({ ...FAKE, toFake: [...FAKE.toFake] });
    const { fetchMock } = renderApp(
      { [PACKS]: packs({ available: 0, nextPackInSeconds: 5 }) },
      account,
      "/packs",
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    expect(await screen.findByText("Next pack in 0:05")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Collection (0)" }));
    await pageHeading("Collection");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(callsTo(fetchMock, PACKS)).toHaveLength(1);
    await user.click(screen.getByRole("link", { name: "Packs" }));
    await pageHeading("Packs");
    await waitFor(() => expect(callsTo(fetchMock, PACKS)).toHaveLength(2));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(within(document.body).getByText("0 of 3 packs ready")).toBeInTheDocument();
  });
});
