import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { SESSION_QUERY_KEY } from "./hooks/useAccountSession";
import { createQueryClient } from "./lib/queryClient";
import { createAppRouter } from "./router";
import { envelope, makeAccount, mockFetch, noContent, urlOf, type MockAnswer } from "./test/api";
import {
  callsTo,
  COLLECTION,
  gameServer,
  liveRegion,
  OPEN,
  PACKS,
  pageHeading,
  renderApp,
  signedInRoutes,
  signedOutSession,
} from "./test/app";
import { makeDemo } from "./test/fixtures";
import { fill } from "./test/user";

/** Budget for async queries that race React's passive-effect flush under parallel-file load. */
const ASYNC_TIMEOUT = 5_000;

const account = makeAccount({ login: "Chris" });
const CONTROL = "Account menu. Signed in as \u2068Chris\u2069";
const mainNav = () => screen.getByRole("navigation", { name: "Main" });

describe("App boot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("signed out at /: the landing page, the Log in and Register links, no account data, the start title", async () => {
    renderApp({ "GET /api/session": signedOutSession });
    expect(await pageHeading("Anime TCG")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(
      within(mainNav())
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Log in", "Register"]);
    expect(screen.queryByRole("link", { name: "Packs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open pack" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Account menu/ })).not.toBeInTheDocument();
    expect(document.title).toBe("Anime TCG");
  });

  it("shows Loading… only once the session check has taken 300 ms, with the wordmark alone", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const queryClient = createQueryClient();
    const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: ["/"] }) });
    render(
      <QueryClientProvider client={queryClient}>
        <App router={router} />
      </QueryClientProvider>,
    );
    // No page renders before the answer, the landing page included (§3.2 step 1).
    expect(screen.getByText("Anime TCG")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    // The footer's AniList credit is the only link; the header has no page links yet.
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["AniList"]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("unreachable: red banner with Try again above a usable landing page; Try again recovers, the pool facts too", async () => {
    const { fetchMock } = renderApp({
      "GET /api/session": { status: 502, raw: "bad gateway" },
      "GET /api/demo": { status: 502, raw: "bad gateway" },
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't reach the game server. Check your connection and try again.");
    expect(screen.getByRole("heading", { level: 1, name: "Anime TCG" })).toBeInTheDocument();
    expect(within(mainNav()).getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(
      screen.getByText("Characters from the most popular anime on AniList, five to a pack."),
    ).toBeInTheDocument();

    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        new Response(JSON.stringify(urlOf(input) === "/api/demo" ? makeDemo() : { signedIn: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1, name: "Anime TCG" })).toBeInTheDocument();
    expect(
      await screen.findByText("2,983 characters from the 100 most popular anime on AniList, five to a pack."),
    ).toBeInTheDocument();
  });

  it("unreachable: the page stays up while Try again runs, and nothing asks the server on its own", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { fetchMock } = renderApp(
      { "GET /api/session": { status: 502, raw: "bad gateway" } },
      account,
      "/login",
    );
    await pageHeading("Log in");
    const user = userEvent.setup();
    await fill(user, screen.getByLabelText("Login"), "typed before the retry");
    const sessionChecks = () => fetchMock.mock.calls.filter(([url]) => url === "/api/session").length;
    // The router's root layout mounted after the failure; it must not repeat the check by itself.
    expect(sessionChecks()).toBe(1);

    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeDisabled();
    // Still the page, not the boot screen: what was typed is still there.
    expect(screen.getByLabelText("Login")).toHaveValue("typed before the retry");
    act(() =>
      answer(
        new Response(JSON.stringify({ signedIn: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Login")).toHaveValue("typed before the retry");
    expect(sessionChecks()).toBe(2);
  });

  it("unreachable on an account page: /login with the guard line; Try again that finds a session returns there", async () => {
    const { history } = renderApp(
      { "GET /api/session": { status: 502, raw: "bad gateway" } },
      account,
      "/collection",
    );
    expect(await pageHeading("Log in")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/login");
    expect(screen.getByText("Log in to see your collection.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the game server.");

    mockFetch(signedInRoutes(account));
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await pageHeading("Collection")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/collection");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("signed in at /: replaced by /packs with the Account control and the page links, and no login in the title", async () => {
    const { history } = renderApp({}, account);
    expect(await screen.findByRole("button", { name: CONTROL })).toBeInTheDocument();
    expect(history.location.pathname).toBe("/packs");
    expect(within(mainNav()).getByRole("link", { name: "Packs" })).toHaveAttribute("aria-current", "page");
    expect(within(mainNav()).getByRole("link", { name: "Collection (0)" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(await screen.findByRole("button", { name: "Open pack" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Anime TCG" })).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Packs · Anime TCG"));
  });
});

describe("App account flows", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("logging in replaces /login with /packs, shows the login, announces and focuses the Packs heading", async () => {
    const { history } = renderApp(
      {
        "GET /api/session": signedOutSession,
        "POST /api/session/login": { status: 200, body: { signedIn: true, account } },
      },
      account,
      "/login",
    );
    const user = userEvent.setup();
    await pageHeading("Log in");
    await fill(user, screen.getByLabelText("Login"), "chris");
    await fill(user, screen.getByLabelText("Password"), "a password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(
      await screen.findByRole("button", { name: CONTROL }, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    const heading = await pageHeading("Packs");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(history.location.pathname).toBe("/packs");
    expect(history.length).toBe(1);
    expect(liveRegion()).toHaveTextContent("Logged in. You're now on Chris.");
    expect(document.title).toBe("Packs · Anime TCG");
  });

  it("the live region is one node for the app's lifetime; log in and log out write into it", async () => {
    renderApp(
      {
        "GET /api/session": signedOutSession,
        "POST /api/session/login": { status: 200, body: { signedIn: true, account } },
        "POST /api/session/logout": noContent,
      },
      account,
      "/login",
    );
    const user = userEvent.setup();
    await pageHeading("Log in");
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
    await screen.findByRole("button", { name: CONTROL }, { timeout: ASYNC_TIMEOUT });
    expect(liveRegion()).toBe(region);
    expect(region).toHaveTextContent("Logged in. You're now on Chris.");
    expect(written.length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: CONTROL }));
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    await pageHeading("Anime TCG");
    expect(liveRegion()).toBe(region);
    expect(region).toHaveTextContent("Logged out.");
    expect(region.isConnected).toBe(true);
    observer.disconnect();
  });

  it("Log out replaces the page with /, resets the title, announces and focuses the landing heading", async () => {
    const { history } = renderApp({ "POST /api/session/logout": noContent }, account, "/collection");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: CONTROL }));
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));

    const heading = await pageHeading("Anime TCG");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(history.location.pathname).toBe("/");
    expect(history.length).toBe(1);
    expect(document.title).toBe("Anime TCG");
    expect(liveRegion()).toHaveTextContent("Logged out.");
    expect(screen.queryByText("Chris")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a log-out the server does not answer still signs out to /, with the banner", async () => {
    renderApp({ "POST /api/session/logout": { status: 502, raw: "" } }, account);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: CONTROL }));
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(await pageHeading("Anime TCG")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the game server.");
  });

  it("an unauthenticated answer mid-session replaces the page with /login, the banner and focus; logging in returns", async () => {
    const { history } = renderApp(
      {
        "PATCH /api/account/login": envelope(401, "unauthenticated"),
        "POST /api/session/login": { status: 200, body: { signedIn: true, account } },
      },
      account,
      "/account",
    );
    const user = userEvent.setup();
    await pageHeading("Manage account");
    await user.type(screen.getByLabelText("New login"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const heading = await pageHeading("Log in");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(history.location.pathname).toBe("/login");
    expect(history.location.state).toMatchObject({ returnTo: "/account" });
    const banner = screen.getByText("You were logged out. Log in again to continue.");
    expect(banner).toHaveAttribute("role", "status");
    // The banner says it; the guard line would say it twice (§3.3 step 4).
    expect(screen.queryByText("Log in to manage your account.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Packs" })).not.toBeInTheDocument();
    expect(document.title).toBe("Log in · Anime TCG");

    await fill(user, screen.getByLabelText("Login"), "chris");
    await fill(user, screen.getByLabelText("Password"), "a password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await pageHeading("Manage account")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/account");
    expect(screen.queryByText("You were logged out. Log in again to continue.")).not.toBeInTheDocument();
  });

  it("renaming on /account updates the header and announces; the title stays the page's", async () => {
    const renamed = makeAccount({ login: "Chris2" });
    renderApp(
      { "PATCH /api/account/login": { status: 200, body: { account: renamed } } },
      account,
      "/account",
    );
    const user = userEvent.setup();
    await pageHeading("Manage account");
    await user.type(screen.getByLabelText("New login"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Account menu. Signed in as \u2068Chris2\u2069" }),
    ).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Login changed to Chris2.");
    expect(document.title).toBe("Manage account · Anime TCG");
  });

  it("deleting replaces /account with /, announces and focuses the landing heading", async () => {
    const { history } = renderApp({ "POST /api/account/delete": noContent }, account, "/account");
    const user = userEvent.setup();
    await pageHeading("Manage account");
    await user.click(screen.getByRole("button", { name: "Delete account…" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Chris?" });
    await fill(user, within(dialog).getByLabelText("Password"), "correct horse");
    await user.click(within(dialog).getByRole("button", { name: "Delete Chris" }));

    const heading = await pageHeading("Anime TCG");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(history.location.pathname).toBe("/");
    expect(liveRegion()).toHaveTextContent("Deleted Chris.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("App account switch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a session naming a different account starts that account's game from scratch, on the same page", async () => {
    const { routes } = gameServer();
    const { queryClient, history } = renderApp(routes, account, "/packs");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open pack" }));
    expect(await screen.findAllByRole("article", {}, { timeout: ASYNC_TIMEOUT })).toHaveLength(5);
    expect(
      await screen.findByRole("link", { name: "Collection (5)" }, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();

    const other = makeAccount({ id: "9b2d7c1e-0000-4000-8000-000000000002", login: "Kris" });
    mockFetch(signedInRoutes(other));
    act(() => {
      queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true, account: other });
    });

    expect(
      await screen.findByRole("button", { name: "Account menu. Signed in as \u2068Kris\u2069" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Collection (0)" })).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(history.location.pathname).toBe("/packs");
  });
});

describe("App game", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens a pack the server deals: five cards, New markers, the count, the summary announced, nothing stored", async () => {
    const { routes } = gameServer();
    const { fetchMock } = renderApp(routes, account, "/packs");
    const user = userEvent.setup();
    expect(await screen.findByText("3 of 3 packs ready")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open pack" }));

    const cards = await screen.findAllByRole("article", {}, { timeout: ASYNC_TIMEOUT });
    expect(cards).toHaveLength(5);
    expect(screen.getAllByText("New")).toHaveLength(5);
    expect(screen.getByText("2 of 3 packs ready")).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Your pack: 1 Rare, 1 Uncommon and 3 Common. 5 new.");
    expect(
      await screen.findByRole("link", { name: "Collection (5)" }, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CONTROL })).toBeEnabled();
    expect(callsTo(fetchMock, OPEN)).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => urlOf(url).includes("anilist"))).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("the reveal survives a page change and comes back without its entrance", async () => {
    const { routes } = gameServer();
    renderApp(routes, account, "/packs");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open pack" }));
    const list = await screen.findByRole("list", { name: "Your pack" }, { timeout: ASYNC_TIMEOUT });
    expect(within(list).getAllByRole("listitem")[0]).toHaveClass("animate-card-enter");

    await user.click(await screen.findByRole("link", { name: "Collection (5)" }, { timeout: ASYNC_TIMEOUT }));
    await pageHeading("Collection");
    expect(await screen.findByText("5 cards · No duplicates")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Packs" }));
    await pageHeading("Packs");
    await user.click(screen.getByRole("link", { name: "See your latest pack" }));
    await pageHeading("Pack opening");
    const returned = within(screen.getByRole("list", { name: "Your pack" })).getAllByRole("listitem");
    expect(returned).toHaveLength(5);
    for (const item of returned) expect(item).not.toHaveClass("animate-card-enter");
  });

  it("a pack opened on /packs lands while the player is on another page: unannounced, the collection refetched", async () => {
    const { routes, server } = gameServer();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const open = routes[OPEN] as (init: RequestInit | undefined, url: string) => MockAnswer;
    const { fetchMock } = renderApp(
      { ...routes, [OPEN]: async (init, url) => held.then(() => open(init, url)) },
      account,
      "/packs",
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open pack" }));
    // The links stay usable while the pack opens (§3.5 step 4); the Account control does not.
    expect(screen.getByRole("button", { name: CONTROL })).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "Collection (0)" }));
    await pageHeading("Collection");
    release();

    expect(
      await screen.findByRole("link", { name: "Collection (5)" }, { timeout: ASYNC_TIMEOUT }),
    ).toBeInTheDocument();
    expect(server.opened).toBe(1);
    expect(liveRegion()).not.toHaveTextContent("Your pack");
    expect(callsTo(fetchMock, PACKS)).toHaveLength(1);
    expect(callsTo(fetchMock, COLLECTION).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: CONTROL })).toBeEnabled();
  });
});
