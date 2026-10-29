import { ShopBuyBody, ShopReceipt, ShopResponse } from "@anime-tcg/shared/api";
import { ErrorEnvelope } from "@anime-tcg/shared/errors";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { CARD_ACTION_RATE_LIMIT } from "../limits.js";
import { requireAccount } from "../require-account.js";
import { NoQuery } from "../schemas.js";

/**
 * The Karma shop (economy.md §8.6, §11.3). A purchase names the theme and
 * the idempotency key; the price, the odds and every card are the server's.
 */
export const shopRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/shop",
    {
      schema: {
        querystring: NoQuery,
        response: { 200: ShopResponse, 400: ErrorEnvelope, 401: ErrorEnvelope },
      },
    },
    async (req, reply): Promise<ShopResponse> => {
      await requireAccount(req, reply);
      return app.shop.offers();
    },
  );

  /** 201 for a purchase; 200 with the same pack and price when `requestId` names one this account already made. */
  app.post(
    "/shop/buy",
    {
      schema: {
        querystring: NoQuery,
        body: ShopBuyBody,
        response: {
          200: ShopReceipt,
          201: ShopReceipt,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
          429: ErrorEnvelope,
          503: ErrorEnvelope,
        },
      },
      config: { rateLimit: CARD_ACTION_RATE_LIMIT },
    },
    async (req, reply): Promise<ShopReceipt> => {
      const { account } = await requireAccount(req, reply);
      const { replayed, receipt } = await app.shop.buy(req.log, account.id, req.body, app.clock());
      reply.code(replayed ? 200 : 201);
      return receipt;
    },
  );
};
