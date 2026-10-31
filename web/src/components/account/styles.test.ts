import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CONTROL,
  AVATAR,
  BUTTON,
  ERROR_TEXT,
  FOCUS_RING,
  HINT_TEXT,
  INPUT,
  INPUT_BORDER,
  MENU_ITEM,
} from "./styles";

/** The class tokens of a style string, so `min-h-10` does not match inside `sm:min-h-10`. */
function tokens(classes: string): string[] {
  return classes.split(/\s+/);
}

/**
 * visual-identity.md §10.4 and §6.1 (raising accounts.md §7's 40 px): buttons are 48 px tall on a phone
 * and 44 px from `sm`, the text fields as tall so a field and a button share a row, the Account control
 * 44 px; menu items keep accounts.md §7's 40 px on phone. Layout is not measurable in jsdom, so this pins
 * the utilities that give those heights.
 */
describe("touch targets", () => {
  const controlTargets: Array<[string, string]> = [
    ["primary button", BUTTON.primary],
    ["secondary button", BUTTON.secondary],
    ["danger outline button", BUTTON.dangerOutline],
    ["danger solid button", BUTTON.dangerSolid],
    ["text field, which holds the Show/Hide toggle", INPUT],
  ];

  it.each(controlTargets)("%s is 48 px tall below sm and 44 px from sm up", (_, classes) => {
    expect(tokens(classes)).toEqual(expect.arrayContaining(["min-h-12", "sm:min-h-11"]));
  });

  it("the Account control is 44 px tall at every width (§10.2)", () => {
    expect(tokens(ACCOUNT_CONTROL)).toContain("min-h-11");
  });

  it("menu items are at least 40 px tall below sm and unchanged from sm up", () => {
    expect(tokens(MENU_ITEM)).toEqual(expect.arrayContaining(["min-h-10", "sm:min-h-0"]));
  });

  it("text buttons (Show/Hide) are 44 px tall below sm and 28 px from sm up, inside the 48 px field", () => {
    expect(tokens(BUTTON.text)).toEqual(expect.arrayContaining(["h-11", "sm:h-7"]));
  });
});

/** §10.4 and §5.4: Volt is the one action colour and the focus ring; disabled is a night block. */
describe("the identity's controls", () => {
  it("the primary button is a flat Volt fill with Volt-ink words and its hover and press steps, no gradient or shadow", () => {
    const classes = tokens(BUTTON.primary);
    expect(classes).toEqual(
      expect.arrayContaining([
        "bg-volt",
        "text-volt-ink",
        "hover:bg-volt-hover",
        "active:bg-volt-press",
        "rounded-control",
      ]),
    );
    expect(
      classes.filter((token) => /gradient|^from-|^via-|^to-|shadow|scale|translate/.test(token)),
    ).toEqual([]);
  });

  it("every filled kind, disabled or aria-disabled, is a night-800 block with ink-500 words that hover does not change", () => {
    for (const kind of ["primary", "secondary", "dangerOutline", "dangerSolid"] as const) {
      expect(tokens(BUTTON[kind]), kind).toEqual(
        expect.arrayContaining([
          "disabled:bg-night-800",
          "disabled:text-ink-500",
          "disabled:hover:bg-night-800",
          "aria-disabled:bg-night-800",
          "aria-disabled:text-ink-500",
          "aria-disabled:hover:bg-night-800",
        ]),
      );
    }
    expect(tokens(BUTTON.text)).toEqual(
      expect.arrayContaining(["disabled:text-ink-500", "aria-disabled:text-ink-500"]),
    );
  });

  it("the focus ring is 2 px Volt with a 2 px gap in the page's night", () => {
    expect(tokens(FOCUS_RING)).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-2",
        "focus-visible:ring-volt",
        "focus-visible:ring-offset-2",
        "focus-visible:ring-offset-night-950",
      ]),
    );
    expect(FOCUS_RING).not.toMatch(/violet/);
  });

  it("error text and an invalid field use danger, not red-300", () => {
    expect(tokens(ERROR_TEXT)).toContain("text-danger");
    expect(INPUT_BORDER.invalid).toBe("border-danger");
  });

  it("hints are ink-400, never the non-text ink-500 (§5.4)", () => {
    expect(tokens(HINT_TEXT)).toContain("text-ink-400");
  });
});

describe("avatar placeholder", () => {
  it("is a solid neutral circle with a white initial, no gradient (engineering standards §2)", () => {
    const classes = tokens(AVATAR);
    expect(classes).toEqual(expect.arrayContaining(["rounded-full", "bg-zinc-700", "text-white"]));
    expect(classes.filter((token) => /gradient|^from-|^via-|^to-/.test(token))).toEqual([]);
  });
});
