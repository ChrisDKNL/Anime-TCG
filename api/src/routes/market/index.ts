import {
  BuyBody,
  CancelBody,
  ListBody,
  Listing,
  ListingParams,
  ListingsPage,
  ListingsQuery,
  MarketMine,
  PurchaseReceipt,
} from "@anime-tcg/shared/api";
import { ErrorEnvelope } from "@anime-tcg/shared/errors";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { CARD_ACTION_RATE_LIMIT } from "../limits.js";
import { requireAccount } from "../require-account.js";
import { NoQuery } from "../schemas.js";

/** The statuses every market POST may answer besides its success (economy.md §11.3). */
const POST_ERRORS = {
  400: ErrorEnvelope,
  401: ErrorEnvelope,
  403: ErrorEnvelope,
  404: ErrorEnvelope,
  409: ErrorEnvelope,
  429: ErrorEnvelope,
} as const;

/**
 * The player market (economy.md §8.3 to §8.5, §11.3): cards for Karma
 * between accounts. A request names a listing or an entry and, when
 * listing, the asking price; the card, the fee, every amount and every
 * limit are the server's.
 */
export const marketRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/market/listings",
    {
      schema: {
        querystring: ListingsQuery,
        response: { 200: ListingsPage, 400: ErrorEnvelope, 401: ErrorEnvelope },
      },
    },
    async (req, reply): Promise<ListingsPage> => {
      const { account } = await requireAccount(req, reply);
      return app.market.browse(account.id, req.query, app.clock());
    },
  );

  app.get(
    "/market/mine",
    {
      schema: {
        querystring: NoQuery,
        response: { 200: MarketMine, 400: ErrorEnvelope, 401: ErrorEnvelope },
      },
    },
    async (req, reply): Promise<MarketMine> => {
      const { account } = await requireAccount(req, reply);
      return app.market.mine(account.id, app.clock());
    },
  );

  /** 201 for a listing; 200 with the listing when `requestId` names one this account already made. */
  app.post(
    "/market/listings",
    {
      schema: {
        querystring: NoQuery,
        body: ListBody,
        response: { 200: Listing, 201: Listing, ...POST_ERRORS },
      },
      config: { rateLimit: CARD_ACTION_RATE_LIMIT },
    },
    async (req, reply): Promise<Listing> => {
      const { account } = await requireAccount(req, reply);
      const { replayed, listing } = await app.market.list(req.log, account.id, req.body, app.clock);
      reply.code(replayed ? 200 : 201);
      return listing;
    },
  );

  /** 201 for a purchase; 200 with the same receipt when `requestId` names one this account already made. */
  app.post(
    "/market/listings/:listingId/buy",
    {
      schema: {
        querystring: NoQuery,
        params: ListingParams,
        body: BuyBody,
        response: { 200: PurchaseReceipt, 201: PurchaseReceipt, ...POST_ERRORS },
      },
      config: { rateLimit: CARD_ACTION_RATE_LIMIT },
    },
    async (req, reply): Promise<PurchaseReceipt> => {
      const { account } = await requireAccount(req, reply);
      const { replayed, receipt } = await app.market.buy(
        req.log,
        account.id,
        req.params.listingId,
        req.body,
        app.clock,
      );
      reply.code(replayed ? 200 : 201);
      return receipt;
    },
  );

  app.post(
    "/market/listings/:listingId/cancel",
    {
      schema: {
        querystring: NoQuery,
        params: ListingParams,
        body: CancelBody,
        response: { 200: Listing, ...POST_ERRORS },
      },
      config: { rateLimit: CARD_ACTION_RATE_LIMIT },
    },
    async (req, reply): Promise<Listing> => {
      const { account } = await requireAccount(req, reply);
      return app.market.cancel(req.log, account.id, req.params.listingId, app.clock);
    },
  );
};
