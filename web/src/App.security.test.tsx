import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAccount } from "./test/api";
import { renderApp } from "./test/app";

/**
 * T1 (docs/05-security.md): whatever login the server returns is rendered as
 * text wherever it appears, never as markup, and one-line renderings carry a
 * `title` so a truncated login is still readable in full.
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

    const control = await screen.findByRole("button", { name: `Account menu. Signed in as ${login}` });
    const headerLogin = within(control).getByTitle(login);
    expect(headerLogin).toHaveTextContent(login);
    expect(control.querySelector("img")).toBeNull();
    expect(document.querySelectorAll("[onerror]")).toHaveLength(0);
    expect(document.title).toBe(`${login} · Anime TCG`);

    await user.click(control);
    await user.click(screen.getByRole("menuitem", { name: "Manage account…" }));
    const dialog = screen.getByRole("dialog", { name: "Manage account" });
    const dialogLogin = within(dialog).getByTitle(login);
    expect(dialogLogin.textContent).toBe(login);
    expect(dialog.querySelector("img")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete account…" }));
    const heading = screen.getByRole("heading", { name: `Delete ${login}?` });
    expect(heading.textContent).toBe(`Delete ${login}?`);
    expect(heading.children).toHaveLength(0);
    expect(screen.getByRole("button", { name: `Delete ${login}` })).toBeDisabled();
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });
});
