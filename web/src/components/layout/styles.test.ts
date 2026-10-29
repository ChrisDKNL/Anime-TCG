import { describe, expect, it } from "vitest";
import { HEADER_TEXT_LINK, LINK_BUTTON, NAV_LINK, SKIP_LINK, WORDMARK } from "./styles";

/** The class tokens of a style string, so `min-h-10` does not match inside `sm:min-h-10`. */
function tokens(classes: string): string[] {
  return classes.split(/\s+/);
}

/**
 * navigation-and-landing.md §7 "Touch targets": the header links, the skip
 * link and the link-buttons are at least 40 px tall on phone. jsdom does no
 * layout, so this pins the utilities that give those heights.
 */
describe("touch targets", () => {
  const minHeightTargets: Array<[string, string]> = [
    ["current page link", NAV_LINK.current],
    ["other page link", NAV_LINK.other],
    ["primary link-button", LINK_BUTTON.primary],
    ["secondary link-button (Register, not-found, profile)", LINK_BUTTON.secondary],
    ["skip link", SKIP_LINK],
  ];

  it.each(minHeightTargets)("%s is at least 40 px tall below sm", (_, classes) => {
    expect(tokens(classes)).toEqual(expect.arrayContaining(["min-h-10", "sm:min-h-0"]));
  });

  it("the signed-out Log in link is 40 px tall below sm and 28 px from sm up, as the text buttons", () => {
    expect(tokens(HEADER_TEXT_LINK)).toEqual(expect.arrayContaining(["h-10", "sm:h-7", "text-sm"]));
  });
});

describe("page links (§6.1)", () => {
  it("mark the current page by its fill alone", () => {
    expect(tokens(NAV_LINK.current)).toEqual(expect.arrayContaining(["bg-zinc-700", "text-white"]));
    expect(tokens(NAV_LINK.other)).not.toContain("bg-zinc-700");
    expect(tokens(NAV_LINK.other)).toEqual(expect.arrayContaining(["text-zinc-400", "hover:text-zinc-200"]));
  });
});

describe("wordmark (§6.1)", () => {
  it("is plain text with no gradient (engineering standards §2 debt removed)", () => {
    const classes = tokens(WORDMARK);
    expect(classes).toEqual(expect.arrayContaining(["text-xl", "font-black", "text-zinc-100"]));
    expect(
      classes.filter((token) => /gradient|^from-|^via-|^to-|bg-clip-text|text-transparent/.test(token)),
    ).toEqual([]);
  });
});
