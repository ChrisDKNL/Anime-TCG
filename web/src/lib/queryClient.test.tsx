import { onlineManager } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "../components/account/LoginForm";
import { ManageAccountDialog } from "../components/account/ManageAccountDialog";
import { makeAccount } from "../test/api";
import { renderWithProviders } from "../test/render";
import { banners } from "./copy";

/** What `fetch` does with the network gone. */
function stubOfflineFetch() {
  const fetchMock = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function goOffline() {
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
}

describe("query client after the browser reports offline", () => {
  beforeEach(() => {
    stubOfflineFetch();
  });

  afterEach(() => {
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    vi.unstubAllGlobals();
  });

  it("Log in still sends, fails and shows the unreachable-form banner; nothing is paused", async () => {
    const { queryClient } = renderWithProviders(<LoginForm onBack={vi.fn()} onLoggedIn={vi.fn()} />);
    goOffline();
    expect(onlineManager.isOnline()).toBe(false);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Login"), "chris");
    await user.type(screen.getByLabelText("Password"), "a password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(banners.unreachableForm);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      queryClient
        .getMutationCache()
        .getAll()
        .filter((m) => m.state.isPaused),
    ).toEqual([]);
  });

  it("Delete still sends, fails and shows the unreachable-form banner; nothing is paused", async () => {
    const { queryClient } = renderWithProviders(
      <ManageAccountDialog
        open
        account={makeAccount({ login: "Chris" })}
        onClose={vi.fn()}
        onRenamed={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    goOffline();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete account…" }));
    await user.type(screen.getByLabelText("Password"), "a password");
    await user.click(screen.getByRole("button", { name: "Delete Chris" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(banners.unreachableForm);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      queryClient
        .getMutationCache()
        .getAll()
        .filter((m) => m.state.isPaused),
    ).toEqual([]);
  });
});

describe("query client mutation cache", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops a finished mutation, and the password in its variables, once its form unmounts", async () => {
    stubOfflineFetch();
    const { queryClient, unmount } = renderWithProviders(<LoginForm onBack={vi.fn()} onLoggedIn={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Login"), "chris");
    await user.type(screen.getByLabelText("Password"), "a password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("alert");
    expect(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state.variables),
    ).toEqual([{ login: "chris", password: "a password" }]);

    unmount();
    await vi.waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]));
  });
});
