import type { PackOpened } from "@anime-tcg/shared/api";
import { randomUUID } from "node:crypto";
import { MAX_RECYCLE_COUNT, RECYCLE_VALUE } from "@anime-tcg/shared/economy";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { accounts, cards, ledgerEntries, recycles } from "../src/db/schema.js";
import { auditLedger } from "../src/domain/economy/audit.js";
import {
  balanceOf,
  economyPool,
  entryOf,
  ID,
  putBackPastTheTrigger,
  recycle,
  recycleBody,
  REMOVED_STAYS,
} from "./economy-support.js";
import {
  body,
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  forceNextPack,
  loadSnapshot,
  newPlayer,
  openPack,
  scriptedRng,
} from "./pool-support.js";
import { createTestApp, type SignedInClient, testConfig } from "./support.js";

/*
 * BUG (tester's hunt, PR #40, T3): audit-ledger cannot see a recycle whose
 * cards were all put back.
 *
 * economy.md §13.1 has the audit check "every recycle with exactly `count`
 * removed cards (or none, after a reset, §8.10)". `auditAccount` accepts
 * `removedCards === 0` for every recycle, whether or not a reset happened
 * (api/src/domain/economy/audit.ts: `removedCards !== count && removedCards
 * !== 0`). The app role holds UPDATE on exactly `cards.removed_at` and
 * `cards.removed_by_recycle` (migration 0005), so one statement as the app
 * role, `update cards set removed_at = null, removed_by_recycle = null where
 * removed_by_recycle = <recycle id>`, gives the cards back while the Karma
 * credit stays, and every other check passes too: no card is "removed by
 * nothing" (they are no longer removed), none is "foreign" (they no longer
 * name the recycle), the ledger chain and the balance are intact. The
 * account ends with its duplicates and their Karma, and the audit, which is
 * the one detection after the fact (C11, §7 "make a missing, extra or
 * altered row visible to audit-ledger"), prints "Ledger consistent". Putting
 * back only some of the cards is caught (count mismatch); putting back all
 * of them is not.
 *
 * A reset is distinguishable: it deletes every card of the account (§8.10),
 * so after one, the account holds no card pulled at or before the recycle.
 * A recycle with no removed cards while the account still holds a card of
 * that entry pulled before the recycle cannot be explained by a reset.
 *
 * The same acceptance hides a recycle that never removed a card at all:
 * the app role may insert a `recycle_credit` row, a `recycles` row naming it
 * and set `accounts.balance` (all granted, and all needed by the recycle
 * path), so a bug or an injected statement can mint up to 275 000 Karma per
 * row for an account that never held the card, and the audit passes it as a
 * recycle "after a reset". The second test shows it.
 *
 * Nothing in the database records that a reset happened (a reset with
 * `--keep-karma`, or of a balance of 0, writes no ledger row), so the audit
 * has no way to tell; a durable mark of the reset (for example the time of
 * the account's last reset) would let it accept a recycle without cards only
 * when it is older than that reset. That is a spec question for §8.10 and
 * §13.1, raised in the tester's report.
 *
 * Reproduce: `npm run test:routes -w api -- test/bug-audit-resurrected-recycle.test.ts`
 * with DATABASE_URL and MIGRATIONS_DATABASE_URL on the test database. The
 * tests fail today with `expected [] to have a length of 1`; they pass once
 * the audit reports such recycles. Not fixed here: the tester writes tests
 * only.
 *
 * FIXED (manager decision, 2026-10-30): `accounts.last_reset_at` records
 * every reset, and the audit accepts a recycle without its cards only if it
 * is no newer than the last reset; migration 0005's trigger
 * `cards_removed_stays` keeps a removed card removed, so the app role's
 * statement of the first test now fails. The first test asserts that, then
 * gives the cards back past the trigger as the owner (as a doctored restore
 * could) to show the audit still finds the recycle.
 */

const MINUTE = 60_000;
/** A few openings: seconds on an idle machine, far more on a loaded one. */
const TIMEOUT = 90_000;

describe(
  "BUG: audit-ledger and a recycle whose cards were all put back (economy.md §13.1)",
  { timeout: TIMEOUT },
  () => {
    let app: App;
    let now = new Date("2026-11-01T09:00:00.000Z");
    const rng = scriptedRng();
    const made: string[] = [];
    const snapshots: number[] = [];
    let snapshotId = 0;
    let client: SignedInClient;

    beforeAll(async () => {
      app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }), rng, clock: () => now });
      const current = await currentSnapshotId(app.db);
      if (current !== null) throw new Error(`snapshot ${current} is current; a previous run left it behind`);
      snapshotId = (await loadSnapshot(app.db, economyPool(), now)).version;
      snapshots.push(snapshotId);
      client = await newPlayer(app, "bug");
      made.push(client.account.id);
      for (let i = 0; i < 3; i += 1) {
        now = new Date(now.getTime() + 10 * MINUTE);
        await forceNextPack(app.db, rng, snapshotId, [
          ID.common(200 - 2 * i),
          ID.common(150 - 2 * i),
          ID.uncommon(100 - 2 * i),
          ID.uncommon(50 - 2 * i),
          ID.mythic(2),
        ]);
        const res = await openPack(app, client.cookie);
        expect(res.statusCode, res.body).toBe(201);
        expect(body<PackOpened>(res).cards).toHaveLength(5);
      }
    }, TIMEOUT);
    afterAll(async () => {
      await deleteAccounts(app.db, made);
      await deleteSnapshots(snapshots);
      await app.close();
    }, TIMEOUT);

    it("reports the recycle when its cards are held again and its credit stays", async () => {
      const res = await recycle(app, client.cookie, recycleBody(ID.mythic(2), "mythic", 2));
      expect(res.statusCode, res.body).toBe(201);
      const { recycleId } = res.json<{ recycleId: string }>();
      expect(
        await auditLedger(app.db).then((r) => r.failures.filter((f) => f.id === client.account.id)),
      ).toEqual([]);

      // The statement 0005's column grant allows the app role is refused by its trigger now.
      await expect(
        app.db
          .update(cards)
          .set({ removedAt: null, removedByRecycle: null })
          .where(eq(cards.removedByRecycle, recycleId)),
      ).rejects.toMatchObject({ cause: { code: REMOVED_STAYS } });
      expect(await entryOf(app, client.cookie, ID.mythic(2))).toMatchObject({ count: 1 });
      // Past the trigger, as the owner: both Mythics come back.
      expect(await putBackPastTheTrigger(recycleId)).toBe(2);
      expect(await entryOf(app, client.cookie, ID.mythic(2))).toMatchObject({ count: 3, recyclable: 2 });
      expect(await balanceOf(app, client.account.id)).toBe(2 * RECYCLE_VALUE.mythic);
      expect(
        await app.db
          .select({ id: cards.id })
          .from(cards)
          .where(and(eq(cards.accountId, client.account.id), isNull(cards.removedAt))),
      ).toHaveLength(15);

      const failures = (await auditLedger(app.db)).failures.filter((f) => f.id === client.account.id);
      // Fails today: the audit treats "no removed card" as "after a reset", and no reset happened.
      expect(failures).toHaveLength(1);
      expect(failures[0]?.lines).toEqual([
        `recycle ${recycleId} removed 0 cards, not 2, and no reset after it`,
      ]);
    });

    it("reports a recycle that never removed a card: Karma minted from rows the app role may insert", async () => {
      const minter = await newPlayer(app, "bug");
      made.push(minter.account.id);
      // The app role may insert a ledger row and a recycle and set the balance; no card is touched.
      const credit = MAX_RECYCLE_COUNT * RECYCLE_VALUE.mythic;
      await app.db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(ledgerEntries)
          .values({
            accountId: minter.account.id,
            seq: 1,
            kind: "recycle_credit",
            amount: credit,
            balanceAfter: credit,
            createdAt: now,
          })
          .returning({ id: ledgerEntries.id });
        if (entry === undefined) throw new Error("ledger insert returned no row");
        await tx.insert(recycles).values({
          accountId: minter.account.id,
          requestId: randomUUID(),
          requestHash: "minted",
          characterId: ID.mythic(4),
          rarity: "mythic",
          count: MAX_RECYCLE_COUNT,
          unitValue: RECYCLE_VALUE.mythic,
          ledgerEntryId: entry.id,
          createdAt: now,
        });
        await tx.update(accounts).set({ balance: credit }).where(eq(accounts.id, minter.account.id));
      });
      expect(await balanceOf(app, minter.account.id)).toBe(275_000);

      const failures = (await auditLedger(app.db)).failures.filter((f) => f.id === minter.account.id);
      // Fails today: an account that never held a card, nor was ever reset, passes with 275 000 Karma.
      expect(failures).toHaveLength(1);
      expect(failures[0]?.lines).toEqual([
        expect.stringMatching(/^recycle [0-9a-f-]{36} removed 0 cards, not 100, and no reset after it$/),
      ]);
    });
  },
);
