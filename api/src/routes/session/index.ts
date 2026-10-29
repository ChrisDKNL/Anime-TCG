import { LoginBody, SessionResponse, SignedIn } from "@anime-tcg/shared/api";
import { ErrorEnvelope } from "@anime-tcg/shared/errors";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { toPublic } from "../../domain/accounts/service.js";
import { AUTH_RATE_LIMIT } from "../limits.js";
import { currentAccount } from "../require-account.js";
import { NoQuery } from "../schemas.js";

/**
 * Fastify validates an absent body as `null`, so this schema means "no body":
 * `{}` or anything else is a 400 like any other unknown field.
 */
const NoBody = Type.Null();

export const sessionRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/session",
    { schema: { querystring: NoQuery, response: { 200: SessionResponse } } },
    async (req, reply): Promise<SessionResponse> => {
      const account = await currentAccount(req, reply);
      return account === null ? { signedIn: false } : { signedIn: true, account: toPublic(account) };
    },
  );

  app.post(
    "/session/login",
    {
      schema: {
        body: LoginBody,
        response: { 200: SignedIn, 400: ErrorEnvelope, 401: ErrorEnvelope, 429: ErrorEnvelope },
      },
      config: { rateLimit: AUTH_RATE_LIMIT },
    },
    async (req, reply): Promise<SignedIn> => {
      const account = await app.accounts.login(req.log, req.body, new Date());
      await reply.createSession(account.id);
      return { signedIn: true, account: toPublic(account) };
    },
  );

  /** Signed out is still a 204: the outcome is the same and there is nothing to tell an attacker. */
  app.post(
    "/session/logout",
    { schema: { body: NoBody, response: { 204: NoBody, 400: ErrorEnvelope } } },
    async (_req, reply) => {
      await reply.destroySession();
      return reply.code(204).send(null);
    },
  );
};
