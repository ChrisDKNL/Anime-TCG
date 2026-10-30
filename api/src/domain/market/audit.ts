import { MARKET_PRICE_MAX, MARKET_PRICE_MIN } from "@anime-tcg/shared/economy";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";

/**
 * `audit-market` (economy.md §10, §13.3): the owner's report on Karma moving
 * between accounts, read-only. Every finding is a heuristic for the owner to
 * judge, never a failure: the server cannot tell two people from one person
 * with two accounts. The report is a pure function of the trades, so each
 * section is unit-tested on its own.
 */

const DAY_MS = 86_400_000;
/** The short window of the net flow, the market limits' own (§5). */
const WEEK_DAYS = 7;
/** A purchase this soon after its listing looks arranged (§10). */
export const QUICK_BUY_SECONDS = 60;

/** One purchase between two accounts that both still exist. */
export interface Trade {
  purchaseId: string;
  buyerId: string;
  sellerId: string;
  rarity: Rarity;
  price: number;
  boughtAt: Date;
  /** When the listing was made; null once its seller deleted it, which cannot happen while the seller exists. */
  listedAt: Date | null;
}

/** An account as the report names it; `inviteCodeHash` is the audit trail of the code that admitted it. */
export interface Trader {
  id: string;
  login: string;
  inviteCodeHash: string;
}

/** One finding: the accounts it names, by id, and the words around them. */
export interface Finding {
  text: string;
  accounts: string[];
}

export interface MarketReport {
  /** Net Karma per pair over 7 days and over the report's days, largest first. */
  netWeek: Finding[];
  netPeriod: Finding[];
  /** Pairs where one side makes more than half of the other's market volume. */
  dominantPairs: Finding[];
  /** Per seller, sales at the floor and at the cap of their tier. */
  atBounds: Finding[];
  /** Listings bought within `QUICK_BUY_SECONDS` of being listed. */
  quickBuys: Finding[];
  /** Pairs that traded and registered with the same invite code. */
  sameInvite: Finding[];
}

/** The two accounts of a pair, lower id first, as one key. */
function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function since(trades: readonly Trade[], now: Date, days: number): Trade[] {
  const from = now.getTime() - days * DAY_MS;
  return trades.filter((trade) => trade.boughtAt.getTime() > from);
}

/** Per pair: what the lower id paid the higher, what the higher paid the lower, and how many trades. */
function pairFlows(trades: readonly Trade[]) {
  const flows = new Map<
    string,
    { low: string; high: string; lowPaid: number; highPaid: number; trades: number }
  >();
  for (const trade of trades) {
    const [low, high] = pairKey(trade.buyerId, trade.sellerId);
    const key = `${low} ${high}`;
    const flow = flows.get(key) ?? { low, high, lowPaid: 0, highPaid: 0, trades: 0 };
    if (trade.buyerId === low) flow.lowPaid += trade.price;
    else flow.highPaid += trade.price;
    flow.trades += 1;
    flows.set(key, flow);
  }
  return [...flows.values()];
}

function netFlows(trades: readonly Trade[], days: number): Finding[] {
  return pairFlows(trades)
    .map((flow) => {
      const net = flow.lowPaid - flow.highPaid;
      // Karma goes to the seller: a positive net means the lower id paid the higher one more.
      const [from, to] = net >= 0 ? [flow.low, flow.high] : [flow.high, flow.low];
      return {
        net: Math.abs(net),
        finding: {
          text: `{0} paid {1} a net ${Math.abs(net)} Karma over ${days} days (${flow.lowPaid + flow.highPaid} gross in ${flow.trades} purchases)`,
          accounts: [from, to],
        },
      };
    })
    .sort((a, b) => b.net - a.net || a.finding.accounts.join().localeCompare(b.finding.accounts.join()))
    .map(({ finding }) => finding);
}

function dominantPairs(trades: readonly Trade[], days: number): Finding[] {
  const volume = new Map<string, number>();
  for (const trade of trades) {
    volume.set(trade.buyerId, (volume.get(trade.buyerId) ?? 0) + trade.price);
    volume.set(trade.sellerId, (volume.get(trade.sellerId) ?? 0) + trade.price);
  }
  const findings: Finding[] = [];
  for (const flow of pairFlows(trades)) {
    const together = flow.lowPaid + flow.highPaid;
    for (const [side, other] of [
      [flow.low, flow.high],
      [flow.high, flow.low],
    ] as const) {
      const own = volume.get(side) ?? 0;
      // More than half, in integers: twice the pair's volume above the account's whole volume.
      if (own > 0 && 2 * together > own) {
        findings.push({
          text: `{0} makes ${Math.floor((100 * together) / own)} % of {1}'s market volume over ${days} days (${together} of ${own} Karma)`,
          accounts: [other, side],
        });
      }
    }
  }
  return findings.sort((a, b) => a.accounts.join().localeCompare(b.accounts.join()));
}

function atBounds(trades: readonly Trade[], days: number): Finding[] {
  const bySeller = new Map<string, { floor: number; cap: number }>();
  for (const trade of trades) {
    const counts = bySeller.get(trade.sellerId) ?? { floor: 0, cap: 0 };
    if (trade.price === MARKET_PRICE_MIN[trade.rarity]) counts.floor += 1;
    if (trade.price === MARKET_PRICE_MAX[trade.rarity]) counts.cap += 1;
    bySeller.set(trade.sellerId, counts);
  }
  return [...bySeller.entries()]
    .filter(([, counts]) => counts.floor + counts.cap > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sellerId, counts]) => ({
      text: `{0} sold ${counts.floor} cards at the floor and ${counts.cap} at the cap over ${days} days`,
      accounts: [sellerId],
    }));
}

function quickBuys(trades: readonly Trade[]): Finding[] {
  return trades
    .filter(
      (trade) =>
        trade.listedAt !== null &&
        trade.boughtAt.getTime() - trade.listedAt.getTime() <= QUICK_BUY_SECONDS * 1_000,
    )
    .sort((a, b) => a.boughtAt.getTime() - b.boughtAt.getTime())
    .map((trade) => ({
      text: `{0} bought from {1} ${Math.round((trade.boughtAt.getTime() - (trade.listedAt?.getTime() ?? 0)) / 1_000)} s after the listing (purchase ${trade.purchaseId}, ${trade.price} Karma)`,
      accounts: [trade.buyerId, trade.sellerId],
    }));
}

function sameInvite(trades: readonly Trade[], traders: ReadonlyMap<string, Trader>, days: number): Finding[] {
  return pairFlows(trades)
    .filter((flow) => {
      const [low, high] = [traders.get(flow.low), traders.get(flow.high)];
      return low !== undefined && high !== undefined && low.inviteCodeHash === high.inviteCodeHash;
    })
    .map((flow) => ({
      text: `{0} and {1} registered with the same invite code and traded ${flow.trades} times over ${days} days`,
      accounts: [flow.low, flow.high],
    }));
}

/** The §13.3 report over the last `days` days, with the net flow also over the last 7. */
export function marketReport(
  trades: readonly Trade[],
  traders: ReadonlyMap<string, Trader>,
  now: Date,
  days: number,
): MarketReport {
  const period = since(trades, now, days);
  return {
    netWeek: netFlows(since(trades, now, WEEK_DAYS), WEEK_DAYS),
    netPeriod: netFlows(period, days),
    dominantPairs: dominantPairs(period, days),
    atBounds: atBounds(period, days),
    quickBuys: quickBuys(period),
    sameInvite: sameInvite(period, traders, days),
  };
}

export function isEmpty(report: MarketReport): boolean {
  return Object.values(report).every((findings: Finding[]) => findings.length === 0);
}

/** Reads the trades of the last `days` days (at least 7) between accounts that both still exist, and every account. */
export async function readTrades(
  db: Db,
  now: Date,
  days: number,
): Promise<{ trades: Trade[]; traders: Map<string, Trader> }> {
  return db.transaction(
    async (tx) => {
      const from = new Date(now.getTime() - Math.max(days, WEEK_DAYS) * DAY_MS);
      const trades = await tx.execute<{
        purchaseId: string;
        buyerId: string;
        sellerId: string;
        rarity: Rarity;
        price: number;
        boughtAt: string;
        listedAt: string | null;
      }>(sql`
        select p.id as "purchaseId", p.buyer_id as "buyerId", p.seller_id as "sellerId", p.rarity, p.price,
               p.created_at as "boughtAt", l.created_at as "listedAt"
        from market_purchases p left join market_listings l on l.id = p.listing_id
        where p.seller_id is not null and p.created_at > ${from}
        order by p.created_at, p.id
      `);
      const traders = await tx.execute<{ id: string; login: string; inviteCodeHash: string }>(sql`
        select id, login, invite_code_hash as "inviteCodeHash" from accounts
      `);
      return {
        trades: trades.rows.map((row) => ({
          ...row,
          boughtAt: new Date(row.boughtAt),
          listedAt: row.listedAt === null ? null : new Date(row.listedAt),
        })),
        traders: new Map(traders.rows.map((row) => [row.id, row])),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
