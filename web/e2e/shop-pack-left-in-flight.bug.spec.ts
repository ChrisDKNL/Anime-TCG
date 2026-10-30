/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { deferred, expect, makeAccount, signedIn, test } from "./support/fake-api";

/**
 * Bug (tester, 2026-10-30): a shop purchase whose answer lands after the player left `/shop` (Back
 * with the confirmation in flight) is not held for `/shop/open`.
 *
 * Spec: navigation-and-landing.md §3.10 item 4 and market-and-shop.md §3.2 item 6 ("Back with a
 * confirmation ... open leaves the page; the dialog closes with it, an in-flight request finishes and
 * its result applies to the layout's state"); §3.10 item 1 and §3.13 step 2 put "the bought pack that
 * `/shop/open` shows" in that state; market-and-shop.md §3.3 step 6: while a pack is held, `/shop`
 * shows `See your latest shop pack`. The purchase must navigate nowhere (opening-pages.hunt.spec.ts
 * checks that, and it holds).
 *
 * What happens: the balance and the collection take the answer, but the pack is dropped. BuyDialog's
 * `confirm` calls `settle` (and so `onBought` → `game.holdShopPack`) only while the dialog is
 * mounted, so after Back nothing holds the pack: `/shop` shows no `See your latest shop pack`, and
 * the player never sees the five cards they spent 400 Karma on, except as entries in the collection.
 *
 * Reproduction: sign in, open `/packs`, follow `Shop`, `Buy…` on Action, `Buy for 400 Karma`; press
 * the browser's Back while the `POST /api/shop/buy` is in flight; let it answer 201; follow `Shop`.
 */

const CHRIS = makeAccount({ cards: 0 });
const main = (page: Page) => page.getByRole("main");
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("a purchase answered after Back left /shop is still held: See your latest shop pack shows its cards", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedIn(CHRIS));
  const answer = deferred();
  api.on("POST /api/shop/buy", async (call) => {
    await answer.promise;
    return api.game.reply(call.key, call.body)!;
  });
  await page.goto("/packs");
  await nav(page).getByRole("link", { name: "Shop", exact: true }).click();
  await expect(h1(page, "Shop")).toBeFocused();
  await page.getByRole("article", { name: "Action" }).getByRole("button", { name: "Buy…" }).click();
  await page
    .getByRole("dialog", { name: "Buy the Action pack?" })
    .getByRole("button", { name: "Buy for 400 Karma" })
    .click();
  await expect.poll(() => api.count("POST /api/shop/buy")).toBe(1);

  await page.goBack();
  await expect(h1(page, "Packs")).toBeFocused();
  answer.release();
  await expect(nav(page).getByRole("link", { name: "Collection (5)" })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("840");

  await nav(page).getByRole("link", { name: "Shop", exact: true }).click();
  await expect(h1(page, "Shop")).toBeFocused();
  const latest = main(page).getByRole("link", { name: "See your latest shop pack" });
  await expect(latest).toBeVisible();
  await latest.click();
  await expect(h1(page, "Shop pack")).toBeFocused();
  const list = page.getByRole("list", { name: "Action pack" });
  await expect(list.getByRole("article")).toHaveCount(5);
  // Its first showing is this one, but it did not land while the page showed: no entrance.
  expect(await list.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
});
