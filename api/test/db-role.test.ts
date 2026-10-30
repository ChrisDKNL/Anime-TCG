import { randomUUID } from "node:crypto";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import {
  accounts,
  authThrottle,
  cards,
  characters,
  ledgerEntries,
  marketListings,
  marketPurchases,
  packOpenings,
  poolFetches,
  poolFetchPages,
  poolSnapshotCharacters,
  poolSnapshotSeries,
  poolSnapshots,
  recycles,
  series,
  sessions,
} from "../src/db/schema.js";
import { createDb } from "../src/db/client.js";
import { resetCollection } from "../src/domain/collection/reset.js";
import { clearAccountData, createTestApp, insertAccount, migrationsDatabaseUrl } from "./support.js";

/** Postgres `insufficient_privilege`; drizzle wraps the pg error as `cause`. */
const PERMISSION_DENIED = "42501";
/** Postgres `integrity_constraint_violation`, raised by 0005's `cards_removed_stays` and `accounts_last_reset_forward` triggers. */
const INTEGRITY_VIOLATION = "23000";

/**
 * Spec §4.1: the pool behind every request is `anime_app`, which can read and
 * write rows and nothing else. A bug that reaches the database therefore
 * cannot change the schema, empty a table in one statement or read the
 * migration ledger.
 */
describe("app database role", () => {
  let app: App;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearAccountData(app.db));
  afterAll(() => app.close());

  it("runs as anime_app, not the owner", async () => {
    const result = await app.db.execute<{ role: string }>(sql`select current_user as role`);
    expect(result.rows[0]?.role).toBe("anime_app");
  });

  it("cannot create a table", async () => {
    await expect(app.db.execute(sql`create table escalation (id int)`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
  });

  it("cannot truncate, alter or drop the sessions table", async () => {
    await expect(app.db.execute(sql`truncate sessions`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.execute(sql`alter table sessions add column x int`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.execute(sql`drop table sessions`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
  });

  it("cannot read the migration ledger", async () => {
    await expect(
      app.db.execute(sql`select count(*) from drizzle.__drizzle_migrations`),
    ).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
  });

  it("can insert, read, update and delete sessions", async () => {
    const now = new Date();
    await app.db
      .insert(sessions)
      .values({ id: "role-probe", accountId: null, expiresAt: now, lastSeenAt: now, userAgentHash: "x" });
    expect(await app.db.select({ id: sessions.id }).from(sessions)).toEqual([{ id: "role-probe" }]);
    await app.db.update(sessions).set({ userAgentHash: "y" });
    await app.db.delete(sessions);
    expect(await app.db.select().from(sessions)).toEqual([]);
  });

  it("can read and write accounts and auth_throttle, which 0001's default privileges granted before they existed", async () => {
    const id = await insertAccount(app.db, "RoleProbe");
    expect(await app.db.select({ login: accounts.login }).from(accounts)).toEqual([{ login: "RoleProbe" }]);
    await app.db.update(accounts).set({ login: "Renamed" }).where(eq(accounts.id, id));

    await app.db.insert(authThrottle).values({ key: "roleprobe", failures: 1, blockedUntil: null });
    await app.db.update(authThrottle).set({ failures: 2 });
    expect(await app.db.select({ failures: authThrottle.failures }).from(authThrottle)).toEqual([
      { failures: 2 },
    ]);
    await app.db.delete(authThrottle);
    await app.db.delete(accounts);
    expect(await app.db.select().from(accounts)).toEqual([]);
  });

  /** Postgres `check_violation`. */
  const CHECK_VIOLATION = "23514";
  const PROBE_CHARACTER = 999_000_001;
  const PROBE_IMAGE = "https://s4.anilist.co/file/anilistcdn/character/large/b999000001.png";
  const probeSnapshots: number[] = [];

  /** A snapshot, a character and an opening for `accountId`, written as the app role, ready for a card. */
  async function seedOpening(accountId: string): Promise<{ snapshotId: number; openingId: string }> {
    const now = new Date();
    const [snapshot] = await app.db
      .insert(poolSnapshots)
      .values({
        source: "file",
        takenAt: now,
        activatedAt: now,
        isCurrent: false,
        seriesCount: 0,
        franchiseCount: 0,
        characterCount: 0,
        tierCounts: [0, 0, 0, 0, 0, 0],
      })
      .returning({ id: poolSnapshots.id });
    if (snapshot === undefined) throw new Error("snapshot insert returned no row");
    probeSnapshots.push(snapshot.id);
    await app.db
      .insert(characters)
      .values({ id: PROBE_CHARACTER, name: "Probe", imageUrl: PROBE_IMAGE, searchName: "probe" })
      .onConflictDoNothing();
    const [opening] = await app.db
      .insert(packOpenings)
      .values({
        accountId,
        requestId: randomUUID(),
        snapshotId: snapshot.id,
        kind: "standard",
        pity: false,
        openedAt: now,
      })
      .returning({ id: packOpenings.id });
    if (opening === undefined) throw new Error("opening insert returned no row");
    return { snapshotId: snapshot.id, openingId: opening.id };
  }

  const card = (accountId: string, seeded: { snapshotId: number; openingId: string }, slot: number) => ({
    accountId,
    openingId: seeded.openingId,
    slot,
    characterId: PROBE_CHARACTER,
    rarity: "mythic" as const,
    snapshotId: seeded.snapshotId,
    isNew: true,
    pulledAt: new Date(),
  });

  /** The app role may not delete a snapshot or a character (0004), so the probe rows go as the owner. */
  afterAll(async () => {
    const owner = createDb(migrationsDatabaseUrl());
    try {
      await owner.delete(accounts);
      await owner.delete(characters).where(eq(characters.id, PROBE_CHARACTER));
      if (probeSnapshots.length > 0)
        await owner.delete(poolSnapshots).where(inArray(poolSnapshots.id, probeSnapshots));
    } finally {
      await owner.$client.end();
    }
  });

  it("can write the 1c tables down to a card, which 0001's default privileges granted as well", async () => {
    const accountId = await insertAccount(app.db, "CardProbe");
    const seeded = await seedOpening(accountId);
    await app.db.insert(cards).values(card(accountId, seeded, 0));
    expect(
      await app.db.select({ variant: cards.variant }).from(cards).where(eq(cards.accountId, accountId)),
    ).toEqual([{ variant: "standard" }]);
  });

  it("holds exactly the rights 0001 granted less 0004's, 0005's and 0006's revokes, table by table", async () => {
    const grants = await app.db.execute<{ table_name: string; rights: string }>(sql`
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as rights
      from information_schema.role_table_grants
      where grantee = 'anime_app' and table_schema = 'public'
      group by table_name order by table_name
    `);
    const all = "DELETE,INSERT,SELECT,UPDATE";
    expect(grants.rows).toEqual([
      { table_name: "accounts", rights: all },
      { table_name: "auth_throttle", rights: all },
      { table_name: "cards", rights: "INSERT,SELECT" },
      { table_name: "characters", rights: "INSERT,SELECT,UPDATE" },
      { table_name: "ledger_entries", rights: "INSERT,SELECT" },
      { table_name: "market_listings", rights: "INSERT,SELECT" },
      { table_name: "market_purchases", rights: "INSERT,SELECT" },
      { table_name: "pack_openings", rights: "DELETE,INSERT,SELECT" },
      { table_name: "pool_fetch_pages", rights: "INSERT,SELECT" },
      { table_name: "pool_fetches", rights: "DELETE,INSERT,SELECT" },
      { table_name: "pool_snapshot_characters", rights: "INSERT,SELECT" },
      { table_name: "pool_snapshot_franchises", rights: "INSERT,SELECT" },
      { table_name: "pool_snapshot_memberships", rights: "INSERT,SELECT" },
      { table_name: "pool_snapshot_relations", rights: "INSERT,SELECT" },
      { table_name: "pool_snapshot_series", rights: "INSERT,SELECT" },
      { table_name: "pool_snapshots", rights: "INSERT,SELECT,UPDATE" },
      { table_name: "recycles", rights: "INSERT,SELECT" },
      { table_name: "series", rights: "INSERT,SELECT,UPDATE" },
      { table_name: "sessions", rights: all },
    ]);
  });

  it("may update exactly the card columns a recycle and a sale write and a listing's state, and no other column of a table without UPDATE (0005, 0006)", async () => {
    const columns = await app.db.execute<{ table_name: string; column_name: string }>(sql`
      select c.table_name, c.column_name from information_schema.column_privileges c
      where c.grantee = 'anime_app' and c.table_schema = 'public' and c.privilege_type = 'UPDATE'
        and not exists (
          select 1 from information_schema.role_table_grants t
          where t.grantee = 'anime_app' and t.table_schema = 'public' and t.table_name = c.table_name
            and t.privilege_type = 'UPDATE'
        )
      order by c.table_name, c.column_name
    `);
    expect(columns.rows).toEqual([
      { table_name: "cards", column_name: "removed_at" },
      { table_name: "cards", column_name: "removed_by_purchase" },
      { table_name: "cards", column_name: "removed_by_recycle" },
      { table_name: "market_listings", column_name: "closed_at" },
      { table_name: "market_listings", column_name: "status" },
    ]);
  });

  it("may call delete_bought_cards, the one function besides the trigger functions, which nobody else may call (0006)", async () => {
    const routines = await app.db.execute<{ routine_name: string; grantee: string }>(sql`
      select p.routine_name, p.grantee from information_schema.routine_privileges p
      join information_schema.routines r on r.specific_name = p.specific_name
      where p.routine_schema = 'public' and p.privilege_type = 'EXECUTE' and p.grantee <> 'anime'
        and r.data_type <> 'trigger'
      order by p.routine_name, p.grantee
    `);
    expect(routines.rows).toEqual([{ routine_name: "delete_bought_cards", grantee: "anime_app" }]);
    const definer = await app.db.execute<{ secdef: boolean; config: string[] | null }>(sql`
      select prosecdef as secdef, proconfig as config from pg_proc where proname = 'delete_bought_cards'
    `);
    expect(definer.rows).toEqual([{ secdef: true, config: ["search_path=pg_catalog, public"] }]);
  });

  /** A Mythic sold by `sellerId` to `buyerId` at 27 500, written as the market writes it: rows, ledger, both cards. */
  async function seedSale(sellerId: string, buyerId: string) {
    const now = new Date();
    const cardId = await heldCard(sellerId);
    const entry = async (
      accountId: string,
      seq: number,
      kind: "market_purchase" | "market_sale" | "market_fee",
      amount: number,
      balanceAfter: number,
    ) => {
      const [row] = await app.db
        .insert(ledgerEntries)
        .values({ accountId, seq, kind, amount, balanceAfter, createdAt: now })
        .returning({ id: ledgerEntries.id });
      if (row === undefined) throw new Error("ledger insert returned no row");
      return row.id;
    };
    // The buyer's 27 500 come from a forged first row; the probe accounts are deleted after each test.
    await app.db.insert(ledgerEntries).values({
      accountId: buyerId,
      seq: 1,
      kind: "recycle_credit",
      amount: 27_500,
      balanceAfter: 27_500,
      createdAt: now,
    });
    const buyerEntry = await entry(buyerId, 2, "market_purchase", -27_500, 0);
    const saleEntry = await entry(sellerId, 1, "market_sale", 27_500, 27_500);
    const feeEntry = await entry(sellerId, 2, "market_fee", -1_375, 26_125);
    await app.db.update(accounts).set({ balance: 26_125 }).where(eq(accounts.id, sellerId));
    const [listing] = await app.db
      .insert(marketListings)
      .values({
        sellerId,
        requestId: randomUUID(),
        cardId,
        characterId: PROBE_CHARACTER,
        rarity: "mythic",
        price: 27_500,
        fee: 1_375,
        status: "active",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      })
      .returning({ id: marketListings.id });
    if (listing === undefined) throw new Error("listing insert returned no row");
    const [purchase] = await app.db
      .insert(marketPurchases)
      .values({
        buyerId,
        requestId: randomUUID(),
        listingId: listing.id,
        sellerId,
        characterId: PROBE_CHARACTER,
        rarity: "mythic",
        variant: "standard",
        price: 27_500,
        fee: 1_375,
        buyerEntryId: buyerEntry,
        sellerSaleEntryId: saleEntry,
        sellerFeeEntryId: feeEntry,
        createdAt: now,
      })
      .returning({ id: marketPurchases.id });
    if (purchase === undefined) throw new Error("purchase insert returned no row");
    await app.db
      .update(cards)
      .set({ removedAt: now, removedByPurchase: purchase.id })
      .where(eq(cards.id, cardId));
    const [snapshot] = await app.db.select({ id: cards.snapshotId }).from(cards).where(eq(cards.id, cardId));
    if (snapshot === undefined) throw new Error("the sold card is gone");
    const [bought] = await app.db
      .insert(cards)
      .values({
        accountId: buyerId,
        purchaseId: purchase.id,
        characterId: PROBE_CHARACTER,
        rarity: "mythic",
        snapshotId: snapshot.id,
        isNew: true,
        pulledAt: now,
      })
      .returning({ id: cards.id });
    if (bought === undefined) throw new Error("card insert returned no row");
    await app.db
      .update(marketListings)
      .set({ status: "sold", closedAt: now })
      .where(eq(marketListings.id, listing.id));
    return { cardId, boughtId: bought.id, listingId: listing.id, purchaseId: purchase.id };
  }

  it("cannot update or delete a purchase, delete a listing, or change a listing's price, card or seller (0006)", async () => {
    const seller = await insertAccount(app.db, "MarketSeller");
    const buyer = await insertAccount(app.db, "MarketBuyer");
    await seedSale(seller, buyer);
    await expect(app.db.update(marketPurchases).set({ price: 1 })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.delete(marketPurchases)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.delete(marketListings)).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    for (const change of [
      { price: 1 },
      { fee: 1 },
      { cardId: null },
      { sellerId: buyer },
      { expiresAt: new Date() },
    ]) {
      await expect(app.db.update(marketListings).set(change), JSON.stringify(change)).rejects.toMatchObject({
        cause: { code: PERMISSION_DENIED },
      });
    }
    await expect(app.db.update(cards).set({ purchaseId: null })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
  });

  it("keeps a sold card sold: the trigger refuses another purchase or none, the app role and the owner alike (0006)", async () => {
    const seller = await insertAccount(app.db, "SoldStays");
    const buyer = await insertAccount(app.db, "SoldStays2");
    const sale = await seedSale(seller, buyer);
    const other = await seedSale(
      await insertAccount(app.db, "SoldStays3"),
      await insertAccount(app.db, "SoldStays4"),
    );
    const owner = createDb(migrationsDatabaseUrl());
    try {
      for (const db of [app.db, owner]) {
        for (const change of [
          { removedByPurchase: other.purchaseId },
          { removedAt: null, removedByPurchase: null },
          { removedByRecycle: null, removedAt: new Date(0) },
        ]) {
          const refused: unknown = await db
            .update(cards)
            .set(change)
            .where(eq(cards.id, sale.cardId))
            .then(
              () => null,
              (err: unknown) => err,
            );
          expect(refused, JSON.stringify(change)).toMatchObject({ cause: { code: INTEGRITY_VIOLATION } });
        }
      }
    } finally {
      await owner.$client.end();
    }
    // A card is removed by one recycle or one purchase, never both.
    const recycler = await insertAccount(app.db, "SoldStays5");
    const { recycleId } = await seedRecycle(recycler, await heldCard(recycler));
    await expect(
      app.db
        .update(cards)
        .set({ removedAt: new Date(), removedByPurchase: sale.purchaseId, removedByRecycle: recycleId })
        .where(eq(cards.id, sale.boughtId)),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION, constraint: "cards_removed_once_check" } });
  });

  it("deletes a buyer's account with its purchase and card, leaving the seller's sold card removed and its listing sold (0006)", async () => {
    const seller = await insertAccount(app.db, "CascadeSeller");
    const buyer = await insertAccount(app.db, "CascadeBuyer");
    const sale = await seedSale(seller, buyer);
    await app.db.delete(accounts).where(eq(accounts.id, buyer));
    expect(
      await app.db.select().from(marketPurchases).where(eq(marketPurchases.id, sale.purchaseId)),
    ).toEqual([]);
    // The foreign key's set null passes the trigger: a removed card's purchase may only go away.
    const [sold] = await app.db
      .select({ removedAt: cards.removedAt, removedByPurchase: cards.removedByPurchase })
      .from(cards)
      .where(eq(cards.id, sale.cardId));
    expect(sold?.removedAt).not.toBeNull();
    expect(sold?.removedByPurchase).toBeNull();
    const [listing] = await app.db
      .select({ status: marketListings.status })
      .from(marketListings)
      .where(eq(marketListings.id, sale.listingId));
    expect(listing).toEqual({ status: "sold" });
  });

  it("deletes a seller's account with its listings and cards, keeping the buyer's card and receipt (0006)", async () => {
    const seller = await insertAccount(app.db, "GoneSeller");
    const buyer = await insertAccount(app.db, "StayingBuyer");
    const sale = await seedSale(seller, buyer);
    await app.db.delete(accounts).where(eq(accounts.id, seller));
    const [receipt] = await app.db
      .select({
        listingId: marketPurchases.listingId,
        sellerId: marketPurchases.sellerId,
        sale: marketPurchases.sellerSaleEntryId,
        fee: marketPurchases.sellerFeeEntryId,
      })
      .from(marketPurchases)
      .where(eq(marketPurchases.id, sale.purchaseId));
    expect(receipt).toEqual({ listingId: null, sellerId: null, sale: null, fee: null });
    expect(await app.db.select({ id: cards.id }).from(cards).where(eq(cards.id, sale.boughtId))).toEqual([
      { id: sale.boughtId },
    ]);
  });

  it("resets a buyer's collection: its bought card goes through delete_bought_cards, its receipt stays (0006)", async () => {
    const seller = await insertAccount(app.db, "ResetSeller");
    const buyer = await insertAccount(app.db, "ResetBuyer");
    const sale = await seedSale(seller, buyer);
    await resetCollection(app.db, "ResetBuyer", { confirm: true, keepKarma: true });
    expect(await app.db.select().from(cards).where(eq(cards.accountId, buyer))).toEqual([]);
    expect(
      await app.db
        .select({ id: marketPurchases.id })
        .from(marketPurchases)
        .where(eq(marketPurchases.id, sale.purchaseId)),
    ).toEqual([{ id: sale.purchaseId }]);
    // The seller's reset deletes the sold card; the listing keeps its history without it.
    await resetCollection(app.db, "ResetSeller", { confirm: true, keepKarma: true });
    expect(
      await app.db
        .select({ status: marketListings.status, cardId: marketListings.cardId })
        .from(marketListings)
        .where(eq(marketListings.id, sale.listingId)),
    ).toEqual([{ status: "sold", cardId: null }]);
  });

  it("refuses delete_bought_cards on an account with an active listing, deleting nothing, live or lapsed (0007, manager decision, 2026-10-30)", async () => {
    const seller = await insertAccount(app.db, "GuardSeller");
    const buyer = await insertAccount(app.db, "GuardBuyer");
    const sale = await seedSale(seller, buyer);
    const now = new Date();
    // The buyer lists the card it bought: a live listing, then one lapsed but not yet swept.
    for (const expiresAt of [new Date(now.getTime() + 60_000), new Date(now.getTime() - 1)]) {
      const [listing] = await app.db
        .insert(marketListings)
        .values({
          sellerId: buyer,
          requestId: randomUUID(),
          cardId: sale.boughtId,
          characterId: PROBE_CHARACTER,
          rarity: "mythic",
          price: 27_500,
          fee: 1_375,
          status: "active",
          createdAt: new Date(expiresAt.getTime() - 120_000),
          expiresAt,
        })
        .returning({ id: marketListings.id });
      if (listing === undefined) throw new Error("listing insert returned no row");
      const refused: unknown = await app.db
        .execute(sql`select delete_bought_cards(${buyer}) as deleted`)
        .then(
          () => null,
          (err: unknown) => err,
        );
      expect(refused).toMatchObject({ cause: { code: INTEGRITY_VIOLATION } });
      expect((refused as { cause: Error }).cause.message).toMatch(/cancel its active listings/);
      expect(await app.db.select({ id: cards.id }).from(cards).where(eq(cards.id, sale.boughtId))).toEqual([
        { id: sale.boughtId },
      ]);
      await app.db
        .update(marketListings)
        .set({ status: "cancelled", closedAt: now })
        .where(eq(marketListings.id, listing.id));
    }
    // With no active listing left it deletes the bought card, and only that.
    expect((await app.db.execute(sql`select delete_bought_cards(${buyer}) as deleted`)).rows).toEqual([
      { deleted: 1 },
    ]);
  });

  it("still resets an account whose bought card is listed: the reset cancels the listing, then deletes the card (0007)", async () => {
    const seller = await insertAccount(app.db, "GuardResetSeller");
    const buyer = await insertAccount(app.db, "GuardResetBuyer");
    const sale = await seedSale(seller, buyer);
    const now = new Date();
    const [listing] = await app.db
      .insert(marketListings)
      .values({
        sellerId: buyer,
        requestId: randomUUID(),
        cardId: sale.boughtId,
        characterId: PROBE_CHARACTER,
        rarity: "mythic",
        price: 27_500,
        fee: 1_375,
        status: "active",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      })
      .returning({ id: marketListings.id });
    if (listing === undefined) throw new Error("listing insert returned no row");
    const result = await resetCollection(app.db, "GuardResetBuyer", { confirm: true, keepKarma: true });
    expect(result).toMatchObject({ applied: true, listings: 1 });
    expect(await app.db.select().from(cards).where(eq(cards.accountId, buyer))).toEqual([]);
    expect(
      await app.db
        .select({ status: marketListings.status, cardId: marketListings.cardId })
        .from(marketListings)
        .where(eq(marketListings.id, listing.id)),
    ).toEqual([{ status: "cancelled", cardId: null }]);
  });

  /** A ledger row and a recycle that removes `cardId`, written as the app role writes them. */
  async function seedRecycle(
    accountId: string,
    cardId: string,
  ): Promise<{ entryId: string; recycleId: string }> {
    const now = new Date();
    const [entry] = await app.db
      .insert(ledgerEntries)
      .values({
        accountId,
        seq: 1,
        kind: "recycle_credit",
        amount: 2_750,
        balanceAfter: 2_750,
        createdAt: now,
      })
      .returning({ id: ledgerEntries.id });
    if (entry === undefined) throw new Error("ledger insert returned no row");
    await app.db.update(accounts).set({ balance: 2_750 }).where(eq(accounts.id, accountId));
    const [recycle] = await app.db
      .insert(recycles)
      .values({
        accountId,
        requestId: randomUUID(),
        requestHash: "probe",
        characterId: PROBE_CHARACTER,
        rarity: "mythic",
        count: 1,
        unitValue: 2_750,
        ledgerEntryId: entry.id,
        createdAt: now,
      })
      .returning({ id: recycles.id });
    if (recycle === undefined) throw new Error("recycle insert returned no row");
    await app.db
      .update(cards)
      .set({ removedAt: now, removedByRecycle: recycle.id })
      .where(eq(cards.id, cardId));
    return { entryId: entry.id, recycleId: recycle.id };
  }

  async function heldCard(accountId: string): Promise<string> {
    const [row] = await app.db
      .insert(cards)
      .values(card(accountId, await seedOpening(accountId), 0))
      .returning({ id: cards.id });
    if (row === undefined) throw new Error("card insert returned no row");
    return row.id;
  }

  it("cannot update or delete a ledger row or a recycle, nor touch a card's escrow or rarity (0005)", async () => {
    const accountId = await insertAccount(app.db, "LedgerProbe");
    await seedRecycle(accountId, await heldCard(accountId));
    await expect(app.db.update(ledgerEntries).set({ amount: 1_000_000 })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.delete(ledgerEntries)).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.update(recycles).set({ count: 100 })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.delete(recycles)).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.update(cards).set({ escrowId: randomUUID() })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.update(cards).set({ removedAt: null, rarity: "common" })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
  });

  it("keeps an account's last reset moving forward and never in the future, for the app role and the owner (0005, manager decision, 2026-10-30)", async () => {
    const accountId = await insertAccount(app.db, "ResetClock");
    const lastResetOf = async () =>
      (await app.db.select({ at: accounts.lastResetAt }).from(accounts).where(eq(accounts.id, accountId)))[0]
        ?.at;
    const earlier = new Date(Date.now() - 60 * 60_000);
    // From none to a time in the past, and to the same time again: both allowed.
    await app.db.update(accounts).set({ lastResetAt: earlier }).where(eq(accounts.id, accountId));
    await app.db.update(accounts).set({ lastResetAt: earlier }).where(eq(accounts.id, accountId));
    const owner = createDb(migrationsDatabaseUrl());
    try {
      for (const db of [app.db, owner]) {
        for (const [lastResetAt, message] of [
          [new Date(earlier.getTime() - 60_000), /never moves back$/],
          [null, /never moves back$/],
          [new Date(Date.now() + 60_000), /is in the future$/],
        ] as const) {
          const refused: unknown = await db
            .update(accounts)
            .set({ lastResetAt })
            .where(eq(accounts.id, accountId))
            .then(
              () => null,
              (err: unknown) => err,
            );
          expect(refused).toMatchObject({ cause: { code: INTEGRITY_VIOLATION } });
          expect((refused as { cause: Error }).cause.message).toMatch(message);
        }
      }
      // A new account has never been reset, whoever inserts it.
      const born: unknown = await owner
        .insert(accounts)
        .values({
          login: "Reborn",
          loginNormalized: "reborn",
          passwordHash: "x",
          inviteCodeHash: "fixture",
          lastResetAt: earlier,
        })
        .then(
          () => null,
          (err: unknown) => err,
        );
      expect(born).toMatchObject({ cause: { code: INTEGRITY_VIOLATION } });
      expect((born as { cause: Error }).cause.message).toMatch(/a new account has no last reset$/);
    } finally {
      await owner.$client.end();
    }
    expect(await lastResetOf()).toEqual(earlier);
    // A real reset, on the server clock, still moves it on.
    const before = Date.now();
    await resetCollection(app.db, "ResetClock", { confirm: true });
    expect((await lastResetOf())?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("keeps a removed card removed: its trigger refuses the app role and the owner alike (0005, manager decision, 2026-10-30)", async () => {
    const accountId = await insertAccount(app.db, "StaysRemoved");
    const cardId = await heldCard(accountId);
    // The recycle's own write, held to removed, passes the trigger.
    const { recycleId } = await seedRecycle(accountId, cardId);
    const removed = async () =>
      (
        await app.db
          .select({ removedAt: cards.removedAt, removedByRecycle: cards.removedByRecycle })
          .from(cards)
          .where(eq(cards.id, cardId))
      )[0];
    const before = await removed();
    expect(before?.removedByRecycle).toBe(recycleId);
    const otherAccount = await insertAccount(app.db, "StaysRemoved2");
    const other = await seedRecycle(otherAccount, await heldCard(otherAccount));
    const owner = createDb(migrationsDatabaseUrl());
    try {
      for (const db of [app.db, owner]) {
        for (const change of [
          { removedAt: null, removedByRecycle: null },
          { removedAt: new Date(0) },
          { removedByRecycle: other.recycleId },
        ]) {
          const refused: unknown = await db
            .update(cards)
            .set(change)
            .where(eq(cards.id, cardId))
            .then(
              () => null,
              (err: unknown) => err,
            );
          expect(refused).toMatchObject({ cause: { code: INTEGRITY_VIOLATION } });
          expect((refused as { cause: Error }).cause.message).toMatch(/a removed card stays removed$/);
        }
      }
      // A statement that leaves both columns as they are is no change, so it passes.
      await app.db.execute(sql`update cards set removed_at = removed_at where id = ${cardId}`);
    } finally {
      await owner.$client.end();
    }
    expect(await removed()).toEqual(before);
    // A reset deletes the cards, so the trigger never stands in its way.
    await resetCollection(app.db, "StaysRemoved", { confirm: true });
    expect(await app.db.select().from(cards).where(eq(cards.accountId, accountId))).toEqual([]);
  });

  it("still deletes an account with its ledger, its recycles and its recycled cards, by cascade (0005)", async () => {
    const accountId = await insertAccount(app.db, "EconomyCascade");
    await seedRecycle(accountId, await heldCard(accountId));
    await app.db.delete(accounts).where(eq(accounts.id, accountId));
    expect(await app.db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, accountId))).toEqual(
      [],
    );
    expect(await app.db.select().from(recycles).where(eq(recycles.accountId, accountId))).toEqual([]);
    expect(await app.db.select().from(cards).where(eq(cards.accountId, accountId))).toEqual([]);
  });

  it("refuses a negative balance, a zero or oversized ledger amount, and a removal without its time (0005)", async () => {
    const accountId = await insertAccount(app.db, "CheckProbe");
    await expect(
      app.db.update(accounts).set({ balance: -1 }).where(eq(accounts.id, accountId)),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION, constraint: "accounts_balance_check" } });
    const entry = (amount: number, kind: "recycle_credit" | "owner_reset" = "recycle_credit") => ({
      accountId,
      seq: 1,
      kind,
      amount,
      balanceAfter: 0,
      createdAt: new Date(),
    });
    for (const amount of [0, 1_000_001, -1_000_001]) {
      await expect(app.db.insert(ledgerEntries).values(entry(amount))).rejects.toMatchObject({
        cause: { code: CHECK_VIOLATION, constraint: "ledger_entries_amount_check" },
      });
    }
    await app.db.insert(ledgerEntries).values(entry(-1_000_001, "owner_reset"));
    const cardId = await heldCard(accountId);
    const other = await insertAccount(app.db, "CheckProbe2");
    const recycle = await seedRecycle(other, await heldCard(other));
    await expect(
      app.db.update(cards).set({ removedByRecycle: recycle.recycleId }).where(eq(cards.id, cardId)),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION, constraint: "cards_removed_check" } });
  });

  it("cannot rewrite a granted card's rarity, delete a card on its own or change an opening (0004)", async () => {
    const accountId = await insertAccount(app.db, "RarityProbe");
    await app.db.insert(cards).values(card(accountId, await seedOpening(accountId), 0));
    await expect(
      app.db.update(cards).set({ rarity: "common" }).where(eq(cards.accountId, accountId)),
    ).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.delete(cards).where(eq(cards.accountId, accountId))).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.update(packOpenings).set({ pity: true })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
  });

  it("cannot change or delete a snapshot's rows, delete the snapshot, or delete a character or series (0004)", async () => {
    await seedOpening(await insertAccount(app.db, "SnapshotProbe"));
    await expect(
      app.db.delete(poolSnapshotCharacters).where(eq(poolSnapshotCharacters.characterId, PROBE_CHARACTER)),
    ).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.update(poolSnapshotSeries).set({ popularity: 0 })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.delete(poolSnapshots)).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.delete(characters)).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.delete(series)).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
  });

  it("still deletes an account with its openings and cards, by cascade", async () => {
    const accountId = await insertAccount(app.db, "CascadeProbe");
    await app.db.insert(cards).values(card(accountId, await seedOpening(accountId), 0));
    await app.db.delete(accounts).where(eq(accounts.id, accountId));
    expect(await app.db.select().from(cards).where(eq(cards.accountId, accountId))).toEqual([]);
    expect(await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, accountId))).toEqual([]);
  });

  it("still resets a collection: the openings go and their cards by cascade", async () => {
    const accountId = await insertAccount(app.db, "ResetProbe");
    await app.db.insert(cards).values(card(accountId, await seedOpening(accountId), 0));
    const result = await resetCollection(app.db, "ResetProbe", { confirm: true });
    expect(result).toMatchObject({ applied: true, cards: 1, openings: 1 });
    expect(await app.db.select().from(cards).where(eq(cards.accountId, accountId))).toEqual([]);
    expect(await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, accountId))).toEqual([]);
  });

  it("cannot change or delete a staged page or change a fetch, and a fetch still takes its pages by cascade (0004)", async () => {
    const [fetch] = await app.db
      .insert(poolFetches)
      .values({ startedAt: new Date() })
      .returning({ id: poolFetches.id });
    if (fetch === undefined) throw new Error("fetch insert returned no row");
    await app.db
      .insert(poolFetchPages)
      .values({ fetchId: fetch.id, kind: "series", key: "", page: 1, body: {}, fetchedAt: new Date() });
    await expect(app.db.update(poolFetchPages).set({ body: { forged: true } })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.delete(poolFetchPages)).rejects.toMatchObject({ cause: { code: PERMISSION_DENIED } });
    await expect(app.db.update(poolFetches).set({ startedAt: new Date(0) })).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await app.db.delete(poolFetches).where(eq(poolFetches.id, fetch.id));
    expect(await app.db.select().from(poolFetchPages).where(eq(poolFetchPages.fetchId, fetch.id))).toEqual(
      [],
    );
  });

  it("refuses a card slot outside the pack's five (0004)", async () => {
    const accountId = await insertAccount(app.db, "SlotProbe");
    const seeded = await seedOpening(accountId);
    await app.db.insert(cards).values(card(accountId, seeded, PACK_SIZE - 1));
    for (const slot of [-1, PACK_SIZE]) {
      await expect(app.db.insert(cards).values(card(accountId, seeded, slot))).rejects.toMatchObject({
        cause: { code: CHECK_VIOLATION, constraint: "cards_slot_check" },
      });
    }
  });

  it("refuses a character image off https://IMAGE_HOST/ (0004)", async () => {
    for (const imageUrl of [
      "http://s4.anilist.co/file/b1.png",
      "https://s4.anilist.co.evil.example/b1.png",
      "https://evil.example/https://s4.anilist.co/b1.png",
      "javascript:alert(1)",
    ]) {
      await expect(
        app.db
          .insert(characters)
          .values({ id: PROBE_CHARACTER + 1, name: "Probe", imageUrl, searchName: "probe" }),
      ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION, constraint: "characters_image_url_check" } });
    }
  });

  it("cannot truncate or alter the new tables either", async () => {
    await expect(app.db.execute(sql`truncate accounts`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
    await expect(app.db.execute(sql`alter table auth_throttle add column x int`)).rejects.toMatchObject({
      cause: { code: PERMISSION_DENIED },
    });
  });

  it("answers /healthz from the app pool", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
  });
});
