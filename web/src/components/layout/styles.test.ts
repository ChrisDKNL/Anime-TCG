import { describe, expect, it } from "vitest";
import {
  EYEBROW,
  HEADER_TEXT_LINK,
  LINK_BUTTON,
  NAV_GROUP,
  NAV_LINK,
  PAGE_ENTER,
  SKIP_LINK,
  TITLE,
  WORDMARK,
} from "./styles";

/** The class tokens of a style string, so `min-h-10` does not match inside `sm:min-h-10`. */
function tokens(classes: string): string[] {
  return classes.split(/\s+/);
}

/**
 * navigation-and-landing.md §7 "Touch targets", raised by visual-identity.md §6.1 and §10: the page links
 * are 44 px targets, the link-buttons and the skip link the buttons' 48 px on phone and 44 px from `sm`,
 * the wordmark 44 px on phone. jsdom does no layout, so this pins the utilities that give those heights.
 */
describe("touch targets", () => {
  it.each([
    ["current page link", NAV_LINK.current],
    ["other page link", NAV_LINK.other],
  ])("%s is 44 px tall at every width (§10.2)", (_, classes) => {
    expect(tokens(classes)).toContain("min-h-11");
  });

  it.each([
    ["primary link-button", LINK_BUTTON.primary],
    ["secondary link-button (Register, not-found, profile)", LINK_BUTTON.secondary],
    ["skip link", SKIP_LINK],
  ])("%s is 48 px tall below sm and 44 px from sm up", (_, classes) => {
    expect(tokens(classes)).toEqual(expect.arrayContaining(["min-h-12", "sm:min-h-11"]));
  });

  it("the wordmark link is 44 px tall below sm (§6.1)", () => {
    expect(tokens(WORDMARK)).toEqual(expect.arrayContaining(["min-h-11", "sm:min-h-0"]));
  });

  it("the signed-out Log in link is 44 px tall below sm and 28 px from sm up, as the text buttons", () => {
    expect(tokens(HEADER_TEXT_LINK)).toEqual(expect.arrayContaining(["h-11", "sm:h-7", "text-sm"]));
  });
});

describe("page links (visual-identity.md §10.2)", () => {
  it("are bare links: the current page ink-100 with a Volt line at its foot, the others ink-400", () => {
    expect(tokens(NAV_LINK.current)).toEqual(
      expect.arrayContaining(["border-b-2", "border-volt", "text-ink-100"]),
    );
    expect(tokens(NAV_LINK.other)).toEqual(
      expect.arrayContaining(["border-b-2", "border-transparent", "text-ink-400", "hover:text-ink-100"]),
    );
    expect(tokens(NAV_LINK.other)).not.toContain("border-volt");
    for (const classes of [NAV_LINK.current, NAV_LINK.other, NAV_GROUP]) {
      expect(tokens(classes).filter((token) => /^bg-|^rounded-(lg|xl)$/.test(token))).toEqual([]);
    }
  });
});

describe("wordmark (§10.2)", () => {
  it("is the display face at 800 and 85 % wide, 20 px, ink-100, with no gradient", () => {
    const classes = tokens(WORDMARK);
    expect(classes).toEqual(
      expect.arrayContaining(["display-tight", "text-xl", "font-extrabold", "text-ink-100"]),
    );
    expect(
      classes.filter((token) => /gradient|^from-|^via-|^to-|bg-clip-text|text-transparent/.test(token)),
    ).toEqual([]);
  });
});

describe("the page header (§10.1, §4.2)", () => {
  it("sets the eyebrow in the mono at the eyebrow size, uppercase, in ink-400", () => {
    expect(tokens(EYEBROW)).toEqual(
      expect.arrayContaining(["font-mono", "text-eyebrow", "uppercase", "text-ink-400"]),
    );
  });

  it("sets the title in the narrowed display face at 36, 48 and 56 px, the landing's at 48, 72 and 96 px", () => {
    expect(tokens(TITLE.title)).toEqual(
      expect.arrayContaining([
        "display-tight",
        "text-title",
        "sm:text-[3rem]",
        "lg:text-[3.5rem]",
        "text-ink-100",
      ]),
    );
    expect(tokens(TITLE.hero)).toEqual(
      expect.arrayContaining([
        "display-tight",
        "text-hero",
        "sm:text-[4.5rem]",
        "lg:text-[6rem]",
        "text-ink-100",
      ]),
    );
  });

  it("enters by page-enter, the title 40 ms after the eyebrow, and not at all under reduced motion", () => {
    expect(tokens(PAGE_ENTER.eyebrow)).toEqual(
      expect.arrayContaining(["animate-page-enter", "motion-reduce:animate-none"]),
    );
    expect(tokens(PAGE_ENTER.title)).toEqual(
      expect.arrayContaining(["animate-page-enter", "[animation-delay:40ms]", "motion-reduce:animate-none"]),
    );
  });
});
