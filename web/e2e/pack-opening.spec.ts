/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import type { SessionResponse } from "@anime-tcg/shared/api";
import { makeAniListResponse, makeCard } from "../src/test/fixtures";

// 1x1 transparent PNG so card images resolve without hitting AniList's CDN.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** The pre-accounts collection key (accounts.md §3.1.3): not read, not written, not deleted. */
const OLD_KEY = "anime-tcg:inventory:v1";
const OLD_VALUE = JSON.stringify([makeCard()]);

const SIGNED_IN: SessionResponse = {
  signedIn: true,
  account: {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    login: "Chris",
    createdAt: "2026-10-28T09:30:00.000Z",
    cards: 0,
  },
};

declare global {
  interface Window {
    __storageCalls?: string[];
  }
}

test.beforeEach(async ({ page }) => {
  // Never hit the real API in e2e: deterministic pool, no rate-limit flakiness.
  await page.route("https://graphql.anilist.co/**", (route) =>
    route.fulfill({ json: makeAniListResponse(20) }),
  );
  await page.route("https://s4.anilist.co/**", (route) =>
    route.fulfill({ body: PNG, contentType: "image/png" }),
  );
  // The game only renders with a session (accounts.md §3.1); the api answers signed in.
  await page.route(
    (url) => url.pathname === "/api/session",
    (route) => route.fulfill({ json: SIGNED_IN }),
  );
});

test("opens a pack, badges new cards, and keeps the collection in memory only: a reload empties it and leaves the old key alone", async ({
  page,
}) => {
  // One init script, so the seeding happens before the recording on every load (Playwright does not
  // define the order of several). A browser that played the pre-accounts proof of concept still holds
  // its collection under OLD_KEY; after seeding, every Storage call the page makes is recorded.
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
  const open = page.getByRole("button", { name: /open booster pack/i });
  await expect(open).toBeEnabled();

  await open.click();
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(page.getByText("New", { exact: true })).toHaveCount(5);
  await expect(page.getByRole("link", { name: /collection \(5\)/i })).toBeVisible();

  await open.click();
  await expect(page.getByRole("link", { name: /collection \(10\)/i })).toBeVisible();
  await page.getByRole("link", { name: /collection \(10\)/i }).click();
  await expect(page).toHaveURL(/\/collection$/);
  await expect(page.getByText("10 cards")).toBeVisible();
  const touchesOldKey = (call: string) => call === "clear" || call.endsWith(` ${OLD_KEY}`);
  const firstLoad = await page.evaluate(() => window.__storageCalls ?? []);
  // The recorder sees the app's own storage traffic (the AniList pool cache), so an empty filter means something.
  expect(firstLoad).toContain("getItem anime-tcg:character-pool:v1");
  expect(firstLoad.filter(touchesOldKey)).toEqual([]);

  // Until roadmap 1c the collection lives in memory for the session only (accounts.md §3.1.3, §3.7):
  // a reload starts it empty, and the old key is neither read, rewritten nor deleted.
  // The reload is on /collection now that it has an address; the collection comes back empty there.
  await page.reload();
  await expect(page.getByRole("link", { name: /collection \(0\)/i })).toBeVisible();
  await expect(page.getByText("Your collection is empty. Open a pack to get started.")).toBeVisible();
  await page.getByRole("link", { name: "Packs", exact: true }).click();
  await expect(page.getByRole("button", { name: /open booster pack/i })).toBeEnabled();
  const afterReload = await page.evaluate(() => window.__storageCalls ?? []);
  expect(afterReload).toContain("getItem anime-tcg:character-pool:v1");
  expect(afterReload.filter(touchesOldKey)).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), OLD_KEY)).toBe(OLD_VALUE);
});

test("shows a retry banner when AniList is unavailable", async ({ page }) => {
  await page.route("https://graphql.anilist.co/**", (route) => route.fulfill({ status: 500, body: "boom" }));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("HTTP 500");
  await expect(page.getByRole("button", { name: /open booster pack/i })).toBeDisabled();
});
