import { pino, type DestinationStream } from "pino";
import { createDb } from "../db/client.js";
import {
  type CollectionResetResult,
  ResetCollectionError,
  resetCollection,
} from "../domain/collection/reset.js";
import { createLogger } from "../plugins/logging.js";

/**
 * Owner-side collection reset (docs/design/collection-packs.md §7.2), run
 * inside the api container:
 *
 *   node api/dist/cli/reset-collection.js <login>             what a reset would remove
 *   node api/dist/cli/reset-collection.js <login> --confirm   reset it
 *
 * Removes the account's openings and cards, fills its pack allowance and
 * sets its pity and Enchanted counters to zero; the login, password and
 * sessions stay. Uses DATABASE_URL: the app role has
 * every statement this needs. There is no route for it, by design.
 */

const USAGE = "Usage: node api/dist/cli/reset-collection.js <login> [--confirm]";

/** The login is printed JSON-quoted, as the snapshot command prints titles: a control sequence in one cannot reach the terminal. */
export function describeReset(result: CollectionResetResult): string {
  const login = JSON.stringify(result.login);
  return result.applied
    ? `Collection reset for ${login}: ${result.cards} cards and ${result.openings} openings removed; packs full; counters reset.`
    : `Would reset ${login}: ${result.cards} cards, ${result.openings} openings; pity and Enchanted counters to zero.`;
}

export interface ResetIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  logDestination?: DestinationStream;
}

/** The command's whole life, returned as its exit code so the module can be imported without side effects. */
export async function main(
  argv: readonly string[],
  databaseUrl: string | undefined,
  io: ResetIo,
): Promise<number> {
  const confirms = argv.filter((arg) => arg === "--confirm").length;
  const [login, ...extra] = argv.filter((arg) => arg !== "--confirm");
  const confirm = confirms === 1;
  if (login === undefined || login.startsWith("--") || extra.length > 0 || confirms > 1) {
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
    const result = await resetCollection(db, login, { confirm });
    if (result.applied) {
      log.info(
        { accountId: result.accountId, cards: result.cards, openings: result.openings },
        "collection reset",
      );
    }
    io.stdout.write(`${describeReset(result)}\n`);
    return 0;
  } catch (err) {
    if (!(err instanceof ResetCollectionError)) throw err;
    io.stderr.write(`${err.message}\n`);
    return 1;
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
