import { count, eq } from "drizzle-orm";
import type { Db, Queryable } from "../../db/client.js";
import { accounts, cards, packOpenings } from "../../db/schema.js";
import { normalizeLogin } from "../accounts/logins.js";

/** A reason the owner can act on; its message is the one line the command prints before exiting 1. */
export class ResetCollectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResetCollectionError";
  }
}

export interface CollectionResetResult {
  accountId: string;
  /** The stored display login, whatever case the command was given. */
  login: string;
  cards: number;
  openings: number;
  /** False for the preview without `--confirm`: nothing was changed. */
  applied: boolean;
}

async function holdings(tx: Queryable, accountId: string): Promise<{ cards: number; openings: number }> {
  const [cardRow] = await tx.select({ total: count() }).from(cards).where(eq(cards.accountId, accountId));
  const [openingRow] = await tx
    .select({ total: count() })
    .from(packOpenings)
    .where(eq(packOpenings.accountId, accountId));
  return { cards: cardRow?.total ?? 0, openings: openingRow?.total ?? 0 };
}

/**
 * The owner's reset of one account's collection (collection-packs.md §5.6):
 * under the account row's lock, the same one every opening takes, its
 * openings go (and their cards by cascade), the allowance is full again and
 * both pack counters are 0, as on registration, so a racing opening is
 * either wholly removed or wholly kept. The login,
 * password, sessions and account id stay. Without `confirm` it only counts.
 */
export async function resetCollection(
  db: Db,
  login: string,
  options: { confirm: boolean },
): Promise<CollectionResetResult> {
  return db.transaction(async (tx) => {
    const query = tx
      .select({ id: accounts.id, login: accounts.login })
      .from(accounts)
      .where(eq(accounts.loginNormalized, normalizeLogin(login)));
    const [account] = options.confirm ? await query.for("update") : await query;
    if (account === undefined)
      throw new ResetCollectionError(`No account has the login ${JSON.stringify(login)}`);
    const held = await holdings(tx, account.id);
    if (options.confirm) {
      await tx.delete(packOpenings).where(eq(packOpenings.accountId, account.id));
      await tx
        .update(accounts)
        .set({ packsAnchorAt: null, packsSinceMythic: 0, freePacksOpened: 0 })
        .where(eq(accounts.id, account.id));
    }
    return { accountId: account.id, login: account.login, ...held, applied: options.confirm };
  });
}
