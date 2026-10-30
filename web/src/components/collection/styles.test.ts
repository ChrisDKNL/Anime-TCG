import { RARITIES } from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import * as styles from "./styles";
import { ALL_CHIP, BAR_FILL, TIER_CHIP, TILE, VIEW_BUTTON } from "./styles";

const tokens = (classes: string) => classes.split(/\s+/);

function everyClassString(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(everyClassString);
  return [];
}

describe("collection overview styles (collection-overview.md §6)", () => {
  it("carries no glow, gradient, glass, shadow, lift or scale outside the card frame (§6.6)", () => {
    for (const classes of everyClassString(styles)) {
      expect(classes).not.toMatch(/shadow|glow|gradient|backdrop-blur|translate|scale|animate-/);
    }
  });

  it("chips and view buttons are 40 px touch targets on a phone (§7)", () => {
    for (const rarity of RARITIES) {
      for (const state of ["pressed", "other"] as const) {
        expect(tokens(TIER_CHIP[rarity][state])).toEqual(
          expect.arrayContaining(["py-2.5", "leading-[18px]", "sm:py-1.5"]),
        );
      }
    }
    expect(tokens(ALL_CHIP.other)).toEqual(expect.arrayContaining(["py-2.5", "leading-[18px]", "sm:py-1.5"]));
    expect(tokens(VIEW_BUTTON.other)).toEqual(expect.arrayContaining(["min-h-10", "sm:min-h-0"]));
  });

  it("a pressed chip is filled, so pressed does not rest on hue alone", () => {
    for (const rarity of RARITIES) {
      expect(tokens(TIER_CHIP[rarity].pressed)).toContain(`bg-rarity-${rarity}/15`);
      expect(tokens(TIER_CHIP[rarity].other)).toContain("bg-transparent");
      expect(tokens(TIER_CHIP[rarity].other)).toContain(`text-rarity-${rarity}-text`);
    }
    expect(tokens(ALL_CHIP.pressed)).toContain("bg-zinc-800");
  });

  it("bars are neutral and their width change stops under reduced motion (§6.3, §6.5)", () => {
    expect(tokens(BAR_FILL)).toEqual(
      expect.arrayContaining([
        "bg-zinc-300",
        "transition-[width]",
        "duration-200",
        "motion-reduce:transition-none",
      ]),
    );
  });

  it("the tile does not move or lift on hover (§6.2)", () => {
    expect(TILE).not.toMatch(/hover:/);
  });
});
