import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_QUERY_KEY } from "../../hooks/useAccountSession";
import { envelope, makeAccount, mockFetch, noContent, sentBody } from "../../test/api";
import { renderWithProviders } from "../../test/render";
import { RegisterForm } from "./RegisterForm";

const account = makeAccount({ login: "Chris" });

function setup(routes: Parameters<typeof mockFetch>[0]) {
  const fetchMock = mockFetch(routes);
  const onBack = vi.fn();
  const onRegistered = vi.fn();
  const rendered = renderWithProviders(<RegisterForm onBack={onBack} onRegistered={onRegistered} />);
  return { fetchMock, onBack, onRegistered, user: userEvent.setup(), ...rendered };
}

async function toStep2(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Invite code"), " local-dev-invite ");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Step 2 of 2");
}

const UNREACHABLE_FORM = "Couldn't reach the game server. Nothing was changed. Try again.";

async function fillStep2AndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Login"), "Chris");
  await user.type(screen.getByLabelText("Password"), "a strong one");
  await user.type(screen.getByLabelText("Confirm password"), "a strong one");
  await user.click(screen.getByRole("button", { name: "Register" }));
}

describe("RegisterForm step 1", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("focuses its heading on entry and describes it with the step", () => {
    setup({});
    const heading = screen.getByRole("heading", { name: "Register" });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAccessibleDescription("Step 1 of 2");
    expect(screen.getByLabelText("Invite code")).toHaveAccessibleDescription(
      "Ask the owner for a code. Codes are not case-sensitive.",
    );
  });

  it("an empty code is a client-side error with focus on the field and no request", async () => {
    const { user, fetchMock } = setup({});
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const field = screen.getByLabelText("Invite code");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an invite code.");
    expect(field).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the trimmed code and moves to step 2 with focus on Login", async () => {
    const { user, fetchMock } = setup({ "POST /api/accounts/check-invite": noContent });
    await toStep2(user);
    expect(sentBody(fetchMock)).toEqual({ inviteCode: "local-dev-invite" });
    expect(screen.getByLabelText("Login")).toHaveFocus();
    expect(
      screen.getByText("8 to 128 characters. Letters, numbers, spaces and symbols are all fine."),
    ).toBeVisible();
  });

  it("shows the server's invalid-code answer on the field", async () => {
    const { user } = setup({ "POST /api/accounts/check-invite": envelope(403, "invite_invalid") });
    await user.type(screen.getByLabelText("Invite code"), "nope");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That invite code isn't valid.");
    expect(screen.getByLabelText("Invite code")).toHaveFocus();
    expect(screen.getByLabelText("Invite code")).toHaveValue("nope");
  });

  it("replaces the body with the cap message and Back", async () => {
    const { user, onBack } = setup({ "POST /api/accounts/check-invite": envelope(403, "cap_reached") });
    await user.type(screen.getByLabelText("Invite code"), "code");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "All 10 places are taken for now. Ask the owner to make room.",
    );
    expect(screen.queryByLabelText("Invite code")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows the in-form banner when the server is unreachable and keeps the value", async () => {
    const { user } = setup({ "POST /api/accounts/check-invite": { status: 502, raw: "bad gateway" } });
    await user.type(screen.getByLabelText("Invite code"), "code");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach the game server. Nothing was changed. Try again.",
    );
    expect(screen.getByLabelText("Invite code")).toHaveValue("code");
  });

  it("Back on step 1 returns to the choice", async () => {
    const { user, onBack } = setup({});
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("RegisterForm step 2", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks every invalid field and focuses the first in DOM order", async () => {
    const { user, fetchMock } = setup({ "POST /api/accounts/check-invite": noContent });
    await toStep2(user);
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Register" }));

    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual([
      "Choose a login.",
      "Keep the password between 8 and 128 characters.",
      "The passwords don't match.",
    ]);
    expect(screen.getByLabelText("Login")).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveValue("short");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports login length and empty password", async () => {
    const { user } = setup({ "POST /api/accounts/check-invite": noContent });
    await toStep2(user);
    await user.type(screen.getByLabelText("Login"), "ab");
    await user.click(screen.getByRole("button", { name: "Register" }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Keep the login between 3 and 24 characters.",
      "Choose a password.",
    ]);
  });

  it("registers with the trimmed login and reports the account", async () => {
    const { user, fetchMock, onRegistered, queryClient } = setup({
      "POST /api/accounts/check-invite": noContent,
      "POST /api/accounts/register": { status: 201, body: { signedIn: true, account } },
    });
    await toStep2(user);
    await user.type(screen.getByLabelText("Login"), "  Chris ");
    await user.type(screen.getByLabelText("Password"), "a strong one");
    await user.type(screen.getByLabelText("Confirm password"), "a strong one");
    await user.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(account));
    expect(sentBody(fetchMock, 1)).toEqual({
      inviteCode: "local-dev-invite",
      login: "Chris",
      password: "a strong one",
    });
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ signedIn: true, account });
  });

  it("a taken login names the clash and focuses Login", async () => {
    const { user } = setup({
      "POST /api/accounts/check-invite": noContent,
      "POST /api/accounts/register": envelope(409, "login_taken"),
    });
    await toStep2(user);
    await user.type(screen.getByLabelText("Login"), "Chris");
    await user.type(screen.getByLabelText("Password"), "a strong one");
    await user.type(screen.getByLabelText("Confirm password"), "a strong one");
    await user.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('The login "Chris" is already taken.');
    expect(screen.getByLabelText("Login")).toHaveFocus();
  });

  it("a code rejected at submit goes back to step 1 with the error, keeping the login", async () => {
    const { user } = setup({
      "POST /api/accounts/check-invite": noContent,
      "POST /api/accounts/register": envelope(403, "invite_invalid"),
    });
    await toStep2(user);
    await user.type(screen.getByLabelText("Login"), "Chris");
    await user.type(screen.getByLabelText("Password"), "a strong one");
    await user.type(screen.getByLabelText("Confirm password"), "a strong one");
    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("That invite code isn't valid.");
    expect(screen.getByLabelText("Invite code")).toHaveFocus();
    expect(screen.getByLabelText("Invite code")).toHaveValue(" local-dev-invite ");

    // Back to step 2 (after a successful re-check) still has the login filled.
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText("Login")).toHaveValue("Chris");
  });

  it("no answer at submit shows the in-form banner on step 2 and keeps the values", async () => {
    const { user, onRegistered } = setup({
      "POST /api/accounts/check-invite": noContent,
      "POST /api/accounts/register": { status: 502, raw: "bad gateway" },
    });
    await toStep2(user);
    await fillStep2AndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(UNREACHABLE_FORM);
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Login")).toHaveValue("Chris");
    expect(screen.getByLabelText("Password")).toHaveValue("a strong one");
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it("a validation_failed answer at submit is the login-length message on Login", async () => {
    const { user } = setup({
      "POST /api/accounts/check-invite": noContent,
      "POST /api/accounts/register": envelope(400, "validation_failed"),
    });
    await toStep2(user);
    await fillStep2AndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Keep the login between 3 and 24 characters.");
    expect(screen.getByLabelText("Login")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Login")).toHaveFocus();
  });

  it("the cap reached between the steps replaces the body with the cap message", async () => {
    const { user } = setup({
      "POST /api/accounts/check-invite": noContent,
      "POST /api/accounts/register": envelope(403, "cap_reached"),
    });
    await toStep2(user);
    await fillStep2AndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "All 10 places are taken for now. Ask the owner to make room.",
    );
    expect(screen.queryByLabelText("Login")).not.toBeInTheDocument();
  });

  it("any other server answer at submit shows the in-form banner", async () => {
    const { user } = setup({
      "POST /api/accounts/check-invite": noContent,
      "POST /api/accounts/register": envelope(500, "internal"),
    });
    await toStep2(user);
    await fillStep2AndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(UNREACHABLE_FORM);
  });

  it("Back keeps the code and focuses it", async () => {
    const { user } = setup({ "POST /api/accounts/check-invite": noContent });
    await toStep2(user);
    await user.click(screen.getByRole("button", { name: "Back" }));
    const code = screen.getByLabelText("Invite code");
    expect(code).toHaveValue(" local-dev-invite ");
    expect(code).toHaveFocus();
  });

  it("Show/Hide toggles reveal without moving focus or clearing", async () => {
    const { user } = setup({ "POST /api/accounts/check-invite": noContent });
    await toStep2(user);
    const password = screen.getByLabelText("Password");
    await user.type(password, "secret-ish");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("secret-ish");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Show password confirmation" })).toBeInTheDocument();
  });
});
