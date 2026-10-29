import { eq, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { authThrottle } from "../../db/schema.js";
import {
  NO_FAILURES,
  purgeCutoff,
  recordFailure,
  retryAfterSeconds,
  THROTTLE_BLOCK_MS,
  THROTTLE_MAX_FAILURES,
  type ThrottleState,
} from "./throttle.js";

/**
 * `auth_throttle` rows keyed on a normalised login. Every method is a single
 * statement, so five misses arriving at once count as five: a read followed
 * by a write would let parallel attempts each see the same count and keep the
 * breather from ever starting.
 */
export class ThrottleStore {
  constructor(private readonly db: Db) {}

  /** Seconds the key still has to wait, or null when it may try. One indexed read, no password work. */
  async retryAfter(key: string, now: Date): Promise<number | null> {
    return retryAfterSeconds(await this.read(key), now);
  }

  /**
   * The state machine of throttle.ts as one upsert: a key without a row gets
   * its first miss; an existing row advances in the database, where
   * `auth_throttle.failures` is the row as it stands when the statement runs.
   */
  async recordFailure(key: string, now: Date): Promise<ThrottleState> {
    const first = recordFailure(NO_FAILURES, now);
    const blockedAt = new Date(now.getTime() + THROTTLE_BLOCK_MS);
    const limitReached = sql`${authThrottle.failures} + 1 >= ${THROTTLE_MAX_FAILURES}`;
    const [row] = await this.db
      .insert(authThrottle)
      .values({ key, failures: first.failures, blockedUntil: first.blockedUntil, updatedAt: now })
      .onConflictDoUpdate({
        target: authThrottle.key,
        set: {
          failures: sql`case when ${limitReached} then 0 else ${authThrottle.failures} + 1 end`,
          blockedUntil: sql`case when ${limitReached} then ${blockedAt}::timestamptz else null end`,
          updatedAt: now,
        },
      })
      .returning({ failures: authThrottle.failures, blockedUntil: authThrottle.blockedUntil });
    if (row === undefined) throw new Error("throttle upsert returned no row");
    return row;
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
