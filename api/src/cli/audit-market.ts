import { createDb } from "../db/client.js";
import {
  type Finding,
  isEmpty,
  type MarketReport,
  marketReport,
  readTrades,
  type Trader,
} from "../domain/market/audit.js";
import { quote } from "./quote.js";

/**
 * Owner-side market report (docs/design/economy.md §10, §13.3), run inside
 * the api container:
 *
 *   node api/dist/cli/audit-market.js [--days 30]
 *
 * Read-only: net Karma per account pair over 7 days and over the period,
 * pairs where one side makes more than half of the other's market volume,
 * sales at the price bounds per seller, listings bought within 60 seconds,
 * and pairs that registered with the same invite code and traded. Prints
 * `No findings.` when there is nothing; exits 0 either way, since findings
 * are for the owner to judge, not failures. Uses DATABASE_URL: the app role
 * can read everything this reads.
 */

const USAGE = "Usage: node api/dist/cli/audit-market.js [--days <1-3650>]";
const DEFAULT_DAYS = 30;
const MAX_DAYS = 3_650;

export interface AuditMarketIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  /** The report's time; the server clock unless a test passes its own. */
  clock?: () => Date;
}

/** `--days N` or nothing; anything else is a usage error. */
export function parseDays(argv: readonly string[]): number | null {
  if (argv.length === 0) return DEFAULT_DAYS;
  const [flag, value, ...rest] = argv;
  if (flag !== "--days" || value === undefined || rest.length > 0 || !/^[1-9][0-9]{0,3}$/u.test(value))
    return null;
  const days = Number(value);
  return days <= MAX_DAYS ? days : null;
}

const SECTIONS: [keyof MarketReport, string][] = [
  ["netWeek", "Net Karma per pair, last 7 days"],
  ["netPeriod", "Net Karma per pair, the whole period"],
  ["dominantPairs", "Pairs where one side makes more than half of the other's volume"],
  ["atBounds", "Sales at the price bounds"],
  ["quickBuys", "Listings bought within 60 seconds"],
  ["sameInvite", "Same invite code, and traded"],
];

/** One finding with its accounts named by quoted login and id, so nothing in a login reaches the terminal unescaped. */
function describeFinding(finding: Finding, traders: ReadonlyMap<string, Trader>): string {
  return finding.text.replace(/\{(\d)\}/gu, (_, index: string) => {
    const id = finding.accounts[Number(index)] ?? "";
    const login = traders.get(id)?.login;
    return login === undefined ? id : `${quote(login)} (${id})`;
  });
}

/** The report, one heading per section with findings and one line per finding, or the one line that says there is nothing. */
export function describeMarketReport(report: MarketReport, traders: ReadonlyMap<string, Trader>): string[] {
  if (isEmpty(report)) return ["No findings."];
  return SECTIONS.flatMap(([key, heading]) => {
    const findings = report[key];
    if (findings.length === 0) return [];
    return [`${heading}:`, ...findings.map((finding) => `  ${describeFinding(finding, traders)}`)];
  });
}

/** The command's whole life, returned as its exit code so the module can be imported without side effects. */
export async function main(
  argv: readonly string[],
  databaseUrl: string | undefined,
  io: AuditMarketIo,
): Promise<number> {
  const days = parseDays(argv);
  if (days === null) {
    io.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (databaseUrl === undefined || databaseUrl === "") {
    io.stderr.write("DATABASE_URL is not set\n");
    return 1;
  }
  const db = createDb(databaseUrl);
  try {
    const now = io.clock?.() ?? new Date();
    const { trades, traders } = await readTrades(db, now, days);
    for (const line of describeMarketReport(marketReport(trades, traders, now, days), traders))
      io.stdout.write(`${line}\n`);
    return 0;
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), process.env.DATABASE_URL, {
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
