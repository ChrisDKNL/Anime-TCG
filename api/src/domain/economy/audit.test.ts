import { describe, expect, it } from "vitest";
import { describeAudit } from "../../cli/audit-ledger.js";
import { type AccountFacts, type AuditEntry, auditAccount } from "./audit.js";

const ID = "00000000-0000-4000-8000-000000000001";

function chain(...amounts: [AuditEntry["kind"], number][]): AuditEntry[] {
  let balance = 0;
  return amounts.map(([kind, amount], index) => {
    balance += amount;
    return { id: `e${index + 1}`, seq: index + 1, kind, amount, balanceAfter: balance };
  });
}

function facts(overrides: Partial<AccountFacts> = {}): AccountFacts {
  const entries = chain(["recycle_credit", 2_750], ["shop_purchase", -400], ["recycle_credit", 4]);
  return {
    id: ID,
    login: "Auditee",
    balance: 2_354,
    entries,
    shopOpenings: [{ openingId: "o1", entryAccountId: ID, entryKind: "shop_purchase", entryAmount: -400 }],
    recycles: [
      {
        recycleId: "r1",
        rarity: "mythic",
        count: 1,
        entryAccountId: ID,
        entryKind: "recycle_credit",
        entryAmount: 2_750,
        removedCards: 1,
        foreignCards: 0,
      },
      {
        recycleId: "r2",
        rarity: "common",
        count: 2,
        entryAccountId: ID,
        entryKind: "recycle_credit",
        entryAmount: 4,
        removedCards: 2,
        foreignCards: 0,
      },
    ],
    unclaimedCredits: 0,
    unexplainedRemovals: 0,
    escrowedCards: 0,
    ...overrides,
  };
}

describe("audit-ledger's checks (economy.md §7, §13.1)", () => {
  it("passes a consistent account, and one with no ledger at all", () => {
    expect(auditAccount(facts())).toEqual([]);
    expect(auditAccount(facts({ balance: 0, entries: [], shopOpenings: [], recycles: [] }))).toEqual([]);
  });

  it("finds a balance that is not the sum of its entries", () => {
    expect(auditAccount(facts({ balance: 2_355 }))).toEqual([
      "balance 2355 but the entries sum to 2354",
      "balance 2355 but the newest entry left 2354",
    ]);
  });

  it("finds a gap, a repeat and a row out of order in seq", () => {
    const entries = facts().entries;
    const [first, second, third] = entries;
    if (first === undefined || second === undefined || third === undefined) throw new Error("three entries");
    expect(auditAccount(facts({ entries: [first, { ...third, seq: 4 }], balance: 2_754 }))).toContain(
      "seq 4 where 2 was due",
    );
    expect(auditAccount(facts({ entries: [first, { ...second, seq: 1 }, third] }))).toContain(
      "seq 1 where 2 was due",
    );
  });

  it("finds an altered amount or balance_after: the chain breaks", () => {
    const [first, second, third] = facts().entries;
    if (first === undefined || second === undefined || third === undefined) throw new Error("three entries");
    expect(auditAccount(facts({ entries: [first, { ...second, amount: -300 }, third] }))).toContain(
      "entry 2: balance_after 2350 after 2750 and -300",
    );
    expect(
      auditAccount(facts({ entries: [first, second, { ...third, balanceAfter: 9 }], balance: 9 })),
    ).toContain("entry 3: balance_after 9 after 2350 and 4");
  });

  it("finds an entry of the wrong sign, an owner reset that left Karma, and a market row before the market", () => {
    expect(
      auditAccount(
        facts({ entries: chain(["shop_purchase", 5]), balance: 5, shopOpenings: [], recycles: [] }),
      ),
    ).toEqual(["entry 1: shop_purchase of 5"]);
    expect(
      auditAccount(
        facts({
          entries: chain(["recycle_credit", 2_750], ["owner_reset", -2_000]),
          balance: 750,
          shopOpenings: [],
          recycles: [],
        }),
      ),
    ).toEqual(["entry 2: an owner reset left 750"]);
    expect(
      auditAccount(
        facts({ entries: chain(["market_sale", 10]), balance: 10, shopOpenings: [], recycles: [] }),
      ),
    ).toEqual(["entry 1: market_sale before the market exists"]);
  });

  it("finds a shop opening without its debit, of another account, kind or amount", () => {
    for (const opening of [
      { openingId: "o1", entryAccountId: null, entryKind: null, entryAmount: null },
      {
        openingId: "o1",
        entryAccountId: "someone-else",
        entryKind: "shop_purchase" as const,
        entryAmount: -400,
      },
      { openingId: "o1", entryAccountId: ID, entryKind: "owner_reset" as const, entryAmount: -400 },
      { openingId: "o1", entryAccountId: ID, entryKind: "shop_purchase" as const, entryAmount: -399 },
    ]) {
      expect(auditAccount(facts({ shopOpenings: [opening] }))).toEqual([
        "shop opening o1 without its debit of 400",
      ]);
    }
  });

  it("finds a recycle without its credit of count × RECYCLE_VALUE", () => {
    const [mythic, common] = facts().recycles;
    if (mythic === undefined || common === undefined) throw new Error("two recycles");
    expect(auditAccount(facts({ recycles: [{ ...mythic, entryAmount: 2_749 }, common] }))).toEqual([
      "recycle r1 without its credit of 2750",
    ]);
    expect(auditAccount(facts({ recycles: [{ ...mythic, entryAccountId: "x" }, common] }))).toEqual([
      "recycle r1 without its credit of 2750",
    ]);
  });

  it("finds a recycle that removed the wrong number of cards or another entry's, and allows none after a reset", () => {
    const [mythic, common] = facts().recycles;
    if (mythic === undefined || common === undefined) throw new Error("two recycles");
    expect(auditAccount(facts({ recycles: [mythic, { ...common, removedCards: 1 }] }))).toEqual([
      "recycle r2 removed 1 cards, not 2",
    ]);
    expect(auditAccount(facts({ recycles: [mythic, { ...common, removedCards: 3 }] }))).toEqual([
      "recycle r2 removed 3 cards, not 2",
    ]);
    expect(auditAccount(facts({ recycles: [mythic, { ...common, foreignCards: 1 }] }))).toEqual([
      "recycle r2 removed 1 cards of another entry",
    ]);
    expect(
      auditAccount(
        facts({
          recycles: [
            { ...mythic, removedCards: 0 },
            { ...common, removedCards: 0 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("finds a credit no recycle claims, a card removed by nothing and a card in escrow", () => {
    expect(auditAccount(facts({ unclaimedCredits: 1, unexplainedRemovals: 2, escrowedCards: 3 }))).toEqual([
      "1 recycle credits without a recycle",
      "2 cards removed by nothing",
      "3 cards in escrow",
    ]);
  });
});

describe("the report", () => {
  it("prints the one line of a consistent ledger", () => {
    expect(describeAudit({ accounts: 10, entries: 1_234, failures: [] })).toEqual([
      "Ledger consistent: 10 accounts, 1234 entries.",
    ]);
  });

  it("prints one line per failing account, its login quoted and escaped", () => {
    expect(
      describeAudit({
        accounts: 2,
        entries: 3,
        failures: [
          {
            id: ID,
            login: "a\u001b[2J‮",
            problems: ["balance 1 but the entries sum to 0", "3 cards in escrow"],
          },
        ],
      }),
    ).toEqual([
      `Account "a\\u001b[2J\\u202e" (${ID}): balance 1 but the entries sum to 0; 3 cards in escrow.`,
    ]);
  });
});
