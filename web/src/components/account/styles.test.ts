import { describe, expect, it } from "vitest";
import { ACCOUNT_CONTROL, AVATAR, BUTTON, INPUT, MENU_ITEM } from "./styles";

/** The class tokens of a style string, so `min-h-10` does not match inside `sm:min-h-10`. */
function tokens(classes: string): string[] {
  return classes.split(/\s+/);
}

/**
 * accounts.md §7: buttons, menu items, toggles and the Close button are at
 * least 40 px tall on phone; from `sm` up §6's sizes apply again. Layout is not
 * measurable in jsdom, so this pins the utilities that give those heights.
 */
describe("touch targets", () => {
  const minHeightTargets: Array<[string, string]> = [
    ["primary button", BUTTON.primary],
    ["secondary button", BUTTON.secondary],
    ["danger outline button", BUTTON.dangerOutline],
    ["danger solid button", BUTTON.dangerSolid],
    ["menu item", MENU_ITEM],
    ["Account control and signed-out Account button", ACCOUNT_CONTROL],
    ["text field, which holds the Show/Hide toggle", INPUT],
  ];

  it.each(minHeightTargets)("%s is at least 40 px tall below sm and unchanged from sm up", (_, classes) => {
    expect(tokens(classes)).toEqual(expect.arrayContaining(["min-h-10", "sm:min-h-0"]));
  });

  it("text buttons (Show/Hide, Close) are 40 px tall below sm and 28 px from sm up", () => {
    expect(tokens(BUTTON.text)).toEqual(expect.arrayContaining(["h-10", "sm:h-7"]));
  });
});

describe("avatar placeholder", () => {
  it("is a solid neutral circle with a white initial, no gradient (engineering standards §2)", () => {
    const classes = tokens(AVATAR);
    expect(classes).toEqual(expect.arrayContaining(["rounded-full", "bg-zinc-700", "text-white"]));
    expect(classes.filter((token) => /gradient|^from-|^via-|^to-/.test(token))).toEqual([]);
  });
});
