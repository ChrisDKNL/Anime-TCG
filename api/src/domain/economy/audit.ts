import { RECYCLE_VALUE, THEMED_PACK_PRICE } from "@anime-tcg/shared/economy";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { asc, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { accounts, ledgerEntries } from "../../db/schema.js";
import { CREDIT_KINDS, type LedgerKind } from "./ledger.js";

/**
 * `audit-ledger` (economy.md §13.1), read-only: every account against the
 * invariants of §7. The checks are a pure function of what the database
 * holds, so each one is unit-tested on its own.
 */

export interface AuditEntry {
  id: string;
  seq: number;
  kind: LedgerKind;
  amount: number;
  balanceAfter: number;
}

/** A shop opening, the price it recorded, and the ledger row its `ledger_entry_id` names (the entry's fields are null when it names none). */
export type AuditShopOpening = {
  openingId: string;
  price: number;
  entryAccountId: string | null;
  entryKind: LedgerKind | null;
  entryAmount: number | null;
};

/** A recycle, its credit, and the cards that name it as their remover. */
export type AuditRecycle = {
  recycleId: string;
  rarity: Rarity;
  count: number;
  /** Karma per card at recycle time. */
  unitValue: number;
  entryAccountId: string;
  entryKind: LedgerKind;
  entryAmount: number;
  removedCards: number;
  /** Cards it removed that are not a held-then-removed standard copy of its own entry. */
  foreignCards: number;
  createdAt: Date;
};

/** A `shop_purchase` row no shop opening names: a reset deleted its opening, or something did that should not have. */
export type AuditUnclaimedDebit = { seq: number; createdAt: Date };

export interface AccountFacts {
  id: string;
  login: string;
  balance: number;
  /** The account's last collection reset (`accounts.last_reset_at`); null if it never had one. */
  lastResetAt: Date | null;
  /** Ordered by `seq`. */
  entries: AuditEntry[];
  shopOpenings: AuditShopOpening[];
  recycles: AuditRecycle[];
  /** `recycle_credit` rows no recycle names. */
  unclaimedCredits: number;
  /** Ordered by `seq`. */
  unclaimedShopDebits: AuditUnclaimedDebit[];
  /** Cards marked removed with nothing that removed them. */
  unexplainedRemovals: number;
  escrowedCards: number;
}

/** Kinds whose rows item 2's first PR never writes; the market (PR 3) brings their checks. */
const UNBUILT_KINDS: ReadonlySet<LedgerKind> = new Set(["market_purchase", "market_sale", "market_fee"]);

/**
 * What is wrong with one account, as short phrases; empty when it is
 * consistent. Each recycle and shop opening is checked against the value
 * it recorded, never today's constants, so a later change of
 * `RECYCLE_VALUE` or `THEMED_PACK_PRICE` leaves an old row correct. A
 * recycle without its cards and a shop debit without its opening are what
 * a reset leaves, so they pass only when the account's last reset came at
 * or after the row was written (manager decision, 2026-10-30).
 */
export function auditAccount(facts: AccountFacts): string[] {
  const problems: string[] = [];
  const { lastResetAt } = facts;
  // At or after: the reset takes its time under the account lock, so a row committed before it is never newer.
  const emptiedByReset = (createdAt: Date) =>
    lastResetAt !== null && createdAt.getTime() <= lastResetAt.getTime();
  let previous = 0;
  let sum = 0;
  facts.entries.forEach((entry, index) => {
    if (entry.seq !== index + 1) problems.push(`seq ${entry.seq} where ${index + 1} was due`);
    if (entry.balanceAfter !== previous + entry.amount)
      problems.push(
        `entry ${entry.seq}: balance_after ${entry.balanceAfter} after ${previous} and ${entry.amount}`,
      );
    if (entry.amount === 0 || entry.amount > 0 !== CREDIT_KINDS.has(entry.kind))
      problems.push(`entry ${entry.seq}: ${entry.kind} of ${entry.amount}`);
    if (entry.kind === "owner_reset" && entry.balanceAfter !== 0)
      problems.push(`entry ${entry.seq}: an owner reset left ${entry.balanceAfter}`);
    if (UNBUILT_KINDS.has(entry.kind))
      problems.push(`entry ${entry.seq}: ${entry.kind} before the market exists`);
    previous = entry.balanceAfter;
    sum += entry.amount;
  });
  if (facts.balance !== sum) problems.push(`balance ${facts.balance} but the entries sum to ${sum}`);
  if (facts.balance !== previous)
    problems.push(`balance ${facts.balance} but the newest entry left ${previous}`);

  for (const opening of facts.shopOpenings) {
    if (
      opening.entryAccountId !== facts.id ||
      opening.entryKind !== "shop_purchase" ||
      opening.entryAmount !== -opening.price
    ) {
      problems.push(`shop opening ${opening.openingId} without its debit of ${opening.price}`);
    }
  }
  for (const debit of facts.unclaimedShopDebits) {
    if (!emptiedByReset(debit.createdAt))
      problems.push(`entry ${debit.seq}: shop_purchase without its opening, and no reset after it`);
  }

  for (const recycle of facts.recycles) {
    const credit = recycle.count * recycle.unitValue;
    if (
      recycle.entryAccountId !== facts.id ||
      recycle.entryKind !== "recycle_credit" ||
      recycle.entryAmount !== credit
    ) {
      problems.push(`recycle ${recycle.recycleId} without its credit of ${credit}`);
    }
    // An owner reset deletes every card, recycled ones included (§8.10): all of a recycle's cards are there, or a reset took them.
    if (recycle.removedCards === 0) {
      if (!emptiedByReset(recycle.createdAt))
        problems.push(
          `recycle ${recycle.recycleId} removed 0 cards, not ${recycle.count}, and no reset after it`,
        );
    } else if (recycle.removedCards !== recycle.count) {
      problems.push(
        `recycle ${recycle.recycleId} removed ${recycle.removedCards} cards, not ${recycle.count}`,
      );
    }
    if (recycle.foreignCards > 0)
      problems.push(`recycle ${recycle.recycleId} removed ${recycle.foreignCards} cards of another entry`);
  }
  if (facts.unclaimedCredits > 0)
    problems.push(`${facts.unclaimedCredits} recycle credits without a recycle`);
  if (facts.unexplainedRemovals > 0) problems.push(`${facts.unexplainedRemovals} cards removed by nothing`);
  if (facts.escrowedCards > 0) problems.push(`${facts.escrowedCards} cards in escrow`);
  return problems;
}

/**
 * Recycles and shop openings recorded at a value other than today's, as
 * short phrases: information for the owner after a change of the
 * constants, never a failure.
 */
export function valueChanges(facts: Pick<AccountFacts, "shopOpenings" | "recycles">): string[] {
  const changes: string[] = [];
  for (const opening of facts.shopOpenings) {
    if (opening.price !== THEMED_PACK_PRICE)
      changes.push(`shop opening ${opening.openingId} sold at ${opening.price}, today ${THEMED_PACK_PRICE}`);
  }
  for (const recycle of facts.recycles) {
    const today = RECYCLE_VALUE[recycle.rarity];
    if (recycle.unitValue !== today)
      changes.push(`recycle ${recycle.recycleId} at ${recycle.unitValue} a card, today ${today}`);
  }
  return changes;
}

export interface AuditAccountReport {
  id: string;
  login: string;
  lines: string[];
}

export interface AuditResult {
  accounts: number;
  entries: number;
  failures: AuditAccountReport[];
  /** Accounts with a value that differs from today's (`valueChanges`); they may also fail. */
  notes: AuditAccountReport[];
}

/** A row as a raw query returns it: its account, and its `createdAt` as Postgres's text. */
type RawRow<T extends { createdAt: Date }> = Omit<T, "createdAt"> & { accountId: string; createdAt: string };

function withDates<T extends { createdAt: Date }>(
  row: RawRow<T>,
): Omit<T, "createdAt"> & {
  accountId: string;
  createdAt: Date;
} {
  return { ...row, createdAt: new Date(row.createdAt) };
}

function grouped<T extends { accountId: string }>(rows: readonly T[]): Map<string, T[]> {
  const byAccount = new Map<string, T[]>();
  for (const row of rows) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
  return byAccount;
}

/**
 * Reads everything the checks need in one read-only, repeatable-read
 * transaction, so the audit sees one consistent moment even while the game
 * runs, and audits every account.
 */
export async function auditLedger(db: Db): Promise<AuditResult> {
  return db.transaction(
    async (tx) => {
      const owners = await tx
        .select({
          id: accounts.id,
          login: accounts.login,
          balance: accounts.balance,
          lastResetAt: accounts.lastResetAt,
        })
        .from(accounts)
        .orderBy(asc(accounts.loginNormalized));
      const entries = await tx
        .select({
          accountId: ledgerEntries.accountId,
          id: ledgerEntries.id,
          seq: ledgerEntries.seq,
          kind: ledgerEntries.kind,
          amount: ledgerEntries.amount,
          balanceAfter: ledgerEntries.balanceAfter,
        })
        .from(ledgerEntries)
        .orderBy(asc(ledgerEntries.accountId), asc(ledgerEntries.seq));
      const shopOpenings = await tx.execute<AuditShopOpening & { accountId: string }>(sql`
        select o.account_id as "accountId", o.id as "openingId", o.price, e.account_id as "entryAccountId",
               e.kind as "entryKind", e.amount as "entryAmount"
        from pack_openings o left join ledger_entries e on e.id = o.ledger_entry_id
        where o.source = 'shop'
      `);
      // A raw query hands timestamps back as text (drizzle's node-postgres parsers); `withDates` makes them Dates.
      const recycled = await tx.execute<RawRow<AuditRecycle>>(sql`
        select r.account_id as "accountId", r.id as "recycleId", r.rarity, r.count, r.unit_value as "unitValue",
               e.account_id as "entryAccountId", e.kind as "entryKind", e.amount as "entryAmount",
               (select count(*)::int from cards c where c.removed_by_recycle = r.id) as "removedCards",
               (select count(*)::int from cards c where c.removed_by_recycle = r.id
                 and (c.account_id <> r.account_id or c.character_id <> r.character_id
                      or c.rarity <> r.rarity or c.variant <> 'standard' or c.removed_at is null)) as "foreignCards",
               r.created_at as "createdAt"
        from recycles r join ledger_entries e on e.id = r.ledger_entry_id
      `);
      const unclaimedDebits = await tx.execute<RawRow<AuditUnclaimedDebit>>(sql`
        select e.account_id as "accountId", e.seq, e.created_at as "createdAt"
        from ledger_entries e
        where e.kind = 'shop_purchase'
          and not exists (select 1 from pack_openings o where o.ledger_entry_id = e.id)
        order by e.account_id, e.seq
      `);
      const counts = await tx.execute<{
        accountId: string;
        unclaimedCredits: number;
        unexplainedRemovals: number;
        escrowedCards: number;
      }>(sql`
        select a.id as "accountId",
          (select count(*)::int from ledger_entries e
            where e.account_id = a.id and e.kind = 'recycle_credit'
              and not exists (select 1 from recycles r where r.ledger_entry_id = e.id)) as "unclaimedCredits",
          (select count(*)::int from cards c
            where c.account_id = a.id and c.removed_at is not null and c.removed_by_recycle is null)
            as "unexplainedRemovals",
          (select count(*)::int from cards c where c.account_id = a.id and c.escrow_id is not null)
            as "escrowedCards"
        from accounts a
      `);

      const entriesOf = grouped(entries);
      const openingsOf = grouped(shopOpenings.rows);
      const recyclesOf = grouped(recycled.rows.map(withDates));
      const unclaimedDebitsOf = grouped(unclaimedDebits.rows.map(withDates));
      const countsOf = new Map(counts.rows.map((row) => [row.accountId, row]));
      const failures: AuditAccountReport[] = [];
      const notes: AuditAccountReport[] = [];
      for (const owner of owners) {
        const tally = countsOf.get(owner.id);
        const facts: AccountFacts = {
          ...owner,
          entries: entriesOf.get(owner.id) ?? [],
          shopOpenings: openingsOf.get(owner.id) ?? [],
          recycles: recyclesOf.get(owner.id) ?? [],
          unclaimedCredits: tally?.unclaimedCredits ?? 0,
          unclaimedShopDebits: unclaimedDebitsOf.get(owner.id) ?? [],
          unexplainedRemovals: tally?.unexplainedRemovals ?? 0,
          escrowedCards: tally?.escrowedCards ?? 0,
        };
        const problems = auditAccount(facts);
        if (problems.length > 0) failures.push({ id: owner.id, login: owner.login, lines: problems });
        const changes = valueChanges(facts);
        if (changes.length > 0) notes.push({ id: owner.id, login: owner.login, lines: changes });
      }
      return { accounts: owners.length, entries: entries.length, failures, notes };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
