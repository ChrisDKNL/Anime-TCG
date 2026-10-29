import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { AccountButton, AccountControl } from "./AccountControl";

function setup(disabled = false) {
  const onManage = vi.fn();
  const onLogout = vi.fn();
  renderWithProviders(
    <>
      <AccountControl login="Chris" disabled={disabled} onManage={onManage} onLogout={onLogout} />
      <button type="button">after</button>
    </>,
  );
  const control = screen.getByRole("button", { name: "Account menu. Signed in as Chris" });
  return { control, onManage, onLogout, user: userEvent.setup() };
}

function items() {
  return screen.getAllByRole("menuitem");
}

describe("AccountControl", () => {
  it("is a menu button showing the login, closed by default", () => {
    const { control } = setup();
    expect(control).toHaveAttribute("aria-haspopup", "menu");
    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(control).toHaveAttribute("aria-controls", "account-menu");
    expect(screen.getByText("Chris")).toHaveAttribute("title", "Chris");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is disabled while a pack opens", () => {
    const { control } = setup(true);
    expect(control).toBeDisabled();
  });

  it("click opens on the first item; the items are Manage account… and Log out", async () => {
    const { control, user } = setup();
    await user.click(control);
    expect(control).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Account menu. Signed in as Chris" });
    expect(menu).toHaveAttribute("id", "account-menu");
    expect(items().map((item) => item.textContent)).toEqual(["Manage account…", "Log out"]);
    expect(items()[0]).toHaveFocus();
    expect(items()[0]).toHaveAttribute("tabindex", "0");
    expect(items()[1]).toHaveAttribute("tabindex", "-1");
  });

  it("Enter and Space open on the first item, ArrowUp opens on the last", async () => {
    const { control, user } = setup();
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
    const { control, user } = setup();
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
    const { control, user, onLogout, onManage } = setup();
    control.focus();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(onManage).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(control);
    await user.click(screen.getByRole("menuitem", { name: "Manage account…" }));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it("Tab closes and moves on past the button", async () => {
    const { control, user } = setup();
    await user.click(control);
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  });

  it("clicking outside closes", async () => {
    const { control, user } = setup();
    await user.click(control);
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(control).toHaveAttribute("aria-expanded", "false");
  });
});

describe("AccountButton", () => {
  it("is a plain button named Account", async () => {
    const onClick = vi.fn();
    render(<AccountButton onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Account" });
    expect(button).not.toHaveAttribute("aria-haspopup");
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
