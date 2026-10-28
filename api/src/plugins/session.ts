import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { Config } from "../config.js";
import { PURGE_INTERVAL_MS, SESSION_TTL_MS } from "../domain/session/policy.js";
import { type Session, SessionService } from "../domain/session/service.js";

declare module "fastify" {
  interface FastifyInstance {
    sessions: SessionService;
  }
  interface FastifyRequest {
    /** The live session behind the request's cookie, or null when there is none. */
    session: Session | null;
  }
  interface FastifyReply {
    createSession(accountId: string | null): Promise<Session>;
    destroySession(): Promise<void>;
  }
}

export interface SessionPluginOptions {
  config: Config;
}

/**
 * `__Host-` makes the browser enforce what the attributes below say: Secure,
 * Path=/ and no Domain, so the cookie cannot be set by a sibling subdomain or
 * over plain HTTP (localhost excepted, which keeps `npm run dev` working).
 */
export const SESSION_COOKIE = "__Host-session";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
} as const;

export const sessionPlugin = fp<SessionPluginOptions>(
  async (app, { config }) => {
    await app.register(cookie);

    const sessions = new SessionService(app.db, config.SESSION_SECRET);
    app.decorate("sessions", sessions);
    app.decorateRequest("session", null);

    app.decorateReply("createSession", async function (accountId: string | null) {
      const now = new Date();
      const { cookieValue, session } = await sessions.create(
        accountId,
        this.request.headers["user-agent"],
        now,
      );
      this.setCookie(SESSION_COOKIE, cookieValue, COOKIE_OPTIONS);
      this.request.session = session;
      return session;
    });

    app.decorateReply("destroySession", async function () {
      const current = this.request.session;
      if (current) await sessions.destroy(current.id);
      this.request.session = null;
      this.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
    });

    app.addHook("onRequest", async (req, reply) => {
      const cookieValue = req.cookies[SESSION_COOKIE];
      if (cookieValue === undefined) return;
      const now = new Date();
      const found = await sessions.find(cookieValue, now);
      if (!found) {
        reply.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
        return;
      }
      const { session, touched } = await sessions.touchIfDue(found, now);
      // Re-sending the same value restarts the cookie's Max-Age, so the browser-side expiry slides with the row.
      if (touched) reply.setCookie(SESSION_COOKIE, cookieValue, COOKIE_OPTIONS);
      req.session = session;
    });

    let purgeTimer: NodeJS.Timeout | undefined;
    const purge = async () => {
      try {
        const purged = await sessions.purgeExpired(new Date());
        app.log.info({ purged }, "expired sessions purged");
      } catch (err) {
        // A failed sweep must not take the process down; the next tick retries.
        app.log.error({ err }, "session purge failed");
      }
    };
    app.addHook("onReady", async () => {
      purgeTimer = setInterval(() => void purge(), PURGE_INTERVAL_MS);
      purgeTimer.unref();
    });
    app.addHook("onClose", async () => {
      clearInterval(purgeTimer);
    });
  },
  { name: "session", dependencies: ["db"] },
);
