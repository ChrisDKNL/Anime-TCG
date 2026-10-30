import { DemoOpened, DemoResponse } from "@anime-tcg/shared/api";
import { ErrorEnvelope } from "@anime-tcg/shared/errors";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { DEMO_RATE_LIMIT } from "../limits.js";
import { NoQuery } from "../schemas.js";

/** Fastify validates an absent body as `null`: the opening takes none, and `{}` or anything else is a 400. */
const NoBody = Type.Null();

/**
 * The landing page's demo (navigation-and-landing.md §3.8): public, so no
 * route here asks for a session or even looks one up (`sessionless`). The
 * facts are on the global limit like every read; the opening has its own
 * per-address limit, sits behind the CSRF origin check like every POST, and
 * nothing in a request reaches the roll.
 */
export const demoRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/demo",
    {
      schema: { querystring: NoQuery, response: { 200: DemoResponse, 400: ErrorEnvelope } },
      config: { sessionless: true },
    },
    async (): Promise<DemoResponse> => app.demo.facts(),
  );

  app.post(
    "/demo/open",
    {
      schema: {
        querystring: NoQuery,
        body: NoBody,
        response: {
          200: DemoOpened,
          400: ErrorEnvelope,
          403: ErrorEnvelope,
          429: ErrorEnvelope,
          503: ErrorEnvelope,
        },
      },
      config: { sessionless: true, rateLimit: DEMO_RATE_LIMIT },
    },
    async (): Promise<DemoOpened> => app.demo.open(),
  );
};
