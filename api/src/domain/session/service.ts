import { and, eq, gt, lte } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { sessions } from "../../db/schema.js";
import { hashSessionId, hashUserAgent, isWellFormedSessionId, newSessionId } from "./ids.js";
import { expiryFrom, isDueForTouch } from "./policy.js";

export interface Session {
  /** The stored (hashed) id, never the cookie value. */
  id: string;
  accountId: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
}

export interface CreatedSession {
  cookieValue: string;
  session: Session;
}

const columns = {
  id: sessions.id,
  accountId: sessions.accountId,
  createdAt: sessions.createdAt,
  expiresAt: sessions.expiresAt,
  lastSeenAt: sessions.lastSeenAt,
};

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly secret: string,
  ) {}

  /** The live session behind a cookie value, or null for anything malformed, unknown or expired. */
  async find(cookieValue: string, now: Date): Promise<Session | null> {
    if (!isWellFormedSessionId(cookieValue)) return null;
    const id = hashSessionId(this.secret, cookieValue);
    const [row] = await this.db
      .select(columns)
      .from(sessions)
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
      .limit(1);
    return row ?? null;
  }

  async create(accountId: string | null, userAgent: string | undefined, now: Date): Promise<CreatedSession> {
    const cookieValue = newSessionId();
    const session: Session = {
      id: hashSessionId(this.secret, cookieValue),
      accountId,
      createdAt: now,
      expiresAt: expiryFrom(now),
      lastSeenAt: now,
    };
    await this.db.insert(sessions).values({ ...session, userAgentHash: hashUserAgent(userAgent) });
    return { cookieValue, session };
  }

  /** Slides the expiry forward, but only once per touch interval. Returns the session as it now stands. */
  async touchIfDue(session: Session, now: Date): Promise<{ session: Session; touched: boolean }> {
    if (!isDueForTouch(session.lastSeenAt, now)) return { session, touched: false };
    const expiresAt = expiryFrom(now);
    await this.db.update(sessions).set({ lastSeenAt: now, expiresAt }).where(eq(sessions.id, session.id));
    return { session: { ...session, lastSeenAt: now, expiresAt }, touched: true };
  }

  async destroy(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  /** Removes rows past their expiry; returns how many went. */
  async purgeExpired(now: Date): Promise<number> {
    const gone = await this.db
      .delete(sessions)
      .where(lte(sessions.expiresAt, now))
      .returning({ id: sessions.id });
    return gone.length;
  }
}
