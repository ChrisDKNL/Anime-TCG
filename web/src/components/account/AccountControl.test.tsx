import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInRouter } from "../../test/router";
import { AccountControl } from "./AccountControl";

/** Under a router, because `Manage account` is a link (navigation-and-landing.md \u00a73.4 step 1). */
async function setup({ disabled = false, path = "/packs" } = {}) {
  const onLogout = vi.fn();
  const { history } = renderInRouter(
    <>
      <AccountControl login="Chris" disabled={disabled} onLogout={onLogout} />
      <button type="button">after</button>
    </>,
    path,
  );
  const control = await screen.findByRole("button", { name: "Account menu. Signed in as \u2068Chris\u2069" });
  return { control, onLogout, history, user: userEvent.setup() };
}

function items() {
  return screen.getAllByRole("menuitem");
}

describe("AccountControl", () => {
  it("is a menu button showing the login, closed by default", async () => {
    const { control } = await setup();
    expect(control).toHaveAttribute("aria-haspopup", "menu");
    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(control).toHaveAttribute("aria-controls", "account-menu");
    expect(screen.getByText("Chris")).toHaveAttribute("title", "Chris");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is disabled while a pack opens", async () => {
    const { control } = await setup({ disabled: true });
    expect(control).toBeDisabled();
  });

  it("click opens on the first item; the items are Manage account and Log out", async () => {
    const { control, user } = await setup();
    await user.click(control);
    expect(control).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Account menu. Signed in as \u2068Chris\u2069" });
    expect(menu).toHaveAttribute("id", "account-menu");
    expect(items().map((item) => item.textContent)).toEqual(["Manage account", "Log out"]);
    expect(items()[0]).toHaveAttribute("href", "/account");
    expect(items()[0]).toHaveFocus();
    expect(items()[0]).toHaveAttribute("tabindex", "0");
    expect(items()[1]).toHaveAttribute("tabindex", "-1");
  });

  it("Enter and Space open on the first item, ArrowUp opens on the last", async () => {
    const { control, user } = await setup();
    control.focus();
    await user.keyboard("{Enter}");
    expect(items()[0]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(control).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.keyboard(" ");
    expect(items()[0]).toHaveFocus();
    await user.keyboard("{Escape}");

    await user.keyboard("{ArrowUp}");
    expect(items()[1]).toHaveFocus();
    await user.keyboard("{Escape}");

    await user.keyboard("{ArrowDown}");
    expect(items()[0]).toHaveFocus();
  });

  it("arrows move and wrap, Home and End jump", async () => {
    const { control, user } = await setup();
    control.focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    expect(items()[1]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items()[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(items()[1]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(items()[0]).toHaveFocus();
    await user.keyboard("{End}");
    expect(items()[1]).toHaveFocus();
  });

  it("Enter activates the focused item and closes", async () => {
    const { control, user, onLogout, history } = await setup();
    control.focus();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(history.location.pathname).toBe("/packs");

    control.focus();
    await user.keyboard("{Enter}{Enter}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(history.location.pathname).toBe("/account");
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("Space activates the Manage account link too", async () => {
    const { control, user, history } = await setup();
    control.focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(history.location.pathname).toBe("/account");
  });

  it("on /account the item is marked current; activating it stays put and returns focus to the button", async () => {
    const { control, user, history } = await setup({ path: "/account" });
    await user.click(control);
    const manage = screen.getByRole("menuitem", { name: "Manage account" });
    expect(manage).toHaveAttribute("aria-current", "page");
    await user.click(manage);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(control).toHaveFocus();
    expect(history.length).toBe(1);
  });

  it("Tab closes and moves on past the button", async () => {
    const { control, user } = await setup();
    await user.click(control);
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  });

  it("clicking outside closes", async () => {
    const { control, user } = await setup();
    await user.click(control);
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(control).toHaveAttribute("aria-expanded", "false");
  });
});
