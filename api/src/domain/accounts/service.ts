import type {
  AccountPublic,
  ChangePasswordBody,
  DeleteBody,
  LoginBody,
  RegisterBody,
  RenameBody,
} from "@anime-tcg/shared/api";
import { and, count, eq, ne, sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db } from "../../db/client.js";
import { accounts } from "../../db/schema.js";
import { ApiError } from "../errors.js";
import { hashInviteCode, type InviteList, isCapReached } from "./invites.js";
import { normalizeLogin, storableLogin, validatedLogin } from "./logins.js";
import { DUMMY_HASH, hashPassword, needsRehash, verifyPassword } from "./password.js";
import type { ThrottleStore } from "./throttle-store.js";

/** What the service logs through: the request's logger, so every line carries the request id (spec §6.7). */
export type AuditLog = Pick<Logger, "info">;

/** An account as the rest of the api sees it: never the hash, never the invite digest. */
export interface Account {
  id: string;
  login: string;
  createdAt: Date;
}

/** The collection is still browser-side until 1c, so every account reports no cards. */
const CARDS_UNTIL_1C = 0;

export function toPublic(account: Account): AccountPublic {
  return {
    id: account.id,
    login: account.login,
    createdAt: account.createdAt.toISOString(),
    cards: CARDS_UNTIL_1C,
  };
}

const accountColumns = { id: accounts.id, login: accounts.login, createdAt: accounts.createdAt };
const credentialColumns = { ...accountColumns, passwordHash: accounts.passwordHash };

type Tx = Pick<Db, "select" | "insert" | "update" | "delete" | "execute">;

/** `returning()` on a single-row write yields one row; anything else is a driver fault worth a 500. */
function single<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("write returned no row");
  return row;
}

export class AccountService {
  constructor(
    private readonly db: Db,
    private readonly throttle: ThrottleStore,
    private readonly invites: InviteList,
    private readonly cap: number,
  ) {}

  async get(accountId: string): Promise<Account | null> {
    const [row] = await this.db
      .select(accountColumns)
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Step 1 of registration. Both refusals happen before any slow work, and
   * the count runs first so an invalid code and a full roster cost the same.
   */
  async checkInvite(body: { inviteCode: string }): Promise<void> {
    const total = await this.countAccounts(this.db);
    if (!this.invites.accepts(body.inviteCode)) throw inviteInvalid();
    if (isCapReached(total, this.cap)) throw capReached();
  }

  async register(log: AuditLog, body: RegisterBody): Promise<Account> {
    if (!this.invites.accepts(body.inviteCode)) throw inviteInvalid();
    const login = validatedLogin(body.login);
    const loginNormalized = normalizeLogin(login);
    // Hashing takes tens of milliseconds; it happens before the lock so no other registration waits on it.
    const passwordHash = await hashPassword(body.password);
    const account = await this.db.transaction(async (tx) => {
      await lockAccounts(tx);
      if (isCapReached(await this.countAccounts(tx), this.cap)) throw capReached();
      if (await this.loginTaken(tx, loginNormalized, null)) throw loginTaken();
      return single(
        await tx
          .insert(accounts)
          .values({ login, loginNormalized, passwordHash, inviteCodeHash: hashInviteCode(body.inviteCode) })
          .returning(accountColumns),
      );
    });
    log.info({ accountId: account.id, login: account.login }, "account created");
    return account;
  }

  async login(log: AuditLog, body: LoginBody, now: Date): Promise<Account> {
    const key = normalizeLogin(storableLogin(body.login));
    await this.assertNotBlocked(log, key, now, "login");
    const [row] = await this.db
      .select(credentialColumns)
      .from(accounts)
      .where(eq(accounts.loginNormalized, key))
      .limit(1);
    // An unknown login still pays for one verification, against a hash nothing matches, so its timing equals a wrong password's.
    const verified = await verifyPassword(body.password, row?.passwordHash ?? DUMMY_HASH);
    if (row === undefined || !verified) {
      const throttle = await this.throttle.recordFailure(key, now);
      log.info({ login: key, outcome: "bad_credentials", throttle }, "login failed");
      throw new ApiError(401, "bad_credentials", "Incorrect login or password");
    }
    await this.throttle.clear(key);
    if (needsRehash(row.passwordHash)) {
      await this.db
        .update(accounts)
        .set({ passwordHash: await hashPassword(body.password) })
        .where(eq(accounts.id, row.id));
    }
    log.info({ accountId: row.id, login: row.login, outcome: "success" }, "login succeeded");
    return { id: row.id, login: row.login, createdAt: row.createdAt };
  }

  /** Renaming to the current login exactly is a no-op; a change of case only is a rename like any other. */
  async rename(log: AuditLog, accountId: string, body: RenameBody, now: Date): Promise<Account> {
    const login = validatedLogin(body.login);
    const loginNormalized = normalizeLogin(login);
    return this.db.transaction(async (tx) => {
      await lockAccounts(tx);
      const current = await this.find(tx, accountId);
      if (current.login === login) return current;
      if (await this.loginTaken(tx, loginNormalized, accountId)) throw loginTaken();
      const renamed = single(
        await tx
          .update(accounts)
          .set({ login, loginNormalized, updatedAt: now })
          .where(eq(accounts.id, accountId))
          .returning(accountColumns),
      );
      log.info({ accountId, from: current.login, login }, "account renamed");
      return renamed;
    });
  }

  async changePassword(log: AuditLog, accountId: string, body: ChangePasswordBody, now: Date): Promise<void> {
    await this.verifiedAccount(log, accountId, body.currentPassword, now, "change-password");
    await this.db
      .update(accounts)
      .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: now })
      .where(eq(accounts.id, accountId));
    log.info({ accountId }, "password changed");
  }

  /** The row goes, and the sessions with it (ON DELETE CASCADE). */
  async deleteAccount(log: AuditLog, accountId: string, body: DeleteBody, now: Date): Promise<void> {
    const account = await this.verifiedAccount(log, accountId, body.password, now, "delete");
    await this.db.delete(accounts).where(eq(accounts.id, accountId));
    log.info({ accountId, login: account.login }, "account deleted");
  }

  /**
   * The password check behind change-password and delete, under the same
   * breather as sign-in, keyed on the account's own login (spec §6.3).
   */
  private async verifiedAccount(
    log: AuditLog,
    accountId: string,
    password: string,
    now: Date,
    action: "change-password" | "delete",
  ): Promise<Account> {
    const [row] = await this.db
      .select(credentialColumns)
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (row === undefined) throw accountGone();
    const key = normalizeLogin(row.login);
    await this.assertNotBlocked(log, key, now, action);
    if (!(await verifyPassword(password, row.passwordHash))) {
      const throttle = await this.throttle.recordFailure(key, now);
      log.info({ accountId, action, outcome: "wrong_password", throttle }, "password check failed");
      throw new ApiError(403, "wrong_password", "That is not the current password");
    }
    await this.throttle.clear(key);
    return { id: row.id, login: row.login, createdAt: row.createdAt };
  }

  private async assertNotBlocked(log: AuditLog, key: string, now: Date, action: string): Promise<void> {
    const wait = await this.throttle.retryAfter(key, now);
    if (wait === null) return;
    log.info(
      { login: key, action, outcome: "too_many_failures", retryAfterSeconds: wait },
      "password check refused",
    );
    throw new ApiError(429, "too_many_failures", "Too many wrong passwords; wait a moment", wait);
  }

  private async find(tx: Tx, accountId: string): Promise<Account> {
    const [row] = await tx.select(accountColumns).from(accounts).where(eq(accounts.id, accountId)).limit(1);
    if (row === undefined) throw accountGone();
    return row;
  }

  private async countAccounts(tx: Tx): Promise<number> {
    const [row] = await tx.select({ total: count() }).from(accounts);
    return row?.total ?? 0;
  }

  /** Whether another account (not `exceptId`) already owns the normalised login. */
  private async loginTaken(tx: Tx, loginNormalized: string, exceptId: string | null): Promise<boolean> {
    const owned = eq(accounts.loginNormalized, loginNormalized);
    const [other] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(exceptId === null ? owned : and(owned, ne(accounts.id, exceptId)))
      .limit(1);
    return other !== undefined;
  }
}

/**
 * Serialises registrations and renames with each other: SHARE ROW EXCLUSIVE
 * conflicts with itself and with row writes, but not with the reads a login
 * does, so two registrations at cap - 1 cannot both see room (spec §5).
 */
async function lockAccounts(tx: Tx): Promise<void> {
  await tx.execute(sql`lock table accounts in share row exclusive mode`);
}

function inviteInvalid(): ApiError {
  return new ApiError(403, "invite_invalid", "That invite code is not valid");
}

function capReached(): ApiError {
  return new ApiError(403, "cap_reached", "No more accounts can be created right now");
}

function loginTaken(): ApiError {
  return new ApiError(409, "login_taken", "That login is already in use");
}

/** The session named an account that no longer exists: whoever holds it is signed out. */
function accountGone(): ApiError {
  return new ApiError(401, "unauthenticated", "Sign in first");
}
