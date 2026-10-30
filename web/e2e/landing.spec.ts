/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import {
  makeCharacter,
  makeDemo,
  makeDemoCard,
  makeDemoOpened,
  makeUnavailableDemo,
} from "../src/test/fixtures";
import { envelope, expect, recordStatusTexts, signedOut, statusTexts, test } from "./support/fake-api";

/**
 * Test plan: the landing page's demo pack in a real browser against the scripted api
 * (docs/design/navigation-and-landing.md §3.7, §3.8, §4.5, §7, §8).
 *
 * - The journey: the lede, the rows and the odds table from `GET /api/demo`; the disclosure under
 *   `Open a demo pack`; a pack's five cards in slot order, the summary read once, the keep-cards line;
 *   the tenth pack puts the Join offer, focused, in the button's place; nothing in storage, nothing
 *   in the address; a reload starts the visit over.
 * - The demo card is the reveal card without effects: no glow, no glint, no drift.
 * - Rate limited (429 with Retry-After, and without it under page.clock), unavailable (no pool in the
 *   facts, and a 503 on an opening), a failed opening, and facts that get no answer.
 */

const LEDE = "2,983 characters from the 100 most popular anime on AniList, five to a pack.";
const DISCLOSURE =
  "A demo pack uses the same odds as every pack in the game. Its cards aren't kept: nothing is saved, and they don't go to any account.";
const JOIN = "Playing needs an account, and registering needs an invite code from the owner.";
const WAIT = "Demo packs take a short pause after many in a row. The button comes back by itself.";
const KEEP = "To keep cards, register with an invite code.";

const main = (page: Page) => page.getByRole("main");
const demoButton = (page: Page, name = "Open a demo pack") =>
  main(page).getByRole("button", { name, exact: true });
const demoList = (page: Page) => page.getByRole("list", { name: "Demo pack" });

async function storageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
}

test("the demo journey: the server's facts, ten demo packs, then the Join offer; nothing kept", async ({
  page,
  api,
}) => {
  await recordStatusTexts(page);
  api.on("GET /api/session", signedOut);
  await page.goto("/");
  await expect(page.getByText(LEDE)).toBeVisible();
  await expect(
    page.getByText("A new pack every 10 minutes, and up to 3 can pile up. Five cards each."),
  ).toBeVisible();
  const odds = page.getByRole("table", { name: "Pack odds" });
  await expect(odds.getByRole("row")).toHaveCount(7);
  await expect(odds.getByRole("row", { name: /^Mythic/ })).toContainText("0.25%");
  await expect(odds.getByRole("row", { name: /^Mythic/ })).toContainText("0.05%");
  await expect(page.getByText("Drawn from 2,983 characters, as of 29 Oct 2026.")).toBeVisible();
  await expect(page.getByText(DISCLOSURE)).toBeVisible();
  await expect(page.getByText(KEEP)).toHaveCount(0);

  const open = demoButton(page);
  await open.click();
  const list = demoList(page);
  await expect(list.getByRole("listitem")).toHaveCount(5);
  expect(
    await list.getByRole("listitem").evaluateAll((items) => items.map((item) => item.dataset.slot)),
  ).toEqual(["0", "1", "2", "3", "4"]);
  await expect(
    main(page).getByText("Demo pack: 1 Rare, 1 Uncommon and 3 Common", { exact: true }),
  ).toBeVisible();
  await expect(main(page).getByText(KEEP)).toBeVisible();
  await expect(main(page).getByText(KEEP).getByRole("link", { name: "register" })).toHaveAttribute(
    "href",
    "/register",
  );
  await expect(open).toBeFocused();
  await expect.poll(() => statusTexts(page)).toContain("Demo pack: 1 Rare, 1 Uncommon and 3 Common.");
  expect(
    (await statusTexts(page)).filter((text) => text === "Demo pack: 1 Rare, 1 Uncommon and 3 Common."),
  ).toHaveLength(1);

  // Nine more, each replacing the last; the button reads the same every time.
  for (let n = 2; n <= 10; n += 1) {
    if (n < 10) {
      await open.click();
      await expect(list.getByRole("article").first()).toHaveAccessibleName(
        new RegExp(`Character ${5_000 + n * 10}\\b`),
      );
      await expect(open).toHaveText("Open a demo pack");
    } else {
      await open.click();
    }
  }
  await expect(main(page).getByText(JOIN).first()).toBeFocused();
  await expect(main(page).getByRole("button")).toHaveCount(0);
  await expect(page.getByText(DISCLOSURE)).toHaveCount(0);
  await expect(page.getByText(KEEP)).toHaveCount(0);
  await expect(list.getByRole("article").first()).toHaveAccessibleName(/Character 5100\b/);
  expect(api.count("POST /api/demo/open")).toBe(10);
  expect(api.bodies("POST /api/demo/open").every((body) => body === undefined)).toBe(true);

  expect(await storageKeys(page)).toEqual([]);
  expect(new URL(page.url()).pathname).toBe("/");
  expect(new URL(page.url()).search).toBe("");

  // A reload starts the visit over: no cards, the button back.
  await page.reload();
  await expect(demoButton(page)).toBeVisible();
  await expect(demoList(page)).toHaveCount(0);
});

test("the demo card is the tier frame alone: no glow, glint or drift, even for a Mythic", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedOut);
  const rarities = ["common", "common", "common", "uncommon", "mythic"] as const;
  api.on("POST /api/demo/open", {
    status: 200,
    json: makeDemoOpened(
      rarities.map((rarity, slot) =>
        makeDemoCard(slot, { rarity, character: makeCharacter(9_000 + slot, { tier: rarity }) }),
      ),
    ),
  });
  await page.goto("/");
  await demoButton(page).click();
  const mythic = demoList(page).getByRole("article", { name: /Mythic/ });
  await expect(mythic).toBeVisible();
  // Let the 200 ms entrance end; the frame itself runs nothing.
  await expect.poll(() => mythic.evaluate((card) => card.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await mythic.evaluate((card) => getComputedStyle(card).boxShadow)).toBe("none");
});

test("a double click and a held Enter each spend one demo pack (manager decision, 2026-10-30)", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedOut);
  await page.goto("/");
  await demoButton(page).dblclick();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  await expect(demoButton(page)).not.toHaveAttribute("aria-disabled");
  expect(api.count("POST /api/demo/open")).toBe(1);

  await demoButton(page).focus();
  await page.keyboard.down("Enter");
  for (let i = 0; i < 4; i += 1) await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(demoList(page).getByRole("article").first()).toHaveAccessibleName(/Character 5020\b/);
  await expect(demoButton(page)).not.toHaveAttribute("aria-disabled");
  expect(api.count("POST /api/demo/open")).toBe(2);
});

test("rate limited with Retry-After: the button counts down, the wait line once, then it is back", async ({
  page,
  api,
}) => {
  await recordStatusTexts(page);
  api.on("GET /api/session", signedOut);
  api.on("POST /api/demo/open", { ...envelope(429, "rate_limited"), headers: { "Retry-After": "2" } });
  await page.goto("/");
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
});

test("rate limited without Retry-After: `Open a demo pack` stays aria-disabled for 60 s (page.clock)", async ({
  page,
  api,
}) => {
  await page.clock.install();
  api.on("GET /api/session", signedOut);
  api.on("POST /api/demo/open", envelope(429, "rate_limited"), {
    status: 200,
    json: makeDemoOpened(),
  });
  await page.goto("/");
  await demoButton(page).click();
  await expect(page.getByText(WAIT)).toBeVisible();
  await expect(demoButton(page)).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(59_000);
  await expect(demoButton(page)).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(1_000);
  await expect(demoButton(page)).not.toHaveAttribute("aria-disabled");
  await demoButton(page).click();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
});

test("no pool: the unavailable line in the button's place and no odds block", async ({ page, api }) => {
  api.on("GET /api/session", signedOut);
  api.on("GET /api/demo", { status: 200, json: makeUnavailableDemo() });
  await page.goto("/");
  await expect(page.getByText("Demo packs are unavailable right now.")).toBeVisible();
  await expect(main(page).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(
    page.getByText("Characters from the most popular anime on AniList, five to a pack."),
  ).toBeVisible();
  expect(api.count("POST /api/demo/open")).toBe(0);
});

test("a 503 on an opening: the unavailable line, the cards already shown stay", async ({ page, api }) => {
  api.on("GET /api/session", signedOut);
  api.on("POST /api/demo/open", { status: 200, json: makeDemoOpened() }, envelope(503, "pool_unavailable"));
  await page.goto("/");
  await demoButton(page).click();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  await demoButton(page).click();
  await expect(page.getByText("Demo packs are unavailable right now.")).toBeVisible();
  await expect(main(page).getByRole("button")).toHaveCount(0);
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
});

test("an opening with no answer: the failure alert, the cards kept, and Try again opens", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedOut);
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
  await demoButton(page).click();
  await expect(main(page).getByRole("alert")).toHaveCount(0);
  expect(api.count("POST /api/demo/open")).toBe(3);
});

test("facts with no answer: the unreachable banner over the no-facts page, and the demo still opens", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedOut);
  api.on("GET /api/demo", "abort", { status: 200, json: makeDemo() });
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't reach the game server." })).toBeVisible();
  await expect(
    page.getByText("Characters from the most popular anime on AniList, five to a pack."),
  ).toBeVisible();
  await demoButton(page).click();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByText(LEDE)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const width of [320, 640, 1024]) {
  test(`at ${width} px the page with a demo pack and the odds table has no sideways scroll`, async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await demoButton(page).click();
    await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
    await expect(page.getByRole("table", { name: "Pack odds" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
