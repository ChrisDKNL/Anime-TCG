import fp from "fastify-plugin";
import type { Config } from "../config.js";
import { InviteList } from "../domain/accounts/invites.js";
import { AccountService } from "../domain/accounts/service.js";
import { ThrottleStore } from "../domain/accounts/throttle-store.js";
import { PURGE_INTERVAL_MS } from "../domain/session/policy.js";

declare module "fastify" {
  interface FastifyInstance {
    accounts: AccountService;
  }
}

export interface AccountsPluginOptions {
  config: Config;
}

/**
 * Owns the account service for the app's lifetime and the hourly sweep of
 * stale throttle rows, a sibling of the session purge on the same cadence.
 */
export const accountsPlugin = fp<AccountsPluginOptions>(
  async (app, { config }) => {
    const invites = new InviteList(config.INVITE_CODES);
    if (invites.isEmpty) app.log.warn("INVITE_CODES is empty: registration is closed until it is set");
    const throttle = new ThrottleStore(app.db);
    app.decorate("accounts", new AccountService(app.db, throttle, invites, config.ACCOUNT_CAP));

    let purgeTimer: NodeJS.Timeout | undefined;
    const purge = async () => {
      try {
        const purged = await throttle.purgeStale(new Date());
        app.log.info({ purged }, "stale throttle rows purged");
      } catch (err) {
        // A failed sweep must not take the process down; the next tick retries.
        app.log.error({ err }, "throttle purge failed");
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
  { name: "accounts", dependencies: ["db", "session"] },
);
