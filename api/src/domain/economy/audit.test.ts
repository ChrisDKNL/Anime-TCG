import { describe, expect, it } from "vitest";
import { RECYCLE_VALUE, THEMED_PACK_PRICE } from "@anime-tcg/shared/economy";
import { describeAudit, describeNotes } from "../../cli/audit-ledger.js";
import {
  type AccountFacts,
  type AuditEntry,
  type AuditPurchase,
  auditAccount,
  valueChanges,
} from "./audit.js";

const ID = "00000000-0000-4000-8000-000000000001";
/** When the fixture's rows were written; a reset is placed before or after it. */
const WRITTEN = new Date("2026-11-01T09:00:00.000Z");
const BEFORE = new Date(WRITTEN.getTime() - 60_000);
const AFTER = new Date(WRITTEN.getTime() + 60_000);

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
    lastResetAt: null,
    entries,
    shopOpenings: [
      { openingId: "o1", price: 400, entryAccountId: ID, entryKind: "shop_purchase", entryAmount: -400 },
    ],
    recycles: [
      {
        recycleId: "r1",
        rarity: "mythic",
        count: 1,
        unitValue: 2_750,
        entryAccountId: ID,
        entryKind: "recycle_credit",
        entryAmount: 2_750,
        removedCards: 1,
        foreignCards: 0,
        createdAt: WRITTEN,
      },
      {
        recycleId: "r2",
        rarity: "common",
        count: 2,
        unitValue: 2,
        entryAccountId: ID,
        entryKind: "recycle_credit",
        entryAmount: 4,
        removedCards: 2,
        foreignCards: 0,
        createdAt: WRITTEN,
      },
    ],
    unclaimedCredits: 0,
    unclaimedShopDebits: [],
    unexplainedRemovals: 0,
    cardsBeforeReset: [],
    escrowedCards: 0,
    purchases: [],
    unclaimedMarketDebits: 0,
    unclaimedSales: [],
    unclaimedFees: [],
    buyerlessSales: [],
    unsellableListings: [],
    listingFees: [],
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

  it("finds an entry of the wrong sign, an owner reset that left Karma, and a market sale without its purchase", () => {
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
        facts({
          entries: chain(["market_sale", 10]),
          balance: 10,
          shopOpenings: [],
          recycles: [],
          unclaimedSales: [10],
        }),
      ),
    ).toEqual(["1 market sales and 0 fees without a purchase, for 0 listings sold to deleted accounts"]);
  });

  it("finds a shop opening without its debit, of another account, kind or amount", () => {
    for (const opening of [
      { openingId: "o1", price: 400, entryAccountId: null, entryKind: null, entryAmount: null },
      {
        openingId: "o1",
        price: 400,
        entryAccountId: "someone-else",
        entryKind: "shop_purchase" as const,
        entryAmount: -400,
      },
      {
        openingId: "o1",
        price: 400,
        entryAccountId: ID,
        entryKind: "owner_reset" as const,
        entryAmount: -400,
      },
      {
        openingId: "o1",
        price: 400,
        entryAccountId: ID,
        entryKind: "shop_purchase" as const,
        entryAmount: -399,
      },
    ]) {
      expect(auditAccount(facts({ shopOpenings: [opening] }))).toEqual([
        "shop opening o1 without its debit of 400",
      ]);
    }
  });

  it("checks a shop opening against the price it recorded, not today's", () => {
    const [opening] = facts().shopOpenings;
    if (opening === undefined) throw new Error("one opening");
    const entries = chain(["recycle_credit", 2_750], ["shop_purchase", -450], ["recycle_credit", 4]);
    const older = { ...opening, price: 450, entryAmount: -450 };
    expect(auditAccount(facts({ entries, balance: 2_304, shopOpenings: [older] }))).toEqual([]);
    expect(
      auditAccount(
        facts({ entries, balance: 2_304, shopOpenings: [{ ...older, price: THEMED_PACK_PRICE }] }),
      ),
    ).toEqual(["shop opening o1 without its debit of 400"]);
  });

  it("checks a recycle against the value per card it recorded, not today's", () => {
    const [mythic, common] = facts().recycles;
    if (mythic === undefined || common === undefined) throw new Error("two recycles");
    const entries = chain(["recycle_credit", 2_750], ["shop_purchase", -400], ["recycle_credit", 6]);
    const older = { ...common, unitValue: 3, entryAmount: 6 };
    expect(auditAccount(facts({ entries, balance: 2_356, recycles: [mythic, older] }))).toEqual([]);
    expect(
      auditAccount(
        facts({ entries, balance: 2_356, recycles: [mythic, { ...older, unitValue: RECYCLE_VALUE.common }] }),
      ),
    ).toEqual(["recycle r2 without its credit of 4"]);
  });

  it("finds a recycle without its credit of count × unit_value", () => {
    const [mythic, common] = facts().recycles;
    if (mythic === undefined || common === undefined) throw new Error("two recycles");
    expect(auditAccount(facts({ recycles: [{ ...mythic, entryAmount: 2_749 }, common] }))).toEqual([
      "recycle r1 without its credit of 2750",
    ]);
    expect(auditAccount(facts({ recycles: [{ ...mythic, entryAccountId: "x" }, common] }))).toEqual([
      "recycle r1 without its credit of 2750",
    ]);
  });

  it("finds a recycle that removed the wrong number of cards or another entry's", () => {
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
  });

  describe("a recycle without its cards, a shop debit without its opening, and the last reset (manager decision, 2026-10-30)", () => {
    const emptied = () => {
      const [mythic, common] = facts().recycles;
      if (mythic === undefined || common === undefined) throw new Error("two recycles");
      return [
        { ...mythic, removedCards: 0 },
        { ...common, removedCards: 0 },
      ];
    };
    const orphaned = { shopOpenings: [], unclaimedShopDebits: [{ seq: 2, createdAt: WRITTEN }] };

    it("passes both when a reset came after the rows, or at the same instant", () => {
      for (const lastResetAt of [AFTER, WRITTEN]) {
        expect(auditAccount(facts({ lastResetAt, recycles: emptied(), ...orphaned }))).toEqual([]);
      }
    });

    it("finds a recycle with no removed card on an account never reset, or reset before the recycle", () => {
      for (const lastResetAt of [null, BEFORE]) {
        expect(auditAccount(facts({ lastResetAt, recycles: emptied() }))).toEqual([
          "recycle r1 removed 0 cards, not 1, and no reset after it",
          "recycle r2 removed 0 cards, not 2, and no reset after it",
        ]);
      }
    });

    it("finds a shop debit whose opening is gone on an account never reset, or reset before the debit", () => {
      for (const lastResetAt of [null, BEFORE]) {
        expect(auditAccount(facts({ lastResetAt, ...orphaned }))).toEqual([
          "entry 2: shop_purchase without its opening, and no reset after it",
        ]);
      }
    });

    it("judges each row by its own time: one before the reset passes, one after it fails", () => {
      const [mythic, common] = emptied();
      if (mythic === undefined || common === undefined) throw new Error("two recycles");
      expect(
        auditAccount(
          facts({
            lastResetAt: WRITTEN,
            recycles: [mythic, { ...common, createdAt: AFTER }],
            shopOpenings: [],
            unclaimedShopDebits: [
              { seq: 2, createdAt: BEFORE },
              { seq: 3, createdAt: AFTER },
            ],
          }),
        ),
      ).toEqual([
        "entry 3: shop_purchase without its opening, and no reset after it",
        "recycle r2 removed 0 cards, not 2, and no reset after it",
      ]);
    });

    it("finds every card older than the last reset, one line each: a real reset leaves none", () => {
      expect(auditAccount(facts({ lastResetAt: AFTER, cardsBeforeReset: ["c1", "c2"] }))).toEqual([
        "card c1 predates the last reset",
        "card c2 predates the last reset",
      ]);
    });

    it("still counts a recycle's cards after a reset: some but not all is a failure, whenever it was", () => {
      const [mythic, common] = facts().recycles;
      if (mythic === undefined || common === undefined) throw new Error("two recycles");
      expect(
        auditAccount(facts({ lastResetAt: AFTER, recycles: [mythic, { ...common, removedCards: 1 }] })),
      ).toEqual(["recycle r2 removed 1 cards, not 2"]);
    });
  });

  it("finds a credit no recycle claims, a card removed by nothing and a card in escrow", () => {
    expect(auditAccount(facts({ unclaimedCredits: 1, unexplainedRemovals: 2, escrowedCards: 3 }))).toEqual([
      "1 recycle credits without a recycle",
      "2 cards removed by nothing",
      "3 cards in escrow",
    ]);
  });
});

describe("audit-ledger's market checks (economy.md §7, §13.1, PR 3)", () => {
  const SELLER = "00000000-0000-4000-8000-000000000002";

  /** A Mythic bought at the cap: the buyer's debit, the seller's sale and fee, a sold listing, one card each way. */
  function purchase(overrides: Partial<AuditPurchase> = {}): AuditPurchase {
    return {
      purchaseId: "p1",
      price: 27_500,
      fee: 1_375,
      createdAt: WRITTEN,
      sellerId: SELLER,
      sellerLastResetAt: null,
      buyerEntryAccountId: ID,
      buyerEntryKind: "market_purchase",
      buyerEntryAmount: -27_500,
      saleEntryAccountId: SELLER,
      saleEntryKind: "market_sale",
      saleEntryAmount: 27_500,
      feeEntryAccountId: SELLER,
      feeEntryKind: "market_fee",
      feeEntryAmount: -1_375,
      listingSellerId: SELLER,
      listingStatus: "sold",
      listingPrice: 27_500,
      listingFee: 1_375,
      deliveredCards: 1,
      foreignDeliveredCards: 0,
      removedCards: 1,
      foreignRemovedCards: 0,
      ...overrides,
    };
  }

  /** The buyer's side: 27 500 Karma earned by recycling, then spent on the purchase. */
  const buyer = (overrides: Partial<AccountFacts> = {}) =>
    facts({
      entries: chain(["recycle_credit", 27_500], ["market_purchase", -27_500]),
      balance: 0,
      shopOpenings: [],
      recycles: [],
      purchases: [purchase()],
      ...overrides,
    });

  it("passes a purchase with its three rows, its sold listing and one card each way", () => {
    expect(auditAccount(buyer())).toEqual([]);
  });

  it("finds a purchase whose debit, sale or fee is missing, of another account, kind or amount", () => {
    expect(auditAccount(buyer({ purchases: [purchase({ buyerEntryAmount: -27_499 })] }))).toEqual([
      "purchase p1 without its debit of 27500",
    ]);
    expect(auditAccount(buyer({ purchases: [purchase({ buyerEntryAccountId: SELLER })] }))).toEqual([
      "purchase p1 without its debit of 27500",
    ]);
    expect(
      auditAccount(buyer({ purchases: [purchase({ saleEntryAccountId: null, saleEntryAmount: null })] })),
    ).toEqual(["purchase p1 without the seller's sale of 27500"]);
    expect(auditAccount(buyer({ purchases: [purchase({ feeEntryKind: "market_sale" })] }))).toEqual([
      "purchase p1 without the seller's fee of 1375",
    ]);
  });

  it("finds a purchase that does not match its listing's state, seller, price or fee", () => {
    for (const change of [
      { listingStatus: "active" },
      { listingStatus: null },
      { listingSellerId: ID },
      { listingPrice: 27_499 },
      { listingFee: 1 },
    ]) {
      expect(auditAccount(buyer({ purchases: [purchase(change)] })), JSON.stringify(change)).toEqual([
        "purchase p1 does not match its listing",
      ]);
    }
  });

  it("accepts a seller whose account went: no sale, no fee, no listing and no removed card are left", () => {
    const gone = purchase({
      sellerId: null,
      saleEntryAccountId: null,
      saleEntryKind: null,
      saleEntryAmount: null,
      feeEntryAccountId: null,
      feeEntryKind: null,
      feeEntryAmount: null,
      listingSellerId: null,
      listingStatus: null,
      listingPrice: null,
      listingFee: null,
      removedCards: 0,
    });
    expect(auditAccount(buyer({ purchases: [gone] }))).toEqual([]);
  });

  it("finds a missing or extra card each way, unless a reset after the purchase took it", () => {
    expect(auditAccount(buyer({ purchases: [purchase({ deliveredCards: 0 })] }))).toEqual([
      "purchase p1 delivered 0 cards, not 1",
    ]);
    expect(auditAccount(buyer({ purchases: [purchase({ deliveredCards: 0 })], lastResetAt: AFTER }))).toEqual(
      [],
    );
    expect(
      auditAccount(buyer({ purchases: [purchase({ deliveredCards: 0 })], lastResetAt: BEFORE })),
    ).toEqual(["purchase p1 delivered 0 cards, not 1"]);
    expect(auditAccount(buyer({ purchases: [purchase({ deliveredCards: 2 })] }))).toEqual([
      "purchase p1 delivered 2 cards, not 1",
    ]);
    expect(auditAccount(buyer({ purchases: [purchase({ removedCards: 0 })] }))).toEqual([
      "purchase p1 removed 0 of the seller's cards, not 1",
    ]);
    expect(
      auditAccount(buyer({ purchases: [purchase({ removedCards: 0, sellerLastResetAt: AFTER })] })),
    ).toEqual([]);
    expect(
      auditAccount(buyer({ purchases: [purchase({ removedCards: 0, sellerLastResetAt: BEFORE })] })),
    ).toEqual(["purchase p1 removed 0 of the seller's cards, not 1"]);
  });

  it("finds a purchase that delivered or removed a card of another entry or account", () => {
    expect(auditAccount(buyer({ purchases: [purchase({ foreignDeliveredCards: 1 })] }))).toEqual([
      "purchase p1 delivered a card of another entry",
    ]);
    expect(auditAccount(buyer({ purchases: [purchase({ foreignRemovedCards: 1 })] }))).toEqual([
      "purchase p1 removed a card that was not the one it sold",
    ]);
  });

  it("finds market debits without a purchase", () => {
    expect(auditAccount(buyer({ purchases: [], unclaimedMarketDebits: 1 }))).toEqual([
      "1 market purchase debits without a purchase",
    ]);
  });

  it("accepts a sale and fee without a purchase only as a listing sold to an account since deleted, amount for amount", () => {
    const seller = (overrides: Partial<AccountFacts>) =>
      facts({
        entries: chain(["market_sale", 25], ["market_fee", -2]),
        balance: 23,
        shopOpenings: [],
        recycles: [],
        unclaimedSales: [25],
        unclaimedFees: [2],
        ...overrides,
      });
    const buyerless = { listingId: "l1", price: 25, fee: 2, cardHeld: false };
    expect(auditAccount(seller({ buyerlessSales: [buyerless] }))).toEqual([]);
    expect(auditAccount(seller({ buyerlessSales: [] }))).toEqual([
      "1 market sales and 1 fees without a purchase, for 0 listings sold to deleted accounts",
    ]);
    expect(auditAccount(seller({ buyerlessSales: [{ ...buyerless, price: 24 }] }))).toEqual([
      "1 market sales and 1 fees without a purchase, for 1 listings sold to deleted accounts",
    ]);
    expect(auditAccount(seller({ buyerlessSales: [{ ...buyerless, cardHeld: true }] }))).toEqual([
      "listing l1 sold, but its card is still held",
    ]);
  });

  it("finds a live listing whose card is not the seller's to sell", () => {
    expect(auditAccount(facts({ unsellableListings: ["l9"] }))).toEqual([
      "listing l9 is live, but its card is not the seller's to sell",
    ]);
  });
});

describe("values other than today's (economy.md §13.1)", () => {
  it("notes nothing when every row was recorded at today's values", () => {
    expect(valueChanges(facts())).toEqual([]);
    expect(valueChanges(facts({ shopOpenings: [], recycles: [] }))).toEqual([]);
  });

  it("notes each shop opening, recycle and listing fee recorded at another value, as information", () => {
    const base = facts();
    const [opening] = base.shopOpenings;
    const [mythic, common] = base.recycles;
    if (opening === undefined || mythic === undefined || common === undefined) throw new Error("fixture");
    expect(
      valueChanges({
        shopOpenings: [{ ...opening, price: 450 }],
        recycles: [mythic, { ...common, unitValue: 1 }],
        listingFees: [
          { listingId: "l1", price: 27_500, fee: 1_375 },
          { listingId: "l2", price: 100, fee: 4 },
        ],
      }),
    ).toEqual([
      `shop opening o1 sold at 450, today ${THEMED_PACK_PRICE}`,
      `recycle r2 at 1 a card, today ${RECYCLE_VALUE.common}`,
      "listing l2 at a fee of 4, today 5",
    ]);
  });
});

describe("the report", () => {
  it("prints the one line of a consistent ledger", () => {
    expect(describeAudit({ accounts: 10, entries: 1_234, failures: [], notes: [] })).toEqual([
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
            lines: ["balance 1 but the entries sum to 0", "3 cards in escrow"],
          },
        ],
        notes: [],
      }),
    ).toEqual([
      `Account "a\\u001b[2J\\u202e" (${ID}): balance 1 but the entries sum to 0; 3 cards in escrow.`,
    ]);
  });

  it("prints one note line per account with another day's value, and none without", () => {
    const notes = [{ id: ID, login: "Auditee", lines: ["shop opening o1 sold at 450, today 400"] }];
    expect(describeNotes({ accounts: 1, entries: 2, failures: [], notes })).toEqual([
      `Note: Account "Auditee" (${ID}): shop opening o1 sold at 450, today 400.`,
    ]);
    expect(describeNotes({ accounts: 1, entries: 2, failures: [], notes: [] })).toEqual([]);
  });
});
