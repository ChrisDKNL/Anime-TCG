/// <reference lib="dom" />
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { CharacterPublic, FranchiseRef, PackOpened } from "@anime-tcg/shared/api";
import {
  makeAllowance,
  makeCharacter,
  makeCollection,
  makeEntry,
  makeFranchise,
  makeOdds,
  makeOpenedCard,
  makePackOpened,
  makePacks,
} from "../src/test/fixtures";
import {
  deferred,
  envelope,
  expect,
  makeAccount,
  mockCardImages,
  recordStatusTexts,
  signedIn,
  signedOut,
  statusTexts,
  test,
  type Answer,
  type ApiCall,
  type FakeApi,
} from "./support/fake-api";

/**
 * Test plan (tester's hunt): what the packs PR's own e2e does not reach, against the scripted api
 * (docs/design/packs-page.md §3.3, §4.1, §7, §8, §10; collection-packs.md §5.3, §8;
 * navigation-and-landing.md §3.5 step 8, §3.11, §8). The scripted api replays a known `requestId`
 * like the real one (200, the cards that opening dealt, the allowance as it is now).
 *
 * Single flight (§3.3 step 2, §10 item 5)
 * - A double click and a held Enter (repeating keydowns) while the opening is in flight send one
 *   `POST` and spend one pack.
 * - Regression (manager decision, 2026-10-30): the same when the answer lands between the two
 *   clicks or between two repeats; the second click (`detail` 2) and the repeats (`repeat: true`)
 *   are ignored, and a later single click or Enter opens the next pack.
 * - An activation during the 429 wait sends nothing.
 *
 * Lost answer (§3.3 table "no answer", step 4; §10 item 6)
 * - The server deals, then the connection drops (or a proxy error page comes back): the banner,
 *   the no-answer line and `Try again`; count and pity as held. `Try again` sends the same
 *   `requestId` and shows exactly the cards the lost answer carried; one pack spent in all.
 * - The key survives a page change; with the last pack lost, a later `GET` reads 0 of 3 and the
 *   button still reads `Try again` and replays; also while cards are unavailable.
 * - A reload drops the key: `Open pack`, a new `requestId`, and the lost pack is in the collection.
 *
 * Newest request wins (§3.1 step 5)
 * - A `GET` sent on returning to `/packs` and answered after an opening that followed it does not
 *   step the count or the pity line back.
 *
 * 409 (§3.3 table, §4.1 "none left", §10 item 9)
 * - Two browser contexts on one account: the second opens the last pack; the first's click shows
 *   `There was no pack left to open.`, 0 of 3, the countdown, keeps focus, sends exactly one
 *   follow-up `GET /api/packs` and refetches the collection.
 *
 * 401 mid-session (§4.1 "session ended"; navigation-and-landing.md §3.5 step 8)
 * - On the opening (also with a key held), on returning to `/packs` and on `/collection`: `/login`
 *   replaces the page, the banner, the `Log in` h1 focused, the page as the return path; logging in
 *   lands there with no reveal and no key (a new `requestId`).
 *
 * 429 with `Retry-After` (§3.3 table, §4.1, §9 questions 2 and 3; §10 item 12)
 * - `Try again in 3 s`, aria-disabled, counting down; the wait line once; then `You can try again
 *   now.` once and the retry carries the same `requestId`. Without the header: 60 s. After a lost
 *   answer, one key across the lost try, the 429 and the replay.
 *
 * Hostile AniList text (§7 T1; collection-packs.md §9; §10 item 13)
 * - Names and series titles with markup, an RTL override, zero-width characters, combining marks
 *   and 200+ characters without a space render as text in the reveal and in the collection: no
 *   element or handler is created, the full string is the element's text and, between FSI and
 *   PDI, its `title`; nothing else sits inside the name's element, which has `dir="auto"`; and at
 *   320 px nothing widens a column or the page.
 *
 * Nothing nags (§2, §10 item 14)
 * - Across a countdown to zero (tab hidden), an opening and a 429 wait: no Notification permission
 *   request or notification, no permission query, badge, vibration, sound or service worker; the
 *   title stays `Packs · Anime TCG` and the favicon is unchanged.
 *
 * `free` (navigation-and-landing.md §8, packs-page.md §9 question 1)
 * - On every other page, signed in and out, no `free` in any text, label, title or announcement.
 * - On `/packs` and in the odds dialog, every `free` is exactly `free pack` or `free packs`; with
 *   `freePacksOnly` false there is none.
 *
 * Scroll across a reload (navigation-and-landing.md §3.11 step 3)
 * - The collection not yet answered when Back lands on `/collection`: the page starts at the top
 *   and does not jump when the data arrives (the held case is navigation.hunt.spec.ts).
 */

const CHRIS = makeAccount();
const SESSION_ENDED = "You were logged out. Log in again to continue.";
const UNREACHABLE = "Couldn't reach the game server. Check your connection and try again.";
const NO_ANSWER = "Couldn't reach the game server. Trying again opens this same pack, never a second one.";
const NONE_LEFT = "There was no pack left to open.";
const WAIT_LINE = "Packs take a short pause after many requests in a row. The button comes back by itself.";
const UNAVAILABLE = "Cards are unavailable right now. Your packs are kept until they're back.";

const main = (page: Page) => page.getByRole("main");
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });
/** The pack button by whatever it reads now: `Open pack`, `Opening…`, `Try again`, `Try again in <S> s`. */
const packButton = (page: Page, name: string | RegExp = "Open pack") =>
  main(page).getByRole("button", { name, exact: typeof name === "string" ? true : undefined });
const revealList = (page: Page) => page.getByRole("list", { name: "Your pack" });
const heldReturnTo = (page: Page) =>
  page.evaluate(() => (history.state as { returnTo?: unknown } | null)?.returnTo);

function requestIds(api: FakeApi): string[] {
  return api.bodies("POST /api/packs/open").map((body) => (body as { requestId: string }).requestId);
}

/** The character names of the reveal's articles, in DOM order. */
async function revealNames(page: Page): Promise<string[]> {
  return revealList(page)
    .getByRole("article")
    .evaluateAll((articles) => articles.map((a) => a.querySelector("[title]")?.textContent ?? ""));
}

/** What the scripted game deals for its `n`th opening: the names the reveal must show. */
const namesOfOpening = (n: number) => [0, 1, 2, 3, 4].map((slot) => `Character ${1_000 + n * 10 + slot}`);

/** The default game, answered by the test's own script. */
const game = (api: FakeApi) => (call: ApiCall) => api.game.reply(call.key, call.body)!;

/** The server deals the opening, then its answer is lost on the way back. */
function dealThenLose(api: FakeApi, lost: "abort" | Answer = "abort") {
  return (call: ApiCall) => {
    api.game.reply(call.key, call.body);
    return lost;
  };
}

async function logIn(page: Page) {
  await page.getByRole("textbox", { name: "Login", exact: true }).fill("Chris");
  await page.getByLabel("Password", { exact: true }).fill("correct horse");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

test.describe("single flight (§3.3 step 2)", () => {
  test("a double click while the opening is in flight sends one POST and spends one pack", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    const opening = deferred();
    api.on("POST /api/packs/open", async (call) => {
      await opening.promise;
      return game(api)(call);
    });
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();

    await packButton(page).dblclick();
    await expect(packButton(page, "Opening…")).toHaveAttribute("aria-disabled", "true");
    await expect(packButton(page, "Opening…")).toBeFocused();
    opening.release();

    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: "Collection (5)" })).toBeVisible();
    expect(api.count("POST /api/packs/open")).toBe(1);
    expect(api.game.opened).toBe(1);
  });

  test("Enter held down while the opening is in flight sends one POST and spends one pack", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    const opening = deferred();
    api.on("POST /api/packs/open", async (call) => {
      await opening.promise;
      return game(api)(call);
    });
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
    await packButton(page).focus();

    // The first keydown, then the auto-repeats (Playwright sends `repeat: true` while the key is down).
    await page.keyboard.down("Enter");
    await expect(packButton(page, "Opening…")).toBeVisible();
    for (let repeat = 0; repeat < 10; repeat += 1) await page.keyboard.down("Enter");
    await expect.poll(() => api.count("POST /api/packs/open")).toBe(1);
    opening.release();
    await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
    await page.keyboard.up("Enter");

    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    await expect(packButton(page)).toBeFocused();
    expect(api.count("POST /api/packs/open")).toBe(1);
    expect(api.game.opened).toBe(1);
  });

  /*
   * The tester's hunt found these as bugs: a local or LAN api answers in tens of milliseconds, a
   * double click is up to ~500 ms and a keyboard auto-repeats every ~33 ms after ~500 ms, so the
   * in-flight guard alone let the late activation open another pack.
   */
  test("a double click whose second click comes after the answer opens one pack; a later click opens the next", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
    const box = await packButton(page).boundingBox();
    if (box === null) throw new Error("Open pack has no box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // The first click of the double click; the server answers before the second one.
    await page.mouse.click(x, y);
    await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
    // The second click of the same double click, `detail` 2 as the browser sends it.
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await page.waitForLoadState("networkidle");

    expect(api.count("POST /api/packs/open"), "openings sent by one double click").toBe(1);
    await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
    expect(await revealNames(page)).toEqual(namesOfOpening(1));

    // A deliberate single click after the double click (`detail` 1 again) opens the next pack.
    await page.mouse.click(x, y);
    await expect(page.getByText("1 of 3 packs ready")).toBeVisible();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(2));
    expect(api.count("POST /api/packs/open")).toBe(2);
  });

  test("Enter held past the answer opens one pack; a later Enter opens the next", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
    await packButton(page).focus();

    await page.keyboard.down("Enter");
    await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
    // The key is still down: the keyboard's auto-repeat (`repeat: true`).
    for (let repeat = 0; repeat < 3; repeat += 1) await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await page.waitForLoadState("networkidle");

    expect(api.count("POST /api/packs/open"), "openings sent by one held Enter").toBe(1);
    await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
    expect(await revealNames(page)).toEqual(namesOfOpening(1));

    // A new press of Enter is a new activation.
    await page.keyboard.press("Enter");
    await expect(page.getByText("1 of 3 packs ready")).toBeVisible();
    await expect.poll(() => revealNames(page)).toEqual(namesOfOpening(2));
    await expect(packButton(page)).toBeFocused();
    expect(api.count("POST /api/packs/open")).toBe(2);
  });
});

test.describe("a lost answer never costs a pack (§3.3, §10 item 6)", () => {
  for (const [what, lost] of [
    ["the connection drops", "abort"],
    ["a proxy error page comes back", { status: 502, raw: "<html><body>502 Bad Gateway</body></html>" }],
  ] as const) {
    test(`the server deals, ${what}: Try again sends the same requestId and shows the cards it dealt`, async ({
      page,
      api,
    }) => {
      api.on("GET /api/session", signedIn(CHRIS));
      api.on("POST /api/packs/open", dealThenLose(api, lost), game(api));
      await page.goto("/packs");
      await expect(page.getByText("3 of 3 packs ready")).toBeVisible();

      await packButton(page).click();
      await expect(page.getByRole("alert").filter({ hasText: UNREACHABLE })).toBeVisible();
      await expect(main(page).getByText(NO_ANSWER)).toBeVisible();
      const retry = packButton(page, "Try again");
      await expect(retry).toBeVisible();
      await expect(retry).not.toHaveAttribute("aria-disabled");
      await expect(retry).toBeFocused();
      // The answer never arrived, so the page shows what it held.
      await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
      await expect(page.getByText("Mythic guaranteed within 300 free packs.")).toBeVisible();
      await expect(revealList(page)).toHaveCount(0);
      expect(api.game.opened).toBe(1);

      await retry.click();
      await expect(revealList(page).getByRole("article")).toHaveCount(5);
      const [first, second] = requestIds(api);
      expect(second).toBe(first);
      // The pack the lost answer carried, not a second one.
      expect(await revealNames(page)).toEqual(namesOfOpening(1));
      await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
      await expect(page.getByText("Mythic guaranteed within 299 free packs.")).toBeVisible();
      await expect(mainNav(page).getByRole("link", { name: "Collection (5)" })).toBeVisible();
      await expect(main(page).getByText(NO_ANSWER)).toHaveCount(0);
      await expect(packButton(page)).toBeFocused();
      expect(api.game.opened).toBe(1);
      expect(api.count("POST /api/packs/open")).toBe(2);
    });
  }

  test("the key survives a page change; with the last pack lost, 0 of 3 still reads Try again and replays it", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.game.available = 1;
    api.on("POST /api/packs/open", dealThenLose(api), game(api));
    await page.goto("/packs");
    await expect(page.getByText("1 of 3 packs ready")).toBeVisible();
    await packButton(page).click();
    await expect(packButton(page, "Try again")).toBeVisible();

    await mainNav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await expect(h1(page, "Collection")).toBeFocused();
    await mainNav(page).getByRole("link", { name: "Packs", exact: true }).click();
    await expect(h1(page, "Packs")).toBeFocused();
    // Returning refetched the allowance: the server spent the last pack.
    await expect(page.getByText("0 of 3 packs ready")).toBeVisible();
    const retry = packButton(page, "Try again");
    await expect(retry).not.toHaveAttribute("aria-disabled");

    await retry.click();
    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    expect(await revealNames(page)).toEqual(namesOfOpening(1));
    const ids = requestIds(api);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    await expect(page.getByText("0 of 3 packs ready")).toBeVisible();
    await expect(packButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Next pack in 10:00")).toBeVisible();
    expect(api.game.opened).toBe(1);
  });

  test("with a key held, cards unavailable keeps Try again, and the retry still shows the pack", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on(
      "GET /api/packs",
      { status: 200, json: makePacks() },
      {
        status: 200,
        json: {
          allowance: makeAllowance({ available: 2, nextPackInSeconds: 600 }),
          odds: null,
          packsUntilGuarantee: null,
        },
      },
    );
    api.on("POST /api/packs/open", dealThenLose(api), game(api));
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
    await packButton(page).click();
    await expect(packButton(page, "Try again")).toBeVisible();
    await mainNav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await mainNav(page).getByRole("link", { name: "Packs", exact: true }).click();

    await expect(main(page).getByText(UNAVAILABLE)).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Check again" })).toBeVisible();
    const retry = packButton(page, "Try again");
    await expect(retry).not.toHaveAttribute("aria-disabled");
    await retry.click();
    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    expect(await revealNames(page)).toEqual(namesOfOpening(1));
    const ids = requestIds(api);
    expect(ids[1]).toBe(ids[0]);
  });

  test("a reload drops the key: Open pack, a new requestId, and the lost pack is in the collection", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/packs/open", dealThenLose(api), game(api));
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
    await packButton(page).click();
    await expect(packButton(page, "Try again")).toBeVisible();

    await page.reload();
    await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: "Collection (5)" })).toBeVisible();
    await expect(packButton(page, "Try again")).toHaveCount(0);
    await packButton(page).click();
    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    expect(await revealNames(page)).toEqual(namesOfOpening(2));
    const ids = requestIds(api);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
    await expect(mainNav(page).getByRole("link", { name: "Collection (10)" })).toBeVisible();
  });
});

test("newest request wins: a GET sent before an opening and answered after it does not step the count back (§3.1 step 5)", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedIn(CHRIS));
  await page.goto("/packs");
  await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
  await mainNav(page)
    .getByRole("link", { name: /^Collection/ })
    .click();
  await expect(h1(page, "Collection")).toBeFocused();

  // The server answers the refetch as it stands now (3 of 3), but the answer is slow to arrive.
  const slow = deferred();
  api.on("GET /api/packs", async (call) => {
    const stale = game(api)(call);
    await slow.promise;
    return stale;
  });
  await mainNav(page).getByRole("link", { name: "Packs", exact: true }).click();
  // The held answer shows at once while the refetch is out.
  await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
  await expect.poll(() => api.count("GET /api/packs")).toBe(2);
  await packButton(page).click();
  await expect(revealList(page).getByRole("article")).toHaveCount(5);
  await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
  await expect(page.getByText("Mythic guaranteed within 299 free packs.")).toBeVisible();

  slow.release();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
  await expect(page.getByText("Mythic guaranteed within 299 free packs.")).toBeVisible();
  await expect(page.getByText("Next pack in 10:00")).toBeVisible();
});

/** A second tab of the same account in its own context, against the same scripted server. */
async function secondTab(browser: Browser, api: FakeApi): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await mockCardImages(context);
  await context.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) => api.handle(route),
  );
  return { context, page: await context.newPage() };
}

test("409: another tab opened the last pack; this one says so, counts down and asks once", async ({
  page,
  api,
  browser,
  baseURL,
}) => {
  api.on("GET /api/session", signedIn(CHRIS));
  api.game.available = 1;
  const packGets: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/packs")
      packGets.push(request.url());
  });
  await page.goto("/packs");
  await expect(page.getByText("1 of 3 packs ready")).toBeVisible();

  const other = await secondTab(browser, api);
  try {
    await other.page.goto(`${baseURL}/packs`);
    await other.page.getByRole("main").getByRole("button", { name: "Open pack", exact: true }).click();
    await expect(other.page.getByRole("list", { name: "Your pack" }).getByRole("article")).toHaveCount(5);
    await expect(other.page.getByText("0 of 3 packs ready")).toBeVisible();
  } finally {
    await other.context.close();
  }

  // This tab still holds 1 of 3: the click reaches the server, which has none left.
  expect(packGets).toHaveLength(1);
  await packButton(page).click();
  const line = main(page).getByRole("status").filter({ hasText: NONE_LEFT });
  await expect(line).toBeVisible();
  await expect(page.getByText("0 of 3 packs ready")).toBeVisible();
  await expect(packButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(packButton(page)).toBeFocused();
  await expect(page.getByText(/^Next pack in (10:00|9:5\d)$/)).toBeVisible();
  await expect(revealList(page)).toHaveCount(0);
  // Another tab changed the collection: it is asked again.
  await expect(mainNav(page).getByRole("link", { name: "Collection (5)" })).toBeVisible();
  await expect.poll(() => packGets.length).toBe(2);
  // The follow-up answer (still none ready) keeps the line; nothing else is asked.
  await expect(line).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(packGets).toHaveLength(2);
  expect(api.count("POST /api/packs/open")).toBe(2);
  expect(api.game.opened).toBe(1);
});

test.describe("401 mid-session: /login with the return path (navigation-and-landing.md §3.5 step 8)", () => {
  test("on the opening, with a key held: after logging in, /packs with no reveal and no key", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/session/login", signedIn(CHRIS));
    api.on("POST /api/packs/open", game(api), dealThenLose(api), envelope(401, "unauthenticated"), game(api));
    await page.goto("/packs");
    await packButton(page).click();
    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    await packButton(page).click();
    await expect(packButton(page, "Try again")).toBeVisible();

    await packButton(page, "Try again").click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page, "Log in")).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: SESSION_ENDED })).toBeVisible();
    expect(await heldReturnTo(page)).toBe("/packs");
    await expect(mainNav(page).getByRole("link", { name: /^Collection/ })).toHaveCount(0);

    await logIn(page);
    await expect(page).toHaveURL(/\/packs$/);
    await expect(h1(page, "Packs")).toBeFocused();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText("1 of 3 packs ready")).toBeVisible();
    // The lost pack is the server's: it is in the collection, and the key went with the session.
    await expect(mainNav(page).getByRole("link", { name: "Collection (10)" })).toBeVisible();
    await packButton(page).click();
    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    const ids = requestIds(api);
    expect(ids).toHaveLength(4);
    expect(ids[2]).toBe(ids[1]);
    expect(ids[3]).not.toBe(ids[1]);
    expect(await revealNames(page)).toEqual(namesOfOpening(3));
  });

  test("on returning to /packs and on /collection: each page is its own return path", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/session/login", signedIn(CHRIS));
    api.on("GET /api/packs", game(api), envelope(401, "unauthenticated"), game(api));
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
    await mainNav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await expect(h1(page, "Collection")).toBeFocused();
    await mainNav(page).getByRole("link", { name: "Packs", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page, "Log in")).toBeFocused();
    expect(await heldReturnTo(page)).toBe("/packs");
    const collectionGets = api.count("GET /api/collection");
    await logIn(page);
    await expect(page).toHaveURL(/\/packs$/);
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
    // The sign-in fetches the collection; only the next ask, from showing /collection, is a 401.
    await expect.poll(() => api.count("GET /api/collection")).toBe(collectionGets + 1);
    await page.waitForLoadState("networkidle");

    api.on("GET /api/collection", envelope(401, "unauthenticated"));
    await mainNav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page, "Log in")).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: SESSION_ENDED })).toBeVisible();
    expect(await heldReturnTo(page)).toBe("/collection");
    api.on("GET /api/collection", game(api));
    await logIn(page);
    await expect(page).toHaveURL(/\/collection$/);
    await expect(h1(page, "Collection")).toBeFocused();
    await expect(page.getByText("No cards yet").first()).toBeVisible();
  });
});

test.describe("429 with Retry-After (§3.3, §4.1, §9 questions 2 and 3)", () => {
  const limited = (headers?: Record<string, string>): Answer => ({
    ...envelope(429, "rate_limited"),
    headers,
  });

  test("the wait from Retry-After, shown once, then the retry carries the same requestId", async ({
    page,
    api,
  }) => {
    await recordStatusTexts(page);
    await page.clock.install();
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/packs/open", limited({ "Retry-After": "3" }), game(api));
    await page.goto("/packs");
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();

    await packButton(page).click();
    const waiting = packButton(page, /^Try again in \d+ s$/);
    await expect(waiting).toHaveText("Try again in 3 s");
    await expect(waiting).toHaveAttribute("aria-disabled", "true");
    await expect(waiting).toBeFocused();
    await expect(main(page).getByRole("status").filter({ hasText: WAIT_LINE })).toBeVisible();
    await expect(page.getByText("3 of 3 packs ready")).toBeVisible();
    await expect(page.getByText("Mythic guaranteed within 300 free packs.")).toBeVisible();

    // An activation during the wait does nothing.
    await waiting.click({ force: true });
    await page.keyboard.press("Enter");
    await page.clock.runFor(1_000);
    await expect(waiting).toHaveText("Try again in 2 s");
    await page.clock.runFor(1_000);
    await expect(waiting).toHaveText("Try again in 1 s");
    await page.clock.runFor(1_000);
    // The key was kept, so the button offers to try that same opening again.
    const retry = packButton(page, "Try again");
    await expect(retry).not.toHaveAttribute("aria-disabled");
    await expect(retry).toBeFocused();
    await expect(main(page).getByText(WAIT_LINE)).toHaveCount(0);
    await expect.poll(() => statusTexts(page)).toContain("You can try again now.");
    expect(api.count("POST /api/packs/open")).toBe(1);

    await retry.click();
    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    const ids = requestIds(api);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    await expect(page.getByText("2 of 3 packs ready")).toBeVisible();
    const texts = await statusTexts(page);
    expect(texts.filter((text) => text === WAIT_LINE)).toHaveLength(1);
    expect(texts.filter((text) => text === "You can try again now.")).toHaveLength(1);
  });

  test("no Retry-After and no number in the body: the 60 s fallback", async ({ page, api }) => {
    await page.clock.install();
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/packs/open", limited(), game(api));
    await page.goto("/packs");
    await packButton(page).click();
    await expect(packButton(page, "Try again in 60 s")).toHaveAttribute("aria-disabled", "true");
    await page.clock.runFor(59_000);
    await expect(packButton(page, "Try again in 1 s")).toBeVisible();
    await page.clock.runFor(1_000);
    await expect(packButton(page, "Try again")).not.toHaveAttribute("aria-disabled");
  });

  test("after a lost answer: one key across the lost try, the 429 and the replay", async ({ page, api }) => {
    await page.clock.install();
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/packs/open", dealThenLose(api), limited({ "Retry-After": "2" }), game(api));
    await page.goto("/packs");
    await packButton(page).click();
    await packButton(page, "Try again").click();
    await expect(packButton(page, "Try again in 2 s")).toBeVisible();
    await page.clock.runFor(2_000);
    await packButton(page, "Try again").click();
    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    expect(await revealNames(page)).toEqual(namesOfOpening(1));
    expect(new Set(requestIds(api)).size).toBe(1);
    expect(requestIds(api)).toHaveLength(3);
    expect(api.game.opened).toBe(1);
  });
});

/** AniList strings a snapshot can carry (collection-packs.md §9 "Hostile pool content"). */
const HOSTILE: { name: string; series: string }[] = [
  { name: `<img src=x onerror="window.__xss='name'">`, series: `<script>window.__xss='series'</script>` },
  { name: "‮gnp.exe‬ Kun", series: "‮seires‬ Season 2" },
  { name: "Ze​ro‌wi‍dth⁠Chan﻿", series: "Zero​​Width Series" },
  { name: "W".repeat(220), series: `Series${"S".repeat(300)}` },
  { name: `Z${"́".repeat(50)}alg${"̶".repeat(20)}o`, series: `<b onmouseover="window.__xss='b'">bold</b>` },
];

const hostileCharacter = (i: number): CharacterPublic =>
  makeCharacter(9_000 + i, { name: HOSTILE[i].name, franchiseIds: [900 + i] });
const HOSTILE_FRANCHISES: FranchiseRef[] = HOSTILE.map(({ series }, i) =>
  makeFranchise(900 + i, { title: series }),
);
const HOSTILE_PACK: PackOpened = {
  ...makePackOpened({
    cards: HOSTILE.map((_, i) =>
      makeOpenedCard(i, { character: { ...hostileCharacter(i), tier: makeOpenedCard(i).rarity } }),
    ),
  }),
  franchises: HOSTILE_FRANCHISES,
};

/**
 * In the page: for each card in `scope`, the element holding the name (found by its `title`, the
 * name between FSI and PDI) has exactly the name as its text, no child element and `dir="auto"`;
 * the series likewise; the article's label holds both, each isolated (collection-overview.md §5.6).
 */
async function expectCardsAsText(page: Page, scope: "Your pack" | "Your cards") {
  const report = await page.getByRole("list", { name: scope }).evaluate((list, hostile) => {
    const isolated = (text: string) => `\u2068${text}\u2069`;
    return hostile.map(({ name, series }) => {
      const byTitle = (text: string) =>
        Array.from(list.querySelectorAll("[title]")).filter(
          (element) => element.getAttribute("title") === isolated(text),
        );
      const asText = (element: Element | undefined, text: string) =>
        element?.textContent === text &&
        element.childElementCount === 0 &&
        element.getAttribute("dir") === "auto";
      const [nameElement] = byTitle(name);
      const [seriesElement] = byTitle(series);
      return {
        name: asText(nameElement, name),
        series: asText(seriesElement, series),
        label: Array.from(list.querySelectorAll("article")).some((article) => {
          const label = article.getAttribute("aria-label") ?? "";
          return label.includes(isolated(name)) && label.includes(isolated(series));
        }),
      };
    });
  }, HOSTILE);
  expect(report).toEqual(HOSTILE.map(() => ({ name: true, series: true, label: true })));
}

/** No element, attribute or script came out of the strings, and every image is card art. */
async function expectNothingInjected(page: Page) {
  await page.waitForLoadState("load");
  expect(await page.evaluate(() => (window as { __xss?: unknown }).__xss)).toBeUndefined();
  await expect(page.locator("[onerror], [onmouseover], main script, main b")).toHaveCount(0);
  const sources = await main(page)
    .locator("img")
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  expect(sources.length).toBeGreaterThan(0);
  for (const source of sources) expect(source).toMatch(/^https:\/\/s4\.anilist\.co\//);
}

/** At 320 px: no sideways scroll, and every card is as wide as the first (nothing widened its column). */
async function expectContained(page: Page, scope: "Your pack" | "Your cards") {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const widths = await page
    .getByRole("list", { name: scope })
    .getByRole("article")
    .evaluateAll((articles) => articles.map((article) => Math.round(article.getBoundingClientRect().width)));
  expect(new Set(widths).size).toBe(1);
}

test.describe("hostile AniList text renders as text (§7 T1)", () => {
  test("in the reveal", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/packs/open", { status: 201, json: HOSTILE_PACK });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/packs");
    await packButton(page).click();
    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    await expectCardsAsText(page, "Your pack");
    await expectNothingInjected(page);
    await expectContained(page, "Your pack");
  });

  test("in the collection, the Rarity filter included", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("GET /api/collection", {
      status: 200,
      json: {
        ...makeCollection(HOSTILE.map((_, i) => makeEntry(hostileCharacter(i), { count: i + 1 }))),
        franchises: HOSTILE_FRANCHISES,
      },
    });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/collection");
    await expect(page.getByRole("list", { name: "Your cards" }).getByRole("article")).toHaveCount(5);
    await expectCardsAsText(page, "Your cards");
    await expectNothingInjected(page);
    await expectContained(page, "Your cards");
    // The filter and its no-match line name tiers only, never a character.
    await page.getByLabel("Rarity").selectOption("mythic");
    await expect(page.getByText("No Mythic cards in your collection.")).toBeVisible();
    await page.getByLabel("Rarity").selectOption("all");
    await expect(page.getByRole("list", { name: "Your cards" }).getByRole("article")).toHaveCount(5);
  });
});

declare global {
  interface Window {
    __nags?: string[];
    __titles?: string[];
  }
}

/** Counts every way a page could nag (packs-page.md §2) and records every title the document takes. */
async function recordNags(page: Page) {
  await page.addInitScript(() => {
    const nags: string[] = [];
    window.__nags = nags;
    const count = <T extends object>(target: T, key: keyof T & string, label: string) => {
      const original = target[key];
      if (typeof original !== "function") return;
      (target as Record<string, unknown>)[key] = function (this: unknown, ...args: unknown[]) {
        nags.push(label);
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
    };
    if ("Notification" in window) {
      const Original = window.Notification;
      Original.requestPermission = () => {
        nags.push("Notification.requestPermission");
        return Promise.resolve("denied");
      };
      window.Notification = new Proxy(Original, {
        construct(target, args) {
          nags.push("new Notification");
          return Reflect.construct(target, args) as object;
        },
      });
    }
    if (navigator.permissions) {
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (descriptor) => {
        nags.push(`permissions.query ${descriptor.name}`);
        return query(descriptor);
      };
    }
    count(navigator, "setAppBadge", "setAppBadge");
    count(navigator, "clearAppBadge", "clearAppBadge");
    count(navigator, "vibrate", "vibrate");
    count(HTMLMediaElement.prototype, "play", "media.play");
    if (navigator.serviceWorker) count(navigator.serviceWorker, "register", "serviceWorker.register");
    if ("AudioContext" in window) {
      window.AudioContext = new Proxy(window.AudioContext, {
        construct(target, args) {
          nags.push("new AudioContext");
          return Reflect.construct(target, args) as object;
        },
      });
    }
    const titles: string[] = [];
    window.__titles = titles;
    new MutationObserver(() => {
      if (titles.at(-1) !== document.title) titles.push(document.title);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

test("nothing nags: no notification, permission, badge, sound or title change through a countdown, an opening and a wait", async ({
  page,
  api,
}) => {
  await recordNags(page);
  await recordStatusTexts(page);
  await page.clock.install();
  api.on("GET /api/session", signedIn(CHRIS));
  api.on(
    "GET /api/packs",
    { status: 200, json: makePacks({ allowance: makeAllowance({ available: 0, nextPackInSeconds: 5 }) }) },
    { status: 200, json: makePacks({ allowance: makeAllowance({ available: 1, nextPackInSeconds: 600 }) }) },
  );
  api.on(
    "POST /api/packs/open",
    { ...envelope(429, "rate_limited"), headers: { "Retry-After": "2" } },
    game(api),
  );
  await page.goto("/packs");
  await expect(page.getByText("Next pack in 0:05")).toBeVisible();
  const favicon = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel~="icon"]')).map((link) => link.getAttribute("href")),
    );
  const iconsBefore = await favicon();

  // The player looks away while the pack comes in.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("blur"));
  });
  await page.clock.runFor(5_000);
  await expect(page.getByText("1 of 3 packs ready", { exact: true })).toBeVisible();
  await expect.poll(() => statusTexts(page)).toContain("1 of 3 packs ready.");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  await packButton(page).click();
  await expect(packButton(page, "Try again in 2 s")).toBeVisible();
  await page.clock.runFor(2_000);
  await packButton(page, "Try again").click();
  await expect(revealList(page).getByRole("article")).toHaveCount(5);
  // Past the next countdown's zero: its one `GET` lands, and the title still does not change.
  const gets = api.count("GET /api/packs");
  await page.clock.runFor(11 * 60_000);
  await expect.poll(() => api.count("GET /api/packs")).toBe(gets + 1);

  expect(await page.evaluate(() => window.__nags)).toEqual([]);
  const titles = (await page.evaluate(() => window.__titles)) ?? [];
  expect(titles.slice(titles.indexOf("Packs · Anime TCG"))).toEqual(["Packs · Anime TCG"]);
  await expect(page).toHaveTitle("Packs · Anime TCG");
  expect(await favicon()).toEqual(iconsBefore);

  // The recorder is live (the empty list above is not vacuous).
  await page.evaluate(async () => {
    await Notification.requestPermission();
    navigator.vibrate(1);
  });
  expect(await page.evaluate(() => window.__nags)).toEqual(["Notification.requestPermission", "vibrate"]);
});

/** Every string a page shows or names: its text, the title, every label, title and alt, the announcements. */
async function pageStrings(page: Page): Promise<string[]> {
  const shown = await page.evaluate(() => {
    const strings = [document.title, document.body.innerText];
    for (const element of Array.from(
      document.querySelectorAll("[aria-label], [title], [alt], [placeholder]"),
    )) {
      for (const attribute of ["aria-label", "title", "alt", "placeholder"]) {
        const value = element.getAttribute(attribute);
        if (value) strings.push(value);
      }
    }
    return strings;
  });
  return [...shown, ...(await statusTexts(page))];
}

/** Each `free` that is not exactly the owner's phrase `free pack` or `free packs`. */
function looseFree(strings: string[]): string[] {
  const loose: string[] = [];
  for (const text of strings) {
    for (const match of text.matchAll(/\bfree\b/gi)) {
      const at = match.index;
      if (!/^free packs?\b/.test(text.slice(at))) loose.push(text.slice(Math.max(0, at - 20), at + 20));
    }
  }
  return loose;
}

const anyFree = (strings: string[]) => strings.filter((text) => /\bfree\b/i.test(text));

/** An Enchanted pack whose Mythic came from the guarantee: both lines that carry `free pack`. */
const ENCHANTED_PITY = makePackOpened({
  packKind: "enchanted",
  pityMythic: true,
  cards: [0, 1, 2, 3, 4].map((slot) => makeOpenedCard(slot, { rarity: slot === 4 ? "mythic" : "common" })),
});

test.describe("`free` only as `free pack(s)`, only on /packs and in the odds dialog (§8)", () => {
  test("on /packs, the reveal's lines and the odds dialog: only the exact phrases", async ({ page, api }) => {
    await recordStatusTexts(page);
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("POST /api/packs/open", { status: 201, json: ENCHANTED_PITY });
    await page.goto("/packs");
    await packButton(page).click();
    await expect(page.getByRole("heading", { level: 2, name: "Enchanted pack" })).toBeVisible();
    await page.getByRole("button", { name: "Pack odds" }).click();
    const dialog = page.getByRole("dialog", { name: "Pack odds" });
    await expect(dialog).toBeVisible();

    const strings = await pageStrings(page);
    const dialogText = await dialog.innerText();
    expect(looseFree([...strings, dialogText])).toEqual([]);
    // The phrase is there (the scan is not vacuous): the pity line, both reveal lines, the dialog.
    expect(strings.join("\n")).toContain("Mythic guaranteed within 299 free packs.");
    expect(strings.join("\n")).toContain("Every 10th free pack is Enchanted");
    expect(strings.join("\n")).toContain("a 300th free pack in a row");
    expect(dialogText).toMatch(/\bfree pack\b/);
  });

  test("when the rules count every pack, /packs and the odds dialog say no `free` at all", async ({
    page,
    api,
  }) => {
    await recordStatusTexts(page);
    const odds = makeOdds({ pity: { packs: 300, freePacksOnly: false } });
    api.on("GET /api/session", signedIn(CHRIS));
    api.on("GET /api/packs", { status: 200, json: makePacks({ odds }) });
    api.on("POST /api/packs/open", { status: 201, json: ENCHANTED_PITY });
    await page.goto("/packs");
    await packButton(page).click();
    await expect(page.getByRole("heading", { level: 2, name: "Enchanted pack" })).toBeVisible();
    await expect(page.getByText("Mythic guaranteed within 299 packs.")).toBeVisible();
    await page.getByRole("button", { name: "Pack odds" }).click();
    const dialog = page.getByRole("dialog", { name: "Pack odds" });
    await expect(dialog).toBeVisible();
    expect(anyFree([...(await pageStrings(page)), await dialog.innerText()])).toEqual([]);
  });

  test("signed in, every other page: no `free` anywhere", async ({ page, api }) => {
    await recordStatusTexts(page);
    api.on("GET /api/session", signedIn(CHRIS));
    await page.goto("/collection");
    await expect(page.getByText("No cards yet").first()).toBeVisible();
    const seen = [...(await pageStrings(page))];
    await mainNav(page).getByRole("link", { name: "Packs", exact: true }).click();
    await packButton(page).click();
    await expect(revealList(page).getByRole("article")).toHaveCount(5);
    for (const path of ["/collection", "/account", "/profile", "/no-such-page"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path === "/collection") {
        await expect(page.getByRole("list", { name: "Your cards" }).getByRole("article")).toHaveCount(5);
      }
      seen.push(...(await pageStrings(page)));
    }
    expect(anyFree(seen)).toEqual([]);
  });

  test("signed out, every page: no `free` anywhere", async ({ page, api }) => {
    await recordStatusTexts(page);
    api.on("GET /api/session", signedOut);
    const seen: string[] = [];
    for (const path of ["/", "/login", "/register", "/no-such-page"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      seen.push(...(await pageStrings(page)));
    }
    expect(anyFree(seen)).toEqual([]);
  });
});

test("Back across a reload before the collection has answered: the top, and no jump when it arrives (§3.11 step 3)", async ({
  page,
  api,
}) => {
  api.on("GET /api/session", signedIn(CHRIS));
  api.game.cap = 4;
  api.game.available = 4;
  let hold: ReturnType<typeof deferred> | null = null;
  api.on("GET /api/collection", async (call) => {
    if (hold !== null) await hold.promise;
    return game(api)(call);
  });
  await page.setViewportSize({ width: 800, height: 420 });
  await page.goto("/packs");
  for (let pack = 1; pack <= 4; pack += 1) {
    await expect(page.getByText(`${4 - pack + 1} of 4 packs ready`)).toBeVisible();
    await packButton(page).click();
    await expect(mainNav(page).getByRole("link", { name: `Collection (${pack * 5})` })).toBeVisible();
  }
  await mainNav(page).getByRole("link", { name: "Collection (20)" }).click();
  await expect(page.getByRole("list", { name: "Your cards" }).getByRole("article")).toHaveCount(20);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        document.addEventListener("scroll", () => resolve(), { once: true, capture: true });
        window.scrollTo(0, 600);
      }),
  );
  await mainNav(page)
    .getByRole("link", { name: "Packs", exact: true })
    .evaluate((link) => (link as HTMLAnchorElement).click());
  await expect(h1(page, "Packs")).toBeFocused();

  hold = deferred();
  await page.reload();
  await expect(h1(page, "Packs")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/collection$/);
  await expect(h1(page, "Collection")).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  hold.release();
  await expect(page.getByRole("list", { name: "Your cards" }).getByRole("article")).toHaveCount(20);
  // Two frames after the grid lands, the page has still not moved.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
