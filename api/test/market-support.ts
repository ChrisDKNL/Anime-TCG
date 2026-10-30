import { randomUUID } from "node:crypto";
import type { Listing, ListingsPage, MarketMine, PurchaseReceipt, Rarity } from "@anime-tcg/shared/api";
import { MAX_RECYCLE_COUNT, PACK_SIZE, RECYCLE_VALUE } from "@anime-tcg/shared/economy";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import type { App } from "../src/app.js";
import type { Db } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { cards, marketListings, packOpenings } from "../src/db/schema.js";
import { marketFee } from "../src/domain/economy/fee.js";
import { expiryOf } from "../src/domain/market/rules.js";
import { ECONOMY_BASE, economyPool, ID, recycle, recycleBody } from "./economy-support.js";
import type { FixturePool } from "./fixtures/pool.js";
import { send, type SignedInClient, testDatabaseUrl } from "./support.js";

/**
 * Helpers of the market's route and adversarial tests (economy.md §14). The
 * pool is the economy's (`economy-support.ts`) with a few names and titles
 * the search tests look for. Cards are granted as timer openings written
 * straight to the database, as `dealPack` writes them, so a test can hold
 * fifty copies without fifty openings through the route; Karma is earned
 * the only way there is, by recycling Mythic duplicates through the route,
 * so every account the tests fund audits clean.
 */

/**
 * The app pool with a patient connection wait. The api's own pool gives up
 * after 3 s (`db/client.ts`), so a hundred purchases queued behind one
 * account's lock would fail on the wait for a connection rather than on
 * anything the market decides; the concurrency tests measure the locks.
 */
export function patientDb(): Db {
  return drizzle(new pg.Pool({ connectionString: testDatabaseUrl(), connectionTimeoutMillis: 120_000 }), {
    schema,
  });
}

/** The Mythic every funded account recycles; no test lists or buys it. */
export const FUND_MYTHIC = ID.mythic(12);

/** A rare whose name, native name and franchise titles the search tests look for. */
export const EREN = ID.rare(1);
export const ATTACK_ON_TITAN = 900_000 + ((EREN - ECONOMY_BASE - 1) % 100) + 1;
/** Commons whose names hold the characters LIKE gives a meaning, and an accent. */
export const PERCENT = ID.common(1);
export const UNDERSCORE = ID.common(2);
export const BACKSLASH = ID.common(3);
export const POKEMON = ID.common(4);

/** The economy pool with the names and titles above; everything else is as the economy's tests have it. */
export function marketPool(): FixturePool {
  const pool = economyPool();
  const names = new Map<number, { name: string; native?: string }>([
    [EREN, { name: "Eren Yeager", native: "エレン・イェーガー" }],
    [PERCENT, { name: "Half 50% Off" }],
    [UNDERSCORE, { name: "Snake_Case Sam" }],
    [BACKSLASH, { name: "Back\\Slash" }],
    [POKEMON, { name: "Pokémon Trainer" }],
  ]);
  pool.characters = pool.characters.map((character) => {
    const named = names.get(character.id);
    return named === undefined ? character : { ...character, name: named.name, native: named.native };
  });
  pool.entries = pool.entries.map((entry) =>
    entry.id === ATTACK_ON_TITAN ? { ...entry, title: "Attack on Titan", native: "進撃の巨人" } : entry,
  );
  return pool;
}

/** The granted tier of an economy-pool character, by the id ranges of `ID`. */
export function tierOf(characterId: number): Rarity {
  const offset = characterId - ECONOMY_BASE;
  if (offset <= 12) return "mythic";
  if (offset <= 48) return "legendary";
  if (offset <= 120) return "epic";
  if (offset <= 240) return "rare";
  if (offset <= 390) return "uncommon";
  return "common";
}

/**
 * Gives an account one card per id, at its tier, as timer openings of up to
 * five cards pulled at `at`: what an opening writes, without the allowance.
 */
export async function grantCards(
  app: App,
  accountId: string,
  snapshotId: number,
  ids: readonly number[],
  at: Date,
): Promise<void> {
  for (let start = 0; start < ids.length; start += PACK_SIZE) {
    const chunk = ids.slice(start, start + PACK_SIZE);
    const [opening] = await app.db
      .insert(packOpenings)
      .values({ accountId, requestId: randomUUID(), snapshotId, kind: "standard", pity: false, openedAt: at })
      .returning({ id: packOpenings.id });
    if (opening === undefined) throw new Error("opening insert returned no row");
    await app.db.insert(cards).values(
      chunk.map((characterId, slot) => ({
        accountId,
        openingId: opening.id,
        slot,
        characterId,
        rarity: tierOf(characterId),
        snapshotId,
        isNew: false,
        pulledAt: at,
      })),
    );
  }
}

export const copies = (characterId: number, count: number) =>
  Array.from({ length: count }, () => characterId);

/**
 * Funds an account with at least `karma` Karma the only way there is: Mythic
 * duplicates recycled through the route, 2 750 each. Returns the credit.
 */
export async function fund(
  app: App,
  client: SignedInClient,
  snapshotId: number,
  karma: number,
  at: Date,
): Promise<number> {
  const duplicates = Math.ceil(karma / RECYCLE_VALUE.mythic);
  await grantCards(app, client.account.id, snapshotId, copies(FUND_MYTHIC, duplicates + 1), at);
  for (let left = duplicates; left > 0; left -= MAX_RECYCLE_COUNT) {
    const count = Math.min(left, MAX_RECYCLE_COUNT);
    const res = await recycle(app, client.cookie, recycleBody(FUND_MYTHIC, "mythic", count));
    expect(res.statusCode, res.body).toBe(201);
  }
  return duplicates * RECYCLE_VALUE.mythic;
}

export const listCard = (
  app: App,
  cookie: string | undefined,
  characterId: number,
  price: number,
  options: { rarity?: Rarity; requestId?: string; extra?: Record<string, unknown> } = {},
) =>
  send(app, {
    method: "POST",
    url: "/api/market/listings",
    cookie,
    payload: {
      requestId: options.requestId ?? randomUUID(),
      characterId,
      rarity: options.rarity ?? tierOf(characterId),
      price,
      ...options.extra,
    },
  });

/** Lists one card and returns the listing; the test fails on anything but 201. */
export async function listed(
  app: App,
  client: SignedInClient,
  characterId: number,
  price: number,
): Promise<Listing> {
  const res = await listCard(app, client.cookie, characterId, price);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Listing>();
}

/**
 * Lists `count` of the account's unlisted copies of one character at `price`,
 * written straight to the database as the listing route writes them, for the
 * tests that need a hundred listings to buy and test the buying, not the
 * listing. Returns the listing ids, oldest card first.
 */
export async function seedListings(
  app: App,
  client: SignedInClient,
  characterId: number,
  price: number,
  count: number,
  at: Date,
): Promise<{ listingId: string }[]> {
  const held = await heldCopies(app, client.account.id, characterId);
  if (held.length < count) throw new Error(`only ${held.length} copies of ${characterId} to list`);
  const rows = await app.db
    .insert(marketListings)
    .values(
      held.slice(0, count).map((card) => ({
        sellerId: client.account.id,
        requestId: randomUUID(),
        cardId: card.id,
        characterId,
        rarity: tierOf(characterId),
        price,
        fee: marketFee(price),
        status: "active" as const,
        createdAt: at,
        expiresAt: expiryOf(at),
      })),
    )
    .returning({ listingId: marketListings.id });
  return rows;
}

export const buyListing = (
  app: App,
  cookie: string | undefined,
  listingId: string,
  requestId: string = randomUUID(),
  extra: Record<string, unknown> = {},
) =>
  send(app, {
    method: "POST",
    url: `/api/market/listings/${listingId}/buy`,
    cookie,
    payload: { requestId, ...extra },
  });

/** Buys a listing and returns the receipt; the test fails on anything but 201. */
export async function bought(app: App, client: SignedInClient, listingId: string): Promise<PurchaseReceipt> {
  const res = await buyListing(app, client.cookie, listingId);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PurchaseReceipt>();
}

export const cancelListing = (
  app: App,
  cookie: string | undefined,
  listingId: string,
  payload: unknown = {},
) => send(app, { method: "POST", url: `/api/market/listings/${listingId}/cancel`, cookie, payload });

export const browse = (app: App, cookie: string | undefined, query = "") =>
  send(app, { method: "GET", url: `/api/market/listings${query === "" ? "" : `?${query}`}`, cookie });

export async function page(app: App, cookie: string, query = ""): Promise<ListingsPage> {
  const res = await browse(app, cookie, query);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ListingsPage>();
}

export async function mine(app: App, cookie: string): Promise<MarketMine> {
  const res = await send(app, { method: "GET", url: "/api/market/mine", cookie });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<MarketMine>();
}

export const marketErrorOf = (res: LightMyRequestResponse) =>
  res.json<{
    error: { code: string; message: string; balance?: number; retryAfterSeconds?: number; limit?: string };
  }>().error;

/** The account's held copies of one character at its tier, as rows. */
export function heldCopies(app: App, accountId: string, characterId: number) {
  return app.db
    .select({ id: cards.id, purchaseId: cards.purchaseId, snapshotId: cards.snapshotId })
    .from(cards)
    .where(and(eq(cards.accountId, accountId), eq(cards.characterId, characterId), isNull(cards.removedAt)));
}
