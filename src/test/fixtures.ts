import type { Card, Character } from "../types";

/** Deterministic character pool for tests; favourites decrease with index. */
export function makeCharacters(count = 10): Character[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    name: `Character ${i}`,
    imageUrl: `https://s4.anilist.co/fixture/${i}.png`,
    animeTitle: `Anime ${i}`,
    animeTitleNative: `アニメ ${i}`,
    favourites: Math.round(40000 / (i + 1)),
  }));
}

export function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    uid: "uid-1",
    characterId: 1000,
    name: "Character 0",
    imageUrl: "https://s4.anilist.co/fixture/0.png",
    animeTitle: "Anime 0",
    animeTitleNative: "アニメ 0",
    rarity: "common",
    pulledAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Shape of an AniList `CharacterPool` GraphQL response for `count` characters. */
export function makeAniListResponse(count = 10, hasNextPage = false) {
  return {
    data: {
      Page: {
        pageInfo: { hasNextPage },
        characters: makeCharacters(count).map((c) => ({
          id: c.id,
          favourites: c.favourites,
          name: { full: c.name },
          image: { large: c.imageUrl },
          media: { nodes: [{ title: { english: c.animeTitle, native: c.animeTitleNative, romaji: null } }] },
        })),
      },
    },
  };
}
