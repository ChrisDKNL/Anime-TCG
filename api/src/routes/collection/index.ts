import { CollectionResponse } from "@anime-tcg/shared/api";
import { ErrorEnvelope } from "@anime-tcg/shared/errors";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { requireAccount } from "../require-account.js";
import { NoQuery } from "../schemas.js";

/** The signed-in account's collection (collection-packs.md §5.5); there is no route that changes it besides an opening. */
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
};
