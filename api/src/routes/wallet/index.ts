import { Wallet } from "@anime-tcg/shared/api";
import { ErrorEnvelope } from "@anime-tcg/shared/errors";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { requireAccount } from "../require-account.js";
import { NoQuery } from "../schemas.js";

/** The signed-in account's Karma balance and every rule that governs it (economy.md §11.3). */
export const walletRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/wallet",
    {
      schema: {
        querystring: NoQuery,
        response: { 200: Wallet, 400: ErrorEnvelope, 401: ErrorEnvelope },
      },
    },
    async (req, reply): Promise<Wallet> => {
      const { account } = await requireAccount(req, reply);
      return app.economy.wallet(account.id, app.clock());
    },
  );
};
