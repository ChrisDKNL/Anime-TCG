import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { asc, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { describeOutcome, main, snapshotFromAniList, snapshotFromFile } from "../src/cli/snapshot-pool.js";
import {
  poolFetches,
  poolFetchPages,
  poolSnapshotCharacters,
  poolSnapshotMemberships,
  poolSnapshotSeries,
  poolSnapshots,
} from "../src/db/schema.js";
import { AniListClient } from "../src/domain/pool/anilist.js";
import { exportSnapshot } from "../src/domain/pool/export.js";
import { FetchPaused } from "../src/domain/pool/fetch.js";
import { ANILIST_DEFAULT_RETRY_AFTER_MS, ANILIST_MAX_BODY } from "../src/domain/pool/limits.js";
import { createLogger } from "../src/plugins/logging.js";
import { type FakeAniList, faults, startFakeAniList } from "./fixtures/anilist-server.js";
import { type FixturePool, snapshotText, standardPool } from "./fixtures/pool.js";
import {
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  getCollection,
  getPacks,
  newPlayer,
  openPack,
} from "./pool-support.js";
import { createTestApp, send, testConfig, testDatabaseUrl } from "./support.js";

const GAP = 2_500;
const silent: Logger = createLogger("silent");
const apiDir = fileURLToPath(new URL("..", import.meta.url));

/**
 * The standard pool plus what exercises the fetch plan: entry 1 reaches
 * entry 10 through two entries outside the top 100 (one hop round each),
 * and entry 50 has 31 MAIN characters, so it needs a second page.
 */
function fetchPool(): FixturePool {
  const pool = standardPool();
  pool.entries[0] = { id: 900_001, title: "Series 1", relations: [{ type: "SEQUEL", to: 5 }] };
  pool.hops = [
    { id: 5, relations: [{ type: "SEQUEL", to: 6 }] },
    { id: 6, relations: [{ type: "SEQUEL", to: 900_010 }] },
  ];
  for (let i = 1; i <= 25; i += 1) {
    pool.characters.push({ id: 700_000 + i, favourites: 1, in: [{ entry: 900_050 }] });
  }
  return pool;
}
/** 2 entry pages, 2 hop rounds of one batch, 99 entries of one character page and entry 50 with two. */
const FETCH_REQUESTS = 2 + 2 + 101;

/** A clock that only moves when the client sleeps, so every wait it asks for is recorded exactly. */
function virtualTime() {
  let now = Date.parse("2026-10-29T08:00:00.000Z");
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

const failures = (count: number, fault: () => NonNullable<Parameters<FakeAniList["failNext"]>[0]>) =>
  Array.from({ length: count }, fault);

describe("snapshot-pool against a local AniList stand-in (collection-packs.md §5.1.5, §7.1)", () => {
  let app: App;
  let fake: FakeAniList;
  const snapshots: number[] = [];
  const made: string[] = [];

  const client = (time = virtualTime(), timeoutMs = 2_000) =>
    new AniListClient({ endpoint: fake.url, sleep: time.sleep, now: time.now, timeoutMs });
  const take = async (aniList: AniListClient, options = { dryRun: false, restart: false }) => {
    const outcome = await snapshotFromAniList(app.db, aniList, options, silent);
    if (!outcome.summary.dryRun) snapshots.push(outcome.summary.version);
    return outcome;
  };
  const stagedPages = async () => (await app.db.select().from(poolFetchPages)).length;

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }) });
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    fake = await startFakeAniList(fetchPool());
  });
  afterEach(async () => {
    fake.requests.length = 0;
    await app.db.delete(poolFetches);
  });
  afterAll(async () => {
    await fake.close();
    await deleteAccounts(app.db, made);
    await deleteSnapshots(app.db, snapshots);
    await app.close();
  });

  it("fetches every page at the pace, hops twice, builds and activates, and clears the staging rows", async () => {
    const time = virtualTime();
    const outcome = await take(client(time));
    expect(outcome.requests).toBe(FETCH_REQUESTS);
    expect(fake.requests.map((request) => request.kind).slice(0, 5)).toEqual([
      "series",
      "series",
      "relations",
      "relations",
      "characters",
    ]);
    expect(fake.requests[2]?.variables).toEqual({ ids: [5] });
    expect(fake.requests[3]?.variables).toEqual({ ids: [6] });
    expect(
      fake.requests
        .filter((request) => request.variables.id === 900_050)
        .map((request) => request.variables.page),
    ).toEqual([1, 2]);
    // One request per gap, and nothing else waited for.
    expect(time.sleeps).toEqual(Array<number>(FETCH_REQUESTS - 1).fill(GAP));

    expect(outcome.summary).toMatchObject({ entries: 100, characters: 625, skipped: 0, dryRun: false });
    expect(outcome.summary.franchises).toHaveLength(99);
    expect(await currentSnapshotId(app.db)).toBe(outcome.summary.version);
    const [row] = await app.db
      .select()
      .from(poolSnapshots)
      .where(eq(poolSnapshots.id, outcome.summary.version));
    expect(row).toMatchObject({
      source: "anilist",
      seriesCount: 100,
      franchiseCount: 99,
      characterCount: 625,
    });
    expect(await stagedPages()).toBe(0);
    expect(describeOutcome(outcome)).toEqual([
      `Snapshot ${outcome.summary.version} active: 100 entries in 99 franchises, 625 characters ` +
        "(6 mythic, 25 legendary, 63 epic, 156 rare, 375 common); 0 skipped; 0 changed tier, 0 dropped, 625 added; " +
        `${FETCH_REQUESTS} AniList requests.`,
    ]);
  });

  it("is never called by the api server: a whole round of route calls sends the stand-in nothing", async () => {
    const player = await newPlayer(app, "sn");
    made.push(player.account.id);
    const calls = [
      () => send(app, { method: "GET", url: "/api/session", cookie: player.cookie }),
      () => getPacks(app, player.cookie),
      () => openPack(app, player.cookie),
      () => getCollection(app, player.cookie),
      () => send(app, { method: "GET", url: "/healthz" }),
    ];
    for (const call of calls) expect((await call()).statusCode).toBeLessThan(300);
    expect(fake.requests).toEqual([]);
  });

  it("waits a 429's Retry-After, or ANILIST_DEFAULT_RETRY_AFTER without one, and retries the same request", async () => {
    const time = virtualTime();
    fake.failNext(faults.status(429, { "retry-after": "7" }), faults.status(429));
    const outcome = await take(client(time), { dryRun: true, restart: false });
    expect(outcome.requests).toBe(FETCH_REQUESTS + 2);
    expect(time.sleeps.slice(0, 2)).toEqual([7_000, ANILIST_DEFAULT_RETRY_AFTER_MS]);
    expect(fake.requests.slice(0, 3).map((request) => request.variables)).toEqual([
      { page: 1 },
      { page: 1 },
      { page: 1 },
    ]);
  });

  it.each([
    ["a 500", () => faults.status(500)],
    ["a stall past the timeout", () => faults.stall()],
    ["a body over ANILIST_MAX_BODY", () => faults.oversized(ANILIST_MAX_BODY)],
    ["invalid JSON", () => faults.invalidJson()],
    ["a GraphQL errors answer", () => faults.graphqlErrors()],
  ])("backs off 2 s after %s and retries the same request", async (_label, fault) => {
    const time = virtualTime();
    fake.failNext(null, null, fault());
    const outcome = await take(client(time, 300), { dryRun: true, restart: false });
    expect(outcome.requests).toBe(FETCH_REQUESTS + 1);
    expect(fake.requests.slice(2, 4).map((request) => request.variables)).toEqual([
      { ids: [5] },
      { ids: [5] },
    ]);
    // The gap before the failed request, the 2 s backoff, then what is left of the gap before the retry.
    expect(time.sleeps.slice(0, 4)).toEqual([GAP, GAP, 2_000, GAP - 2_000]);
  });

  it("pauses after ANILIST_MAX_RETRIES retries of one request, keeps its pages, and resumes at the first missing one", async () => {
    const time = virtualTime();
    fake.failNext(null, null, ...failures(6, () => faults.status(500)));
    const paused: unknown = await take(client(time)).catch((err: unknown) => err);
    expect(paused).toBeInstanceOf(FetchPaused);
    expect(paused instanceof Error && paused.message).toMatch(
      /^Paused after 2 of about \d+ requests; run again to resume\.$/,
    );
    expect(fake.requests).toHaveLength(8);
    expect(time.sleeps.filter((ms) => ms !== GAP && ms !== GAP - 2_000)).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000,
    ]);
    expect(await stagedPages()).toBe(2);
    const [fetch] = await app.db.select().from(poolFetches);

    fake.requests.length = 0;
    const resumed = await take(client(), { dryRun: true, restart: false });
    expect(fake.requests.some((request) => request.kind === "series")).toBe(false);
    expect(fake.requests[0]).toEqual({ kind: "relations", variables: { ids: [5] } });
    expect(resumed.requests).toBe(FETCH_REQUESTS - 2);
    const [same] = await app.db.select().from(poolFetches);
    expect(same?.id).toBe(fetch?.id);
  });

  it("starts over when the unfinished fetch began more than FETCH_RESUME_MAX_AGE ago, and on --restart", async () => {
    fake.failNext(null, null, ...failures(6, () => faults.status(503)));
    await expect(take(client())).rejects.toThrow(FetchPaused);
    await app.db.update(poolFetches).set({ startedAt: new Date(Date.now() - 25 * 60 * 60_000) });
    fake.requests.length = 0;
    await take(client(), { dryRun: true, restart: false });
    expect(fake.requests[0]?.kind).toBe("series");
    expect(fake.requests).toHaveLength(FETCH_REQUESTS);

    fake.requests.length = 0;
    await take(client(), { dryRun: true, restart: true });
    expect(fake.requests).toHaveLength(FETCH_REQUESTS);
  });

  it("stops at once on a 400, without retrying", async () => {
    fake.failNext(faults.status(400));
    await expect(take(client())).rejects.toThrow(
      "AniList refused the request (HTTP 400); nothing more was fetched.",
    );
    expect(fake.requests).toHaveLength(1);
  });

  it("writes no snapshot on --dry-run and keeps the staging rows for the next run", async () => {
    const before = await app.db.select({ id: poolSnapshots.id }).from(poolSnapshots);
    const current = await currentSnapshotId(app.db);
    const outcome = await take(client(), { dryRun: true, restart: false });
    expect(outcome.summary.dryRun).toBe(true);
    expect(await app.db.select({ id: poolSnapshots.id }).from(poolSnapshots)).toEqual(before);
    expect(await currentSnapshotId(app.db)).toBe(current);
    expect(await stagedPages()).toBe(FETCH_REQUESTS);
    const lines = describeOutcome(outcome);
    expect(lines[0]).toMatch(
      /^Dry run, nothing activated\. The snapshot would hold 100 entries in 99 franchises/,
    );
    expect(lines).toContain('  1. "Series 1" (900001): 2 entries, 12 characters');
  });

  it("leaves the current snapshot exactly as it was when the build is refused", async () => {
    const short = await startFakeAniList(standardPool({ entries: 89 }));
    try {
      const before = await app.db.select().from(poolSnapshots).orderBy(asc(poolSnapshots.id));
      const shortClient = new AniListClient({ endpoint: short.url, sleep: async () => undefined });
      await expect(
        snapshotFromAniList(app.db, shortClient, { dryRun: false, restart: false }, silent),
      ).rejects.toThrow("Only 89 valid entries, fewer than 90.");
      expect(await app.db.select().from(poolSnapshots).orderBy(asc(poolSnapshots.id))).toEqual(before);
    } finally {
      await short.close();
    }
  });
});

describe("snapshot-pool as a command", () => {
  let app: App;
  const snapshots: number[] = [];
  const sink = () => {
    const chunks: string[] = [];
    return { text: () => chunks.join(""), write: (chunk: string) => chunks.push(chunk) };
  };
  const quiet = new Writable({ write: (_chunk, _encoding, done) => done() });
  async function run(
    argv: string[],
    stdin = "",
    databaseUrl: string | undefined = testDatabaseUrl(),
    client?: AniListClient,
  ) {
    const stdout = sink();
    const stderr = sink();
    const code = await main(argv, databaseUrl, {
      stdin: Readable.from([stdin]),
      stdout,
      stderr,
      logDestination: quiet,
      ...(client === undefined ? {} : { client }),
    });
    return { code, stdout: stdout.text(), stderr: stderr.text() };
  }
  const versionIn = (stdout: string) => Number(/^Snapshot (\d+) active: /.exec(stdout)?.[1]);

  beforeAll(async () => {
    app = await createTestApp();
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
  });
  afterAll(async () => {
    await app.db.delete(poolFetches);
    await deleteSnapshots(app.db, snapshots);
    await app.close();
  });

  it("--stdin --dry-run builds a file and prints what activation would do, writing nothing", async () => {
    const before = await app.db.select({ id: poolSnapshots.id }).from(poolSnapshots);
    const result = await run(["--stdin", "--dry-run"], snapshotText(standardPool()));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout.split("\n")[0]).toMatch(
      /^Dry run, nothing activated\. The snapshot would hold 100 entries in 100 franchises, 600 characters .*read from a file\.$/,
    );
    expect(result.stdout).toContain('  100. "Series 100" (900100): 1 entry, 6 characters');
    expect(await app.db.select({ id: poolSnapshots.id }).from(poolSnapshots)).toEqual(before);
  });

  it("--stdin activates a file as source 'file' with its takenAt", async () => {
    const result = await run(["--stdin"], snapshotText(standardPool()));
    expect(result.code).toBe(0);
    const version = versionIn(result.stdout);
    snapshots.push(version);
    expect(result.stdout).toBe(
      `Snapshot ${version} active: 100 entries in 100 franchises, 600 characters ` +
        "(6 mythic, 24 legendary, 60 epic, 150 rare, 360 common); " +
        "0 skipped; 0 changed tier, 0 dropped, 600 added; read from a file.\n",
    );
    const [row] = await app.db.select().from(poolSnapshots).where(eq(poolSnapshots.id, version));
    expect(row).toMatchObject({
      source: "file",
      isCurrent: true,
      takenAt: new Date("2026-10-29T09:00:00.000Z"),
    });
  });

  it("--export of a built snapshot fed to --stdin builds an identical pool", async () => {
    const source = fetchPool();
    source.characters[0] = {
      id: 800_001,
      favourites: 50,
      in: [{ entry: 900_003 }, { entry: 900_001, role: "SUPPORTING" }],
    };
    const original = await snapshotFromFile(app.db, snapshotText(source), { dryRun: false }, silent);
    snapshots.push(original.summary.version);
    const exported = await run(["--export"]);
    expect(exported.code).toBe(0);
    const copy = await run(["--stdin"], exported.stdout);
    expect(copy.code).toBe(0);
    const version = versionIn(copy.stdout);
    snapshots.push(version);

    const poolOf = async (id: number) => ({
      characters: await app.db
        .select({
          id: poolSnapshotCharacters.characterId,
          tier: poolSnapshotCharacters.tier,
          rank: poolSnapshotCharacters.favouritesRank,
          favourites: poolSnapshotCharacters.favourites,
          primary: poolSnapshotCharacters.primarySeriesId,
        })
        .from(poolSnapshotCharacters)
        .where(eq(poolSnapshotCharacters.snapshotId, id))
        .orderBy(asc(poolSnapshotCharacters.characterId)),
      entries: await app.db
        .select({
          series: poolSnapshotSeries.seriesId,
          franchise: poolSnapshotSeries.franchiseId,
          rank: poolSnapshotSeries.popularityRank,
          genres: poolSnapshotSeries.genres,
        })
        .from(poolSnapshotSeries)
        .where(eq(poolSnapshotSeries.snapshotId, id))
        .orderBy(asc(poolSnapshotSeries.seriesId)),
      memberships: await app.db
        .select({
          character: poolSnapshotMemberships.characterId,
          series: poolSnapshotMemberships.seriesId,
          role: poolSnapshotMemberships.role,
        })
        .from(poolSnapshotMemberships)
        .where(eq(poolSnapshotMemberships.snapshotId, id))
        .orderBy(asc(poolSnapshotMemberships.characterId), asc(poolSnapshotMemberships.seriesId)),
    });
    const first = await poolOf(original.summary.version);
    expect(await poolOf(version)).toEqual(first);
    expect(first.entries.find((row) => row.series === 900_010)?.franchise).toBe(900_001);
    expect(first.characters.find((row) => row.id === 800_001)?.primary).toBe(900_001);
    const file = JSON.parse(exported.stdout) as { relations: unknown[] };
    expect(file.relations).toHaveLength(1);
    expect(await exportSnapshot(app.db)).toMatchObject({
      format: "anime-tcg-snapshot/2",
      takenAt: "2026-10-29T09:00:00.000Z",
    });
  });

  it("exits 1 with one line when a file is refused", async () => {
    const refused = await run(["--stdin"], snapshotText(standardPool({ characters: 499 })));
    expect(refused).toEqual({ code: 1, stdout: "", stderr: "Only 499 valid characters, fewer than 500.\n" });
    const garbage = await run(["--stdin"], "{");
    expect(garbage).toEqual({
      code: 1,
      stdout: "",
      stderr: "The file is not a snapshot: it is not valid JSON.\n",
    });
  });

  it("exits 2 with how to resume when a fetch pauses", async () => {
    const fake = await startFakeAniList(standardPool());
    try {
      fake.failNext(...failures(6, () => faults.status(502)));
      const pausing = new AniListClient({ endpoint: fake.url, sleep: async () => undefined });
      const result = await run([], "", testDatabaseUrl(), pausing);
      expect(result.code).toBe(2);
      expect(result.stderr).toBe("Paused after 0 of about 102 requests; run again to resume.\n");
    } finally {
      await fake.close();
    }
  });

  it.each([
    [["--bogus"]],
    [["--stdin", "--export"]],
    [["--export", "--dry-run"]],
    [["--stdin", "--restart"]],
    [["--dry-run", "--dry-run"]],
  ])("exits 1 with usage for %j", async (argv) => {
    const result = await run(argv);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^Usage: /);
  });

  it.each([undefined, ""])("exits 1 when DATABASE_URL is %j", async (databaseUrl) => {
    const stdout = sink();
    const stderr = sink();
    const code = await main(["--export"], databaseUrl, { stdin: Readable.from([]), stdout, stderr });
    expect({ code, stdout: stdout.text(), stderr: stderr.text() }).toEqual({
      code: 1,
      stdout: "",
      stderr: "DATABASE_URL is not set\n",
    });
  });

  it("runs as a process: --stdin --dry-run reading the file from stdin", async () => {
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    await promisify(execFile)(process.execPath, [tsc, "-b", "../shared"], { cwd: apiDir });
    const result = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/cli/snapshot-pool.ts", "--stdin", "--dry-run"],
        { cwd: apiDir, env: { DATABASE_URL: testDatabaseUrl() }, stdio: ["pipe", "pipe", "ignore"] },
      );
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, stdout }));
      child.stdin.end(snapshotText(standardPool()));
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^Dry run, nothing activated\./);
  }, 60_000);
});
