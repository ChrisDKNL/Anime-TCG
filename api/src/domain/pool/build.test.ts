import { describe, expect, it } from "vitest";
import {
  type FixtureCharacter,
  type FixtureEntry,
  type FixturePool,
  imageUrl,
  snapshotFile,
  snapshotText,
  standardPool,
} from "../../../test/fixtures/pool.js";
import { buildSnapshot, SnapshotRefused } from "./build.js";
import { readSnapshotFile } from "./file.js";
import { tierCounts } from "./tiers.js";

const build = (pool: FixturePool) => buildSnapshot(readSnapshotFile(snapshotText(pool)).input);

/** The standard pool with entry `index` (0-based) changed. */
function withEntry(index: number, change: Partial<FixtureEntry>): FixturePool {
  const pool = standardPool();
  const entry = pool.entries[index];
  if (entry === undefined) throw new Error("no such entry");
  pool.entries[index] = { ...entry, ...change };
  return pool;
}

/** The standard pool with character `index` (0-based) changed. */
function withCharacter(index: number, change: Partial<FixtureCharacter>): FixturePool {
  const pool = standardPool();
  const character = pool.characters[index];
  if (character === undefined) throw new Error("no such character");
  pool.characters[index] = { ...character, ...change };
  return pool;
}

const ENTRY = 900_001;
const NEIGHBOUR = 900_002;
const CHARACTER = 800_001;

describe("buildSnapshot from a good pool", () => {
  it("keeps every entry and character, in one franchise each, with the tier split of §5.1.4", () => {
    const plan = build(standardPool());
    expect(plan.entries).toHaveLength(100);
    expect(plan.franchises).toHaveLength(100);
    expect(plan.characters).toHaveLength(600);
    expect(plan.tierCounts).toEqual(tierCounts(600));
    expect(plan.skipped.items).toBe(0);
    expect(plan.entries[0]).toEqual({
      id: ENTRY,
      title: "Series 1",
      titleNative: null,
      startYear: 2013,
      popularity: 1_000,
      genres: ["Action"],
      popularityRank: 1,
      franchiseId: ENTRY,
    });
    const top = plan.characters.find((character) => character.id === CHARACTER);
    expect(top).toEqual({
      id: CHARACTER,
      name: `Character ${CHARACTER}`,
      nameNative: null,
      imageUrl: imageUrl(CHARACTER),
      favourites: 6_000,
      favouritesRank: 1,
      tier: "mythic",
      primarySeriesId: ENTRY,
      memberships: [{ seriesId: ENTRY, role: "main" }],
    });
  });
});

describe("entry validation (collection-packs.md §5.1.6), each rule with a valid neighbour", () => {
  const cases: [string, Partial<FixtureEntry>, string][] = [
    [
      "an id below 1",
      {
        raw: {
          id: 0,
          title: { english: "Zero", romaji: null, native: null },
          startDate: { year: 2000 },
          popularity: 1,
          genres: [],
          relations: { edges: [] },
        },
      },
      "entry:id",
    ],
    [
      "a string id",
      { raw: { id: "900001", title: { english: "x", romaji: null, native: null } } },
      "entry:malformed",
    ],
    ["no title at all", { title: null, romaji: null }, "entry:title"],
    ["a blank title and no romaji", { title: "   ", romaji: null }, "entry:title"],
    ["a title of 301 characters", { title: "t".repeat(301) }, "entry:title"],
    ["a native title of 301 characters", { native: "n".repeat(301) }, "entry:title"],
    [
      "an English title of 301 characters beside a valid romaji one",
      { title: "t".repeat(301), romaji: "Ok" },
      "entry:title",
    ],
    ["a start year of 1899", { year: 1899 }, "entry:year"],
    ["a start year of 2101", { year: 2101 }, "entry:year"],
    ["a fractional start year", { year: 2001.5 }, "entry:malformed"],
    ["a negative popularity", { popularity: -1 }, "entry:popularity"],
    ["a null popularity", { popularity: null }, "entry:popularity"],
    ["21 genres", { genres: Array.from({ length: 21 }, (_, i) => `G${i}`) }, "entry:genres"],
    ["an empty genre", { genres: [""] }, "entry:genres"],
    ["a genre of 51 characters", { genres: ["g".repeat(51)] }, "entry:genres"],
    ["genres that are not an array", { genres: "Action" }, "entry:malformed"],
    ["a NUL in the title", { title: "Bad\u0000Title" }, "entry:nul"],
    ["a NUL in a genre", { genres: ["Ac\u0000tion"] }, "entry:nul"],
  ];

  it.each(cases)(
    "skips an entry with %s, and its characters, keeping the next one",
    (_label, change, reason) => {
      const plan = build(withEntry(0, change));
      expect(plan.skipped.byReason()).toEqual({ [reason]: 1 });
      expect(plan.entries.map((entry) => entry.id)).not.toContain(ENTRY);
      expect(plan.entries.map((entry) => entry.id)).toContain(NEIGHBOUR);
      expect(
        plan.characters.some((character) => character.memberships.some((m) => m.seriesId === ENTRY)),
      ).toBe(false);
      expect(plan.characters).toHaveLength(594);
    },
  );

  it.each([
    ["a title of exactly 300 characters", { title: "t".repeat(300) }],
    ["the romaji title when there is no English one", { title: null, romaji: "Shingeki no Kyojin" }],
    ["a start year of 1900", { year: 1900 }],
    ["a start year of 2100", { year: 2100 }],
    ["no start year", { year: null }],
    ["a popularity of 0", { popularity: 0 }],
    ["20 genres of 50 characters", { genres: Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(50, "g")) }],
    ["no genres", { genres: [] }],
  ])("accepts %s", (_label, change) => {
    const plan = build(withEntry(0, change));
    expect(plan.skipped.items).toBe(0);
    expect(plan.entries[0]?.id).toBe(ENTRY);
  });

  it("trims the title, takes romaji when English is blank, and keeps strings otherwise as sent", () => {
    const plan = build(withEntry(0, { title: "  ", romaji: "  <b>Ro</b>maji ‮  ", native: " 進撃 " }));
    expect(plan.entries[0]).toMatchObject({ title: "<b>Ro</b>maji ‮", titleNative: "進撃" });
  });

  it("skips an id repeated across pages, keeping its first appearance", () => {
    const pool = standardPool();
    const duplicate = pool.entries[60];
    if (duplicate === undefined) throw new Error("fixture too small");
    pool.entries[60] = { ...duplicate, id: ENTRY, title: "Again" };
    const plan = build(pool);
    expect(plan.skipped.byReason()).toMatchObject({ "entry:duplicate_id": 1 });
    expect(plan.entries.filter((entry) => entry.id === ENTRY)).toEqual([
      expect.objectContaining({ title: "Series 1", popularityRank: 1 }),
    ]);
  });

  it("skips an entry with no accepted character", () => {
    const pool = standardPool();
    pool.characters = pool.characters.filter((character) => !character.in.some((m) => m.entry === ENTRY));
    pool.characters.push(
      ...standardPool({ characters: 6, characterBase: 700_000, entries: 1, entryBase: 900_001 }).characters,
    );
    const plan = build(pool);
    expect(plan.skipped.byReason()).toEqual({ "entry:no_characters": 1 });
    expect(plan.entries.map((entry) => entry.id)).not.toContain(ENTRY);
  });
});

describe("character validation, each rule with a valid neighbour", () => {
  const cases: [string, Partial<FixtureCharacter>, string][] = [
    ["an id below 1", { id: 0 }, "character:id"],
    ["no name", { name: null }, "character:name"],
    ["a blank name", { name: "   " }, "character:name"],
    ["a name of 201 characters", { name: "n".repeat(201) }, "character:name"],
    ["a native name of 201 characters", { native: "n".repeat(201) }, "character:name"],
    ["no image", { image: null }, "character:image"],
    ["an http image", { image: "http://s4.anilist.co/file/a.png" }, "character:image"],
    [
      "an image on a look-alike host",
      { image: "https://s4.anilist.co.evil.example/a.png" },
      "character:image",
    ],
    ["an image with userinfo", { image: "https://user@s4.anilist.co/a.png" }, "character:image"],
    ["an image with a port", { image: "https://s4.anilist.co:8443/a.png" }, "character:image"],
    ["a javascript: image", { image: "javascript:alert(1)" }, "character:image"],
    ["a data: image", { image: "data:image/png;base64,AAAA" }, "character:image"],
    ["an image on another AniList host", { image: "https://img.anilist.co/a.png" }, "character:image"],
    ["an image URL with a space", { image: "https://s4.anilist.co/a b.png" }, "character:image"],
    [
      "an image URL of 2 049 characters",
      { image: `https://s4.anilist.co/${"a".repeat(2_027)}` },
      "character:image",
    ],
    ["negative favourites", { favourites: -1 }, "character:favourites"],
    ["string favourites", { favourites: "10" }, "character:malformed"],
    ["a NUL in the name", { name: "Ere\u0000n" }, "character:nul"],
    ["a NUL in the image URL", { image: `${imageUrl(1)}\u0000` }, "character:nul"],
  ];

  it.each(cases)("skips a character with %s, keeping the next one", (_label, change, reason) => {
    const plan = build(withCharacter(0, change));
    expect(plan.skipped.byReason()).toEqual({ [reason]: 1 });
    expect(plan.characters).toHaveLength(599);
    expect(plan.characters.map((character) => character.id)).toContain(CHARACTER + 1);
  });

  it("skips a BACKGROUND appearance, which is no membership", () => {
    const plan = build(withCharacter(0, { in: [{ entry: ENTRY, role: "BACKGROUND" }] }));
    expect(plan.skipped.byReason()).toEqual({ "character:role": 1 });
    expect(plan.characters.map((character) => character.id)).not.toContain(CHARACTER);
  });

  it("counts null favourites as 0", () => {
    const plan = build(withCharacter(0, { favourites: null }));
    expect(plan.characters.find((character) => character.id === CHARACTER)?.favourites).toBe(0);
  });

  it("accepts a name of exactly 200 characters and keeps hostile strings as text, trimmed only", () => {
    const hostile = ' <script>alert("x")</script><img src=x onerror=alert(1)>‮​ ';
    const plan = build(withCharacter(0, { name: "n".repeat(200), native: hostile }));
    expect(plan.characters.find((character) => character.id === CHARACTER)).toMatchObject({
      name: "n".repeat(200),
      nameNative: hostile.trim(),
    });
  });

  it("accepts a character listed under several entries once, merging memberships and keeping its first appearance", () => {
    const pool = standardPool();
    pool.characters[0] = {
      id: CHARACTER,
      favourites: 6_000,
      name: "First",
      in: [
        { entry: 900_050, role: "SUPPORTING" },
        { entry: ENTRY, role: "MAIN" },
        { entry: 900_003, role: "SUPPORTING" },
      ],
    };
    const plan = build(pool);
    const character = plan.characters.find((c) => c.id === CHARACTER);
    expect(character?.memberships).toEqual([
      { seriesId: ENTRY, role: "main" },
      { seriesId: 900_003, role: "supporting" },
      { seriesId: 900_050, role: "supporting" },
    ]);
    expect(character?.primarySeriesId).toBe(ENTRY);
    expect(plan.differingAppearances).toBe(0);
  });

  it("counts a later appearance that differs, without rejecting it", () => {
    const pool = standardPool();
    const file = snapshotFile({
      ...pool,
      characters: [...pool.characters, { id: CHARACTER, name: "Renamed", in: [{ entry: 900_050 }] }],
    });
    const plan = buildSnapshot(readSnapshotFile(JSON.stringify(file)).input);
    const character = plan.characters.find((c) => c.id === CHARACTER);
    expect(character?.name).toBe(`Character ${CHARACTER}`);
    expect(character?.memberships.map((m) => m.seriesId)).toEqual([ENTRY, 900_050]);
    expect(plan.differingAppearances).toBe(1);
  });
});

describe("relation edges", () => {
  it("drops and counts an unknown relation type, ignores a non-anime node, and reads at most 200 edges", () => {
    const relations = [
      { type: "TELEPORT", to: NEIGHBOUR },
      { type: "SEQUEL", to: 77, nodeType: "MANGA" },
      ...Array.from({ length: 10_000 }, (_, i) => ({ type: "SEQUEL", to: 1_000_000 + i })),
    ];
    const plan = build(withEntry(0, { relations }));
    expect(plan.skipped.byReason()).toEqual({ "edge:relation_type": 1 });
    expect(plan.edges.filter((edge) => edge.fromId === ENTRY)).toHaveLength(198);
    expect(plan.franchises).toHaveLength(100);
  });

  it("merges two entries joined through an entry outside the top 100 read by the hop requests", () => {
    const pool = withEntry(0, { relations: [{ type: "SEQUEL", to: 5 }] });
    pool.hops = [{ id: 5, relations: [{ type: "SEQUEL", to: 900_010 }] }];
    const plan = build(pool);
    expect(plan.franchises).toHaveLength(99);
    expect(plan.entries.find((entry) => entry.id === 900_010)?.franchiseId).toBe(ENTRY);
    expect(plan.edges).toEqual([
      { fromId: 5, toId: 900_010, relationType: "SEQUEL" },
      { fromId: ENTRY, toId: 5, relationType: "SEQUEL" },
    ]);
  });
});

describe("refusals (collection-packs.md §5.1.7 step 1)", () => {
  const refused = (pool: FixturePool) => expect(() => build(pool)).toThrow(SnapshotRefused);

  it("refuses SNAPSHOT_SERIES_MIN - 1 valid entries and accepts SNAPSHOT_SERIES_MIN", () => {
    refused(standardPool({ entries: 89 }));
    expect(() => build(standardPool({ entries: 89 }))).toThrow("Only 89 valid entries, fewer than 90.");
    expect(build(standardPool({ entries: 90 })).entries).toHaveLength(90);
  });

  it("refuses SNAPSHOT_CHARACTERS_MIN - 1 valid characters and accepts SNAPSHOT_CHARACTERS_MIN", () => {
    expect(() => build(standardPool({ characters: 499 }))).toThrow(
      "Only 499 valid characters, fewer than 500.",
    );
    expect(build(standardPool({ characters: 500 })).tierCounts.mythic).toBe(5);
  });

  it("refuses more than SNAPSHOT_CHARACTERS_MAX and accepts exactly that many", () => {
    expect(() => build(standardPool({ characters: 6_001 }))).toThrow(
      "6001 valid characters, more than 6000.",
    );
    expect(build(standardPool({ characters: 6_000 })).characters).toHaveLength(6_000);
  });

  it("refuses hops that needed more than FRANCHISE_MAX_REQUESTS relation requests", () => {
    const pool = standardPool();
    pool.hops = Array.from({ length: 41 * 50 }, (_, i) => ({ id: 1 + i, relations: [] }));
    expect(() => build(pool)).toThrow("needed 41 relation requests, more than 40");
    pool.hops = pool.hops.slice(0, 40 * 50);
    expect(build(pool).entries).toHaveLength(100);
  });
});
