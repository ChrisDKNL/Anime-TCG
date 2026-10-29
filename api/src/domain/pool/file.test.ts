import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { snapshotFile, snapshotText, standardPool } from "../../../test/fixtures/pool.js";
import { SnapshotRefused } from "./build.js";
import { readCapped, readSnapshotFile } from "./file.js";
import { PG_INTEGER_MAX, SNAPSHOT_FILE_MAX } from "./limits.js";
import {
  nestsDeeperThan,
  PageShapeError,
  parseCharactersPage,
  parseRelationsPage,
  parseSeriesPage,
} from "./pages.js";

const refusal = (text: string) => {
  try {
    readSnapshotFile(text);
  } catch (err) {
    if (err instanceof SnapshotRefused) return err.message;
    throw err;
  }
  throw new Error("the file was accepted");
};

describe("nestsDeeperThan", () => {
  it("counts arrays and objects, not brackets inside strings", () => {
    expect(nestsDeeperThan('{"a":[{"b":"[[[[{{{{"}]}', 3)).toBe(false);
    expect(nestsDeeperThan('{"a":[{"b":[1]}]}', 3)).toBe(true);
    expect(nestsDeeperThan('{"a":"\\"[[[[[[["}', 1)).toBe(false);
  });

  it("finds 10 000 levels without building them", () => {
    expect(nestsDeeperThan("[".repeat(10_000) + "]".repeat(10_000))).toBe(true);
    expect(nestsDeeperThan("[".repeat(32) + "]".repeat(32))).toBe(false);
  });
});

describe("readSnapshotFile", () => {
  it("reads the fixture builder's file into pages", () => {
    const { takenAt, input } = readSnapshotFile(snapshotText(standardPool()));
    expect(takenAt.toISOString()).toBe("2026-10-29T09:00:00.000Z");
    expect(input.series).toHaveLength(2);
    expect(input.characters.size).toBe(100);
  });

  it.each([
    ["text that is not JSON", "{ not json", "it is not valid JSON"],
    [
      "another format",
      JSON.stringify({ ...snapshotFile(standardPool()), format: "anime-tcg-snapshot/1" }),
      "/format",
    ],
    ["an unknown top-level field", JSON.stringify({ ...snapshotFile(standardPool()), extra: 1 }), "/extra"],
    [
      "a takenAt that is not a date-time",
      JSON.stringify({ ...snapshotFile(standardPool()), takenAt: "yesterday" }),
      "takenAt",
    ],
    [
      "a characters key that is not an id",
      JSON.stringify({ ...snapshotFile(standardPool()), characters: { abc: [] } }),
      "/characters",
    ],
    [
      "three series pages",
      JSON.stringify({ ...snapshotFile(standardPool()), series: [{}, {}, {}] }),
      "/series",
    ],
    [
      "a series page of the wrong shape",
      JSON.stringify({ ...snapshotFile(standardPool()), series: [{ data: {} }] }),
      "series[0] is not a series page",
    ],
    [
      "nesting 10 000 levels deep",
      `{"format":${"[".repeat(10_000)}${"]".repeat(10_000)}}`,
      "nests deeper than 32",
    ],
  ])("refuses %s with a one-line reason", (_label, text, reason) => {
    expect(refusal(text)).toContain(reason);
  });

  it("refuses a file over SNAPSHOT_FILE_MAX before parsing it", () => {
    expect(refusal(" ".repeat(SNAPSHOT_FILE_MAX + 1))).toContain(`larger than ${SNAPSHOT_FILE_MAX} bytes`);
  });
});

describe("readCapped", () => {
  it("returns the whole text under the cap", async () => {
    expect(await readCapped(Readable.from([Buffer.from("ab"), Buffer.from("cd")]), 4)).toBe("abcd");
  });

  it("refuses a stream over the cap without reading the rest", async () => {
    let pulled = 0;
    async function* endless() {
      for (;;) {
        pulled += 1;
        yield Buffer.alloc(1024);
      }
    }
    await expect(readCapped(endless(), 4096)).rejects.toThrow("larger than 4096 bytes");
    expect(pulled).toBe(5);
  });
});

describe("page parse", () => {
  it("keeps only the declared fields of an entry", () => {
    const page = parseSeriesPage({
      data: {
        Page: {
          pageInfo: { total: 5000 },
          media: [
            {
              id: 1,
              description: "dropped",
              siteUrl: "https://anilist.co/anime/1",
              title: { english: "A", romaji: "B", native: null, userPreferred: "dropped" },
              startDate: { year: 2000, month: 1 },
              popularity: 5,
              genres: ["Drama"],
              relations: {
                pageInfo: {},
                edges: [{ relationType: "SEQUEL", id: 9, node: { id: 2, type: "ANIME", title: {} } }],
              },
            },
          ],
        },
      },
    });
    expect(page).toEqual({
      data: {
        Page: {
          media: [
            {
              id: 1,
              title: { english: "A", romaji: "B", native: null },
              startDate: { year: 2000 },
              popularity: 5,
              genres: ["Drama"],
              relations: { edges: [{ relationType: "SEQUEL", node: { id: 2, type: "ANIME" } }] },
            },
          ],
        },
      },
    });
  });

  it("turns an entry or an edge of the wrong shape into null rather than refusing the page", () => {
    const page = parseSeriesPage({
      data: {
        Page: {
          media: [
            { id: "1" },
            7,
            {
              id: 3,
              title: { english: "C", romaji: null, native: null },
              startDate: null,
              popularity: 1,
              genres: [],
              relations: {
                edges: [
                  { relationType: "SEQUEL" },
                  { relationType: "SEQUEL", node: { id: 4, type: "ANIME" } },
                ],
              },
            },
          ],
        },
      },
    });
    const [first, second, third] = page.data.Page.media;
    expect([first, second]).toEqual([null, null]);
    expect(third?.relations?.edges).toEqual([
      null,
      { relationType: "SEQUEL", node: { id: 4, type: "ANIME" } },
    ]);
  });

  it("makes an item malformed when an id, popularity or favourites will not fit a Postgres integer", () => {
    const entry = (id: number, popularity: number) => ({
      id,
      title: { english: "A", romaji: null, native: null },
      startDate: null,
      popularity,
      genres: [],
      relations: { edges: [{ relationType: "SEQUEL", node: { id: PG_INTEGER_MAX + 1, type: "ANIME" } }] },
    });
    const series = parseSeriesPage({
      data: {
        Page: {
          media: [
            entry(PG_INTEGER_MAX + 1, 1),
            entry(1, PG_INTEGER_MAX + 1),
            entry(PG_INTEGER_MAX, PG_INTEGER_MAX),
          ],
        },
      },
    }).data.Page.media;
    expect(series.slice(0, 2)).toEqual([null, null]);
    expect(series[2]).toMatchObject({ id: PG_INTEGER_MAX, popularity: PG_INTEGER_MAX });
    expect(series[2]?.relations?.edges).toEqual([null]);

    const hops = parseRelationsPage({
      data: { Page: { media: [{ id: PG_INTEGER_MAX + 1, relations: null }] } },
    });
    expect(hops.data.Page.media).toEqual([null]);

    const character = (id: number, favourites: number) => ({
      role: "MAIN",
      node: { id, name: { full: "x", native: null }, image: null, favourites },
    });
    const characters = parseCharactersPage({
      data: {
        Media: {
          main: {
            pageInfo: { hasNextPage: false },
            edges: [
              character(PG_INTEGER_MAX + 1, 0),
              character(1, PG_INTEGER_MAX + 1),
              character(PG_INTEGER_MAX, PG_INTEGER_MAX),
            ],
          },
          supporting: { pageInfo: { hasNextPage: false }, edges: [] },
        },
      },
    }).data.Media.main.edges;
    expect(characters.slice(0, 2)).toEqual([null, null]);
    expect(characters[2]?.node).toMatchObject({ id: PG_INTEGER_MAX, favourites: PG_INTEGER_MAX });
  });

  it("refuses a series page of more than 50 entries and a characters page without both roles", () => {
    expect(() => parseSeriesPage({ data: { Page: { media: Array(51).fill(null) } } })).toThrow(
      PageShapeError,
    );
    expect(() =>
      parseCharactersPage({ data: { Media: { main: { pageInfo: { hasNextPage: false }, edges: [] } } } }),
    ).toThrow(PageShapeError);
  });

  it("reads at most 25 character edges per role and page", () => {
    const edge = {
      role: "MAIN",
      node: { id: 1, name: { full: "x", native: null }, image: null, favourites: 0 },
    };
    const page = parseCharactersPage({
      data: {
        Media: {
          main: { pageInfo: { hasNextPage: true }, edges: Array(40).fill(edge) },
          supporting: { pageInfo: { hasNextPage: false }, edges: [] },
        },
      },
    });
    expect(page.data.Media.main.edges).toHaveLength(25);
    expect(page.data.Media.main.pageInfo.hasNextPage).toBe(true);
  });
});
