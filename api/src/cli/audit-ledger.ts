import { createDb } from "../db/client.js";
import { type AuditResult, auditLedger } from "../domain/economy/audit.js";
import { quote } from "./quote.js";

/**
 * Owner-side ledger audit (docs/design/economy.md §13.1), run inside the api
 * container before a release and after any restore:
 *
 *   node api/dist/cli/audit-ledger.js
 *
 * Read-only: checks every account's balance, ledger and the recycles and
 * shop openings it paid for, and prints one line per failing account (exit
 * 1) or that the ledger is consistent (exit 0). Uses DATABASE_URL: the app
 * role can read everything this reads.
 */

const USAGE = "Usage: node api/dist/cli/audit-ledger.js";

export interface AuditIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
}

/** The report, one line per failing account; logins are printed through `quote`, as the other commands print them. */
export function describeAudit(result: AuditResult): string[] {
  if (result.failures.length === 0)
    return [`Ledger consistent: ${result.accounts} accounts, ${result.entries} entries.`];
  return result.failures.map(
    (failure) => `Account ${quote(failure.login)} (${failure.id}): ${failure.problems.join("; ")}.`,
  );
}

/** The command's whole life, returned as its exit code so the module can be imported without side effects. */
export async function main(
  argv: readonly string[],
  databaseUrl: string | undefined,
  io: AuditIo,
): Promise<number> {
  if (argv.length > 0) {
    io.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (databaseUrl === undefined || databaseUrl === "") {
    io.stderr.write("DATABASE_URL is not set\n");
    return 1;
  }
  const db = createDb(databaseUrl);
  try {
    const result = await auditLedger(db);
    const lines = describeAudit(result);
    const out = result.failures.length === 0 ? io.stdout : io.stderr;
    for (const line of lines) out.write(`${line}\n`);
    return result.failures.length === 0 ? 0 : 1;
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
