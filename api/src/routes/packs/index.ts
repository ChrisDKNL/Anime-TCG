import { OpenPackBody, PackOpened, PacksResponse } from "@anime-tcg/shared/api";
import { ErrorEnvelope } from "@anime-tcg/shared/errors";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { PACK_RATE_LIMIT } from "../limits.js";
import { requireAccount } from "../require-account.js";
import { NoQuery } from "../schemas.js";

/**
 * The pack allowance, the published odds and the opening (collection-packs.md
 * §6.3). The body names only the client's idempotency key: the server rolls
 * every outcome, and no account, card, opening or snapshot id is accepted.
 */
export const packRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/packs",
    {
      schema: {
        querystring: NoQuery,
        response: { 200: PacksResponse, 400: ErrorEnvelope, 401: ErrorEnvelope },
      },
    },
    async (req, reply): Promise<PacksResponse> => {
      const { account } = await requireAccount(req, reply);
      return app.packs.status(account.id, app.clock());
    },
  );

  /** 201 for a new opening; 200 with the same body when `requestId` names one this account already has. */
  app.post(
    "/packs/open",
    {
      schema: {
        querystring: NoQuery,
        body: OpenPackBody,
        response: {
          200: PackOpened,
          201: PackOpened,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          409: ErrorEnvelope,
          429: ErrorEnvelope,
          503: ErrorEnvelope,
        },
      },
      config: { rateLimit: PACK_RATE_LIMIT },
    },
    async (req, reply): Promise<PackOpened> => {
      const { account } = await requireAccount(req, reply);
      const { replayed, opened } = await app.packs.open(req.log, account.id, req.body.requestId, app.clock);
      reply.code(replayed ? 200 : 201);
      return opened;
    },
  );
};
