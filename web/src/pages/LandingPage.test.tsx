import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { envelope, type MockAnswer, type MockHandler } from "../test/api";
import { callsTo, DEMO, DEMO_OPEN, pageHeading, renderApp, signedOutSession } from "../test/app";
import { makeDemo, makeUnavailableDemo } from "../test/fixtures";

/*
 * The landing page (navigation-and-landing.md §3.7, §4.5, §5.3, §6.2, §7,
 * §8, §11 "Unit") through the whole app, signed out, with the api mocked at
 * `fetch`. The demo pack's own page is DemoPage.test.tsx.
 */

const UNREACHABLE = "Couldn't reach the game server. Check your connection and try again.";
const LEDE = "2,983 characters from the 100 most popular anime on AniList, five to a pack.";
const LEDE_WITHOUT_FACTS = "Characters from the most popular anime on AniList, five to a pack.";
const DISCLOSURE =
  "A demo pack uses the same odds as every pack in the game. Its cards aren't kept: nothing is saved, and they don't go to any account.";
const KARMA =
  "Recycle duplicates for Karma and spend it on themed packs. Karma comes only from playing. It can't be bought.";

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

function renderLanding(routes: Record<string, MockHandler> = {}) {
  return renderApp({ "GET /api/session": signedOutSession, ...routes }, undefined, "/");
}

const main = () => within(screen.getByRole("main"));
const hero = () => screen.getByRole("region", { name: "Anime TCG" });
/** Lets answers already sent reach the page. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
/** The demo button, once the page (not the boot frame, which has a `main` of its own) has rendered. */
async function demoButton(name = "Open a demo pack") {
  await pageHeading("Anime TCG");
  return main().findByRole("button", { name });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the hero (§3.7 item 1)", () => {
  it("the display h1 at the hero size under its eyebrow, the lede from the facts, one button and its disclosure; no reveal on the page", async () => {
    renderLanding();
    const heading = await pageHeading("Anime TCG");
    expect(heading).toHaveClass("display-tight", "text-hero", "sm:text-[4.5rem]", "lg:text-[6rem]");
    expect(within(hero()).getByText("Anime character cards")).toHaveAttribute("aria-hidden", "true");
    expect(await screen.findByText(LEDE)).toBeInTheDocument();
    expect(await demoButton()).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
    expect(within(hero()).getAllByRole("button")).toHaveLength(1);
    expect(within(hero()).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Demo pack" })).not.toBeInTheDocument();
    // No empty slots: the cards are on /demo; the only card-sized 5:7 box is the pack drawing.
    const boxes = [...document.querySelectorAll("main [class]")].filter(
      (node) => node.classList.contains("aspect-[5/7]") && node.classList.contains("rounded-[12px]"),
    );
    expect(boxes).toEqual([screen.getByTestId("landing-pack")]);
  });

  it("the pack drawing: aria-hidden, nothing focusable, no motion, hidden below 640 px; the wordmark, Demo pack, six star rungs, Five cards", async () => {
    renderLanding();
    await pageHeading("Anime TCG");
    const pack = screen.getByTestId("landing-pack");
    expect(pack).toHaveAttribute("aria-hidden", "true");
    expect(pack).toHaveClass("hidden", "sm:flex", "aspect-[5/7]", "w-[11.25rem]");
    expect(pack.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
    for (const element of [pack, ...pack.querySelectorAll("*")]) {
      expect(element.className).not.toMatch(
        /animate|transition|hover:|shadow|glow|gradient|rotate|scale|translate/,
      );
    }
    const rungs = [...pack.querySelectorAll("span")].map((rung) => rung.textContent);
    expect(rungs).toEqual(["✦", "✦✦", "✦✦✦", "✦✦✦✦", "✦✦✦✦✦", "✦✦✦✦✦✦"]);
    expect(pack.querySelector("span")).toHaveClass("text-rarity-common-text");
    expect([...pack.querySelectorAll("span")].at(-1)).toHaveClass("text-rarity-mythic-text");
    expect(pack).toHaveTextContent(/^Anime TCGDemo pack.*Five cards$/);
  });

  it("the page reads top to bottom: h1, button, disclosure, How it plays, Pack odds, Join, then the footer", async () => {
    renderLanding();
    await screen.findByRole("table", { name: "Pack odds" });
    const order = [
      screen.getByRole("heading", { level: 1, name: "Anime TCG" }),
      main().getByRole("button", { name: "Open a demo pack" }),
      screen.getByText(DISCLOSURE),
      screen.getByRole("heading", { level: 2, name: "How it plays" }),
      screen.getByRole("heading", { level: 2, name: "Pack odds" }),
      screen.getByRole("heading", { level: 2, name: "Join" }),
      screen.getByRole("contentinfo"),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});

describe("How it plays and Pack odds (§3.7 items 2 and 3)", () => {
  it("numbered steps 01 to 05, each a term and one sentence from the server's numbers", async () => {
    renderLanding();
    await screen.findByText(LEDE);
    const section = screen.getByRole("region", { name: "How it plays" });
    const list = within(section).getByRole("list");
    expect(list.tagName).toBe("OL");
    const steps = within(list).getAllByRole("listitem");
    expect(steps.map((step) => within(step).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "Packs",
      "Rarity",
      "Collection",
      "Karma",
      "Market",
    ]);
    expect(steps.map((step) => step.querySelector('[aria-hidden="true"]')?.textContent)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
    ]);
    expect(steps.map((step) => step.querySelector("p")?.textContent)).toEqual([
      "A new pack every 10 minutes, and up to 3 can pile up. Five cards each.",
      "Every character has one of six tiers, set by how many AniList users favourited them. Every pack uses the odds below.",
      "See how much of each series you have, and how much of all 2,983 characters.",
      KARMA,
      "List cards for other players to buy with Karma, and buy theirs.",
    ]);
  });

  it("Pack odds is a section of its own: the table lowest tier first, a swatch and stars before each word, the source line", async () => {
    renderLanding();
    const table = await screen.findByRole("table", { name: "Pack odds" });
    expect(screen.getByRole("region", { name: "Pack odds" })).toContainElement(table);
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Tier", "At least one per pack", "Each card"]);
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => [
        within(row).getByRole("rowheader").textContent?.replace(/^✦+/, ""),
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
    const mythic = within(table).getByRole("rowheader", { name: "Mythic" });
    expect(mythic).toHaveClass("text-rarity-mythic-text");
    const [swatch, stars] = mythic.querySelectorAll('[aria-hidden="true"]');
    expect(swatch).toHaveClass("bg-(--card-frame-flat-mythic)", "aspect-[5/7]", "w-2.5");
    expect(swatch?.className).not.toMatch(/glow|shadow/);
    expect(stars).toHaveTextContent("✦✦✦✦✦✦");
    expect(stars).toHaveClass("hidden", "sm:inline");
    expect(within(table).getByRole("rowheader", { name: "Common" }).firstElementChild).toHaveClass(
      "bg-(--card-frame-common)",
    );
    expect(screen.getByText("Drawn from 2,983 characters, as of 29 Oct 2026.")).toBeInTheDocument();
  });
});

describe("the facts (§4.5)", () => {
  it("before they arrive: every line in its no-facts form, no Pack odds section, and the button already works", async () => {
    const facts = held(ok(makeDemo()));
    const { fetchMock, history } = renderLanding({ [DEMO]: facts.handler });
    await pageHeading("Anime TCG");
    expect(screen.getByText(LEDE_WITHOUT_FACTS)).toBeInTheDocument();
    expect(
      screen.getByText("A new pack on a timer, and a few can pile up. Five cards each."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pack odds" })).not.toBeInTheDocument();
    await userEvent.setup().click(await demoButton());
    await pageHeading("Demo pack");
    expect(history.location.pathname).toBe("/demo");
    await waitFor(() => expect(callsTo(fetchMock, DEMO_OPEN)).toHaveLength(1));
    facts.release();
  });

  it("no pool: the unavailable line in the button's place, no Pack odds, the Rarity step without its pointer", async () => {
    renderLanding({ [DEMO]: ok(makeUnavailableDemo()) });
    expect(await screen.findByText("Demo packs are unavailable right now.")).toBeInTheDocument();
    expect(main().queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pack odds" })).not.toBeInTheDocument();
    expect(screen.getByText(LEDE_WITHOUT_FACTS)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Every character has one of six tiers, set by how many AniList users favourited them.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("See how much of each series you have, and of the whole pool."),
    ).toBeInTheDocument();
  });

  it("no answer: the unreachable banner over the no-facts page; a demo pack that answers clears it and brings the facts", async () => {
    const { fetchMock, history } = renderLanding({
      [DEMO]: sequence({ status: 502, raw: "bad gateway" }, ok(makeDemo())),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(UNREACHABLE);
    expect(screen.getByText(LEDE_WITHOUT_FACTS)).toBeInTheDocument();
    await userEvent.setup().click(await demoButton());
    expect(await screen.findByRole("list", { name: "Demo pack" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    await waitFor(() => expect(callsTo(fetchMock, DEMO)).toHaveLength(2));
    act(() => history.back());
    expect(await screen.findByText(LEDE)).toBeInTheDocument();
  });

  it("answered with an error envelope: the no-facts page, no banner", async () => {
    renderLanding({ [DEMO]: envelope(429, "rate_limited") });
    expect(await demoButton()).toBeInTheDocument();
    expect(screen.getByText(LEDE_WITHOUT_FACTS)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asked for once per page load: a link out and Back send no second GET /api/demo", async () => {
    const { fetchMock, history } = renderLanding();
    expect(await screen.findByText(LEDE)).toBeInTheDocument();
    act(() => history.push("/login"));
    await pageHeading("Log in");
    act(() => history.back());
    await pageHeading("Anime TCG");
    expect(screen.getByText(LEDE)).toBeInTheDocument();
    await settle();
    expect(callsTo(fetchMock, DEMO)).toHaveLength(1);
  });
});
