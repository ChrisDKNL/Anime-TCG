import { CollectionResponse, RecycleBody, RecycleReceipt } from "@anime-tcg/shared/api";
import { ErrorEnvelope } from "@anime-tcg/shared/errors";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { CARD_ACTION_RATE_LIMIT } from "../limits.js";
import { requireAccount } from "../require-account.js";
import { NoQuery } from "../schemas.js";

/**
 * The signed-in account's collection (collection-packs.md §5.5) and
 * recycling its duplicates for Karma (economy.md §8.2), the one route
 * besides an opening that changes it.
 */
export const collectionRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/collection",
    {
      schema: {
        querystring: NoQuery,
        response: { 200: CollectionResponse, 400: ErrorEnvelope, 401: ErrorEnvelope },
      },
    },
    async (req, reply): Promise<CollectionResponse> => {
      const { account } = await requireAccount(req, reply);
      return app.collection.read(account.id);
    },
  );

  /** 201 for a recycle; 200 with the same receipt when `requestId` names one this account already made. */
  app.post(
    "/collection/recycle",
    {
      schema: {
        querystring: NoQuery,
        body: RecycleBody,
        response: {
          200: RecycleReceipt,
          201: RecycleReceipt,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          409: ErrorEnvelope,
          429: ErrorEnvelope,
        },
      },
      config: { rateLimit: CARD_ACTION_RATE_LIMIT },
    },
    async (req, reply): Promise<RecycleReceipt> => {
      const { account } = await requireAccount(req, reply);
      const { replayed, receipt } = await app.economy.recycle(req.log, account.id, req.body, app.clock);
      reply.code(replayed ? 200 : 201);
      return receipt;
    },
  );
};
