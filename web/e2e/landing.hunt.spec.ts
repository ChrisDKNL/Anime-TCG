/// <reference lib="dom" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import type { DemoCard, Rarity } from "@anime-tcg/shared/api";
import {
  makeCharacter,
  makeDemoCard,
  makeDemoOpened,
  makeFranchise,
  makeUnavailableDemo,
} from "../src/test/fixtures";
import {
  deferred,
  envelope,
  expect,
  recordStatusTexts,
  signedOut,
  statusTexts,
  test,
  type Answer,
} from "./support/fake-api";

/**
 * Test plan (tester's hunt): what the demo PR's own landing e2e does not reach, against the scripted
 * api (docs/design/navigation-and-landing.md §3.7, §3.8, §3.12 item 6, §6.2, §7, §8;
 * card-and-rarity.md §5.3; packs-page.md §3.3 step 2). The cap across a soft navigation is a bug and
 * has its own file, bug-demo-cap-resets-on-soft-navigation.spec.ts.
 *
 * - Join offer focus (§7 "Landing demo"): after the tenth pack the Join sentence has focus, the live
 *   region still reads the tenth summary, and `Register` is the next Tab stop.
 * - Hostile AniList strings (T1): an RTL override and markup in a demo card's name and series are
 *   text in `dir="auto"` elements, isolated (U+2068 ... U+2069) in the card's name and `title`s, and
 *   never reach the summary or the live region.
 * - No effects in any tier (§3.7 item 1.4, owner 2026-10-29): Common to Mythic, a Radiant-shaped
 *   deal (four Mythic-capable slots and a Mythic last), hovered or not: no box shadow, no animation
 *   on the card or its pseudo-elements once the entrance ends, the Mythic frame's background still.
 * - Reduced motion: no entrance at all; nothing animates from the first frame.
 * - Copy (§8 "Words"): every visible text, aria-label, title and the document title of the page in
 *   each state (facts, a pack, the failure, the 429 wait, the Join offer, no pool, the 503) holds no
 *   forbidden word, no exclamation mark and no count of packs.
 * - CSP (§3.12 item 6): the Caddyfile's own policy, set report-only on the dev server's document,
 *   reports no connect-src, img-src, font-src or default-src violation over a whole visit; every
 *   request is same-origin or a card image from s4.anilist.co, and nothing goes to AniList's API.
 * - Nothing kept (§3.7): no localStorage, sessionStorage, IndexedDB, Cache Storage, service worker,
 *   cookie or card data in history state; no query string or hash in any state.
 * - Single flight (§3.7 item 1.3): three separate clicks while one opening is in flight send one
 *   `POST`.
 *
 * Not here: the reload (landing.spec.ts covers it: a reload starts the count over, which §3.7 item
 * 1.7 accepts), the real api's rate limit (api/test), the stack's CSP header (stack.spec.ts; this
 * file never runs against the acceptance stack).
 */

const JOIN = "Playing needs an account, and registering needs an invite code from the owner.";
const RLO = "‮";
const FSI = "⁨";
const PDI = "⁩";

const main = (page: Page) => page.getByRole("main");
const demoButton = (page: Page, name = "Open a demo pack") =>
  main(page).getByRole("button", { name, exact: true });
const demoList = (page: Page) => page.getByRole("list", { name: "Demo pack" });

function pack(rarities: readonly Rarity[], base: number): Answer {
  const cards: DemoCard[] = rarities.map((rarity, slot) =>
    makeDemoCard(slot, { rarity, character: makeCharacter(base + slot, { tier: rarity }) }),
  );
  return { status: 200, json: makeDemoOpened(cards) };
}

/** Which of a card's own styles would show a frame effect: a shadow, or anything animating on it. */
async function effectsOf(card: Locator) {
  return card.evaluate((element) => {
    const style = getComputedStyle(element);
    const before = getComputedStyle(element, "::before");
    const after = getComputedStyle(element, "::after");
    return {
      boxShadow: style.boxShadow,
      animation: style.animationName,
      beforeContent: before.content,
      beforeAnimation: before.animationName,
      afterContent: after.content,
      afterAnimation: after.animationName,
      running: element.getAnimations({ subtree: true }).length,
    };
  });
}

const NO_EFFECTS = {
  boxShadow: "none",
  animation: "none",
  beforeContent: "none",
  beforeAnimation: "none",
  afterContent: "none",
  afterAnimation: "none",
  running: 0,
};

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedOut);
});

test("after the tenth pack the Join sentence has focus, the summary is still read, and Register is the next Tab stop", async ({
  page,
  api,
}) => {
  await recordStatusTexts(page);
  // Nine packs of one shape, then a tenth whose summary differs, so its announcement is a new text.
  api.on(
    "POST /api/demo/open",
    ...Array.from({ length: 9 }, (_, i) =>
      pack(["common", "common", "common", "uncommon", "rare"], 6_500 + i * 10),
    ),
    pack(["common", "common", "uncommon", "rare", "epic"], 6_590),
  );
  await page.goto("/");
  for (let n = 1; n <= 10; n += 1) {
    await demoButton(page).click();
    await expect.poll(() => api.count("POST /api/demo/open")).toBe(n);
    await expect(demoList(page).getByRole("article").first()).toHaveAccessibleName(
      new RegExp(`Character ${6_500 + (n - 1) * 10}\\b`),
    );
  }
  const sentence = main(page).getByText(JOIN).first();
  await expect(sentence).toBeFocused();
  await expect.poll(() => statusTexts(page)).toContain("Demo pack: 1 Epic, 1 Rare, 1 Uncommon and 2 Common.");
  await page.keyboard.press("Tab");
  const register = main(page).getByRole("link", { name: "Register", exact: true }).first();
  await expect(register).toBeFocused();
  await expect(register).toHaveAttribute("href", "/register");
  // The offer replaces the button, and the Join section below still has its own pair.
  await expect(main(page).getByRole("link", { name: "Register", exact: true })).toHaveCount(2);
});

test("hostile names and series titles on a demo card are text, isolated, and kept out of the summary (T1)", async ({
  page,
  api,
}) => {
  await recordStatusTexts(page);
  const name = `${RLO}gnp.exe <b>bold</b>`;
  const series = `${RLO}<img src=x onerror="window.__pwned=1">`;
  const native = `${RLO}שלום`;
  const hostile = makeDemoCard(0, {
    rarity: "common",
    character: makeCharacter(7_001, { name, nameNative: native, franchiseIds: [900] }),
  });
  const rest = [1, 2, 3, 4].map((slot) => makeDemoCard(slot));
  api.on("POST /api/demo/open", {
    status: 200,
    json: {
      cards: [hostile, ...rest],
      franchises: [...makeDemoOpened().franchises, makeFranchise(900, { title: series })],
    },
  });
  await page.goto("/");
  await demoButton(page).click();
  const card = demoList(page).getByRole("article").first();
  await expect(card).toHaveAttribute("aria-label", `${FSI}${name}${PDI}, Common, ${FSI}${series}${PDI}`);
  const nameLine = card.getByText(name, { exact: true });
  await expect(nameLine).toHaveAttribute("dir", "auto");
  await expect(nameLine).toHaveAttribute("title", `${FSI}${name}${PDI}`);
  const seriesLine = card.getByText(series, { exact: true });
  await expect(seriesLine).toHaveAttribute("dir", "auto");
  await expect(seriesLine).toHaveAttribute("title", `${FSI}${series}${PDI}`);
  expect(await main(page).evaluate((root) => root.querySelectorAll("b, img[onerror], script").length)).toBe(
    0,
  );
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
  // The summary and the announcement name tiers only (§3.7 item 1.6: no comment on what was pulled).
  const summary = main(page).getByText(/^Demo pack: /);
  await expect(summary).not.toContainText("gnp");
  await expect.poll(() => statusTexts(page)).toContain("Demo pack: 1 Rare, 1 Uncommon and 3 Common.");
  expect((await statusTexts(page)).some((text) => text.includes("gnp") || text.includes("onerror"))).toBe(
    false,
  );
});

test("no glow, glint or drift on a demo card in any tier, a Radiant-shaped Mythic deal included, hovered or not", async ({
  page,
  api,
}) => {
  api.on(
    "POST /api/demo/open",
    pack(["common", "uncommon", "rare", "epic", "legendary"], 6_000),
    // The shape a Radiant pack can deal (collection-packs.md §5.4.7): any tier in the first four, a Mythic last.
    pack(["epic", "legendary", "mythic", "mythic", "mythic"], 6_100),
  );
  await page.goto("/");
  for (const [n, tiers] of [
    [1, ["Common", "Uncommon", "Rare", "Epic", "Legendary"]],
    [2, ["Epic", "Legendary", "Mythic", "Mythic", "Mythic"]],
  ] as const) {
    await demoButton(page).click();
    const cards = demoList(page).getByRole("article");
    await expect(cards.first()).toHaveAccessibleName(new RegExp(`Character ${n === 1 ? 6_000 : 6_100}\\b`));
    // The 200 ms entrance runs on the list items and ends (it fills forwards, so it stays listed as
    // finished); nothing else in the list runs.
    await expect
      .poll(() =>
        demoList(page).evaluate((list) =>
          list
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState !== "finished")
            .map((animation) => (animation as CSSAnimation).animationName),
        ),
      )
      .toEqual([]);
    for (let slot = 0; slot < 5; slot += 1) {
      const card = cards.nth(slot);
      await expect(card).toHaveAccessibleName(new RegExp(`, ${tiers[slot]}, `));
      expect(await effectsOf(card), `${tiers[slot]} in slot ${slot}`).toEqual(NO_EFFECTS);
      await card.hover();
      expect(await effectsOf(card), `${tiers[slot]} in slot ${slot}, hovered`).toEqual(NO_EFFECTS);
    }
  }
  // The pearl drift moves the Mythic frame's background; on the demo card it stays where it rests.
  const mythic = demoList(page).getByRole("article").nth(4);
  const at = () => mythic.evaluate((card) => getComputedStyle(card).backgroundPosition);
  const first = await at();
  await page.waitForTimeout(600);
  expect(await at()).toBe(first);
});

test("under reduced motion the demo cards land without an entrance: nothing animates from the first frame", async ({
  page,
  api,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  api.on("POST /api/demo/open", pack(["common", "rare", "epic", "legendary", "mythic"], 6_200));
  await page.goto("/");
  await demoButton(page).click();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  const state = await demoList(page).evaluate((list) => ({
    running: list.getAnimations({ subtree: true }).length,
    names: Array.from(list.querySelectorAll("li"), (item) => getComputedStyle(item).animationName),
  }));
  expect(state).toEqual({ running: 0, names: ["none", "none", "none", "none", "none"] });
});

/** navigation-and-landing.md §8 "Words": the accounts words, collection-overview.md §8's money and nudge words, and the demo's own. */
const FORBIDDEN = [
  /secure|verif|protect|\bsafe|privat|attempt|locked|blocked/i,
  /\b(pay|paid|cash|money|coins?|earn\w*|profit\w*|worth|value|balance|wallet|store|checkout|purchas\w*)\b/i,
  /[$€£¥!]/,
  /\b(hurry|act now|today only|ending soon|last chance|don't miss|limited)\b/i,
  /\bonly \d+ left\b/i,
  /\b(free|lucky|jackpot|win|wins|winner|prize|you could get|try your luck|one more|another)\b/i,
  /\b(remaining|left|tries|used up|last one)\b/i,
];

/** Everything the landing page says, to eyes or to a screen reader: its text, every name and title, and the title bar. */
async function pageWords(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    document.title,
    document.body.innerText,
    ...Array.from(document.querySelectorAll("[aria-label], [title], [alt]")).flatMap((element) =>
      ["aria-label", "title", "alt"].map((name) => element.getAttribute(name) ?? ""),
    ),
  ]);
}

async function expectCleanCopy(page: Page, state: string) {
  const offenders = (await pageWords(page)).flatMap((text) =>
    FORBIDDEN.filter((word) => word.test(text)).map(
      (word) => `${state}: ${String(word)} in ${JSON.stringify(text.slice(0, 200))}`,
    ),
  );
  expect(offenders).toEqual([]);
}

test("the landing page's words in every state hold nothing §8 forbids", async ({ page, api }) => {
  const ok = (n: number): Answer => pack(["common", "common", "uncommon", "rare", "mythic"], 6_300 + n * 10);
  api.on(
    "POST /api/demo/open",
    ok(1),
    "abort",
    { ...envelope(429, "rate_limited"), headers: { "Retry-After": "1" } },
    ...Array.from({ length: 9 }, (_, i) => ok(i + 2)),
  );
  await page.goto("/");
  await expect(page.getByRole("table", { name: "Pack odds" })).toBeVisible();
  // The scan reads what the page says: the disclosure, the odds and the footer are in it.
  const said = (await pageWords(page)).join(" ");
  for (const text of [
    "A demo pack uses the same odds",
    "At least one per pack",
    "Non-commercial fan project",
  ]) {
    expect(said).toContain(text);
  }
  await expectCleanCopy(page, "facts");
  await demoButton(page).click();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  await expectCleanCopy(page, "a pack");
  await demoButton(page).click();
  await expect(main(page).getByRole("alert")).toBeVisible();
  await expectCleanCopy(page, "failure");
  await demoButton(page).click();
  await expect(demoButton(page, "Try again in 1 s")).toBeVisible();
  await expectCleanCopy(page, "429 wait");
  await expect(demoButton(page)).not.toHaveAttribute("aria-disabled");
  for (let n = 2; n <= 10; n += 1) {
    await demoButton(page).click();
    await expect(demoList(page).getByRole("article").first()).toHaveAccessibleName(
      new RegExp(`Character ${6_300 + n * 10}\\b`),
    );
  }
  await expect(main(page).getByText(JOIN).first()).toBeFocused();
  await expectCleanCopy(page, "Join offer");

  api.on("GET /api/demo", { status: 200, json: makeUnavailableDemo() });
  await page.reload();
  await expect(page.getByText("Demo packs are unavailable right now.")).toBeVisible();
  await expectCleanCopy(page, "no pool");
});

test("a 503 on an opening leaves no forbidden word either", async ({ page, api }) => {
  api.on("POST /api/demo/open", envelope(503, "pool_unavailable"));
  await page.goto("/");
  await demoButton(page).click();
  await expect(page.getByText("Demo packs are unavailable right now.")).toBeVisible();
  await expectCleanCopy(page, "503");
});

/** The site's policy exactly as Caddy sends it (§3.12 item 6: the demo does not change it). */
function caddyPolicy(): string {
  const caddyfile = readFileSync(fileURLToPath(new URL("../../Caddyfile", import.meta.url)), "utf8");
  const policy = /Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1];
  if (policy === undefined) throw new Error("no Content-Security-Policy in the Caddyfile");
  return policy;
}

test("under the Caddyfile's CSP a whole demo visit reports no connect, image or font violation and calls nothing off-site", async ({
  page,
  api,
}) => {
  const policy = caddyPolicy();
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("img-src 'self' https://s4.anilist.co");
  // Report-only: the dev server's own inline scripts and styles (not in the build) would be refused
  // by script-src and style-src; those reports are ignored, everything else must be clean.
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      if (route.request().resourceType() !== "document") return route.fallback();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "content-security-policy-report-only": policy },
      });
    },
  );
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as { __violations?: string[] }).__violations = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  const requests: { url: string; type: string }[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), type: request.resourceType() }));

  await page.goto("/");
  await expect(page.getByRole("table", { name: "Pack odds" })).toBeVisible();
  for (let n = 1; n <= 10; n += 1) {
    await demoButton(page).click();
    await expect(demoList(page).getByRole("article").first()).toHaveAccessibleName(
      new RegExp(`Character ${5_000 + n * 10}\\b`),
    );
  }
  await expect(main(page).getByText(JOIN).first()).toBeFocused();
  await page.waitForLoadState("networkidle");

  const violations = await page.evaluate(() => (window as { __violations?: string[] }).__violations ?? []);
  expect(violations.filter((line) => !/^(script|style)-src/.test(line))).toEqual([]);
  // The control: the policy is live on this document, so a request it forbids is reported.
  await page.route("https://control.invalid/**", (route) => route.abort());
  await page.evaluate(() => fetch("https://control.invalid/x").catch(() => undefined));
  await expect
    .poll(() => page.evaluate(() => (window as { __violations?: string[] }).__violations ?? []))
    .toContain("connect-src https://control.invalid/x");
  const origin = new URL(page.url()).origin;
  const offSite = requests.filter(({ url, type }) => {
    const at = new URL(url);
    if (at.origin === origin || at.protocol === "data:") return false;
    return !(at.origin === "https://s4.anilist.co" && type === "image");
  });
  expect(offSite.map(({ url }) => url)).toEqual(["https://control.invalid/x"]);
  offSite.length = 0;
  expect(
    requests.some(
      ({ url }) => new URL(url).hostname.endsWith("anilist.co") && !url.startsWith("https://s4."),
    ),
  ).toBe(false);
  expect(api.count("POST /api/demo/open")).toBe(10);
});

test("nothing of a visit is kept: no storage of any kind, no cookie, no card in history state, no query string or hash", async ({
  page,
  api,
}) => {
  await page.goto("/");
  const kept = () =>
    page.evaluate(async () => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      cookie: document.cookie,
      indexedDb: (await indexedDB.databases()).map((db) => db.name),
      caches: await caches.keys(),
      workers: (await navigator.serviceWorker.getRegistrations()).length,
      history: JSON.stringify(history.state ?? null).includes("Character"),
      search: location.search,
      hash: location.hash,
    }));
  const empty = {
    local: [],
    session: [],
    cookie: "",
    indexedDb: [],
    caches: [],
    workers: 0,
    history: false,
    search: "",
    hash: "",
  };
  expect(await kept()).toEqual(empty);
  for (let n = 1; n <= 10; n += 1) {
    await demoButton(page).click();
    await expect(demoList(page).getByRole("article").first()).toHaveAccessibleName(
      new RegExp(`Character ${5_000 + n * 10}\\b`),
    );
    if (n === 1 || n === 10) expect(await kept(), `after pack ${n}`).toEqual(empty);
  }
  expect(api.count("POST /api/demo/open")).toBe(10);
});

test("three separate clicks while one demo opening is in flight send one POST", async ({ page, api }) => {
  const held = deferred();
  api.on("POST /api/demo/open", async () => {
    await held.promise;
    return pack(["common", "common", "common", "uncommon", "rare"], 6_400);
  });
  await page.goto("/");
  await demoButton(page).click();
  const busy = demoButton(page, "Opening…");
  await expect(busy).toHaveAttribute("aria-disabled", "true");
  // Playwright waits for an aria-disabled button to be enabled; a raw click is what a user's is.
  for (let i = 0; i < 3; i += 1) await busy.dispatchEvent("click", { detail: 1 });
  expect(api.count("POST /api/demo/open")).toBe(1);
  held.release();
  await expect(demoList(page).getByRole("listitem")).toHaveCount(5);
  await expect(demoButton(page)).toBeFocused();
  expect(api.count("POST /api/demo/open")).toBe(1);
});
