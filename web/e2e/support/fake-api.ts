/// <reference lib="dom" />
import { expect, test as base, type BrowserContext, type Page, type Route } from "@playwright/test";
import type {
  AccountPublic,
  ClosedListing,
  CollectionEntry,
  Listing,
  ListingSort,
  PurchaseReceipt,
  Rarity,
  RecycleReceipt,
  SessionResponse,
  ShopReceipt,
  WindowLeft,
} from "@anime-tcg/shared/api";
import type { ErrorCode, MarketLimit } from "@anime-tcg/shared/errors";
import {
  makeAllowance,
  makeCharacter,
  makeCollection,
  makeDemo,
  makeDemoCard,
  makeDemoOpened,
  makeEntry,
  makeListingsPage,
  makePackOpened,
  makePacks,
  makeRules,
  makeShop,
  makeWallet,
} from "../../src/test/fixtures";

/**
 * e2e support for the UI against a scripted api (docs/design/accounts.md, packs-page.md).
 *
 * `page.route` answers every `/api/*` request before it reaches the Vite proxy, so these
 * tests never need the real api. Card art comes from a 1x1 PNG in place of AniList's image
 * CDN, and the browser never calls AniList's API: the fixture fails any test whose page
 * sends a request to `graphql.anilist.co` (collection-packs.md §8). A request the test did
 * not script is answered with a 500 envelope and fails the test in the fixture teardown,
 * so the UI cannot call something unexpected without the test noticing; the packs, collection,
 * wallet, shop, recycle and market routes have a stateful default (`FakeGame`) that a test can
 * override, and the landing page's demo answers the fixture facts and a fresh pack per opening.
 */

// 1x1 transparent PNG so card images resolve without hitting AniList's CDN.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A 1x1 image for every portrait, so no test reaches AniList's image CDN. */
export async function mockCardImages(target: Page | BrowserContext): Promise<void> {
  await target.route("https://s4.anilist.co/**", (route) =>
    route.fulfill({ body: PNG, contentType: "image/png" }),
  );
}

/**
 * The login as the app writes it into a plain string (the Account control's aria-label, the
 * title bar, the Reset confirm): between U+2068 FIRST STRONG ISOLATE and U+2069 POP DIRECTIONAL
 * ISOLATE, the plain-text counterpart of <bdi> (T1, docs/05-security.md).
 */
export const isolated = (login: string): string => `\u2068${login}\u2069`;

export function makeAccount(overrides: Partial<AccountPublic> = {}): AccountPublic {
  return {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    login: "Chris",
    createdAt: "2026-10-28T09:30:00.000Z",
    cards: 0,
    ...overrides,
  };
}

/** What the scripted api sends back: JSON, a raw non-JSON body (a proxy error page), or nothing (204). */
export interface Answer {
  status: number;
  json?: unknown;
  raw?: string;
  /** Extra response headers, e.g. `Retry-After` on a 429 (the api's rate limiter sends no number in the body). */
  headers?: Record<string, string>;
}

export interface ApiCall {
  /** `"METHOD /path"`, e.g. `"POST /api/session/login"`; the query string is not part of it. */
  key: string;
  body: unknown;
  /** The query string, `?` included, or `""`. */
  search: string;
}

/** An answer, a dropped connection, or a function of the call (which may wait, to hold a request in flight). */
export type Reply = Answer | "abort" | ((call: ApiCall) => Answer | "abort" | Promise<Answer | "abort">);

export const signedIn = (account: AccountPublic): Answer => ({
  status: 200,
  json: { signedIn: true, account } satisfies SessionResponse,
});
export const signedOut: Answer = { status: 200, json: { signedIn: false } satisfies SessionResponse };
export const noContent: Answer = { status: 204 };
export const accountAnswer = (account: AccountPublic): Answer => ({ status: 200, json: { account } });

/** The api's error envelope for a code, shaped like `shared/errors`. */
export function envelope(status: number, code: ErrorCode, retryAfterSeconds?: number): Answer {
  const error =
    retryAfterSeconds === undefined ? { code, message: code } : { code, message: code, retryAfterSeconds };
  return { status, json: { error } };
}

/** `market_limit` as the api sends it: which limit, its seconds in the envelope and in `Retry-After`. */
export function marketLimit(limit: MarketLimit, retryAfterSeconds: number): Answer {
  return {
    status: 409,
    json: { error: { code: "market_limit", message: "market_limit", limit, retryAfterSeconds } },
    headers: { "retry-after": String(retryAfterSeconds) },
  };
}

/** A promise the test resolves itself: hold a request in flight, then let it answer. */
export function deferred(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * The packs and collection routes of one account, with state: `available` packs of a cap
 * of `cap`, each opening deals five characters no earlier opening dealt into the
 * collection, and `pity` free packs to the guarantee. A test scripts these routes itself
 * to override them.
 *
 * Like the api (collection-packs.md §5.3), an opening whose `requestId` this account has
 * already used is a replay: answered 200 with the cards that opening dealt and the
 * allowance as it is now, before the allowance is checked, and nothing more is spent.
 *
 * The economy (economy.md §8): a `balance`, the shop's one theme at `THEMED_PACK_PRICE`, and
 * `held` entries a test seeds with duplicates to recycle. A shop purchase debits the price
 * and deals a pack into the collection without touching the allowance; a recycle takes
 * duplicates of a held entry, never its last copy, and credits the wallet's recycle value.
 * Both answer a used `requestId` with 200 and the original receipt at today's balance, and
 * refuse as the api does: `insufficient_funds` with the balance, `not_enough_copies`.
 */
export class FakeGame {
  cap = 3;
  available = 3;
  opened = 0;
  pity = 300;
  /** The opening number each `requestId` dealt, for the replay. */
  readonly openings = new Map<string, number>();
  balance = 1_240;
  /** Entries the account holds besides what its openings dealt: the test's duplicates. */
  held: CollectionEntry[] = [];
  readonly purchases = new Map<string, ShopReceipt>();
  readonly recycles = new Map<string, RecycleReceipt>();
  private readonly rules = makeRules();
  /**
   * The market (economy.md §8.3 to §8.5): every listing, active or not, of every account; the
   * caller's own are `mine`. Browse pages hold `pageSize` listings, and the cursor is the offset.
   */
  market: Listing[] = [];
  pageSize = 50;
  /** The caller's purchases and listings by `requestId`, for the replays. */
  readonly bought = new Map<string, PurchaseReceipt>();
  readonly listedBy = new Map<string, Listing>();
  /** What the caller's window limits have left; a test sets `limit` to refuse every purchase with it. */
  left: WindowLeft = { purchases: 100, spend: 55_000, proceeds: 55_000 };
  limit: { limit: MarketLimit; retryAfterSeconds: number } | null = null;
  /** Demo packs dealt; each one's characters are new, so two reveals can be told apart. */
  demos = 0;

  private allowance() {
    return makeAllowance({
      available: this.available,
      cap: this.cap,
      nextPackInSeconds: this.available >= this.cap ? null : 600,
    });
  }

  /** The `n`th opening's cards (from 1): the fixture pack's tiers, its own characters. */
  private cards(n: number) {
    return makePackOpened().cards.map((card) => ({
      ...card,
      character: makeCharacter(1_000 + n * 10 + card.slot, { tier: card.rarity }),
    }));
  }

  /** The `n`th opening as the api answers it now: its cards, the allowance and pity count of this moment. */
  private pack(n: number) {
    return makePackOpened({
      openingId: `6f9c1a52-4c1e-4b8e-9d3a-${String(n).padStart(12, "0")}`,
      cards: this.cards(n),
      allowance: this.allowance(),
      packsUntilGuarantee: this.pity,
    });
  }

  reply(key: string, body?: unknown, search = ""): Answer | undefined {
    switch (key) {
      case "GET /api/packs":
        return {
          status: 200,
          json: makePacks({ allowance: this.allowance(), packsUntilGuarantee: this.pity }),
        };
      case "POST /api/packs/open": {
        const requestId = (body as { requestId?: unknown } | undefined)?.requestId;
        const replayed = typeof requestId === "string" ? this.openings.get(requestId) : undefined;
        if (replayed !== undefined) return { status: 200, json: this.pack(replayed) };
        if (this.available === 0) return envelope(409, "no_pack_available", 600);
        this.available -= 1;
        this.opened += 1;
        this.pity -= 1;
        if (typeof requestId === "string") this.openings.set(requestId, this.opened);
        return { status: 201, json: this.pack(this.opened) };
      }
      case "GET /api/demo":
        return { status: 200, json: makeDemo() };
      case "POST /api/demo/open": {
        this.demos += 1;
        const cards = makeDemoOpened().cards.map((card) =>
          makeDemoCard(card.slot, {
            rarity: card.rarity,
            character: makeCharacter(5_000 + this.demos * 10 + card.slot, { tier: card.rarity }),
          }),
        );
        return { status: 200, json: makeDemoOpened(cards) };
      }
      case "GET /api/collection": {
        const entries = Array.from({ length: this.opened }, (_, i) => this.cards(i + 1))
          .flat()
          .sort((a, b) => b.slot - a.slot)
          .map((card) => makeEntry(card.character, { rarity: card.rarity }));
        return { status: 200, json: makeCollection([...this.held, ...entries]) };
      }
      case "GET /api/wallet":
        return {
          status: 200,
          json: { ...makeWallet(this.balance), activeListings: this.market.filter(isMineActive).length },
        };
      case "GET /api/shop":
        return { status: 200, json: makeShop() };
      case "POST /api/shop/buy":
        return this.buy(body as { requestId: string; themeId: string });
      case "POST /api/collection/recycle":
        return this.recycle(
          body as { requestId: string; characterId: number; rarity: Rarity; count: number },
        );
      case "GET /api/market/listings":
        return this.browse(new URLSearchParams(search));
      case "GET /api/market/mine":
        return this.mine();
      case "POST /api/market/listings":
        return this.list(body as { requestId: string; characterId: number; rarity: Rarity; price: number });
      default:
        return this.listingAction(key, body);
    }
  }

  private browse(query: URLSearchParams): Answer {
    const sort = (query.get("sort") ?? "price_asc") as ListingSort;
    const rarity = query.get("rarity");
    const franchiseId = query.get("franchiseId");
    const characterId = query.get("characterId");
    const terms = (query.get("q") ?? "")
      .toLowerCase()
      .split(" ")
      .filter((term) => term !== "");
    const active = this.market.filter((listing) => listing.status === "active");
    const matches = active
      .filter(
        (listing) =>
          (rarity === null || listing.rarity === rarity) &&
          (franchiseId === null || listing.character.franchiseIds.includes(Number(franchiseId))) &&
          (characterId === null || listing.character.id === Number(characterId)) &&
          terms.every((term) => listing.character.name.toLowerCase().includes(term)),
      )
      .sort((a, b) => {
        if (sort === "newest")
          return b.listedAt.localeCompare(a.listedAt) || a.listingId.localeCompare(b.listingId);
        const order = sort === "price_asc" ? a.price - b.price : b.price - a.price;
        return order || a.listingId.localeCompare(b.listingId);
      });
    const cursor = query.get("cursor");
    const offset = cursor === null ? 0 : Number(cursor.slice(1));
    const next = offset + this.pageSize;
    const page = makeListingsPage(matches.slice(offset, next), {
      nextCursor: next < matches.length ? `o${next}` : null,
      first: cursor === null,
    });
    if (cursor === null) {
      const ids = new Set(active.flatMap((listing) => listing.character.franchiseIds));
      page.filterFranchiseIds = page.franchises.flatMap((franchise) =>
        ids.has(franchise.id) ? [franchise.id] : [],
      );
    }
    return { status: 200, json: page };
  }

  private mine(): Answer {
    const closed: ClosedListing[] = this.market
      .filter((listing) => listing.mine && listing.status !== "active")
      .map((listing) => ({
        ...listing,
        proceeds: listing.status === "sold" ? listing.price - listing.fee : null,
      }));
    return {
      status: 200,
      json: {
        active: this.market.filter(isMineActive),
        closed,
        purchases: [...this.bought.values()],
        left: this.left,
        franchises: makeListingsPage([]).franchises,
      },
    };
  }

  private list(body: { requestId: string; characterId: number; rarity: Rarity; price: number }): Answer {
    const replayed = this.listedBy.get(body.requestId);
    if (replayed !== undefined) return { status: 200, json: replayed };
    if (body.price < this.rules.priceMin[body.rarity] || body.price > this.rules.priceMax[body.rarity]) {
      return envelope(400, "price_out_of_bounds");
    }
    const index = this.held.findIndex(
      (entry) => entry.character.id === body.characterId && entry.rarity === body.rarity,
    );
    const entry = this.held[index];
    if (entry === undefined || entry.available < 1) return envelope(409, "not_enough_copies");
    const listed = entry.listed + 1;
    const available = entry.count - listed;
    this.held[index] = { ...entry, listed, available, recyclable: Math.min(entry.count - 1, available) };
    const listing: Listing = {
      listingId: `9e8d7c6b-5a4f-4e3d-8c2b-${String(this.market.length + 1).padStart(12, "0")}`,
      kind: "card",
      character: entry.character,
      rarity: entry.rarity,
      variant: "standard",
      price: body.price,
      fee: Math.max(this.rules.feeMin, Math.ceil((body.price * this.rules.feeBps) / 10_000)),
      listedAt: "2026-10-30T12:00:00.000Z",
      expiresAt: "2026-11-06T12:00:00.000Z",
      closedAt: null,
      status: "active",
      mine: true,
    };
    this.market.push(listing);
    this.listedBy.set(body.requestId, listing);
    return { status: 201, json: listing };
  }

  /** `POST /api/market/listings/{id}/buy` and `.../cancel`. */
  private listingAction(key: string, body: unknown): Answer | undefined {
    const match = /^POST \/api\/market\/listings\/([^/]+)\/(buy|cancel)$/.exec(key);
    if (match === null) return undefined;
    const [, listingId, action] = match;
    const index = this.market.findIndex((listing) => listing.listingId === listingId);
    if (action === "cancel") return this.cancel(index);
    return this.buyListing(index, (body as { requestId: string }).requestId);
  }

  private buyListing(index: number, requestId: string): Answer {
    const replayed = this.bought.get(requestId);
    if (replayed !== undefined) return { status: 200, json: { ...replayed, balance: this.balance } };
    const listing = this.market[index];
    if (listing === undefined) return envelope(404, "listing_not_found");
    if (listing.mine) return envelope(409, "own_listing");
    if (listing.status !== "active") return envelope(409, "listing_unavailable");
    if (this.limit !== null) return marketLimit(this.limit.limit, this.limit.retryAfterSeconds);
    if (this.balance < listing.price) {
      return {
        status: 409,
        json: { error: { code: "insufficient_funds", message: "insufficient_funds", balance: this.balance } },
      };
    }
    this.balance -= listing.price;
    this.market[index] = { ...listing, status: "sold", closedAt: "2026-10-30T12:30:00.000Z" };
    this.held.push(makeEntry(listing.character, { rarity: listing.rarity }));
    this.left = { ...this.left, purchases: this.left.purchases - 1, spend: this.left.spend - listing.price };
    const receipt: PurchaseReceipt = {
      purchaseId: `4c3b2a19-8f7e-4d6c-9b5a-${String(this.bought.size + 1).padStart(12, "0")}`,
      boughtAt: "2026-10-30T12:30:00.000Z",
      listingId: listing.listingId,
      price: listing.price,
      card: {
        kind: "card",
        character: listing.character,
        rarity: listing.rarity,
        variant: "standard",
        isNew: true,
      },
      franchises: makeListingsPage([]).franchises,
      balance: this.balance,
    };
    this.bought.set(requestId, receipt);
    return { status: 201, json: receipt };
  }

  private cancel(index: number): Answer {
    const listing = this.market[index];
    if (listing === undefined || !listing.mine) return envelope(404, "listing_not_found");
    if (listing.status === "sold") return envelope(409, "listing_unavailable");
    if (listing.status !== "active") return { status: 200, json: listing };
    const cancelled: Listing = { ...listing, status: "cancelled", closedAt: "2026-10-30T12:45:00.000Z" };
    this.market[index] = cancelled;
    const entryIndex = this.held.findIndex(
      (entry) => entry.character.id === listing.character.id && entry.rarity === listing.rarity,
    );
    const entry = this.held[entryIndex];
    if (entry !== undefined) {
      const listed = Math.max(0, entry.listed - 1);
      const available = entry.count - listed;
      this.held[entryIndex] = {
        ...entry,
        listed,
        available,
        recyclable: Math.min(entry.count - 1, available),
      };
    }
    return { status: 200, json: cancelled };
  }

  private buy({ requestId, themeId }: { requestId: string; themeId: string }): Answer {
    const replayed = this.purchases.get(requestId);
    if (replayed !== undefined) return { status: 200, json: { ...replayed, balance: this.balance } };
    const price = this.rules.themedPackPrice;
    if (this.balance < price) {
      return {
        status: 409,
        json: { error: { code: "insufficient_funds", message: "insufficient_funds", balance: this.balance } },
      };
    }
    this.balance -= price;
    this.opened += 1;
    const receipt: ShopReceipt = { pack: this.pack(this.opened), themeId, price, balance: this.balance };
    this.purchases.set(requestId, receipt);
    return { status: 201, json: receipt };
  }

  private recycle(body: { requestId: string; characterId: number; rarity: Rarity; count: number }): Answer {
    const replayed = this.recycles.get(body.requestId);
    if (replayed !== undefined) return { status: 200, json: { ...replayed, balance: this.balance } };
    const index = this.held.findIndex(
      (entry) => entry.character.id === body.characterId && entry.rarity === body.rarity,
    );
    const entry = this.held[index];
    if (entry === undefined || body.count > entry.recyclable) return envelope(409, "not_enough_copies");
    const credited = body.count * this.rules.recycleValues[body.rarity];
    this.balance += credited;
    const count = entry.count - body.count;
    const available = count - entry.listed;
    this.held[index] = { ...entry, count, available, recyclable: Math.min(count - 1, available) };
    const receipt: RecycleReceipt = {
      recycleId: `0b8a6c1e-2f3d-4e5f-8a9b-${String(this.recycles.size + 1).padStart(12, "0")}`,
      recycledAt: "2026-10-30T09:00:00.000Z",
      recycled: { characterId: body.characterId, rarity: body.rarity, count: body.count },
      credited,
      balance: this.balance,
    };
    this.recycles.set(body.requestId, receipt);
    return { status: 201, json: receipt };
  }
}

function isMineActive(listing: Listing): boolean {
  return listing.mine && listing.status === "active";
}

export class FakeApi {
  readonly calls: ApiCall[] = [];
  readonly unexpected: string[] = [];
  readonly game = new FakeGame();
  private readonly replies = new Map<string, Reply[]>();

  /** Scripts `"METHOD /path"`: each call takes the next reply; the last one keeps answering. */
  on(key: string, ...replies: Reply[]): this {
    this.replies.set(key, [...replies]);
    return this;
  }

  count(key: string): number {
    return this.calls.filter((call) => call.key === key).length;
  }

  bodies(key: string): unknown[] {
    return this.calls.filter((call) => call.key === key).map((call) => call.body);
  }

  /** The test's script for `key`, else the game's default for it, else nothing (an unexpected call). */
  private nextReply(call: ApiCall): Reply | undefined {
    const queue = this.replies.get(call.key);
    if (queue === undefined || queue.length === 0) return this.game.reply(call.key, call.body, call.search);
    return queue.length > 1 ? queue.shift() : queue[0];
  }

  async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    const raw = request.postData();
    const call: ApiCall = {
      key,
      body: raw === null ? undefined : (JSON.parse(raw) as unknown),
      search: url.search,
    };
    this.calls.push(call);
    const reply = this.nextReply(call);
    if (reply === undefined) {
      this.unexpected.push(key);
      await route.fulfill(envelope(500, "internal"));
      return;
    }
    const answer = typeof reply === "function" ? await reply(call) : reply;
    if (answer === "abort") {
      await route.abort("connectionrefused");
    } else if (answer.raw !== undefined) {
      await route.fulfill({
        status: answer.status,
        body: answer.raw,
        contentType: "text/html",
        headers: answer.headers,
      });
    } else if (answer.json === undefined) {
      await route.fulfill({ status: answer.status, headers: answer.headers });
    } else {
      await route.fulfill({ status: answer.status, json: answer.json, headers: answer.headers });
    }
  }
}

/** Collects every request a page sends to AniList's API; the browser must send none. */
export function recordAniListApiCalls(target: Page | BrowserContext): string[] {
  const seen: string[] = [];
  target.on("request", (request) => {
    if (new URL(request.url()).hostname === "graphql.anilist.co") seen.push(request.url());
  });
  return seen;
}

/** `test` with card images mocked and a scripted api on every page; unscripted api calls fail the test. */
export const test = base.extend<{ api: FakeApi }>({
  api: async ({ page }, provide) => {
    await mockCardImages(page);
    const aniListApi = recordAniListApiCalls(page);
    const api = new FakeApi();
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      (route) => api.handle(route),
    );
    await provide(api);
    expect(api.unexpected, "api calls the test did not script").toEqual([]);
    expect(aniListApi, "requests to AniList's API from the browser").toEqual([]);
  },
});

export { expect };

declare global {
  interface Window {
    __statusTexts?: string[];
    __labels?: string[];
    __seenAt?: Record<string, number>;
  }
}

/**
 * Records, in order, every non-empty text any `role="status"` element takes (the app's live
 * region, the session-ended banner, the breather). This is how "announced once" is checked
 * without racing a polling assertion against a one-second countdown. Call before `goto`.
 */
export async function recordStatusTexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    window.__statusTexts = seen;
    const last = new WeakMap<Element, string>();
    const scan = () => {
      document.querySelectorAll('[role="status"]').forEach((element) => {
        const text = element.textContent ?? "";
        if (text !== "" && last.get(element) !== text) seen.push(text);
        last.set(element, text);
      });
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

export async function statusTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__statusTexts ?? []);
}

/**
 * Records `performance.now()` the first time each needle appears in the page text, so a
 * delay ("Loading… only after 300 ms") is measured in the page instead of by polling.
 */
export async function recordFirstSeen(page: Page, needles: string[]): Promise<void> {
  await page.addInitScript((wanted: string[]) => {
    const seenAt: Record<string, number> = {};
    window.__seenAt = seenAt;
    new MutationObserver(() => {
      const text = document.body?.textContent ?? "";
      for (const needle of wanted) {
        if (!(needle in seenAt) && text.includes(needle)) seenAt[needle] = performance.now();
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, needles);
}

export async function firstSeen(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => window.__seenAt ?? {});
}
