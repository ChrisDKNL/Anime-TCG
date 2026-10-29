import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_QUERY_KEY } from "../../hooks/useAccountSession";
import { envelope, makeAccount, mockFetch, noContent, sentBody } from "../../test/api";
import { renderWithProviders } from "../../test/render";
import { ManageAccountDialog } from "./ManageAccountDialog";

const account = makeAccount({ login: "Chris", cards: 0, createdAt: "2026-10-28T09:30:00.000Z" });

function setup(routes: Parameters<typeof mockFetch>[0], overrides: Partial<typeof account> = {}) {
  const fetchMock = mockFetch(routes);
  const onClose = vi.fn();
  const onRenamed = vi.fn();
  const onDeleted = vi.fn();
  const rendered = renderWithProviders(
    <ManageAccountDialog
      open
      account={{ ...account, ...overrides }}
      onClose={onClose}
      onRenamed={onRenamed}
      onDeleted={onDeleted}
    />,
  );
  return { fetchMock, onClose, onRenamed, onDeleted, user: userEvent.setup(), ...rendered };
}

function liveRegion() {
  return screen.getAllByRole("status").find((el) => el.hasAttribute("aria-live"))!;
}

describe("ManageAccountDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens as a modal labelled by its heading, with the account header and three sections", () => {
    setup({});
    const dialog = screen.getByRole("dialog", { name: "Manage account" });
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByText("Chris")).toHaveAttribute("title", "Chris");
    expect(screen.getByText("No cards yet · Created 28 Oct 2026")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Login",
      "Password",
      "Delete account",
    ]);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("close button closes the dialog and reports it", async () => {
    const { user, onClose } = setup({});
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("Login section", () => {
    it("Save is enabled only once the login differs, and renaming updates the query and announces", async () => {
      const renamed = makeAccount({ login: "Chris2" });
      const { user, fetchMock, onRenamed, queryClient } = setup({
        "PATCH /api/account/login": { status: 200, body: { account: renamed } },
      });
      const field = screen.getByLabelText("New login");
      expect(field).toHaveValue("Chris");
      const save = screen.getByRole("button", { name: "Save" });
      expect(save).toBeDisabled();

      await user.type(field, " ");
      expect(save).toBeDisabled();
      await user.type(field, "2");
      expect(save).toBeEnabled();
      await user.click(save);

      await waitFor(() => expect(onRenamed).toHaveBeenCalledWith(renamed));
      expect(sentBody(fetchMock)).toEqual({ login: "Chris 2" });
      expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ signedIn: true, account: renamed });
    });

    it("validates length and shows a taken login", async () => {
      const { user } = setup({ "PATCH /api/account/login": envelope(409, "login_taken") });
      const field = screen.getByLabelText("New login");
      await user.clear(field);
      await user.type(field, "ab");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Keep the login between 3 and 24 characters.");
      expect(field).toHaveFocus();

      await user.type(field, "c");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent('The login "abc" is already taken.');
    });
  });

  describe("Password section", () => {
    it("validates on submit and focuses the first invalid field", async () => {
      const { user, fetchMock } = setup({});
      await user.type(screen.getByLabelText("New password"), "short");
      await user.click(screen.getByRole("button", { name: "Change password" }));
      expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
        "Enter your password.",
        "Keep the password between 8 and 128 characters.",
        "The passwords don't match.",
      ]);
      expect(screen.getByLabelText("Current password")).toHaveFocus();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("changes the password, clears the fields and announces", async () => {
      const { user, fetchMock } = setup({ "POST /api/account/change-password": noContent });
      await user.type(screen.getByLabelText("Current password"), "old one");
      await user.type(screen.getByLabelText("New password"), "a new long one");
      await user.type(screen.getByLabelText("Confirm new password"), "a new long one");
      await user.click(screen.getByRole("button", { name: "Change password" }));

      expect(await screen.findAllByText("Password changed.")).toHaveLength(2);
      expect(liveRegion()).toHaveTextContent("Password changed.");
      expect(screen.getByLabelText("Current password")).toHaveValue("");
      expect(screen.getByLabelText("New password")).toHaveValue("");
      expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
      expect(sentBody(fetchMock)).toEqual({ currentPassword: "old one", newPassword: "a new long one" });
    });

    it("a wrong current password is inline on that field and clears it", async () => {
      const { user } = setup({ "POST /api/account/change-password": envelope(403, "wrong_password") });
      await user.type(screen.getByLabelText("Current password"), "wrong");
      await user.type(screen.getByLabelText("New password"), "a new long one");
      await user.type(screen.getByLabelText("Confirm new password"), "a new long one");
      await user.click(screen.getByRole("button", { name: "Change password" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("That password is incorrect.");
      expect(screen.getByLabelText("Current password")).toHaveValue("");
      expect(screen.getByLabelText("Current password")).toHaveFocus();
      expect(screen.getByLabelText("New password")).toHaveValue("a new long one");
    });

    it("the server's wait counts down on the Change button", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
      const { user } = setup({ "POST /api/account/change-password": envelope(429, "too_many_failures", 3) });
      await user.type(screen.getByLabelText("Current password"), "wrong");
      await user.type(screen.getByLabelText("New password"), "a new long one");
      await user.type(screen.getByLabelText("Confirm new password"), "a new long one");
      await user.click(screen.getByRole("button", { name: "Change password" }));
      expect(await screen.findByRole("button", { name: "Try again in 3 s" })).toBeDisabled();
      expect(screen.getByText(/Five misses in a row/)).toHaveAttribute("role", "status");
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByRole("button", { name: "Change password" })).toBeEnabled();
      expect(liveRegion()).toHaveTextContent("You can try again now.");
    });
  });

  describe("Delete section", () => {
    it("replaces the body with the confirm panel; the delete button needs a password", async () => {
      const { user } = setup({}, { cards: 3 });
      await user.click(screen.getByRole("button", { name: "Delete account…" }));

      const dialog = screen.getByRole("dialog", { name: "Delete Chris?" });
      expect(dialog).toHaveAccessibleDescription(
        "This permanently deletes Chris and its 3 cards. There is no undo.",
      );
      expect(screen.queryByRole("heading", { name: "Manage account" })).not.toBeInTheDocument();
      const password = screen.getByLabelText("Password");
      expect(password).toHaveFocus();
      expect(password).toHaveAttribute("autocomplete", "current-password");
      const del = screen.getByRole("button", { name: "Delete Chris" });
      expect(del).toBeDisabled();
      await user.type(password, "x");
      expect(del).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("heading", { name: "Manage account" })).toBeInTheDocument();
    });

    it("Escape on the confirm panel goes back to the sections instead of closing", async () => {
      const { user, onClose } = setup({});
      await user.click(screen.getByRole("button", { name: "Delete account…" }));
      const dialog = screen.getByRole("dialog");
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      expect(screen.getByRole("heading", { name: "Manage account" })).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("a wrong password is inline and cleared; success signs out and reports the login", async () => {
      const { user, onDeleted, queryClient, fetchMock } = setup({
        "POST /api/account/delete": envelope(403, "wrong_password"),
      });
      queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true, account });
      await user.click(screen.getByRole("button", { name: "Delete account…" }));
      await user.type(screen.getByLabelText("Password"), "wrong");
      await user.click(screen.getByRole("button", { name: "Delete Chris" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("That password is incorrect.");
      expect(screen.getByLabelText("Password")).toHaveValue("");
      expect(screen.getByLabelText("Password")).toHaveFocus();

      fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
      await user.type(screen.getByLabelText("Password"), "right");
      await user.click(screen.getByRole("button", { name: "Delete Chris" }));
      await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("Chris"));
      expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ signedIn: false });
    });

    it("unreachable keeps the confirm panel with the in-form banner", async () => {
      const { user } = setup({ "POST /api/account/delete": { status: 502, raw: "" } });
      await user.click(screen.getByRole("button", { name: "Delete account…" }));
      await user.type(screen.getByLabelText("Password"), "pw");
      await user.click(screen.getByRole("button", { name: "Delete Chris" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Couldn't reach the game server. Nothing was changed. Try again.",
      );
      expect(screen.getByRole("heading", { name: "Delete Chris?" })).toBeInTheDocument();
    });
  });
});
