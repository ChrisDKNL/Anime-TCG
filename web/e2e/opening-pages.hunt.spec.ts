/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { makePacks, makeUnavailablePacks } from "../src/test/fixtures";
import {
  deferred,
  envelope,
  expect,
  makeAccount,
  recordStatusTexts,
  signedIn,
  statusTexts,
  test,
  type Answer,
  type ApiCall,
  type FakeApi,
} from "./support/fake-api";

/**
 * Test plan (tester's hunt): what opening-pages.spec.ts and packs.hunt.spec.ts do not reach on the
 * opening pages, against the scripted api (docs/design/packs-page.md §3.1 step 2, §3.3, §3.4 step 6,
 * §3.7, §4.4; navigation-and-landing.md §3.6, §3.10, §3.13, §7; market-and-shop.md §3.3 step 6).
 *
 * - Several openings, Back and Forward: two `/packs/open` entries both show the current opening, never
 *   an older pack; each arrival sets the title and focuses the h1; the entrance plays once per pack
 *   (on its first showing) and never on Back, Forward, `See your latest pack` or `Back to packs`.
 * - Back onto a `/packs/open` entry whose opening later ended without cards: replaced by `/packs` as a
 *   page change (its title and h1 focus), not a boot replace.
 * - Answers without cards on the push from `/packs` (503, 500, 403) and on `/packs/open`'s own button
 *   (503): `/packs` replaces the page (no new history entry), its h1 focused, that answer's row, the
 *   line read by the live region, no `See your latest pack`.
 * - A lost answer on `/packs/open`'s own button: `/packs` with `Try again`; the retry hits a 429
 *   (the key is kept), and after the wait `Try again` pushes `/packs/open` with the same `requestId`
 *   and shows the pack the lost answer carried.
 * - A double click and a held Enter on `/packs/open`'s own `Open pack`: one `POST` each, no history entry.
 * - No `GET /api/packs` while an opening is in flight: on the push, Back, Forward, an in-place
 *   opening, and `See your latest pack` while it is in flight.
 * - Reduced motion: no entrance on any showing.
 * - `/shop/open`: a direct load and a trailing slash end on `/shop` (boot replace: no focus move); a
 *   purchase that answers after the player left `/shop` navigates nowhere.
 * - Copy (§8 Words): `/packs/open` and `/shop/open` hold no forbidden word, no exclamation mark.
 *
 * Not here: the signed-out guard and a plain reload (opening-pages.spec.ts), the 409 and the plain
 * lost answer from the `/packs` push (opening-pages.spec.ts, packs.hunt.spec.ts), the 429 on the push
 * (packs.hunt.spec.ts). A purchase answered after leaving `/shop` holding its pack is a bug, in
 * shop-pack-left-in-flight.bug.spec.ts.
 */

const CHRIS = makeAccount({ cards: 0 });
const main = (page: Page) => page.getByRole("main");
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const packButton = (page: Page, name: string | RegExp = "Open pack") =>
  main(page).getByRole("button", { name, exact: typeof name === "string" });
const reveal = (page: Page) => page.getByRole("list", { name: "Your pack" });
const latest = (page: Page) => main(page).getByRole("link", { name: "See your latest pack" });
const backToPacks = (page: Page) => main(page).getByRole("link", { name: "Back to packs" });

const UNAVAILABLE = "Cards are unavailable right now. Your packs are kept until they're back.";
const FAILED = "Couldn't open the pack. Try again.";
const NO_ANSWER = "Couldn't reach the game server. Trying again opens this same pack, never a second one.";

/** The default game, answered by the test's own script. */
const game = (api: FakeApi) => (call: ApiCall) => api.game.reply(call.key, call.body)!;

/** The scripted game deals the pack and the answer is lost on the way back. */
const lost = (api: FakeApi) => (call: ApiCall) => {
  api.game.reply(call.key, call.body);
  return "abort" as const;
};

const namesOfOpening = (n: number) => [0, 1, 2, 3, 4].map((slot) => `Character ${1_000 + n * 10 + slot}`);

function revealNames(page: Page): Promise<string[]> {
  return reveal(page)
    .getByRole("article")
    .evaluateAll((articles) => articles.map((a) => a.querySelector("[title]")?.textContent ?? ""));
}

const historyLength = (page: Page) => page.evaluate(() => history.length);

const requestIds = (api: FakeApi) =>
  api.bodies("POST /api/packs/open").map((body) => (body as { requestId: string }).requestId);

declare global {
  interface Window {
    __entrances?: string[];
  }
}

/**
 * Records every card entrance that starts (`animationstart` of `card-enter` on a reveal item), with
 * the page it started on, so "the entrance plays once per pack" is counted, not sampled. Call before `goto`.
 */
async function recordEntrances(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    window.__entrances = seen;
    document.addEventListener(
      "animationstart",
      (event) => {
        if (event.animationName === "card-enter") seen.push(location.pathname);
      },
      true,
    );
  });
}

const entrances = (page: Page) => page.evaluate(() => window.__entrances?.length ?? 0);

async function arrivedOn(page: Page, path: string, title: string, heading: string) {
  await expect(page).toHaveURL((url) => url.pathname === path);
  await expect(page).toHaveTitle(title);
  await expect(h1(page, heading)).toBeFocused();
}

const onPacks = (page: Page) => arrivedOn(page, "/packs", "Packs · Anime TCG", "Packs");
const onOpening = (page: Page) => arrivedOn(page, "/packs/open", "Pack opening · Anime TCG", "Pack opening");

test.describe("/packs/open", () => {
  test.beforeEach(({ api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
  });

  test("several openings: every /packs/open entry shows the current pack, and Back, Forward and the links never replay its entrance", async ({
    page,
  }) => {
    await recordEntrances(page);
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();

    // Pack 1, pushed from /packs: its first showing enters.
    await packButton(page).click();
    await onOpening(page);
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(1));
    await expect.poll(() => entrances(page)).toBe(5);

    // `Back to packs` pushes /packs; `See your latest pack` shows the same cards without the entrance.
    await backToPacks(page).click();
    await onPacks(page);
    await latest(page).click();
    await onOpening(page);
    expect(await revealNames(page)).toEqual(namesOfOpening(1));
    await backToPacks(page).click();
    await onPacks(page);

    // Pack 2, pushed from /packs again (a second /packs/open entry), then pack 3 in place.
    await packButton(page).click();
    await onOpening(page);
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(2));
    await expect.poll(() => entrances(page)).toBe(10);
    await packButton(page).click();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(3));
    await expect.poll(() => entrances(page)).toBe(15);
    await expect(packButton(page)).toBeFocused();

    // Back through every entry: /packs, the /packs/open of `See your latest pack`, /packs, ... The older
    // /packs/open entries show the current pack (navigation-and-landing.md §3.13 step 2).
    const route: Array<"packs" | "opening"> = ["packs", "opening", "packs", "opening", "packs"];
    for (const stop of route) {
      await page.goBack();
      if (stop === "packs") {
        await onPacks(page);
        await expect(latest(page)).toBeVisible();
      } else {
        await onOpening(page);
        expect(await revealNames(page)).toEqual(namesOfOpening(3));
      }
    }
    // And Forward to the end again.
    for (const stop of [...route.slice(0, -1)].reverse().concat("opening")) {
      await page.goForward();
      if (stop === "packs") await onPacks(page);
      else {
        await onOpening(page);
        expect(await revealNames(page)).toEqual(namesOfOpening(3));
      }
    }
    expect(await entrances(page)).toBe(15);
  });

  test("Back onto a /packs/open entry whose opening has since ended without cards: /packs replaces it as a page change", async ({
    page,
    api,
  }) => {
    api.on("POST /api/packs/open", game(api), envelope(503, "pool_unavailable"));
    await page.goto("/packs");
    await packButton(page).click();
    await onOpening(page);
    await expect(reveal(page).getByRole("article")).toHaveCount(5);
    await backToPacks(page).click();
    await onPacks(page);

    // The next opening answers 503: nothing is held any more (§3.13 step 12).
    const before = await historyLength(page);
    await packButton(page).click();
    await onPacks(page);
    await expect(latest(page)).toHaveCount(0);
    expect(await historyLength(page)).toBe(before + 1);

    // Back past the `Back to packs` entry onto the first /packs/open entry: nothing to show, so replaced.
    await page.goBack();
    await onPacks(page);
    await page.goBack();
    await onPacks(page);
    await expect(reveal(page)).toHaveCount(0);
  });

  const noCards: Array<[string, Answer, string]> = [
    ["503", envelope(503, "pool_unavailable"), UNAVAILABLE],
    ["500", envelope(500, "internal"), FAILED],
    ["403", envelope(403, "bad_origin"), FAILED],
  ];
  for (const [status, answer, line] of noCards) {
    test(`a ${status} on the push from /packs: /packs replaces /packs/open with that row, its h1 focused, the line read`, async ({
      page,
      api,
    }) => {
      await recordStatusTexts(page);
      api.on("POST /api/packs/open", answer);
      // The server that answers 503 has no snapshot, so the GET /packs sends on showing has no odds either.
      if (status === "503") {
        api.on(
          "GET /api/packs",
          { status: 200, json: makePacks() },
          { status: 200, json: makeUnavailablePacks({ available: 3, cap: 3, nextPackInSeconds: null }) },
        );
      }
      await page.goto("/packs");
      await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
      const before = await historyLength(page);
      await packButton(page).click();
      await onPacks(page);
      await expect(main(page).getByText(line)).toBeVisible();
      await expect(latest(page)).toHaveCount(0);
      // Pushed, then replaced: one entry, and no /packs/open in it.
      expect(await historyLength(page)).toBe(before + 1);
      await expect.poll(() => statusTexts(page)).toContain(line);
      if (status === "503")
        await expect(main(page).getByRole("button", { name: "Check again" })).toBeVisible();
      else await expect(main(page).getByRole("alert")).toHaveText(line);
      expect(api.count("POST /api/packs/open")).toBe(1);
    });
  }

  test("a 503 on /packs/open's own Open pack: /packs replaces it, and the previous cards are no longer held", async ({
    page,
    api,
  }) => {
    api.on("POST /api/packs/open", game(api), envelope(503, "pool_unavailable"));
    await page.goto("/packs");
    await packButton(page).click();
    await expect(reveal(page).getByRole("article")).toHaveCount(5);
    const before = await historyLength(page);
    await packButton(page).click();
    await onPacks(page);
    await expect(latest(page)).toHaveCount(0);
    expect(await historyLength(page)).toBe(before);
  });

  test("a 409 on /packs/open's own button sends exactly one follow-up GET /api/packs, the replace's showing included", async ({
    page,
    api,
  }) => {
    await page.goto("/packs");
    await packButton(page).click();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(1));
    await page.waitForLoadState("networkidle");
    const gets = api.count("GET /api/packs");
    // Another device spends the packs left while this page shows `2 of 3`.
    api.game.available = 0;
    await packButton(page).click();
    await onPacks(page);
    await expect(main(page).getByText("There was no pack left to open.")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(api.count("GET /api/packs")).toBe(gets + 1);
  });

  test("a 409 that lands while /packs shows (Back during the flight) navigates nowhere; Forward then replaces /packs/open", async ({
    page,
    api,
  }) => {
    const answer = deferred();
    api.on("POST /api/packs/open", async () => {
      await answer.promise;
      return envelope(409, "no_pack_available", 600);
    });
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
    await packButton(page).click();
    await onOpening(page);
    await page.goBack();
    await onPacks(page);
    // The opening is in flight, so nothing settles to "network idle"; /packs sends no GET meanwhile.
    const gets = api.count("GET /api/packs");
    const entries = await historyLength(page);
    // Another device spent the packs: the follow-up GET agrees with the 409.
    api.game.available = 0;
    answer.release();
    await expect(main(page).getByText("There was no pack left to open.")).toBeVisible();
    await expect(page.getByText("0 of 3 packs ready")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await onPacks(page);
    expect(await historyLength(page)).toBe(entries);
    expect(api.count("GET /api/packs")).toBe(gets + 1);

    await page.goForward();
    await onPacks(page);
    await expect(reveal(page)).toHaveCount(0);
  });

  test("a lost answer on /packs/open's own button, then a 429 on the retry: Try again keeps one requestId and shows the pack the lost answer carried", async ({
    page,
    api,
  }) => {
    api.on(
      "POST /api/packs/open",
      game(api),
      lost(api),
      { ...envelope(429, "rate_limited"), headers: { "Retry-After": "2" } },
      game(api),
    );
    await page.goto("/packs");
    await packButton(page).click();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(1));

    // Pack 2 from /packs/open's own button; its answer is lost.
    await packButton(page).click();
    await onPacks(page);
    await expect(main(page).getByText(NO_ANSWER)).toBeVisible();
    await expect(latest(page)).toHaveCount(0);
    const retry = packButton(page, "Try again");
    await expect(retry).not.toHaveAttribute("aria-disabled");

    // The retry is refused by the rate limiter: back on /packs with the wait, the key still held.
    await retry.click();
    await onPacks(page);
    await expect(packButton(page, /^Try again in \d s$/)).toHaveAttribute("aria-disabled", "true");
    await expect(packButton(page, "Try again")).not.toHaveAttribute("aria-disabled");

    // After the wait: the same requestId, pushed onto /packs/open, showing the dealt pack.
    await packButton(page, "Try again").click();
    await onOpening(page);
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(2));
    const ids = requestIds(api);
    expect(ids).toHaveLength(4);
    expect(ids[1]).not.toBe(ids[0]);
    expect(new Set(ids.slice(1)).size).toBe(1);
    expect(api.game.opened).toBe(2);
    await expect(main(page).getByText("1 of 3 packs ready")).toBeVisible();
  });

  test("a double click and a held Enter on /packs/open's own Open pack each open one pack and push nothing", async ({
    page,
    api,
  }) => {
    await page.goto("/packs");
    await packButton(page).click();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(1));
    const entries = await historyLength(page);

    await packButton(page).dblclick();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(2));
    await expect(packButton(page)).not.toHaveAttribute("aria-disabled");
    await page.waitForLoadState("networkidle");
    expect(api.count("POST /api/packs/open")).toBe(2);

    await packButton(page).focus();
    await page.keyboard.down("Enter");
    for (let i = 0; i < 4; i += 1) await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(3));
    await page.waitForLoadState("networkidle");
    expect(api.count("POST /api/packs/open")).toBe(3);
    expect(api.game.opened).toBe(3);

    await expect(page).toHaveURL(/\/packs\/open$/);
    expect(await historyLength(page)).toBe(entries);
    await expect(main(page).getByText("0 of 3 packs ready")).toBeVisible();
    await expect(packButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(packButton(page)).toBeFocused();
  });

  test("no GET /api/packs while an opening is in flight: the push, Back, Forward, an in-place opening and See your latest pack", async ({
    page,
    api,
  }) => {
    const gates = [deferred(), deferred()];
    let n = 0;
    api.on("POST /api/packs/open", async (call) => {
      const gate = gates[n];
      n += 1;
      await gate?.promise;
      return game(api)(call);
    });
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const gets = api.count("GET /api/packs");

    // Pack 1 in flight from the push.
    await packButton(page).click();
    await onOpening(page);
    await expect(packButton(page, "Opening…")).toHaveAttribute("aria-disabled", "true");
    await page.goBack();
    await onPacks(page);
    await expect(packButton(page, "Opening…")).toHaveAttribute("aria-disabled", "true");
    await page.goForward();
    await onOpening(page);
    await page.waitForLoadState("networkidle");
    expect(api.count("GET /api/packs")).toBe(gets);
    gates[0]?.release();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(1));
    await expect(main(page).getByText("2 of 3 packs ready")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const afterFirst = api.count("GET /api/packs");

    // Pack 2 in flight from /packs/open's own button; Back, then `See your latest pack` during the flight.
    await packButton(page).click();
    await expect(reveal(page)).toHaveAttribute("aria-busy", "true");
    await page.goBack();
    await onPacks(page);
    await latest(page).click();
    await onOpening(page);
    await expect(reveal(page)).toHaveAttribute("aria-busy", "true");
    expect(await revealNames(page)).toEqual(namesOfOpening(1));
    await page.waitForLoadState("networkidle");
    expect(api.count("GET /api/packs")).toBe(afterFirst);
    gates[1]?.release();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(2));
    await expect(main(page).getByText("1 of 3 packs ready")).toBeVisible();
  });

  test("under reduced motion no showing of /packs/open has an entrance", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordEntrances(page);
    await page.goto("/packs");
    await packButton(page).click();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(1));
    await packButton(page).click();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(2));
    await page.goBack();
    await onPacks(page);
    await page.goForward();
    await onOpening(page);
    const items = await reveal(page)
      .getByRole("listitem")
      .evaluateAll((list) => list.map((item) => getComputedStyle(item).animationName));
    expect(items).toEqual(["none", "none", "none", "none", "none"]);
    expect(await entrances(page)).toBe(0);
  });

  test("the words on /packs/open hold nothing §8 forbids (free only as `free pack(s)`)", async ({ page }) => {
    await page.goto("/packs");
    await packButton(page).click();
    await expect(reveal(page).getByRole("article")).toHaveCount(5);
    const text = await main(page).innerText();
    expect(text).toContain("Pack opening");
    const scanned = text.replace(/\bfree (?=packs?\b)/gi, "");
    expect(scanned.match(FORBIDDEN)?.[0] ?? null, text).toBeNull();
  });
});

/** navigation-and-landing.md §8 "Words" with collection-overview.md §8's money and nudge words. */
const FORBIDDEN =
  /secure|verif|protect|\bsafe\b|privat|attempt|locked|blocked|\b(pay|paid|cash|money|coins?|earn|profit|worth|value|wallet|store|checkout|purchase|hurry|act now|today only|ending soon|last chance|don't miss|limited|free|lucky|jackpot|win|prize|you could get|try your luck|one more|another)\b|[!$€£¥]/i;

test.describe("/shop/open", () => {
  test.beforeEach(({ api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
  });

  for (const typed of ["/shop/open", "/shop/open/"]) {
    test(`a direct load of ${typed} ends on /shop: its title, no focus move, nothing bought`, async ({
      page,
      api,
    }) => {
      await page.goto(typed);
      await expect(page).toHaveURL((url) => url.pathname === "/shop");
      await expect(page).toHaveTitle("Shop · Anime TCG");
      await expect(h1(page, "Shop")).toBeVisible();
      await expect(h1(page, "Shop")).not.toBeFocused();
      await expect(main(page).getByRole("link", { name: "See your latest shop pack" })).toHaveCount(0);
      expect(api.count("POST /api/shop/buy")).toBe(0);
    });
  }

  test("a purchase that answers after the player left /shop navigates nowhere", async ({ page, api }) => {
    const answer = deferred();
    api.on("POST /api/shop/buy", async (call) => {
      await answer.promise;
      return game(api)(call);
    });
    await page.goto("/packs");
    await nav(page).getByRole("link", { name: "Shop", exact: true }).click();
    await arrivedOn(page, "/shop", "Shop · Anime TCG", "Shop");
    await page.getByRole("article", { name: "Action" }).getByRole("button", { name: "Buy…" }).click();
    await page
      .getByRole("dialog", { name: "Buy the Action pack?" })
      .getByRole("button", { name: "Buy for 400 Karma" })
      .click();
    await expect.poll(() => api.count("POST /api/shop/buy")).toBe(1);

    // Back with the confirmation in flight leaves the page (navigation-and-landing.md §3.10 item 4).
    await page.goBack();
    await onPacks(page);
    answer.release();
    await page.waitForLoadState("networkidle");
    await expect(nav(page).getByRole("link", { name: "Collection (5)" })).toBeVisible();
    await onPacks(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The answer still applies: the header takes the receipt's balance.
    await expect(page.getByRole("banner")).toContainText("840");
  });

  test("the words on /shop/open hold nothing §8 forbids", async ({ page }) => {
    await page.goto("/shop");
    await page.getByRole("article", { name: "Action" }).getByRole("button", { name: "Buy…" }).click();
    await page
      .getByRole("dialog", { name: "Buy the Action pack?" })
      .getByRole("button", { name: "Buy for 400 Karma" })
      .click();
    await expect(page.getByRole("list", { name: "Action pack" }).getByRole("article")).toHaveCount(5);
    const text = await main(page).innerText();
    expect(text).toContain("Shop pack");
    expect(text.match(FORBIDDEN)?.[0] ?? null, text).toBeNull();
  });
});
