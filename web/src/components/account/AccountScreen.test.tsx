import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { AccountScreen, type AccountView } from "./AccountScreen";

function Host({ initial = "choice" }: { initial?: AccountView }) {
  const [view, setView] = useState<AccountView>(initial);
  return <AccountScreen view={view} onView={setView} onSignedIn={vi.fn()} />;
}

describe("AccountScreen", () => {
  it("renders the choice panel labelled by its heading, with no account data", () => {
    renderWithProviders(<Host />);
    const section = screen.getByRole("region", { name: "Your account" });
    expect(section).toBeInTheDocument();
    expect(
      screen.getByText("Log in to your collection, or register a new one with an invite code."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Register" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Your account" })).toHaveAttribute("tabindex", "-1");
  });

  it("Log in and Register swap the section's content and focus the sub-step heading", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByRole("heading", { name: "Log in" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "Log in" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Your account" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Register" }));
    expect(screen.getByRole("heading", { name: "Register" })).toHaveFocus();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
  });
});
