/// <reference lib="dom" />
import type { CollectionResponse } from "@anime-tcg/shared/api";
import type { Page } from "@playwright/test";
import { makeOverviewCollection } from "../src/test/collectionFixtures";
import { makeCollection, makeFranchise } from "../src/test/fixtures";
import { deferred, expect, makeAccount, PNG, signedIn, test, type Answer } from "./support/fake-api";

/**
 * Bugs the tester's hunt found in the collection overview (collection-overview.md). These tests
 * FAIL ON PURPOSE until the engineer fixes the code; none is skipped or loosened. Each one says
 * the exact reproduction and the spec rule it breaks. The hunt itself is
 * collection-overview.hunt.spec.ts.
 *
 * Every case starts the same way: signed in on `/packs`, where the layout answers the collection
 * once; the header link then shows that answer at once while the Collection page's own refetch
 * (§3.1 step 2, "data held") is held in flight and released with the dialog open.
 */

// The session counts 5 cards and every first answer here 8, so `Collection (8)` in the header
// shows that the layout's answer has landed.
const CHRIS = makeAccount({ cards: 5 });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const grid = (page: Page) => page.getByRole("list", { name: /results?/ });
const tiles = (page: Page) => grid(page).getByRole("button");
const openDialog = (page: Page) => page.locator("dialog[open]");
const ok = (json: CollectionResponse): Answer => ({ status: 200, json });

async function viaPacks(page: Page) {
  await page.goto("/packs");
  await expect(h1(page, "Packs")).toBeVisible();
  // The layout's answer has landed: the header counts its 8 cards, not the session's 5.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Collection (8)" }).click();
  await expect(h1(page, "Collection")).toBeFocused();
  // The held answer shows at once while the page's own refetch is in flight.
  await expect(page.getByRole("list", { name: /results?/ })).toBeVisible();
}

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedIn(CHRIS));
});

test("BUG: a refetch that empties the collection drops the open dialog without `You no longer have this card.`, and focus falls to <body>", async ({
  page,
  api,
}) => {
  // Reproduction: sign in on /packs; follow `Collection (8)`; while the page's refetch is in
  // flight open any tile; the refetch answers with zero entries (an owner `reset-collection`, or
  // the last card sold or recycled elsewhere). Expected (§4.5 "entry gone after a refetch"): the
  // dialog stays, its body replaced by `You no longer have this card.` and `Close`. Actual:
  // CollectionPage swaps CollectionOverview for EmptyCollection, which unmounts the dialog with no
  // close event and no focus handling: the dialog vanishes under the player and
  // document.activeElement is <body>.
  const gate = deferred();
  api.on("GET /api/collection", ok(makeOverviewCollection()), async () => {
    await gate.promise;
    return ok(makeCollection([]));
  });
  await viaPacks(page);
  await tiles(page).nth(1).click();
  await expect(page.getByRole("dialog", { name: "Spike Spiegel" })).toBeFocused();
  gate.release();
  await expect(page.getByRole("heading", { name: "No cards yet" })).toBeAttached();
  await expect(page.getByRole("dialog", { name: "You no longer have this card." })).toBeVisible();
});

test("BUG: focus inside the dialog's details falls to <body> when a refetch removes the entry", async ({
  page,
  api,
}) => {
  // Reproduction: Spike Spiegel in eight series, so the dialog shows `Also in` with `and 2 more`;
  // open Spike's dialog, Tab to `and 2 more`; the page's refetch lands without Spike. Expected:
  // focus stays inside the open modal dialog, so a screen reader hears what replaced the details
  // (§7 "Dialog"; WCAG 2.4.3; the spec names no target, so the dialog itself or the
  // `You no longer have this card.` line would do). Actual: the details unmount with the focused
  // button and document.activeElement is <body>; nothing is read, and the next Tab lands on the
  // second `Close`. The economy PRs put the Price and Duplicates fields in the same body, so this
  // will be the common case once they land.
  const many = makeOverviewCollection();
  const extra = [200, 201, 202, 203, 204, 205, 206];
  many.franchises.push(...extra.map((id) => makeFranchise(id, { title: `Extra ${id}` })));
  many.entries.find((entry) => entry.character.id === 1)!.character.franchiseIds = [100, ...extra];
  const fewer = structuredClone(many);
  fewer.entries = fewer.entries.filter((entry) => entry.character.id !== 1);
  const gate = deferred();
  api.on("GET /api/collection", ok(many), async () => {
    await gate.promise;
    return ok(fewer);
  });
  await viaPacks(page);
  await tiles(page).nth(1).click();
  const more = page
    .getByRole("dialog", { name: "Spike Spiegel" })
    .getByRole("button", { name: "and 2 more" });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(more).toBeFocused();
  gate.release();
  await expect(openDialog(page).getByText("You no longer have this card.")).toBeVisible();
  const focus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    inside: document.querySelector("dialog[open]")?.contains(document.activeElement) ?? false,
  }));
  expect(focus, "focus stays inside the open dialog").toEqual({
    tag: expect.not.stringMatching(/^BODY$/),
    inside: true,
  });
  // §3.7 step 4 (manager decision, 2026-10-30): the message that replaced the details has it.
  await expect(openDialog(page).getByText("You no longer have this card.")).toBeFocused();
});

test("BUG: a tile whose art failed keeps `No image` after a refetch brings a new image address", async ({
  page,
  api,
}) => {
  // Reproduction: the layout's answer gives Spike an image address that fails (404); the
  // Collection page's refetch gives the address the new snapshot uses, which loads. Expected:
  // names and images follow the newest answer (§3 terms "After a snapshot update ... names and
  // images follow the new snapshot"; §5.6 rule 7 shows `No image` only for an image the browser
  // cannot load). Actual: Card keeps its `failed` art state across the new `imageUrl` (the tile
  // is keyed by the entry, not the address), renders no <img>, and never tries the new address.
  const OLD = "https://s4.anilist.co/file/anilistcdn/character/large/old-spike.png";
  const NEW = "https://s4.anilist.co/file/anilistcdn/character/large/new-spike.png";
  await page.route(OLD, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(NEW, (route) => route.fulfill({ body: PNG, contentType: "image/png" }));
  const before = makeOverviewCollection();
  before.entries.find((entry) => entry.character.id === 1)!.character.imageUrl = OLD;
  const after = makeOverviewCollection();
  const spikeAfter = after.entries.find((entry) => entry.character.id === 1)!;
  spikeAfter.character.imageUrl = NEW;
  // A visible change too, so the test knows the refetch landed before it looks at the art.
  spikeAfter.count = 4;
  const gate = deferred();
  api.on("GET /api/collection", ok(before), async () => {
    await gate.promise;
    return ok(after);
  });
  await viaPacks(page);
  const spike = tiles(page).nth(1);
  await expect(spike.getByText("No image", { exact: true })).toBeVisible();
  gate.release();
  await expect(spike).toHaveAccessibleName(/, 4 copies$/);
  await expect(spike.locator("img")).toHaveAttribute("src", NEW);
  await expect(spike.getByText("No image")).toHaveCount(0);
});

test("BUG: the rarity chips are 38.5 px tall on a phone, under §7's 40 px touch target", async ({
  page,
  api,
}) => {
  // Reproduction: a 320 px viewport, /collection with any collection; measure the seven chips.
  // Expected (§7 "Touch targets"): every control at least 40 px tall on a phone, "the chips ...
  // included (py-2.5 ... on a phone)". Actual: 38.5 px each. CHIP_BASE (web/src/components/
  // collection/styles.ts) sets `py-2.5` (20 px) and a 1 px border on each side, around `text-[11px]`
  // whose line box is 16.5 px (11 px x the inherited 1.5 line height): 20 + 2 + 16.5 = 38.5.
  api.on("GET /api/collection", ok(makeOverviewCollection()));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/collection");
  const chips = page.getByRole("group", { name: "Rarity" }).getByRole("button");
  await expect(chips).toHaveCount(7);
  const heights = await chips.evaluateAll((buttons) =>
    buttons.map((b) => `${b.textContent} ${b.getBoundingClientRect().height}`),
  );
  expect(heights.filter((entry) => Number(entry.split(" ").at(-1)) < 40)).toEqual([]);
  // §5.2 (manager decision, 2026-10-30): the seven chips wrap onto two lines at 320 px.
  const lines = await chips.evaluateAll(
    (buttons) => new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size,
  );
  expect(lines).toBe(2);
});
