import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Server sessions (ADR 0008 §4). `id` is the HMAC of the cookie value, so a
 * copy of this table yields no usable cookie. `account_id` is nullable until
 * accounts arrive in 1b, which also adds the foreign key.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    accountId: uuid("account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    userAgentHash: text("user_agent_hash").notNull(),
  },
  (table) => [
    index("sessions_expires_at_idx").on(table.expiresAt),
    index("sessions_account_id_idx").on(table.accountId),
  ],
);
