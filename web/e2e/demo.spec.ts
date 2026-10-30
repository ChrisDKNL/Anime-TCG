/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { makeCharacter, makeDemoCard, makeDemoOpened } from "../src/test/fixtures";
import {
  deferred,
  envelope,
  expect,
  makeAccount,
  recordStatusTexts,
  signedIn,
  signedOut,
  statusTexts,
  test,
} from "./support/fake-api";

/**
 * Test plan: the demo pack's own page, `/demo`, in a real browser against the scripted api
 * (docs/design/navigation-and-landing.md §3.7 items 1.3 to 1.7, §3.14, §4.9, §5.4, §7, §11 item 7).
 * Every landing demo test of #42 is here, moved to `/demo`.
 *
 * - `Open a demo pack` on `/` sends one POST, pushes `/demo` (title, focus on its `h1`); a double
 *   click and a held Enter send one POST and push once.
 * - On `/demo` the button opens the next pack in place (no URL change, focus kept, the summary read
 *   once); the tenth pack puts the Join offer in the button's place, on `/demo` and on `/`.
 * - Back to `/` with its `h1` focused; Forward shows the held cards with no running animation;
 *   `Back to the landing page` pushes `/`.
 * - A direct load and a reload show the page ready, and the count starts over; signed in it ends on `/packs`.
 * - 503, 429 (with and without Retry-After) and a lost answer show on `/demo`; nothing navigates.
 * - The demo card has no glow, glint or drift; nothing is kept in storage or the address.
 */

const DISCLOSURE =
  "A demo pack uses the same odds as every pack in the game. Its cards aren't kept: nothing is saved, and they don't go to any account.";
const JOIN = "Playing needs an account, and registering needs an invite code from the owner.";
const WAIT = "Demo packs take a short pause after many in a row. The button comes back by itself.";
const KEEP = "To keep cards, register with an invite code.";

const main = (page: Page) => page.getByRole("main");
const demoButton = (page: Page, name = "Open a demo pack") =>
  main(page).getByRole("button", { name, exact: true });
const demoList = (page: Page) => page.getByRole("list", { name: "Demo pack" });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

async function storageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
}

/** The cards on the page: nothing animating once they are there. */
function runningAnimations(page: Page) {
  return demoList(page).evaluate((list) => list.getAnimations({ subtree: true }).length);
}

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedOut);
});

test("the demo journey: from / to /demo, ten demo packs in place, then the Join offer on /demo and /; nothing kept", async ({
  page,
  api,
}) => {
  await recordStatusTexts(page);
  await page.goto("/");
  await expect(page.getByRole("table", { name: "Pack odds" })).toBeVisible();
  const entries = await page.evaluate(() => history.length);
  await demoButton(page).click();

  await expect(page).toHaveURL(/\/demo$/);
  await expect(page).toHaveTitle("Demo pack · Anime TCG");
  await expect(h1(page, "Demo pack")).toBeFocused();
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);
  const list = demoList(page);
  await expect(list.getByRole("listitem")).toHaveCount(5);
  expect(
    await list.getByRole("listitem").evaluateAll((items) => items.map((item) => item.dataset.slot)),
  ).toEqual(["0", "1", "2", "3", "4"]);
  await expect(
    main(page).getByText("Demo pack: 1 Rare, 1 Uncommon and 3 Common", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(DISCLOSURE)).toBeVisible();
  await expect(main(page).getByText(KEEP)).toBeVisible();
  await expect(main(page).getByText(KEEP).getByRole("link", { name: "register" })).toHaveAttribute(
    "href",
    "/register",
  );
  await expect.poll(() => statusTexts(page)).toContain("Demo pack: 1 Rare, 1 Uncommon and 3 Common.");
  expect(
    (await statusTexts(page)).filter((text) => text === "Demo pack: 1 Rare, 1 Uncommon and 3 Common."),
  ).toHaveLength(1);

  // Nine more, in place: the address stays, the button reads the same and keeps focus every time.
  const open = demoButton(page);
  for (let n = 2; n <= 10; n += 1) {
    await open.click();
    if (n === 10) break;
    await expect(list.getByRole("article").first()).toHaveAccessibleName(
      new RegExp(`Character ${5_000 + n * 10}\\b`),
    );
    await expect(open).toHaveText("Open a demo pack");
    await expect(open).toBeFocused();
    await expect(page).toHaveURL(/\/demo$/);
  }
  await expect(main(page).getByText(JOIN).first()).toBeFocused();
  await expect(main(page).getByRole("button")).toHaveCount(0);
  await expect(page.getByText(DISCLOSURE)).toHaveCount(0);
  await expect(page.getByText(KEEP)).toHaveCount(0);
  await expect(main(page).getByRole("link", { name: "Back to the landing page" })).toBeVisible();
  await expect(list.getByRole("article").first()).toHaveAccessibleName(/Character 5100\b/);
  await expect(page.getByText(/\b(remaining|last one|used up|tries)\b|\bof 10\b/i)).toHaveCount(0);
  expect(api.count("POST /api/demo/open")).toBe(10);
  expect(api.bodies("POST /api/demo/open").every((body) => body === undefined)).toBe(true);
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);

  // On `/` the Join offer stands in the button's place too, and focus stays with the page's h1.
  await main(page).getByRole("link", { name: "Back to the landing page" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(h1(page, "Anime TCG")).toBeFocused();
  const hero = page.getByRole("region", { name: "Anime TCG" });
  await expect(hero.getByRole("button")).toHaveCount(0);
  await expect(hero.getByText(JOIN)).toBeVisible();

  expect(await storageKeys(page)).toEqual([]);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
});

test("Back from /demo returns to / with its h1 focused; Forward shows the held cards with no animation", async ({
  page,
}) => {
  await page.goto("/");
  await demoButton(page).click();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  const first = await demoList(page).getByRole("article").first().getAttribute("aria-label");

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(h1(page, "Anime TCG")).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(h1(page, "Demo pack")).toBeFocused();
  await expect(demoList(page).getByRole("article").first()).toHaveAttribute("aria-label", first ?? "");
  expect(await runningAnimations(page)).toBe(0);
  await expect(main(page).getByText(KEEP)).toBeVisible();
});

test("a direct load and a reload of /demo show the page ready, and the count starts over", async ({
  page,
  api,
}) => {
  await page.goto("/demo");
  await expect(page).toHaveTitle("Demo pack · Anime TCG");
  await expect(demoButton(page)).toBeEnabled();
  await expect(demoButton(page)).not.toHaveAttribute("aria-disabled");
  await expect(page.getByText(DISCLOSURE)).toBeVisible();
  await expect(main(page).locator(".aspect-\\[5\\/7\\]")).toHaveCount(5);
  await expect(demoList(page)).toHaveCount(0);
  expect(api.count("GET /api/demo")).toBe(1);

  await demoButton(page).click();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  await page.reload();
  await expect(demoButton(page)).toBeVisible();
  await expect(demoList(page)).toHaveCount(0);
  await expect(main(page).locator(".aspect-\\[5\\/7\\]")).toHaveCount(5);
  expect(new URL(page.url()).pathname).toBe("/demo");
});

test("signed in, /demo ends on /packs", async ({ page, api }) => {
  api.on("GET /api/session", signedIn(makeAccount()));
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/packs$/);
  await expect(h1(page, "Packs")).toBeVisible();
});

test("the demo card is the tier frame alone: no glow, glint or drift, even for a Mythic", async ({
  page,
  api,
}) => {
  const rarities = ["common", "common", "common", "uncommon", "mythic"] as const;
  api.on("POST /api/demo/open", {
    status: 200,
    json: makeDemoOpened(
      rarities.map((rarity, slot) =>
        makeDemoCard(slot, { rarity, character: makeCharacter(9_000 + slot, { tier: rarity }) }),
      ),
    ),
  });
  await page.goto("/demo");
  await demoButton(page).click();
  const mythic = demoList(page).getByRole("article", { name: /Mythic/ });
  await expect(mythic).toBeVisible();
  // Let the 200 ms entrance end; the frame itself runs nothing.
  await expect.poll(() => mythic.evaluate((card) => card.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await mythic.evaluate((card) => getComputedStyle(card).boxShadow)).toBe("none");
});

test("a double click and a held Enter on / each send one POST and push /demo once (manager decision, 2026-10-30)", async ({
  page,
  api,
}) => {
  await page.goto("/");
  const entries = await page.evaluate(() => history.length);
  await demoButton(page).dblclick();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  await expect(demoButton(page)).not.toHaveAttribute("aria-disabled");
  expect(api.count("POST /api/demo/open")).toBe(1);
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);

  // A held Enter on `/demo`'s own button: one more pack, in place.
  await demoButton(page).focus();
  await page.keyboard.down("Enter");
  for (let i = 0; i < 4; i += 1) await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(demoList(page).getByRole("article").first()).toHaveAccessibleName(/Character 5020\b/);
  await expect(demoButton(page)).not.toHaveAttribute("aria-disabled");
  expect(api.count("POST /api/demo/open")).toBe(2);

  // A held Enter on `/`'s button: one POST, one push.
  await page.goto("/");
  const before = await page.evaluate(() => history.length);
  await demoButton(page).focus();
  await page.keyboard.down("Enter");
  for (let i = 0; i < 4; i += 1) await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(page).toHaveURL(/\/demo$/);
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  expect(api.count("POST /api/demo/open")).toBe(1 + 2);
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
});

test("in flight from /: Opening… over five empty slots on /demo, the h1 focused, then the cards", async ({
  page,
  api,
}) => {
  const answer = deferred();
  api.on("POST /api/demo/open", async () => {
    await answer.promise;
    return { status: 200, json: makeDemoOpened() };
  });
  await page.goto("/");
  await demoButton(page).click();
  await expect(h1(page, "Demo pack")).toBeFocused();
  await expect(demoButton(page, "Opening…")).toHaveAttribute("aria-disabled", "true");
  await expect(main(page).locator(".aspect-\\[5\\/7\\]")).toHaveCount(5);
  answer.release();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  await expect(h1(page, "Demo pack")).toBeFocused();
});

test("rate limited with Retry-After: the button counts down on /demo, the wait line once, then it is back", async ({
  page,
  api,
}) => {
  await recordStatusTexts(page);
  api.on("POST /api/demo/open", { ...envelope(429, "rate_limited"), headers: { "Retry-After": "2" } });
  await page.goto("/demo");
  await demoButton(page).click();
  const waiting = demoButton(page, "Try again in 2 s");
  await expect(waiting).toHaveAttribute("aria-disabled", "true");
  await expect(waiting).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: WAIT })).toBeVisible();
  // Playwright's click waits for an aria-disabled button to be enabled; a raw click is what a user's is.
  await waiting.dispatchEvent("click");
  expect(api.count("POST /api/demo/open")).toBe(1);
  await expect(demoButton(page, "Try again in 1 s")).toBeVisible();
  await expect(demoButton(page)).not.toHaveAttribute("aria-disabled");
  await expect(page.getByText(WAIT)).toHaveCount(0);
  await expect.poll(() => statusTexts(page)).toContain("You can try again now.");
  expect((await statusTexts(page)).filter((text) => text === WAIT)).toHaveLength(1);
  expect(new URL(page.url()).pathname).toBe("/demo");
});

test("rate limited without Retry-After: `Open a demo pack` stays aria-disabled for 60 s (page.clock)", async ({
  page,
  api,
}) => {
  await page.clock.install();
  api.on("POST /api/demo/open", envelope(429, "rate_limited"), {
    status: 200,
    json: makeDemoOpened(),
  });
  await page.goto("/");
  await demoButton(page).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByText(WAIT)).toBeVisible();
  await expect(demoButton(page)).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(59_000);
  await expect(demoButton(page)).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(1_000);
  await expect(demoButton(page)).not.toHaveAttribute("aria-disabled");
  await demoButton(page).click();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  expect(new URL(page.url()).pathname).toBe("/demo");
});

test("a 503 on an opening: the unavailable line on /demo, the cards already shown stay", async ({
  page,
  api,
}) => {
  api.on("POST /api/demo/open", { status: 200, json: makeDemoOpened() }, envelope(503, "pool_unavailable"));
  await page.goto("/");
  await demoButton(page).click();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  await demoButton(page).click();
  await expect(page.getByText("Demo packs are unavailable right now.")).toBeVisible();
  await expect(main(page).getByRole("button")).toHaveCount(0);
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  expect(new URL(page.url()).pathname).toBe("/demo");
});

test("an opening with no answer: the failure alert on /demo, the cards kept, and Try again opens", async ({
  page,
  api,
}) => {
  api.on("POST /api/demo/open", { status: 200, json: makeDemoOpened() }, "abort", {
    status: 200,
    json: makeDemoOpened(),
  });
  await page.goto("/");
  await demoButton(page).click();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  await demoButton(page).click();
  await expect(main(page).getByRole("alert")).toHaveText("Couldn't reach the game server. Try again.");
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  expect(new URL(page.url()).pathname).toBe("/demo");
  await demoButton(page).click();
  await expect(main(page).getByRole("alert")).toHaveCount(0);
  expect(api.count("POST /api/demo/open")).toBe(3);
});

for (const width of [320, 640, 1024]) {
  test(`at ${width} px /demo with a demo pack has no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/demo");
    await demoButton(page).click();
    await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
