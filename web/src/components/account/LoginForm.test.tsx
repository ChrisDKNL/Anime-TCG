import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { envelope, makeAccount, mockFetch, sentBody } from "../../test/api";
import { renderWithProviders } from "../../test/render";
import { LoginForm } from "./LoginForm";
import { fill } from "../../test/user";

const account = makeAccount({ login: "Chris" });

function setup(
  routes: Parameters<typeof mockFetch>[0],
  props: Partial<ComponentProps<typeof LoginForm>> = {},
) {
  const fetchMock = mockFetch(routes);
  const onLoggedIn = vi.fn();
  const rendered = renderWithProviders(<LoginForm onLoggedIn={onLoggedIn} {...props} />);
  return { fetchMock, onLoggedIn, user: userEvent.setup(), ...rendered };
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, login = "chris", password = "pw") {
  await fill(user, screen.getByLabelText("Login"), login);
  await fill(user, screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("LoginForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("is the page's h1, focusable by the page change only, and shows the forgotten-password line", () => {
    setup({});
    const heading = screen.getByRole("heading", { level: 1, name: "Log in" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    // The page change focuses it (router.tsx); a first render leaves focus alone (navigation spec §3.6).
    expect(heading).not.toHaveFocus();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "There is no way to recover a forgotten password yourself. Ask the owner to set a new one.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Login")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("empty fields are client-side errors, no request", async () => {
    const { user, fetchMock } = setup({});
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Enter your login.",
      "Enter your password.",
    ]);
    expect(screen.getByLabelText("Login")).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs in with the trimmed login and reports the account", async () => {
    const { user, fetchMock, onLoggedIn } = setup({
      "POST /api/session/login": { status: 200, body: { signedIn: true, account } },
    });
    await fillAndSubmit(user, " chris ", "pw with spaces ");
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith(account));
    expect(sentBody(fetchMock)).toEqual({ login: "chris", password: "pw with spaces " });
  });

  it("incorrect: both fields invalid, one message, password cleared, focus on Login", async () => {
    const { user } = setup({ "POST /api/session/login": envelope(401, "bad_credentials") });
    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Login or password is incorrect.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByLabelText("Login")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Login")).toHaveFocus();
  });

  it("unreachable: in-form banner, values kept", async () => {
    const { user } = setup({ "POST /api/session/login": { status: 503, raw: "" } });
    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach the game server. Nothing was changed. Try again.",
    );
    expect(screen.getByLabelText("Password")).toHaveValue("pw");
  });

  it("counts the server's wait down on the button and announces the end once", async () => {
    // Only the countdown's clock is faked; TanStack and user-event keep their real setTimeout.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { user, fetchMock } = setup({ "POST /api/session/login": envelope(429, "too_many_failures", 10) });
    await fillAndSubmit(user);

    const button = await screen.findByRole("button", { name: "Try again in 10 s" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveClass("tabular-nums");
    const breather = screen.getByText(
      "Five misses in a row. Take ten seconds, check the spelling of your login and whether caps lock is on, then try again.",
    );
    expect(breather).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("Password")).toHaveValue("pw");
    expect(screen.getByLabelText("Password")).not.toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("button", { name: "Try again in 9 s" })).toHaveAttribute("aria-disabled", "true");
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByRole("button", { name: "Try again in 1 s" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("You can try again now.")).not.toBeInTheDocument();
    // Enter in a field while waiting sends nothing: the blocked button cancels implicit submission.
    await user.type(screen.getByLabelText("Password"), "{Enter}");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("button", { name: "Log in" })).not.toHaveAttribute("aria-disabled");
    const announced = screen.getAllByText("You can try again now.");
    expect(announced).toHaveLength(1);
    expect(announced[0]).toHaveAttribute("role", "status");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getAllByText("You can try again now.")).toHaveLength(1);
  });

  it("in flight: the button is aria-disabled but not disabled, keeps focus, and sends one request", async () => {
    const { user, fetchMock } = setup({});
    let answer = (_response: Response) => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    await fill(user, screen.getByLabelText("Login"), "chris");
    await fill(user, screen.getByLabelText("Password"), "pw");
    const button = screen.getByRole("button", { name: "Log in" });
    button.focus();
    await user.keyboard("{Enter}");

    const pending = await screen.findByRole("button", { name: "Logging in…" });
    expect(pending).toBe(button);
    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(pending).not.toBeDisabled();
    expect(pending).toHaveFocus();
    expect(screen.getByLabelText("Login")).toBeDisabled();
    await user.click(pending);
    await user.keyboard("{Enter}");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer(new Response(null, { status: 503 }));
      await Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach the game server. Nothing was changed. Try again.",
    );
    expect(screen.getByRole("button", { name: "Log in" })).toHaveFocus();
  });

  it("two activations in one task send one request", async () => {
    const { user, fetchMock } = setup({ "POST /api/session/login": envelope(401, "bad_credentials") });
    await fill(user, screen.getByLabelText("Login"), "chris");
    await fill(user, screen.getByLabelText("Password"), "pw");
    const button = screen.getByRole("button", { name: "Log in" });
    act(() => {
      button.click();
      button.click();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Login or password is incorrect.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("without retryAfterSeconds the breather shows but no wait is invented", async () => {
    const { user } = setup({ "POST /api/session/login": envelope(429, "too_many_failures") });
    await fillAndSubmit(user);
    expect(await screen.findByText(/Five misses in a row/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).not.toHaveAttribute("aria-disabled");
  });

  it("shows the guard line under the heading and the cross-link before the forgotten-password line", () => {
    setup({}, { guardLine: "Log in to see your collection.", crossLink: <p>No account yet? Register</p> });
    const texts = Array.from(document.querySelectorAll("h1, p"), (element) => element.textContent);
    expect(texts.indexOf("Log in to see your collection.")).toBe(texts.indexOf("Log in") + 1);
    expect(texts.indexOf("No account yet? Register")).toBe(
      texts.indexOf(
        "There is no way to recover a forgotten password yourself. Ask the owner to set a new one.",
      ) - 1,
    );
  });

  it("shows no guard line without one", () => {
    setup({});
    expect(screen.queryByText(/^Log in to /)).not.toBeInTheDocument();
  });
});
