import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { makeAniListResponse } from "./test/fixtures";

/**
 * Budget for async queries that race real timers (the 350 ms pack-reveal delay
 * in App.tsx) or React's passive-effect flush. Testing Library's default is
 * 1000 ms, which a loaded machine running Vitest files in parallel can blow
 * through: 350 ms + jsdom render + scheduler jitter was measured at >1 s under
 * CPU contention. Fake timers are deliberately not used here — `waitFor`
 * polling stalls under Vitest's fake clock.
 */
const ASYNC_TIMEOUT = 5_000;
/** Per-test ceiling; must exceed the sum of the async waits above. */
const TEST_TIMEOUT = 20_000;

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

  it(
    "loads the pool, opens a pack of 5 and adds it to the collection",
    async () => {
      const fetchMock = mockAniList(makeAniListResponse(12));
      const user = userEvent.setup();
      render(<App />);

      const button = screen.getByRole("button", { name: /open booster pack/i });
      expect(button).toBeDisabled();
      await waitFor(() => expect(button).toBeEnabled(), { timeout: ASYNC_TIMEOUT });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await user.click(button);

      // The pack reveal is delayed ~350 ms (real timers) for effect.
      const cards = await screen.findAllByRole("article", {}, { timeout: ASYNC_TIMEOUT });
      expect(cards).toHaveLength(5);

      // The reveal grid, the "New" badges and the tab counter all come from the
      // same batched state update as the cards, so they are in the DOM together.
      expect(screen.getAllByText("New")).toHaveLength(5);
      expect(screen.getByRole("button", { name: /collection \(5\)/i })).toBeInTheDocument();

      // Persistence is a passive `useEffect` in useInventory, which React flushes
      // *after* the commit that findAllByRole observed. Reading localStorage
      // synchronously here raced that flush and came back empty under load.
      await waitFor(
        () => expect(JSON.parse(localStorage.getItem("anime-tcg:inventory:v1") ?? "[]")).toHaveLength(5),
        { timeout: ASYNC_TIMEOUT },
      );
    },
    TEST_TIMEOUT,
  );

  it(
    "shows an error with a retry button when AniList fails",
    async () => {
      mockAniList({ errors: [{ message: "Too Many Requests" }] }, 429);
      render(<App />);
      // No artificial delay on this path, but it is still an async render under
      // the same parallel-file load, so give it the same budget.
      const alert = await screen.findByRole("alert", {}, { timeout: ASYNC_TIMEOUT });
      expect(alert).toHaveTextContent(/rate limit/i);
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /open booster pack/i })).toBeDisabled();
    },
    TEST_TIMEOUT,
  );
});
