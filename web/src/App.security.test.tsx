import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAccount, noContent } from "./test/api";
import { liveRegion, renderApp } from "./test/app";
import { fill } from "./test/user";

/**
 * T1 (docs/05-security.md): whatever login the server returns is rendered as
 * text wherever it appears, never as markup, and one-line renderings carry a
 * `title` so a truncated login is still readable in full. Wherever the login
 * sits inside a sentence or heading it is isolated in <bdi>, so a right-to-left
 * override in it cannot reorder the words around it.
 */
const HOSTILE_LOGINS: Array<[string, string]> = [
  ["markup", "<img src=x onerror=alert(1)>"],
  ["RTL override, 24 characters", `‮${"a".repeat(22)}‬`],
  ["200 characters", "x".repeat(200)],
];

describe.each(HOSTILE_LOGINS)("a hostile login (%s)", (_name, login) => {
  afterEach(() => vi.unstubAllGlobals());

  it("is text in the header, the dialog header and the delete heading", async () => {
    renderApp({}, makeAccount({ login }));
    const user = userEvent.setup();

    const control = await screen.findByRole("button", {
      name: `Account menu. Signed in as \u2068${login}\u2069`,
    });
    const headerLogin = within(control).getByTitle(login);
    expect(headerLogin).toHaveTextContent(login);
    expect(control.querySelector("img")).toBeNull();
    expect(document.querySelectorAll("[onerror]")).toHaveLength(0);
    expect(document.title).toBe(`\u2068${login}\u2069 · Anime TCG`);

    await user.click(control);
    await user.click(screen.getByRole("menuitem", { name: "Manage account…" }));
    const dialog = screen.getByRole("dialog", { name: "Manage account" });
    const dialogLogin = within(dialog).getByTitle(login);
    expect(dialogLogin.textContent).toBe(login);
    expect(dialog.querySelector("img")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete account…" }));
    const heading = screen.getByRole("heading", { name: `Delete ${login}?` });
    expect(heading.textContent).toBe(`Delete ${login}?`);
    expect(onlyBdi(heading).textContent).toBe(login);
    expect(screen.getByRole("button", { name: `Delete ${login}` })).toBeDisabled();
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });
});

/** The element's single child, which must be a <bdi> holding nothing but text. */
function onlyBdi(element: Element): Element {
  expect(Array.from(element.children, (child) => child.tagName)).toEqual(["BDI"]);
  const [bdi] = element.children;
  expect(bdi?.children).toHaveLength(0);
  return bdi!;
}

describe("an RTL override login", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** U+202E without a closing U+202C: unisolated, it would reverse every character after it on the line. */
  const login = "‮gnp.exe";

  it("is isolated in <bdi> in the header, the delete heading, body and button, and the live region", async () => {
    renderApp({ "POST /api/account/delete": noContent }, makeAccount({ login, cards: 2 }));
    const user = userEvent.setup();

    const control = await screen.findByRole("button", {
      name: `Account menu. Signed in as \u2068${login}\u2069`,
    });
    const headerLogin = within(control).getByTitle(login);
    expect(headerLogin.tagName).toBe("BDI");
    expect(headerLogin.textContent).toBe(login);

    await user.click(control);
    await user.click(screen.getByRole("menuitem", { name: "Manage account…" }));
    expect(within(screen.getByRole("dialog")).getByTitle(login).tagName).toBe("BDI");
    await user.click(screen.getByRole("button", { name: "Delete account…" }));

    const dialog = screen.getByRole("dialog", { name: `Delete ${login}?` });
    expect(dialog).toHaveAccessibleDescription(
      `This permanently deletes ${login} and its 2 cards. There is no undo.`,
    );
    expect(onlyBdi(screen.getByRole("heading", { name: `Delete ${login}?` })).textContent).toBe(login);
    const body = document.getElementById("delete-body");
    expect(body?.textContent).toBe(`This permanently deletes ${login} and its 2 cards. There is no undo.`);
    expect(onlyBdi(body!).textContent).toBe(login);
    const remove = screen.getByRole("button", { name: `Delete ${login}` });
    expect(onlyBdi(remove).textContent).toBe(login);

    await fill(user, screen.getByLabelText("Password"), "correct horse");
    await user.click(remove);
    await waitFor(() => expect(liveRegion()).toHaveTextContent(`Deleted ${login}.`));
    expect(liveRegion().textContent).toBe(`Deleted ${login}.`);
    expect(onlyBdi(liveRegion()).textContent).toBe(login);
  });
});
