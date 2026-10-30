/// <reference lib="dom" />
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { makeCharacter, makeEntry, makeShop, makeTheme, makeWallet } from "../src/test/fixtures";
import { FORBIDDEN_WORDS } from "../src/test/copyWords";
import {
  deferred,
  envelope,
  expect,
  isolated,
  makeAccount,
  mockCardImages,
  recordStatusTexts,
  signedIn,
  signedOut,
  statusTexts,
  test,
  type ApiCall,
  type FakeApi,
} from "./support/fake-api";

/**
 * Test plan: what the economy UI's own tests leave open, hunted in a real browser against the
 * scripted api (market-and-shop.md §3.1 to §3.3, §3.8; collection-overview.md §3.6 item 10, §3.8
 * "Request ids"; economy.md §11, §12; packs-page.md §3.3).
 *
 * Double spend from the UI
 * - A real double click and a held Enter (auto-repeat keydowns) on `Buy for 400 Karma` and on
 *   `Recycle for 80 Karma`: one request each.
 * - Two browser contexts (two devices) buying at once with Karma for one pack: the server's order
 *   decides; the loser shows `insufficient_funds` with the server's balance, never a negative.
 * - A buy and a recycle racing in two tabs: each header shows its own last server answer, and the
 *   next showing of a page reads the wallet again.
 * - Leaving the Shop with a buy in flight: the answer's balance still reaches the header.
 *
 * requestId lifecycle
 * - A lost answer, then Escape: the key goes and the wallet is read again; the next purchase is a
 *   new key.
 * - A 429 without Retry-After: the fallback countdown, which survives Cancel and a new
 *   confirmation; once a wait is over, the next buy after Cancel is a new key.
 * - Recycle: a 429, Cancel, a changed number: the new count goes under a new key, never the old one.
 * - Recycle: Close (the dialog's own button) after a lost answer is the confirmation's Cancel.
 * - `request_id_reused` on a buy: the red banner, then a new key that buys; on a recycle: the
 *   neutral notice and a new key that recycles.
 *
 * Balance display
 * - Every text the header's balance takes over a purchase and a recycle is a server answer, in
 *   order, with no flash of a computed or negative number.
 *
 * States
 * - `insufficient_funds` without `balance`: the red line names the held balance; the header keeps it.
 * - `theme_unavailable`: the dialog closes, the notice takes focus, the shop is read again.
 * - 401 on a buy and on a recycle: `/login`, with the page as the return path in history.state,
 *   nothing in the address.
 * - A signed-out visitor to `/shop`: `/login` with `/shop` as the return path.
 * - 503 on a recycle (any other answer): the red banner, a new key next.
 *
 * Hostile AniList strings
 * - A theme title and a character name carrying markup and a right-to-left override: text only,
 *   in their own isolated element, isolated in the live region's plain string, no script runs.
 *
 * Copy, route, layout
 * - Visible text of the Shop, the confirmation and the recycle dialog: none of the forbidden
 *   words; `Karma` only after a number or in the section's name; `free` only in `free pack(s)`.
 * - `/shop` on a fresh load: the title, the h1, and focus not moved; Back and Forward move it.
 * - 320 px: the header holds the balance (a ten-digit one, the ceiling) and the Account control in
 *   one row above the links; no horizontal scroll on the Shop, the confirmation or the recycle dialog.
 */

const CHRIS = makeAccount({ cards: 0 });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const header = (page: Page) => page.getByRole("banner");
const theme = (page: Page, name = "Action") => page.getByRole("article", { name });
const confirmation = (page: Page, title = "Action") =>
  page.getByRole("dialog", { name: `Buy the ${title} pack?` });
const reveal = (page: Page, title = "Action") =>
  page.getByRole("heading", { level: 2, name: `${title} pack`, exact: true });
const requestIds = (api: FakeApi, key: string) =>
  api.bodies(key).map((body) => (body as { requestId: string }).requestId);
const BUY = "POST /api/shop/buy";
/** What holds focus: its tag and its text, or `BODY` when focus fell to the page. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el === null ? null : `${el.tagName} ${el === document.body ? "" : (el.textContent ?? "")}`.trim();
  });
const RECYCLE = "POST /api/collection/recycle";

/** The api handles the request, but the answer never reaches the browser. */
const answerLost = (api: FakeApi) => (call: ApiCall) => {
  api.game.reply(call.key, call.body);
  return "abort" as const;
};
const game = (api: FakeApi) => (call: ApiCall) => api.game.reply(call.key, call.body)!;

/** Holds every call of `key` until the test releases the gate, then lets the game answer it. */
function held(api: FakeApi, key: string) {
  const gate = deferred();
  api.on(key, async (call) => {
    await gate.promise;
    return api.game.reply(call.key, call.body)!;
  });
  return gate;
}

async function openShop(page: Page) {
  await page.goto("/shop");
  await expect(h1(page, "Shop")).toBeVisible();
  await expect(header(page).getByText("1,240 Karma")).toBeVisible();
  await expect(theme(page)).toBeVisible();
}

async function confirmBuy(page: Page) {
  await openShop(page);
  await theme(page).getByRole("button", { name: "Buy…" }).click();
  await expect(confirmation(page)).toBeVisible();
}

const heldReturnTo = (page: Page) =>
  page.evaluate(() => (history.state as { returnTo?: unknown } | null)?.returnTo);

async function expectNothingStored(page: Page) {
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
}

declare global {
  interface Window {
    __balances?: string[];
    __pwned?: number;
  }
}

/** Records, in order, every text the header's balance element takes (the `<p>` ending in `Karma`). */
async function recordBalances(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    window.__balances = seen;
    const scan = () => {
      const p = Array.from(document.querySelectorAll("header p")).find((el) =>
        /Karma$/.test(el.textContent ?? ""),
      );
      const text = p?.textContent ?? "";
      if (text !== "" && seen.at(-1) !== text) seen.push(text);
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true });
  });
}
const balances = (page: Page) => page.evaluate(() => window.__balances ?? []);

/** A second browser on the same scripted api: another device or another tab of the same account. */
async function secondContext(
  browser: Browser,
  baseURL: string | undefined,
  api: FakeApi,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL });
  await mockCardImages(context);
  await context.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) => api.handle(route),
  );
  return { context, page: await context.newPage() };
}

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedIn(CHRIS));
});

test.describe("double spend from the UI", () => {
  test("a real double click on Buy for 400 Karma buys one pack", async ({ page, api }) => {
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).dblclick();
    await expect(reveal(page)).toBeFocused();
    await expect(header(page).getByText("840 Karma")).toBeVisible();
    expect(api.count(BUY)).toBe(1);
    expect(api.game.balance).toBe(840);
  });

  test("a held Enter on Buy for 400 Karma buys one pack, and its repeats open nothing more", async ({
    page,
    api,
  }) => {
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).focus();
    // keyboard.down on a key already down sends keydown with repeat: true, as an auto-repeat does.
    for (let i = 0; i < 8; i++) await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await expect(reveal(page)).toBeFocused();
    await expect(header(page).getByText("840 Karma")).toBeVisible();
    await expect(confirmation(page)).toHaveCount(0);
    expect(api.count(BUY)).toBe(1);
  });

  test("two devices buy at once with Karma for one pack: one pack, the other told the server's balance", async ({
    page,
    api,
    browser,
    baseURL,
  }) => {
    api.game.balance = 440;
    const gate = held(api, BUY);
    const other = await secondContext(browser, baseURL, api);
    try {
      for (const p of [page, other.page]) {
        await p.goto("/shop");
        await expect(header(p).getByText("440 Karma")).toBeVisible();
        await theme(p).getByRole("button", { name: "Buy…" }).click();
        await confirmation(p).getByRole("button", { name: "Buy for 400 Karma" }).click();
        await expect(confirmation(p).getByRole("button", { name: "Buying…" })).toBeVisible();
      }
      await expect.poll(() => api.count(BUY)).toBe(2);
      gate.release();
      await expect(reveal(page)).toBeFocused();
      await expect(header(page).getByText("40 Karma", { exact: true })).toBeVisible();
      await expect(confirmation(other.page).getByRole("alert")).toHaveText(
        "This pack costs 400 Karma. You have 40 Karma.",
      );
      await expect(header(other.page).getByText("40 Karma", { exact: true })).toBeVisible();
      expect(api.game.balance).toBe(40);
      expect(api.game.purchases.size).toBe(1);
      expect(new Set(requestIds(api, BUY)).size).toBe(2);
    } finally {
      await other.context.close();
    }
  });

  test("a buy and a recycle race in two tabs: each header shows its own last answer, then the wallet again", async ({
    page,
    api,
  }) => {
    api.game.held = [makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), { count: 3 })];
    const gate = held(api, BUY);
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect.poll(() => api.count(BUY)).toBe(1);

    const tab = await page.context().newPage();
    await mockCardImages(tab);
    await tab.route(
      (url) => url.pathname.startsWith("/api/"),
      (route) => api.handle(route),
    );
    await tab.goto("/collection");
    await expect(header(tab).getByText("1,240 Karma")).toBeVisible();
    await tab
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    const dialog = tab.getByRole("dialog");
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 80 Karma" }).click();
    await expect(dialog.getByRole("status")).toHaveText(
      "Recycled 2 copies of Spike Spiegel for 80 Karma. You have 1,320 Karma.",
    );
    await expect(header(tab).getByText("1,320 Karma")).toBeVisible();

    // The buy arrives after the recycle: the server debits 1,320.
    gate.release();
    await expect(reveal(page)).toBeFocused();
    await expect(header(page).getByText("920 Karma")).toBeVisible();
    // The other tab shows its own last answer until a page reads the wallet again.
    await expect(header(tab).getByText("1,320 Karma")).toBeVisible();
    await tab.keyboard.press("Escape");
    await tab.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shop" }).click();
    await expect(header(tab).getByText("920 Karma")).toBeVisible();
    expect(api.game.balance).toBe(920);
  });

  test("leaving the Shop with a buy in flight: the answer's balance still reaches the header", async ({
    page,
    api,
  }) => {
    const gate = held(api, BUY);
    await page.goto("/packs");
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shop" }).click();
    await theme(page).getByRole("button", { name: "Buy…" }).click();
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect.poll(() => api.count(BUY)).toBe(1);
    await page.goBack();
    await expect(h1(page, "Packs")).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    gate.release();
    await expect(header(page).getByText("840 Karma")).toBeVisible();
    await expect(page.getByRole("link", { name: "Collection (5)" })).toBeVisible();
    // Back on the Shop: no reveal of the pack bought while away, no confirmation, and no second buy.
    await page.goForward();
    await expect(h1(page, "Shop")).toBeFocused();
    await expect(theme(page)).toBeVisible();
    await expect(reveal(page)).toHaveCount(0);
    expect(api.count(BUY)).toBe(1);
  });
});

test.describe("the requestId lifecycle", () => {
  test("a lost answer, then Escape: the wallet is read again and the next purchase is a new key", async ({
    page,
    api,
  }) => {
    api.on(BUY, answerLost(api), game(api));
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(confirmation(page).getByRole("alert")).toHaveText(
      "Couldn't reach the game server, so this may not have gone through.",
    );
    const wallets = api.count("GET /api/wallet");
    await page.keyboard.press("Escape");
    await expect(confirmation(page)).toHaveCount(0);
    await expect.poll(() => focused(page)).toBe("BUTTON Buy…");
    // The lost purchase went through: the server's next answer says so.
    await expect(header(page).getByText("840 Karma")).toBeVisible();
    expect(api.count("GET /api/wallet")).toBeGreaterThan(wallets);

    await theme(page).getByRole("button", { name: "Buy…" }).click();
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(reveal(page)).toBeFocused();
    await expect(header(page).getByText("440 Karma")).toBeVisible();
    const [first, second] = requestIds(api, BUY);
    expect(second).not.toBe(first);
    expect(api.game.purchases.size).toBe(2);
  });

  test("a 429 without Retry-After: the fallback countdown, which survives Cancel and a new confirmation", async ({
    page,
    api,
  }) => {
    api.on(BUY, envelope(429, "rate_limited"), game(api));
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(
      confirmation(page).getByRole("button", { name: /^Try again in (60|59|58) s$/ }),
    ).toBeVisible();
    await expect(
      confirmation(page).getByText("That was a lot in a short time. Give it a few seconds."),
    ).toBeVisible();
    await confirmation(page).getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation(page)).toHaveCount(0);
    // The wait lives on the Shop page (manager decision, 2026-10-30).
    await theme(page).getByRole("button", { name: "Buy…" }).click();
    await expect(
      confirmation(page).getByRole("button", { name: /^Try again in (60|59|58|57) s$/ }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(api.count(BUY)).toBe(1);
  });

  test("a 429, Cancel, the wait over: the next buy is a new key", async ({ page, api }) => {
    api.on(BUY, { ...envelope(429, "rate_limited"), headers: { "Retry-After": "1" } }, game(api));
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(confirmation(page).getByRole("button", { name: "Try again in 1 s" })).toBeVisible();
    await confirmation(page).getByRole("button", { name: "Cancel" }).click();
    await theme(page).getByRole("button", { name: "Buy…" }).click();
    const buy = confirmation(page).getByRole("button", { name: "Buy for 400 Karma" });
    await expect(buy).toBeVisible({ timeout: 5_000 });
    await buy.click();
    await expect(reveal(page)).toBeFocused();
    const [first, second] = requestIds(api, BUY);
    expect(second).not.toBe(first);
  });

  test("request_id_reused on a buy: the red banner, then a new key that buys", async ({ page, api }) => {
    api.on(BUY, envelope(409, "request_id_reused"), game(api));
    await confirmBuy(page);
    const button = confirmation(page).getByRole("button", { name: "Buy for 400 Karma" });
    await button.click();
    await expect(confirmation(page).getByRole("alert")).toHaveText(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await button.click();
    await expect(reveal(page)).toBeFocused();
    const [first, second] = requestIds(api, BUY);
    expect(second).not.toBe(first);
  });
});

test.describe("Recycle: double spend and the requestId", () => {
  const spike = makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic", franchiseIds: [100] }), {
    count: 4,
  });
  const dialogOf = (page: Page) => page.getByRole("dialog");

  async function openSpike(page: Page) {
    await page.goto("/collection");
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    await expect(dialogOf(page).getByRole("heading", { level: 3, name: "Recycle for Karma" })).toBeVisible();
  }

  test.beforeEach(({ api }) => {
    api.game.held = [spike];
  });

  test("a real double click and a held Enter on the confirm button recycle once each", async ({
    page,
    api,
  }) => {
    await openSpike(page);
    const dialog = dialogOf(page);
    const field = dialog.getByRole("textbox", { name: "Duplicates" });
    await field.fill("1");
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 40 Karma" }).dblclick();
    await expect(dialog.getByRole("status")).toHaveText(
      "Recycled 1 copy of Spike Spiegel for 40 Karma. You have 1,280 Karma.",
    );
    expect(api.count(RECYCLE)).toBe(1);

    await expect(field).toHaveValue("2");
    await field.fill("1");
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 40 Karma" }).focus();
    for (let i = 0; i < 8; i++) await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await expect(dialog.getByRole("status")).toHaveText(
      "Recycled 1 copy of Spike Spiegel for 40 Karma. You have 1,320 Karma.",
    );
    await expect(header(page).getByText("1,320 Karma")).toBeVisible();
    expect(api.count(RECYCLE)).toBe(2);
    expect(api.game.balance).toBe(1_320);
  });

  test("a 429, Cancel and a changed number: the new count goes under a new key", async ({ page, api }) => {
    api.on(RECYCLE, { ...envelope(429, "rate_limited"), headers: { "Retry-After": "1" } }, game(api));
    await openSpike(page);
    const dialog = dialogOf(page);
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 120 Karma" }).click();
    await expect(dialog.getByText("That was a lot in a short time. Give it a few seconds.")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog.getByRole("button", { name: "Recycle…" })).toBeFocused();
    await dialog.getByRole("textbox", { name: "Duplicates" }).fill("1");
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    const confirm = dialog.getByRole("button", { name: "Recycle for 40 Karma" });
    await expect(confirm).toBeVisible({ timeout: 5_000 });
    await confirm.click();
    await expect(dialog.getByRole("status")).toHaveText(
      "Recycled 1 copy of Spike Spiegel for 40 Karma. You have 1,280 Karma.",
    );
    const bodies = api.bodies(RECYCLE) as { requestId: string; count: number }[];
    expect(bodies.map((b) => b.count)).toEqual([3, 1]);
    expect(bodies[1]?.requestId).not.toBe(bodies[0]?.requestId);
  });

  test("Escape after a lost answer, then a changed number: a new key, and the wallet's next answer", async ({
    page,
    api,
  }) => {
    api.on(RECYCLE, answerLost(api), game(api));
    await openSpike(page);
    const dialog = dialogOf(page);
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 120 Karma" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Couldn't reach the game server, so this may not have gone through.",
    );
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("button", { name: "Recycle…" })).toBeFocused();
    // The lost recycle went through: the wallet and the collection read again say so.
    await expect(header(page).getByText("1,360 Karma")).toBeVisible();
    await expect(dialog.getByText("No duplicates. The last copy can't be recycled.")).toBeVisible();
    expect(api.count(RECYCLE)).toBe(1);
  });

  test("Close after a lost answer is the confirmation's Cancel: the dialog closes, the wallet is read again", async ({
    page,
    api,
  }) => {
    api.game.held = [{ ...spike, count: 6, available: 6, recyclable: 5 }];
    api.on(RECYCLE, answerLost(api), game(api));
    await openSpike(page);
    const dialog = dialogOf(page);
    await dialog.getByRole("textbox", { name: "Duplicates" }).fill("3");
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 120 Karma" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    // The lost recycle went through: the wallet read again says so.
    await expect(header(page).getByText("1,360 Karma")).toBeVisible();
    // Opened again: the field from the server's numbers, and the next recycle is a new key.
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    await expect(dialog.getByRole("textbox", { name: "Duplicates" })).toHaveValue("2");
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 80 Karma" }).click();
    await expect(dialog.getByRole("status")).toHaveText(
      "Recycled 2 copies of Spike Spiegel for 80 Karma. You have 1,440 Karma.",
    );
    const [first, second] = requestIds(api, RECYCLE);
    expect(second).not.toBe(first);
    expect(api.game.recycles.size).toBe(2);
  });

  test("request_id_reused on a recycle: the neutral notice, focus on the name, and a new key that recycles", async ({
    page,
    api,
  }) => {
    api.on(RECYCLE, envelope(409, "request_id_reused"), game(api));
    await openSpike(page);
    const dialog = dialogOf(page);
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 120 Karma" }).click();
    await expect(
      dialog.getByText("Something changed since you opened this card. Check the numbers and try again."),
    ).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2, name: "Spike Spiegel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 120 Karma" }).click();
    await expect(dialog.getByRole("status")).toHaveText(
      "Recycled 3 copies of Spike Spiegel for 120 Karma. You have 1,360 Karma.",
    );
    const [first, second] = requestIds(api, RECYCLE);
    expect(second).not.toBe(first);
  });

  test("503 on a recycle: the red banner, the balance unchanged, and a new key next", async ({
    page,
    api,
  }) => {
    api.on(RECYCLE, envelope(503, "internal"), game(api));
    await openSpike(page);
    const dialog = dialogOf(page);
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    const confirm = dialog.getByRole("button", { name: "Recycle for 120 Karma" });
    await confirm.click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "The game server couldn't finish this. Nothing changed. Try again.",
    );
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await confirm.click();
    await expect(header(page).getByText("1,360 Karma")).toBeVisible();
    const [first, second] = requestIds(api, RECYCLE);
    expect(second).not.toBe(first);
  });

  test("401 on a recycle: /login with /collection as the return path, nothing in the address or storage", async ({
    page,
    api,
  }) => {
    api.on(RECYCLE, envelope(401, "unauthenticated"));
    await openSpike(page);
    const dialog = dialogOf(page);
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 120 Karma" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page, "Log in")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(header(page).getByText(/Karma/)).toHaveCount(0);
    expect(await heldReturnTo(page)).toBe("/collection");
    await expectNothingStored(page);
  });
});

test.describe("the balance display", () => {
  test("every text the balance takes is a server answer, in order: no computed or negative number", async ({
    page,
    api,
  }) => {
    api.game.held = [makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), { count: 3 })];
    // Each read of the wallet answers what the server holds then.
    api.on("GET /api/wallet", () => ({ status: 200, json: makeWallet(api.game.balance) }));
    await recordBalances(page);
    await page.goto("/shop");
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    await theme(page).getByRole("button", { name: "Buy…" }).click();
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(header(page).getByText("840 Karma")).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: /^Collection/ })
      .click();
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    await dialog.getByRole("button", { name: "Recycle for 80 Karma" }).click();
    await expect(header(page).getByText("920 Karma")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shop" }).click();
    await expect(h1(page, "Shop")).toBeFocused();
    await expect.poll(() => api.count("GET /api/wallet")).toBeGreaterThanOrEqual(3);
    await expect(header(page).getByText("920 Karma")).toBeVisible();
    expect(await balances(page)).toEqual(["1,240 Karma", "840 Karma", "920 Karma"]);
  });

  test("the wallet's refetch read before a purchase answers after it: the header keeps the receipt's balance", async ({
    page,
    api,
  }) => {
    await recordBalances(page);
    await page.goto("/packs");
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
    // Showing the Shop reads the wallet again; that read is held and answers the old balance last.
    const gate = deferred();
    api.on("GET /api/wallet", async () => {
      await gate.promise;
      return { status: 200, json: makeWallet(1_240) };
    });
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shop" }).click();
    await theme(page).getByRole("button", { name: "Buy…" }).click();
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(header(page).getByText("840 Karma")).toBeVisible();
    const late = page.waitForResponse("**/api/wallet");
    gate.release();
    await late;
    await expect(header(page).getByText("840 Karma")).toBeVisible();
    expect(await balances(page)).toEqual(["1,240 Karma", "840 Karma"]);
  });
});

test.describe("the Shop's refusals and session", () => {
  test("insufficient_funds without balance: the red line names the held balance; the header keeps it", async ({
    page,
    api,
  }) => {
    api.on(BUY, envelope(409, "insufficient_funds"));
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(confirmation(page).getByRole("alert")).toHaveText(
      "This pack costs 400 Karma. You have 1,240 Karma.",
    );
    await expect(confirmation(page).getByRole("button", { name: "Buy for 400 Karma" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
  });

  test("theme_unavailable: the dialog closes, the notice takes focus, the shop is read again without it", async ({
    page,
    api,
  }) => {
    api.on(BUY, envelope(404, "theme_unavailable"));
    api.on(
      "GET /api/shop",
      { status: 200, json: makeShop([makeTheme(), makeTheme("genre-drama", { title: "Drama" })]) },
      { status: 200, json: makeShop([makeTheme("genre-drama", { title: "Drama" })]) },
    );
    await page.goto("/shop");
    await theme(page).getByRole("button", { name: "Buy…" }).click();
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(confirmation(page)).toHaveCount(0);
    await expect(page.getByText("That pack is no longer in the shop.")).toBeFocused();
    await expect(theme(page)).toHaveCount(0);
    await expect(theme(page, "Drama")).toBeVisible();
    expect(api.count("GET /api/shop")).toBe(2);
    await expect(header(page).getByText("1,240 Karma")).toBeVisible();
  });

  test("401 on a buy: /login with /shop as the return path, nothing in the address or storage", async ({
    page,
    api,
  }) => {
    api.on(BUY, envelope(401, "unauthenticated"));
    await confirmBuy(page);
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page, "Log in")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await heldReturnTo(page)).toBe("/shop");
    await expectNothingStored(page);
  });

  test("a signed-out visitor to /shop goes to /login with /shop as the return path", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    await page.goto("/shop");
    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page, "Log in")).toBeVisible();
    expect(await heldReturnTo(page)).toBe("/shop");
    expect(api.count("GET /api/shop")).toBe(0);
    expect(api.count("GET /api/wallet")).toBe(0);
  });
});

test.describe("hostile AniList strings", () => {
  const HOSTILE_TITLE = '<img src=x onerror="window.__pwned=1">‮Action';
  const HOSTILE_NAME = "<script>window.__pwned=1</script>‮Spike";

  test("a theme title with markup and an override: text in its own element, isolated in the live region", async ({
    page,
    api,
  }) => {
    api.on("GET /api/shop", {
      status: 200,
      json: makeShop([makeTheme("genre-action", { title: HOSTILE_TITLE })]),
    });
    await recordStatusTexts(page);
    await page.goto("/shop");
    const article = page.getByRole("article", { name: HOSTILE_TITLE });
    await expect(article.getByRole("heading", { level: 2 })).toHaveText(HOSTILE_TITLE);
    await expect(article.getByRole("heading", { level: 2 })).toHaveAttribute("dir", "auto");
    await article.getByRole("button", { name: "Buy…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(`Buy the ${HOSTILE_TITLE} pack?`);
    await expect(dialog.getByRole("heading", { level: 2 }).locator("bdi")).toHaveText(HOSTILE_TITLE);
    await dialog.getByRole("button", { name: "Buy for 400 Karma" }).click();
    const revealHeading = page.getByRole("heading", { level: 2, name: `${HOSTILE_TITLE} pack` });
    await expect(revealHeading).toBeFocused();
    await expect(revealHeading.locator("bdi")).toHaveText(HOSTILE_TITLE);
    await expect
      .poll(() => statusTexts(page))
      .toContain(`Bought the ${isolated(HOSTILE_TITLE)} pack for 400 Karma. You have 840 Karma.`);
    expect(await page.locator("img[src='x']").count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test("a character name with markup and an override in the recycle dialog: text, in a <bdi>", async ({
    page,
    api,
  }) => {
    api.game.held = [makeEntry(makeCharacter(1, { name: HOSTILE_NAME, tier: "epic" }), { count: 3 })];
    await page.goto("/collection");
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    const heading = dialog.getByRole("heading", { level: 2 });
    await expect(heading).toHaveText(`Recycle 2 duplicates of ${HOSTILE_NAME}?`);
    await expect(heading.locator("bdi")).toHaveText(HOSTILE_NAME);
    await dialog.getByRole("button", { name: "Recycle for 80 Karma" }).click();
    const status = dialog.getByRole("status");
    await expect(status).toHaveText(
      `Recycled 2 copies of ${HOSTILE_NAME} for 80 Karma. You have 1,320 Karma.`,
    );
    await expect(status.locator("bdi")).toHaveText(HOSTILE_NAME);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});

/** The visible text of `root`, every line of it. */
const visibleText = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText).join("\n"));

function expectCopyClean(text: string) {
  for (const word of FORBIDDEN_WORDS) expect(text, `forbidden ${word}`).not.toMatch(word);
  // `Karma` only after a number, or in the section's name `Recycle for Karma`.
  const stray = text.replace(/\d Karma/g, "").replace(/Recycle for Karma/g, "");
  expect(stray, "Karma not after a number or in a label").not.toMatch(/Karma/);
  expect(text.replace(/free packs?\b/gi, ""), "free outside free pack(s)").not.toMatch(/\bfree\b/i);
}

test.describe("copy", () => {
  test("the Shop, its confirmation and the reveal: no forbidden word, Karma after a number, free only as free pack", async ({
    page,
  }) => {
    await openShop(page);
    await theme(page).getByText("Odds per card").click();
    expectCopyClean(await visibleText(page, "header, main"));
    await theme(page).getByRole("button", { name: "Buy…" }).click();
    await expect(confirmation(page)).toBeVisible();
    expectCopyClean(await visibleText(page, "header, main, dialog[open]"));
    await confirmation(page).getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(reveal(page)).toBeFocused();
    expectCopyClean(await visibleText(page, "header, main"));
  });

  test("the recycle section, its confirmation and the receipt's line", async ({ page, api }) => {
    api.game.held = [makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), { count: 3 })];
    await page.goto("/collection");
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Recycle…" })).toBeVisible();
    expectCopyClean(await visibleText(page, "dialog[open]"));
    await dialog.getByRole("button", { name: "Recycle…" }).click();
    expectCopyClean(await visibleText(page, "dialog[open]"));
    await dialog.getByRole("button", { name: "Recycle for 80 Karma" }).click();
    await expect(dialog.getByRole("status")).toBeVisible();
    expectCopyClean(await visibleText(page, "header, dialog[open]"));
  });
});

test.describe("the /shop route", () => {
  test("a fresh load: the title and the h1, focus not moved; Back and Forward move it to the h1", async ({
    page,
  }) => {
    await page.goto("/shop");
    await expect(h1(page, "Shop")).toBeVisible();
    await expect(page).toHaveTitle("Shop · Anime TCG");
    await expect(h1(page, "Shop")).not.toBeFocused();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Packs" }).click();
    await expect(h1(page, "Packs")).toBeFocused();
    await page.goBack();
    await expect(page).toHaveTitle("Shop · Anime TCG");
    await expect(h1(page, "Shop")).toBeFocused();
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shop" }),
    ).toHaveAttribute("aria-current", "page");
    await expectNothingStored(page);
  });
});

test.describe("320 px", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  const noHorizontalScroll = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  test("the header holds a ten-digit balance and the Account control above the links; the Shop does not scroll sideways", async ({
    page,
    api,
  }) => {
    api.on("GET /api/wallet", { status: 200, json: makeWallet(1_000_000_000) });
    api.on("GET /api/shop", {
      status: 200,
      json: makeShop([makeTheme("genre-long", { title: "Supercalifragilisticexpialidocious".repeat(2) })]),
    });
    await page.goto("/shop");
    const balance = header(page).getByText("1,000,000,000 Karma");
    await expect(balance).toBeVisible();
    const control = header(page).getByRole("button", { name: /Chris/ });
    await expect(control).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });
    const [b, c, n] = await Promise.all([balance.boundingBox(), control.boundingBox(), nav.boundingBox()]);
    // One row: the balance on the left, the control on the right, both above the links.
    expect(b!.x).toBeLessThan(c!.x);
    expect(Math.abs(b!.y + b!.height / 2 - (c!.y + c!.height / 2))).toBeLessThan(8);
    expect(b!.y + b!.height).toBeLessThanOrEqual(n!.y);
    expect(c!.x + c!.width).toBeLessThanOrEqual(320);
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.getByRole("article").getByRole("button", { name: "Buy…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Buy for 400 Karma" })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport();
    expect(await noHorizontalScroll(page)).toBe(true);
    await dialog.getByRole("button", { name: "Buy for 400 Karma" }).click();
    await expect(page.getByRole("heading", { level: 2, name: /pack$/ }).first()).toBeFocused();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("the recycle section and its confirmation fit 320 px", async ({ page, api }) => {
    api.game.held = [makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), { count: 3 })];
    await page.goto("/collection");
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    const dialog = page.getByRole("dialog");
    const recycle = dialog.getByRole("button", { name: "Recycle…" });
    await recycle.scrollIntoViewIfNeeded();
    const box = await recycle.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(await noHorizontalScroll(page)).toBe(true);
    await recycle.click();
    await expect(dialog.getByRole("button", { name: "Recycle for 80 Karma" })).toBeInViewport();
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

/*
 * Regressions for the two bugs the hunt found on #51 (formerly economy.bugs.spec.ts).
 * BUG 1: Cancel and Escape on the pack confirmation dropped focus to <body>: `Buy…` was focused
 * while the modal was still open and the page inert (market-and-shop.md §3.8 "Focus").
 * BUG 2: a second Escape in flight closed the native <dialog> without a cancelable `cancel` event
 * (Chromium honours a prevented `cancel` once), on an unknown outcome (market-and-shop.md §3.3
 * step 5; collection-overview.md §3.6 step 5); the Shop's `Buy…` then did nothing.
 */
test.describe("regression: focus after closing the pack confirmation", () => {
  async function openConfirmation(page: Page) {
    await page.goto("/shop");
    await expect(h1(page, "Shop")).toBeVisible();
    await theme(page).getByRole("button", { name: "Buy…" }).click();
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

test.describe("regression: a second Escape in flight closes nothing", () => {
  test("Shop: the confirmation stays open in flight, and Try again shows after a lost answer", async ({
    page,
    api,
  }) => {
    const gate = deferred();
    api.on(BUY, async () => {
      await gate.promise;
      return "abort" as const;
    });
    await page.goto("/shop");
    await theme(page).getByRole("button", { name: "Buy…" }).click();
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
    api.on(RECYCLE, async (call) => {
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
