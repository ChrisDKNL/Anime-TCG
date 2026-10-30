import { pino, type DestinationStream } from "pino";
import { createDb } from "../db/client.js";
import {
  type CollectionResetResult,
  ResetCollectionError,
  resetCollection,
} from "../domain/collection/reset.js";
import { createLogger } from "../plugins/logging.js";
import { escapeUnprintable, quote } from "./quote.js";

/**
 * Owner-side collection reset (docs/design/collection-packs.md §7.2), run
 * inside the api container:
 *
 *   node api/dist/cli/reset-collection.js <login>                          what a reset would remove
 *   node api/dist/cli/reset-collection.js <login> --confirm                reset it, Karma to 0
 *   node api/dist/cli/reset-collection.js <login> --keep-karma --confirm   reset it, Karma kept
 *
 * Cancels the account's market listings, removes its openings and cards
 * (recycled, sold and bought ones included), fills its pack allowance, sets
 * its pity and Enchanted counters to zero and records the reset's time; the
 * Karma balance goes to 0 with one ledger row unless `--keep-karma`
 * (economy.md §8.10, §13.4); the login, password and sessions stay. The dry run counts the cards the player holds and, apart,
 * the recycled ones. Uses DATABASE_URL: the app role has every statement
 * this needs. There is no route for it, by design.
 */

const USAGE = "Usage: node api/dist/cli/reset-collection.js <login> [--keep-karma] [--confirm]";
const FLAGS = ["--confirm", "--keep-karma"];

/** The login is printed through `quote`, as the snapshot command prints titles, so nothing in it reaches the terminal unescaped. */
export function describeReset(result: CollectionResetResult): string {
  const login = quote(result.login);
  // The cards the player holds, and apart the recycled ones the reset deletes with them (economy.md §13.4).
  const recycled = result.recycledCards > 0 ? `, ${result.recycledCards} recycled cards` : "";
  // The market listings it cancels (economy.md §8.10, §13.4), named only when there are some, as the recycled cards are.
  if (result.applied) {
    const listings = result.listings > 0 ? ` ${result.listings} listings cancelled;` : "";
    const karma = result.keepKarma ? `balance ${result.balance} kept` : `balance ${result.balance} set to 0`;
    return `Collection reset for ${login}: ${result.cards} cards${recycled} and ${result.openings} openings removed;${listings} packs full; counters reset; ${karma}.`;
  }
  const listings = result.listings > 0 ? `, ${result.listings} listings` : "";
  const karma = result.keepKarma
    ? `balance ${result.balance} kept (--keep-karma)`
    : `balance ${result.balance} to 0`;
  return `Would reset ${login}: ${result.cards} cards${recycled}, ${result.openings} openings${listings}; pity and Enchanted counters to zero; ${karma}.`;
}

export interface ResetIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  logDestination?: DestinationStream;
  /** The reset's time; the server clock unless a test passes its own. */
  clock?: () => Date;
}

/** The command's whole life, returned as its exit code so the module can be imported without side effects. */
export async function main(
  argv: readonly string[],
  databaseUrl: string | undefined,
  io: ResetIo,
): Promise<number> {
  const confirms = argv.filter((arg) => arg === "--confirm").length;
  const keeps = argv.filter((arg) => arg === "--keep-karma").length;
  const [login, ...extra] = argv.filter((arg) => !FLAGS.includes(arg));
  const confirm = confirms === 1;
  const keepKarma = keeps === 1;
  if (login === undefined || login.startsWith("--") || extra.length > 0 || confirms > 1 || keeps > 1) {
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
    const result = await resetCollection(db, login, { confirm, keepKarma, clock: io.clock });
    if (result.applied) {
      log.info(
        {
          accountId: result.accountId,
          cards: result.cards,
          recycledCards: result.recycledCards,
          openings: result.openings,
          listings: result.listings,
          balance: result.balance,
          keepKarma: result.keepKarma,
        },
        "collection reset",
      );
    }
    io.stdout.write(`${describeReset(result)}\n`);
    return 0;
  } catch (err) {
    if (!(err instanceof ResetCollectionError)) throw err;
    io.stderr.write(`${escapeUnprintable(err.message)}\n`);
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
