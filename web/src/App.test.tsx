import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { SESSION_QUERY_KEY } from "./hooks/useAccountSession";
import { createQueryClient } from "./lib/queryClient";
import { envelope, makeAccount, noContent } from "./test/api";
import { ANILIST, liveRegion, renderApp, signedOutSession } from "./test/app";
import { fill } from "./test/user";

/**
 * Budget for async queries that race real timers (the 350 ms pack-reveal delay
 * in Game.tsx) or React's passive-effect flush under parallel-file load.
 */
const ASYNC_TIMEOUT = 5_000;

const account = makeAccount({ login: "Chris" });

describe("App boot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("signed out: the Account screen, no tabs, no account data, title reset", async () => {
    renderApp({ "GET /api/session": signedOutSession });
    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Views" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open booster pack/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(document.title).toBe("Anime TCG");
  });

  it("shows Loading… only once the session check has taken 300 ms, with the title block alone", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <App />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Anime TCG" })).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your account" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("Loading…")).toHaveAttribute("aria-live", "polite");
  });

  it("unreachable: red banner with Try again above a usable Account screen; Try again recovers", async () => {
    const { fetchMock } = renderApp({ "GET /api/session": { status: 502, raw: "bad gateway" } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't reach the game server. Check your connection and try again.");
    expect(screen.getByRole("heading", { name: "Your account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();

    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ signedIn: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Your account" })).toBeInTheDocument();
  });

  it("signed in: the game with the Account control, tabs and the login in the title", async () => {
    renderApp({}, account);
    expect(
      await screen.findByRole("button", { name: "Account menu. Signed in as \u2068Chris\u2069" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /collection \(0\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open booster pack/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your account" })).not.toBeInTheDocument();
    expect(document.title).toBe("\u2068Chris\u2069 · Anime TCG");
  });
});

describe("App account flows", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("logging in lands on the Booster tab, shows the login, announces and focuses the pack button", async () => {
    renderApp({
      "GET /api/session": signedOutSession,
      "POST /api/session/login": { status: 200, body: { signedIn: true, account } },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Log in" }));
    await fill(user, screen.getByLabelText("Login"), "chris");
    await fill(user, screen.getByLabelText("Password"), "a password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(
      await screen.findByRole(
        "button",
        { name: "Account menu. Signed in as \u2068Chris\u2069" },
        { timeout: ASYNC_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Booster" })).toHaveAttribute("aria-pressed", "true");
    expect(liveRegion()).toHaveTextContent("Logged in. You're now on Chris.");
    const pack = screen.getByRole("button", { name: /open booster pack/i });
    await waitFor(() => expect(pack).toBeEnabled(), { timeout: ASYNC_TIMEOUT });
    expect(pack).toHaveFocus();
    expect(document.title).toBe("\u2068Chris\u2069 · Anime TCG");
  });

  it("the live region is one node for the app's lifetime; log in and log out write into it", async () => {
    renderApp({
      "GET /api/session": signedOutSession,
      "POST /api/session/login": { status: 200, body: { signedIn: true, account } },
      "POST /api/session/logout": noContent,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Log in" }));
    const region = liveRegion();
    expect(region).toBeEmptyDOMElement();
    const written: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) if (record.target === region) written.push(...record.addedNodes);
    });
    observer.observe(region, { childList: true });

    await fill(user, screen.getByLabelText("Login"), "chris");
    await fill(user, screen.getByLabelText("Password"), "a password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole(
      "button",
      { name: "Account menu. Signed in as \u2068Chris\u2069" },
      { timeout: ASYNC_TIMEOUT },
    );
    expect(liveRegion()).toBe(region);
    expect(region).toHaveTextContent("Logged in. You're now on Chris.");
    expect(written.length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Account menu. Signed in as \u2068Chris\u2069" }));
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    await screen.findByRole("heading", { name: "Your account" });
    expect(liveRegion()).toBe(region);
    expect(region).toHaveTextContent("Logged out.");
    expect(region.isConnected).toBe(true);
    observer.disconnect();
  });

  it("the Account button brings the choice back and focuses its heading", async () => {
    renderApp({ "GET /api/session": signedOutSession });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Register" }));
    expect(screen.getByRole("heading", { name: "Register" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByRole("heading", { name: "Your account" })).toHaveFocus();
  });

  it("Log out returns to the Account screen, resets the title, announces and focuses the heading", async () => {
    renderApp({ "POST /api/session/logout": noContent }, account);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Account menu. Signed in as \u2068Chris\u2069" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));

    const heading = await screen.findByRole("heading", { name: "Your account" });
    expect(heading).toHaveFocus();
    expect(document.title).toBe("Anime TCG");
    expect(liveRegion()).toHaveTextContent("Logged out.");
    expect(screen.queryByText("Chris")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a log-out the server does not answer still drops to the Account screen, with the banner", async () => {
    renderApp({ "POST /api/session/logout": { status: 502, raw: "" } }, account);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Account menu. Signed in as \u2068Chris\u2069" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the game server.");
  });

  it("an unauthenticated answer mid-session closes the dialog and shows the session-ended banner", async () => {
    renderApp({ "PATCH /api/account/login": envelope(401, "unauthenticated") }, account);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Account menu. Signed in as \u2068Chris\u2069" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Manage account…" }));
    expect(screen.getByRole("dialog", { name: "Manage account" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("New login"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const heading = await screen.findByRole("heading", { name: "Your account" });
    expect(heading).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const banner = screen.getByText("You were logged out. Log in again to continue.");
    expect(banner).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Views" })).not.toBeInTheDocument();
    expect(document.title).toBe("Anime TCG");

    // Logging in again clears the notice.
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("renaming through the dialog updates the header and the title", async () => {
    const renamed = makeAccount({ login: "Chris2" });
    renderApp({ "PATCH /api/account/login": { status: 200, body: { account: renamed } } }, account);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Account menu. Signed in as \u2068Chris\u2069" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Manage account…" }));
    await user.type(screen.getByLabelText("New login"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Account menu. Signed in as \u2068Chris2\u2069" }),
    ).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Login changed to Chris2.");
    expect(document.title).toBe("\u2068Chris2\u2069 · Anime TCG");
    expect(screen.getByRole("dialog", { name: "Manage account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.getByRole("button", { name: "Account menu. Signed in as \u2068Chris2\u2069" }),
    ).toHaveFocus();
  });
});

describe("App account switch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a session naming a different account starts that account's game from scratch", async () => {
    const { queryClient } = renderApp({}, account);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /collection \(0\)/i }));
    expect(screen.getByRole("button", { name: /collection/i })).toHaveAttribute("aria-pressed", "true");

    const other = makeAccount({ id: "9b2d7c1e-0000-4000-8000-000000000002", login: "Kris" });
    act(() => {
      queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true, account: other });
    });

    expect(
      await screen.findByRole("button", { name: "Account menu. Signed in as \u2068Kris\u2069" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Booster" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("App game", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens a pack of 5, adds it to the collection and keeps nothing in localStorage", async () => {
    renderApp({}, account);
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: /open booster pack/i });
    await waitFor(() => expect(button).toBeEnabled(), { timeout: ASYNC_TIMEOUT });

    await user.click(button);
    expect(
      screen.getByRole("button", { name: "Account menu. Signed in as \u2068Chris\u2069" }),
    ).toBeDisabled();

    const cards = await screen.findAllByRole("article", {}, { timeout: ASYNC_TIMEOUT });
    expect(cards).toHaveLength(5);
    expect(screen.getAllByText("New")).toHaveLength(5);
    expect(screen.getByRole("button", { name: /collection \(5\)/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Account menu. Signed in as \u2068Chris\u2069" }),
    ).toBeEnabled();
    expect(localStorage.getItem("anime-tcg:inventory:v1")).toBeNull();
  });

  it("shows the AniList error with a retry button when signed in", async () => {
    renderApp({ [ANILIST]: { status: 429, body: { errors: [{ message: "Too Many Requests" }] } } }, account);
    const alert = await screen.findByRole("alert", {}, { timeout: ASYNC_TIMEOUT });
    expect(alert).toHaveTextContent(/rate limit/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open booster pack/i })).toBeDisabled();
  });
});
