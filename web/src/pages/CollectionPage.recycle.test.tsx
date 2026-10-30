import type { ErrorCode } from "@anime-tcg/shared/errors";
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
import { callsTo, COLLECTION, RECYCLE, renderApp, WALLET } from "../test/app";
import { makeOverviewCollection } from "../test/collectionFixtures";
import {
  makeCharacter,
  makeCollection,
  makeEntry,
  makeRecycleReceipt,
  makeRules,
  makeWallet,
} from "../test/fixtures";

const account = makeAccount({ cards: 8 });
const overview: MockAnswer = { status: 200, body: makeOverviewCollection() };
const lostAnswer: MockAnswer = { status: 502, raw: "<html>proxy</html>" };
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

function held(answer: MockAnswer): { handler: MockHandler; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { handler: () => gate.then(() => answer), release };
}

const header = () => within(screen.getByRole("banner"));
const dialog = () => screen.getByRole("dialog");
const section = () => within(dialog()).getByRole("region", { name: "Recycle for Karma" });
const recycleButton = () => within(section()).getByRole("button", { name: "Recycle…" });
const field = () => within(section()).getByRole("textbox", { name: "Duplicates" });
const confirmButton = (name = "Recycle for 80 Karma") => within(dialog()).getByRole("button", { name });
const recycleIds = (fetchMock: Parameters<typeof callsTo>[0]) =>
  callsTo(fetchMock, RECYCLE).map(([, init]) => requestIdOf(init));

/** Opens the collection and the card dialog of `name`, once the wallet's rules are in. */
async function openCard(name = "Spike", routes: Record<string, MockHandler> = {}) {
  const rendered = renderApp({ [COLLECTION]: overview, ...routes }, account, "/collection");
  const user = userEvent.setup();
  const grid = await screen.findByRole("list", { name: /results?/ });
  await header().findByText("Karma");
  await user.click(within(grid).getByRole("button", { name: new RegExp(name) }));
  return { ...rendered, user };
}

/** Opens Spike's dialog and the confirmation for the field's starting number, 2. */
async function confirmRecycle(routes: Record<string, MockHandler> = {}) {
  const rendered = await openCard("Spike", routes);
  await rendered.user.click(recycleButton());
  return rendered;
}

afterEach(() => vi.unstubAllGlobals());

describe("Recycle for Karma: the section (collection-overview.md §3.6 steps 1 to 3, §4.7)", () => {
  it("idle: the value per duplicate, the field at recyclable, the hint and the exact credit", async () => {
    await openCard();
    expect(
      within(section()).getByRole("heading", { level: 3, name: "Recycle for Karma" }),
    ).toBeInTheDocument();
    expect(within(section()).getByText("Each duplicate recycles for 40 Karma.")).toBeInTheDocument();
    expect(field()).toHaveValue("2");
    expect(field()).toHaveAttribute("inputmode", "numeric");
    expect(field()).toHaveAccessibleDescription("1 to 2 You get 80 Karma.");
    expect(recycleButton()).not.toHaveAttribute("aria-disabled");
  });

  it("the credit follows the number; without a valid number it is not shown", async () => {
    const { user } = await openCard();
    await user.clear(field());
    expect(within(section()).queryByText(/You get/)).not.toBeInTheDocument();
    await user.type(field(), "1");
    expect(within(section()).getByText("You get 40 Karma.")).toBeInTheDocument();
    await user.type(field(), "0");
    expect(within(section()).queryByText(/You get/)).not.toBeInTheDocument();
  });

  it("one copy: no field, and Recycle… disabled with the reason", async () => {
    const { user, fetchMock } = await openCard("Pikachu");
    expect(within(section()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(recycleButton()).toHaveAttribute("aria-disabled", "true");
    expect(
      within(section()).getByText("No duplicates. The last copy can't be recycled."),
    ).toBeInTheDocument();
    await user.click(recycleButton());
    expect(within(dialog()).queryByRole("button", { name: /Recycle for/ })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, RECYCLE)).toHaveLength(0);
  });

  it("duplicates all on the market: no field, and the market reason", async () => {
    const listed = makeCollection([
      makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), {
        count: 3,
        listed: 2,
        available: 1,
        recyclable: 0,
      }),
    ]);
    await openCard("Spike", { [COLLECTION]: { status: 200, body: listed } });
    expect(within(section()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(section()).getByText("Copies on the market can't be recycled.")).toBeInTheDocument();
  });

  it("the hint and the field cap at maxRecycleCount", async () => {
    await openCard("Spike", { [WALLET]: { status: 200, body: makeWallet(1_240, { maxRecycleCount: 1 }) } });
    expect(field()).toHaveValue("1");
    expect(within(section()).getByText("1 to 1")).toBeInTheDocument();
  });

  it("stale: a wallet that did not answer disables Recycle… with the stale reason", async () => {
    renderApp({ [COLLECTION]: overview, [WALLET]: envelope(500, "internal") }, account, "/collection");
    const user = userEvent.setup();
    const grid = await screen.findByRole("list", { name: /results?/ });
    await user.click(within(grid).getByRole("button", { name: /Spike/ }));
    await waitFor(() =>
      expect(
        within(section()).getByText("Listing and recycling wait until the game server answers."),
      ).toBeInTheDocument(),
    );
    expect(recycleButton()).toHaveAttribute("aria-disabled", "true");
  });

  it.each(["", "0", "3", "1.5", "two"])(
    "an invalid number (%j) shows the error on submit, focuses the field and sends nothing",
    async (text) => {
      const { user, fetchMock } = await openCard();
      await user.clear(field());
      if (text !== "") await user.type(field(), text);
      await user.click(recycleButton());
      expect(field()).toHaveAttribute("aria-invalid", "true");
      expect(field()).toHaveFocus();
      expect(within(section()).getByText("Choose a whole number from 1 to 2.")).toBeInTheDocument();
      expect(callsTo(fetchMock, RECYCLE)).toHaveLength(0);
    },
  );
});

describe("Recycle for Karma: the confirmation and its answers (§3.6 steps 4 to 9)", () => {
  it("names the number, the rarity, the exact Karma and the copies kept; its heading has focus", async () => {
    await confirmRecycle();
    const heading = within(dialog()).getByRole("heading", { name: "Recycle 2 duplicates of Spike Spiegel?" });
    expect(heading).toHaveFocus();
    expect(heading.querySelector("bdi")).toHaveTextContent("Spike Spiegel");
    expect(heading).toHaveAccessibleDescription(
      "2 Epic copies become 80 Karma. You keep 1. There is no undo.",
    );
    expect(dialog()).toHaveAccessibleName("Recycle 2 duplicates of Spike Spiegel?");
  });

  it("names the listed copies kept", async () => {
    const listed = makeCollection([
      makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), {
        count: 4,
        listed: 1,
        available: 3,
        recyclable: 3,
      }),
    ]);
    const { user } = await openCard("Spike", { [COLLECTION]: { status: 200, body: listed } });
    await user.clear(field());
    await user.type(field(), "1");
    await user.click(recycleButton());
    expect(
      within(dialog()).getByText(
        "1 Epic copy become 40 Karma. You keep 3, 1 of them on the market. There is no undo.",
      ),
    ).toBeInTheDocument();
  });

  it("201: one request with the entry and the count only; the receipt's line, the header and the refetch", async () => {
    const after = makeCollection([
      makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), { count: 1 }),
    ]);
    const { user, fetchMock } = await confirmRecycle({
      [COLLECTION]: sequence(overview, { status: 200, body: after }),
    });
    await user.click(confirmButton());

    const status = await within(dialog()).findByText(/^Recycled 2 copies of/);
    expect(status).toHaveTextContent(
      "Recycled 2 copies of Spike Spiegel for 80 Karma. You have 1,320 Karma.",
    );
    expect(status).toHaveAttribute("role", "status");
    expect(within(dialog()).getByRole("heading", { level: 2, name: "Spike Spiegel" })).toHaveFocus();
    expect(header().getByText("1,320")).toBeInTheDocument();
    const [[, init]] = callsTo(fetchMock, RECYCLE) as [[unknown, RequestInit]];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["characterId", "count", "rarity", "requestId"]);
    expect(body).toMatchObject({ characterId: 1, rarity: "epic", count: 2 });
    // The refetched entry has one copy left: nothing more to recycle.
    expect(
      await within(section()).findByText("No duplicates. The last copy can't be recycled."),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, COLLECTION).length).toBeGreaterThanOrEqual(2);
  });

  it("a credit other than the total shown: the server's amount, and the value now in force", async () => {
    const rules = makeRules();
    const { user } = await confirmRecycle({
      [RECYCLE]: { status: 201, body: makeRecycleReceipt({ credited: 90, balance: 1_330 }) },
      [WALLET]: sequence(
        { status: 200, body: makeWallet() },
        { status: 200, body: makeWallet(1_330, { recycleValues: { ...rules.recycleValues, epic: 45 } }) },
      ),
    });
    await user.click(confirmButton());
    const status = await within(dialog()).findByText(/^Recycled 2 copies of/);
    await waitFor(() =>
      expect(status).toHaveTextContent(
        "Recycled 2 copies of Spike Spiegel for 90 Karma. You have 1,330 Karma. Each duplicate now recycles for 45 Karma.",
      ),
    );
  });

  it.each<ErrorCode>(["not_enough_copies", "request_id_reused"])(
    "%s: nothing recycled; the details refetched with the neutral notice",
    async (code) => {
      const { user, fetchMock } = await confirmRecycle({ [RECYCLE]: envelope(409, code) });
      const before = callsTo(fetchMock, COLLECTION).length;
      await user.click(confirmButton());
      expect(
        await within(dialog()).findByText(
          "Something changed since you opened this card. Check the numbers and try again.",
        ),
      ).toBeInTheDocument();
      expect(within(dialog()).getByRole("heading", { level: 2, name: "Spike Spiegel" })).toHaveFocus();
      await waitFor(() => expect(callsTo(fetchMock, COLLECTION).length).toBeGreaterThan(before));
      expect(header().getByText("1,240")).toBeInTheDocument();
    },
  );

  it("balance_limit: the confirmation stays with the red line, and the confirm button is disabled", async () => {
    const { user } = await confirmRecycle({ [RECYCLE]: envelope(409, "balance_limit") });
    await user.click(confirmButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "Your balance is at its ceiling, so nothing was recycled.",
    );
    expect(confirmButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("any other answer (500): the red banner, the button enabled again, and a new key", async () => {
    const { user, fetchMock } = await confirmRecycle({
      [RECYCLE]: sequence(envelope(500, "internal"), { status: 201, body: makeRecycleReceipt() }),
    });
    await user.click(confirmButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
    await user.click(confirmButton());
    await within(dialog()).findByText(/^Recycled 2 copies of/);
    const [first, second] = recycleIds(fetchMock);
    expect(second).not.toBe(first);
  });

  it("429: the countdown and the status line; the wait over, the same key again", async () => {
    const { user, fetchMock } = await confirmRecycle({
      [RECYCLE]: sequence(rateLimited("1"), { status: 201, body: makeRecycleReceipt() }),
    });
    await user.click(confirmButton());
    expect(await within(dialog()).findByRole("button", { name: "Try again in 1 s" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      within(dialog()).getByText("That was a lot in a short time. Give it a few seconds."),
    ).toBeInTheDocument();
    await within(dialog()).findByRole("button", { name: "Recycle for 80 Karma" }, { timeout: 3_000 });
    await user.click(confirmButton());
    await within(dialog()).findByText(/^Recycled 2 copies of/);
    const [first, second] = recycleIds(fetchMock);
    expect(second).toBe(first);
  });

  it("Cancel after a 429 discards the key: the next confirmation is a new request", async () => {
    const { user, fetchMock } = await confirmRecycle({
      [RECYCLE]: sequence(rateLimited("1"), { status: 201, body: makeRecycleReceipt() }),
    });
    await user.click(confirmButton());
    await within(dialog()).findByRole("button", { name: "Try again in 1 s" });
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await user.clear(field());
    await user.type(field(), "1");
    await user.click(recycleButton());
    await within(dialog()).findByRole("button", { name: "Recycle for 40 Karma" }, { timeout: 3_000 });
    await user.click(confirmButton("Recycle for 40 Karma"));
    await waitFor(() => expect(callsTo(fetchMock, RECYCLE)).toHaveLength(2));
    const [first, second] = recycleIds(fetchMock);
    expect(second).not.toBe(first);
  });

  it("no answer: the red banner and Try again, which resends the same key; never recycled twice", async () => {
    const { user, fetchMock } = await confirmRecycle({
      [RECYCLE]: sequence(lostAnswer, { status: 200, body: makeRecycleReceipt() }),
    });
    await user.click(confirmButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(NO_ANSWER);
    expect(header().getByText("1,240")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Try again" }));
    await within(dialog()).findByText(/^Recycled 2 copies of/);
    const [first, second] = recycleIds(fetchMock);
    expect(second).toBe(first);
    expect(header().getByText("1,320")).toBeInTheDocument();
  });

  it("Cancel after no answer discards the key and reads the collection and the wallet again", async () => {
    const { user, fetchMock } = await confirmRecycle({
      [RECYCLE]: sequence(lostAnswer, { status: 201, body: makeRecycleReceipt() }),
      [WALLET]: sequence({ status: 200, body: makeWallet() }, { status: 200, body: makeWallet(1_320) }),
    });
    const collections = callsTo(fetchMock, COLLECTION).length;
    await user.click(confirmButton());
    await within(dialog()).findByRole("alert");
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(await header().findByText("1,320")).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, COLLECTION).length).toBeGreaterThan(collections));
    await user.click(recycleButton());
    await user.click(confirmButton());
    await waitFor(() => expect(callsTo(fetchMock, RECYCLE)).toHaveLength(2));
    const [first, second] = recycleIds(fetchMock);
    expect(second).not.toBe(first);
  });

  it("Cancel and Escape return to the details with the number kept, focus on Recycle…", async () => {
    const { user, fetchMock } = await openCard();
    await user.clear(field());
    await user.type(field(), "1");
    await user.click(recycleButton());
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(field()).toHaveValue("1");
    expect(recycleButton()).toHaveFocus();

    await user.click(recycleButton());
    const escape = new Event("cancel", { cancelable: true });
    fireEvent(dialog(), escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(field()).toHaveValue("1");
    expect(callsTo(fetchMock, RECYCLE)).toHaveLength(0);
  });

  it("in flight: Recycling…; Cancel, Close and Escape do nothing; a double click sends one request", async () => {
    const recycle = held({ status: 201, body: makeRecycleReceipt() });
    const { user, fetchMock } = await confirmRecycle({ [RECYCLE]: recycle.handler });
    await user.dblClick(confirmButton());
    expect(within(dialog()).getByRole("button", { name: "Recycling…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Close" })).toBeDisabled();
    const escape = new Event("cancel", { cancelable: true });
    fireEvent(dialog(), escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(header().getByText("1,240")).toBeInTheDocument();
    recycle.release();
    await within(dialog()).findByText(/^Recycled 2 copies of/);
    expect(callsTo(fetchMock, RECYCLE)).toHaveLength(1);
  });

  it("a close while in flight (a second Escape) opens the dialog again on the confirmation", async () => {
    const recycle = held({ status: 201, body: makeRecycleReceipt() });
    const { user } = await confirmRecycle({ [RECYCLE]: recycle.handler });
    await user.click(confirmButton());
    act(() => (dialog() as HTMLDialogElement).close());
    expect(dialog()).toHaveAttribute("open");
    expect(within(dialog()).getByRole("button", { name: "Recycling…" })).toBeInTheDocument();
    recycle.release();
    await within(dialog()).findByText(/^Recycled 2 copies of/);
  });

  it("a close from the confirmation, not in flight, is its Cancel: the dialog goes and nothing is sent", async () => {
    const { fetchMock } = await confirmRecycle();
    act(() => (dialog() as HTMLDialogElement).close());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(callsTo(fetchMock, RECYCLE)).toHaveLength(0);
  });

  it("unauthenticated: the session ends with /collection as the return path", async () => {
    const { user } = await confirmRecycle({ [RECYCLE]: envelope(401, "unauthenticated") });
    await user.click(confirmButton());
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
  });
});
