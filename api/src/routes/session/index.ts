import { SessionResponse } from "@anime-tcg/shared/api";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { NoQuery } from "../schemas.js";

/** Sprint 1a has no accounts, so every caller is signed out; 1b adds the signed-in branch. */
export const sessionRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/session",
    { schema: { querystring: NoQuery, response: { 200: SessionResponse } } },
    () => ({ signedIn: false }) satisfies SessionResponse,
  );
};
