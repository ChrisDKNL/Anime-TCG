/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { expect, makeAccount, signedIn, test } from "./support/fake-api";

/**
 * Failing on purpose until fixed (bugs, not flakes): the tester's packs hunt found these
 * (docs/design/packs-page.md §3.3 step 2, §10 item 5: "a double click or a held Enter sends one
 * request", "the count falls by exactly one").
 *
 * The single-flight guard only covers the time the opening is in flight. When the server answers
 * faster than the player's second click or the keyboard's next auto-repeat (a local or LAN api
 * answers in tens of milliseconds; a double click is up to ~500 ms, an auto-repeat every ~33 ms
 * after ~500 ms), `Open pack` is enabled again and the late activation opens another pack.
 *
 * Reproduction by hand: on /packs with 3 of 3 ready, hold Enter on `Open pack` for one second: all
 * three packs open. Or double-click it at a normal pace: two packs open.
 *
 * The in-flight half of both cases passes in packs.hunt.spec.ts.
 */

const openButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: "Open pack", exact: true });
const names = (page: Page) =>
  page
    .getByRole("list", { name: "Your pack" })
    .getByRole("article")
    .evaluateAll((articles) => articles.map((a) => a.querySelector("[title]")?.getAttribute("title")));
const FIRST_PACK = [1010, 1011, 1012, 1013, 1014].map((id) => `Character ${id}`);

test("BUG: a double click whose second click comes after the answer opens a second pack", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedIn(makeAccount()));
  await page.goto("/packs");
  await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
  const box = await openButton(page).boundingBox();
  if (box === null) throw new Error("Open pack has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // The first click of the double click; the server answers before the second one.
  await page.mouse.click(x, y);
  await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
  // The second click of the same double click (`detail` 2, as the browser sends it).
  await page.mouse.click(x, y, { clickCount: 2 });
  await page.waitForLoadState("networkidle");

  expect(api.count("POST /api/packs/open"), "openings sent by one double click").toBe(1);
  await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
  expect(await names(page)).toEqual(FIRST_PACK);
});

test("BUG: Enter held past the answer keeps opening packs", async ({ page, api }) => {
  api.on("GET /api/session", signedIn(makeAccount()));
  await page.goto("/packs");
  await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
  await openButton(page).focus();

  await page.keyboard.down("Enter");
  await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
  // The key is still down: the keyboard's auto-repeat (`repeat: true`).
  for (let repeat = 0; repeat < 3; repeat += 1) await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await page.waitForLoadState("networkidle");

  expect(api.count("POST /api/packs/open"), "openings sent by one held Enter").toBe(1);
  await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
  expect(await names(page)).toEqual(FIRST_PACK);
});
