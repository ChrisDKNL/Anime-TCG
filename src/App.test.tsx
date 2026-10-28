import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { makeAniListResponse } from "./test/fixtures";

function mockAniList(body: unknown, status = 200) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the pool, opens a pack of 5 and adds it to the collection", async () => {
    const fetchMock = mockAniList(makeAniListResponse(12));
    const user = userEvent.setup();
    render(<App />);

    const button = screen.getByRole("button", { name: /open booster pack/i });
    expect(button).toBeDisabled();
    await waitFor(() => expect(button).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(button);

    // The pack reveal is delayed ~350ms for effect; findAllByRole polls up to 1s.
    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(5);
    expect(screen.getAllByText("New")).toHaveLength(5);
    expect(screen.getByRole("button", { name: /collection \(5\)/i })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("anime-tcg:inventory:v1") ?? "[]")).toHaveLength(5);
  });

  it("shows an error with a retry button when AniList fails", async () => {
    mockAniList({ errors: [{ message: "Too Many Requests" }] }, 429);
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/rate limit/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open booster pack/i })).toBeDisabled();
  });
});
