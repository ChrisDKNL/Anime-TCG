---
name: fastify-api-conventions
description: Conventions for the api/ Fastify 5 + TypeBox + Drizzle service — plugin layout, route schemas, the error envelope, sessions, CSRF, rate limits, migrations and the inject-based test pattern. Use when adding or changing any endpoint, plugin, migration or test in api/, so every route is validated, authorised and tested the same way. Required reading before the first API PR (ADR 0009).
---

# Fastify API conventions

The server is the only source of truth (ADR 0008). Every convention below exists to make the safe thing the default and the unsafe thing visible in review.

## Layout

```
api/src/app.ts        buildApp(opts): FastifyInstance  — registers plugins then routes; never listens
api/src/server.ts     the only file that reads process.env and calls listen
api/src/config.ts     TypeBox-validated config; import { config } everywhere else
api/src/plugins/*.ts  one fastify-plugin per concern (db, session, security, errors)
api/src/routes/<domain>/index.ts   exports a plugin registering that domain's routes under its prefix
api/src/domain/<domain>/*.ts       pure logic + services; NO fastify imports, NO process.env
api/src/db/schema.ts, migrations/, client.ts
api/test/<domain>.test.ts          route tests with app.inject()
api/test/security/*.security.test.ts  adversarial tests (docs/05-security.md tiers)
```

A route handler is three lines: parse (done by the schema), call a domain function, return. Business rules live in `domain/`, where they are unit-tested without HTTP.

## Routes

```ts
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

const Body = Type.Object(
  { login: Type.String({ minLength: 3, maxLength: 24 }) },
  { additionalProperties: false },
);
const Reply = Type.Object({ signedIn: Type.Literal(true), account: AccountPublic });

export const accountRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/register",
    {
      schema: { body: Body, response: { 200: Reply, 400: ErrorEnvelope, 409: ErrorEnvelope } },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const account = await registerAccount(app.db, req.body, req.session);
      return { signedIn: true, account };
    },
  );
};
```

- Every object schema has `additionalProperties: false`. Unknown fields are a 400, never silently dropped.
- Every route declares `response` schemas for each status it returns. The serialiser only emits declared fields; this is how a column never leaks.
- Schemas that the web app needs live in `shared/` and are imported by both sides; `Static<typeof X>` is the type.
- Route prefixes: `/api/<domain>`; `/healthz` is the one route outside `/api`.
- Nothing reads `req.headers.cookie` directly; the session plugin decorates `req.session`.

## Error envelope

```json
{ "error": { "code": "validation_failed", "message": "body/login must NOT have fewer than 3 characters" } }
```

Throw `new ApiError(status, code, message)` from domain code; the error plugin maps it. Anything else becomes 500 `internal` with "Something went wrong" and a logged stack under the request id. Codes are `snake_case`, stable, and listed in `shared/src/errors.ts` so the UI can switch on them.

## Sessions, CSRF, rate limits

- Session cookie: 32 random bytes base64url, `HttpOnly; Secure; SameSite=Lax; Path=/`; stored as `HMAC-SHA256(SESSION_SECRET, value)`. `req.session` is `{ id, accountId | null }` after the plugin runs; `reply.createSession(accountId)` and `reply.destroySession()` are the only ways to change it.
- CSRF: the security plugin rejects any non-GET whose `Origin` (fallback `Referer`) is not `config.WEB_ORIGIN` with 403 `bad_origin`. Do not add exemptions; a route that needs one is designed wrong.
- Rate limits: global default from config; per-route overrides via `config.rateLimit` on the route options. Auth and anything with stakes (packs, games) always carry an override.
- Authorisation: a handler that touches account-scoped data calls `requireAccount(req)` first (throws 401 `unauthenticated`) and passes `req.session.accountId` into the domain function. Domain functions take the acting account id as their first argument and filter every query by it. "Admin" does not exist in the API; owner operations are CLI commands run on the server (`api/src/cli/*.ts`).

## Database

- Drizzle schema in `db/schema.ts`; generate migrations with `npm run db:generate -w api`; commit the SQL; never edit a committed migration, add a new one.
- Money-like columns are `integer` or `bigint`, never `numeric` or `real`. Every balance change inserts a ledger row inside the same transaction as the thing it pays for.
- Anything with stakes (pack opening, a wager) runs in a transaction with `SELECT ... FOR UPDATE` on the account row so two concurrent requests serialise. Test it with two parallel `inject()` calls.
- Randomness with stakes: `crypto.randomInt`. `Math.random` fails lint in `api/`.

## Tests

```ts
const app = await buildApp({ config: testConfig, db: testDb });
const res = await app.inject({ method: "POST", url: "/api/accounts/register", headers: { origin: WEB_ORIGIN }, payload: {...} });
expect(res.statusCode).toBe(200);
expect(res.json()).toEqual({ signedIn: true, account: expect.objectContaining({ login: "chris" }) });
```

- Route tests hit a real Postgres (`DATABASE_URL` for tests points at the `test` profile db or the CI service container); each file truncates the tables it uses in `beforeEach`.
- Every new route gets: the happy path; each declared error status; an extra body field → 400; missing Origin → 403; another account's id in a param → 403 or 404, never 200.
- Security tier T2+ changes add a `*.security.test.ts` with the adversarial cases named in `docs/05-security.md`.
- No mocking the database in route tests. Mock only external services (AniList) at the HTTP boundary with `undici`'s `MockAgent`.

## Logging and config

- `req.log` only; never `console.*` in `api/`. Redaction list in the logging plugin covers cookies, authorization, and any key named password/secret/token.
- `config.ts` is the only reader of `process.env`. Secrets are never logged, never returned, never in error messages; startup failure names the variable, not the value.
