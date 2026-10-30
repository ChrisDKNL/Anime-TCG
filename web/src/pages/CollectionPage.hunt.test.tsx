import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeAccount } from "../test/api";
import { COLLECTION, renderApp } from "../test/app";
import { makeOverviewCollection } from "../test/collectionFixtures";

/**
 * Tester's hunt, the part a browser cannot stage (collection-overview.md §4.4 "image failed",
 * §5.6 rule 7, card-and-rarity.md §3.3): Chromium reuses the decoded tile image for the dialog's
 * card, so an image that fails only in the dialog is fired here by hand. The rest of the hunt is
 * web/e2e/collection-overview.hunt.spec.ts.
 */

const ASYNC_TIMEOUT = 5_000;

async function openCollection() {
  renderApp(
    { [COLLECTION]: { status: 200, body: makeOverviewCollection() } },
    makeAccount({ cards: 8 }),
    "/collection",
  );
  const grid = await screen.findByRole("list", { name: /results?/ }, { timeout: ASYNC_TIMEOUT });
  return { grid, user: userEvent.setup() };
}

/** The card art inside `scope`: decorative, so found by tag rather than by role. */
function art(scope: HTMLElement): HTMLImageElement | null {
  return scope.querySelector("img");
}

describe("card art that fails in one place only", () => {
  it("fails only in the dialog: `No image` there, the tile keeps its art, and the next opening tries again", async () => {
    const { grid, user } = await openCollection();
    const tile = within(grid).getByRole("button", { name: /Spike Spiegel/ });
    fireEvent.load(art(tile)!);
    expect(art(tile)).not.toHaveClass("invisible");

    await user.click(tile);
    const dialog = screen.getByRole("dialog", { name: "Spike Spiegel" });
    const dialogArt = art(dialog)!;
    expect(dialogArt).toHaveAttribute("src", art(tile)!.getAttribute("src"));
    fireEvent.error(dialogArt);
    expect(within(dialog).getByText("No image")).toBeInTheDocument();
    expect(art(dialog)).toBeNull();
    // The heading, facts and close are untouched by the fallback.
    expect(within(dialog).getByRole("heading", { level: 2, name: "Spike Spiegel" })).toBeInTheDocument();
    expect(within(tile).queryByText("No image")).not.toBeInTheDocument();
    expect(art(tile)).not.toHaveClass("invisible");

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(tile).toHaveFocus();
    // A new opening mounts a new card, which asks for the image again.
    await user.click(tile);
    const again = screen.getByRole("dialog", { name: "Spike Spiegel" });
    expect(art(again)).not.toBeNull();
    expect(within(again).queryByText("No image")).not.toBeInTheDocument();
  });

  it("fails in the tile: the tile's name is unchanged, and the dialog's card asks again and can load", async () => {
    const { grid, user } = await openCollection();
    const tile = within(grid).getByRole("button", { name: /Spike Spiegel/ });
    const name = tile.getAttribute("aria-label");
    fireEvent.error(art(tile)!);
    expect(within(tile).getByText("No image")).toBeInTheDocument();
    expect(tile).toHaveAttribute("aria-label", name);
    expect(tile).toHaveAccessibleName(name!);

    await user.click(tile);
    const dialog = screen.getByRole("dialog", { name: "Spike Spiegel" });
    const dialogArt = art(dialog)!;
    expect(dialogArt).toHaveClass("invisible");
    fireEvent.load(dialogArt);
    expect(dialogArt).not.toHaveClass("invisible");
    expect(within(dialog).queryByText("No image")).not.toBeInTheDocument();
    // The tile behind keeps its fallback.
    expect(within(tile).getByText("No image")).toBeInTheDocument();
  });
});
