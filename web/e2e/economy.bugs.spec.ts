/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { makeCharacter, makeEntry } from "../src/test/fixtures";
import { deferred, expect, makeAccount, signedIn, test } from "./support/fake-api";

/**
 * Failing tests for bugs the tester found in the economy UI (feat/economy-ui, PR #51). Each one
 * fails against ab24330 and names the spec line it holds the UI to. They are not skipped: the
 * fix makes them pass.
 */

const CHRIS = makeAccount({ cards: 0 });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const theme = (page: Page) => page.getByRole("article", { name: "Action" });
const confirmation = (page: Page) => page.getByRole("dialog", { name: "Buy the Action pack?" });
const buyButton = (page: Page) => theme(page).getByRole("button", { name: "Buy…" });

/** What holds focus: its tag and its text, or `BODY` when focus fell to the page. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el === null ? null : `${el.tagName} ${el === document.body ? "" : (el.textContent ?? "")}`.trim();
  });

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedIn(CHRIS));
});

/*
 * BUG 1: Cancel and Escape on the pack confirmation drop focus to <body> in a real browser
 * (market-and-shop.md §3.8 "Focus": `Cancel` or Escape returns focus to the `Buy…` that opened
 * the confirmation). ShopPage's `onClose` calls `returnFocus.focus()` while the modal <dialog>
 * is still open, when everything outside it is inert, so the call does nothing; the dialog then
 * unmounts without `close()`, so the browser does not restore focus either. jsdom has no inert,
 * which is why ShopPage.test.tsx passes.
 * Reproduction: /shop, Buy…, then Cancel (or Escape): document.activeElement is <body>.
 */
test.describe("BUG 1: focus after closing the pack confirmation", () => {
  async function openConfirmation(page: Page) {
    await page.goto("/shop");
    await expect(h1(page, "Shop")).toBeVisible();
    await buyButton(page).click();
    await expect(confirmation(page)).toBeVisible();
  }

  test("Cancel returns focus to the Buy… that opened it", async ({ page }) => {
    await openConfirmation(page);
    await confirmation(page).getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation(page)).toHaveCount(0);
    await expect.poll(() => focused(page)).toBe("BUTTON Buy…");
  });

  test("Escape returns focus to the Buy… that opened it", async ({ page }) => {
    await openConfirmation(page);
    await page.keyboard.press("Escape");
    await expect(confirmation(page)).toHaveCount(0);
    await expect.poll(() => focused(page)).toBe("BUTTON Buy…");
  });
});

/*
 * BUG 2: a second Escape while a request is in flight closes the native <dialog> on an unknown
 * outcome (market-and-shop.md §3.3 step 5: in flight, Escape is disabled; collection-overview.md
 * §3.6 step 5 and CardDialog's own rule: nothing closes the dialog while a recycle is in flight).
 * Both dialogs only `preventDefault()` the `cancel` event. Chromium's close watcher honours that
 * once; a second Escape with no user activation in between (Escape is not an activating key)
 * closes the dialog without a cancelable `cancel` event.
 * - Shop: the <dialog> closes but BuyDialog stays mounted (no `onClose` handler), so after a
 *   lost answer the `Try again` that replays the key is hidden, and `Buy…` does nothing any more
 *   (same `key`, `showModal()` runs only on mount): the Shop is stuck until the page is left.
 * - Card dialog: the dialog closes (its `onClose` unmounts it) while the recycle is in flight.
 * Reproduction: /shop, Buy…, Buy for 400 Karma with the answer held, Escape, Escape: the
 * dialog is gone. Let the answer be lost, click Buy…: nothing opens.
 */
test.describe("BUG 2: a second Escape in flight closes the dialog", () => {
  test("Shop: the confirmation stays open in flight, and Try again shows after a lost answer", async ({
    page,
    api,
  }) => {
    const gate = deferred();
    api.on("POST /api/shop/buy", async () => {
      await gate.promise;
      return "abort" as const;
    });
    await page.goto("/shop");
    await buyButton(page).click();
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(confirmation(page).getByRole("button", { name: "Buying…" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(confirmation(page)).toBeVisible();
    gate.release();
    await expect(confirmation(page).getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("Card dialog: the recycle confirmation stays open in flight", async ({ page, api }) => {
    api.game.held = [makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), { count: 3 })];
    const gate = deferred();
    api.on("POST /api/collection/recycle", async (call) => {
      await gate.promise;
      return api.game.reply(call.key, call.body)!;
    });
    await page.goto("/collection");
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 80 Karma" }).click();
    await expect(dialog.getByRole("button", { name: "Recycling…" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    gate.release();
    await expect(dialog.getByRole("status")).toHaveText(
      "Recycled 2 copies of Spike Spiegel for 80 Karma. You have 1,320 Karma.",
    );
  });
});
