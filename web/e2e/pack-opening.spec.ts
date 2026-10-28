import { expect, test } from "@playwright/test";
import { makeAniListResponse } from "../src/test/fixtures";

// 1x1 transparent PNG so card images resolve without hitting AniList's CDN.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.beforeEach(async ({ page }) => {
  // Never hit the real API in e2e: deterministic pool, no rate-limit flakiness.
  await page.route("https://graphql.anilist.co/**", (route) =>
    route.fulfill({ json: makeAniListResponse(20) }),
  );
  await page.route("https://s4.anilist.co/**", (route) =>
    route.fulfill({ body: PNG, contentType: "image/png" }),
  );
});

test("opens a pack, badges new cards, and persists the collection across reload", async ({ page }) => {
  await page.goto("/");
  const open = page.getByRole("button", { name: /open booster pack/i });
  await expect(open).toBeEnabled();

  await open.click();
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(page.getByText("New", { exact: true })).toHaveCount(5);
  await expect(page.getByRole("button", { name: /collection \(5\)/i })).toBeVisible();

  await open.click();
  await expect(page.getByRole("button", { name: /collection \(10\)/i })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /collection \(10\)/i })).toBeVisible();
  await page.getByRole("button", { name: /collection \(10\)/i }).click();
  await expect(page.getByText("10 cards")).toBeVisible();
});

test("shows a retry banner when AniList is unavailable", async ({ page }) => {
  await page.route("https://graphql.anilist.co/**", (route) => route.fulfill({ status: 500, body: "boom" }));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("HTTP 500");
  await expect(page.getByRole("button", { name: /open booster pack/i })).toBeDisabled();
});
