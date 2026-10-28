import type { FastifyReply, FastifyRequest } from "fastify";
import type { Account } from "../domain/accounts/service.js";
import { ApiError } from "../domain/errors.js";

/**
 * The account behind the request's session, or null when signed out. The
 * row can vanish between the session lookup and here (a concurrent delete
 * cascades the session away); such a session is over, so its cookie is
 * cleared and whoever holds it is signed out (spec §6.5).
 */
export async function currentAccount(req: FastifyRequest, reply: FastifyReply): Promise<Account | null> {
  const accountId = req.session?.accountId ?? null;
  if (accountId === null) return null;
  const account = await req.server.accounts.get(accountId);
  if (account === null) await reply.destroySession();
  return account;
}

/** Every account-scoped handler starts here; the account's id is what the domain functions take. */
export async function requireAccount(req: FastifyRequest, reply: FastifyReply): Promise<Account> {
  const account = await currentAccount(req, reply);
  if (account === null) throw new ApiError(401, "unauthenticated", "Sign in first");
  return account;
}
