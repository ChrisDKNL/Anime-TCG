import {
  AccountResponse,
  ChangePasswordBody,
  DeleteBody,
  InviteBody,
  RegisterBody,
  RenameBody,
  SignedIn,
} from "@anime-tcg/shared/api";
import { ErrorEnvelope } from "@anime-tcg/shared/errors";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { toPublic } from "../../domain/accounts/service.js";
import { AUTH_RATE_LIMIT, RENAME_RATE_LIMIT } from "../limits.js";
import { requireAccount } from "../require-account.js";

const NoBody = Type.Null();

/**
 * Registration under /accounts, the signed-in account under /account. There is
 * no account id in any path or body: the session says who is acting, and
 * `requireAccount` runs before anything account-scoped (spec §6.5).
 */
export const accountRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/accounts/check-invite",
    {
      schema: { body: InviteBody, response: { 204: NoBody, 400: ErrorEnvelope, 403: ErrorEnvelope } },
      config: { rateLimit: AUTH_RATE_LIMIT },
    },
    async (req, reply) => {
      await app.accounts.checkInvite(req.body);
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/accounts/register",
    {
      schema: {
        body: RegisterBody,
        response: { 201: SignedIn, 400: ErrorEnvelope, 403: ErrorEnvelope, 409: ErrorEnvelope },
      },
      config: { rateLimit: AUTH_RATE_LIMIT },
    },
    async (req, reply): Promise<SignedIn> => {
      const account = await app.accounts.register(req.log, req.body);
      await reply.createSession(account.id);
      reply.code(201);
      return { signedIn: true, account: toPublic(account) };
    },
  );

  app.patch(
    "/account/login",
    {
      schema: {
        body: RenameBody,
        response: { 200: AccountResponse, 400: ErrorEnvelope, 401: ErrorEnvelope, 409: ErrorEnvelope },
      },
      config: { rateLimit: RENAME_RATE_LIMIT },
    },
    async (req, reply): Promise<AccountResponse> => {
      const { account } = await requireAccount(req, reply);
      const renamed = await app.accounts.rename(req.log, account.id, req.body, new Date());
      return { account: toPublic(renamed) };
    },
  );

  /** Every other session of the account ends; the current one is kept for `createSession` to rotate, so the response carries the new cookie. */
  app.post(
    "/account/change-password",
    {
      schema: {
        body: ChangePasswordBody,
        response: {
          204: NoBody,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          429: ErrorEnvelope,
        },
      },
      config: { rateLimit: AUTH_RATE_LIMIT },
    },
    async (req, reply) => {
      const { account, session } = await requireAccount(req, reply);
      await app.accounts.changePassword(req.log, account.id, req.body, new Date());
      await app.sessions.destroyAllForAccount(account.id, session.id);
      await reply.createSession(account.id);
      return reply.code(204).send(null);
    },
  );

  /** The sessions cascade away with the row; destroySession only has the cookie left to clear. */
  app.post(
    "/account/delete",
    {
      schema: {
        body: DeleteBody,
        response: {
          204: NoBody,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          429: ErrorEnvelope,
        },
      },
      config: { rateLimit: AUTH_RATE_LIMIT },
    },
    async (req, reply) => {
      const { account } = await requireAccount(req, reply);
      await app.accounts.deleteAccount(req.log, account.id, req.body, new Date());
      await reply.destroySession();
      return reply.code(204).send(null);
    },
  );
};
