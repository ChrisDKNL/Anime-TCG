import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_QUERY_KEY } from "../../hooks/useAccountSession";
import { envelope, makeAccount, mockFetch, noContent, rateLimited, sentBody } from "../../test/api";
import { renderWithProviders } from "../../test/render";
import { RegisterForm } from "./RegisterForm";
import { fill } from "../../test/user";
import { expectRateLimitedWait, RATE_LIMITED } from "../../test/waits";

const account = makeAccount({ login: "Chris" });

const CROSS_LINK = "Already registered? Log in";

function setup(routes: Parameters<typeof mockFetch>[0]) {
  const fetchMock = mockFetch(routes);
  const onRegistered = vi.fn();
  const rendered = renderWithProviders(
    <RegisterForm onRegistered={onRegistered} crossLink={<p>{CROSS_LINK}</p>} />,
  );
  return { fetchMock, onRegistered, user: userEvent.setup(), ...rendered };
}

async function toStep2(user: ReturnType<typeof userEvent.setup>) {
  await fill(user, screen.getByLabelText("Invite code"), " local-dev-invite ");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Step 2 of 2");
}

const UNREACHABLE_FORM = "Couldn't reach the game server. Nothing was changed. Try again.";

function liveRegion() {
  return screen.getAllByRole("status").find((el) => el.hasAttribute("aria-live"))!;
}

async function fillStep2AndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await fill(user, screen.getByLabelText("Login"), "Chris");
  await fill(user, screen.getByLabelText("Password"), "a strong one");
  await fill(user, screen.getByLabelText("Confirm password"), "a strong one");
  await user.click(screen.getByRole("button", { name: "Register" }));
}

describe("RegisterForm step 1", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is the page's h1, described by the step, with no Back and the cross-link under the form", () => {
    setup({});
    const heading = screen.getByRole("heading", { level: 1, name: "Register" });
    // The page change focuses it (router.tsx); a first render leaves focus alone (navigation spec §3.6).
    expect(heading).not.toHaveFocus();
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveAccessibleDescription("Step 1 of 2");
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.getByText(CROSS_LINK)).toBeInTheDocument();
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
    await fill(user, screen.getByLabelText("Invite code"), "nope");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That invite code isn't valid.");
    expect(screen.getByLabelText("Invite code")).toHaveFocus();
    expect(screen.getByLabelText("Invite code")).toHaveValue("nope");
  });

  it("replaces the body with the cap message; no Back, the cross-link stays", async () => {
    const { user } = setup({ "POST /api/accounts/check-invite": envelope(403, "cap_reached") });
    await fill(user, screen.getByLabelText("Invite code"), "code");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "All 10 places are taken for now. Ask the owner to make room.",
    );
    expect(screen.queryByLabelText("Invite code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(CROSS_LINK)).toBeInTheDocument();
  });

  it("shows the in-form banner when the server is unreachable and keeps the value", async () => {
    const { user } = setup({ "POST /api/accounts/check-invite": { status: 502, raw: "bad gateway" } });
    await fill(user, screen.getByLabelText("Invite code"), "code");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach the game server. Nothing was changed. Try again.",
    );
    expect(screen.getByLabelText("Invite code")).toHaveValue("code");
  });
});

describe("RegisterForm step 2", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks every invalid field and focuses the first in DOM order", async () => {
    const { user, fetchMock } = setup({ "POST /api/accounts/check-invite": noContent });
    await toStep2(user);
    await fill(user, screen.getByLabelText("Password"), "short");
    await fill(user, screen.getByLabelText("Confirm password"), "different");
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
    await fill(user, screen.getByLabelText("Login"), "  Chris ");
    await fill(user, screen.getByLabelText("Password"), "a strong one");
    await fill(user, screen.getByLabelText("Confirm password"), "a strong one");
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
    await fill(user, screen.getByLabelText("Login"), "Chris");
    await fill(user, screen.getByLabelText("Password"), "a strong one");
    await fill(user, screen.getByLabelText("Confirm password"), "a strong one");
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
    await fill(user, screen.getByLabelText("Login"), "Chris");
    await fill(user, screen.getByLabelText("Password"), "a strong one");
    await fill(user, screen.getByLabelText("Confirm password"), "a strong one");
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(CROSS_LINK)).toBeInTheDocument();
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
    await fill(user, password, "secret-ish");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("secret-ish");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Show password confirmation" })).toBeInTheDocument();
  });
});

describe("RegisterForm rate limited (manager decision, 2026-10-30)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("step 1: Retry-After's seconds on Continue, the code kept, then Continue again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { user, fetchMock } = setup({ "POST /api/accounts/check-invite": rateLimited("3") });
    await fill(user, screen.getByLabelText("Invite code"), "code");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expectRateLimitedWait(await screen.findByRole("button", { name: "Try again in 3 s" }));
    expect(screen.getByLabelText("Invite code")).toHaveValue("code");
    expect(screen.getByLabelText("Invite code")).not.toBeDisabled();
    await user.type(screen.getByLabelText("Invite code"), "{Enter}");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("button", { name: "Continue" })).not.toHaveAttribute("aria-disabled");
    expect(liveRegion()).toHaveTextContent("You can try again now.");
  });

  it("step 1: without Retry-After the wait is 60 s", async () => {
    const { user } = setup({ "POST /api/accounts/check-invite": rateLimited() });
    await fill(user, screen.getByLabelText("Invite code"), "code");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expectRateLimitedWait(await screen.findByRole("button", { name: "Try again in 60 s" }));
  });

  it("step 2: Retry-After's seconds on Register, every field kept", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { user } = setup({
      "POST /api/accounts/check-invite": noContent,
      "POST /api/accounts/register": rateLimited("2"),
    });
    await toStep2(user);
    await fillStep2AndSubmit(user);
    expectRateLimitedWait(await screen.findByRole("button", { name: "Try again in 2 s" }));
    expect(screen.getByLabelText("Login")).toHaveValue("Chris");
    expect(screen.getByLabelText("Password")).toHaveValue("a strong one");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("a strong one");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Register" })).not.toHaveAttribute("aria-disabled");
    expect(liveRegion()).toHaveTextContent("You can try again now.");
  });

  it("step 2: without Retry-After the wait is 60 s, and it is not the invite check's wait", async () => {
    const { user } = setup({
      "POST /api/accounts/check-invite": noContent,
      "POST /api/accounts/register": rateLimited(),
    });
    await toStep2(user);
    await fillStep2AndSubmit(user);
    expectRateLimitedWait(await screen.findByRole("button", { name: "Try again in 60 s" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Continue" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(RATE_LIMITED)).not.toBeInTheDocument();
  });
});
