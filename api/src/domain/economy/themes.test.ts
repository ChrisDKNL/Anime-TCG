import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { PITY_PACKS, RADIANT_ODDS, RARITIES, type Rarity } from "@anime-tcg/shared/rarity";
import { describe, expect, it } from "vitest";
import { countersAfter, planPack } from "../packs/roll.js";
import { sameShopRequest } from "./shop.js";
import { buildThemes, eligible, type FranchiseMember, type GenreMember, genreSlug } from "./themes.js";

/** `perTier` characters of every tier in `genre`, ids from `base`, each in franchise `base + tier index`. */
function members(genre: string, base: number, perTier: number | Partial<Record<Rarity, number>>) {
  const genres: GenreMember[] = [];
  const franchises: FranchiseMember[] = [];
  RARITIES.forEach((tier, t) => {
    const n = typeof perTier === "number" ? perTier : (perTier[tier] ?? PACK_SIZE);
    for (let i = 0; i < n; i += 1) {
      const characterId = base + t * 100 + i;
      genres.push({ characterId, tier, genre });
      franchises.push({ characterId, franchiseId: base + t, popularityRank: 10 - t });
    }
  });
  return { genres, franchises };
}

describe("genre slugs (economy.md §8.6)", () => {
  it.each([
    ["Action", "action"],
    ["Slice of Life", "slice-of-life"],
    ["Sci-Fi", "sci-fi"],
    ["  Mahou  Shoujo! ", "mahou-shoujo"],
    ["<script>alert(1)</script>", "script-alert-1-script"],
    ["‮emoh", "emoh"],
    ["進撃", null],
    ["!!!", null],
  ])("%j becomes %j", (genre, slug) => {
    expect(genreSlug(genre)).toBe(slug);
  });
});

describe("genre themes", () => {
  it("offers a genre exactly when each of the six tiers holds a pack's worth", () => {
    const sizes = { common: 5, uncommon: 5, rare: 5, epic: 5, legendary: 5, mythic: 5 };
    expect(eligible(sizes)).toBe(true);
    for (const tier of RARITIES) expect(eligible({ ...sizes, [tier]: PACK_SIZE - 1 }), tier).toBe(false);
  });

  it("builds one theme per eligible genre, ordered by id, with its set per tier ordered by id", () => {
    const action = members("Action", 1_000, 6);
    const comedy = members("Comedy", 5_000, 5);
    const sports = members("Sports", 9_000, { mythic: 1 });
    const themes = buildThemes(
      [...comedy.genres, ...sports.genres, ...[...action.genres].reverse()],
      [...action.franchises, ...comedy.franchises, ...sports.franchises],
    );
    expect(themes.map((theme) => [theme.id, theme.title])).toEqual([
      ["genre-action", "Action"],
      ["genre-comedy", "Comedy"],
    ]);
    const [first] = themes;
    expect(first?.tierSizes).toEqual({ common: 6, uncommon: 6, rare: 6, epic: 6, legendary: 6, mythic: 6 });
    expect(first?.tiers.mythic).toEqual([1_500, 1_501, 1_502, 1_503, 1_504, 1_505]);
  });

  it("draws across franchises: every franchise with a character in the set, most popular first", () => {
    const action = members("Action", 1_000, 5);
    const [theme] = buildThemes(action.genres, action.franchises);
    // popularityRank is 10 - tier index, so Mythic's franchise (1 005) is the most popular.
    expect(theme?.franchiseIds).toEqual([1_005, 1_004, 1_003, 1_002, 1_001, 1_000]);
  });

  it("counts a character once per genre however many of its entries carry it, at its tier", () => {
    const action = members("Action", 1_000, 5);
    const [theme] = buildThemes([...action.genres, ...action.genres], action.franchises);
    expect(theme?.tierSizes.common).toBe(5);
  });

  it("offers neither of two genres whose slugs collide, nor a genre with no slug or an id too long to buy", () => {
    const one = members("Sci-Fi", 1_000, 5);
    const two = members("Sci Fi", 2_000, 5);
    const symbols = members("???", 3_000, 5);
    const long = members("x".repeat(59), 4_000, 5);
    const fits = members("y".repeat(58), 6_000, 5);
    const themes = buildThemes(
      [...one.genres, ...two.genres, ...symbols.genres, ...long.genres, ...fits.genres],
      [],
    );
    expect(themes.map((theme) => theme.id)).toEqual([`genre-${"y".repeat(58)}`]);
  });

  it("keeps a hostile genre name as the title, to be rendered as text", () => {
    const hostile = members("<script>‮", 1_000, 5);
    const [theme] = buildThemes(hostile.genres, hostile.franchises);
    expect(theme).toMatchObject({ id: "genre-script", title: "<script>‮" });
  });
});

describe("a shop pack's plan (collection-packs.md §5.4.7, economy.md §8.6)", () => {
  const due = { packsSinceMythic: PITY_PACKS - 1, freePacksOpened: 9 };

  it("is Radiant below RADIANT_ODDS, from the theme's own tiers, as any pack", () => {
    expect(planPack(due, "shop", () => RADIANT_ODDS - 1).kind).toBe("radiant");
    expect(planPack(due, "shop", () => RADIANT_ODDS).kind).toBe("standard");
  });

  it("is never Enchanted or pity-due, whatever the counters say", () => {
    const plan = planPack(due, "shop", () => RADIANT_ODDS);
    expect(plan).toMatchObject({ kind: "standard", pity: false });
    expect(planPack(due, "free", () => RADIANT_ODDS)).toMatchObject({ kind: "enchanted", pity: true });
  });

  it("leaves both counters unchanged, while a Mythic from it resets packs_since_mythic", () => {
    const counters = { packsSinceMythic: 123, freePacksOpened: 45 };
    expect(countersAfter(counters, "shop", ["common", "common", "common", "uncommon", "rare"])).toEqual(
      counters,
    );
    expect(countersAfter(counters, "shop", ["epic", "epic", "epic", "epic", "mythic"])).toEqual({
      packsSinceMythic: 0,
      freePacksOpened: 45,
    });
  });
});

describe("canonical request matching for a shop purchase (economy.md §8.8)", () => {
  it("matches a shop opening of the same theme only; a timer opening never matches", () => {
    const shop = { shop: { themeId: "genre-action", price: 400 } };
    expect(sameShopRequest(shop, "genre-action")).toBe(true);
    expect(sameShopRequest(shop, "genre-comedy")).toBe(false);
    expect(sameShopRequest({ shop: null }, "genre-action")).toBe(false);
  });
});
