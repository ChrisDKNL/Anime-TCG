import { pino, type DestinationStream } from "pino";
import { createDb, type Db } from "../db/client.js";
import { type ActivationSummary, activateSnapshot } from "../domain/pool/activate.js";
import { AniListClient } from "../domain/pool/anilist.js";
import { buildSnapshot, type SnapshotPlan, SnapshotRefused } from "../domain/pool/build.js";
import { exportSnapshot } from "../domain/pool/export.js";
import { FetchPaused, type FetchLog, FetchStaging, fetchSnapshotPages } from "../domain/pool/fetch.js";
import { readCapped, readSnapshotFile } from "../domain/pool/file.js";
import { createLogger } from "../plugins/logging.js";

/**
 * The owner's snapshot command (docs/design/collection-packs.md §7.1), run
 * inside the api container:
 *
 *   node api/dist/cli/snapshot-pool.js [--dry-run] [--restart]   fetch from AniList, resumable
 *   node api/dist/cli/snapshot-pool.js --stdin [--dry-run]       load a snapshot file
 *   node api/dist/cli/snapshot-pool.js --export                  print the current snapshot as a file
 *
 * The only code in the system that calls AniList. Uses DATABASE_URL: the app
 * role has every statement it needs. Exit 1 with one line on a refusal, 2
 * when a fetch paused and can be resumed.
 */

const USAGE =
  "Usage: node api/dist/cli/snapshot-pool.js [--dry-run] [--restart] | --stdin [--dry-run] | --export";

export interface RunOptions {
  dryRun: boolean;
  restart: boolean;
}

/** Logs what the build skipped: per reason a count, and the first field path it was seen at. */
function logBuild(log: FetchLog, plan: SnapshotPlan): void {
  for (const [reason, { count, firstPath }] of plan.skipped.reasons) {
    log.warn({ reason, count, firstPath }, "snapshot items skipped");
  }
  if (plan.differingAppearances > 0) {
    log.info(
      { differingAppearances: plan.differingAppearances },
      "characters listed differently under several entries",
    );
  }
}

function logActivation(log: FetchLog, summary: ActivationSummary, startedAt: number): void {
  const { franchises, ...rest } = summary;
  log.info({ ...rest, franchises: franchises.length, durationMs: Date.now() - startedAt }, "snapshot built");
}

export interface SnapshotOutcome {
  summary: ActivationSummary;
  /** AniList requests this run sent; null when the snapshot came from a file. */
  requests: number | null;
}

/** Fetches (or resumes) from AniList, then builds and activates; staging is deleted with the activation. */
export async function snapshotFromAniList(
  db: Db,
  client: AniListClient,
  options: RunOptions,
  log: FetchLog,
  clock: () => Date = () => new Date(),
): Promise<SnapshotOutcome> {
  const startedAt = Date.now();
  const staging = new FetchStaging(db);
  const fetch = await staging.open(clock(), options.restart);
  log.info({ fetchId: fetch.id, resumed: fetch.resumed, startedAt: fetch.startedAt }, "snapshot fetch");
  const result = await fetchSnapshotPages(staging, client, fetch, log, clock);
  log.info(
    { requests: result.requests, pages: result.pages, rateLimited: result.rateLimited },
    "snapshot fetched",
  );
  const plan = buildSnapshot(result.input);
  logBuild(log, plan);
  const summary = await activateSnapshot(db, plan, {
    source: "anilist",
    takenAt: fetch.startedAt,
    now: clock(),
    dryRun: options.dryRun,
    fetchId: fetch.id,
  });
  logActivation(log, summary, startedAt);
  return { summary, requests: result.requests };
}

/** Loads a snapshot file through the same parse, validation, refusals and build as a fetch. */
export async function snapshotFromFile(
  db: Db,
  text: string,
  options: Pick<RunOptions, "dryRun">,
  log: FetchLog,
  clock: () => Date = () => new Date(),
): Promise<SnapshotOutcome> {
  const startedAt = Date.now();
  const { takenAt, input } = readSnapshotFile(text);
  const plan = buildSnapshot(input);
  logBuild(log, plan);
  const summary = await activateSnapshot(db, plan, {
    source: "file",
    takenAt,
    now: clock(),
    dryRun: options.dryRun,
  });
  logActivation(log, summary, startedAt);
  return { summary, requests: null };
}

/**
 * What the command prints. Titles are AniList's strings, so they are
 * printed JSON-quoted: a control sequence in one cannot reach the terminal.
 */
export function describeOutcome({ summary, requests }: SnapshotOutcome): string[] {
  const t = summary.tierCounts;
  const body =
    `${summary.entries} entries in ${summary.franchises.length} franchises, ${summary.characters} characters ` +
    `(${t.mythic} mythic, ${t.legendary} legendary, ${t.epic} epic, ${t.rare} rare, ${t.common} common); ` +
    `${summary.skipped} skipped; ${summary.changedTier} changed tier, ${summary.dropped} dropped, ${summary.added} added; ` +
    (requests === null ? "read from a file." : `${requests} AniList requests.`);
  if (!summary.dryRun) return [`Snapshot ${summary.version} active: ${body}`];
  return [
    `Dry run, nothing activated. The snapshot would hold ${body}`,
    `Franchises (${summary.franchisesMerged} merged and ${summary.franchisesSplit} split since the current snapshot):`,
    ...summary.franchises.map(
      (f) =>
        `  ${f.popularityRank}. ${JSON.stringify(f.title)} (${f.id}): ${f.entries} ${f.entries === 1 ? "entry" : "entries"}, ${f.characters} characters`,
    ),
  ];
}

interface Mode {
  kind: "anilist" | "stdin" | "export";
  dryRun: boolean;
  restart: boolean;
}

function parseArguments(argv: readonly string[]): Mode | null {
  const flags = new Set(argv);
  if (flags.size !== argv.length) return null;
  const known = ["--dry-run", "--restart", "--stdin", "--export"];
  if ([...flags].some((flag) => !known.includes(flag))) return null;
  const dryRun = flags.has("--dry-run");
  const restart = flags.has("--restart");
  if (flags.has("--export")) return flags.size === 1 ? { kind: "export", dryRun, restart } : null;
  if (flags.has("--stdin")) return restart ? null : { kind: "stdin", dryRun, restart };
  return { kind: "anilist", dryRun, restart };
}

export interface CommandIo {
  stdin: AsyncIterable<Buffer | string>;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  /** Where the JSON log lines go; stderr's file descriptor by default, so `--export` keeps stdout to the file. */
  logDestination?: DestinationStream;
  /** The AniList client to fetch with; the real endpoint unless a test hands in a local stand-in. */
  client?: AniListClient;
}

/** The command's whole life, returned as its exit code so the module can be imported without side effects. */
export async function main(
  argv: readonly string[],
  databaseUrl: string | undefined,
  io: CommandIo,
): Promise<number> {
  const mode = parseArguments(argv);
  if (mode === null) {
    io.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (databaseUrl === undefined || databaseUrl === "") {
    io.stderr.write("DATABASE_URL is not set\n");
    return 1;
  }
  const log = createLogger("info", io.logDestination ?? pino.destination({ dest: 2, sync: true }));
  const db = createDb(databaseUrl);
  try {
    if (mode.kind === "export") {
      io.stdout.write(`${JSON.stringify(await exportSnapshot(db))}\n`);
      return 0;
    }
    const outcome =
      mode.kind === "stdin"
        ? await snapshotFromFile(db, await readCapped(io.stdin), mode, log)
        : await snapshotFromAniList(db, io.client ?? new AniListClient(), mode, log);
    io.stdout.write(`${describeOutcome(outcome).join("\n")}\n`);
    return 0;
  } catch (err) {
    if (err instanceof SnapshotRefused) {
      io.stderr.write(`${err.message}\n`);
      return 1;
    }
    if (err instanceof FetchPaused) {
      io.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), process.env.DATABASE_URL, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
