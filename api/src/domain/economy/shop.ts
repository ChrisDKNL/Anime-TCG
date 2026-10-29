import type { ShopBuyBody, ShopReceipt, ShopResponse, ThemeOffer } from "@anime-tcg/shared/api";
import { PACK_SIZE, THEMED_PACK_PRICE } from "@anime-tcg/shared/economy";
import { ODDS_SCALE } from "@anime-tcg/shared/rarity";
import { eq } from "drizzle-orm";
import type { Db, Queryable } from "../../db/client.js";
import { accounts } from "../../db/schema.js";
import { ApiError } from "../errors.js";
import { publishedPerPack, publishedRadiant, publishedSlots } from "../packs/odds.js";
import type { Rng } from "../packs/rng.js";
import {
  dealPack,
  describeOpening,
  LOCKED_ACCOUNT,
  requestIdReused,
  type StoredOpening,
  storedOpening,
} from "../packs/service.js";
import { currentSnapshot, franchiseRefs } from "../pool/catalog.js";
import { postEntry } from "./ledger.js";
import type { EconomyLog } from "./service.js";
import { snapshotThemes, type Theme } from "./themes.js";

function offerOf(theme: Theme): ThemeOffer {
  return {
    id: theme.id,
    title: theme.title,
    cards: PACK_SIZE,
    franchiseIds: theme.franchiseIds,
    price: THEMED_PACK_PRICE,
    odds: {
      scale: ODDS_SCALE,
      perSlot: publishedSlots(),
      perPack: publishedPerPack(),
      tierSizes: theme.tierSizes,
      radiant: publishedRadiant(),
    },
  };
}

/**
 * Whether a stored opening is the same request as a purchase of `themeId`
 * (economy.md §8.8): a shop opening of that theme. A timer opening never
 * matches a purchase, and a purchase of another theme does not either.
 */
export function sameShopRequest(stored: Pick<StoredOpening, "shop">, themeId: string): boolean {
  return stored.shop !== null && stored.shop.themeId === themeId;
}

function signedOut(): ApiError {
  return new ApiError(401, "unauthenticated", "Sign in first");
}

/**
 * The Karma shop (economy.md §8.6): the themed packs of the current
 * snapshot and their purchase. A purchase debits the price and deals the
 * pack in one transaction under the account lock, through the same
 * `dealPack` as the free pack; it never reads or writes the allowance.
 */
export class ShopService {
  /** Snapshots never change once written, so one snapshot's themes are good for as long as the process runs. */
  private cached: { snapshotId: number; themes: Map<string, Theme> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly rng: Rng,
  ) {}

  async offers(): Promise<ShopResponse> {
    const snapshot = await currentSnapshot(this.db);
    if (snapshot === null) return { themes: [], franchises: [], snapshot: null };
    const themes = [...(await this.themesOf(this.db, snapshot.id)).values()];
    return {
      themes: themes.map(offerOf),
      franchises: await franchiseRefs(
        this.db,
        themes.flatMap((theme) => theme.franchiseIds),
      ),
      snapshot: snapshot.info,
    };
  }

  /** `replayed` is true when `requestId` named a purchase of the same theme this account already made (200, not 201). */
  async buy(
    log: EconomyLog,
    accountId: string,
    body: ShopBuyBody,
    now: Date,
  ): Promise<{ replayed: boolean; receipt: ShopReceipt }> {
    const result = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ ...LOCKED_ACCOUNT, balance: accounts.balance })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for("update");
      if (locked === undefined) throw signedOut();
      const { balance, ...account } = locked;

      const stored = await storedOpening(tx, accountId, body.requestId);
      if (stored !== null) {
        if (!sameShopRequest(stored, body.themeId) || stored.shop === null) throw requestIdReused();
        return { replayed: true, opening: stored, account, price: stored.shop.price, balance };
      }

      const snapshot = await currentSnapshot(tx);
      if (snapshot === null) throw new ApiError(503, "pool_unavailable", "Cards are not available right now");
      const theme = (await this.themesOf(tx, snapshot.id)).get(body.themeId);
      if (theme === undefined) throw new ApiError(404, "theme_unavailable", "That pack is not on offer");

      const entry = await postEntry(tx, { id: accountId, balance }, "shop_purchase", -THEMED_PACK_PRICE, now);
      const dealt = await dealPack(
        tx,
        { account, requestId: body.requestId, openedAt: now },
        this.rng,
        { snapshotId: snapshot.id, tiers: theme.tiers },
        "shop",
        { themeId: theme.id, ledgerEntryId: entry.id, price: THEMED_PACK_PRICE },
      );
      return { replayed: false, ...dealt, price: THEMED_PACK_PRICE, balance: entry.balanceAfter };
    });

    const { replayed, opening, account, price, balance } = result;
    log.info(
      {
        accountId,
        openingId: opening.openingId,
        themeId: body.themeId,
        kind: opening.kind,
        price,
        balanceAfter: balance,
        replayed,
      },
      "shop pack bought",
    );
    return {
      replayed,
      receipt: {
        pack: await describeOpening(this.db, opening, account, now),
        themeId: body.themeId,
        price,
        balance,
      },
    };
  }

  private async themesOf(db: Queryable, snapshotId: number): Promise<Map<string, Theme>> {
    if (this.cached?.snapshotId !== snapshotId) {
      const themes = await snapshotThemes(db, snapshotId);
      this.cached = { snapshotId, themes: new Map(themes.map((theme) => [theme.id, theme])) };
    }
    return this.cached.themes;
  }
}
