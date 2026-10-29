import { MAX_BALANCE, MAX_ENTRY_AMOUNT } from "@anime-tcg/shared/economy";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import { CREDIT_KINDS, type LedgerKind, planEntry } from "./ledger.js";

const at = (balance: number, lastSeq = 0) => ({ balance, lastSeq });

function refusal(run: () => unknown): ApiError {
  try {
    run();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("the ledger function (economy.md §8.1)", () => {
  it("numbers rows 1, 2, 3 ... and chains balance_after", () => {
    expect(planEntry(at(0), "recycle_credit", 2)).toEqual({
      seq: 1,
      kind: "recycle_credit",
      amount: 2,
      balanceAfter: 2,
    });
    expect(planEntry(at(402, 7), "shop_purchase", -400)).toEqual({
      seq: 8,
      kind: "shop_purchase",
      amount: -400,
      balanceAfter: 2,
    });
  });

  it("debits down to exactly 0, and refuses one more with insufficient_funds carrying the balance", () => {
    expect(planEntry(at(400), "shop_purchase", -400).balanceAfter).toBe(0);
    const err = refusal(() => planEntry(at(399), "shop_purchase", -400));
    expect(err).toMatchObject({ statusCode: 409, code: "insufficient_funds", balance: 399 });
    expect(err.message).not.toMatch(/karma/i);
  });

  it("credits up to exactly MAX_BALANCE, and refuses one more with balance_limit", () => {
    expect(planEntry(at(MAX_BALANCE - 2), "recycle_credit", 2).balanceAfter).toBe(MAX_BALANCE);
    expect(refusal(() => planEntry(at(MAX_BALANCE - 1), "recycle_credit", 2))).toMatchObject({
      statusCode: 409,
      code: "balance_limit",
    });
  });

  it("bounds a single amount by MAX_ENTRY_AMOUNT, except an owner reset of the whole balance", () => {
    expect(planEntry(at(0), "recycle_credit", MAX_ENTRY_AMOUNT).balanceAfter).toBe(MAX_ENTRY_AMOUNT);
    expect(() => planEntry(at(0), "recycle_credit", MAX_ENTRY_AMOUNT + 1)).toThrow(RangeError);
    expect(() => planEntry(at(MAX_BALANCE), "shop_purchase", -MAX_ENTRY_AMOUNT - 1)).toThrow(RangeError);
    expect(planEntry(at(MAX_BALANCE, 3), "owner_reset", -MAX_BALANCE)).toEqual({
      seq: 4,
      kind: "owner_reset",
      amount: -MAX_BALANCE,
      balanceAfter: 0,
    });
  });

  it("holds every kind to its sign and never writes a zero", () => {
    const kinds: LedgerKind[] = [
      "recycle_credit",
      "shop_purchase",
      "market_purchase",
      "market_sale",
      "market_fee",
      "owner_reset",
    ];
    for (const kind of kinds) {
      const credit = CREDIT_KINDS.has(kind);
      expect(() => planEntry(at(100), kind, credit ? -1 : 1), kind).toThrow(RangeError);
      expect(planEntry(at(100), kind, credit ? 1 : -1).balanceAfter, kind).toBe(credit ? 101 : 99);
      expect(() => planEntry(at(100), kind, 0), kind).toThrow(RangeError);
    }
    expect([...CREDIT_KINDS].sort()).toEqual(["market_sale", "recycle_credit"]);
  });

  it.each([Number.NaN, Infinity, -Infinity, 1.5, -0.5, 2 ** 53, Number.MAX_SAFE_INTEGER + 2])(
    "refuses %s as an amount, a balance or a seq: Number.isSafeInteger guards every value",
    (value) => {
      expect(() => planEntry(at(100), "recycle_credit", value)).toThrow(RangeError);
      expect(() => planEntry(at(value), "recycle_credit", 1)).toThrow(RangeError);
      expect(() => planEntry(at(100, value), "recycle_credit", 1)).toThrow(RangeError);
    },
  );

  it("refuses a stored balance outside 0..MAX_BALANCE and a negative seq: the row is corrupt, not the request", () => {
    expect(() => planEntry(at(-1), "recycle_credit", 1)).toThrow(RangeError);
    expect(() => planEntry(at(MAX_BALANCE + 1), "shop_purchase", -1)).toThrow(RangeError);
    expect(() => planEntry(at(0, -1), "recycle_credit", 1)).toThrow(RangeError);
  });
});
