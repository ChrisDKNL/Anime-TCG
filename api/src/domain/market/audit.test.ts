import { MARKET_PRICE_MAX, MARKET_PRICE_MIN } from "@anime-tcg/shared/economy";
import { describe, expect, it } from "vitest";
import { describeMarketReport, parseDays } from "../../cli/audit-market.js";
import { isEmpty, marketReport, type Trade, type Trader } from "./audit.js";

const NOW = new Date("2026-11-30T12:00:00.000Z");
const DAY = 86_400_000;
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
/** An RTL override in a login, which the report must print escaped. */
const OVERRIDE = String.fromCodePoint(0x202e);
const traders = new Map<string, Trader>([
  [A, { id: A, login: `Alt${OVERRIDE}`, inviteCodeHash: "same" }],
  [B, { id: B, login: "Main", inviteCodeHash: "same" }],
  [C, { id: C, login: "Other", inviteCodeHash: "different" }],
]);
let counter = 0;
function trade(
  buyerId: string,
  sellerId: string,
  price: number,
  daysAgo: number,
  overrides: Partial<Trade> = {},
): Trade {
  counter += 1;
  const boughtAt = new Date(NOW.getTime() - daysAgo * DAY);
  return {
    purchaseId: `p${counter}`,
    buyerId,
    sellerId,
    rarity: "common",
    price,
    boughtAt,
    listedAt: new Date(boughtAt.getTime() - DAY),
    ...overrides,
  };
}

describe("audit-market's report (economy.md §10, §13.3)", () => {
  it("has no findings without trades, and says so in one line", () => {
    const report = marketReport([], traders, NOW, 30);
    expect(isEmpty(report)).toBe(true);
    expect(describeMarketReport(report, traders)).toEqual(["No findings."]);
  });

  it("nets each pair's flow over 7 days and over the period, largest first, in the direction Karma went", () => {
    const trades = [trade(A, B, 20, 1), trade(A, B, 20, 2), trade(B, A, 15, 3), trade(C, B, 10, 20)];
    const report = marketReport(trades, traders, NOW, 30);
    expect(report.netWeek).toEqual([
      { text: "{0} paid {1} a net 25 Karma over 7 days (55 gross in 3 purchases)", accounts: [A, B] },
    ]);
    expect(report.netPeriod).toEqual([
      { text: "{0} paid {1} a net 25 Karma over 30 days (55 gross in 3 purchases)", accounts: [A, B] },
      { text: "{0} paid {1} a net 10 Karma over 30 days (10 gross in 1 purchases)", accounts: [C, B] },
    ]);
    expect(marketReport(trades, traders, NOW, 10).netPeriod).toHaveLength(1);
  });

  it("finds a pair that makes more than half of one side's market volume, and not one at exactly half", () => {
    const report = marketReport([trade(A, B, 20, 1), trade(C, B, 20, 1)], traders, NOW, 30);
    // A and C each trade only with B (100 %); B's volume is split exactly in half, which is not more than half.
    expect(report.dominantPairs).toEqual([
      { text: "{0} makes 100 % of {1}'s market volume over 30 days (20 of 20 Karma)", accounts: [B, A] },
      { text: "{0} makes 100 % of {1}'s market volume over 30 days (20 of 20 Karma)", accounts: [B, C] },
    ]);
  });

  it("counts each seller's sales at the floor and at the cap of the card's tier", () => {
    const report = marketReport(
      [
        trade(A, B, MARKET_PRICE_MIN.common, 1),
        trade(A, B, MARKET_PRICE_MAX.mythic, 1, { rarity: "mythic" }),
        trade(A, B, MARKET_PRICE_MAX.common, 1),
        trade(A, C, 7, 1),
      ],
      traders,
      NOW,
      30,
    );
    expect(report.atBounds).toEqual([
      { text: "{0} sold 1 cards at the floor and 2 at the cap over 30 days", accounts: [B] },
    ]);
  });

  it("finds a listing bought within 60 seconds, and not one bought later", () => {
    const quick = trade(A, B, 25, 1);
    const slow = trade(A, B, 25, 1);
    const report = marketReport(
      [
        { ...quick, listedAt: new Date(quick.boughtAt.getTime() - 60_000) },
        { ...slow, listedAt: new Date(slow.boughtAt.getTime() - 61_000) },
      ],
      traders,
      NOW,
      30,
    );
    expect(report.quickBuys).toEqual([
      {
        text: `{0} bought from {1} 60 s after the listing (purchase ${quick.purchaseId}, 25 Karma)`,
        accounts: [A, B],
      },
    ]);
  });

  it("finds the pairs that registered with the same invite code and traded", () => {
    const report = marketReport([trade(A, B, 5, 1), trade(A, C, 5, 1)], traders, NOW, 30);
    expect(report.sameInvite).toEqual([
      {
        text: "{0} and {1} registered with the same invite code and traded 1 times over 30 days",
        accounts: [A, B],
      },
    ]);
  });

  it("prints each section under its heading, with logins quoted and escaped next to their ids", () => {
    const lines = describeMarketReport(marketReport([trade(A, B, 5, 1)], traders, NOW, 30), traders);
    expect(lines[0]).toBe("Net Karma per pair, last 7 days:");
    expect(lines[1]).toBe(
      `  "Alt\\u202e" (${A}) paid "Main" (${B}) a net 5 Karma over 7 days (5 gross in 1 purchases)`,
    );
    expect(lines.join("\n")).not.toContain(OVERRIDE);
  });

  it("takes --days between 1 and 3650, or nothing for 30", () => {
    expect(parseDays([])).toBe(30);
    expect(parseDays(["--days", "7"])).toBe(7);
    expect(parseDays(["--days", "3650"])).toBe(3_650);
    for (const argv of [
      ["--days"],
      ["--days", "0"],
      ["--days", "3651"],
      ["--days", "07"],
      ["--days", "1e3"],
      ["7"],
      ["--days", "7", "x"],
    ])
      expect(parseDays(argv), argv.join(" ")).toBeNull();
  });
});
