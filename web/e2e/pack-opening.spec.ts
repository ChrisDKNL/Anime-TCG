/// <reference lib="dom" />
import { makeAllowance, makeOpenedCard, makePackOpened, makePacks } from "../src/test/fixtures";
import { expect, makeAccount, recordStatusTexts, signedIn, statusTexts, test } from "./support/fake-api";

/**
 * Test plan: the packs page as a client of the api (docs/design/packs-page.md, collection-packs.md §8),
 * against the scripted api's default game (3 of 3 packs, each opening the fixture pack).
 *
 * - Opening a pack moves to /packs/open and shows the five cards the server dealt, `New` under the
 *   new ones, the summary and `Collection (5)`; the count and the pity line come from the answer.
 * - A reload keeps the collection: it is the server's, so `Collection (5)` is asked again and shown.
 * - The browser stores nothing: no `anime-tcg:` key is written, and the pre-accounts
 *   `anime-tcg:inventory:v1` value is neither read, changed nor deleted (accounts.md §3.1.3).
 * - No request leaves for AniList's API (the fixture fails the test on one).
 * - Cards unavailable; the odds page and its three ways out.
 * - The frame effects run in a real browser and stop, entrance included, under reduced motion.
 * - The reveal's columns at 320, 640 and 1024 px, with no sideways scroll.
 * - The countdown under page.clock: one GET at zero, the first pack announced, nothing after.
 */

/** The pre-accounts collection key: not read, not written, not deleted. */
const OLD_KEY = "anime-tcg:inventory:v1";
const OLD_VALUE = JSON.stringify([{ uid: "old", characterId: 1, rarity: "common" }]);

declare global {
  interface Window {
    __storageCalls?: string[];
  }
}

test("opens a pack the server deals, keeps nothing in the browser, and a reload shows the server's collection", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedIn(makeAccount()));
  // One init script, so the seeding happens before the recording on every load (Playwright does not
  // define the order of several). After seeding, every Storage call the page makes is recorded.
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
      const calls: string[] = [];
      window.__storageCalls = calls;
      const proto = Storage.prototype;
      const { getItem, setItem, removeItem, clear } = proto;
      proto.getItem = function (name: string) {
        calls.push(`getItem ${name}`);
        return getItem.call(this, name);
      };
      proto.setItem = function (name: string, text: string) {
        calls.push(`setItem ${name}`);
        setItem.call(this, name, text);
      };
      proto.removeItem = function (name: string) {
        calls.push(`removeItem ${name}`);
        removeItem.call(this, name);
      };
      proto.clear = function () {
        calls.push("clear");
        clear.call(this);
      };
    },
    [OLD_KEY, OLD_VALUE] as const,
  );

  // Signed in, `/` is replaced by /packs (navigation-and-landing.md §3.3 step 7).
  await page.goto("/");
  await expect(page).toHaveURL(/\/packs$/);
  await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
  await expect(page.getByText("Mythic guaranteed within 300 free packs.")).toBeVisible();
  const open = page.getByRole("button", { name: "Open pack" });

  await open.click();
  // The cards are on the opening page (packs-page.md §3.7); its h1 takes focus.
  await expect(page).toHaveURL(/\/packs\/open$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pack opening" })).toBeFocused();
  const reveal = page.getByRole("list", { name: "Your pack" });
  await expect(reveal.getByRole("article")).toHaveCount(5);
  await expect(reveal.getByText("New", { exact: true })).toHaveCount(5);
  await expect(page.getByText("1 Rare, 1 Uncommon and 3 Common · 5 new")).toBeVisible();
  await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
  await expect(page.getByRole("link", { name: "Collection (5)" })).toBeVisible();
  // The pity line stays on /packs, with the opening's number.
  await page.getByRole("link", { name: "Back to packs" }).click();
  await expect(page.getByText("Mythic guaranteed within 299 free packs.")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("link", { name: "Collection (5)" })).toBeVisible();
  await page.getByRole("link", { name: "Collection (5)" }).click();
  await expect(page.getByText("5 cards · No duplicates")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset" })).toHaveCount(0);

  const calls = await page.evaluate(() => window.__storageCalls ?? []);
  expect(calls.filter((call) => call === "clear" || call.endsWith(` ${OLD_KEY}`))).toEqual([]);
  expect(calls.filter((call) => call.startsWith("setItem anime-tcg:"))).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), OLD_KEY)).toBe(OLD_VALUE);
  expect(
    await page.evaluate(() =>
      [...Array(sessionStorage.length).keys()]
        .map((i) => sessionStorage.key(i))
        .filter((k) => k?.startsWith("anime-tcg:")),
    ),
  ).toEqual([]);
});

test("cards unavailable: the line and Check again, no pity line and no Pack odds", async ({ page, api }) => {
  api.on("GET /api/session", signedIn(makeAccount()));
  api.on("GET /api/packs", {
    status: 200,
    json: {
      allowance: { available: 2, cap: 3, intervalSeconds: 600, nextPackInSeconds: 120 },
      odds: null,
      packsUntilGuarantee: null,
    },
  });
  await page.goto("/packs");
  await expect(
    page.getByText("Cards are unavailable right now. Your packs are kept until they're back."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open pack" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText(/Mythic guaranteed/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pack odds" })).toHaveCount(0);
});

test("Pack odds opens the odds page; the backdrop, Escape and Close each close it onto the button", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedIn(makeAccount()));
  await page.goto("/packs");
  const trigger = page.getByRole("button", { name: "Pack odds" });
  const dialog = page.getByRole("dialog", { name: "Pack odds" });

  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog.getByRole("row")).toHaveCount(7);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

/** A pack with every animated frame: two glinting tiers and the drifting Mythic. */
const SHINY = makePackOpened({
  cards: [
    makeOpenedCard(0),
    makeOpenedCard(1),
    makeOpenedCard(2, { rarity: "epic" }),
    makeOpenedCard(3, { rarity: "legendary" }),
    makeOpenedCard(4, { rarity: "mythic" }),
  ],
});

test("the frames glint and drift in the reveal, and nothing on the page animates under reduced motion", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedIn(makeAccount()));
  api.on("POST /api/packs/open", { status: 201, json: SHINY });
  await page.goto("/packs");
  await page.getByRole("button", { name: "Open pack" }).click();
  await expect(page.getByRole("list", { name: "Your pack" }).getByRole("article")).toHaveCount(5);
  // The entrance (five items) and the glint or drift of three cards.
  const running = await page.evaluate(() =>
    document.getAnimations().map((animation) => (animation as CSSAnimation).animationName),
  );
  expect(running.filter((name) => name === "card-glint")).toHaveLength(2);
  expect(running.filter((name) => name === "card-pearl")).toHaveLength(1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.getByRole("button", { name: "Open pack" }).click();
  await expect(page.getByRole("list", { name: "Your pack" }).getByRole("article")).toHaveCount(5);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  // The glows are still there, as still images.
  await expect(page.getByRole("article", { name: /, Mythic,/ })).toHaveCSS(
    "box-shadow",
    /rgba\(170, 140, 240, 0\.5\)/,
  );
});

for (const [width, columns] of [
  [320, 2],
  [640, 3],
  [1024, 5],
] as const) {
  test(`${width} px: the reveal has ${columns} columns and the page does not scroll sideways`, async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(makeAccount()));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/packs");
    await page.getByRole("button", { name: "Open pack" }).click();
    const list = page.getByRole("list", { name: "Your pack" });
    await expect(list.getByRole("listitem")).toHaveCount(5);
    const tops = await list
      .getByRole("listitem")
      // offsetTop ignores the entrance's transform, so the rows are read while it still runs.
      .evaluateAll((items) => items.map((item) => (item as HTMLElement).offsetTop));
    expect(tops.filter((top) => top === tops[0])).toHaveLength(columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("the countdown asks once at zero, announces the first pack, and nothing after (page.clock)", async ({
  page,
  api,
}) => {
  await recordStatusTexts(page);
  await page.clock.install();
  api.on("GET /api/session", signedIn(makeAccount()));
  api.on(
    "GET /api/packs",
    { status: 200, json: makePacks({ allowance: makeAllowance({ available: 0, nextPackInSeconds: 5 }) }) },
    { status: 200, json: makePacks({ allowance: makeAllowance({ available: 1, nextPackInSeconds: 600 }) }) },
  );
  await page.goto("/packs");
  await expect(page.getByText("Next pack in 0:05")).toBeVisible();
  const open = page.getByRole("button", { name: "Open pack" });
  await expect(open).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(5_000);
  await expect(page.getByText("1 of 3 packs ready", { exact: true })).toBeVisible();
  await expect(open).not.toHaveAttribute("aria-disabled");
  expect(api.count("GET /api/packs")).toBe(2);
  await expect.poll(() => statusTexts(page)).toContain("1 of 3 packs ready.");

  await page.clock.runFor(9 * 60_000);
  expect(api.count("GET /api/packs")).toBe(2);
  await expect(page).toHaveTitle("Packs · Anime TCG");
});
