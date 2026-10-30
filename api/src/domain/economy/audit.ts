import { RECYCLE_VALUE, THEMED_PACK_PRICE } from "@anime-tcg/shared/economy";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { asc, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { accounts, ledgerEntries } from "../../db/schema.js";
import { marketFee } from "./fee.js";
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

/**
 * A market purchase the account made (economy.md §7, §8.5): its three
 * ledger rows, its listing and the two cards it moved. The seller's side is
 * null once the seller's account is deleted; the listing goes with it.
 */
export type AuditPurchase = {
  purchaseId: string;
  price: number;
  fee: number;
  createdAt: Date;
  sellerId: string | null;
  /** The seller's last reset, which deletes the card the purchase removed. */
  sellerLastResetAt: Date | null;
  buyerEntryAccountId: string;
  buyerEntryKind: LedgerKind;
  buyerEntryAmount: number;
  saleEntryAccountId: string | null;
  saleEntryKind: LedgerKind | null;
  saleEntryAmount: number | null;
  feeEntryAccountId: string | null;
  feeEntryKind: LedgerKind | null;
  feeEntryAmount: number | null;
  listingSellerId: string | null;
  listingStatus: string | null;
  listingPrice: number | null;
  listingFee: number | null;
  /** The cards that name it as their origin, and those of them that are not the buyer's copy of its entry. */
  deliveredCards: number;
  foreignDeliveredCards: number;
  /** The cards that name it as their remover, and those of them that are not a removed copy of the seller's. */
  removedCards: number;
  foreignRemovedCards: number;
};

/** A listing the account sold whose purchase went with its buyer's account: the sale and fee rows it leaves behind. */
export type AuditBuyerlessSale = { listingId: string; price: number; fee: number; cardHeld: boolean };

/** A listing's price and the fee it fixed when listed. */
export type AuditListingFee = { listingId: string; price: number; fee: number };

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
  /** Cards marked removed with nothing that removed them, a card sold to an account since deleted excepted. */
  unexplainedRemovals: number;
  /** The market purchases this account made. */
  purchases: AuditPurchase[];
  /** `market_purchase` rows no purchase names. */
  unclaimedMarketDebits: number;
  /** Amounts of the `market_sale` rows, and of the `market_fee` rows negated, that no purchase names. */
  unclaimedSales: number[];
  unclaimedFees: number[];
  /** Sold listings of this account that no purchase names: their buyer's account was deleted. */
  buyerlessSales: AuditBuyerlessSale[];
  /** Ids of live listings whose card is not a held, unescrowed copy of the listed entry of the seller's. */
  unsellableListings: string[];
  /** Every listing's price and fee, for the notes. */
  listingFees: AuditListingFee[];
  /** Ids of the account's cards pulled, or from an opening made, before its last reset, which deletes every card. */
  cardsBeforeReset: string[];
  escrowedCards: number;
}

const ascending = (values: readonly number[]) => [...values].sort((a, b) => a - b);

function sameAmounts(a: readonly number[], b: readonly number[]): boolean {
  const [left, right] = [ascending(a), ascending(b)];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** One purchase against its three rows, its listing and the two cards it moved (economy.md §7, §8.5). */
function purchaseProblems(
  facts: AccountFacts,
  purchase: AuditPurchase,
  emptiedByReset: (createdAt: Date) => boolean,
): string[] {
  const problems: string[] = [];
  const name = `purchase ${purchase.purchaseId}`;
  if (
    purchase.buyerEntryAccountId !== facts.id ||
    purchase.buyerEntryKind !== "market_purchase" ||
    purchase.buyerEntryAmount !== -purchase.price
  )
    problems.push(`${name} without its debit of ${purchase.price}`);
  if (purchase.sellerId !== null) {
    if (
      purchase.saleEntryAccountId !== purchase.sellerId ||
      purchase.saleEntryKind !== "market_sale" ||
      purchase.saleEntryAmount !== purchase.price
    )
      problems.push(`${name} without the seller's sale of ${purchase.price}`);
    if (
      purchase.feeEntryAccountId !== purchase.sellerId ||
      purchase.feeEntryKind !== "market_fee" ||
      purchase.feeEntryAmount !== -purchase.fee
    )
      problems.push(`${name} without the seller's fee of ${purchase.fee}`);
    if (
      purchase.listingStatus !== "sold" ||
      purchase.listingSellerId !== purchase.sellerId ||
      purchase.listingPrice !== purchase.price ||
      purchase.listingFee !== purchase.fee
    )
      problems.push(`${name} does not match its listing`);
  }
  // The bought card goes only with a reset of the buyer after the purchase.
  const delivered =
    purchase.deliveredCards === 1 || (purchase.deliveredCards === 0 && emptiedByReset(purchase.createdAt));
  if (!delivered) problems.push(`${name} delivered ${purchase.deliveredCards} cards, not 1`);
  if (purchase.foreignDeliveredCards > 0) problems.push(`${name} delivered a card of another entry`);
  // The sold card goes with the seller's account, or with a reset of the seller after the sale.
  const sellerGone =
    purchase.sellerId === null ||
    (purchase.sellerLastResetAt !== null &&
      purchase.createdAt.getTime() <= purchase.sellerLastResetAt.getTime());
  const removed = purchase.removedCards === 1 || (purchase.removedCards === 0 && sellerGone);
  if (!removed) problems.push(`${name} removed ${purchase.removedCards} of the seller's cards, not 1`);
  if (purchase.foreignRemovedCards > 0) problems.push(`${name} removed a card that was not the one it sold`);
  return problems;
}

/**
 * The market's part of one account's audit (economy.md §13.1, PR 3): each
 * purchase it made, and every market row of its own that no purchase names.
 * A sale and its fee without a purchase pass only as the rows a listing
 * sold to a since deleted account leaves behind, amount for amount.
 */
function marketProblems(facts: AccountFacts, emptiedByReset: (createdAt: Date) => boolean): string[] {
  const problems = facts.purchases.flatMap((purchase) => purchaseProblems(facts, purchase, emptiedByReset));
  if (facts.unclaimedMarketDebits > 0)
    problems.push(`${facts.unclaimedMarketDebits} market purchase debits without a purchase`);
  const buyerless = facts.buyerlessSales;
  const salesExplained = sameAmounts(
    facts.unclaimedSales,
    buyerless.map((sale) => sale.price),
  );
  const feesExplained = sameAmounts(
    facts.unclaimedFees,
    buyerless.map((sale) => sale.fee),
  );
  if (!salesExplained || !feesExplained)
    problems.push(
      `${facts.unclaimedSales.length} market sales and ${facts.unclaimedFees.length} fees without a purchase, for ${buyerless.length} listings sold to deleted accounts`,
    );
  for (const sale of buyerless) {
    if (sale.cardHeld) problems.push(`listing ${sale.listingId} sold, but its card is still held`);
  }
  for (const listingId of facts.unsellableListings)
    problems.push(`listing ${listingId} is live, but its card is not the seller's to sell`);
  return problems;
}

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
  problems.push(...marketProblems(facts, emptiedByReset));
  if (facts.unexplainedRemovals > 0) problems.push(`${facts.unexplainedRemovals} cards removed by nothing`);
  // A reset deletes every card, so one older than it means the reset time is forged or the cards came back (manager decision, 2026-10-30).
  for (const cardId of facts.cardsBeforeReset) problems.push(`card ${cardId} predates the last reset`);
  if (facts.escrowedCards > 0) problems.push(`${facts.escrowedCards} cards in escrow`);
  return problems;
}

/**
 * Recycles and shop openings recorded at a value other than today's, as
 * short phrases: information for the owner after a change of the
 * constants, never a failure.
 */
export function valueChanges(
  facts: Pick<AccountFacts, "shopOpenings" | "recycles" | "listingFees">,
): string[] {
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
  for (const listing of facts.listingFees) {
    const today = marketFee(listing.price);
    if (listing.fee !== today)
      changes.push(`listing ${listing.listingId} at a fee of ${listing.fee}, today ${today}`);
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

/** A purchase as the raw query returns it: its buyer, and its two times as Postgres's text. */
type RawPurchase = Omit<AuditPurchase, "createdAt" | "sellerLastResetAt"> & {
  accountId: string;
  createdAt: string;
  sellerLastResetAt: string | null;
};

/** A sold listing of this card whose purchase went with its buyer's account: why a sold card can name no purchase. */
const BUYERLESS_SALE_OF_CARD = sql`select 1 from market_listings l
  where l.card_id = c.id and l.status = 'sold'
    and not exists (select 1 from market_purchases p where p.listing_id = l.id)`;

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
      const beforeReset = await tx.execute<{ accountId: string; cardId: string }>(sql`
        select c.account_id as "accountId", c.id as "cardId"
        from cards c
        join accounts a on a.id = c.account_id
        left join pack_openings o on o.id = c.opening_id
        where a.last_reset_at is not null
          and (c.pulled_at < a.last_reset_at or o.opened_at < a.last_reset_at)
        order by c.account_id, c.pulled_at, c.id
      `);
      const counts = await tx.execute<{
        accountId: string;
        unclaimedCredits: number;
        unexplainedRemovals: number;
        escrowedCards: number;
        unclaimedMarketDebits: number;
      }>(sql`
        select a.id as "accountId",
          (select count(*)::int from ledger_entries e
            where e.account_id = a.id and e.kind = 'recycle_credit'
              and not exists (select 1 from recycles r where r.ledger_entry_id = e.id)) as "unclaimedCredits",
          (select count(*)::int from cards c
            where c.account_id = a.id and c.removed_at is not null
              and c.removed_by_recycle is null and c.removed_by_purchase is null
              and not exists (${BUYERLESS_SALE_OF_CARD}))
            as "unexplainedRemovals",
          (select count(*)::int from cards c where c.account_id = a.id and c.escrow_id is not null)
            as "escrowedCards",
          (select count(*)::int from ledger_entries e
            where e.account_id = a.id and e.kind = 'market_purchase'
              and not exists (select 1 from market_purchases p where p.buyer_entry_id = e.id))
            as "unclaimedMarketDebits"
        from accounts a
      `);
      const purchases = await tx.execute<RawPurchase>(sql`
        select p.buyer_id as "accountId", p.id as "purchaseId", p.price, p.fee, p.created_at as "createdAt",
               p.seller_id as "sellerId", sa.last_reset_at as "sellerLastResetAt",
               be.account_id as "buyerEntryAccountId", be.kind as "buyerEntryKind", be.amount as "buyerEntryAmount",
               se.account_id as "saleEntryAccountId", se.kind as "saleEntryKind", se.amount as "saleEntryAmount",
               fe.account_id as "feeEntryAccountId", fe.kind as "feeEntryKind", fe.amount as "feeEntryAmount",
               l.seller_id as "listingSellerId", l.status as "listingStatus", l.price as "listingPrice",
               l.fee as "listingFee",
               (select count(*)::int from cards c where c.purchase_id = p.id) as "deliveredCards",
               (select count(*)::int from cards c where c.purchase_id = p.id
                 and (c.account_id <> p.buyer_id or c.character_id <> p.character_id
                      or c.rarity <> p.rarity or c.variant <> p.variant)) as "foreignDeliveredCards",
               (select count(*)::int from cards c where c.removed_by_purchase = p.id) as "removedCards",
               (select count(*)::int from cards c where c.removed_by_purchase = p.id
                 and (c.account_id is distinct from p.seller_id or c.character_id <> p.character_id
                      or c.rarity <> p.rarity or c.variant <> p.variant or c.removed_at is null))
                 as "foreignRemovedCards"
        from market_purchases p
        join ledger_entries be on be.id = p.buyer_entry_id
        left join ledger_entries se on se.id = p.seller_sale_entry_id
        left join ledger_entries fe on fe.id = p.seller_fee_entry_id
        left join market_listings l on l.id = p.listing_id
        left join accounts sa on sa.id = p.seller_id
        order by p.buyer_id, p.created_at, p.id
      `);
      const unclaimedMarket = await tx.execute<{ accountId: string; kind: LedgerKind; amount: number }>(sql`
        select e.account_id as "accountId", e.kind, e.amount from ledger_entries e
        where (e.kind = 'market_sale'
                and not exists (select 1 from market_purchases p where p.seller_sale_entry_id = e.id))
           or (e.kind = 'market_fee'
                and not exists (select 1 from market_purchases p where p.seller_fee_entry_id = e.id))
      `);
      const buyerless = await tx.execute<AuditBuyerlessSale & { accountId: string }>(sql`
        select l.seller_id as "accountId", l.id as "listingId", l.price, l.fee,
               (c.id is not null and c.removed_at is null) as "cardHeld"
        from market_listings l left join cards c on c.id = l.card_id
        where l.status = 'sold' and not exists (select 1 from market_purchases p where p.listing_id = l.id)
      `);
      const unsellable = await tx.execute<{ accountId: string; listingId: string }>(sql`
        select l.seller_id as "accountId", l.id as "listingId"
        from market_listings l left join cards c on c.id = l.card_id
        where l.status = 'active' and l.expires_at > now()
          and (c.id is null or c.account_id <> l.seller_id or c.removed_at is not null
               or c.escrow_id is not null or c.character_id <> l.character_id
               or c.rarity <> l.rarity or c.variant <> l.variant)
      `);
      const listingFees = await tx.execute<AuditListingFee & { accountId: string }>(sql`
        select seller_id as "accountId", id as "listingId", price, fee from market_listings
      `);

      const entriesOf = grouped(entries);
      const openingsOf = grouped(shopOpenings.rows);
      const recyclesOf = grouped(recycled.rows.map(withDates));
      const unclaimedDebitsOf = grouped(unclaimedDebits.rows.map(withDates));
      const beforeResetOf = grouped(beforeReset.rows);
      const countsOf = new Map(counts.rows.map((row) => [row.accountId, row]));
      const purchasesOf = grouped(
        purchases.rows.map((row): AuditPurchase & { accountId: string } => ({
          ...row,
          createdAt: new Date(row.createdAt),
          sellerLastResetAt: row.sellerLastResetAt === null ? null : new Date(row.sellerLastResetAt),
        })),
      );
      const unclaimedMarketOf = grouped(unclaimedMarket.rows);
      const buyerlessOf = grouped(buyerless.rows);
      const unsellableOf = grouped(unsellable.rows);
      const listingFeesOf = grouped(listingFees.rows);
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
          cardsBeforeReset: (beforeResetOf.get(owner.id) ?? []).map((row) => row.cardId),
          escrowedCards: tally?.escrowedCards ?? 0,
          purchases: purchasesOf.get(owner.id) ?? [],
          unclaimedMarketDebits: tally?.unclaimedMarketDebits ?? 0,
          unclaimedSales: (unclaimedMarketOf.get(owner.id) ?? [])
            .filter((row) => row.kind === "market_sale")
            .map((row) => row.amount),
          unclaimedFees: (unclaimedMarketOf.get(owner.id) ?? [])
            .filter((row) => row.kind === "market_fee")
            .map((row) => -row.amount),
          buyerlessSales: buyerlessOf.get(owner.id) ?? [],
          unsellableListings: (unsellableOf.get(owner.id) ?? []).map((row) => row.listingId),
          listingFees: listingFeesOf.get(owner.id) ?? [],
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
