import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_QUERY_KEY } from "./hooks/useAccountSession";
import { ACCOUNT_PAGES, OPENING_PAGES, PUBLIC_PAGES } from "./lib/routes";
import { makeAccount, mockFetch } from "./test/api";
import { gameServer, pageHeading, renderApp, signedInRoutes, signedOutSession } from "./test/app";
import { fill } from "./test/user";

/**
 * The router against the route list (navigation-and-landing.md §3.1, §3.3,
 * §3.6, §3.9, §3.11): the whole app booted at a path in a memory history.
 */

const account = makeAccount({ login: "Chris" });
const signedOut = { "GET /api/session": signedOutSession };
const logIn = { "POST /api/session/login": { status: 200, body: { signedIn: true, account } } };
const mainNav = () => screen.getByRole("navigation", { name: "Main" });

async function submitLogIn() {
  const user = userEvent.setup();
  await fill(user, screen.getByLabelText("Login"), "chris");
  await fill(user, screen.getByLabelText("Password"), "a password");
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

afterEach(() => vi.unstubAllGlobals());

describe("the route tree", () => {
  it("holds exactly the route list's pages plus the catch-all", () => {
    const { router } = renderApp(signedOut);
    const paths = Object.keys(router.routesByPath).filter((path) => path !== "/$");
    expect(paths.sort()).toEqual(
      [...Object.keys(PUBLIC_PAGES), ...Object.keys(ACCOUNT_PAGES), ...Object.keys(OPENING_PAGES)].sort(),
    );
    expect(Object.keys(router.routesByPath)).toContain("/$");
  });
});

describe("the guard (§3.3)", () => {
  it.each(Object.keys(ACCOUNT_PAGES))(
    "signed out at %s: replaced by /login, the page held in history state, the guard line shown",
    async (path) => {
      const { history } = renderApp(signedOut, account, path);
      expect(await pageHeading("Log in")).toBeInTheDocument();
      expect(history.location.pathname).toBe("/login");
      expect(history.location.search).toBe("");
      expect(history.location.hash).toBe("");
      expect(history.location.state).toMatchObject({ returnTo: path });
      expect(history.length).toBe(1);
      const line = ACCOUNT_PAGES[path as keyof typeof ACCOUNT_PAGES].guardLine;
      expect(screen.getByText(line)).toBeInTheDocument();
      expect(document.title).toBe("Log in · Anime TCG");
    },
  );

  it("drops a query string and hash on the way and keeps only the page as the return path", async () => {
    const { history } = renderApp(signedOut, account, "/collection?return=//evil.example#x");
    await pageHeading("Log in");
    expect(history.location.pathname).toBe("/login");
    expect(history.location.search).toBe("");
    expect(history.location.hash).toBe("");
    expect(history.location.state).toMatchObject({ returnTo: "/collection" });
  });

  it("the replace means Back skips the guard and goes to the entry before", async () => {
    const { history } = renderApp(signedOut, account, "/");
    await pageHeading("Anime TCG");
    act(() => history.push("/collection"));
    await pageHeading("Log in");
    expect(history.length).toBe(2);
    act(() => history.back());
    expect(await pageHeading("Anime TCG")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/");
  });

  it("after logging in the visitor lands on the page they asked for, replacing /login", async () => {
    const { history } = renderApp({ ...signedOut, ...logIn }, account, "/");
    await pageHeading("Anime TCG");
    act(() => history.push("/profile"));
    await pageHeading("Log in");
    await submitLogIn();
    expect(await pageHeading("Profile")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/profile");
    expect(history.length).toBe(2);
    act(() => history.back());
    expect(await pageHeading("Packs")).toBeInTheDocument();
  });

  it.each([
    ["/packs/open", "/packs", "Log in to open your packs."],
    ["/shop/open", "/shop", "Log in to see the shop."],
  ])(
    "signed out at the opening page %s: replaced by /login with its section page %s as the return path (§3.13 step 7)",
    async (path, section, line) => {
      const { history } = renderApp({ ...signedOut, ...logIn }, account, path);
      expect(await pageHeading("Log in")).toBeInTheDocument();
      expect(history.location.pathname).toBe("/login");
      expect(history.location.state).toMatchObject({ returnTo: section });
      expect(screen.getByText(line)).toBeInTheDocument();
      await submitLogIn();
      // Nothing is held after a sign-in, so the player lands on the section page, never the opening page.
      expect(await pageHeading(section === "/packs" ? "Packs" : "Shop")).toBeInTheDocument();
      expect(history.location.pathname).toBe(section);
    },
  );

  it.each(["/", "/demo", "/login", "/register"])("signed in at %s: replaced by /packs", async (path) => {
    const { history } = renderApp({}, account, path);
    expect(await pageHeading("Packs")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/packs");
    expect(history.length).toBe(1);
  });

  it("Back onto a /login entry that holds a return path, signed in by then: /packs, not the return path", async () => {
    const { history, router, queryClient } = renderApp(signedOut, account, "/");
    await pageHeading("Anime TCG");
    act(() => void router.navigate({ to: "/login", state: { returnTo: "/collection" } }));
    await pageHeading("Log in");
    act(() => {
      queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true, account });
    });
    act(() => history.push("/profile"));
    await pageHeading("Profile");
    act(() => history.back());
    expect(await pageHeading("Packs")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/packs");
  });
});

describe("the return path from history state (§3.3 step 3)", () => {
  const hostile: unknown[] = [
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "%2F%2Fevil.example",
    "/p%61cks",
    "/packs?x=1",
    "/packs#x",
    "/PACKS",
    "/packs/",
    "/Market",
    "/login",
    42,
    { toString: () => "/collection" },
  ];

  it.each(hostile)("%s shows no guard line, and logging in lands on /packs", async (returnTo) => {
    const { history, router } = renderApp({ ...signedOut, ...logIn }, account, "/");
    await pageHeading("Anime TCG");
    act(() => void router.navigate({ to: "/login", state: { returnTo } }));
    await pageHeading("Log in");
    for (const line of Object.values(ACCOUNT_PAGES).map((page) => page.guardLine)) {
      expect(screen.queryByText(line)).not.toBeInTheDocument();
    }
    await submitLogIn();
    expect(await pageHeading("Packs")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/packs");
  });

  it("the cross-links carry the return path from Log in to Register and back", async () => {
    const { history } = renderApp(signedOut, account, "/account");
    await pageHeading("Log in");
    const user = userEvent.setup();
    const panel = screen.getByRole("region", { name: "Log in" });
    expect(within(panel).getByText(/No account yet\?/)).toBeInTheDocument();
    await user.click(within(panel).getByRole("link", { name: "Register" }));
    await pageHeading("Register");
    expect(history.location.state).toMatchObject({ returnTo: "/account" });

    const registerPanel = screen.getByRole("region", { name: "Register" });
    expect(within(registerPanel).getByText(/Already registered\?/)).toBeInTheDocument();
    await user.click(within(registerPanel).getByRole("link", { name: "Log in" }));
    await pageHeading("Log in");
    expect(history.location.state).toMatchObject({ returnTo: "/account" });
    expect(screen.getByText("Log in to manage your account.")).toBeInTheDocument();
  });

  it("registering after the guard lands on the page asked for, replacing /register (§3.3 step 6)", async () => {
    const { history } = renderApp(
      {
        ...signedOut,
        "POST /api/accounts/check-invite": { status: 204 },
        "POST /api/accounts/register": { status: 201, body: { signedIn: true, account } },
      },
      account,
      "/collection",
    );
    await pageHeading("Log in");
    const user = userEvent.setup();
    await user.click(within(screen.getByRole("main")).getByRole("link", { name: "Register" }));
    await pageHeading("Register");
    await fill(user, screen.getByLabelText("Invite code"), "local-dev-invite");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await fill(user, await screen.findByLabelText("Login"), "Chris");
    await fill(user, screen.getByLabelText("Password"), "a strong one");
    await fill(user, screen.getByLabelText("Confirm password"), "a strong one");
    await user.click(screen.getByRole("button", { name: "Register" }));

    const heading = await pageHeading("Collection");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(history.location.pathname).toBe("/collection");
    // The guard replaced /collection with /login, the cross-link pushed /register, and the sign-in replaced it.
    expect(history.length).toBe(2);
  });

  it("the header's Log in link carries no return path", async () => {
    const { history } = renderApp(signedOut, account, "/register");
    await pageHeading("Register");
    await userEvent.setup().click(within(mainNav()).getByRole("link", { name: "Log in" }));
    await pageHeading("Log in");
    expect(history.location.state).not.toHaveProperty("returnTo");
  });
});

describe("paths (§3.1 rule 2)", () => {
  it.each([
    ["/packs/", "/packs", "Packs"],
    ["/packs//", "/packs", "Packs"],
    ["/collection/", "/collection", "Collection"],
  ])("%s is replaced by %s at load", async (path, canonical, heading) => {
    const { history } = renderApp({}, account, path);
    await pageHeading(heading);
    expect(history.location.pathname).toBe(canonical);
    expect(history.length).toBe(1);
    await waitFor(() => expect(document.title).toBe(`${heading} · Anime TCG`));
    expect(document.body).toHaveFocus();
  });

  it("signed out, /collection/ is replaced and then guarded", async () => {
    const { history } = renderApp(signedOut, account, "/collection/");
    await pageHeading("Log in");
    expect(history.location.state).toMatchObject({ returnTo: "/collection" });
  });

  it.each(["/Packs", "/PACKS", "/packs/1", "/packs/1/", "/index.html", "/Shop", "/Market", "/no-such-page"])(
    "%s is the not-found page, signed in with the signed-in header",
    async (path) => {
      const { history } = renderApp({}, account, path);
      expect(await pageHeading("Page not found")).toBeInTheDocument();
      expect(history.location.pathname).toBe(path);
      expect(screen.getByText("There's no page at this address.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go to Packs" })).toHaveAttribute("href", "/packs");
      expect(screen.getByRole("button", { name: /^Account menu/ })).toBeInTheDocument();
      expect(within(mainNav()).queryByRole("link", { current: "page" })).not.toBeInTheDocument();
      expect(document.title).toBe("Page not found · Anime TCG");
    },
  );

  it("signed out, an unknown path is the not-found page with the public header, not the guard", async () => {
    const { history } = renderApp(signedOut, account, "/packs/1");
    expect(await pageHeading("Page not found")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/packs/1");
    expect(screen.getByRole("link", { name: "Go to the start page" })).toHaveAttribute("href", "/");
    expect(within(mainNav()).getByRole("link", { name: "Log in" })).toBeInTheDocument();
  });

  it("unreachable on an unknown path: Try again that finds a session stays there, with the signed-in header", async () => {
    const { history } = renderApp(
      { "GET /api/session": { status: 502, raw: "bad gateway" } },
      account,
      "/no-such-page",
    );
    await pageHeading("Page not found");
    expect(within(mainNav()).getByRole("link", { name: "Log in" })).toBeInTheDocument();
    mockFetch(signedInRoutes(account));
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /^Account menu/ })).toBeInTheDocument();
    expect(history.location.pathname).toBe("/no-such-page");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Packs" })).toBeInTheDocument();
  });

  it("keeps the game state across the not-found page", async () => {
    const { routes } = gameServer();
    const { history } = renderApp(routes, account, "/packs");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open pack" }));
    await screen.findByRole("link", { name: "Collection (5)" }, { timeout: 5_000 });
    act(() => history.push("/no-such-page"));
    await pageHeading("Page not found");
    expect(screen.getByRole("link", { name: "Collection (5)" })).toBeInTheDocument();
    act(() => history.back());
    await pageHeading("Pack opening");
    expect(screen.getAllByRole("article")).toHaveLength(5);
  });
});

describe("titles and focus on page changes (§3.6)", () => {
  it("the first render sets the title and moves no focus", async () => {
    renderApp({}, account, "/collection");
    await pageHeading("Collection");
    await waitFor(() => expect(document.title).toBe("Collection · Anime TCG"));
    expect(document.body).toHaveFocus();
  });

  it("a boot replace is part of the first render: no focus move", async () => {
    renderApp(signedOut, account, "/collection");
    await pageHeading("Log in");
    await waitFor(() => expect(document.title).toBe("Log in · Anime TCG"));
    expect(document.body).toHaveFocus();
  });

  it("a link, Back and Forward set the title, then focus the new page's h1", async () => {
    const { history } = renderApp({}, account, "/packs");
    const user = userEvent.setup();
    await pageHeading("Packs");

    await user.click(within(mainNav()).getByRole("link", { name: "Collection (0)" }));
    const collection = await pageHeading("Collection");
    await waitFor(() => expect(collection).toHaveFocus());
    expect(document.title).toBe("Collection · Anime TCG");
    expect(history.length).toBe(2);

    act(() => history.back());
    const packs = await pageHeading("Packs");
    await waitFor(() => expect(packs).toHaveFocus());
    expect(document.title).toBe("Packs · Anime TCG");

    act(() => history.forward());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Collection" })).toHaveFocus());
  });

  it("every page has exactly one h1, focusable by script only", async () => {
    const { history } = renderApp({}, account, "/packs");
    for (const [path, heading] of [
      ["/packs", "Packs"],
      ["/collection", "Collection"],
      ["/profile", "Profile"],
      ["/account", "Manage account"],
      ["/nowhere", "Page not found"],
    ] as const) {
      act(() => history.push(path));
      const h1 = await pageHeading(heading);
      expect(screen.getAllByRole("heading", { level: 1 })).toEqual([h1]);
      expect(h1).toHaveAttribute("tabindex", "-1");
    }
  });

  it("activating the current page's link adds no history entry and moves no focus", async () => {
    const { history } = renderApp({}, account, "/packs");
    const user = userEvent.setup();
    await pageHeading("Packs");
    const packs = within(mainNav()).getByRole("link", { name: "Packs" });
    await user.click(packs);
    expect(packs).toHaveFocus();
    expect(history.length).toBe(1);
    await user.click(screen.getByRole("link", { name: "Anime TCG" }));
    expect(history.length).toBe(1);
    expect(screen.getByRole("link", { name: "Anime TCG" })).toHaveFocus();
  });

  it("the skip link is the first stop and moves focus to the h1 without changing the address", async () => {
    const { history } = renderApp({}, account, "/collection");
    const user = userEvent.setup();
    const heading = await pageHeading("Collection");
    await user.tab();
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveFocus();
    await user.click(skip);
    expect(heading).toHaveFocus();
    expect(history.location.pathname).toBe("/collection");
    expect(history.location.hash).toBe("");
    expect(history.length).toBe(1);
  });
});

describe("the header (§3.5, §7)", () => {
  it("signed in: Packs, Shop, Market and Collection in order, the current one marked, the wordmark to /packs and never marked", async () => {
    const { history } = renderApp({}, account, "/packs");
    await pageHeading("Packs");
    const links = within(mainNav()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Packs", "Shop", "Market", "Collection (0)"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/packs",
      "/shop",
      "/market",
      "/collection",
    ]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["page", null, null, null]);
    const wordmark = screen.getByRole("link", { name: "Anime TCG" });
    expect(wordmark).toHaveAttribute("href", "/packs");
    expect(wordmark).not.toHaveAttribute("aria-current");

    act(() => history.push("/collection"));
    await pageHeading("Collection");
    expect(
      within(mainNav())
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-current")),
    ).toEqual([null, null, null, "page"]);

    act(() => history.push("/shop"));
    await pageHeading("Shop");
    expect(
      within(mainNav())
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-current")),
    ).toEqual([null, "page", null, null]);

    act(() => history.push("/market"));
    await pageHeading("Market");
    expect(
      within(mainNav())
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-current")),
    ).toEqual([null, null, "page", null]);

    act(() => history.push("/account"));
    await pageHeading("Manage account");
    expect(within(mainNav()).queryByRole("link", { current: "page" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /^Account menu/ }));
    expect(screen.getByRole("menuitem", { name: "Manage account" })).toHaveAttribute("aria-current", "page");
  });

  it("the page links stay marked on a query string, which the app never reads", async () => {
    renderApp({}, account, "/collection?view=grid");
    await pageHeading("Collection");
    expect(within(mainNav()).getByRole("link", { name: "Collection (0)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("signed out: the wordmark to /, Log in and Register, the current one marked", async () => {
    const { history } = renderApp(signedOut, account, "/login");
    await pageHeading("Log in");
    expect(screen.getByRole("link", { name: "Anime TCG" })).toHaveAttribute("href", "/");
    const links = within(mainNav()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Log in", "Register"]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["page", null]);
    act(() => history.push("/"));
    await pageHeading("Anime TCG");
    expect(within(mainNav()).queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  });

  it("Manage account in the menu goes to the /account page", async () => {
    const { history } = renderApp({}, account, "/packs");
    const user = userEvent.setup();
    await pageHeading("Packs");
    await user.click(screen.getByRole("button", { name: /^Account menu/ }));
    const manage = screen.getByRole("menuitem", { name: "Manage account" });
    expect(manage).toHaveAttribute("href", "/account");
    await user.click(manage);
    const heading = await pageHeading("Manage account");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(history.location.pathname).toBe("/account");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("the profile placeholder (§4.6)", () => {
  it("is reachable by its address only, and links to the collection", async () => {
    renderApp({}, account, "/profile");
    await pageHeading("Profile");
    expect(screen.getByText("Your profile isn't here yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your collection" })).toHaveAttribute(
      "href",
      "/collection",
    );
    expect(screen.queryByRole("link", { name: "Profile" })).not.toBeInTheDocument();
  });
});
