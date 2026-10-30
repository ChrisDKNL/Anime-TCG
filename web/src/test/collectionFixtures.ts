import type { CollectionResponse } from "@anime-tcg/shared/api";
import { makeCharacter, makeCollection, makeEntry, makeFranchise } from "./fixtures";

/**
 * A small collection with every case the overview draws: native names and
 * titles, a character in two series, two series sharing a title, a series
 * with nothing owned, a character the snapshot dropped (its series gone with
 * it), and one whose tier moved since it was dealt.
 */
export function makeOverviewCollection(): CollectionResponse {
  const data = makeCollection([
    makeEntry(
      makeCharacter(1, {
        name: "Spike Spiegel",
        nameNative: "スパイク・スピーゲル",
        franchiseIds: [100],
        tier: "epic",
        rank: 12,
      }),
      { count: 3, firstObtainedAt: "2026-10-01T09:00:00.000Z", lastObtainedAt: "2026-10-20T09:00:00.000Z" },
    ),
    makeEntry(makeCharacter(2, { name: "Pikachu", franchiseIds: [101, 100], tier: "common", rank: 900 }), {
      lastObtainedAt: "2026-10-25T09:00:00.000Z",
    }),
    makeEntry(makeCharacter(3, { name: "Gon Freecss", franchiseIds: [102, 103], tier: "rare", rank: 300 }), {
      count: 2,
    }),
    makeEntry(
      makeCharacter(4, {
        name: "Old Hero",
        franchiseIds: [105],
        tier: null,
        rank: null,
        inCurrentSnapshot: false,
      }),
      { rarity: "uncommon" },
    ),
    makeEntry(makeCharacter(5, { name: "Moved Star", franchiseIds: [101], tier: "rare", rank: 40 }), {
      rarity: "legendary",
    }),
  ]);
  data.franchises = [
    makeFranchise(100, { title: "Cowboy Bebop", titleNative: "カウボーイビバップ", startYear: 1998 }),
    makeFranchise(101, { title: "Pokémon", titleNative: "ポケットモンスター", startYear: 1997 }),
    makeFranchise(102, { title: "Hunter x Hunter", startYear: 2011 }),
    makeFranchise(103, { title: "Hunter x Hunter", startYear: 1999 }),
    makeFranchise(104, { title: "Bleach", startYear: 2004 }),
    makeFranchise(105, { title: "Lost Saga", startYear: 1985 }),
  ];
  data.completion = {
    pool: { owned: 4, total: 2_983 },
    franchises: [
      { franchiseId: 104, owned: 0, total: 12 },
      { franchiseId: 100, owned: 2, total: 4 },
      { franchiseId: 101, owned: 2, total: 9 },
      { franchiseId: 102, owned: 1, total: 9 },
      { franchiseId: 103, owned: 1, total: 9 },
    ],
  };
  return data;
}

/** `n` Common entries named `Card 0001` … in franchise 100, for paging and size tests. */
export function makeLargeCollection(n: number): CollectionResponse {
  const data = makeCollection(
    Array.from({ length: n }, (_, i) =>
      makeEntry(
        makeCharacter(10_000 + i, {
          name: `Card ${String(i + 1).padStart(4, "0")}`,
          franchiseIds: [100],
          tier: "common",
        }),
      ),
    ),
  );
  data.franchises = [makeFranchise(100, { title: "Big Series" })];
  data.completion = {
    pool: { owned: n, total: 6_000 },
    franchises: [{ franchiseId: 100, owned: n, total: 6_000 }],
  };
  return data;
}
