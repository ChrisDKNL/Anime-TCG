/// <reference lib="dom" />
import type { CollectionResponse, Rarity } from "@anime-tcg/shared/api";
import type { Locator, Page } from "@playwright/test";
import { makeLargeCollection, makeOverviewCollection } from "../src/test/collectionFixtures";
import { makeCharacter, makeCollection, makeEntry, makeFranchise } from "../src/test/fixtures";
import {
  deferred,
  envelope,
  expect,
  isolated,
  makeAccount,
  recordStatusTexts,
  signedIn,
  statusTexts,
  test,
  type Answer,
  type FakeApi,
} from "./support/fake-api";

/**
 * Test plan (tester's hunt): what the collection overview's own suites do not reach, in a real
 * browser against the scripted api (docs/design/collection-overview.md; navigation-and-landing.md
 * for the page rules; card-and-rarity.md for the card). The economy (§3.5, §3.6, the market and
 * recycle fields) is out of scope for this PR: the dialog shows details only.
 *
 * History with the dialog open (§7 "Page and heading", navigation §3.6, §3.10)
 * - Back with the dialog open: the previous page's `h1` has focus, no dialog is open or modal,
 *   the page answers clicks; Forward: `/collection` with its `h1` focused, no dialog, the toolbar
 *   as it was, and no query string or hash at any point.
 * - Back, then Forward, then Escape: Escape does nothing stale (no dialog reappears); Back with
 *   focus on Close, Forward and Back again: never a stuck dialog, Tab goes into the page.
 *
 * A refetch landing while the dialog is open (§3.1 step 2 "data held", §3.4 step 5, §3.7, §4.5)
 * - The entry gone: the body is `You no longer have this card.` and the dialog is named by it;
 *   the tile behind it drops out but nothing else moves; Close puts focus on the tile now at that
 *   position.
 * - The count changed: the facts show the new count and `Last obtained` appears; the order
 *   behind the dialog holds until close, then the sort is reapplied and focus follows the entry
 *   to its new place.
 * - Focus inside the details when the entry goes: collection-overview.bugs.spec.ts.
 * - The refetch answering `unauthenticated`: the dialog closes, `/login`, nothing modal.
 * - The refetch failing: the held data stays with the stale note; the dialog keeps its details.
 *
 * Card art (§4.4, §5.6 rule 7, card-and-rarity.md §3.3)
 * - An image that fails in a tile shows `No image` and leaves the tile's name alone; the dialog
 *   card retries and shows `No image` when it fails there too. One that fails only in the dialog
 *   cannot be staged here (the browser reuses the decoded tile image), so the unit hunt
 *   (CollectionPage.hunt.test.tsx) fires the error on the dialog's image itself.
 *
 * Toolbar at 320 px (§5.2, §7 "Keyboard path", "Touch targets")
 * - No sideways scroll with every filter on and the longest series chosen; every control fits
 *   the viewport; the rows of §5.2 (search; series and sort side by side; the chips wrapping;
 *   duplicates then Clear filters); Tab reaches every control in visual order; every
 *   control, the chips included, is at least 40 px tall.
 *
 * Live region (§4.2 "typing", §7 "Results line"), under page.clock
 * - Real keystrokes 200 ms apart announce nothing while typing and the results line once, 500 ms
 *   after the last; typing back to the opening line announces nothing; a no-match line says
 *   `No results`; Escape, a held key's auto-repeat and a paste each end in one announcement.
 * - A refetch that changes the line announces nothing (§4.1 "refreshing"); the player's next
 *   change is heard.
 *
 * Search (§3.3) in a real browser: accents, case, full-width, punctuation (`d luffy` matches,
 * `d.luffy` does not), CJK names and titles, kana voiced marks, whitespace runs, the empty result
 * with Clear filters, and search, chips, series, duplicates, sort and paging combined, with page 1
 * after every change but paging.
 *
 * Hostile AniList strings (§5.6, T1): markup, an RTL override, zero-width characters, a stack of
 * combining marks and 200+ characters as names and series titles, in the grid, the dialog, the
 * series select and the Series view: text only, no extra `img`, no handler, no script dialog, no
 * sideways scroll at 320 px, the dialog contents inside the dialog, the count beside the name
 * rather than inside it.
 *
 * Storage and address (§2, navigation §3.1 rule 2): through every interaction nothing reaches
 * localStorage, IndexedDB or a cookie; sessionStorage holds only the router's scroll positions;
 * no history entry has a query string or a hash.
 *
 * States (§4.1): no snapshot (no completion figure, percentage or bar; the totals, the grid and
 * the dialog's rank-less card stay; the Series view is one line, with no rows and no source line); the empty
 * collection (`No cards yet`, `Open a pack` to the
 * Packs heading, no toolbar).
 */

// The session counts 5 cards and every first answer here 8, so `Collection (8)` in the header
// shows that the layout's answer has landed.
const CHRIS = makeAccount({ cards: 5 });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const resultsLine = (page: Page) => page.locator("#collection-results");
const grid = (page: Page) => page.getByRole("list", { name: /results?/ });
const tiles = (page: Page) => grid(page).getByRole("button");
const search = (page: Page) => page.getByRole("searchbox", { name: "Search" });
const seriesSelect = (page: Page) => page.getByRole("combobox", { name: "Series" });
const sortSelect = (page: Page) => page.getByRole("combobox", { name: "Sort" });
const rarityGroup = (page: Page) => page.getByRole("group", { name: "Rarity" });
const chip = (page: Page, name: string) => rarityGroup(page).getByRole("button", { name, exact: true });
const duplicatesOnly = (page: Page) => page.getByRole("checkbox", { name: "Duplicates only" });
const clearFilters = (page: Page) =>
  page.getByRole("search", { name: "Collection filters" }).getByRole("button", { name: "Clear filters" });
const pagesNav = (page: Page) => page.getByRole("navigation", { name: "Pages" });
const openDialog = (page: Page) => page.locator("dialog[open]");
const ok = (json: CollectionResponse): Answer => ({ status: 200, json });

/** The tiles' character names in grid order, from their accessible names. */
async function tileNames(page: Page): Promise<string[]> {
  const labels = await tiles(page).evaluateAll((buttons) =>
    buttons.map((b) => b.getAttribute("aria-label") ?? ""),
  );
  return labels.map((label) => label.split(",")[0].replace(/[\u2068\u2069]/g, ""));
}

async function expectNoSidewaysScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(width);
}

function expectAddressClean(page: Page) {
  const url = new URL(page.url());
  expect(url.search).toBe("");
  expect(url.hash).toBe("");
}

/** No open dialog, nothing in the top layer, and a header link that takes a real click. */
async function expectNothingModal(page: Page) {
  await expect(openDialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelectorAll(":modal").length)).toBe(0);
}

/** Signed in, on `/packs`, with the collection answered once by the layout; then the header link. */
async function viaPacks(page: Page) {
  await page.goto("/packs");
  await expect(h1(page, "Packs")).toBeVisible();
  // The layout's answer has landed: the header counts its 8 cards, not the session's 5.
  await mainNav(page).getByRole("link", { name: "Collection (8)" }).click();
  await expect(h1(page, "Collection")).toBeFocused();
  // The held answer shows at once while the page's own refetch is in flight.
  await expect(page.getByRole("list", { name: /results?/ })).toBeVisible();
}

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedIn(CHRIS));
  api.on("GET /api/collection", ok(makeOverviewCollection()));
});

// ---------------------------------------------------------------------------------------------
// History with the dialog open
// ---------------------------------------------------------------------------------------------

test.describe("Back and Forward with the card dialog open", () => {
  test("Back leaves with the dialog, focus on the Packs heading; Forward comes back with no dialog and the toolbar as it was", async ({
    page,
  }) => {
    await viaPacks(page);
    await search(page).fill("spike");
    await expect(tiles(page)).toHaveCount(1);
    await tiles(page).first().click();
    const dialog = page.getByRole("dialog", { name: "Spike Spiegel" });
    await expect(dialog).toBeFocused();
    expectAddressClean(page);

    await page.goBack();
    await expect(page).toHaveURL(/\/packs$/);
    await expect(h1(page, "Packs")).toBeFocused();
    await expect(page).toHaveTitle("Packs · Anime TCG");
    await expectNothingModal(page);
    // The page is not inert: a real click on a header link navigates.
    await mainNav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await expect(h1(page, "Collection")).toBeFocused();
    await expectNothingModal(page);
    await page.goBack();
    await expect(h1(page, "Packs")).toBeFocused();

    await page.goForward();
    await expect(page).toHaveURL(/\/collection$/);
    await expect(h1(page, "Collection")).toBeFocused();
    await expect(page).toHaveTitle("Collection · Anime TCG");
    await expectNothingModal(page);
    await expect(search(page)).toHaveValue("spike");
    await expect(tiles(page)).toHaveCount(1);
    expectAddressClean(page);

    // Nothing stale answers Escape, and the tile opens a fresh dialog that closes normally.
    await page.keyboard.press("Escape");
    await expectNothingModal(page);
    await tiles(page).first().click();
    await expect(dialog).toBeFocused();
    await page.keyboard.press("Escape");
    await expectNothingModal(page);
    await expect(tiles(page).first()).toBeFocused();
    expectAddressClean(page);
  });

  test("Back with focus deep in the dialog, then Forward and Back again: never a stuck dialog", async ({
    page,
  }) => {
    await viaPacks(page);
    await tiles(page).nth(1).click();
    const dialog = page.getByRole("dialog", { name: "Spike Spiegel" });
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.goBack();
    await expect(h1(page, "Packs")).toBeFocused();
    await page.goForward();
    await expect(h1(page, "Collection")).toBeFocused();
    await page.goBack();
    await expect(h1(page, "Packs")).toBeFocused();
    await expectNothingModal(page);
    await page.goForward();
    await expect(h1(page, "Collection")).toBeFocused();
    await expectNothingModal(page);
    // Tab from the heading goes into the page, not into a leftover dialog.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Cards", exact: true })).toBeFocused();
    expectAddressClean(page);
  });
});

// ---------------------------------------------------------------------------------------------
// A refetch landing while the dialog is open
// ---------------------------------------------------------------------------------------------

test.describe("a refetch that lands while the dialog is open", () => {
  /** The layout's answer on `/packs`, then the Collection page's own refetch, held until released. */
  function heldRefetch(api: FakeApi, next: Answer) {
    const gate = deferred();
    api.on("GET /api/collection", ok(makeOverviewCollection()), async () => {
      await gate.promise;
      return next;
    });
    return gate;
  }

  test("the entry gone: the dialog says so and is named by it; the grid behind keeps its order; Close focuses the tile now there", async ({
    page,
    api,
  }) => {
    const fewer = makeOverviewCollection();
    fewer.entries = fewer.entries.filter((entry) => entry.character.id !== 1);
    const gate = heldRefetch(api, ok(fewer));
    await viaPacks(page);
    expect(await tileNames(page)).toEqual([
      "Moved Star",
      "Spike Spiegel",
      "Gon Freecss",
      "Old Hero",
      "Pikachu",
    ]);
    await tiles(page).nth(1).click();
    const dialog = openDialog(page);
    await expect(dialog).toBeFocused();
    gate.release();
    await expect(dialog.getByText("You no longer have this card.")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "You no longer have this card." })).toBeVisible();
    await expect(dialog.getByRole("heading")).toHaveCount(0);
    // Focus was on the dialog itself, which stays.
    await expect(dialog).toBeFocused();
    expect(await tileNames(page)).toEqual(["Moved Star", "Gon Freecss", "Old Hero", "Pikachu"]);
    // Two ways out, both named Close; Tab reaches them in order.
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" }).first()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" }).last()).toBeFocused();
    await page.keyboard.press("Enter");
    await expectNothingModal(page);
    // Spike was second: Gon is now second and takes focus.
    await expect(tiles(page).nth(1)).toBeFocused();
    await expect(tiles(page).nth(1)).toHaveAccessibleName(/^\u2068Gon Freecss\u2069/);
    await expect(resultsLine(page)).toHaveText("4 results");
    expectAddressClean(page);
  });

  test("the count changed: the facts follow, the order holds until close, then the sort applies and focus follows the entry", async ({
    page,
    api,
  }) => {
    const more = makeOverviewCollection();
    const pikachu = more.entries.find((entry) => entry.character.id === 2)!;
    pikachu.count = 7;
    pikachu.lastObtainedAt = "2026-10-30T09:00:00.000Z";
    more.totals.cards += 6;
    more.totals.duplicates += 6;
    more.totals.byRarity.common += 6;
    // The page observer's refetch is held so it lands after the sort change and the opening.
    const gate = heldRefetch(api, ok(more));
    await viaPacks(page);
    await sortSelect(page).selectOption("copies");
    await expect
      .poll(() => tileNames(page))
      .toEqual(["Spike Spiegel", "Gon Freecss", "Moved Star", "Old Hero", "Pikachu"]);
    await tiles(page).nth(4).click();
    const dialog = page.getByRole("dialog", { name: "Pikachu" });
    await expect(dialog.getByText("Last obtained")).toHaveCount(0);
    gate.release();
    await expect(dialog.locator("dd").nth(1)).toHaveText("7");
    await expect(dialog.getByText("Last obtained")).toBeVisible();
    await expect(dialog.getByText("30 Oct 2026")).toBeVisible();
    await expect(page.getByText("14 cards · 9 duplicates")).toBeAttached();
    // Behind the dialog nothing moved, though Pikachu now has the most copies.
    expect(await tileNames(page)).toEqual([
      "Spike Spiegel",
      "Gon Freecss",
      "Moved Star",
      "Old Hero",
      "Pikachu",
    ]);
    await expect(tiles(page).nth(4)).toHaveAccessibleName(/7 copies$/);
    await page.keyboard.press("Escape");
    await expectNothingModal(page);
    // The native dialog closes at once; the grid re-sorts on its `close` event, a task later.
    await expect
      .poll(() => tileNames(page))
      .toEqual(["Pikachu", "Spike Spiegel", "Gon Freecss", "Moved Star", "Old Hero"]);
    await expect(tiles(page).first()).toBeFocused();
    await expect(tiles(page).first()).toHaveAccessibleName(/^\u2068Pikachu\u2069/);
  });

  test("the refetch answers unauthenticated: the dialog closes and /login takes over, nothing modal", async ({
    page,
    api,
  }) => {
    const gate = heldRefetch(api, envelope(401, "unauthenticated"));
    await viaPacks(page);
    await tiles(page).nth(1).click();
    await expect(page.getByRole("dialog", { name: "Spike Spiegel" })).toBeFocused();
    gate.release();
    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page, "Log in")).toBeVisible();
    await expectNothingModal(page);
    expectAddressClean(page);
  });

  test("the refetch failing: the held data stays with the stale note, the dialog keeps its details", async ({
    page,
    api,
  }) => {
    const gate = deferred();
    api.on("GET /api/collection", ok(makeOverviewCollection()), async () => {
      await gate.promise;
      return "abort" as const;
    });
    await viaPacks(page);
    await tiles(page).nth(1).click();
    const dialog = page.getByRole("dialog", { name: "Spike Spiegel" });
    gate.release();
    await expect(page.getByText(/^Showing your collection as of \d\d:\d\d\.$/)).toBeAttached();
    await expect(dialog.getByRole("heading", { name: "Spike Spiegel" })).toBeVisible();
    await expect(dialog.locator("dd").nth(1)).toHaveText("3");
    await page.keyboard.press("Escape");
    await expect(tiles(page).nth(1)).toBeFocused();
    await expect(tiles(page)).toHaveCount(5);
  });
});

// ---------------------------------------------------------------------------------------------
// Card art that fails to load
// ---------------------------------------------------------------------------------------------

test.describe("card art that fails to load", () => {
  const SPIKE_ART = "https://s4.anilist.co/file/anilistcdn/character/large/b1.png";

  test("in the tile: `No image`, the tile's name unchanged; the dialog card retries and fails the same way", async ({
    page,
  }) => {
    await page.route(SPIKE_ART, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/collection");
    const spike = tiles(page).nth(1);
    await expect(spike.getByText("No image", { exact: true })).toBeVisible();
    await expect(spike.locator("img")).toHaveCount(0);
    await expect(spike).toHaveAccessibleName(
      `${isolated("Spike Spiegel")}, Epic, ${isolated("Cowboy Bebop")}, 3 copies`,
    );
    // The others loaded.
    await expect(tiles(page).first().locator("img")).toBeVisible();

    await spike.click();
    const dialog = page.getByRole("dialog", { name: "Spike Spiegel" });
    await expect(dialog.getByText("No image", { exact: true })).toBeVisible();
    await expect(dialog.locator("img")).toHaveCount(0);
    // The card keeps its size with the fallback, so the heading block does not shift.
    await expect(dialog.getByRole("article")).toHaveCSS("width", "240px");
    await page.keyboard.press("Escape");
    await expect(spike).toBeFocused();
  });
});

// ---------------------------------------------------------------------------------------------
// The toolbar at 320 px
// ---------------------------------------------------------------------------------------------

test("the toolbar at 320 px: no sideways scroll with every filter on, §5.2's rows, Tab in visual order, 40 px targets", async ({
  page,
  api,
}) => {
  const data = makeOverviewCollection();
  const LONG_TITLE = `Cowboy${"B".repeat(220)}`;
  data.franchises.find((franchise) => franchise.id === 100)!.title = LONG_TITLE;
  api.on("GET /api/collection", ok(data));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/collection");
  await expect(resultsLine(page)).toHaveText("5 results");

  await search(page).fill("s");
  await seriesSelect(page).selectOption("100");
  await chip(page, "Epic").click();
  await duplicatesOnly(page).check();
  await expect(resultsLine(page)).toHaveText("1 result");
  await expect(clearFilters(page)).toBeVisible();
  await expectNoSidewaysScroll(page);

  const view = page.getByRole("group", { name: "View" });
  const controls: Array<[string, Locator]> = [
    ["Cards", view.getByRole("button", { name: "Cards", exact: true })],
    ["Series view", view.getByRole("button", { name: "Series", exact: true })],
    ["Search", search(page)],
    ["Series", seriesSelect(page)],
    ["Sort", sortSelect(page)],
    ...["All", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"].map(
      (name) => [name, chip(page, name)] as [string, Locator],
    ),
    ["Duplicates only", duplicatesOnly(page)],
    ["Clear filters", clearFilters(page)],
  ];

  // Every control inside the viewport.
  for (const [name, control] of controls) {
    const box = (await control.boundingBox())!;
    expect(box.x, `${name} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${name} ends on screen`).toBeLessThanOrEqual(320);
  }

  // §5.2 below 640 px: search alone; series and sort side by side; the chips wrapping;
  // Duplicates only, then Clear filters.
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  const searchBox = await box(search(page));
  const seriesBox = await box(seriesSelect(page));
  const sortBox = await box(sortSelect(page));
  expect(seriesBox.y).toBeGreaterThan(searchBox.y + searchBox.height - 1);
  expect(Math.round(seriesBox.y)).toBe(Math.round(sortBox.y));
  expect(sortBox.x).toBeGreaterThan(seriesBox.x + seriesBox.width - 1);
  expect(searchBox.width).toBeGreaterThan(seriesBox.width + sortBox.width);
  const chipTops = await rarityGroup(page)
    .getByRole("button")
    .evaluateAll((chips) => [...new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top)))]);
  // §5.2 (manager decision, 2026-10-30): two lines at 320 px.
  expect(chipTops.length, "the chips wrap onto two lines at 320 px").toBe(2);
  const duplicatesBox = await box(page.locator("label", { has: duplicatesOnly(page) }));
  const clearBox = await box(clearFilters(page));
  expect(duplicatesBox.y).toBeGreaterThan(Math.max(...chipTops));
  expect(
    Math.abs(duplicatesBox.y + duplicatesBox.height / 2 - (clearBox.y + clearBox.height / 2)),
  ).toBeLessThan(4);
  expect(clearBox.x).toBeGreaterThan(duplicatesBox.x);
  // The long series, chosen, truncates inside its select instead of widening the row.
  expect(seriesBox.width).toBeLessThan(160);

  // Tab from the heading reaches every control, in the order they read.
  await h1(page, "Collection").focus();
  for (const [name, control] of controls) {
    await page.keyboard.press("Tab");
    await expect(control, `Tab reaches ${name}`).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(tiles(page).first()).toBeFocused();

  // §7 "Touch targets": every control at least 40 px tall on a phone (the checkbox by its label),
  // the rarity chips included.
  const targets: Array<[string, Locator]> = controls.map(([name, control]) =>
    name === "Duplicates only"
      ? [name, page.locator("label", { has: duplicatesOnly(page) })]
      : [name, control],
  );
  const short: string[] = [];
  for (const [name, target] of targets) {
    const { height } = await box(target);
    if (height < 40) short.push(`${name} ${height.toFixed(1)} px`);
  }
  expect(short, "controls under 40 px tall at 320 px").toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// The live region while typing, under page.clock
// ---------------------------------------------------------------------------------------------

test.describe("the live region while typing (page.clock)", () => {
  /** What the live region said about results: the results lines and `No results`. */
  async function resultAnnouncements(page: Page): Promise<string[]> {
    return (await statusTexts(page)).filter((text) => /result/i.test(text));
  }

  /** Loaded, with the clock stopped: from here on only `runFor` moves time. */
  async function loadedWithStoppedClock(page: Page) {
    await recordStatusTexts(page);
    await page.clock.install();
    await page.goto("/collection");
    await expect(resultsLine(page)).toHaveText("5 results");
    await page.clock.pauseAt(Date.now() + 60_000);
    await search(page).focus();
  }

  test("a refetch that changes the results line says nothing; the player's next change is heard (§4.1 refreshing)", async ({
    page,
    api,
  }) => {
    // Regression (manager decision, 2026-10-30): the page's own refetch drops Spike, so the line
    // goes from 5 to 4 results with no change by the player.
    const fewer = makeOverviewCollection();
    fewer.entries = fewer.entries.filter((entry) => entry.character.id !== 1);
    const gate = deferred();
    api.on("GET /api/collection", ok(makeOverviewCollection()), async () => {
      await gate.promise;
      return ok(fewer);
    });
    await recordStatusTexts(page);
    await page.clock.install();
    await viaPacks(page);
    await expect(resultsLine(page)).toHaveText("5 results");
    gate.release();
    await expect(resultsLine(page)).toHaveText("4 results");
    await page.clock.runFor(5_000);
    expect(await resultAnnouncements(page)).toEqual([]);
    await search(page).fill("gon");
    await expect(resultsLine(page)).toHaveText("1 result");
    await page.clock.runFor(500);
    await expect.poll(() => resultAnnouncements(page)).toEqual(["1 result"]);
  });

  test("keystrokes 200 ms apart announce nothing; the line once, 500 ms after the last", async ({ page }) => {
    await loadedWithStoppedClock(page);
    for (const [key, line] of [
      ["p", "3 results"],
      ["i", "2 results"],
      ["k", "2 results"],
      ["a", "1 result"],
    ]) {
      await page.keyboard.type(key);
      // The grid follows each keystroke at once, with no time passing.
      await expect(resultsLine(page)).toHaveText(line);
      await page.clock.runFor(200);
      expect(await resultAnnouncements(page), `nothing while typing (after "${key}")`).toEqual([]);
    }
    expect(await tileNames(page)).toEqual(["Pikachu"]);
    await page.clock.runFor(299);
    expect(await resultAnnouncements(page)).toEqual([]);
    await page.clock.runFor(1);
    await expect.poll(() => resultAnnouncements(page)).toEqual(["1 result"]);
    await page.clock.runFor(5_000);
    expect(await resultAnnouncements(page)).toEqual(["1 result"]);
    await expect(search(page)).toBeFocused();
  });

  test("typing away and back before the wait ends says nothing; no matches says `No results`", async ({
    page,
  }) => {
    await loadedWithStoppedClock(page);
    await page.keyboard.type("x");
    await page.clock.runFor(200);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(2_000);
    expect(await resultAnnouncements(page)).toEqual([]);

    await page.keyboard.type("zz", { delay: 0 });
    await expect(resultsLine(page)).toHaveText("0 results");
    await expect(page.getByText('No cards match "zz".')).toBeVisible();
    await page.clock.runFor(500);
    await expect.poll(() => resultAnnouncements(page)).toEqual(["No results"]);

    // Escape clears: one announcement for the line it returns to, after the wait.
    await page.keyboard.press("Escape");
    await expect(resultsLine(page)).toHaveText("5 results");
    await page.clock.runFor(499);
    expect(await resultAnnouncements(page)).toEqual(["No results"]);
    await page.clock.runFor(1);
    await expect.poll(() => resultAnnouncements(page)).toEqual(["No results", "5 results"]);
  });

  test("a held key's auto-repeat and a paste each end in one announcement", async ({ page }) => {
    await loadedWithStoppedClock(page);
    // Auto-repeat: ten keydowns 33 ms apart, as a held key sends them.
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("s");
      await page.clock.runFor(33);
    }
    await expect(search(page)).toHaveValue("ssssssssss");
    await page.clock.runFor(500);
    await expect.poll(() => resultAnnouncements(page)).toEqual(["No results"]);

    await search(page).fill("");
    await page.keyboard.insertText("spike spiegel");
    await expect(resultsLine(page)).toHaveText("1 result");
    await page.clock.runFor(500);
    await expect.poll(() => resultAnnouncements(page)).toEqual(["No results", "1 result"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Search (§3.3) in a real browser
// ---------------------------------------------------------------------------------------------

/** Characters for the match rule: accents, native names and titles, punctuation, kana marks. */
function searchCollection(): CollectionResponse {
  const entry = (
    id: number,
    rarity: Rarity,
    name: string,
    nameNative: string | null,
    franchiseIds: number[],
  ) => makeEntry(makeCharacter(id, { name, nameNative, franchiseIds, tier: rarity, rank: id }), { rarity });
  const data = makeCollection([
    entry(1, "mythic", "Monkey D. Luffy", "モンキー・D・ルフィ", [200]),
    entry(2, "legendary", "Roronoa Zoro", "ロロノア・ゾロ", [200]),
    entry(3, "common", "Ash Ketchum", "サトシ", [201]),
    entry(4, "rare", "Eren Yeager", "エレン・イェーガー", [202]),
    entry(5, "epic", "Zoë Hangë", null, [202]),
    entry(6, "uncommon", "Gintoki Sakata", "坂田銀時", [203]),
    entry(7, "common", "Kaguya Shinomiya", "四宮かぐや", [204]),
    entry(8, "common", "Kakuya Test", "かくや", [204]),
    entry(9, "rare", "Ｆｕｌｌ Ｗｉｄｔｈ", null, [204]),
  ]);
  data.franchises = [
    makeFranchise(200, { title: "One Piece", titleNative: "ワンピース" }),
    makeFranchise(201, { title: "Pokémon", titleNative: "ポケットモンスター" }),
    makeFranchise(202, { title: "Attack on Titan", titleNative: "進撃の巨人" }),
    makeFranchise(203, { title: "Gintama", titleNative: "銀魂" }),
    makeFranchise(204, { title: "Kaguya-sama: Love Is War", titleNative: "告らせたい" }),
  ];
  data.completion.franchises = data.franchises.map((franchise) => ({
    franchiseId: franchise.id,
    owned: 2,
    total: 10,
  }));
  return data;
}

const resultsText = (count: number) =>
  count === 1 ? "1 result" : `${count.toLocaleString("en-GB")} results`;

test("search: accents, case, full width, punctuation, CJK, kana marks and whitespace, as §3.3's table", async ({
  page,
  api,
}) => {
  api.on("GET /api/collection", ok(searchCollection()));
  await page.goto("/collection");
  await expect(resultsLine(page)).toHaveText("9 results");
  const cases: Array<[string, string[]]> = [
    ["luffy", ["Monkey D. Luffy"]],
    ["LUFFY", ["Monkey D. Luffy"]],
    ["ＬＵＦＦＹ", ["Monkey D. Luffy"]],
    ["d luffy", ["Monkey D. Luffy"]],
    ["d. luffy", ["Monkey D. Luffy"]],
    ["  monkey \t  luffy  ", ["Monkey D. Luffy"]],
    ["monkey\u3000luffy", ["Monkey D. Luffy"]],
    ["d.luffy", []],
    ["monkey.d", []],
    ["luffy zoro", []],
    ["one piece zoro", ["Roronoa Zoro"]],
    ["ルフィ", ["Monkey D. Luffy"]],
    ["ワンピース", ["Monkey D. Luffy", "Roronoa Zoro"]],
    ["pokemon", ["Ash Ketchum"]],
    ["POKÉMON", ["Ash Ketchum"]],
    ["pokémon", ["Ash Ketchum"]],
    ["zoe hange", ["Zoë Hangë"]],
    ["ZOË", ["Zoë Hangë"]],
    ["進撃", ["Eren Yeager", "Zoë Hangë"]],
    ["titan", ["Eren Yeager", "Zoë Hangë"]],
    ["銀", ["Gintoki Sakata"]],
    ["かぐや", ["Kaguya Shinomiya"]],
    ["かくや", ["Kakuya Test"]],
    ["full width", ["Ｆｕｌｌ Ｗｉｄｔｈ"]],
    ["ｆｕｌｌ", ["Ｆｕｌｌ Ｗｉｄｔｈ"]],
    ["kaguya-sama:", ["Kaguya Shinomiya", "Kakuya Test", "Ｆｕｌｌ Ｗｉｄｔｈ"]],
    ["kaguya sama", ["Kaguya Shinomiya", "Kakuya Test", "Ｆｕｌｌ Ｗｉｄｔｈ"]],
    ["kaguyasama", []],
  ];
  for (const [query, want] of cases) {
    // From the full list each time, so a line left over from the previous query cannot pass.
    await search(page).fill("");
    await expect(resultsLine(page)).toHaveText("9 results");
    await search(page).fill(query);
    await expect(resultsLine(page), JSON.stringify(query)).toHaveText(
      want.length === 0 ? "0 results" : resultsText(want.length),
    );
    if (want.length > 0) {
      await expect
        .poll(async () => (await tileNames(page)).toSorted(), { message: JSON.stringify(query) })
        .toEqual(want.toSorted());
    }
  }
  // The field shows what was typed; normalisation is for matching only (§5.6 rule 8).
  await search(page).fill("ＬＵＦＦＹ");
  await expect(search(page)).toHaveValue("ＬＵＦＦＹ");
  await expect(tiles(page).first()).toHaveAccessibleName(/^\u2068Monkey D\. Luffy\u2069/);
  // The field takes at most 100 characters.
  await search(page).fill("");
  await search(page).pressSequentially("a".repeat(105), { delay: 0 });
  await expect(search(page)).toHaveValue("a".repeat(100));
});

test("an empty result: the query as typed and Clear filters, which brings everything back and focuses the results line", async ({
  page,
  api,
}) => {
  api.on("GET /api/collection", ok(searchCollection()));
  await page.goto("/collection");
  await chip(page, "Rare").click();
  await search(page).fill("d.luffy");
  await expect(page.getByText('No cards match "d.luffy".')).toBeVisible();
  await expect(grid(page)).toHaveCount(0);
  await expect(resultsLine(page)).toHaveText("0 results");
  const both = page.getByRole("button", { name: "Clear filters" });
  await expect(both).toHaveCount(2);
  // The one in place of the grid.
  await both.last().click();
  await expect(resultsLine(page)).toHaveText("9 results");
  await expect(resultsLine(page)).toBeFocused();
  await expect(search(page)).toHaveValue("");
  await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);

  // Filters alone: the filters line, then the toolbar's Clear filters.
  await chip(page, "Mythic").click();
  await duplicatesOnly(page).check();
  await expect(page.getByText("No cards match these filters.")).toBeVisible();
  await clearFilters(page).click();
  await expect(resultsLine(page)).toBeFocused();
  await expect(resultsLine(page)).toHaveText("9 results");
  // A blank query is no search: no `No cards match`, no Clear filters.
  await search(page).fill("   ");
  await expect(resultsLine(page)).toHaveText("9 results");
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
});

/**
 * 2,000 entries: `Hero 0000`… on even ids and `Villain 0000`… on odd ones, each tier in turn,
 * two series in blocks of twelve, every fifth character with three copies. The expected results
 * are computed here from the same rows, so the test does not lean on the view's own logic.
 */
function mixedCollection() {
  const tiers: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
  const rows = Array.from({ length: 2_000 }, (_, i) => {
    const k = Math.floor(i / 2);
    return {
      id: 20_000 + i,
      name: `${i % 2 === 0 ? "Hero" : "Villain"} ${String(k).padStart(4, "0")}`,
      rarity: tiers[k % 6],
      series: 300 + (Math.floor(i / 12) % 2),
      count: k % 5 === 0 ? 3 : 1,
    };
  });
  const data = makeCollection(
    rows.map((row) =>
      makeEntry(
        makeCharacter(row.id, { name: row.name, franchiseIds: [row.series], tier: row.rarity, rank: row.id }),
        { rarity: row.rarity, count: row.count },
      ),
    ),
  );
  data.franchises = [
    makeFranchise(300, { title: "First Series" }),
    makeFranchise(301, { title: "Second Series" }),
  ];
  data.completion.franchises = [
    { franchiseId: 300, owned: 1_000, total: 1_200 },
    { franchiseId: 301, owned: 1_000, total: 1_200 },
  ];
  return { data, rows };
}

test("search, chips, series, duplicates, sort and paging combined; every change but paging goes to page 1", async ({
  page,
  api,
}) => {
  const { data, rows } = mixedCollection();
  api.on("GET /api/collection", ok(data));
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/collection");
  await expect(resultsLine(page)).toHaveText("2,000 results · page 1 of 34");
  const asked = api.count("GET /api/collection");

  interface Filter {
    terms: string[];
    rarities: Rarity[];
    series: number | null;
    duplicates: boolean;
  }
  const expected = (filter: Filter) =>
    rows
      .filter(
        (row) =>
          filter.terms.every((term) => row.name.toLowerCase().includes(term)) &&
          (filter.rarities.length === 0 || filter.rarities.includes(row.rarity)) &&
          (filter.series === null || row.series === filter.series) &&
          (!filter.duplicates || row.count >= 2),
      )
      .map((row) => row.name)
      .toSorted();
  const line = (count: number, pageNo: number) => {
    const pages = Math.max(1, Math.ceil(count / 60));
    return pages > 1 ? `${resultsText(count)} · page ${pageNo} of ${pages}` : resultsText(count);
  };
  const expectPage = async (filter: Filter, pageNo: number) => {
    const all = expected(filter);
    await expect(resultsLine(page)).toHaveText(line(all.length, pageNo));
    await expect.poll(() => tileNames(page)).toEqual(all.slice((pageNo - 1) * 60, pageNo * 60));
  };
  const next = () => pagesNav(page).getByRole("button", { name: "Next page" }).click();

  const filter: Filter = { terms: [], rarities: [], series: null, duplicates: false };
  await sortSelect(page).selectOption("name");
  await search(page).fill("hero");
  filter.terms = ["hero"];
  await expectPage(filter, 1);
  await next();
  await next();
  await expectPage(filter, 3);

  await chip(page, "Rare").click();
  filter.rarities = ["rare"];
  await expectPage(filter, 1);
  await chip(page, "Mythic").click();
  filter.rarities = ["rare", "mythic"];
  await expectPage(filter, 1);
  await next();
  await expectPage(filter, 2);

  await seriesSelect(page).selectOption("301");
  filter.series = 301;
  await expectPage(filter, 1);
  await expect(page.getByText("Second Series: 1,000 of 1,200 characters")).toBeVisible();
  await next();
  await expectPage(filter, 2);

  await duplicatesOnly(page).check();
  filter.duplicates = true;
  await expectPage(filter, 1);

  // Back out to many pages, go to the last one with the page select, then change the sort.
  await duplicatesOnly(page).uncheck();
  filter.duplicates = false;
  await chip(page, "All").click();
  filter.rarities = [];
  await expectPage(filter, 1);
  const lastPage = Math.ceil(expected(filter).length / 60);
  await pagesNav(page).getByRole("combobox", { name: "Page" }).selectOption(String(lastPage));
  await expectPage(filter, lastPage);
  await sortSelect(page).selectOption("rarity");
  await expect(resultsLine(page)).toHaveText(line(expected(filter).length, 1));
  await sortSelect(page).selectOption("name");
  await next();
  await expectPage(filter, 2);

  // Typing more of the search goes to page 1; so does Clear filters, which keeps the sort.
  await search(page).press("End");
  await search(page).pressSequentially(" 01");
  filter.terms = ["hero", "01"];
  await expectPage(filter, 1);
  await clearFilters(page).click();
  await expect(resultsLine(page)).toHaveText("2,000 results · page 1 of 34");
  await expect(sortSelect(page)).toHaveValue("name");
  await expect
    .poll(() => tileNames(page))
    .toEqual(
      rows
        .map((row) => row.name)
        .toSorted()
        .slice(0, 60),
    );

  expect(api.count("GET /api/collection")).toBe(asked);
  expectAddressClean(page);
});

// ---------------------------------------------------------------------------------------------
// Hostile AniList strings (§5.6, T1)
// ---------------------------------------------------------------------------------------------

const MARKUP = "<img src=x onerror=alert(1)>";
const RTL = "\u202EevilName\u202C";
const ZERO_WIDTH = "Zero\u200BWidth\u200DName\uFEFF";
const LONG = "L".repeat(210);
const MARKS = `Z${"\u0301".repeat(50)}`;
const HOSTILE_NAMES = [MARKUP, RTL, ZERO_WIDTH, LONG, MARKS];
const LONG_SERIES = "T".repeat(230);

/** One entry per hostile name, each in a hostile series of its own and in the long series. */
function hostileCollection(): CollectionResponse {
  const data = makeCollection(
    HOSTILE_NAMES.map((name, i) =>
      makeEntry(
        makeCharacter(i + 1, {
          name,
          nameNative: `ネ${name}`,
          franchiseIds: [400 + i, 499],
          tier: "rare",
          rank: i + 1,
        }),
        { rarity: "rare", count: 3 },
      ),
    ),
  );
  data.franchises = [
    ...HOSTILE_NAMES.map((name, i) => makeFranchise(400 + i, { title: `S${name}`, titleNative: `N${name}` })),
    makeFranchise(499, { title: LONG_SERIES }),
  ];
  data.completion.franchises = data.franchises.map((franchise) => ({
    franchiseId: franchise.id,
    owned: 1,
    total: 4,
  }));
  return data;
}

test.describe("hostile names and series titles", () => {
  test.beforeEach(({ api }) => {
    api.on("GET /api/collection", ok(hostileCollection()));
  });

  /** Script dialogs the page raised (an `alert` from markup would land here). */
  function scriptDialogs(page: Page): string[] {
    const raised: string[] = [];
    page.on("dialog", (dialog) => {
      raised.push(dialog.message());
      void dialog.dismiss();
    });
    return raised;
  }

  async function expectNoInjectedMarkup(page: Page) {
    const found = await page.evaluate(() => ({
      handlers: document.querySelectorAll("[onerror], [onload], [onclick]").length,
      foreignImages: Array.from(document.images).filter(
        (img) => !img.src.startsWith("https://s4.anilist.co/"),
      ).length,
    }));
    expect(found).toEqual({ handlers: 0, foreignImages: 0 });
  }

  test("the grid at 320 px: every name as text in its own element, the count beside it, nothing injected, no sideways scroll", async ({
    page,
  }) => {
    const raised = scriptDialogs(page);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/collection");
    await expect(resultsLine(page)).toHaveText("5 results");
    await expect(tiles(page)).toHaveCount(5);
    for (const [i, name] of HOSTILE_NAMES.entries()) {
      const tile = grid(page).locator(`button[data-entry^="${i + 1}:"]`);
      await expect(tile).toHaveAccessibleName(`${isolated(name)}, Rare, ${isolated(`S${name}`)}, 3 copies`);
      // The name's own element holds the name and nothing else; the count is outside it.
      const nameElement = tile.locator(`[title="${isolated(name)}"]`);
      await expect(nameElement).toHaveCount(1);
      expect(await nameElement.evaluate((element) => element.textContent)).toBe(name);
      expect(await nameElement.getAttribute("dir")).toBe("auto");
      await expect(tile.getByText("×3", { exact: true })).toHaveCount(1);
      // One line, clipped: a stack of combining marks cannot paint over the tile below.
      const style = await nameElement.evaluate((element) => {
        const computed = getComputedStyle(element);
        return { overflow: computed.overflowY, height: element.getBoundingClientRect().height };
      });
      expect(style.overflow).toBe("hidden");
      expect(style.height).toBeLessThan(24);
    }
    // Only the card art loads; the art images are the five tiles'.
    await expect(page.locator("img")).toHaveCount(5);
    await expectNoInjectedMarkup(page);
    await expectNoSidewaysScroll(page);
    expect(raised).toEqual([]);
  });

  test("the dialog: the full name wraps inside it, the native name and every series as text", async ({
    page,
  }) => {
    const raised = scriptDialogs(page);
    for (const width of [320, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/collection");
      for (const [i, name] of HOSTILE_NAMES.entries()) {
        await grid(page)
          .locator(`button[data-entry^="${i + 1}:"]`)
          .click();
        const dialog = openDialog(page);
        await expect(dialog).toBeFocused();
        const heading = dialog.getByRole("heading", { level: 2 });
        expect(await heading.evaluate((element) => element.textContent)).toBe(name);
        expect(await dialog.getAttribute("aria-labelledby")).toBe(await heading.getAttribute("id"));
        // The native name, the primary series and `Also in` hold the strings as text.
        const texts = await dialog.evaluate((element) =>
          Array.from(element.querySelectorAll("p, bdi")).map((node) => node.textContent ?? ""),
        );
        expect(texts).toContain(`ネ${name}`);
        expect(texts).toContain(`S${name}`);
        expect(texts).toContain(`N${name}`);
        expect(texts).toContain(LONG_SERIES);
        await expect(dialog.getByText("Also in")).toBeVisible();
        // Nothing overflows the dialog sideways, the 210-character name included.
        const fit = await dialog.evaluate((element) => ({
          scroll: element.scrollWidth,
          client: element.clientWidth,
          right: element.getBoundingClientRect().right,
          heading: element.querySelector("h2")!.getBoundingClientRect().right,
        }));
        expect(fit.scroll, `${width} px, ${JSON.stringify(name).slice(0, 20)}`).toBeLessThanOrEqual(
          fit.client,
        );
        expect(fit.heading).toBeLessThanOrEqual(fit.right);
        // The copies are a sibling fact, not part of the name.
        await expect(dialog.locator("dd").nth(1)).toHaveText("3");
        await expectNoInjectedMarkup(page);
        await expectNoSidewaysScroll(page);
        await page.keyboard.press("Escape");
        await expect(openDialog(page)).toHaveCount(0);
      }
    }
    expect(raised).toEqual([]);
  });

  test("the series select and the Series view: titles as text, isolated, clipped to 60 graphemes in the options", async ({
    page,
  }) => {
    const raised = scriptDialogs(page);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/collection");
    await expect(resultsLine(page)).toHaveText("5 results");
    const options = await seriesSelect(page)
      .locator("option")
      .evaluateAll((all) => all.map((option) => option.textContent));
    expect(options).toContain(`${isolated(`${"T".repeat(60)}…`)} · 1/4`);
    expect(options).toContain(`${isolated(`S${MARKUP}`)} · 1/4`);
    expect(options).toContain(`${isolated(`S${RTL}`)} · 1/4`);
    // The long series chosen: the row keeps its width; the stats line truncates with the full title.
    await seriesSelect(page).selectOption("499");
    const statsLine = page.getByText(`${LONG_SERIES}: 1 of 4 characters`);
    await expect(statsLine).toBeVisible();
    await expect(page.locator(`p[title="${isolated(LONG_SERIES)}: 1 of 4 characters"]`)).toHaveCount(1);
    await expectNoSidewaysScroll(page);
    // The full title still matches a search (§5.6 rule 5).
    await search(page).fill("t".repeat(100));
    await expect(resultsLine(page)).toHaveText("5 results");
    // A hostile query is text in the no-match line.
    await search(page).fill(`${MARKUP}zz`);
    await expect(page.locator("bdi").filter({ hasText: `${MARKUP}zz` })).toHaveCount(1);
    await expect(page.getByText(`No cards match "${MARKUP}zz".`)).toBeVisible();
    await search(page).fill(MARKUP);
    await expect(resultsLine(page)).toHaveText("1 result");

    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await page.getByRole("button", { name: "Series", exact: true }).click();
    const section = page.getByRole("region", { name: "Series completion" });
    await expect(section.getByRole("listitem")).toHaveCount(6);
    for (const name of HOSTILE_NAMES) {
      const title = `S${name}`;
      const row = section.getByRole("listitem").filter({ has: page.locator(`[title="${isolated(title)}"]`) });
      await expect(row).toHaveCount(1);
      expect(await row.locator("bdi").evaluate((element) => element.textContent)).toBe(title);
      await expect(row.getByRole("button", { name: `Show cards from ${isolated(title)}` })).toBeVisible();
      await expect(row.getByText("1 of 4", { exact: true })).toBeVisible();
    }
    await expectNoInjectedMarkup(page);
    await expectNoSidewaysScroll(page);
    expect(raised).toEqual([]);
  });

  test("zero-width characters stay in the name: typing the visible letters does not find it (§3.3 step 1, manager decision 2026-10-30)", async ({
    page,
  }) => {
    await page.goto("/collection");
    await expect(resultsLine(page)).toHaveText("5 results");
    await search(page).fill("zerowidth");
    await expect(resultsLine(page)).toHaveText("0 results");
    // Pasting the name as AniList spells it does.
    await search(page).fill(ZERO_WIDTH);
    await expect(resultsLine(page)).toHaveText("1 result");
  });
});

// ---------------------------------------------------------------------------------------------
// Storage and the address through every interaction
// ---------------------------------------------------------------------------------------------

declare global {
  interface Window {
    __recordWrite?: (write: string) => void;
  }
}

/**
 * Records every storage, IndexedDB, cookie and history write the page makes, from the first
 * script on, into the test (so a reload does not lose what came before it).
 */
async function recordWrites(page: Page): Promise<string[]> {
  const recorded: string[] = [];
  await page.exposeFunction("__recordWrite", (write: string) => {
    recorded.push(write);
  });
  await page.addInitScript(() => {
    const writes = { push: (write: string) => void window.__recordWrite?.(write) };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      writes.push(`${this === window.localStorage ? "local" : "session"}:${key}=${value}`);
      setItem.call(this, key, value);
    };
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name: string, version?: number) {
      writes.push(`indexedDB:${name}`);
      return open.call(this, name, version);
    };
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    Object.defineProperty(Document.prototype, "cookie", {
      get() {
        return cookie.get!.call(this) as string;
      },
      set(value: string) {
        writes.push(`cookie:${value}`);
        cookie.set!.call(this, value);
      },
    });
    for (const method of ["pushState", "replaceState"] as const) {
      const original = History.prototype[method];
      History.prototype[method] = function (state: unknown, unused: string, url?: string | URL | null) {
        if (url !== undefined && url !== null) writes.push(`history:${String(url)}`);
        original.call(this, state, unused, url);
      };
    }
  });
  return recorded;
}

test("nothing reaches storage or the address through every interaction", async ({ page, api }) => {
  const data = makeOverviewCollection();
  // 130 more Commons in Bleach, so there are pages to turn.
  data.entries.push(
    ...makeLargeCollection(130).entries.map((entry) => ({
      ...entry,
      character: { ...entry.character, franchiseIds: [104] },
    })),
  );
  const many = [200, 201, 202, 203, 204, 205, 206];
  data.franchises.push(...many.map((id) => makeFranchise(id, { title: `Extra ${id}` })));
  data.entries.find((entry) => entry.character.id === 1)!.character.franchiseIds = [100, ...many];
  api.on("GET /api/collection", ok(data));
  const recorded = await recordWrites(page);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/packs");
  await mainNav(page)
    .getByRole("link", { name: /^Collection/ })
    .click();
  await expect(resultsLine(page)).toHaveText("135 results · page 1 of 3");

  // Every control of the Cards view.
  await search(page).fill("card");
  await search(page).press("Enter");
  await search(page).press("Escape");
  await chip(page, "Common").click();
  await chip(page, "Rare").click();
  await chip(page, "All").click();
  await seriesSelect(page).selectOption("104");
  await duplicatesOnly(page).check();
  await duplicatesOnly(page).uncheck();
  for (const sort of ["name", "newest", "copies", "rarity"]) await sortSelect(page).selectOption(sort);
  await clearFilters(page).click();
  await pagesNav(page).getByRole("button", { name: "Next page" }).click();
  await pagesNav(page).getByRole("combobox", { name: "Page" }).selectOption("3");
  await pagesNav(page).getByRole("button", { name: "Previous page" }).click();
  await pagesNav(page).getByRole("combobox", { name: "Page" }).selectOption("1");
  expectAddressClean(page);

  // The dialog, `and <N> more`, Close and Escape.
  await tiles(page).nth(1).click();
  const dialog = page.getByRole("dialog", { name: "Spike Spiegel" });
  await dialog.getByRole("button", { name: "and 2 more" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await tiles(page).nth(1).press("Enter");
  await page.keyboard.press("Escape");
  expectAddressClean(page);

  // The Series view, its sort and Show cards.
  await page.getByRole("button", { name: "Series", exact: true }).click();
  const section = page.getByRole("region", { name: "Series completion" });
  await section.getByRole("combobox", { name: "Sort" }).selectOption("title");
  await section.getByRole("combobox", { name: "Sort" }).selectOption("popular");
  await section
    .getByRole("button", { name: /^Show cards from/ })
    .first()
    .click();
  await expect(resultsLine(page)).toBeFocused();
  await page.getByRole("button", { name: "Cards", exact: true }).click();

  // Leaving and coming back, Back and Forward, a reload.
  await mainNav(page).getByRole("link", { name: "Packs" }).click();
  await mainNav(page)
    .getByRole("link", { name: /^Collection/ })
    .click();
  await page.goBack();
  await page.goForward();
  await expect(h1(page, "Collection")).toBeFocused();
  await page.reload();
  await expect(resultsLine(page)).toHaveText("135 results · page 1 of 3");
  expectAddressClean(page);

  // The router keeps scroll positions in sessionStorage by history entry key (navigation §3.11);
  // nothing else is written, and no write carries the search or any control.
  const other = recorded.filter(
    (write) => !write.startsWith("session:tsr-scroll-restoration") && !write.startsWith("history:"),
  );
  expect(other).toEqual([]);
  for (const write of recorded) {
    expect(write).not.toMatch(/card|spike|104|name|newest|copies|series|page=|\?|#/i);
  }
  expect(recorded.filter((write) => write.startsWith("history:"))).not.toHaveLength(0);
  const stored = await page.evaluate(async () => ({
    local: window.localStorage.length,
    session: Object.keys(window.sessionStorage),
    databases: (await indexedDB.databases()).map((db) => db.name),
    cookie: document.cookie,
  }));
  expect(stored.local).toBe(0);
  expect(stored.session.every((key) => key.startsWith("tsr-scroll-restoration"))).toBe(true);
  expect(stored.databases).toEqual([]);
  expect(stored.cookie).toBe("");
});

// ---------------------------------------------------------------------------------------------
// No snapshot, and the empty collection
// ---------------------------------------------------------------------------------------------

test.describe("states", () => {
  /** Entries held but no snapshot (§4.1, manager decision 2026-10-30): no pool, no rank, no tier. */
  function noSnapshot(): CollectionResponse {
    const data = makeOverviewCollection();
    data.snapshot = null;
    data.completion = { pool: { owned: 0, total: 0 }, franchises: [] };
    for (const entry of data.entries) {
      entry.character.tier = null;
      entry.character.rank = null;
      entry.character.inCurrentSnapshot = false;
    }
    return data;
  }

  test("no snapshot: completion hidden, the totals kept; the grid, the filters and the dialog work", async ({
    page,
    api,
  }) => {
    api.on("GET /api/collection", ok(noSnapshot()));
    await page.goto("/collection");
    await expect(resultsLine(page)).toHaveText("5 results");
    await expect(page.getByText(/ of [\d,]+ characters$/)).toHaveCount(0);
    await expect(page.getByText(/^\d+%$/)).toHaveCount(0);
    await expect(page.getByText("8 cards · 3 duplicates")).toBeVisible();
    for (const tier of ["Common 1", "Uncommon 1", "Rare 2", "Epic 3", "Legendary 1", "Mythic 0"]) {
      await expect(page.getByText(tier, { exact: true })).toBeVisible();
    }
    // No completion bar anywhere above the view switch.
    const bars = await page
      .locator("section")
      .first()
      .evaluate((section) => {
        const view = section.querySelector('[role="group"][aria-label="View"]');
        return Array.from(section.querySelectorAll('[aria-hidden="true"]')).filter(
          (node) => view !== null && node.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).length;
      });
    expect(bars).toBe(0);

    // Series options carry no figure; a series filter shows no series line.
    const options = await seriesSelect(page)
      .locator("option")
      .evaluateAll((all) => all.map((option) => option.textContent));
    expect(options.slice(1).every((option) => !/\d+\/\d+/.test(option ?? ""))).toBe(true);
    await seriesSelect(page).selectOption("100");
    await expect(resultsLine(page)).toHaveText("2 results");
    await expect(page.getByText(/characters$/)).toHaveCount(0);

    // The dialog: no rank on the card, the out-of-pool line, no tier note.
    await tiles(page).first().click();
    const dialog = openDialog(page);
    await expect(dialog.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(dialog.getByText("No longer in packs. Doesn't count toward completion.")).toBeVisible();
    await expect(dialog.getByText(/^Packs now give/)).toHaveCount(0);
    await expect(dialog.getByText(/^#/)).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The Series view has nothing to complete: one line says so, with no sort, rows or source line
    // (§4.1, manager decision 2026-10-30).
    await page.getByRole("button", { name: "Series", exact: true }).click();
    const section = page.getByRole("region", { name: "Series completion" });
    await expect(section.getByText("Series totals appear when the card pool is available.")).toBeVisible();
    await expect(section.getByRole("combobox")).toHaveCount(0);
    await expect(section.getByRole("listitem")).toHaveCount(0);
    await expect(section.getByText(/most popular anime on AniList/)).toHaveCount(0);
  });

  test("the empty collection: `No cards yet`, `Open a pack` by keyboard to the Packs heading; no stats or toolbar", async ({
    page,
    api,
  }) => {
    api.on("GET /api/collection", ok(makeCollection([])));
    await page.goto("/collection");
    await expect(page.getByRole("heading", { level: 2, name: "No cards yet" })).toBeVisible();
    await expect(page.getByRole("search")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "View" })).toHaveCount(0);
    await expect(page.getByText(/characters|duplicates|results?$/)).toHaveCount(0);
    await expect(mainNav(page).getByRole("link", { name: /^Collection/ })).toHaveAccessibleName(
      /^Collection/,
    );
    await h1(page, "Collection").focus();
    await page.keyboard.press("Tab");
    const openAPack = page.getByRole("link", { name: "Open a pack" });
    await expect(openAPack).toBeFocused();
    await expect(openAPack).toHaveAttribute("href", "/packs");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/packs$/);
    await expect(h1(page, "Packs")).toBeFocused();
    expectAddressClean(page);
  });

  test("the empty collection without a snapshot (a fresh install) is the same empty state", async ({
    page,
    api,
  }) => {
    const data = makeCollection([]);
    data.snapshot = null;
    data.completion = { pool: { owned: 0, total: 0 }, franchises: [] };
    api.on("GET /api/collection", ok(data));
    await page.goto("/collection");
    await expect(page.getByRole("heading", { level: 2, name: "No cards yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open a pack" })).toBeVisible();
    await expect(page.getByRole("search")).toHaveCount(0);
  });
});
