import { eq, lte } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { authThrottle } from "../../db/schema.js";
import {
  NO_FAILURES,
  purgeCutoff,
  recordFailure,
  retryAfterSeconds,
  type ThrottleState,
} from "./throttle.js";

/**
 * `auth_throttle` rows keyed on a normalised login. Every method is one
 * statement or a read followed by an upsert; two simultaneous misses may
 * count as one, which is fine for a breather and would matter for a lock.
 */
export class ThrottleStore {
  constructor(private readonly db: Db) {}

  /** Seconds the key still has to wait, or null when it may try. One indexed read, no password work. */
  async retryAfter(key: string, now: Date): Promise<number | null> {
    return retryAfterSeconds(await this.read(key), now);
  }

  async recordFailure(key: string, now: Date): Promise<ThrottleState> {
    const next = recordFailure(await this.read(key), now);
    const row = { failures: next.failures, blockedUntil: next.blockedUntil, updatedAt: now };
    await this.db
      .insert(authThrottle)
      .values({ key, ...row })
      .onConflictDoUpdate({ target: authThrottle.key, set: row });
    return next;
  }

  /** A correct password ends the count; a missing row is the same as a cleared one. */
  async clear(key: string): Promise<void> {
    await this.db.delete(authThrottle).where(eq(authThrottle.key, key));
  }

  /** Removes rows untouched for the row TTL; returns how many went. */
  async purgeStale(now: Date): Promise<number> {
    const gone = await this.db
      .delete(authThrottle)
      .where(lte(authThrottle.updatedAt, purgeCutoff(now)))
      .returning({ key: authThrottle.key });
    return gone.length;
  }

  private async read(key: string): Promise<ThrottleState> {
    const [row] = await this.db
      .select({ failures: authThrottle.failures, blockedUntil: authThrottle.blockedUntil })
      .from(authThrottle)
      .where(eq(authThrottle.key, key))
      .limit(1);
    return row ?? NO_FAILURES;
  }
}
