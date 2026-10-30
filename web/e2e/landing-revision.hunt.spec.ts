/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { makeUnavailableDemo } from "../src/test/fixtures";
import {
  deferred,
  envelope,
  expect,
  isolated,
  makeAccount,
  noContent,
  signedIn,
  signedOut,
  test,
} from "./support/fake-api";

/**
 * Test plan (tester's hunt): what demo.spec.ts, landing.spec.ts and landing.hunt.spec.ts do not reach
 * in the landing revision, against the scripted api (docs/design/navigation-and-landing.md §3.1,
 * §3.7 items 1.7 and 1.8, §3.10 item 5, §3.14, §4.5, §4.9, §6.2, §7).
 *
 * - The visit's cap of 10 across `/`, `/demo`, Back and Forward, with the tenth pack landing while `/`
 *   shows (the visitor went Back during its flight): counted and held, not announced, no entrance;
 *   the Join offer takes `/`'s button place and the focus (§3.14 step 13); Forward onto `/demo` shows
 *   the tenth pack's cards and the offer without moving focus to it. Only packs that landed on
 *   `/demo` were announced or entered. The pack drawing is the same before and after.
 * - A sign-in discards the visit: nine packs, log in, Back onto `/demo` (replaced by `/packs` as a
 *   page change), log out, and the next demo pack is the first of a new visit, not the tenth.
 * - A direct load of `/demo` with no pool: the unavailable line in the button's place, five empty
 *   slots, no `POST`.
 * - A 503 on `/demo` holds on `/` too (§3.14 step 13).
 * - The pack drawing: six star lines, one to six, Common first, each in its tier's text colour (the
 *   odds table's); no focusable element, no transition; hidden at 639 px, shown at 640 px.
 * - The odds swatches: `aria-hidden`, 10 px wide, each the tier's flat frame colour
 *   (`--card-frame-common` … `--card-frame-flat-mythic`), six distinct colours, no shadow, no motion.
 * - The route list: one `h1` per page, and the titles and `h1`s of every page of this build are
 *   distinct; unknown subpaths of the new routes (`/packs/open/x`, `/shop/open/x`, `/demo/x`, …) are
 *   the not-found page, signed in and signed out, and the address is left as typed.
 */

const CHRIS = makeAccount({ cards: 0 });
const JOIN = "Playing needs an account, and registering needs an invite code from the owner.";
const KEEP = "To keep cards, register with an invite code.";
const UNAVAILABLE = "Demo packs are unavailable right now.";
const SUMMARY = "Demo pack: 1 Rare, 1 Uncommon and 3 Common.";

const main = (page: Page) => page.getByRole("main");
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const hero = (page: Page) => page.getByRole("region", { name: "Anime TCG" });
const demoButton = (page: Page, name = "Open a demo pack") =>
  main(page).getByRole("button", { name, exact: true });
const demoList = (page: Page) => page.getByRole("list", { name: "Demo pack" });
const drawing = (page: Page) => page.getByTestId("landing-pack");
const firstCard = (page: Page) => demoList(page).getByRole("article").first();
/** The FakeGame's `n`th demo pack starts with this character. */
const nthPack = (n: number) => new RegExp(`Character ${5_000 + n * 10}\\b`);

declare global {
  interface Window {
    __said?: string[];
    __entered?: string[];
  }
}

/**
 * Every message the app's live region takes, repeats included (one entry per commit that changes its
 * text nodes; the region keys each announcement, so a repeat replaces them), and every card entrance
 * that starts, with the page it started on. Call before `goto`.
 */
async function recordSpeechAndEntrances(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const said: string[] = [];
    const entered: string[] = [];
    window.__said = said;
    window.__entered = entered;
    new MutationObserver((mutations) => {
      const touched = new Set<Element>();
      for (const mutation of mutations) {
        const node = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        const region = node?.closest('[role="status"][aria-live="polite"]');
        if (region) touched.add(region);
      }
      for (const region of touched) if (region.textContent) said.push(region.textContent);
    }).observe(document, { subtree: true, childList: true, characterData: true });
    document.addEventListener(
      "animationstart",
      (event) => {
        if (event.animationName === "card-enter") entered.push(location.pathname);
      },
      true,
    );
  });
}

const said = (page: Page) => page.evaluate(() => window.__said ?? []);
const entered = (page: Page) => page.evaluate(() => window.__entered ?? []);

async function onDemo(page: Page) {
  await expect(page).toHaveURL((url) => url.pathname === "/demo");
  await expect(page).toHaveTitle("Demo pack · Anime TCG");
  await expect(h1(page, "Demo pack")).toBeFocused();
}

async function onLanding(page: Page) {
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page).toHaveTitle("Anime TCG");
  await expect(h1(page, "Anime TCG")).toBeFocused();
}

test.describe("the demo visit", () => {
  test.beforeEach(({ api }) => {
    api.on("GET /api/session", signedOut);
  });

  test("ten per page load across /, /demo, Back and Forward; the tenth lands on /: counted, held, not announced, the offer takes the focus", async ({
    page,
    api,
  }) => {
    await recordSpeechAndEntrances(page);
    const tenth = deferred();
    api.on("POST /api/demo/open", async (call) => {
      if (api.game.demos === 9) await tenth.promise;
      return api.game.reply(call.key, call.body)!;
    });
    await page.goto("/");
    await expect(page.getByRole("table", { name: "Pack odds" })).toBeVisible();
    const drawn = await drawing(page).innerHTML();

    // Pack 1 from `/`, Back, then pack 2 from `/` again.
    await demoButton(page).click();
    await onDemo(page);
    await expect(firstCard(page)).toHaveAccessibleName(nthPack(1));
    // Each pack's five entrances have started (the last 200 ms after the first) before the page moves on.
    await expect.poll(async () => (await entered(page)).length).toBe(5);
    await page.goBack();
    await onLanding(page);
    await demoButton(page).click();
    await onDemo(page);
    await expect(firstCard(page)).toHaveAccessibleName(nthPack(2));
    await expect.poll(async () => (await entered(page)).length).toBe(10);

    // Packs 3 to 8 in place, then Back and Forward: the eighth again, without its entrance.
    for (let n = 3; n <= 8; n += 1) {
      await demoButton(page).click();
      await expect(firstCard(page)).toHaveAccessibleName(nthPack(n));
      await expect.poll(async () => (await entered(page)).length).toBe(n * 5);
    }
    await page.goBack();
    await onLanding(page);
    await page.goForward();
    await onDemo(page);
    await expect(firstCard(page)).toHaveAccessibleName(nthPack(8));

    // Pack 9 from `/`.
    await page.goBack();
    await onLanding(page);
    await demoButton(page).click();
    await onDemo(page);
    await expect(firstCard(page)).toHaveAccessibleName(nthPack(9));
    await expect.poll(async () => (await entered(page)).length).toBe(9 * 5);

    // Pack 10 from `/demo`, and Back to `/` while it is in flight.
    await demoButton(page).click();
    await expect(demoButton(page, "Opening…")).toHaveAttribute("aria-disabled", "true");
    await page.goBack();
    await onLanding(page);
    await expect(demoButton(page, "Opening…")).toHaveAttribute("aria-disabled", "true");
    tenth.release();
    await expect(hero(page).getByText(JOIN)).toBeFocused();
    await expect(hero(page).getByRole("button")).toHaveCount(0);
    await expect(page).toHaveURL((url) => url.pathname === "/");
    expect(await drawing(page).innerHTML()).toBe(drawn);

    // Forward: the tenth pack's cards, the offer, focus on the h1 and not moved to the offer.
    await page.goForward();
    await onDemo(page);
    await expect(firstCard(page)).toHaveAccessibleName(nthPack(10));
    await expect(main(page).getByText(JOIN)).toBeVisible();
    await expect(main(page).getByRole("button")).toHaveCount(0);
    await expect(main(page).getByText(KEEP)).toHaveCount(0);
    await page.goBack();
    await onLanding(page);
    await expect(hero(page).getByText(JOIN)).toBeVisible();

    expect(api.count("POST /api/demo/open")).toBe(10);
    // Announced and entered only for the nine packs that landed on /demo (§3.14 step 6).
    expect((await said(page)).filter((text) => text === SUMMARY)).toHaveLength(9);
    const starts = await entered(page);
    expect(starts).toHaveLength(9 * 5);
    expect(starts.every((path) => path === "/demo")).toBe(true);
  });

  test("a sign-in discards the visit: Back onto /demo goes to /packs, and after logging out the next demo pack starts a new count", async ({
    page,
    api,
  }) => {
    api.on("POST /api/session/login", signedIn(CHRIS));
    api.on("POST /api/session/logout", noContent);
    await page.goto("/demo");
    for (let n = 1; n <= 9; n += 1) {
      await demoButton(page).click();
      await expect(firstCard(page)).toHaveAccessibleName(nthPack(n));
    }

    await nav(page).getByRole("link", { name: "Log in" }).click();
    await expect(h1(page, "Log in")).toBeFocused();
    await page.getByRole("textbox", { name: "Login", exact: true }).fill("Chris");
    await page.getByLabel("Password", { exact: true }).fill("correct horse");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(h1(page, "Packs")).toBeFocused();

    // Back onto the /demo entry, signed in: replaced by /packs, a page change (title and focus).
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === "/packs");
    await expect(page).toHaveTitle("Packs · Anime TCG");
    await expect(h1(page, "Packs")).toBeFocused();

    await page
      .getByRole("button", { name: `Account menu. Signed in as ${isolated("Chris")}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await onLanding(page);
    await expect(demoButton(page)).not.toHaveAttribute("aria-disabled");

    // The old visit had nine; a tenth would bring the Join offer. A new visit's first does not.
    await demoButton(page).click();
    await onDemo(page);
    await expect(firstCard(page)).toHaveAccessibleName(nthPack(10));
    await expect(demoButton(page)).toBeVisible();
    await expect(main(page).getByText(KEEP)).toBeVisible();
    await expect(main(page).getByText(JOIN)).toHaveCount(0);
  });

  test("a direct load of /demo with no pool: the unavailable line in the button's place, five empty slots, no POST", async ({
    page,
    api,
  }) => {
    api.on("GET /api/demo", { status: 200, json: makeUnavailableDemo() });
    await page.goto("/demo");
    await expect(h1(page, "Demo pack")).toBeVisible();
    await expect(main(page).getByText(UNAVAILABLE)).toBeVisible();
    await expect(main(page).getByRole("button")).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: "Back to the landing page" })).toBeVisible();
    await expect(main(page).locator(".aspect-\\[5\\/7\\]")).toHaveCount(5);
    await expect(demoList(page)).toHaveCount(0);
    expect(api.count("POST /api/demo/open")).toBe(0);
  });

  test("a 503 on /demo holds on / as well, and on /demo again by Forward", async ({ page, api }) => {
    api.on("POST /api/demo/open", envelope(503, "pool_unavailable"));
    await page.goto("/");
    await demoButton(page).click();
    await onDemo(page);
    await expect(main(page).getByText(UNAVAILABLE)).toBeVisible();
    await page.goBack();
    await onLanding(page);
    await expect(hero(page).getByText(UNAVAILABLE)).toBeVisible();
    await expect(hero(page).getByRole("button")).toHaveCount(0);
    await page.goForward();
    await onDemo(page);
    await expect(main(page).getByText(UNAVAILABLE)).toBeVisible();
    await expect(main(page).getByRole("button")).toHaveCount(0);
    expect(api.count("POST /api/demo/open")).toBe(1);
  });
});

test.describe("the landing page's drawing and swatches", () => {
  test.beforeEach(({ api }) => {
    api.on("GET /api/session", signedOut);
  });

  test("the pack drawing's ladder: six lines of one to six stars, Common first, each in its tier's colour; nothing focusable, no transition", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("table", { name: "Pack odds" })).toBeVisible();
    const pack = drawing(page);
    await expect(pack).toBeVisible();
    const ladder = await pack.evaluate((element) =>
      Array.from(element.querySelectorAll("span"), (span) => ({
        text: span.textContent,
        color: getComputedStyle(span).color,
      })),
    );
    expect(ladder.map((line) => line.text)).toEqual([1, 2, 3, 4, 5, 6].map((n) => "✦".repeat(n)));
    expect(new Set(ladder.map((line) => line.color)).size).toBe(6);
    // The same colour as the odds table's tier word for that tier.
    const words = await page
      .getByRole("table", { name: "Pack odds" })
      .getByRole("rowheader")
      .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).color));
    expect(ladder.map((line) => line.color)).toEqual(words);

    const inert = await pack.evaluate((element) => ({
      focusable: element.querySelectorAll("a, button, input, select, textarea, [tabindex], [contenteditable]")
        .length,
      transitions: [element, ...Array.from(element.querySelectorAll("*"))]
        .map((node) => getComputedStyle(node).transitionDuration)
        .filter((duration) => duration.split(",").some((part) => parseFloat(part) > 0)),
      ariaHidden: element.closest('[aria-hidden="true"]') !== null,
    }));
    expect(inert).toEqual({ focusable: 0, transitions: [], ariaHidden: true });
  });

  test("the pack drawing is hidden at 639 px and shown at 640 px", async ({ page }) => {
    await page.setViewportSize({ width: 639, height: 900 });
    await page.goto("/");
    await expect(demoButton(page)).toBeVisible();
    await expect(drawing(page)).toBeHidden();
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(drawing(page)).toBeVisible();
  });

  test("the odds swatches: aria-hidden, 10 px, each tier's flat frame colour, six distinct, still", async ({
    page,
  }) => {
    await page.goto("/");
    const table = page.getByRole("table", { name: "Pack odds" });
    await expect(table).toBeVisible();
    const swatches = await table.getByRole("rowheader").evaluateAll((cells) =>
      cells.map((cell) => {
        const swatch = cell.querySelector("span");
        if (swatch === null) return null;
        const style = getComputedStyle(swatch);
        return {
          hidden: swatch.getAttribute("aria-hidden"),
          width: swatch.getBoundingClientRect().width,
          background: style.backgroundColor,
          shadow: style.boxShadow,
          running: swatch.getAnimations().length,
        };
      }),
    );
    // What each tier's frame variable resolves to, through a probe of the same kind.
    const expected = await page.evaluate(() =>
      [
        "--card-frame-common",
        "--card-frame-uncommon",
        "--card-frame-rare",
        "--card-frame-flat-epic",
        "--card-frame-flat-legendary",
        "--card-frame-flat-mythic",
      ].map((name) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = `var(${name})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      }),
    );
    expect(swatches.map((swatch) => swatch?.background)).toEqual(expected);
    expect(new Set(expected).size).toBe(6);
    expect(expected.every((color) => color !== "rgba(0, 0, 0, 0)")).toBe(true);
    for (const swatch of swatches) {
      expect(swatch).toMatchObject({ hidden: "true", width: 10, shadow: "none", running: 0 });
    }
    // The word carries the tier: each row header's accessible name is the tier word alone, the
    // swatch and the stars left out of it.
    for (const tier of ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"]) {
      await expect(table.getByRole("rowheader", { name: tier, exact: true })).toHaveCount(1);
    }
  });
});

test.describe("the route list", () => {
  test("every page of this build has one h1, and their titles and h1s are all different", async ({
    page,
    api,
  }) => {
    const seen: Array<{ path: string; title: string; h1: string[] }> = [];
    const record = async (path: string) => {
      const headings = await page.getByRole("heading", { level: 1 }).allTextContents();
      seen.push({ path, title: await page.title(), h1: headings });
    };

    api.on("GET /api/session", signedOut);
    for (const [path, heading] of [
      ["/", "Anime TCG"],
      ["/demo", "Demo pack"],
      ["/login", "Log in"],
      ["/register", "Register"],
      ["/no-such-page", "Page not found"],
    ] as const) {
      await page.goto(path);
      await expect(h1(page, heading)).toBeVisible();
      await record(path);
    }

    api.on("GET /api/session", signedIn(CHRIS));
    for (const [path, heading] of [
      ["/packs", "Packs"],
      ["/shop", "Shop"],
      ["/collection", "Collection"],
      ["/profile", "Profile"],
      ["/account", "Manage account"],
    ] as const) {
      await page.goto(path);
      await expect(h1(page, heading)).toBeVisible();
      await record(path);
    }
    await page.goto("/packs");
    await main(page).getByRole("button", { name: "Open pack", exact: true }).click();
    await expect(page.getByRole("list", { name: "Your pack" }).getByRole("article")).toHaveCount(5);
    await record("/packs/open");
    await page.goto("/shop");
    await page.getByRole("article", { name: "Action" }).getByRole("button", { name: "Buy…" }).click();
    await page
      .getByRole("dialog", { name: "Buy the Action pack?" })
      .getByRole("button", { name: "Buy for 400 Karma" })
      .click();
    await expect(page.getByRole("list", { name: "Action pack" }).getByRole("article")).toHaveCount(5);
    await record("/shop/open");

    for (const entry of seen) expect(entry.h1, entry.path).toHaveLength(1);
    expect(seen.find((entry) => entry.path === "/packs/open")).toEqual({
      path: "/packs/open",
      title: "Pack opening · Anime TCG",
      h1: ["Pack opening"],
    });
    expect(seen.find((entry) => entry.path === "/shop/open")).toEqual({
      path: "/shop/open",
      title: "Shop pack · Anime TCG",
      h1: ["Shop pack"],
    });
    expect(seen.find((entry) => entry.path === "/demo")?.title).toBe("Demo pack · Anime TCG");
    expect(new Set(seen.map((entry) => entry.title)).size).toBe(seen.length);
    expect(new Set(seen.map((entry) => entry.h1[0])).size).toBe(seen.length);
  });

  const UNKNOWN = ["/packs/open/x", "/packs/open/open", "/shop/open/x", "/demo/x", "/demo/open", "/Demo"];
  for (const session of ["signed out", "signed in"] as const) {
    test(`unknown subpaths of the new routes are the not-found page, ${session}, and stay as typed`, async ({
      page,
      api,
    }) => {
      api.on("GET /api/session", session === "signed in" ? signedIn(CHRIS) : signedOut);
      for (const path of UNKNOWN) {
        await page.goto(path);
        await expect(h1(page, "Page not found"), path).toBeVisible();
        await expect(page).toHaveTitle("Page not found · Anime TCG");
        expect(new URL(page.url()).pathname).toBe(path);
        const link = session === "signed in" ? "Go to Packs" : "Go to the start page";
        await expect(main(page).getByRole("link", { name: link })).toBeVisible();
      }
      expect(api.count("POST /api/packs/open")).toBe(0);
      expect(api.count("POST /api/demo/open")).toBe(0);
    });
  }
});
