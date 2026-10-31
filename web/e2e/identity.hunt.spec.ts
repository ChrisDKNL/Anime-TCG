/// <reference lib="dom" />
import type { Locator, Page } from "@playwright/test";
import { makeCharacter, makeEntry, makeListing } from "../src/test/fixtures";
import { auditContrast, type ContrastFailure } from "./support/contrast";
import {
  deferred,
  envelope,
  expect,
  isolated,
  makeAccount,
  signedIn,
  signedOut,
  test,
  type FakeApi,
} from "./support/fake-api";

/**
 * Test plan (tester's hunt): what `identity.spec.ts` and the unit suites do not reach for the identity's
 * first build (docs/design/visual-identity.md §15 row 1, with §4, §5, §6.1, §9.1, §10.1, §10.2, §10.4,
 * §11.1 and §12), measured in a real browser against the scripted api.
 *
 * Contrast (§5.4: text 4.5:1, large text 3:1; WCAG 1.4.3 exempts disabled controls)
 * - An in-page audit composites every visible text's computed colour over every background and group
 *   opacity behind it: every route signed out and signed in, with cards, listings and a duplicate held;
 *   every dialog (Pack odds, Buy, a card, a listing and its confirmation, Delete account) and the
 *   Account menu; empty states; load failures; form errors; the session check's boot states.
 * - Header links at rest and on hover; the footer; hints; error text in `danger`; disabled buttons drawn
 *   as §10.4 says (`night-800` fill, `ink-500` words), exempt from the ratio.
 * - §5.4's rule that tier text never sits on `night-800`.
 *
 * The zinc remap (§12.1)
 * - No computed colour of any element on any page or dialog is a Tailwind violet, purple, fuchsia or
 *   indigo (the old primary and focus ring).
 * - Every element Tab reaches, on each page and inside the Account menu, shows the 2 px Volt ring.
 *
 * Header (§10.2, from the designer's update): page links bare, `ink-400`, hover and current `ink-100`,
 * a 2 px Volt line at the foot of a 44 px target; the Account control `night-850`, a 1 px `night-700`
 * border, `radius-control`, 44 px.
 *
 * Eyebrows (§10.1): above the `h1` on every route, `aria-hidden` (absent from the accessibility tree),
 * mono, `ink-400`, uppercase, with the table's words.
 *
 * Fonts (§4.1)
 * - On first paint the three families load without being asked for, from this origin, latin files
 *   only; no request leaves the origin except AniList's image CDN; nothing logs an error.
 * - Under the Caddyfile's `font-src 'self'`, injected into the dev document, no CSP violation.
 * - With every woff2 request failing, the system stack draws every page, nothing sits invisible, and
 *   no page scrolls sideways at 320 px.
 * - Layout shift on first paint with the fonts 600 ms late stays under 0.1 (the "good" bound).
 *
 * page-enter (§9.1)
 * - Never on a load: any route, signed in or out, and the boot redirects (guard to `/login`, a
 *   signed-in `/login` to `/packs`).
 * - Once per navigation: data arriving later does not replay it; two fast clicks play each page once
 *   and the last ends fully shown and focused; Back and Forward each play once and focus the `h1`;
 *   under reduced motion Back and Forward play nothing.
 * - It never moves focus: Tab pressed while it plays keeps its target after it ends.
 *
 * Sizes (§6.1: 44 px minimum on a phone; §10.4: primary and secondary 48 on a phone, 44 from `sm`)
 * - At 320 px no dialog or state scrolls sideways.
 * - At 320 px every control on every page, in every dialog and in the Account menu is 44 px tall or
 *   more, and every primary or secondary button 48; a link inside a sentence is exempt (WCAG 2.5.8).
 * - From 640 px the primary and secondary buttons are 44 px.
 *
 * The licence file (§4.1, §11.1)
 * - The footer's link on every route, signed in and out, and in the boot frame, opens the plain-text
 *   licences, never the app's not-found page; the dev server sends `text/plain` with no long cache.
 *   (Through Caddy: `stack.spec.ts`.)
 *
 * Failing on purpose until fixed (bugs, not flakes):
 * - The boot frame's `Loading…` is `text-zinc-500`, now `ink-500` (#6e7493): 4.36:1 on night-950, and
 *   §5.4 allows no text in `ink-500`.
 * - Below 44 px on a phone (§6.1), each 40 px: the wordmark, `Pack odds`, the Shop's `Odds per card`,
 *   the Market's `Browse` / `My listings`, the Collection's view switch, tier chips and `Duplicates
 *   only` row, the card dialog's `Close` and `See <name> on the market`, the Account menu's items.
 * - The Collection's `Duplicates only` checkbox shows the browser's own focus ring, not Volt.
 * - The Account menu's items show focus by a `night-800` fill alone (1.2:1 against the menu), not the
 *   Volt ring.
 */

const CHRIS = makeAccount();
const LONG = makeAccount({ login: "W".repeat(24) });
const VOLT = "rgb(200, 240, 49)";
const NOT_FOUND_PATH = "/no-such-page";
const SIGNED_OUT_ROUTES = ["/", "/demo", "/login", "/register", NOT_FOUND_PATH] as const;
const SIGNED_IN_ROUTES = [
  "/packs",
  "/shop",
  "/market",
  "/collection",
  "/profile",
  "/account",
  NOT_FOUND_PATH,
] as const;

const h1 = (page: Page, name?: string) =>
  page.getByRole("heading", { level: 1, ...(name === undefined ? {} : { name, exact: true }) });
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const control = (page: Page, login = "Chris") =>
  page.getByRole("button", { name: `Account menu. Signed in as ${isolated(login)}`, exact: true });
const dialog = (page: Page) => page.getByRole("dialog");

/** A game with something on every page: a duplicate in the collection, a listing on the market. */
function stock(api: FakeApi, account = CHRIS) {
  api.on("GET /api/session", signedIn(account));
  api.game.held = [makeEntry(makeCharacter(1, { name: "Spike Spiegel", tier: "epic" }), { count: 3 })];
  api.game.market = [
    makeListing(1, { price: 20, character: makeCharacter(2_001, { name: "Asuka", tier: "rare" }) }),
  ];
}

/**
 * Waits for the page's data, its fonts and its motion, not a timer: every pending request answered, the
 * fonts settled, and every finite animation (page-enter and its 40 ms delay, a dialog's pop-in, which
 * scales it) run out. The owner's looping frames never end and are left running.
 */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity,
      ),
  );
}

async function visit(page: Page, path: string) {
  await page.goto(path);
  await expect(h1(page)).toBeVisible();
  await settle(page);
}

const label = (where: string, failures: ContrastFailure[]) =>
  failures.map((f) => `${where}: "${f.text}" ${f.ratio}:1 (needs ${f.needs}) ${f.color} on ${f.background}`);

async function audit(page: Page, where: string, scope?: Locator): Promise<string[]> {
  const report = await auditContrast(page, scope);
  expect(report.measured, `${where}: text measured`).toBeGreaterThan(0);
  return label(where, report.failures);
}

// ---------------------------------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------------------------------

test.describe("contrast (§5.4)", () => {
  test("every signed-out page at rest", async ({ page, api }) => {
    api.on("GET /api/session", signedOut);
    const failures: string[] = [];
    for (const path of [...SIGNED_OUT_ROUTES, "/collection"]) {
      await visit(page, path);
      failures.push(...(await audit(page, path)));
    }
    expect(failures).toEqual([]);
  });

  test("every signed-in page at rest, with cards, a listing and a duplicate held", async ({ page, api }) => {
    stock(api);
    const failures: string[] = [];
    for (const path of [...SIGNED_IN_ROUTES, "/packs/open", "/shop/open"]) {
      await visit(page, path);
      failures.push(...(await audit(page, path)));
    }
    expect(failures).toEqual([]);
  });

  test("the dialogs, the Account menu and a pack's reveal", async ({ page, api }) => {
    stock(api);
    const failures: string[] = [];

    await visit(page, "/packs");
    await page.getByRole("button", { name: "Pack odds" }).click();
    await expect(dialog(page)).toBeVisible();
    await settle(page);
    failures.push(...(await audit(page, "Pack odds dialog", dialog(page))));
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Open pack" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Your pack" })).toBeVisible();
    await settle(page);
    failures.push(...(await audit(page, "the reveal")));

    await control(page).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await settle(page);
    failures.push(...(await audit(page, "Account menu", page.getByRole("menu"))));
    await page.keyboard.press("Escape");

    await visit(page, "/shop");
    await page.getByRole("button", { name: "Buy…" }).click();
    await expect(dialog(page)).toBeVisible();
    await settle(page);
    failures.push(...(await audit(page, "Buy dialog", dialog(page))));
    await page.keyboard.press("Escape");

    await visit(page, "/collection");
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    await expect(dialog(page)).toBeVisible();
    await settle(page);
    failures.push(...(await audit(page, "card dialog", dialog(page))));
    await page.keyboard.press("Escape");

    await visit(page, "/market");
    await page
      .getByRole("main")
      .getByRole("list", { name: /shown/ })
      .getByRole("button", { name: /Asuka/ })
      .click();
    await expect(dialog(page)).toBeVisible();
    await settle(page);
    failures.push(...(await audit(page, "listing dialog", dialog(page))));
    await dialog(page).getByRole("button", { name: "Buy…" }).click();
    await expect(dialog(page).getByRole("heading", { level: 2, name: /^Buy / })).toBeFocused();
    await settle(page);
    failures.push(...(await audit(page, "listing confirmation", dialog(page))));
    await page.keyboard.press("Escape");

    await visit(page, "/account");
    await page.getByRole("button", { name: "Delete account…" }).click();
    await expect(page.getByRole("dialog", { name: "Delete Chris?" })).toBeVisible();
    await settle(page);
    failures.push(...(await audit(page, "Delete dialog", dialog(page))));

    expect(failures).toEqual([]);
  });

  test("empty states and load failures", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.game.available = 0;
    const failures: string[] = [];
    for (const path of ["/packs", "/collection", "/market"]) {
      await visit(page, path);
      failures.push(...(await audit(page, `${path} empty`)));
    }
    api.on("GET /api/packs", envelope(500, "internal"));
    api.on("GET /api/collection", envelope(500, "internal"));
    api.on("GET /api/shop", envelope(500, "internal"));
    api.on("GET /api/market/listings", envelope(500, "internal"));
    for (const path of ["/packs", "/collection", "/shop", "/market"]) {
      await visit(page, path);
      await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
      failures.push(...(await audit(page, `${path} failed`)));
    }
    expect(failures).toEqual([]);
  });

  test("form errors are `danger` words that pass AA, on the login and the register forms", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    api.on("POST /api/session/login", envelope(401, "bad_credentials"));
    const failures: string[] = [];

    await visit(page, "/login");
    await page.getByRole("textbox", { name: "Login", exact: true }).fill("Chris");
    await page.getByLabel("Password", { exact: true }).fill("not the password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    failures.push(...(await audit(page, "/login refused")));

    await visit(page, "/register");
    await page.getByRole("button", { name: "Continue" }).click();
    const fieldError = page.locator("[aria-invalid=true]").first();
    await expect(fieldError).toBeVisible();
    failures.push(...(await audit(page, "/register empty")));
    // The field's message is `danger`, #ff9b8f (§5.2, §10.4 ERROR_TEXT); its hint stays ink-400.
    const describedBy = (await fieldError.getAttribute("aria-describedby")) ?? "";
    const colours = await page.evaluate(
      (ids) => ids.map((id) => getComputedStyle(document.getElementById(id)!).color),
      describedBy.split(" ").filter((id) => id !== ""),
    );
    expect(colours).toContain("rgb(255, 155, 143)");
    expect(failures).toEqual([]);
  });

  test("the boot frame's Loading… line, while the session check is slow", async ({ page, api }) => {
    const gate = deferred();
    api.on("GET /api/session", async () => {
      await gate.promise;
      return signedOut;
    });
    await page.goto("/login");
    await expect(page.getByRole("status").getByText("Loading…")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const failures = await audit(page, "boot frame");
    gate.release();
    await expect(h1(page, "Log in")).toBeVisible();
    // Fails today: `text-zinc-500` is now ink-500, 4.36:1, and §5.4 allows no text in ink-500.
    expect(failures).toEqual([]);
  });

  test("the session check unreachable at boot: the banner and its button", async ({ page, api }) => {
    api.on("GET /api/session", envelope(500, "internal"));
    await page.goto("/packs");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await audit(page, "unreachable")).toEqual([]);
  });

  test("header links at rest and on hover, signed out and signed in", async ({ page, api }) => {
    api.on("GET /api/session", signedOut);
    const failures: string[] = [];
    const header = page.getByRole("banner");
    await visit(page, "/login");
    for (const link of await header.getByRole("link").all()) {
      await link.hover();
      failures.push(...(await audit(page, `signed out, hover ${await link.textContent()}`, header)));
    }
    failures.push(...(await audit(page, "footer", page.getByRole("contentinfo"))));
    await page.getByRole("contentinfo").getByRole("link", { name: "AniList" }).hover();
    failures.push(...(await audit(page, "footer, hover", page.getByRole("contentinfo"))));

    api.on("GET /api/session", signedIn(CHRIS));
    await visit(page, "/packs");
    await page.mouse.move(0, 0);
    failures.push(...(await audit(page, "signed in at rest", header)));
    for (const link of await mainNav(page).getByRole("link").all()) {
      await link.hover();
      failures.push(...(await audit(page, `signed in, hover ${await link.textContent()}`, header)));
    }
    await control(page).hover();
    failures.push(...(await audit(page, "Account control, hover", header)));
    expect(failures).toEqual([]);
  });

  test("a disabled primary is drawn as §10.4 says, and does not change on hover", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    api.game.available = 0;
    await visit(page, "/packs");
    const open = page.getByRole("button", { name: "Open pack" });
    await expect(open).toHaveAttribute("aria-disabled", "true");
    await expect(open).toHaveCSS("background-color", "rgb(29, 33, 64)");
    await expect(open).toHaveCSS("color", "rgb(110, 116, 147)");
    await open.hover();
    await expect(open).toHaveCSS("background-color", "rgb(29, 33, 64)");
    await expect(open).toHaveCSS("color", "rgb(110, 116, 147)");
  });

  test("tier text never sits on night-800 (§5.4 rule)", async ({ page, api }) => {
    stock(api);
    const tierText = new Set(["#9a9da6", "#3cc7a9", "#6f95ec", "#e45b76", "#f5b84a", "#b79ff0"]);
    const offenders: string[] = [];
    const check = async (where: string, scope?: Locator) => {
      const { pairs } = await auditContrast(page, scope);
      for (const pair of pairs) {
        if (tierText.has(pair.color) && pair.background === "#1d2140")
          offenders.push(`${where}: ${pair.text}`);
      }
    };
    for (const path of ["/packs", "/shop", "/market", "/collection"]) {
      await visit(page, path);
      await check(path);
    }
    await visit(page, "/packs");
    await page.getByRole("button", { name: "Pack odds" }).click();
    await check("Pack odds", dialog(page));
    await page.keyboard.press("Escape");
    await visit(page, "/collection");
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    await check("card dialog", dialog(page));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// The remap
// ---------------------------------------------------------------------------------------------------

/** Every computed colour on the page that is a Tailwind violet, purple, fuchsia or indigo (oklch hue 260–340). */
async function oldViolets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const properties = [
      "color",
      "backgroundColor",
      "backgroundImage",
      "borderTopColor",
      "borderRightColor",
      "borderBottomColor",
      "borderLeftColor",
      "outlineColor",
      "boxShadow",
      "textDecorationColor",
      "fill",
      "stroke",
    ] as const;
    const found = new Set<string>();
    const inspect = (element: Element, pseudo?: string) => {
      const style = getComputedStyle(element, pseudo);
      for (const property of properties) {
        const value = style[property];
        for (const match of value.matchAll(/oklch\(([\d.]+)%? ([\d.]+) ([\d.]+)/g)) {
          const chroma = Number(match[2]);
          const hue = Number(match[3]);
          if (chroma > 0.05 && hue >= 260 && hue <= 340) {
            found.add(`${element.tagName.toLowerCase()}${pseudo ?? ""} ${property}: ${match[0]})`);
          }
        }
      }
    };
    for (const element of Array.from(document.querySelectorAll("*"))) {
      inspect(element);
      if (element instanceof HTMLDialogElement) inspect(element, "::backdrop");
    }
    return [...found];
  });
}

test.describe("the zinc remap (§12.1)", () => {
  test("no old violet anywhere: every route, signed out and in, and every dialog", async ({ page, api }) => {
    const found: string[] = [];
    api.on("GET /api/session", signedOut);
    for (const path of SIGNED_OUT_ROUTES) {
      await visit(page, path);
      found.push(...(await oldViolets(page)).map((v) => `${path} ${v}`));
    }
    stock(api);
    for (const path of SIGNED_IN_ROUTES) {
      await visit(page, path);
      found.push(...(await oldViolets(page)).map((v) => `${path} ${v}`));
    }
    await visit(page, "/packs");
    await page.getByRole("button", { name: "Pack odds" }).click();
    found.push(...(await oldViolets(page)).map((v) => `odds ${v}`));
    await page.keyboard.press("Escape");
    await visit(page, "/account");
    await page.getByRole("button", { name: "Delete account…" }).click();
    found.push(...(await oldViolets(page)).map((v) => `delete ${v}`));
    expect(found).toEqual([]);
  });

  /** Tabs through the page and returns every reached element that shows no 2 px Volt ring. */
  async function ringless(page: Page, presses: number): Promise<string[]> {
    const missing: string[] = [];
    for (let i = 0; i < presses; i += 1) {
      await page.keyboard.press("Tab");
      const result = await page.evaluate((volt) => {
        const element = document.activeElement;
        if (element === null || element === document.body) return null;
        const hasRing = (node: Element) => {
          const style = getComputedStyle(node);
          return (
            style.boxShadow.includes(`${volt} 0px 0px 0px 4px`) ||
            (style.outlineStyle !== "none" &&
              style.outlineColor === volt &&
              parseFloat(style.outlineWidth) >= 2)
          );
        };
        // A collection tile draws its ring around the card inside it (collection-overview.md §6.2).
        const ok = hasRing(element) || Array.from(element.querySelectorAll("*")).some(hasRing);
        const name =
          element.getAttribute("aria-label") ??
          (element.closest("label")?.textContent || element.textContent || element.tagName);
        return ok ? "" : `${element.tagName.toLowerCase()} "${name.trim().slice(0, 40)}"`;
      }, VOLT);
      if (result === null) break;
      if (result !== "") missing.push(result);
    }
    return missing;
  }

  test("every element Tab reaches shows the Volt ring, signed out", async ({ page, api }) => {
    api.on("GET /api/session", signedOut);
    const missing: string[] = [];
    for (const path of SIGNED_OUT_ROUTES) {
      await visit(page, path);
      missing.push(...(await ringless(page, 25)).map((m) => `${path}: ${m}`));
    }
    expect(missing).toEqual([]);
  });

  test("every element Tab reaches shows the Volt ring, signed in", async ({ page, api }) => {
    stock(api);
    const missing: string[] = [];
    for (const path of SIGNED_IN_ROUTES) {
      await visit(page, path);
      missing.push(...(await ringless(page, 25)).map((m) => `${path}: ${m}`));
    }
    expect(missing).toEqual([]);
  });

  test("every element Tab reaches shows the Volt ring with the unreachable banner up", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", envelope(500, "internal"));
    await page.goto("/packs");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await settle(page);
    const missing = await ringless(page, 25);
    expect(missing).toEqual([]);
  });

  test("the Account menu's items show focus with the Volt ring", async ({ page, api }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await visit(page, "/packs");
    await control(page).focus();
    await page.keyboard.press("Enter");
    const first = page.getByRole("menuitem").first();
    await expect(first).toBeFocused();
    const items = await page.getByRole("menuitem").all();
    const missing: string[] = [];
    for (const item of items) {
      await item.focus();
      const shadow = await item.evaluate((element) => getComputedStyle(element).boxShadow);
      if (!shadow.includes(VOLT)) missing.push(`${await item.textContent()}: ${shadow}`);
    }
    // Fails today: MENU_ITEM marks focus by a night-800 fill alone, about 1.2:1 against the menu.
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Header (§10.2) and eyebrows (§10.1)
// ---------------------------------------------------------------------------------------------------

test.describe("the header and the page header", () => {
  test("page links are bare: ink-400, ink-100 on hover and when current, a 2 px Volt foot in a 44 px target", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await visit(page, "/packs");
    await page.mouse.move(0, 0);
    const current = mainNav(page).getByRole("link", { name: "Packs", exact: true });
    const other = mainNav(page).getByRole("link", { name: "Shop", exact: true });
    await expect(current).toHaveAttribute("aria-current", "page");
    const look = (link: Locator) =>
      link.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          color: style.color,
          background: style.backgroundColor,
          size: style.fontSize,
          weight: style.fontWeight,
          foot: `${style.borderBottomWidth} ${style.borderBottomStyle} ${style.borderBottomColor}`,
          height: Math.round(element.getBoundingClientRect().height),
        };
      });
    expect(await look(current)).toEqual({
      color: "rgb(238, 240, 250)",
      background: "rgba(0, 0, 0, 0)",
      size: "14px",
      weight: "600",
      foot: `2px solid ${VOLT}`,
      height: 44,
    });
    const rest = await look(other);
    expect(rest).toEqual({
      ...rest,
      color: "rgb(154, 160, 189)",
      background: "rgba(0, 0, 0, 0)",
      height: 44,
    });
    expect(rest.foot).not.toContain(VOLT);
    await other.hover();
    await expect(other).toHaveCSS("color", "rgb(238, 240, 250)");
    await expect(other).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("the Account control: night-850, a 1 px night-700 border, radius-control, 44 px tall", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await visit(page, "/packs");
    const button = control(page);
    await expect(button).toHaveCSS("background-color", "rgb(21, 24, 48)");
    await expect(button).toHaveCSS("border-top-width", "1px");
    await expect(button).toHaveCSS("border-top-color", "rgb(42, 47, 85)");
    await expect(button).toHaveCSS("border-top-left-radius", "10px");
    expect(Math.round((await button.boundingBox())!.height)).toBe(44);
  });

  const EYEBROWS: Record<string, string> = {
    "/": "Anime character cards",
    "/demo": "Try a pack",
    "/login": "Welcome back",
    "/register": "Invite only",
    "/packs": "Timer packs",
    "/shop": "Themed packs",
    "/market": "Player trades",
    "/collection": "Your cards",
    "/profile": "Player",
    "/account": "Settings",
    [NOT_FOUND_PATH]: "404",
  };

  async function eyebrowOf(page: Page) {
    return h1(page).evaluate((heading) => {
      const eyebrow = heading.previousElementSibling;
      if (eyebrow === null) return null;
      const style = getComputedStyle(eyebrow);
      const below = heading.getBoundingClientRect().top - eyebrow.getBoundingClientRect().bottom;
      return {
        tag: eyebrow.tagName,
        text: eyebrow.textContent,
        hidden: eyebrow.getAttribute("aria-hidden"),
        font: style.fontFamily.split(",")[0],
        color: style.color,
        transform: style.textTransform,
        above: below >= 0,
      };
    });
  }

  test("every route has its eyebrow above the h1: hidden from assistive technology, mono, ink-400, uppercase", async ({
    page,
    api,
  }) => {
    const seen: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    const check = async (path: string) => {
      await visit(page, path);
      seen[path] = await eyebrowOf(page);
      expected[path] = {
        tag: "P",
        text: EYEBROWS[path],
        hidden: "true",
        font: '"Martian Mono Variable"',
        color: "rgb(154, 160, 189)",
        transform: "uppercase",
        above: true,
      };
      // Not in the accessibility tree: the main region's snapshot never names it.
      const tree = await page.locator("body").ariaSnapshot();
      expect(tree, `${path}: the eyebrow is aria-hidden`).not.toContain(EYEBROWS[path]);
    };
    api.on("GET /api/session", signedOut);
    for (const path of SIGNED_OUT_ROUTES) await check(path);
    api.on("GET /api/session", signedIn(CHRIS));
    for (const path of SIGNED_IN_ROUTES) await check(path);
    expect(seen).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------------------------------
// Fonts (§4.1)
// ---------------------------------------------------------------------------------------------------

test.describe("fonts (§4.1)", () => {
  test("on first paint the three families load unasked, from this origin, latin files only; nothing leaves the origin", async ({
    page,
    api,
    baseURL,
  }) => {
    api.on("GET /api/session", signedOut);
    const fonts: string[] = [];
    const foreign: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.resourceType() === "font") fonts.push(url.pathname);
      // AniList's image CDN is the one other host the CSP allows (img-src); the fixture mocks it.
      if (url.origin !== new URL(baseURL!).origin && url.hostname !== "s4.anilist.co")
        foreign.push(request.url());
    });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await visit(page, "/");
    // Nothing asks for a face here: the page's own text pulled each one in.
    const status = await page.evaluate(() =>
      (() => {
        const list: FontFace[] = [];
        document.fonts.forEach((face) => list.push(face));
        return list;
      })()
        .filter((face) => face.status === "loaded")
        .map((face) => face.family.replace(/"/g, ""))
        .sort(),
    );
    expect(status).toEqual(["Bricolage Grotesque Variable", "Figtree Variable", "Martian Mono Variable"]);
    // The page's text is all latin, so only the latin subsets come (unicode-range): three files.
    expect(fonts.map((path) => path.split("/").pop()).sort()).toEqual([
      expect.stringMatching(/^bricolage-grotesque-latin-wdth-normal\.woff2/),
      expect.stringMatching(/^figtree-latin-wght-normal\.woff2/),
      expect.stringMatching(/^martian-mono-latin-wght-normal\.woff2/),
    ]);
    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("under the Caddyfile's font-src 'self' no font is refused", async ({ page, api }) => {
    api.on("GET /api/session", signedOut);
    // The dev server sends no CSP; add the production directive for fonts to every document.
    await page.route(
      (url) => !url.pathname.startsWith("/api/") && !/\.\w+$/.test(url.pathname),
      async (route) => {
        if (route.request().resourceType() !== "document") return route.fallback();
        const response = await route.fetch();
        await route.fulfill({
          response,
          headers: { ...response.headers(), "content-security-policy": "font-src 'self'" },
        });
      },
    );
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __violations: string[] }).__violations = seen;
      document.addEventListener("securitypolicyviolation", (event) =>
        seen.push(`${event.effectiveDirective} ${event.blockedURI}`),
      );
    });
    const response = await page.goto("/login");
    expect(response?.headers()["content-security-policy"]).toBe("font-src 'self'");
    await expect(h1(page, "Log in")).toBeVisible();
    await settle(page);
    const loaded = await page.evaluate(() =>
      (() => {
        const list: FontFace[] = [];
        document.fonts.forEach((face) => list.push(face));
        return list;
      })()
        .filter((face) => face.status === "loaded")
        .map((face) => face.family),
    );
    expect(loaded).toHaveLength(3);
    expect(await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations)).toEqual(
      [],
    );
  });

  test("with every woff2 failing, the system stack draws every page and nothing scrolls sideways at 320 px", async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.route(/\.woff2(\?.*)?$/, (route) => route.abort("failed"));
    const problems: string[] = [];
    const check = async (path: string) => {
      await visit(page, path);
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        failed: (() => {
          const list: FontFace[] = [];
          document.fonts.forEach((face) => list.push(face));
          return list;
        })().filter((face) => face.status === "loaded").length,
        title: (() => {
          const heading = document.querySelector("h1")!;
          const style = getComputedStyle(heading);
          return {
            width: heading.getBoundingClientRect().width,
            visible:
              style.opacity === "1" && style.visibility === "visible" && style.color !== "rgba(0, 0, 0, 0)",
            stack: style.fontFamily,
          };
        })(),
      }));
      if (state.overflow > 0) problems.push(`${path}: ${state.overflow}px sideways`);
      if (state.failed !== 0) problems.push(`${path}: a face loaded although every file failed`);
      if (!state.title.visible || state.title.width === 0) problems.push(`${path}: the h1 is not drawn`);
      if (!/system-ui/.test(state.title.stack))
        problems.push(`${path}: no system fallback in ${state.title.stack}`);
    };
    api.on("GET /api/session", signedOut);
    for (const path of SIGNED_OUT_ROUTES) await check(path);
    stock(api, LONG);
    for (const path of SIGNED_IN_ROUTES) await check(path);
    expect(problems).toEqual([]);
  });

  test("layout shift on first paint stays under 0.1 with the fonts 600 ms late", async ({ page, api }) => {
    await page.route(/\.woff2(\?.*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    const shifts: Record<string, number> = {};
    const measure = async (path: string) => {
      await page.goto(path);
      await expect(h1(page)).toBeVisible();
      await settle(page);
      // One more frame after the swap, so its shift is reported.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100))),
      );
      shifts[path] = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            new PerformanceObserver((list, observer) => {
              observer.disconnect();
              const entries = list.getEntries() as unknown as Array<{
                value: number;
                hadRecentInput: boolean;
              }>;
              resolve(entries.filter((entry) => !entry.hadRecentInput).reduce((sum, e) => sum + e.value, 0));
            }).observe({ type: "layout-shift", buffered: true });
            setTimeout(() => resolve(0), 1_000);
          }),
      );
    };
    api.on("GET /api/session", signedOut);
    await measure("/");
    await measure("/login");
    api.on("GET /api/session", signedIn(CHRIS));
    await measure("/packs");
    for (const [path, value] of Object.entries(shifts)) expect(value, path).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------------------------------
// page-enter (§9.1)
// ---------------------------------------------------------------------------------------------------

declare global {
  interface Window {
    __enters?: string[];
  }
}

/** Records every `page-enter` start, by tag and text, from the first paint on. */
async function recordEnters(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    window.__enters = seen;
    document.addEventListener(
      "animationstart",
      (event) => {
        if (event.animationName !== "page-enter") return;
        const target = event.target as Element;
        seen.push(`${target.tagName.toLowerCase()} ${target.textContent}`);
      },
      true,
    );
  });
}
const enters = (page: Page) => page.evaluate(() => window.__enters ?? []);
const clearEnters = (page: Page) => page.evaluate(() => (window.__enters!.length = 0));
const played = (eyebrow: string, title: string) => [`p ${eyebrow}`, `h1 ${title}`];

test.describe("page-enter (§9.1)", () => {
  test("never on a load: any route signed out or in, and the boot redirects", async ({ page, api }) => {
    await recordEnters(page);
    const seen: Record<string, string[]> = {};
    api.on("GET /api/session", signedOut);
    for (const path of [...SIGNED_OUT_ROUTES, "/collection"]) {
      await visit(page, path);
      seen[path] = await enters(page);
    }
    api.on("GET /api/session", signedIn(CHRIS));
    for (const path of [...SIGNED_IN_ROUTES, "/login"]) {
      await visit(page, path);
      seen[`signed in ${path}`] = await enters(page);
    }
    // `/collection` signed out lands on `/login`; `/login` signed in lands on `/packs`: both part of the load.
    await expect(page).toHaveURL(/\/packs$/);
    expect(Object.entries(seen).filter(([, list]) => list.length > 0)).toEqual([]);
  });

  test("once per navigation: data arriving later does not replay it", async ({ page, api }) => {
    await recordEnters(page);
    api.on("GET /api/session", signedIn(CHRIS));
    await visit(page, "/packs");
    const gate = deferred();
    api.on("GET /api/collection", async (call) => {
      await gate.promise;
      return api.game.reply(call.key)!;
    });
    await mainNav(page)
      .getByRole("link", { name: /^Collection/ })
      .click();
    await expect(h1(page, "Collection")).toBeFocused();
    await expect.poll(() => enters(page)).toEqual(played("Your cards", "Collection"));
    gate.release();
    await settle(page);
    // An opened pack re-renders /packs with its reveal: the heading stays put.
    await mainNav(page).getByRole("link", { name: "Packs", exact: true }).click();
    await expect(h1(page, "Packs")).toBeFocused();
    await page.getByRole("button", { name: "Open pack" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Your pack" })).toBeVisible();
    await settle(page);
    expect(await enters(page)).toEqual([
      ...played("Your cards", "Collection"),
      ...played("Timer packs", "Packs"),
      ...(page.url().endsWith("/packs/open") ? played("Timer packs", "Pack opening") : []),
    ]);
  });

  test("two fast clicks: each page plays once, and the last ends fully shown and focused", async ({
    page,
    api,
  }) => {
    await recordEnters(page);
    api.on("GET /api/session", signedIn(CHRIS));
    await visit(page, "/packs");
    await mainNav(page).getByRole("link", { name: "Market" }).click();
    await mainNav(page).getByRole("link", { name: "Shop" }).click();
    await expect(h1(page, "Shop")).toBeFocused();
    await settle(page);
    const list = await enters(page);
    expect(list.filter((entry) => entry === "h1 Shop")).toHaveLength(1);
    expect(list.filter((entry) => entry === "p Themed packs")).toHaveLength(1);
    expect(list.filter((entry) => entry === "h1 Market").length).toBeLessThanOrEqual(1);
    await expect.poll(() => h1(page, "Shop").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    await expect
      .poll(() =>
        h1(page, "Shop").evaluate((e) =>
          e.previousElementSibling ? getComputedStyle(e.previousElementSibling).opacity : null,
        ),
      )
      .toBe("1");
    // At rest where it ended: no offset left (the fill keeps the last frame, `translateY(0)`).
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(
      await h1(page, "Shop").evaluate((e) => getComputedStyle(e).transform),
    );
  });

  test("Back and Forward each play once and focus the h1", async ({ page, api }) => {
    await recordEnters(page);
    api.on("GET /api/session", signedIn(CHRIS));
    await visit(page, "/packs");
    await mainNav(page).getByRole("link", { name: "Shop" }).click();
    await expect(h1(page, "Shop")).toBeFocused();
    // The title starts 40 ms after the eyebrow: let both run out before counting afresh.
    await settle(page);
    await clearEnters(page);
    await page.goBack();
    await expect(h1(page, "Packs")).toBeFocused();
    await settle(page);
    expect(await enters(page)).toEqual(played("Timer packs", "Packs"));
    await clearEnters(page);
    await page.goForward();
    await expect(h1(page, "Shop")).toBeFocused();
    await settle(page);
    expect(await enters(page)).toEqual(played("Themed packs", "Shop"));
  });

  test("under reduced motion Back and Forward play nothing either", async ({ page, api }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordEnters(page);
    api.on("GET /api/session", signedIn(CHRIS));
    await visit(page, "/packs");
    await mainNav(page).getByRole("link", { name: "Shop" }).click();
    await expect(h1(page, "Shop")).toBeFocused();
    await page.goBack();
    await expect(h1(page, "Packs")).toBeFocused();
    await page.goForward();
    await expect(h1(page, "Shop")).toBeFocused();
    await settle(page);
    expect(await enters(page)).toEqual([]);
    expect(await h1(page, "Shop").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  });

  test("it never moves focus: Tab pressed while it plays keeps its target after it ends", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    await visit(page, "/login");
    await mainNav(page).getByRole("link", { name: "Register" }).click();
    await expect(h1(page, "Register")).toBeFocused();
    await page.keyboard.press("Tab");
    const target = await page.evaluate(() => document.activeElement?.outerHTML);
    expect(await h1(page, "Register").evaluate((e) => getComputedStyle(e).animationName)).toBe("page-enter");
    await settle(page);
    expect(await h1(page, "Register").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    expect(await page.evaluate(() => document.activeElement?.outerHTML)).toBe(target);
    expect(target).not.toContain("<h1");
  });
});

// ---------------------------------------------------------------------------------------------------
// Sizes (§6.1, §10.4)
// ---------------------------------------------------------------------------------------------------

/** Every visible control under 44 px tall, or a primary or secondary button under 48; inline links exempt. */
async function smallTargets(page: Page, where: string, scope?: Locator): Promise<string[]> {
  const root = scope === undefined ? null : await scope.elementHandle();
  const found = await page.evaluate((start: Element | null) => {
    const out: string[] = [];
    const base = start ?? document.body;
    for (const element of Array.from(
      base.querySelectorAll(
        "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=menuitem]",
      ),
    )) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width === 0 || rect.height === 0 || style.visibility !== "visible") continue;
      if (element.closest(".sr-only") !== null) continue;
      // WCAG 2.5.8: a link in a sentence is sized by the line it sits in.
      if (element.tagName === "A" && style.display === "inline") continue;
      // A checkbox's target is its label (the whole row takes the press).
      const box =
        element instanceof HTMLInputElement &&
        element.type === "checkbox" &&
        element.closest("label") !== null
          ? element.closest("label")!.getBoundingClientRect()
          : rect;
      const fill = style.backgroundColor;
      const kind =
        fill === "rgb(200, 240, 49)" || fill === "rgb(217, 248, 106)"
          ? "primary"
          : fill === "rgb(21, 24, 48)" && style.borderTopColor === "rgb(58, 64, 112)"
            ? "secondary"
            : "control";
      const needs = kind === "control" ? 44 : 48;
      if (box.height < needs - 0.5) {
        const name = (
          element.getAttribute("aria-label") ??
          (element.closest("label")?.textContent || element.textContent || element.tagName)
        ).trim();
        out.push(`${kind} "${name.slice(0, 40)}" ${Math.round(box.height)}px (needs ${needs})`);
      }
    }
    return out;
  }, root);
  return found.map((entry) => `${where}: ${entry}`);
}

test.describe("sizes at 320 px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
  });

  test("no dialog, menu or state scrolls sideways", async ({ page, api }) => {
    stock(api, LONG);
    const sideways: string[] = [];
    const check = async (where: string) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 0) sideways.push(`${where}: ${overflow}px`);
    };
    await visit(page, "/packs");
    await page.getByRole("button", { name: "Pack odds" }).click();
    await check("Pack odds");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open pack" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Your pack" })).toBeVisible();
    await settle(page);
    await check("the reveal");
    await control(page, LONG.login).click();
    await check("Account menu");
    await page.keyboard.press("Escape");
    await visit(page, "/shop");
    await page.getByRole("button", { name: "Buy…" }).click();
    await check("Buy dialog");
    await page.keyboard.press("Escape");
    await visit(page, "/collection");
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    await settle(page);
    await check("card dialog");
    await page.keyboard.press("Escape");
    await visit(page, "/account");
    await page.getByRole("button", { name: "Delete account…" }).click();
    await check("Delete dialog");
    expect(sideways).toEqual([]);
  });

  test("the unreachable banner's Try again is 44 px or more", async ({ page, api }) => {
    api.on("GET /api/session", envelope(500, "internal"));
    await page.goto("/packs");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await settle(page);
    expect(await smallTargets(page, "unreachable")).toEqual([]);
  });

  test("every control is 44 px or more and every primary or secondary 48, signed out", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedOut);
    const small: string[] = [];
    for (const path of SIGNED_OUT_ROUTES) {
      await visit(page, path);
      small.push(...(await smallTargets(page, path)));
    }
    expect(small).toEqual([]);
  });

  test("every control is 44 px or more and every primary or secondary 48, signed in", async ({
    page,
    api,
  }) => {
    stock(api);
    const small: string[] = [];
    for (const path of SIGNED_IN_ROUTES) {
      await visit(page, path);
      small.push(...(await smallTargets(page, path)));
    }
    // Fails today, each 40 px: the wordmark, `Pack odds`, `Odds per card`, `Browse` / `My listings`,
    // the Collection's view switch, tier chips and `Duplicates only` row.
    expect(small).toEqual([]);
  });

  test("every control in the dialogs and the Account menu is 44 px or more", async ({ page, api }) => {
    stock(api);
    const small: string[] = [];
    await visit(page, "/packs");
    await page.getByRole("button", { name: "Pack odds" }).click();
    await settle(page);
    small.push(...(await smallTargets(page, "Pack odds", dialog(page))));
    await page.keyboard.press("Escape");
    await control(page).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await settle(page);
    small.push(...(await smallTargets(page, "Account menu", page.getByRole("menu"))));
    await page.keyboard.press("Escape");
    await visit(page, "/shop");
    await page.getByRole("button", { name: "Buy…" }).click();
    await settle(page);
    small.push(...(await smallTargets(page, "Buy dialog", dialog(page))));
    await page.keyboard.press("Escape");
    await visit(page, "/collection");
    await page
      .getByRole("list", { name: /results?/ })
      .getByRole("button", { name: /Spike/ })
      .click();
    await settle(page);
    small.push(...(await smallTargets(page, "card dialog", dialog(page))));
    await page.keyboard.press("Escape");
    await visit(page, "/account");
    await page.getByRole("button", { name: "Delete account…" }).click();
    await settle(page);
    small.push(...(await smallTargets(page, "Delete dialog", dialog(page))));
    // Fails today, each 40 px: the Account menu's items (MENU_ITEM `min-h-10`), the card dialog's
    // `Close` and `See <name> on the market` (ListSection's MARKET_LINK `min-h-10`).
    expect(small).toEqual([]);
  });
});

test("from 640 px the primary and secondary buttons are 44 px", async ({ page, api }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  api.on("GET /api/session", signedOut);
  await visit(page, "/login");
  const submit = page.getByRole("button", { name: "Log in", exact: true });
  expect(Math.round((await submit.boundingBox())!.height)).toBe(44);
  await visit(page, NOT_FOUND_PATH);
  for (const link of await page.getByRole("main").getByRole("link").all()) {
    expect(Math.round((await link.boundingBox())!.height), (await link.textContent()) ?? "").toBe(44);
  }
});

// ---------------------------------------------------------------------------------------------------
// The licence file (§4.1, §11.1)
// ---------------------------------------------------------------------------------------------------

test.describe("the licence file", () => {
  const licenceLink = (page: Page) =>
    page.getByRole("contentinfo").getByRole("link", { name: "SIL Open Font License", exact: true });

  test("the footer links it on every route, signed out and in, and in the boot frame", async ({
    page,
    api,
  }) => {
    const hrefs: Record<string, string | null> = {};
    const gate = deferred();
    api.on("GET /api/session", async () => {
      await gate.promise;
      return signedOut;
    });
    await page.goto("/login");
    await expect(page.getByRole("status").getByText("Loading…")).toBeVisible();
    hrefs.boot = await licenceLink(page).getAttribute("href");
    gate.release();
    api.on("GET /api/session", signedOut);
    for (const path of SIGNED_OUT_ROUTES) {
      await visit(page, path);
      hrefs[path] = await licenceLink(page).getAttribute("href");
    }
    api.on("GET /api/session", signedIn(CHRIS));
    for (const path of [...SIGNED_IN_ROUTES, "/packs/open", "/shop/open"]) {
      await visit(page, path);
      hrefs[`signed in ${path}`] = await licenceLink(page).getAttribute("href");
    }
    expect(
      Object.values(hrefs).every((href) => href === "/licenses/fonts.txt"),
      JSON.stringify(hrefs),
    ).toBe(true);
    expect(Object.keys(hrefs)).toHaveLength(1 + SIGNED_OUT_ROUTES.length + SIGNED_IN_ROUTES.length + 2);
  });

  test("a click from a deep page opens the plain text, not the app's not-found page; Back returns", async ({
    page,
    api,
  }) => {
    api.on("GET /api/session", signedIn(CHRIS));
    await visit(page, "/collection");
    const [response] = await Promise.all([
      page.waitForEvent("response", (r) => r.url().endsWith("/licenses/fonts.txt")),
      licenceLink(page).click(),
    ]);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
    await expect(page).toHaveURL(/\/licenses\/fonts\.txt$/);
    await expect(page.locator("body")).toContainText("SIL OPEN FONT LICENSE Version 1.1");
    await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
    await page.goBack();
    await expect(h1(page, "Collection")).toBeVisible();
  });

  test("the dev server answers it as text/plain with no long cache", async ({ request }) => {
    const response = await request.get("/licenses/fonts.txt");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.headers()["cache-control"] ?? "").not.toMatch(/immutable|max-age=[1-9]/);
  });
});
