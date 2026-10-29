import { MAX_BALANCE, MAX_ENTRY_AMOUNT } from "@anime-tcg/shared/economy";
import { desc, eq } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { accounts, ledgerEntries, type ledgerKind } from "../../db/schema.js";
import { ApiError } from "../errors.js";

/** Why a balance changed (economy.md §7). */
export type LedgerKind = (typeof ledgerKind.enumValues)[number];

/** The kinds that add Karma; every other kind takes it away. */
export const CREDIT_KINDS: ReadonlySet<LedgerKind> = new Set(["recycle_credit", "market_sale"]);

/** The account's balance as read under its row lock, and the newest ledger row's `seq` (0 before the first). */
export interface LedgerPosition {
  balance: number;
  lastSeq: number;
}

export interface PlannedEntry {
  seq: number;
  kind: LedgerKind;
  amount: number;
  balanceAfter: number;
}

function assertSafeInteger(label: string, value: number): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} ${value} is not a safe integer`);
}

/**
 * The ledger row a balance change writes (economy.md §8.1), pure: the next
 * `seq` and the balance after it. A value outside the bounds the schema and
 * the parameters already enforce is a bug and throws a `RangeError` (a 500
 * that writes nothing); a balance the change would take below 0 or above
 * `MAX_BALANCE` is the caller's typed refusal.
 */
export function planEntry(position: LedgerPosition, kind: LedgerKind, amount: number): PlannedEntry {
  assertSafeInteger("balance", position.balance);
  assertSafeInteger("seq", position.lastSeq);
  assertSafeInteger("amount", amount);
  if (position.balance < 0 || position.balance > MAX_BALANCE)
    throw new RangeError(`balance ${position.balance} is outside 0..${MAX_BALANCE}`);
  if (position.lastSeq < 0) throw new RangeError(`seq ${position.lastSeq} is negative`);
  if (amount === 0) throw new RangeError("a ledger amount is never 0");
  if (amount > 0 !== CREDIT_KINDS.has(kind))
    throw new RangeError(`a ${kind} of ${amount} has the wrong sign`);
  if (Math.abs(amount) > MAX_ENTRY_AMOUNT && kind !== "owner_reset")
    throw new RangeError(`amount ${amount} is beyond MAX_ENTRY_AMOUNT`);

  const balanceAfter = position.balance + amount;
  if (balanceAfter < 0) {
    throw new ApiError(
      409,
      "insufficient_funds",
      "The balance does not cover the price",
      undefined,
      position.balance,
    );
  }
  if (balanceAfter > MAX_BALANCE) {
    throw new ApiError(409, "balance_limit", "The balance cannot hold this much");
  }
  const seq = position.lastSeq + 1;
  assertSafeInteger("seq", seq);
  return { seq, kind, amount, balanceAfter };
}

/** The account row as a balance change needs it, read `FOR UPDATE` by the caller. */
export interface LockedBalance {
  id: string;
  balance: number;
}

export interface PostedEntry {
  id: string;
  seq: number;
  balanceAfter: number;
}

/**
 * The only code that writes `accounts.balance` or `ledger_entries`
 * (economy.md §8.1). Runs inside the transaction of what the change pays
 * for, after the caller locked the account row. The newest ledger row must
 * agree with the locked balance; if it does not, the ledger is broken and
 * nothing more is written to it.
 */
export async function postEntry(
  tx: Queryable,
  account: LockedBalance,
  kind: LedgerKind,
  amount: number,
  at: Date,
): Promise<PostedEntry> {
  const [last] = await tx
    .select({ seq: ledgerEntries.seq, balanceAfter: ledgerEntries.balanceAfter })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountId, account.id))
    .orderBy(desc(ledgerEntries.seq))
    .limit(1);
  if ((last?.balanceAfter ?? 0) !== account.balance) {
    throw new Error(`account ${account.id}: balance ${account.balance} disagrees with its ledger`);
  }
  const entry = planEntry({ balance: account.balance, lastSeq: last?.seq ?? 0 }, kind, amount);
  const [row] = await tx
    .insert(ledgerEntries)
    .values({
      accountId: account.id,
      seq: entry.seq,
      kind,
      amount,
      balanceAfter: entry.balanceAfter,
      createdAt: at,
    })
    .returning({ id: ledgerEntries.id });
  if (row === undefined) throw new Error("ledger insert returned no row");
  await tx.update(accounts).set({ balance: entry.balanceAfter }).where(eq(accounts.id, account.id));
  return { id: row.id, seq: entry.seq, balanceAfter: entry.balanceAfter };
}
