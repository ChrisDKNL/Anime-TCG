import { characterCount, PASSWORD_LENGTH } from "@anime-tcg/shared/api";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { normalizeLogin } from "../domain/accounts/logins.js";
import { hashPassword } from "../domain/accounts/password.js";
import { destroySessionsOf } from "../domain/session/service.js";
import { quote } from "./quote.js";

/**
 * Owner-side password reset (docs/design/accounts-api.md §8), run inside the
 * api container:
 *
 *   node api/dist/cli/reset-password.js <login>   (the new password on stdin)
 *
 * The password comes through stdin so it is never in shell history or `ps`.
 * Uses DATABASE_URL: the app role has every statement this needs.
 */

/** A reason the owner can act on; its message is the one line the command prints before exiting 1. */
export class ResetPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResetPasswordError";
  }
}

export interface ResetResult {
  /** The stored display login, whatever case the command was given. */
  login: string;
  sessionsEnded: number;
}

/** Rehashes and writes the new password and ends every session of the account, in one transaction. */
export async function resetPassword(db: Db, login: string, newPassword: string): Promise<ResetResult> {
  const length = characterCount(newPassword);
  if (length < PASSWORD_LENGTH.min || length > PASSWORD_LENGTH.max) {
    throw new ResetPasswordError(
      `The new password must be ${PASSWORD_LENGTH.min} to ${PASSWORD_LENGTH.max} characters`,
    );
  }
  const [account] = await db
    .select({ id: accounts.id, login: accounts.login })
    .from(accounts)
    .where(eq(accounts.loginNormalized, normalizeLogin(login)))
    .limit(1);
  if (account === undefined) throw new ResetPasswordError(`No account has the login ${quote(login)}`);
  const passwordHash = await hashPassword(newPassword);
  const sessionsEnded = await db.transaction(async (tx) => {
    await tx.update(accounts).set({ passwordHash, updatedAt: new Date() }).where(eq(accounts.id, account.id));
    return destroySessionsOf(tx, account.id);
  });
  return { login: account.login, sessionsEnded };
}

/** The login is printed through `quote`, so nothing in it reaches the terminal unescaped. */
export function describePasswordReset(result: ResetResult): string {
  return `Password reset for ${quote(result.login)}; ${result.sessionsEnded} sessions ended.`;
}

async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

/** One trailing line break belongs to the shell (`echo`, a here-string), not to the password; nothing else is trimmed. */
function withoutTrailingLineBreak(text: string): string {
  return text.replace(/\r?\n$/, "");
}

const USAGE = "Usage: node api/dist/cli/reset-password.js <login>   (reads the new password from stdin)";

/** The command's whole life, returned as its exit code so the module can be imported without side effects. */
export async function main(argv: readonly string[], databaseUrl: string | undefined): Promise<number> {
  const [login, ...extra] = argv;
  if (login === undefined || extra.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (databaseUrl === undefined || databaseUrl === "") {
    process.stderr.write("DATABASE_URL is not set\n");
    return 1;
  }
  const db = createDb(databaseUrl);
  try {
    const result = await resetPassword(db, login, withoutTrailingLineBreak(await readStdin()));
    process.stdout.write(`${describePasswordReset(result)}\n`);
    return 0;
  } catch (err) {
    if (!(err instanceof ResetPasswordError)) throw err;
    process.stderr.write(`${err.message}\n`);
    return 1;
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), process.env.DATABASE_URL);
}
