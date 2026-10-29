import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Player accounts (docs/design/accounts-api.md §5). `login` is the display
 * name as typed (trimmed); `login_normalized` is its case-folded form and the
 * only uniqueness key, so "Chris" and "chris" are one account. The password
 * is an Argon2id PHC string; the invite hash is an audit trail of which code
 * admitted the account, never used to verify anything.
 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  login: text("login").notNull(),
  loginNormalized: text("login_normalized").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  inviteCodeHash: text("invite_code_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Server sessions (ADR 0008 §4). `id` is the HMAC of the cookie value, so a
 * copy of this table yields no usable cookie. `account_id` stays nullable for
 * a pre-auth session; deleting an account takes its sessions with it.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
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

/**
 * The sign-in breather (spec §6.3), keyed on the normalised login so a
 * reload or a second tab cannot reset it. A row is written on a failed
 * password check and deleted on success; the hourly purge removes stale ones.
 */
export const authThrottle = pgTable("auth_throttle", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
