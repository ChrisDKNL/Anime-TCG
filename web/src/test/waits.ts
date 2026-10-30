import { screen } from "@testing-library/react";
import { expect } from "vitest";

/** accounts.md §8 "rate-limited": the one place the unit tests spell this copy. */
export const RATE_LIMITED = "That was a lot of tries in a short time. Give it a moment, then try again.";

/** The wait of accounts.md §4.4 on `button`, with the rate limiter's status line and no unreachable banner. */
export function expectRateLimitedWait(button: HTMLElement) {
  expect(button).toHaveAttribute("aria-disabled", "true");
  expect(button).toHaveClass("tabular-nums");
  expect(screen.getByText(RATE_LIMITED)).toHaveAttribute("role", "status");
  expect(screen.queryByText(/Couldn't reach the game server/)).not.toBeInTheDocument();
}
