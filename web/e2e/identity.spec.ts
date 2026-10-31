/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { expect, signedOut, test } from "./support/fake-api";

/**
 * Test plan: the identity's first build (docs/design/visual-identity.md §15 row 1) in a real browser,
 * where the fonts, the computed colours and the animations are real, as jsdom's are not.
 *
 * - The three self-hosted families load from this origin, and Bricolage's `wdth` file gives the spec's
 *   look: its width axis narrows the face and its weight axis reaches 800 (§4.1, §4.2).
 * - The page is flat night; the title, eyebrow and body take their families; the primary button is Volt.
 * - The footer's second line links to `/licenses/fonts.txt`, which holds each package's OFL licence.
 * - `page-enter` plays on a navigation only, and not at all under reduced motion (§9.1).
 */

const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });

test.beforeEach(({ api }) => {
  api.on("GET /api/session", signedOut);
});

test("the three families load from this origin, and the display face's width and weight axes work", async ({
  page,
}) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fontRequests.push(request.url());
  });
  await page.goto("/login");
  await expect(h1(page, "Log in")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const loaded = await page.evaluate(async () => {
    const families = ["Bricolage Grotesque Variable", "Figtree Variable", "Martian Mono Variable"];
    await Promise.all(families.map((family) => document.fonts.load(`500 16px "${family}"`, "Anime")));
    return families.map((family) => document.fonts.check(`500 16px "${family}"`, "Anime"));
  });
  expect(loaded).toEqual([true, true, true]);
  expect(fontRequests.length, "font files requested").toBeGreaterThan(0);
  for (const url of fontRequests) expect(new URL(url).origin, url).toBe(new URL(page.url()).origin);

  // One string in the display face at the spec's settings and at the axes' other ends: if the file lacked
  // an axis, the browser would draw the same advance for both ends.
  const width = await page.evaluate(async () => {
    // The `font` shorthand takes width keywords only: `condensed` is 75 %.
    await document.fonts.load('800 condensed 48px "Bricolage Grotesque Variable"', "Anime TCG");
    const measure = (weight: number, stretch: string) => {
      const probe = document.createElement("span");
      probe.textContent = "Anime TCG";
      Object.assign(probe.style, {
        position: "absolute",
        whiteSpace: "nowrap",
        fontFamily: '"Bricolage Grotesque Variable"',
        fontSize: "48px",
        fontWeight: String(weight),
        fontStretch: stretch,
      });
      document.body.append(probe);
      const result = probe.getBoundingClientRect().width;
      probe.remove();
      return result;
    };
    return {
      narrow: measure(800, "75%"),
      display: measure(800, "85%"),
      full: measure(800, "100%"),
      light: measure(400, "85%"),
    };
  });
  expect(width.narrow).toBeLessThan(width.display);
  expect(width.display).toBeLessThan(width.full);
  expect(width.light, "weight 800 is drawn heavier, so wider, than 400").toBeLessThan(width.display);
  // §4.2: `Anime TCG` at 48 px and 85 % fits the 288 px of a 320 px phone.
  expect(width.display).toBeLessThan(288);
});

test("the page is flat night, and the title, eyebrow, body and primary button take the identity", async ({
  page,
}) => {
  await page.goto("/login");
  const title = h1(page, "Log in");
  await expect(title).toBeVisible();
  const look = await page.evaluate(() => {
    const style = (element: Element | null) => (element === null ? null : getComputedStyle(element));
    const heading = document.querySelector("h1");
    const eyebrow = heading?.previousElementSibling ?? null;
    const frame = document.querySelector("#root > div");
    const submit = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Log in",
    );
    return {
      body: style(document.body)?.backgroundColor,
      bodyFont: style(document.body)?.fontFamily,
      frameImage: style(frame)?.backgroundImage,
      titleFont: style(heading)?.fontFamily,
      titleWeight: style(heading)?.fontWeight,
      titleStretch: style(heading)?.fontStretch,
      titleSize: style(heading)?.fontSize,
      eyebrowText: eyebrow?.textContent,
      eyebrowFont: style(eyebrow)?.fontFamily,
      eyebrowCase: style(eyebrow)?.textTransform,
      buttonFill: style(submit ?? null)?.backgroundColor,
      buttonInk: style(submit ?? null)?.color,
    };
  });
  expect(look).toEqual({
    body: "rgb(7, 8, 15)",
    bodyFont: expect.stringMatching(/^"Figtree Variable"/),
    frameImage: "none",
    titleFont: expect.stringMatching(/^"Bricolage Grotesque Variable"/),
    titleWeight: "800",
    titleStretch: "85%",
    titleSize: "56px",
    eyebrowText: "Welcome back",
    eyebrowFont: expect.stringMatching(/^"Martian Mono Variable"/),
    eyebrowCase: "uppercase",
    buttonFill: "rgb(200, 240, 49)",
    buttonInk: "rgb(7, 8, 15)",
  });
});

test("the footer's second line names the fonts and links their licences, which the site serves", async ({
  page,
}) => {
  await page.goto("/login");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText(
    "Fonts: Bricolage Grotesque, Figtree, Martian Mono (SIL Open Font License).",
  );
  const link = footer.getByRole("link", { name: "SIL Open Font License", exact: true });
  await expect(link).toHaveAttribute("href", "/licenses/fonts.txt");

  const response = await page.request.get("/licenses/fonts.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
  const text = await response.text();
  for (const notice of [
    "Copyright 2022 The Bricolage Grotesque Project Authors",
    "Copyright 2022 The Figtree Project Authors",
    "Copyright 2020 The Martian Mono Project Authors",
  ]) {
    expect(text).toContain(notice);
  }
  expect(text.match(/SIL OPEN FONT LICENSE Version 1\.1/g)).toHaveLength(3);
});

const enterAnimation = (page: Page) =>
  h1(page, "Register").evaluate((heading) => getComputedStyle(heading).animationName);

test("page-enter plays on a navigation and not on a load", async ({ page }) => {
  await page.goto("/login");
  await expect(h1(page, "Log in")).toBeVisible();
  expect(await h1(page, "Log in").evaluate((heading) => getComputedStyle(heading).animationName)).toBe(
    "none",
  );

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Register" }).click();
  await expect(h1(page, "Register")).toBeFocused();
  expect(await enterAnimation(page)).toBe("page-enter");
  // The animation ends where the page rests: fully shown.
  await expect
    .poll(() => h1(page, "Register").evaluate((heading) => getComputedStyle(heading).opacity))
    .toBe("1");

  await page.reload();
  await expect(h1(page, "Register")).toBeVisible();
  expect(await enterAnimation(page)).toBe("none");
});

test("under reduced motion nothing enters", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Register" }).click();
  await expect(h1(page, "Register")).toBeFocused();
  expect(await enterAnimation(page)).toBe("none");
});
