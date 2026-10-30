import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db, Queryable } from "../../db/client.js";
import { accounts, cards, packOpenings } from "../../db/schema.js";
import { normalizeLogin } from "../accounts/logins.js";
import { postEntry } from "../economy/ledger.js";

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
  /** Cards the player holds (`removed_at` is null). */
  cards: number;
  /** Cards already recycled: removed, but still rows, so the reset deletes them too. */
  recycledCards: number;
  openings: number;
  /** The Karma balance before the reset. */
  balance: number;
  /** True with `--keep-karma`: the balance stays and no ledger row is written. */
  keepKarma: boolean;
  /** False for the preview without `--confirm`: nothing was changed. */
  applied: boolean;
}

async function holdings(
  tx: Queryable,
  accountId: string,
): Promise<{ cards: number; recycledCards: number; openings: number }> {
  const [heldRow] = await tx
    .select({ total: count() })
    .from(cards)
    .where(and(eq(cards.accountId, accountId), isNull(cards.removedAt)));
  const [recycledRow] = await tx
    .select({ total: count() })
    .from(cards)
    .where(and(eq(cards.accountId, accountId), isNotNull(cards.removedByRecycle)));
  const [openingRow] = await tx
    .select({ total: count() })
    .from(packOpenings)
    .where(eq(packOpenings.accountId, accountId));
  return {
    cards: heldRow?.total ?? 0,
    recycledCards: recycledRow?.total ?? 0,
    openings: openingRow?.total ?? 0,
  };
}

/**
 * The owner's reset of one account's collection (collection-packs.md §5.6):
 * under the account row's lock, the same one every opening takes, its
 * openings go (and their cards by cascade), the allowance is full again and
 * both pack counters are 0, as on registration, so a racing opening is
 * either wholly removed or wholly kept. The Karma rule is the owner's per
 * reset (economy.md §8.10): by default the balance goes to 0 with one
 * `owner_reset` row of minus the balance (none at 0), with `keepKarma` it
 * stays and nothing is written. Every confirmed reset, whichever the Karma
 * rule, sets `last_reset_at` to its time (taken from `clock` once the lock
 * is held), which is how `audit-ledger` tells the recycles and shop debits
 * it emptied from forged ones (§13.1). The account's ledger, recycles and
 * their entries stay as history. The login, password, sessions and account
 * id stay. Without `confirm` it only counts: the cards held and, apart, the
 * recycled ones it would delete with them (§13.4).
 */
export async function resetCollection(
  db: Db,
  login: string,
  options: { confirm: boolean; keepKarma?: boolean; clock?: () => Date },
): Promise<CollectionResetResult> {
  const keepKarma = options.keepKarma ?? false;
  return db.transaction(async (tx) => {
    const query = tx
      .select({ id: accounts.id, login: accounts.login, balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.loginNormalized, normalizeLogin(login)));
    const [account] = options.confirm ? await query.for("update") : await query;
    if (account === undefined)
      throw new ResetCollectionError(`No account has the login ${JSON.stringify(login)}`);
    const held = await holdings(tx, account.id);
    if (options.confirm) {
      const resetAt = options.clock?.() ?? new Date();
      await tx.delete(packOpenings).where(eq(packOpenings.accountId, account.id));
      await tx
        .update(accounts)
        .set({ packsAnchorAt: null, packsSinceMythic: 0, freePacksOpened: 0, lastResetAt: resetAt })
        .where(eq(accounts.id, account.id));
      if (!keepKarma && account.balance > 0) {
        await postEntry(tx, account, "owner_reset", -account.balance, resetAt);
      }
    }
    return {
      accountId: account.id,
      login: account.login,
      ...held,
      balance: account.balance,
      keepKarma,
      applied: options.confirm,
    };
  });
}
